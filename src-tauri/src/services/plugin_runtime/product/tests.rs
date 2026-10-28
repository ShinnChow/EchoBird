use super::*;

fn manifest() -> Manifest {
    serde_json::from_value(json!({"name":"product","publisher":"fixture","version":"1.0.0","displayName":"Product","description":"SDK fixture","license":"MIT","repository":"https://example.com/product",
        "echobird":{"manifestVersion":1,"apiVersion":"0.1-draft","platforms":["windows","macos","linux"],"permissions":["configuration","storage","commands","events","text.process","extension.background"],"background":"background.mjs","contributes":{"pages":[],"configuration":[{"key":"enabled","title":"Enabled","type":"boolean","default":true},{"key":"mode","title":"Mode","type":"string","default":"a","options":["a","b"]}],"commands":[{"id":"format","title":"Format"}],"textProcessors":[{"id":"clean","title":"Clean","stage":"voice.output"}]}}})).unwrap()
}
struct Fixture {
    root: PathBuf,
    manager: PluginManager,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("echobird-sdk-{}", uuid::Uuid::new_v4()));
        Self {
            manager: PluginManager::new(root.join("plugins")),
            root,
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        if self.root.exists() {
            assert!(self.root.starts_with(std::env::temp_dir()));
            std::fs::remove_dir_all(&self.root).unwrap();
        }
    }
}
fn session(plugin: &str) -> Arc<Session> {
    Arc::new(Session {
        plugin_id: plugin.into(),
        token: "fixture".into(),
        root: PathBuf::new(),
        model: None,
        model_permission: false,
        clipboard_permission: false,
        cancelled: CancellationToken::new(),
        busy: AtomicBool::new(false),
        product: Some(ProductSession::new(manifest(), true)),
    })
}
#[test]
fn missing_data_reads_do_not_create_directories_and_config_defaults_are_effective() {
    let f = Fixture::new();
    let settings = configuration(&f.manager, &manifest()).unwrap();
    assert_eq!(settings["enabled"], true);
    assert_eq!(settings["mode"], "a");
    assert!(read::<Preferences>(&file(&f.manager, "host").unwrap())
        .unwrap()
        .processors
        .is_empty());
    assert!(!f.root.exists());
    for id in [
        "../outside",
        "host/../x",
        "fixture.other/../x",
        "fixture",
        "fixture.a.b",
    ] {
        assert!(file(&f.manager, id).is_err());
    }
}
#[test]
fn configuration_validation_preserves_private_storage_and_invalid_updates_are_atomic() {
    let f = Fixture::new();
    let m = manifest();
    let path = file(&f.manager, &m.id()).unwrap();
    let mut data = Data::default();
    data.storage.insert("counter".into(), json!(7));
    write(&path, &data).unwrap();
    update_configuration(&f.manager, &m, "enabled", Some(json!(false))).unwrap();
    update_configuration(&f.manager, &m, "mode", Some(json!("b"))).unwrap();
    let before = std::fs::read(&path).unwrap();
    assert!(update_configuration(&f.manager, &m, "enabled", Some(json!("false"))).is_err());
    assert!(update_configuration(&f.manager, &m, "mode", Some(json!("c"))).is_err());
    assert!(update_configuration(&f.manager, &m, "unknown", Some(json!(true))).is_err());
    assert_eq!(before, std::fs::read(&path).unwrap());
    assert_eq!(configuration(&f.manager, &m).unwrap()["enabled"], false);
    update_configuration(&f.manager, &m, "enabled", None).unwrap();
    assert_eq!(configuration(&f.manager, &m).unwrap()["enabled"], true);
    assert_eq!(read::<Data>(&path).unwrap().storage["counter"], 7);
    let mut newer = m.clone();
    newer.echobird.contributes.configuration[1].options = vec![json!("a")];
    assert_eq!(configuration(&f.manager, &newer).unwrap()["mode"], "a");
    let reopened = PluginManager::new(f.manager.root.clone());
    assert_eq!(configuration(&reopened, &m).unwrap()["mode"], "b");
    assert!(read::<Data>(&file(&f.manager, "fixture.other").unwrap())
        .unwrap()
        .storage
        .is_empty());
}
#[test]
fn data_limit_includes_json_formatting_and_preserves_previous_file() {
    let f = Fixture::new();
    let path = file(&f.manager, "fixture.product").unwrap();
    write(&path, &json!({"ok":true})).unwrap();
    let before = std::fs::read(&path).unwrap();
    let oversized = json!((0..150000).collect::<Vec<_>>());
    assert!(serde_json::to_vec(&oversized).unwrap().len() < 1024 * 1024);
    assert!(write(&path, &oversized).is_err());
    assert_eq!(before, std::fs::read(path).unwrap());
}
#[tokio::test]
async fn result_nonces_are_bound_to_the_owning_session_and_reject_late_responses() {
    let runtime = PluginRuntime::default();
    let owner = session("fixture.product");
    runtime
        .sessions
        .lock()
        .unwrap()
        .insert("owner".into(), owner.clone());
    runtime
        .sessions
        .lock()
        .unwrap()
        .insert("other".into(), session("fixture.other"));
    let (sender, receiver) = oneshot::channel();
    runtime.pending.lock().unwrap().insert(
        "nonce".into(),
        Pending {
            label: "owner".into(),
            sender,
        },
    );
    assert!(runtime
        .product_result("other", "nonce", json!("forged"), None)
        .is_err());
    assert!(runtime
        .product_result("owner", "nonce", json!("ok"), None)
        .is_ok());
    assert_eq!(receiver.await.unwrap().unwrap(), "ok");
    assert!(runtime
        .product_result("owner", "nonce", json!("late"), None)
        .is_err());
    owner.cancelled.cancel();
    assert!(runtime
        .product_result("owner", "new", Value::Null, None)
        .is_err());
}
#[test]
fn declared_permissions_and_event_namespaces_are_enforced() {
    let mut m = manifest();
    m.echobird.permissions.clear();
    let product = ProductSession::new(m, false);
    for permission in super::super::super::plugin_manager::product::PERMISSIONS {
        assert!(product.permits(permission).is_err());
    }
    for topic in ["echo.configuration.changed", "fixture.product.processed"] {
        assert!(valid_topic(topic));
    }
    for topic in [
        "echo..changed",
        "Echo.changed",
        "../x",
        "echo.under_score",
        "",
    ] {
        assert!(!valid_topic(topic));
    }
}
#[cfg(unix)]
#[test]
fn private_data_refuses_directory_and_file_links() {
    use std::os::unix::fs::symlink;
    let f = Fixture::new();
    std::fs::create_dir_all(&f.manager.root).unwrap();
    let outside = f.root.join("outside");
    std::fs::create_dir(&outside).unwrap();
    symlink(&outside, f.manager.root.join("data")).unwrap();
    assert!(file(&f.manager, "host").is_err());
    std::fs::remove_file(f.manager.root.join("data")).unwrap();
    std::fs::create_dir(f.manager.root.join("data")).unwrap();
    std::fs::write(outside.join("secret"), "{} ").unwrap();
    symlink(
        outside.join("secret"),
        f.manager.root.join("data/host.json"),
    )
    .unwrap();
    assert!(file(&f.manager, "host").is_err());
}

