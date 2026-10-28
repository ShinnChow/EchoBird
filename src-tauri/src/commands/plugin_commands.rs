use crate::{
    models::model::ModelConfig,
    services::{
        plugin_manager::{self, Candidate, InstalledPlugin, PluginManager, Registry},
        plugin_runtime::PluginRuntime,
    },
};
use tauri::Manager;

fn main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Plugin management is available only in the main window".into())
    }
}

#[tauri::command]
pub fn plugin_list(
    window: tauri::WebviewWindow,
    manager: tauri::State<'_, PluginManager>,
) -> Result<Vec<InstalledPlugin>, String> {
    main_window(&window)?;
    manager.list()
}

#[tauri::command]
pub async fn plugin_registry(
    window: tauri::WebviewWindow,
    region: String,
    refresh: bool,
) -> Result<Registry, String> {
    main_window(&window)?;
    crate::services::developer_preview::run(plugin_manager::registry(&region, refresh)).await
}

#[tauri::command]
pub async fn plugin_preview(
    window: tauri::WebviewWindow,
    manager: tauri::State<'_, PluginManager>,
    kind: String,
    value: String,
    region: String,
) -> Result<Candidate, String> {
    main_window(&window)?;
    let cancelled = crate::services::developer_preview::token()?;
    manager.preview(&kind, &value, &region, cancelled).await
}

#[tauri::command]
pub fn plugin_cancel(
    window: tauri::WebviewWindow,
    manager: tauri::State<'_, PluginManager>,
    token: String,
) -> Result<(), String> {
    main_window(&window)?;
    manager.cancel(&token)
}

#[tauri::command]
pub fn plugin_install(
    window: tauri::WebviewWindow,
    manager: tauri::State<'_, PluginManager>,
    runtime: tauri::State<'_, PluginRuntime>,
    token: String,
) -> Result<Vec<InstalledPlugin>, String> {
    main_window(&window)?;
    let plugins = crate::services::developer_preview::with_enabled(|| manager.install(&token))?;
    if let Some(plugin) = plugins.last() {
        runtime.revoke(window.app_handle(), &plugin.id);
    }
    Ok(plugins)
}

#[tauri::command]
pub fn plugin_set_enabled(
    window: tauri::WebviewWindow,
    manager: tauri::State<'_, PluginManager>,
    runtime: tauri::State<'_, PluginRuntime>,
    id: String,
    enabled: bool,
) -> Result<Vec<InstalledPlugin>, String> {
    main_window(&window)?;
    let plugins =
        crate::services::developer_preview::with_enabled(|| manager.set_enabled(&id, enabled))?;
    if !enabled {
        runtime.revoke(window.app_handle(), &id);
    }
    Ok(plugins)
}

#[tauri::command]
pub fn plugin_uninstall(
    window: tauri::WebviewWindow,
    manager: tauri::State<'_, PluginManager>,
    runtime: tauri::State<'_, PluginRuntime>,
    id: String,
) -> Result<Vec<InstalledPlugin>, String> {
    main_window(&window)?;
    let plugins = crate::services::developer_preview::with_enabled(|| manager.uninstall(&id))?;
    runtime.revoke(window.app_handle(), &id);
    Ok(plugins)
}

#[tauri::command]
pub async fn plugin_account_operation(
    window: tauri::WebviewWindow,
    manager: tauri::State<'_, PluginManager>,
    runtime: tauri::State<'_, PluginRuntime>,
    id: String,
    provider_id: String,
    operation: String,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    main_window(&window)?;
    runtime
        .account_operation(&manager, &id, &provider_id, &operation, params)
        .await
}

#[tauri::command]
pub async fn plugin_launch(
    window: tauri::WebviewWindow,
    manager: tauri::State<'_, PluginManager>,
    runtime: tauri::State<'_, PluginRuntime>,
    id: String,
    page_id: String,
    model: Option<ModelConfig>,
) -> Result<(), String> {
    main_window(&window)?;
    let plugin = manager
        .list()?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or("Plugin is not installed")?;
    runtime.launch(window.app_handle(), &manager, plugin, &page_id, model)
}

#[tauri::command]
pub async fn plugin_sdk_state(
    window: tauri::WebviewWindow,
    manager: tauri::State<'_, PluginManager>,
    runtime: tauri::State<'_, PluginRuntime>,
) -> Result<crate::services::plugin_runtime::product::ProductState, String> {
    main_window(&window)?;
    crate::services::developer_preview::run(async {
        runtime.product_state(window.app_handle(), &manager)
    })
    .await
}
#[tauri::command]
pub fn plugin_sdk_manage(
    window: tauri::WebviewWindow,
    manager: tauri::State<'_, PluginManager>,
    runtime: tauri::State<'_, PluginRuntime>,
    id: Option<String>,
    action: String,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    main_window(&window)?;
    crate::services::developer_preview::with_enabled(|| {
        runtime.manage_product(
            window.app_handle(),
            &manager,
            id.as_deref(),
            &action,
            &key,
            value,
        )
    })
}
#[tauri::command]
pub async fn plugin_sdk_execute(
    window: tauri::WebviewWindow,
    manager: tauri::State<'_, PluginManager>,
    runtime: tauri::State<'_, PluginRuntime>,
    id: String,
    command: String,
    input: serde_json::Value,
) -> Result<serde_json::Value, String> {
    main_window(&window)?;
    crate::services::developer_preview::run(runtime.execute_product(
        window.app_handle(),
        &manager,
        &id,
        &command,
        input,
    ))
    .await
}
#[tauri::command]
pub async fn plugin_host_call(
    window: tauri::WebviewWindow,
    manager: tauri::State<'_, PluginManager>,
    runtime: tauri::State<'_, PluginRuntime>,
    operation: String,
    input: serde_json::Value,
) -> Result<serde_json::Value, String> {
    crate::services::developer_preview::run(runtime.host_call(
        window.app_handle(),
        &manager,
        window.label(),
        &operation,
        input,
    ))
    .await
}
#[tauri::command]
pub fn plugin_host_result(
    window: tauri::WebviewWindow,
    runtime: tauri::State<'_, PluginRuntime>,
    id: String,
    value: serde_json::Value,
    error: Option<String>,
) -> Result<(), String> {
    crate::services::developer_preview::with_enabled(|| {
        runtime.product_result(window.label(), &id, value, error)
    })
}

#[tauri::command]
pub async fn plugin_model_request(
    window: tauri::WebviewWindow,
    runtime: tauri::State<'_, PluginRuntime>,
    prompt: String,
) -> Result<String, String> {
    crate::services::developer_preview::run(runtime.request(window.label(), &prompt)).await
}

#[tauri::command]
pub fn plugin_clipboard_write(
    window: tauri::WebviewWindow,
    runtime: tauri::State<'_, PluginRuntime>,
    text: String,
) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    crate::services::developer_preview::with_enabled(|| {
        runtime.write_clipboard(window.label(), &text, |value| {
            window
                .app_handle()
                .clipboard()
                .write_text(value)
                .map_err(|e| e.to_string())
        })
    })
}

#[tauri::command]
pub fn plugin_window_control(window: tauri::WebviewWindow, action: String) -> Result<(), String> {
    if !window.label().starts_with("plugin-") {
        return Err("Not a plugin window".into());
    }
    match action.as_str() {
        "close" => window.close(),
        "minimize" => window.minimize(),
        _ => return Err("Unknown plugin window action".into()),
    }
    .map_err(|e| e.to_string())
}
