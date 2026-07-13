// Tauri Commands for model operations �?exposed to frontend via invoke()

use crate::models::model::{ModelConfig, PingResult, TestResult};
use crate::services::model_manager::{self, AddModelInput, UpdateModelInput};
use crate::services::usage_providers::{self, UsageResult};

/// Get all models (user + built-in + local)
#[tauri::command]
pub fn get_models() -> Vec<ModelConfig> {
    model_manager::get_models()
}

/// Add a new model
#[tauri::command]
pub fn add_model(input: AddModelInput) -> ModelConfig {
    model_manager::add_model(input)
}

/// Delete a model by internal ID
#[tauri::command]
pub fn delete_model(internal_id: String) -> bool {
    model_manager::delete_model(&internal_id)
}

/// Update a model
#[tauri::command]
pub fn update_model(internal_id: String, updates: UpdateModelInput) -> Option<ModelConfig> {
    model_manager::update_model(&internal_id, updates)
}

/// Test model with API request
#[tauri::command]
pub async fn test_model(
    internal_id: String,
    prompt: String,
    protocol: String,
) -> Result<TestResult, String> {
    Ok(model_manager::test_model(&internal_id, &prompt, &protocol).await)
}

/// Ping model server
#[tauri::command]
pub async fn ping_model(internal_id: String) -> Result<PingResult, String> {
    Ok(model_manager::ping_model(&internal_id).await)
}

/// Check if encrypted key is destroyed
#[tauri::command]
pub fn is_key_destroyed(internal_id: String) -> bool {
    model_manager::is_key_destroyed(&internal_id)
}

/// Query model usage (quota/balance)
#[tauri::command]
pub async fn query_model_usage(internal_id: String) -> Result<UsageResult, String> {
    let models = model_manager::get_models();
    let model = models
        .iter()
        .find(|m| m.internal_id == internal_id)
        .ok_or_else(|| format!("Model not found: {}", internal_id))?;

    // Determine base_url and api_key
    let base_url = if !model.base_url.is_empty() {
        &model.base_url
    } else if let Some(ref url) = model.anthropic_url {
        url
    } else {
        return Err("Model has no base URL configured".to_string());
    };

    let api_key = model_manager::decrypt_key_for_use(&model.api_key);

    // Query usage from provider
    usage_providers::query_model_usage(base_url, &api_key).await
}
