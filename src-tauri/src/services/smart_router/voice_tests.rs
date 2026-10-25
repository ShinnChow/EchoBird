use super::*;
use axum::extract::Multipart;
use reqwest::multipart::{Form, Part};
use std::collections::VecDeque;

type Recording = Arc<Mutex<Vec<(HeaderMap, String, String, Bytes)>>>;

struct MockServer {
    url: String,
    requests: Recording,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for MockServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn mock(responses: Vec<Response>) -> MockServer {
    let requests: Recording = Arc::default();
    let recorded = requests.clone();
    let responses = Arc::new(Mutex::new(VecDeque::from(responses)));
    let app = Router::new().route(
        "/agenttool/v1/asr",
        post(move |headers: HeaderMap, mut fields: Multipart| {
            let recorded = recorded.clone();
            let responses = responses.clone();
            async move {
                let field = fields.next_field().await.unwrap().unwrap();
                assert_eq!(field.name(), Some("audio"));
                let filename = field.file_name().unwrap().to_owned();
                let mime = field.content_type().unwrap().to_owned();
                let bytes = field.bytes().await.unwrap();
                assert!(fields.next_field().await.unwrap().is_none());
                recorded
                    .lock()
                    .unwrap()
                    .push((headers, filename, mime, bytes));
                responses
                    .lock()
                    .unwrap()
                    .pop_front()
                    .expect("Unexpected upstream request")
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    MockServer {
        url,
        requests,
        task,
    }
}

fn upload() -> Upload {
    Upload {
        selector: format!("workbuddy:{}", "a".repeat(64)),
        source: AccountSource {
            provider: AccountProvider::WorkBuddy,
            account_id: "a".repeat(64),
        },
        audio: Bytes::from_static(b"RIFF\0\xff\x01\x80WAVEfixture"),
        filename: "recording.wav".into(),
        mime: "audio/wav".into(),
        text_response: false,
    }
}

fn credentials(server: &MockServer, token: &str) -> Value {
    json!({"accessToken":token,"uid":"selected-user","domain":"workbuddy.cn",
        "enterpriseId":"selected-enterprise","baseUrl":"http://wrong-text-endpoint.invalid",
        "_voice_test_endpoint":server.url})
}

#[tokio::test]
async fn forwards_binary_audio_and_selected_account_headers() {
    let server = mock(vec![
        Json(json!({"code":0,"text":"语音输入正常。"})).into_response()
    ])
    .await;
    let input = upload();
    let text = transcribe(&reqwest::Client::new(), &input, |_| {
        std::future::ready(Ok(credentials(&server, "selected-token")))
    })
    .await
    .unwrap();
    assert_eq!(text, "语音输入正常。");
    let recorded = server.requests.lock().unwrap();
    assert_eq!(recorded.len(), 1);
    let (headers, filename, mime, audio) = &recorded[0];
    assert_eq!(headers["authorization"], "Bearer selected-token");
    assert_eq!(headers["x-user-id"], "selected-user");
    assert_eq!(headers["x-domain"], "workbuddy.cn");
    assert_eq!(headers["x-enterprise-id"], "selected-enterprise");
    assert_eq!(headers["x-tenant-id"], "selected-enterprise");
    assert_eq!(filename, &input.filename);
    assert_eq!(mime, &input.mime);
    assert_eq!(audio, &input.audio);
}

#[tokio::test]
async fn refreshes_rejected_token_once_and_replays_the_same_audio() {
    for second_status in [StatusCode::OK, StatusCode::UNAUTHORIZED] {
        let server = mock(vec![
            StatusCode::UNAUTHORIZED.into_response(),
            (second_status, Json(json!({"code":0,"text":"new result"}))).into_response(),
        ])
        .await;
        let old = credentials(&server, "old");
        let new = credentials(&server, "new");
        let mut calls = Vec::new();
        let result = transcribe(&reqwest::Client::new(), &upload(), |rejected| {
            let next = if rejected.is_some() {
                new.clone()
            } else {
                old.clone()
            };
            calls.push(rejected);
            std::future::ready(Ok(next))
        })
        .await;
        if second_status.is_success() {
            assert_eq!(result.unwrap(), "new result");
        } else {
            assert_eq!(result.unwrap_err().status, second_status);
        }
        assert_eq!(calls, vec![None, Some(old)]);
        let recorded = server.requests.lock().unwrap();
        assert_eq!(recorded.len(), 2);
        assert_eq!(recorded[0].0["authorization"], "Bearer old");
        assert_eq!(recorded[1].0["authorization"], "Bearer new");
        assert_eq!(recorded[0].3, recorded[1].3);
    }
}

#[tokio::test]
async fn non_authentication_errors_do_not_refresh_or_repeat_audio() {
    for status in [
        StatusCode::FORBIDDEN,
        StatusCode::TOO_MANY_REQUESTS,
        StatusCode::BAD_GATEWAY,
    ] {
        let mut response = status.into_response();
        response
            .headers_mut()
            .insert(header::RETRY_AFTER, HeaderValue::from_static("15"));
        let server = mock(vec![response]).await;
        let mut calls = 0;
        let error = transcribe(&reqwest::Client::new(), &upload(), |rejected| {
            assert!(rejected.is_none());
            calls += 1;
            std::future::ready(Ok(credentials(&server, "token")))
        })
        .await
        .unwrap_err();
        assert_eq!(error.status, status);
        assert_eq!(error.retry_after.unwrap(), "15");
        assert_eq!(calls, 1);
        assert_eq!(server.requests.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn rejects_business_and_malformed_responses_but_accepts_silence() {
    for (response, expected) in [
        (Json(json!({"code":0,"text":""})).into_response(), Some("")),
        (
            Json(json!({"code":123,"msg":"private upstream detail","text":"not a success"}))
                .into_response(),
            None,
        ),
        (Json(json!({"code":0})).into_response(), None),
        ("not json".into_response(), None),
    ] {
        let server = mock(vec![response]).await;
        let result = transcribe(&reqwest::Client::new(), &upload(), |_| {
            std::future::ready(Ok(credentials(&server, "token")))
        })
        .await;
        if let Some(text) = expected {
            assert_eq!(result.unwrap(), text);
        } else {
            let error = result.unwrap_err();
            assert_eq!(error.status, StatusCode::BAD_GATEWAY);
            assert!(!error.message.contains("private upstream detail"));
        }
        assert_eq!(server.requests.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn credential_failure_never_uploads_audio() {
    let server = mock(vec![]).await;
    let error = transcribe(&reqwest::Client::new(), &upload(), |_| {
        std::future::ready(Err("accountError.loginRequired".into()))
    })
    .await
    .unwrap_err();
    assert_eq!(error.status, StatusCode::UNAUTHORIZED);
    assert!(server.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn upstream_response_timeout_does_not_repeat_audio() {
    let body = Body::from_stream(stream::once(async {
        tokio::time::sleep(Duration::from_secs(31)).await;
        Ok::<_, std::io::Error>(Bytes::from_static(b"{\"code\":0,\"text\":\"late\"}"))
    }));
    let server = mock(vec![Response::new(body)]).await;
    let mut calls = 0;
    let error = transcribe(&reqwest::Client::new(), &upload(), |_| {
        calls += 1;
        std::future::ready(Ok(credentials(&server, "token")))
    })
    .await
    .unwrap_err();
    assert_eq!(error.status, StatusCode::GATEWAY_TIMEOUT);
    assert_eq!(calls, 1);
    assert_eq!(server.requests.lock().unwrap().len(), 1);
}

fn form() -> Form {
    Form::new()
        .text("model", format!("workbuddy:{}", "a".repeat(64)))
        .part(
            "file",
            Part::bytes(upload().audio.to_vec())
                .file_name("input.wav")
                .mime_str("audio/wav")
                .unwrap(),
        )
}

#[tokio::test]
async fn validates_local_authentication_and_multipart_before_account_access() {
    let app = Router::new()
        .route(
            "/v1/audio/transcriptions",
            post(|request: Request| async {
                match read_upload(request, "local-key").await {
                    Ok(input) => Json(
                        json!({"accountId":input.source.account_id,"audio":input.audio.to_vec(),
                "filename":input.filename,"mime":input.mime,"text":input.text_response}),
                    )
                    .into_response(),
                    Err(response) => response,
                }
            }),
        )
        .layer(DefaultBodyLimit::max(1024));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!(
        "http://{}/v1/audio/transcriptions",
        listener.local_addr().unwrap()
    );
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .bearer_auth("local-key")
        .multipart(form().text("response_format", "text"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let parsed: Value = response.json().await.unwrap();
    assert_eq!(parsed["accountId"], "a".repeat(64));
    assert_eq!(parsed["audio"], json!(upload().audio.to_vec()));
    assert_eq!(parsed["filename"], "input.wav");
    assert_eq!(parsed["mime"], "audio/wav");
    assert_eq!(parsed["text"], true);

    let response = client
        .post(&url)
        .body("malformed multipart")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    for invalid in [
        Form::new().text("model", format!("workbuddy:{}", "a".repeat(64))),
        Form::new().part("file", Part::bytes(vec![1])),
        Form::new()
            .text("model", "workbuddy:../../other-account")
            .part("file", Part::bytes(vec![1])),
        Form::new()
            .text("model", format!("workbuddyAi:{}", "a".repeat(64)))
            .part("file", Part::bytes(vec![1])),
        Form::new()
            .text("model", format!("workbuddy:{}", "a".repeat(64)))
            .part("file", Part::bytes(vec![])),
        form().text("model", format!("workbuddy:{}", "b".repeat(64))),
        form().text("language", "zh"),
        form().text("response_format", "srt"),
    ] {
        let response = client
            .post(&url)
            .bearer_auth("local-key")
            .multipart(invalid)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
    let response = client
        .post(&url)
        .bearer_auth("local-key")
        .multipart(Form::new().text("model", "x".repeat(2048)))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    task.abort();
}

#[tokio::test]
async fn authentication_uses_each_group_config_without_writing_or_accessing_accounts() {
    for (key, other_key) in [("first-key", "second-key"), ("second-key", "first-key")] {
        let mut state = AppState::for_tests().unwrap();
        state.config_path = std::env::temp_dir().join(format!(
            "echobird-voice-config-{}.json",
            uuid::Uuid::new_v4()
        ));
        let config = serde_json::to_vec(&json!({"apiKey":key})).unwrap();
        fs::write(&state.config_path, &config).unwrap();
        for (request_key, status) in [
            (key, StatusCode::BAD_REQUEST),
            (other_key, StatusCode::UNAUTHORIZED),
        ] {
            let request = Request::builder()
                .header(header::AUTHORIZATION, format!("Bearer {request_key}"))
                .body(Body::empty())
                .unwrap();
            let response = handle(State(state.clone()), request).await;
            assert_eq!(response.status(), status);
            assert_eq!(fs::read(&state.config_path).unwrap(), config);
        }
        fs::remove_file(&state.config_path).unwrap();
        let response = handle(State(state), Request::new(Body::empty())).await;
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}

#[tokio::test]
#[ignore = "requires an explicitly selected saved account and synthetic speech file"]
async fn live_workbuddy_transcription() {
    let account = std::env::var("ECHOBIRD_VOICE_TEST_ACCOUNT").unwrap();
    let audio = std::fs::read(std::env::var("ECHOBIRD_VOICE_TEST_WAV").unwrap()).unwrap();
    let state = AppState::for_tests().unwrap();
    let key = config_for_request(&state).unwrap().api_key;
    let app = Router::new()
        .route("/v1/audio/transcriptions", post(handle))
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BODY_BYTES))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!(
        "http://{}/v1/audio/transcriptions",
        listener.local_addr().unwrap()
    );
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let response = reqwest::Client::new()
        .post(url)
        .bearer_auth(key)
        .multipart(
            Form::new()
                .text("model", format!("workbuddy:{account}"))
                .part(
                    "file",
                    Part::bytes(audio)
                        .file_name("synthetic-test.wav")
                        .mime_str("audio/wav")
                        .unwrap(),
                ),
        )
        .send()
        .await
        .unwrap();
    let status = response.status();
    let result: Value = response.json().await.unwrap();
    task.abort();
    assert_eq!(status, StatusCode::OK, "{result}");
    let text = result["text"].as_str().unwrap();
    assert!(
        !text.trim().is_empty(),
        "Synthetic speech produced no transcription"
    );
    eprintln!("Synthetic speech transcription: {text}");
}
