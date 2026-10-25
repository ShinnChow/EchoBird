use super::*;
use axum::{http::HeaderMap, routing::post, Json, Router};
use std::sync::{Arc, Mutex};
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};

#[derive(Default)]
struct Record {
    grants: Vec<HeaderMap>,
    uri: String,
    frames: Vec<Vec<u8>>,
}

struct Server {
    http: String,
    ws: String,
    record: Arc<Mutex<Record>>,
    tasks: Vec<tokio::task::JoinHandle<()>>,
}

impl Drop for Server {
    fn drop(&mut self) {
        for task in &self.tasks {
            task.abort();
        }
    }
}

fn reply(text: &str, finished: bool) -> Vec<u8> {
    let payload = json!({"code":0,"result":{"text":text}}).to_string();
    let mut bytes = vec![0x11, if finished { 0x93 } else { 0x91 }, 0x10, 0];
    bytes.extend_from_slice(&(if finished { -1_i32 } else { 1_i32 }).to_be_bytes());
    bytes.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    bytes.extend_from_slice(payload.as_bytes());
    bytes
}

#[allow(clippy::result_large_err)]
async fn server(mode: &'static str) -> Server {
    let record: Arc<Mutex<Record>> = Arc::default();
    let observed = record.clone();
    let ws_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let ws = format!(
        "ws://{}/api/v3/sauc/bigmodel",
        ws_listener.local_addr().unwrap()
    );
    let ws_task = tokio::spawn(async move {
        let (tcp, _) = ws_listener.accept().await.unwrap();
        let captured = observed.clone();
        let mut socket =
            tokio_tungstenite::accept_hdr_async(tcp, move |req: &Request, res: Response| {
                captured.lock().unwrap().uri = req.uri().to_string();
                Ok(res)
            })
            .await
            .unwrap();
        while let Some(Ok(message)) = socket.next().await {
            let Message::Binary(bytes) = message else {
                break;
            };
            observed.lock().unwrap().frames.push(bytes.to_vec());
            if bytes[1] == 0x20 {
                socket
                    .send(Message::Binary(reply("interim", false).into()))
                    .await
                    .unwrap();
                if mode == "error" {
                    socket
                        .send(Message::Binary(frame(0xf0, 0x10, b"private-token").into()))
                        .await
                        .unwrap();
                    break;
                }
            }
            if bytes[1] == 0x22 {
                if mode == "close" {
                    socket.close(None).await.unwrap();
                    break;
                }
                socket
                    .send(Message::Binary(reply("最终全文。", true).into()))
                    .await
                    .unwrap();
            }
        }
    });
    let captured = record.clone();
    let app = Router::new().route("/icube/api/v2/asr/get/a", post(move |headers: HeaderMap, body: Bytes| {
        assert!(body.is_empty());
        captured.lock().unwrap().grants.push(headers);
        async move {
            let status = match mode { "401" => StatusCode::UNAUTHORIZED, "429" => StatusCode::TOO_MANY_REQUESTS, _ => StatusCode::OK };
            let url = if mode == "badhost" { "wss://untrusted.invalid/api/v3/sauc/bigmodel" } else { SPEECH_URL };
            let value = if status.is_success() { json!({"success":mode != "grant-failure","data":{"jwt_token":"temporary-asr-jwt","app_id":"native-app-id","uid":"asr-user","ws_url":url}}) } else { json!({"message":"selected-account-token"}) };
            (status, [("retry-after", "7")], Json(value))
        }
    }));
    let http_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let http = format!("http://{}", http_listener.local_addr().unwrap());
    let http_task = tokio::spawn(async move { axum::serve(http_listener, app).await.unwrap() });
    Server {
        http,
        ws,
        record,
        tasks: vec![http_task, ws_task],
    }
}

fn wav() -> Bytes {
    let mut data = b"RIFF".to_vec();
    data.extend(40_u32.to_le_bytes());
    data.extend(b"WAVEfmt \x10\0\0\0\x01\0\x01\0");
    data.extend(16000_u32.to_le_bytes());
    data.extend(32000_u32.to_le_bytes());
    data.extend(b"\x02\0\x10\0data");
    data.extend(4_u32.to_le_bytes());
    data.extend([1, 2, 3, 4]);
    data.into()
}

fn credentials(server: &Server) -> Value {
    json!({"edition":"traecn","region":"CN","accessToken":"selected-account-token","baseUrl":"https://untrusted.invalid","_voice_test_endpoint":server.http,"_voice_test_ws_endpoint":server.ws})
}

