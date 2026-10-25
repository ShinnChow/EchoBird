use super::*;
use axum::{extract::Multipart, routing::post, Router};
use serde_json::json;
use std::sync::{Arc, Mutex};

type Uploads = Arc<Mutex<Vec<(HeaderMap, String, String, Bytes)>>>;

struct Server {
    url: String,
    uploads: Uploads,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn server(status: StatusCode, result: &str) -> Server {
    let uploads: Uploads = Arc::default();
    let captured = uploads.clone();
    let result = result.to_owned();
    let app = Router::new().route(
        "/transcribe",
        post(move |headers: HeaderMap, mut fields: Multipart| {
            let captured = captured.clone();
            let result = result.clone();
            async move {
                let field = fields.next_field().await.unwrap().unwrap();
                assert_eq!(field.name(), Some("file"));
                let filename = field.file_name().unwrap().to_owned();
                let mime = field.content_type().unwrap().to_owned();
                let audio = field.bytes().await.unwrap();
                assert!(fields.next_field().await.unwrap().is_none());
                captured
                    .lock()
                    .unwrap()
                    .push((headers, filename, mime, audio));
                (
                    status,
                    [
                        (header::RETRY_AFTER, "17"),
                        (header::CONTENT_TYPE, "application/json"),
                    ],
                    result,
                )
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    Server { url, uploads, task }
}

fn credentials(server: &Server) -> Value {
    json!({"accessToken":"selected-token","accountId":"selected-account",
        "baseUrl":"http://untrusted.invalid","headers":{"authorization":"untrusted"},
        "_voice_test_endpoint":server.url})
}

#[tokio::test]
async fn forwards_only_file_and_selected_codex_account_metadata() {
    let server = server(StatusCode::OK, r#"{"text":"完整文本"}"#).await;
    let audio = Bytes::from_static(b"RIFF\0\xff\x80WAVEfixture");
    assert_eq!(
        transcribe(
            &reqwest::Client::new(),
            &credentials(&server),
            &audio,
            "sample.wav",
            "audio/wav"
        )
        .await
        .unwrap(),
        "完整文本"
    );
    assert_eq!(ENDPOINT, "https://chatgpt.com/backend-api");
    let uploads = server.uploads.lock().unwrap();
    assert_eq!(uploads.len(), 1);
    let (headers, filename, mime, received) = &uploads[0];
    assert_eq!(headers["authorization"], "Bearer selected-token");
    assert_eq!(headers["chatgpt-account-id"], "selected-account");
    assert_eq!(headers["originator"], "codex_cli_rs");
    assert_eq!(headers["version"], "0.159.0");
    assert_eq!(headers["user-agent"], "codex_cli_rs/0.159.0 (EchoBird)");
    assert!(!headers.contains_key("openai-beta"));
    assert_eq!(filename, "sample.wav");
    assert_eq!(mime, "audio/wav");
    assert_eq!(received, &audio);
}

#[tokio::test]
async fn rejects_missing_or_invalid_authentication_before_upload() {
    let server = server(StatusCode::OK, r#"{"text":"unused"}"#).await;
    for invalid in [
        json!({}),
        json!({"accessToken":""}),
        json!({"accessToken":"  "}),
        json!({"accessToken":"secret\nvalue"}),
        json!({"accessToken":"valid","accountId":"secret\nvalue"}),
    ] {
        let mut invalid = invalid;
        invalid["_voice_test_endpoint"] = json!(server.url);
        let error = transcribe(
            &reqwest::Client::new(),
            &invalid,
            &Bytes::from_static(b"audio"),
            "sample.wav",
            "audio/wav",
        )
        .await
        .unwrap_err();
        assert_eq!(error.status, StatusCode::UNAUTHORIZED);
        assert!(!error.message.contains("secret"));
    }
    assert!(server.uploads.lock().unwrap().is_empty());
}

#[tokio::test]
async fn preserves_http_errors_without_retries_or_private_response_content() {
    for status in [
        StatusCode::UNAUTHORIZED,
        StatusCode::FORBIDDEN,
        StatusCode::TOO_MANY_REQUESTS,
    ] {
        let server = server(status, r#"{"secret":"private-server-message"}"#).await;
        let error = transcribe(
            &reqwest::Client::new(),
            &credentials(&server),
            &Bytes::from_static(b"audio"),
            "sample.wav",
            "audio/wav",
        )
        .await
        .unwrap_err();
        assert_eq!(error.status, status);
        assert_eq!(error.retry_after.as_ref().unwrap(), "17");
        assert!(!error.message.contains("private"));
        assert_eq!(server.uploads.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn rejects_malformed_results_and_preserves_empty_transcripts() {
    for body in [
        "private-invalid-json",
        "{}",
        r#"{"text":null}"#,
        r#"{"text":7}"#,
        r#"{"text":""}"#,
    ] {
        let server = server(StatusCode::OK, body).await;
        let result = transcribe(
            &reqwest::Client::new(),
            &credentials(&server),
            &Bytes::from_static(b"audio"),
            "sample.wav",
            "audio/wav",
        )
        .await;
        if body == r#"{"text":""}"# {
            assert_eq!(result.unwrap(), "");
        } else {
            let error = result.unwrap_err();
            assert_eq!(error.status, StatusCode::BAD_GATEWAY);
            assert!(!error.message.contains("private"));
        }
        assert_eq!(server.uploads.lock().unwrap().len(), 1);
    }
}
