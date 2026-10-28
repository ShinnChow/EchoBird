use super::plugin_manager::{manifest::relative_path, InstalledPlugin, PluginManager};
use crate::models::model::ModelConfig;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::Manager;
use tokio_util::sync::CancellationToken;

mod account;
pub mod product;

struct Session {
    plugin_id: String,
    token: String,
    root: PathBuf,
    model: Option<ModelConfig>,
    model_permission: bool,
    clipboard_permission: bool,
    cancelled: CancellationToken,
    busy: AtomicBool,
    product: Option<product::ProductSession>,
}

#[derive(Default)]
pub struct PluginRuntime {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    workers: Mutex<HashMap<(String, String), CancellationToken>>,
    pending: Mutex<HashMap<String, product::Pending>>,
    product_sync: Mutex<()>,
}

pub fn allowed_command(label: &str, command: &str) -> bool {
    !label.starts_with("plugin-")
        || [
            "plugin_model_request",
            "plugin_window_control",
            "plugin_clipboard_write",
            "plugin_host_call",
            "plugin_host_result",
        ]
        .contains(&command)
}

pub fn guard<R: tauri::Runtime, F: Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static>(
    handler: F,
) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    move |invoke| {
        if !super::developer_preview::command_allowed(invoke.message.command()) {
            invoke.resolver.reject("Developer preview is paused");
            return true;
        }
        if !allowed_command(
            invoke.message.webview_ref().label(),
            invoke.message.command(),
        ) {
            invoke.resolver.reject("Plugin command permission denied");
            return true;
        }
        handler(invoke)
    }
}

fn allowed_navigation(url: &url::Url, token: &str) -> bool {
    ((url.scheme() == "echobird-plugin" && url.host_str() == Some("localhost"))
        || (["http", "https"].contains(&url.scheme())
            && url.host_str() == Some("echobird-plugin.localhost")))
        && url.path().starts_with(&format!("/{token}/"))
}

const CSP: &str = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src ipc: http://ipc.localhost https://ipc.localhost; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

impl PluginRuntime {
    fn pause_sessions(&self) -> Vec<String> {
        super::plugin_accounts::stop_all();
        for (_, token) in self.workers.lock().unwrap().drain() {
            token.cancel();
        }
        self.sessions
            .lock()
            .unwrap()
            .drain()
            .map(|(label, session)| {
                session.cancelled.cancel();
                label
            })
            .collect()
    }