#[tokio::test]
async fn isolates_account_and_session_tokens_and_preserves_pcm_until_final_frame() {
    let server = server("ok").await;
    let result = transcribe(
        &reqwest::Client::new(),
        &credentials(&server),
        &wav(),
        "speech.wav",
        "audio/wav",
    )
    .await
    .unwrap();
    assert_eq!(result, "最终全文。");
    let record = server.record.lock().unwrap();
    assert_eq!(record.grants.len(), 1);
    assert_eq!(record.grants[0]["x-icube-token"], "selected-account-token");
    assert!(!record.grants[0].contains_key("authorization"));
    let url = url::Url::parse(&format!("ws://localhost{}", record.uri)).unwrap();
    let query: std::collections::HashMap<_, _> = url.query_pairs().collect();
    assert_eq!(query["api_access_key"], "Jwt; temporary-asr-jwt");
    assert_eq!(query["api_app_key"], "native-app-id");
    assert_eq!(query["api_resource_id"], "volc.bigasr.sauc.duration");
    assert!(!record.uri.contains("selected-account-token"));
    assert_eq!(record.frames.len(), 3);
    let init: Value = serde_json::from_slice(&record.frames[0][8..]).unwrap();
    assert_eq!(
        init["audio"],
        json!({"format":"pcm","rate":16000,"bits":16,"channel":1})
    );
    assert_eq!(init["user"]["uid"], "asr-user");
    assert_eq!(record.frames[1], [0x11, 0x20, 0, 0, 0, 0, 0, 4, 1, 2, 3, 4]);
    assert_eq!(record.frames[2], [0x11, 0x22, 0, 0, 0, 0, 0, 0]);
}

#[tokio::test]
async fn grant_errors_keep_status_and_never_open_websocket() {
    for mode in ["401", "429", "badhost", "grant-failure"] {
        let server = server(mode).await;
        let error = transcribe(
            &reqwest::Client::new(),
            &credentials(&server),
            &wav(),
            "speech.wav",
            "audio/wav",
        )
        .await
        .unwrap_err();
        assert_eq!(
            error.status,
            match mode {
                "401" => StatusCode::UNAUTHORIZED,
                "429" => StatusCode::TOO_MANY_REQUESTS,
                _ => StatusCode::BAD_GATEWAY,
            }
        );
        assert!(!error.message.contains("selected-account-token"));
        if matches!(mode, "401" | "429") {
            assert_eq!(error.retry_after.unwrap(), "7");
        }
        let record = server.record.lock().unwrap();
        assert_eq!(record.grants.len(), 1);
        assert!(record.uri.is_empty());
    }
}

#[tokio::test]
async fn missing_terminal_or_error_frame_discards_partial_text() {
    for mode in ["close", "error"] {
        let server = server(mode).await;
        let error = transcribe(
            &reqwest::Client::new(),
            &credentials(&server),
            &wav(),
            "speech.wav",
            "audio/wav",
        )
        .await
        .unwrap_err();
        assert_eq!(error.status, StatusCode::BAD_GATEWAY);
        assert!(!error.message.contains("private-token"));
    }
}

#[tokio::test]
async fn rejects_wrong_region_or_format_before_authorization_request() {
    let server = server("ok").await;
    for (field, value) in [("edition", "trae"), ("region", "SG"), ("accessToken", "")] {
        let mut c = credentials(&server);
        c[field] = json!(value);
        assert!(transcribe(
            &reqwest::Client::new(),
            &c,
            &wav(),
            "speech.wav",
            "audio/wav"
        )
        .await
        .is_err());
    }
    for (audio, mime) in [(Bytes::new(), "audio/wav"), (wav(), "audio/mpeg")] {
        assert!(transcribe(
            &reqwest::Client::new(),
            &credentials(&server),
            &audio,
            "speech.wav",
            mime
        )
        .await
        .is_err());
    }
    assert!(server.record.lock().unwrap().grants.is_empty());
}

#[test]
fn validates_binary_lengths_sequence_flags_and_gzip() {
    let complete = reply("full", true);
    assert_eq!(decode(&complete).unwrap().0["result"]["text"], "full");
    assert!(decode(&complete).unwrap().1);
    for bytes in [
        vec![],
        vec![0; 8],
        complete[..complete.len() - 1].to_vec(),
        frame(0xf0, 0x10, b"secret"),
    ] {
        assert!(decode(&bytes).is_err());
    }
    use std::io::Write;
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder
        .write_all(br#"{"result":{"text":"compressed"}}"#)
        .unwrap();
    let bytes = frame(0x92, 0x11, &encoder.finish().unwrap());
    assert_eq!(decode(&bytes).unwrap().0["result"]["text"], "compressed");
    assert!(decode(&bytes).unwrap().1);
}
