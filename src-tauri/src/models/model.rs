// Model configuration structures — mirrors old modelManager.ts types

use serde::{Deserialize, Serialize};

/// Model type indicator
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "UPPERCASE")]
pub enum ModelType {
    Cloud,
    Local,
    Tunnel,
    Demo,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ModelScope {
    #[default]
    ModelCenter,
    SmartRouter,
    VoiceInput,
}

impl ModelScope {
    fn is_model_center(&self) -> bool {
        *self == Self::ModelCenter
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AccountProvider {
    Cursor,
    #[serde(rename = "grokbot")]
    GrokBot,
    Dumate,
    #[serde(rename = "doubaowork")]
    DoubaoWork,
    Dola,
    ClaudeCode,
    Codex,
    WorkBuddy,
    WorkBuddyAi,
    Antigravity,
    Copilot,
    Kilo,
    Trae,
    Traecn,
    Minimax,
    Qoder,
    QoderCn,
    #[serde(rename = "qwenwork")]
    QwenWork,
    #[serde(rename = "qwenworkcn")]
    QwenWorkCn,
    Grok,
    Cline,
    Kiro,
    Zcode,
    Kimi,
    OpenDesign,
    Devin,
    CodeArts,
    /// An account source contributed by an installed plugin's application.
    #[serde(untagged)]
    Plugin(PluginApplication),
}

/// Serialized as `plugin:<application>`. Interned so the provider stays `Copy`;
/// only identifiers from saved sources and installed manifests reach it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PluginApplication(pub &'static str);

impl PluginApplication {
    pub fn new(application: &str) -> Option<Self> {
        use std::{collections::HashSet, sync::Mutex};
        static NAMES: Mutex<Option<HashSet<&'static str>>> = Mutex::new(None);
        if !crate::services::plugin_manager::manifest::identifier(application) {
            return None;
        }
        let mut names = NAMES.lock().unwrap();
        let names = names.get_or_insert_with(HashSet::new);
        if let Some(name) = names.get(application) {
            return Some(Self(name));
        }
        let name: &'static str = Box::leak(application.to_owned().into_boxed_str());
        names.insert(name);
        Some(Self(name))
    }
}

impl Serialize for PluginApplication {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&format!("plugin:{}", self.0))
    }
}

impl<'de> Deserialize<'de> for PluginApplication {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        value
            .strip_prefix("plugin:")
            .and_then(Self::new)
            .ok_or_else(|| serde::de::Error::custom("unknown account provider"))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountSource {
    pub provider: AccountProvider,
    pub account_id: String,
}

/// Model configuration (stored in ~/.echobird/models.json)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfig {
    pub internal_id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_source: Option<AccountSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anthropic_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "type")]
    pub model_type: Option<ModelType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub openai_tested: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anthropic_tested: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub openai_latency: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anthropic_latency: Option<f64>,
    #[serde(default, skip_serializing_if = "ModelScope::is_model_center")]
    pub scope: ModelScope,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_scope_defaults_to_model_center() {
        let model: ModelConfig = serde_json::from_value(serde_json::json!({
            "internalId": "existing",
            "name": "Existing",
            "baseUrl": "https://example.com/v1",
            "apiKey": "key"
        }))
        .unwrap();

        assert_eq!(model.scope, ModelScope::ModelCenter);
        assert!(model.account_source.is_none());
    }

    #[test]
    fn smart_router_scope_is_serialized() {
        let value = serde_json::to_value(ModelConfig {
            internal_id: "router-model".to_string(),
            name: "Router Model".to_string(),
            model_id: Some("model-id".to_string()),
            base_url: "https://example.com/v1".to_string(),
            api_key: "key".to_string(),
            account_source: None,
            anthropic_url: None,
            model_type: Some(ModelType::Cloud),
            openai_tested: None,
            anthropic_tested: None,
            openai_latency: None,
            anthropic_latency: None,
            scope: ModelScope::SmartRouter,
        })
        .unwrap();

        assert_eq!(value["scope"], "smartRouter");
    }

    #[test]
    fn account_binding_round_trips_without_api_credentials() {
        let model: ModelConfig = serde_json::from_value(serde_json::json!({
            "internalId":"account-model", "name":"Codex", "modelId":"fixture-model",
            "baseUrl":"account://echobird", "scope":"smartRouter",
            "accountSource":{"provider":"codex","accountId":"saved-id"}
        }))
        .unwrap();
        assert!(model.api_key.is_empty());
        assert_eq!(
            model.account_source.as_ref().unwrap().provider,
            AccountProvider::Codex
        );
        let value = serde_json::to_value(model).unwrap();
        assert_eq!(value["accountSource"]["accountId"], "saved-id");
        assert!(value["accountSource"].get("accessToken").is_none());
    }
}

/// Model test result (returned to frontend)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestResult {
    pub success: bool,
    pub latency: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub protocol: String,
}

/// Model ping result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PingResult {
    pub success: bool,
    pub latency: f64,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[cfg(test)]
mod account_provider_tests {
    use super::*;

    #[test]
    fn plugin_sources_round_trip_beside_built_in_providers() {
        let plugin: AccountProvider = serde_json::from_str("\"plugin:fixture-tool\"").unwrap();
        assert_eq!(
            plugin,
            AccountProvider::Plugin(PluginApplication::new("fixture-tool").unwrap())
        );
        assert_eq!(
            serde_json::to_string(&plugin).unwrap(),
            "\"plugin:fixture-tool\""
        );
        let built_in: AccountProvider = serde_json::from_str("\"traecn\"").unwrap();
        assert_eq!(built_in, AccountProvider::Traecn);
        assert!(serde_json::from_str::<AccountProvider>("\"unknown\"").is_err());
        assert!(serde_json::from_str::<AccountProvider>("\"plugin:../x\"").is_err());
    }
}