    pub fn pause(&self, app: &tauri::AppHandle) {
        for label in self.pause_sessions() {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.close();
            }
        }
    }

    pub fn serve(&self, label: &str, uri: &tauri::http::Uri) -> tauri::http::Response<Vec<u8>> {
        let content = (|| -> Option<(&str, Vec<u8>)> {
            let sessions = self.sessions.lock().unwrap();
            let session = sessions.get(label)?;
            let path = uri.path().strip_prefix(&format!("/{}/", session.token))?;
            if session.cancelled.is_cancelled() || !relative_path(path) {
                return None;
            }
            if path == "@background.html" {
                let product = session.product.as_ref()?;
                if !product.background {
                    return None;
                }
                let entry = product.manifest.echobird.background.as_ref()?;
                return Some(("text/html; charset=utf-8",format!("<!doctype html><meta charset=utf-8><script type=module src=\"/{}/{entry}\"></script>",session.token).into_bytes()));
            }
            let file = session.root.join(path).canonicalize().ok()?;
            if !file.starts_with(&session.root) || !file.is_file() {
                return None;
            }
            let mime = match file.extension()?.to_str()? {
                "html" => "text/html; charset=utf-8",
                "js" | "mjs" => "text/javascript",
                "css" => "text/css",
                "json" => "application/json",
                "svg" => "image/svg+xml",
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "webp" => "image/webp",
                "woff" => "font/woff",
                "woff2" => "font/woff2",
                _ => return None,
            };
            Some((mime, std::fs::read(file).ok()?))
        })();
        let (status, mime, body) = match content {
            Some((mime, body)) => (200, mime, body),
            None => (404, "text/plain", b"Not found".to_vec()),
        };
        tauri::http::Response::builder()
            .status(status)
            .header("Content-Type", mime)
            .header("Content-Security-Policy", CSP)
            .header("X-Content-Type-Options", "nosniff")
            .header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=(), display-capture=(), usb=(), serial=(), hid=(), bluetooth=()")
            .header("Cache-Control", "no-store")
            .header("Access-Control-Allow-Origin", "*")
            .body(body)
            .unwrap()
    }

    pub fn revoke(&self, app: &tauri::AppHandle, id: &str) {
        let _sync = self.product_sync.lock().unwrap();
        super::plugin_accounts::stop(id);
        self.workers.lock().unwrap().retain(|(plugin, _), token| {
            if plugin == id {
                token.cancel();
                false
            } else {
                true
            }
        });
        let labels: Vec<_> = self
            .sessions
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, session)| session.plugin_id == id)
            .map(|(label, _)| label.clone())
            .collect();
        for label in labels {
            self.close(&label);
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.close();
            }
        }
    }

    fn close(&self, label: &str) {
        if let Some(session) = self.sessions.lock().unwrap().remove(label) {
            session.cancelled.cancel();
        }
    }

    pub fn launch(
        &self,
        app: &tauri::AppHandle,
        manager: &PluginManager,
        plugin: InstalledPlugin,
        page_id: &str,
        model: Option<ModelConfig>,
    ) -> Result<(), String> {
        let generation = super::developer_preview::token()?;
        if !plugin.enabled {
            return Err("Plugin is disabled".into());
        }
        if !manager.list()?.iter().any(|current| {
            current.id == plugin.id
                && current.enabled
                && current.directory == plugin.directory
                && current.manifest == plugin.manifest
        }) {
            return Err("Plugin installation changed".into());
        }
        let root = manager.package_root(&plugin)?;
        let current = super::plugin_manager::manifest::Manifest::read(&root)?;
        if current != plugin.manifest {
            return Err("Installed plugin manifest changed".into());
        }
        let background = page_id == "@background";
        let (entry, title) = if background {
            (
                current
                    .echobird
                    .background
                    .as_ref()
                    .ok_or("Plugin has no background entry")?
                    .clone(),
                current.display_name.clone(),
            )
        } else {
            let page = current
                .echobird
                .contributes
                .pages
                .iter()
                .find(|page| page.id == page_id)
                .ok_or("Unknown plugin page")?;
            (page.entry.clone(), page.title.clone())
        };
        let token = uuid::Uuid::new_v4().to_string();
        let label = format!("plugin-{token}");
        let locale = crate::commands::settings_commands::get_settings()
            .locale
            .unwrap_or_default();
        let context = json!({"locale":locale, "modelName":model.as_ref().map(|m| &m.name), "pluginId":plugin.id,"commands":current.echobird.contributes.commands.iter().map(|c|&c.id).collect::<Vec<_>>(),"textProcessors":current.echobird.contributes.text_processors.iter().map(|p|&p.id).collect::<Vec<_>>()});
        let script = format!(
            r#"(() => {{
            const invoke = window.__TAURI_INTERNALS__.invoke;
            const context = Object.freeze({context});
            Object.defineProperty(window, 'echobird', {{ value: Object.freeze({{
                apiVersion: '0.1-draft', context, ...window.__echobirdProduct(invoke, context),
                generateText: (prompt) => invoke('plugin_model_request', {{ prompt }}),
                writeClipboardText: (text) => invoke('plugin_clipboard_write', {{ text }}),
                close: () => invoke('plugin_window_control', {{ action: 'close' }}),
                minimize: () => invoke('plugin_window_control', {{ action: 'minimize' }})
            }}), writable: false, configurable: false }});
        }})();"#
        );
        let script = format!("{}\n{script}", include_str!("plugin_runtime/product.js"));
        let session = Arc::new(Session {
            plugin_id: plugin.id,
            token: token.clone(),
            root,
            model,
            model_permission: current
                .echobird
                .permissions
                .iter()
                .any(|p| p == "model.request"),
            cancelled: CancellationToken::new(),
            clipboard_permission: current
                .echobird
                .permissions
                .iter()
                .any(|p| p == "clipboard.write"),
            busy: AtomicBool::new(false),
            product: Some(product::ProductSession::new(current.clone(), background)),
        });
        {
            let mut sessions = self.sessions.lock().unwrap();
            if generation.is_cancelled() {
                return Err("Developer preview is paused".into());
            }
            sessions.insert(label.clone(), session);
        }
        let url = url::Url::parse(&format!(
            "echobird-plugin://localhost/{token}/{}",
            if background {
                "@background.html"
            } else {
                &entry
            }
        ))
        .map_err(|e| e.to_string())?;
        let built =
            tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::CustomProtocol(url))
                .title(&title)
                .visible(!background)
                .focused(!background)
                .skip_taskbar(background)
                .inner_size(860.0, 680.0)
                .resizable(true)
                .incognito(true)
                .center()
                .initialization_script(&script)
                .on_navigation(move |url| allowed_navigation(url, &token))
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .on_download(|_, _| false)
                .build();
        match built {
            Ok(window) => {
                if generation.is_cancelled() {
                    self.close(&label);
                    let _ = window.close();
                    return Err("Developer preview is paused".into());
                }
                let handle = app.clone();
                let window_label = label.clone();
                window.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::Destroyed) {
                        handle.state::<PluginRuntime>().close(&window_label);
                    }
                });
                Ok(())
            }
            Err(error) => {
                self.close(&label);
                Err(format!("Could not open plugin: {error}"))
            }
        }
    }

    pub fn write_clipboard(
        &self,
        label: &str,
        text: &str,
        write: impl FnOnce(&str) -> Result<(), String>,
    ) -> Result<(), String> {
        if text.len() > 1024 * 1024 {
            return Err("Plugin clipboard text exceeds 1 MiB".into());
        }
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(label).ok_or("Plugin session is closed")?;
        if !session.clipboard_permission || session.cancelled.is_cancelled() {
            return Err("Plugin clipboard permission denied".into());
        }
        write(text)
    }

    pub async fn request(&self, label: &str, prompt: &str) -> Result<String, String> {
        if prompt.is_empty() || prompt.len() > 32 * 1024 {
            return Err("Plugin prompt must be 1–32768 bytes".into());
        }
        let session = self
            .sessions
            .lock()
            .unwrap()
            .get(label)
            .cloned()
            .ok_or("Plugin session is closed")?;
        if !session.model_permission || session.cancelled.is_cancelled() {
            return Err("Plugin model permission denied".into());
        }
        let model = session
            .model
            .as_ref()
            .ok_or("Select a model before starting this plugin")?;
        if session.busy.swap(true, Ordering::AcqRel) {
            return Err("A plugin model request is already pending".into());
        }
        struct Reset<'a>(&'a AtomicBool);
        impl Drop for Reset<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::Release);
            }
        }
        let _reset = Reset(&session.busy);
        tokio::select! {
            _ = session.cancelled.cancelled() => Err("Plugin session was closed".into()),
            result = tokio::time::timeout(Duration::from_secs(60), complete(model, prompt)) => result.map_err(|_| "Plugin model request timed out".to_string())?,
        }
    }
}

