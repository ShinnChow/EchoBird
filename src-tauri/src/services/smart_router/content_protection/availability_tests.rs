use super::*;
use axum::{body::Body, http::header, response::Response};
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

const VALUE: &str = "sk-availabilityFixtureCredential123456789";

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("protection-availability-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        std::fs::write(
            root.join("settings.json"),
            r#"{"sensitiveInfoProtection":true}"#,
        )
        .unwrap();
        Self(root)
    }

    async fn prepare(&self, body: &mut Value) -> Protection {
        Protection::prepare(
            body,
            &self.0.join("router.json"),
            &self.0.join("settings.json"),
        )
        .await
        .unwrap()
    }

    fn slot(&self) -> EngineSlot {
        ENGINES
            .get()
            .unwrap()
            .lock()
            .unwrap()
            .get(&(self.0.join("router.json"), self.0.join("settings.json")))
            .unwrap()
            .clone()
    }

    async fn engine(&self) -> SharedEngine {
        let slot = self.slot();
        let guard = slot.lock().await;
        guard.as_ref().unwrap().clone()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn held_engine(
    engine: SharedEngine,
) -> (
    std::sync::mpsc::Sender<()>,
    Arc<AtomicBool>,
    std::thread::JoinHandle<()>,
) {
    let (release, released) = std::sync::mpsc::channel();
    let (ready, held) = std::sync::mpsc::channel();
    let holding = Arc::new(AtomicBool::new(false));
    let marker = holding.clone();
    let thread = std::thread::spawn(move || {
        let _guard = engine.lock().unwrap();
        marker.store(true, Ordering::SeqCst);
        ready.send(()).unwrap();
        let _ = released.recv_timeout(Duration::from_secs(2));
        marker.store(false, Ordering::SeqCst);
    });
    held.recv_timeout(Duration::from_secs(5)).unwrap();
    (release, holding, thread)
}

#[tokio::test(flavor = "current_thread")]
async fn request_scan_does_not_block_the_async_runtime() {
    let fixture = Fixture::new();
    fixture.prepare(&mut json!({"input":VALUE})).await;
    let (release, holding, thread) = held_engine(fixture.engine().await);
    let mut body = json!({"input":VALUE});
    let (_, responsive) = tokio::join!(fixture.prepare(&mut body), async {
        let responsive = holding.load(Ordering::SeqCst);
        let _ = release.send(());
        responsive
    });
    thread.join().unwrap();
    assert!(
        responsive,
        "request processing blocked the async runtime behind an engine lock"
    );
    assert!(!body.to_string().contains(VALUE));
}

#[tokio::test(flavor = "current_thread")]
async fn response_restore_does_not_wait_for_another_request_scan() {
    let fixture = Fixture::new();
    for streaming in [false, true] {
        let mut body = json!({"input":VALUE});
        let protection = fixture.prepare(&mut body).await;
        let content = if streaming {
            format!(
                "data: {}\n\ndata: [DONE]\n\n",
                json!({"choices":[{"index":0,"delta":{"content":body["input"]}}]})
            )
        } else {
            json!({"output_text":body["input"]}).to_string()
        };
        let response = Response::builder()
            .header(
                header::CONTENT_TYPE,
                if streaming {
                    "text/event-stream"
                } else {
                    "application/json"
                },
            )
            .body(Body::from(content))
            .unwrap();
        let (release, holding, thread) = held_engine(fixture.engine().await);
        let restore = async {
            let response = protection.restore(response).await;
            axum::body::to_bytes(response.into_body(), 4096)
                .await
                .unwrap()
        };
        let (bytes, responsive) = tokio::join!(restore, async {
            let responsive = holding.load(Ordering::SeqCst);
            let _ = release.send(());
            responsive
        });
        thread.join().unwrap();
        assert!(
            responsive,
            "response restoration waited for a different request's engine lock"
        );
        assert!(std::str::from_utf8(&bytes).unwrap().contains(VALUE));
    }
}

#[tokio::test]
async fn concurrent_cold_requests_share_one_seed_and_stable_placeholders() {
    let fixture = Fixture::new();
    let mut first = json!({"input":VALUE});
    let mut second = first.clone();
    let (a, b) = tokio::join!(fixture.prepare(&mut first), fixture.prepare(&mut second));
    assert_eq!(first, second);
    assert!(!first.to_string().contains(VALUE));
    assert!(Arc::ptr_eq(&a.0, &b.0));
    assert_eq!(
        std::fs::read(fixture.0.join("content-protection.key"))
            .unwrap()
            .len(),
        32
    );
}

#[tokio::test]
async fn canceled_and_expired_waiters_leave_before_scanning_and_off_bypasses_the_queue() {
    use super::super::{prepare_protection, AppState};
    let fixture = Fixture::new();
    fixture.prepare(&mut json!({"input":VALUE})).await;
    let slot = fixture.slot();
    let held = slot.clone().lock_owned().await;
    let mut canceled_body = json!({"input":"sk-canceledFixtureCredential123456789"});
    let scope = fixture.0.join("router.json");
    let settings = fixture.0.join("settings.json");
    let mut canceled = Box::pin(Protection::prepare(&mut canceled_body, &scope, &settings));
    assert!(futures_util::poll!(&mut canceled).is_pending());
    drop(canceled);
    let mut expired_body = canceled_body.clone();
    let expired = Protection::prepare_until(
        &mut expired_body,
        &scope,
        &settings,
        Instant::now() + Duration::from_millis(20),
    )
    .await;
    assert!(matches!(expired, Err(FAILURE)));
    assert_eq!(expired_body, canceled_body);
    std::fs::write(&settings, r#"{"sensitiveInfoProtection":false}"#).unwrap();
    let mut state = AppState::for_tests().unwrap();
    state.config_path = scope;
    state.protection_settings_path = settings;
    let off = tokio::time::timeout(
        Duration::from_secs(2),
        prepare_protection(&state, &mut expired_body),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(off.is_none());
    assert_eq!(expired_body, canceled_body);
    drop(held);
    fixture.prepare(&mut json!({"input":VALUE})).await;
    assert_eq!(fixture.engine().await.lock().unwrap().secrets.len(), 1);
}

#[tokio::test]
async fn timed_out_active_work_keeps_its_turn_until_local_work_finishes() {
    let fixture = Fixture::new();
    fixture.prepare(&mut json!({"input":VALUE})).await;
    let (release, _, thread) = held_engine(fixture.engine().await);
    let mut body = json!({"input":VALUE});
    let result = Protection::prepare_until(
        &mut body,
        &fixture.0.join("router.json"),
        &fixture.0.join("settings.json"),
        Instant::now() + Duration::from_millis(30),
    )
    .await;
    assert!(matches!(result, Err(FAILURE)));
    assert!(body.is_null());
    let slot = fixture.slot();
    assert!(slot.try_lock().is_err());
    release.send(()).unwrap();
    thread.join().unwrap();
    let finished = tokio::time::timeout(Duration::from_secs(5), slot.lock())
        .await
        .unwrap();
    assert!(finished.is_some());
}

#[test]
fn a_response_uses_its_own_immutable_mapping() {
    let engine = Arc::new(Mutex::new(Engine::new([41; 32], b"snapshot-fixture")));
    let mut first = json!({"input":VALUE});
    let early = Protection::with_engine(&mut first, engine.clone()).unwrap();
    let later_value = "sk-laterFixtureCredential123456789";
    let mut second = json!({"input":later_value});
    let later = Protection::with_engine(&mut second, engine).unwrap();
    let token = second["input"].as_str().unwrap();
    assert_eq!(early.0.restore(token, false), token);
    assert_eq!(later.0.restore(token, false), later_value);
    assert_eq!(
        early.0.restore(first["input"].as_str().unwrap(), false),
        VALUE
    );
}

#[test]
fn expired_processing_refuses_discovery_and_known_value_scanning() {
    let mut engine = Engine::new([42; 32], b"deadline-fixture");
    engine.remember(VALUE).unwrap();
    let deadline = Instant::now();
    assert!(matches!(
        engine.discover("input", VALUE, deadline),
        Err(FAILURE)
    ));
    assert!(matches!(engine.mask(VALUE, deadline), Err(FAILURE)));
    assert!(engine
        .mask(VALUE, Instant::now() + PROCESS_TIMEOUT)
        .unwrap()
        .starts_with(PREFIX));
}
