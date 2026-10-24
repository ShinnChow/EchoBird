//! Expand only an explicitly applied Smart Access model into native picker rows.
use super::ModelInfo;
use crate::services::smart_router::catalog::{self, SwitchModel};
use serde_json::{json, Value};

#[cfg(test)]
pub(super) struct TestDir(std::path::PathBuf);
#[cfg(test)]
impl TestDir {
    pub(super) fn new() -> Self {
        let path = std::env::temp_dir().join(format!("echobird-switch-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
    pub(super) fn path(&self) -> &std::path::Path {
        &self.0
    }
}
#[cfg(test)]
impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[cfg(test)]
pub(super) fn test_info() -> ModelInfo {
    serde_json::from_value(json!({"model":"auto","name":"Auto Router",
        "baseUrl":"http://127.0.0.1:53683/v1","apiKey":"fixture-key","protocol":"openai"}))
    .unwrap()
}

pub(super) fn models(info: &ModelInfo) -> Result<Vec<SwitchModel>, String> {
    catalog::models_for_url(
        info.base_url
            .as_deref()
            .or(info.anthropic_url.as_deref())
            .unwrap_or(""),
    )
}

pub(super) fn model_map(info: &ModelInfo, entries: &mut Value) -> Result<(), String> {
    let models = models(info)?;
    if models.is_empty() {
        return Ok(());
    }
    let id = info.model.as_deref().unwrap_or("");
    let template = entries[id].clone();
    let entries = entries.as_object_mut().ok_or("Invalid native model map")?;
    entries.retain(|id, _| !id.starts_with(catalog::SELECTOR_PREFIX));
    for model in models {
        let mut entry = template.clone();
        entry["name"] = json!(model.name);
        entries.insert(model.id, entry);
    }
    Ok(())
}

pub(super) fn model_array(
    info: &ModelInfo,
    entries: &mut Value,
    id_key: &str,
    name_key: &str,
) -> Result<(), String> {
    let models = models(info)?;
    if models.is_empty() {
        return Ok(());
    }
    let id = info.model.as_deref().unwrap_or("");
    let entries = entries.as_array_mut().ok_or("Invalid native model list")?;
    let template = entries
        .iter()
        .find(|entry| entry[id_key] == id)
        .cloned()
        .ok_or("Selected native model is missing")?;
    entries.retain(|entry| {
        !(entry[id_key]
            .as_str()
            .is_some_and(|id| id.starts_with(catalog::SELECTOR_PREFIX))
            && entry.get("url") == template.get("url"))
    });
    let position = entries
        .iter()
        .position(|entry| entry == &template)
        .unwrap_or(entries.len());
    for (offset, model) in models
        .into_iter()
        .filter(|model| model.id != id)
        .enumerate()
    {
        let mut entry = template.clone();
        entry[id_key] = json!(model.id);
        entry[name_key] = json!(model.name);
        entries.insert(position + 1 + offset, entry);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smart_picker_expansion_preserves_templates_and_direct_models() {
        catalog::with_test_models(|| {
            let info = test_info();
            let mut entries = json!({"auto":{"name":"Auto","custom":true,"limit":{"output":123}},"manual":{"keep":true}});
            model_map(&info, &mut entries).unwrap();
            let first = catalog::selector("first");
            assert_eq!(entries[&first]["name"], "First model");
            assert_eq!(entries[&first]["limit"]["output"], 123);
            assert_eq!(entries["manual"]["keep"], true);
            let mut direct = info.clone();
            direct.base_url = Some("https://direct.invalid/v1".into());
            let original = json!({"auto":{"name":"Direct"}});
            let mut entries = original.clone();
            model_map(&direct, &mut entries).unwrap();
            assert_eq!(entries, original);
            assert!(models(&direct).unwrap().is_empty());
        });
    }

    #[test]
    fn native_arrays_refresh_only_this_endpoint_and_keep_auto_first() {
        catalog::with_test_models(|| {
            let mut entries = json!([
                {"id":"manual","url":"other","name":"Keep"},
                {"id":catalog::selector("retired"),"url":"router","name":"Gone"},
                {"id":catalog::selector("foreign"),"url":"other","name":"Other router"},
                {"id":"auto","url":"router","supportsImages":false,"name":"Auto"}
            ]);
            for _ in 0..2 {
                model_array(&test_info(), &mut entries, "id", "name").unwrap();
            }
            let entries = entries.as_array().unwrap();
            assert_eq!(entries.len(), 5);
            assert_eq!(entries[0]["name"], "Keep");
            assert_eq!(entries[1]["name"], "Other router");
            assert_eq!(entries[2]["id"], "auto");
            assert_eq!(entries[3]["name"], "First model");
            assert_eq!(entries[4]["supportsImages"], false);
        });
    }
}