async fn complete(model: &ModelConfig, prompt: &str) -> Result<String, String> {
    let anthropic = model.base_url.trim().is_empty();
    let base = if anthropic {
        model.anthropic_url.as_deref().unwrap_or("")
    } else {
        &model.base_url
    }
    .trim()
    .trim_end_matches('/');
    let mut url = url::Url::parse(base).map_err(|_| "Invalid selected model endpoint")?;
    if !["http", "https"].contains(&url.scheme()) || url.host_str().is_none() {
        return Err("Invalid selected model endpoint".into());
    }
    let path = url.path().trim_end_matches('/').to_string();
    if anthropic {
        if !path.ends_with("/messages") {
            url.set_path(&format!(
                "{path}/{}",
                if path.ends_with("/v1") {
                    "messages"
                } else {
                    "v1/messages"
                }
            ));
        }
    } else if !path.ends_with("/chat/completions") {
        url.set_path(&format!("{path}/chat/completions"));
    }
    let bearer = !anthropic
        || url
            .domain()
            .is_some_and(|host| host == "xiaomimimo.com" || host.ends_with(".xiaomimimo.com"));
    let key = super::model_manager::decrypt_key_for_use(&model.api_key);
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client.post(url).json(&json!({
        "model": model.model_id.as_deref().unwrap_or(&model.name),
        "messages": [{"role":"user", "content":prompt}], "max_tokens":1024, "stream":false
    }));
    request = if !bearer {
        request
            .header("x-api-key", &key)
            .header("anthropic-version", "2023-06-01")
    } else {
        request.bearer_auth(&key)
    };
    let mut response = request
        .send()
        .await
        .map_err(|_| "Could not reach the selected model")?;
    if !response.status().is_success() {
        return Err(format!(
            "Selected model returned HTTP {}",
            response.status().as_u16()
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read model response")?
    {
        if bytes.len() + chunk.len() > 1024 * 1024 {
            return Err("Model response exceeds limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body: Value = serde_json::from_slice(&bytes).map_err(|_| "Invalid model response")?;
    let text = if anthropic {
        body["content"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|item| item["type"] == "text")
            .filter_map(|item| item["text"].as_str())
            .collect::<String>()
    } else {
        body["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string()
    };
    if text.trim().is_empty() {
        return Err("Selected model returned no text".into());
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pausing_cancels_all_sessions_and_does_not_restore_them() {
        let runtime = PluginRuntime::default();
        let token = CancellationToken::new();
        runtime.sessions.lock().unwrap().insert(
            "plugin-fixture".into(),
            Arc::new(Session {
                plugin_id: "fixture.game".into(),
                token: "fixture".into(),
                root: PathBuf::new(),
                model: None,
                model_permission: true,
                clipboard_permission: false,
                cancelled: token.clone(),
                busy: AtomicBool::new(false),
                product: None,
            }),
        );
        assert!(!token.is_cancelled());
        assert_eq!(runtime.pause_sessions(), vec!["plugin-fixture"]);
        assert!(token.is_cancelled());
        assert!(runtime.sessions.lock().unwrap().is_empty());
        assert!(runtime.pause_sessions().is_empty());
    }

    #[test]
    fn plugin_windows_cannot_invoke_application_or_system_commands() {
        for command in [
            "get_models",
            "get_settings",
            "save_settings",
            "plugin_preview",
            "plugin_install",
            "plugin:shell|open",
            "plugin:clipboard-manager|read_text",
            "plugin:clipboard-manager|write_text",
        ] {
            assert!(!allowed_command("plugin-test", command), "{command}");
            assert!(allowed_command("main", command));
        }
        assert!(allowed_command("plugin-test", "plugin_model_request"));
        assert!(allowed_command("plugin-test", "plugin_window_control"));
        assert!(allowed_command("plugin-test", "plugin_clipboard_write"));
    }

    #[test]
    fn clipboard_writes_require_a_live_declared_session_and_enforce_the_limit() {
        let runtime = PluginRuntime::default();
        let copied = Mutex::new(Vec::new());
        let write = |text: &str| {
            copied.lock().unwrap().push(text.to_string());
            Ok(())
        };
        assert!(runtime.write_clipboard("main", "denied", write).is_err());
        for permission in [false, true] {
            let session = Arc::new(Session {
                plugin_id: "fixture.translator".into(),
                token: "fixture".into(),
                root: PathBuf::new(),
                model: None,
                model_permission: false,
                clipboard_permission: permission,
                cancelled: CancellationToken::new(),
                busy: AtomicBool::new(false),
                product: None,
            });
            runtime
                .sessions
                .lock()
                .unwrap()
                .insert("plugin-fixture".into(), session.clone());
            let result = runtime.write_clipboard("plugin-fixture", "译文", write);
            assert_eq!(result.is_ok(), permission);
            assert!(runtime
                .write_clipboard("plugin-fixture", &"a".repeat(1024 * 1024 + 1), write)
                .is_err());
            session.cancelled.cancel();
            assert!(runtime
                .write_clipboard("plugin-fixture", "cancelled", write)
                .is_err());
        }
        runtime.pause_sessions();
        assert!(runtime
            .write_clipboard("plugin-fixture", "closed", write)
            .is_err());
        assert_eq!(*copied.lock().unwrap(), vec!["译文"]);
    }

    #[test]
    fn plugin_navigation_stays_in_its_session() {
        for url in [
            "echobird-plugin://localhost/test/ui/index.html",
            "http://echobird-plugin.localhost/test/ui/index.html",
        ] {
            assert!(allowed_navigation(&url::Url::parse(url).unwrap(), "test"));
        }
        for url in [
            "https://example.com/test/",
            "http://tauri.localhost/test/",
            "echobird-plugin://localhost/other/ui/index.html",
            "echobird-plugin://localhost/test/../package.json",
        ] {
            assert!(!allowed_navigation(&url::Url::parse(url).unwrap(), "test"));
        }
    }

    #[tokio::test]
    async fn plugin_model_permission_uses_only_selected_model_and_cancels_pending_requests() {
        use axum::{extract::State, routing::post, Json};
        use std::sync::atomic::AtomicUsize;
        let calls = Arc::new(AtomicUsize::new(0));
        let started = Arc::new(tokio::sync::Notify::new());
        let signal = started.clone();
        let router = axum::Router::new()
            .route(
                "/v1/chat/completions",
                post(
                    move |State(calls): State<Arc<AtomicUsize>>,
                          headers: axum::http::HeaderMap,
                          Json(body): Json<Value>| {
                        let signal = signal.clone();
                        async move {
                            assert_eq!(headers["authorization"], "Bearer fixture-key");
                            assert_eq!(body["model"], "selected-model");
                            calls.fetch_add(1, Ordering::SeqCst);
                            if body["messages"][0]["content"] == "wait" {
                                signal.notify_one();
                                std::future::pending::<()>().await;
                            }
                            Json(json!({"choices":[{"message":{"content":"3,2\nA move"}}]}))
                        }
                    },
                ),
            )
            .with_state(calls.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/v1", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let runtime = PluginRuntime::default();
        let model = serde_json::from_value(json!({"internalId":"fixture", "name":"Fixture", "modelId":"selected-model", "baseUrl":base, "apiKey":"fixture-key"})).unwrap();
        let session = Arc::new(Session {
            plugin_id: "fixture.game".into(),
            token: "fixture".into(),
            root: PathBuf::new(),
            model: Some(model),
            model_permission: true,
            clipboard_permission: false,
            cancelled: CancellationToken::new(),
            busy: AtomicBool::new(false),
            product: None,
        });
        assert!(runtime
            .request("plugin-fixture", "no session")
            .await
            .is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        runtime.sessions.lock().unwrap().insert(
            "plugin-denied".into(),
            Arc::new(Session {
                plugin_id: "fixture.denied".into(),
                token: "denied".into(),
                root: PathBuf::new(),
                model: None,
                model_permission: false,
                clipboard_permission: false,
                cancelled: CancellationToken::new(),
                busy: AtomicBool::new(false),
                product: None,
            }),
        );
        assert!(runtime
            .request("plugin-denied", "must not call model")
            .await
            .unwrap_err()
            .contains("permission"));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        runtime
            .sessions
            .lock()
            .unwrap()
            .insert("plugin-fixture".into(), session.clone());
        assert_eq!(
            runtime.request("plugin-fixture", "play").await.unwrap(),
            "3,2\nA move"
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        let cancel = async {
            started.notified().await;
            assert!(runtime
                .request("plugin-fixture", "duplicate")
                .await
                .is_err());
            session.cancelled.cancel();
        };
        let (result, ()) = tokio::join!(runtime.request("plugin-fixture", "wait"), cancel);
        assert!(result.unwrap_err().contains("closed"));
        assert!(runtime
            .request("plugin-fixture", "after close")
            .await
            .is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        runtime.close("plugin-fixture");
        assert_eq!(
            runtime
                .serve("plugin-fixture", &"/fixture/ui/index.html".parse().unwrap())
                .status(),
            404
        );
        server.abort();
    }

    #[tokio::test]
    async fn plugin_model_requests_keep_custom_paths_queries_and_complete_endpoints() {
        use axum::{routing::post, Json};
        let router = axum::Router::new()
            .route(
                "/proxy/chat/completions",
                post(
                    |headers: axum::http::HeaderMap, uri: axum::http::Uri| async move {
                        assert_eq!(headers["authorization"], "Bearer fixture-key");
                        if let Some(query) = uri.query() {
                            assert_eq!(query, "case=preserved");
                        }
                        Json(json!({"choices":[{"message":{"content":"proxy-ok"}}]}))
                    },
                ),
            )
            .route(
                "/anthropic/v1/messages",
                post(|headers: axum::http::HeaderMap| async move {
                    assert_eq!(headers["x-api-key"], "fixture-key");
                    assert_eq!(headers["anthropic-version"], "2023-06-01");
                    Json(json!({"content":[{"type":"text","text":"messages-ok"}]}))
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let root = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        for (path, anthropic) in [
            ("/proxy", false),
            ("/proxy?case=preserved", false),
            ("/proxy/chat/completions", false),
            ("/anthropic", true),
            ("/anthropic/v1", true),
            ("/anthropic/v1/messages", true),
        ] {
            let address = format!("{root}{path}");
            let model = serde_json::from_value(json!({"internalId":"fixture", "name":"Fixture", "modelId":"selected-model", "baseUrl":if anthropic { "" } else { &address }, "anthropicUrl":if anthropic { Some(&address) } else { None }, "apiKey":"fixture-key"})).unwrap();
            assert_eq!(
                complete(&model, "A fixture prompt").await.unwrap(),
                if anthropic { "messages-ok" } else { "proxy-ok" },
                "{path}"
            );
        }
        server.abort();
    }
}