#[cfg(all(target_os = "windows", feature = "sdk-native-tests"))]
#[test]
#[ignore = "Opens an isolated hidden native WebView; run explicitly on Windows"]
fn native_product_sdk_command_hook_and_revocation() {
    let fixture = Fixture::new();
    let source = fixture.root.join("source");
    std::fs::create_dir_all(&source).unwrap();
    let mut m = manifest();
    m.echobird
        .contributes
        .commands
        .push(crate::services::plugin_manager::product::Command {
            id: "slow".into(),
            title: "Slow".into(),
            page_id: None,
        });
    std::fs::write(source.join("package.json"), serde_json::to_vec(&m).unwrap()).unwrap();
    std::fs::write(
        source.join("background.mjs"),
        r#"
const host=window.echobird;
host.commands.register('format',async ({text})=>{
  const settings=await host.configuration.get();
  const count=await host.storage.get('count');
  await host.storage.set('count',(count??0)+1);
  return settings.mode+':'+text.trim();
});
host.commands.register('slow',(_, {signal})=>new Promise((resolve,reject)=>{
  signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});
}));
host.text.register('clean',({text})=>text.trim().replace(/ +/g,' '));
"#,
    )
    .unwrap();
    let outcome: Arc<Mutex<Option<Result<(), String>>>> = Arc::default();
    let completed = outcome.clone();
    let input = source.to_string_lossy().into_owned();
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = "com.echobird.sdk-fixture".into();
    let app = tauri::Builder::default()
        .any_thread()
        .manage(PluginRuntime::default())
        .manage(PluginManager::new(fixture.manager.root.clone()))
        .register_uri_scheme_protocol("echobird-plugin", |context, request| {
            context
                .app_handle()
                .state::<PluginRuntime>()
                .serve(context.webview_label(), request.uri())
        })
        .invoke_handler(super::super::guard(tauri::generate_handler![
            crate::commands::plugin_commands::plugin_host_call,
            crate::commands::plugin_commands::plugin_host_result
        ]))
        .setup(move |app| {
            crate::services::developer_preview::configure(app.handle(), true);
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let result =
                    tokio::time::timeout(Duration::from_secs(45), native_flow(&handle, &input))
                        .await
                        .map_err(|_| "Native SDK fixture timed out".to_owned())
                        .and_then(|v| v);
                *completed.lock().unwrap() = Some(result);
                handle.exit(0);
            });
            Ok(())
        })
        .build(context)
        .unwrap();
    let handle = app.handle().clone();
    let watchdog = outcome.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(60));
        if watchdog.lock().unwrap().is_none() {
            handle.exit(2);
        }
    });
    app.run_return(|_, event| {
        if let tauri::RunEvent::ExitRequested {
            code: None, api, ..
        } = event
        {
            api.prevent_exit();
        }
    });
    let result = outcome
        .lock()
        .unwrap()
        .take()
        .expect("Native fixture did not finish");
    assert_eq!(result, Ok(()));
}
#[cfg(all(target_os = "windows", feature = "sdk-native-tests"))]
async fn native_flow(app: &tauri::AppHandle, source: &str) -> Result<(), String> {
    let manager = app.state::<PluginManager>();
    let runtime = app.state::<PluginRuntime>();
    let candidate = manager
        .preview(
            "directory",
            source,
            "international",
            CancellationToken::new(),
        )
        .await?;
    manager.install(&candidate.token)?;
    let state = runtime.product_state(app, &manager)?;
    if state.configuration["fixture.product"]["enabled"] != true {
        return Err("Configuration defaults missing".into());
    }
    runtime.manage_product(
        app,
        &manager,
        Some("fixture.product"),
        "configuration",
        "mode",
        json!("b"),
    )?;
    let result = runtime
        .execute_product(
            app,
            &manager,
            "fixture.product",
            "format",
            json!({"text":" hello "}),
        )
        .await?;
    if result != "b:hello" {
        return Err(format!("Unexpected command result: {result}"));
    }
    runtime.manage_product(
        app,
        &manager,
        Some("fixture.product"),
        "processor",
        "clean",
        json!(true),
    )?;
    if runtime
        .process_text(app, "voice.output", "  one   two  ")
        .await?
        != "one two"
    {
        return Err("Text hook was not applied".into());
    }
    let data = file(&manager, "fixture.product")?;
    if read::<Data>(&data)?.storage["count"] != 1 {
        return Err("Private data was not saved".into());
    }
    let pending = runtime.execute_product(app, &manager, "fixture.product", "slow", Value::Null);
    tokio::pin!(pending);
    tokio::select! {result=&mut pending=>return Err(format!("Slow command completed early: {result:?}")),_=tokio::time::sleep(Duration::from_millis(150))=>{}}
    manager.set_enabled("fixture.product", false)?;
    runtime.revoke(app, "fixture.product");
    if pending.await.is_ok() {
        return Err("Revoked command still completed".into());
    }
    if runtime.background_label("fixture.product").is_some() {
        return Err("Revoked background session survived".into());
    }
    if runtime
        .process_text(app, "voice.output", "  unchanged  ")
        .await?
        != "  unchanged  "
    {
        return Err("Disabled hook still ran".into());
    }
    manager.uninstall("fixture.product")?;
    if read::<Data>(&data)?.storage["count"] != 1 {
        return Err("Uninstall removed private data".into());
    }
    runtime.pause(app);
    Ok(())
}
