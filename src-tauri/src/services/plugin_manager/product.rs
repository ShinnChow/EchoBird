use super::manifest::{identifier, relative_path, Extension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};

pub const PERMISSIONS: &[&str] = &[
    "extension.background",
    "configuration",
    "storage",
    "commands",
    "events",
    "text.process",
];
pub const COLOR_KEYS: &[&str] = &[
    "background",
    "surface",
    "elevated",
    "input",
    "border",
    "text",
    "textSecondary",
    "textMuted",
    "accent",
    "accentSecondary",
];

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Theme {
    pub id: String,
    pub title: String,
    pub light: BTreeMap<String, String>,
    pub dark: BTreeMap<String, String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Command {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_id: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct TextProcessor {
    pub id: String,
    pub title: String,
    pub stage: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Configuration {
    pub key: String,
    pub title: String,
    pub r#type: String,
    pub default: Value,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<Value>,
}
impl Configuration {
    pub fn accepts(&self, value: &Value) -> bool {
        let valid = match self.r#type.as_str() {
            "boolean" => value.is_boolean(),
            "number" => value.is_number(),
            "string" => value
                .as_str()
                .is_some_and(|text| text.chars().count() <= 4096),
            _ => false,
        };
        valid && (self.options.is_empty() || self.options.contains(value))
    }
}
fn titled(id: &str, title: &str) -> bool {
    identifier(id) && !title.trim().is_empty() && title.chars().count() <= 80
}

pub fn validate(extension: &Extension) -> Result<(), String> {
    let c = &extension.contributes;
    let permits = |p| {
        extension
            .permissions
            .iter()
            .any(|permission| permission == p)
    };
    if extension.background.as_ref().is_some_and(|entry| {
        !relative_path(entry)
            || !(entry.ends_with(".js") || entry.ends_with(".mjs"))
            || !permits("extension.background")
    }) {
        return Err("Invalid background extension".into());
    }
    let mut ids = HashSet::new();
    if c.themes.len() > 16
        || c.themes.iter().any(|theme| {
            !titled(&theme.id, &theme.title)
                || !ids.insert(&theme.id)
                || [&theme.light, &theme.dark].iter().any(|colors| {
                    colors.is_empty()
                        || colors.iter().any(|(key, value)| {
                            !COLOR_KEYS.contains(&key.as_str())
                                || value.len() != 7
                                || !value.starts_with('#')
                                || !value[1..].bytes().all(|b| b.is_ascii_hexdigit())
                        })
                })
        })
    {
        return Err("Invalid theme contribution".into());
    }
    let mut keys = HashSet::new();
    if c.configuration.len() > 32
        || (!c.configuration.is_empty() && !permits("configuration"))
        || c.configuration.iter().any(|field| {
            !titled(&field.key, &field.title)
                || !keys.insert(&field.key)
                || field.options.len() > 32
                || !field.accepts(&field.default)
                || field.options.iter().any(|option| !field.accepts(option))
        })
    {
        return Err("Invalid plugin configuration".into());
    }
    let mut commands = HashSet::new();
    if c.commands.len() > 32
        || (!c.commands.is_empty() && !permits("commands"))
        || c.commands.iter().any(|command| {
            !titled(&command.id, &command.title)
                || !commands.insert(&command.id)
                || match &command.page_id {
                    Some(page) => !c.pages.iter().any(|p| &p.id == page),
                    None => extension.background.is_none(),
                }
        })
    {
        return Err("Invalid command contribution".into());
    }
    let mut processors = HashSet::new();
    if c.text_processors.len() > 16
        || (!c.text_processors.is_empty()
            && (!permits("text.process") || extension.background.is_none()))
        || c.text_processors.iter().any(|processor| {
            !titled(&processor.id, &processor.title)
                || !processors.insert(&processor.id)
                || !["voice.transcribed", "voice.output"].contains(&processor.stage.as_str())
        })
    {
        return Err("Invalid text processor contribution".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::services::plugin_manager::manifest::Manifest;
    use serde_json::json;
    fn fixture() -> serde_json::Value {
        json!({"name":"theme","publisher":"fixture","version":"1.0.0","displayName":"Theme","description":"Theme fixture","license":"MIT","repository":"https://example.com/theme","echobird":{"manifestVersion":1,"apiVersion":"0.1-draft","platforms":["windows","macos","linux"],"permissions":[],"contributes":{"pages":[],"themes":[{"id":"ocean","title":"Ocean","light":{"accent":"#123456"},"dark":{"accent":"#abcdef"}}]}}})
    }
    fn valid(value: serde_json::Value) -> bool {
        serde_json::from_value::<Manifest>(value).is_ok_and(|m| m.validate().is_ok())
    }
    #[test]
    fn declarative_themes_allow_only_bounded_color_tokens_and_unique_ids() {
        assert!(valid(fixture()));
        for (key, value) in [
            ("accent", json!("red")),
            ("accent", json!("#123456;display:none")),
            ("css", json!("#123456")),
            ("accent", json!("#12345é")),
        ] {
            let mut m = fixture();
            m["echobird"]["contributes"]["themes"][0]["light"][key] = value;
            assert!(!valid(m));
        }
        let mut m = fixture();
        let theme = m["echobird"]["contributes"]["themes"][0].clone();
        m["echobird"]["contributes"]["themes"]
            .as_array_mut()
            .unwrap()
            .push(theme);
        assert!(!valid(m));
    }
    #[test]
    fn background_commands_and_processors_require_their_declared_permissions_and_safe_paths() {
        let mut m = fixture();
        m["echobird"]["background"] = json!("background.mjs");
        assert!(!valid(m.clone()));
        m["echobird"]["permissions"] = json!(["extension.background", "commands", "text.process"]);
        m["echobird"]["contributes"]["commands"] = json!([{"id":"format","title":"Format"}]);
        m["echobird"]["contributes"]["textProcessors"] =
            json!([{"id":"clean","title":"Clean","stage":"voice.output"}]);
        assert!(valid(m.clone()));
        for path in ["../outside.mjs", "/outside.js", "C:/outside.js", "file.txt"] {
            let mut bad = m.clone();
            bad["echobird"]["background"] = json!(path);
            assert!(!valid(bad));
        }
        let mut bad = m.clone();
        bad["echobird"]["contributes"]["commands"][0]["pageId"] = json!("missing");
        assert!(!valid(bad));
        let mut bad = m.clone();
        bad["echobird"]["contributes"]["textProcessors"][0]["stage"] = json!("microphone.raw");
        assert!(!valid(bad));
        for permission in ["commands", "text.process"] {
            let mut bad = m.clone();
            bad["echobird"]["permissions"]
                .as_array_mut()
                .unwrap()
                .retain(|p| p != permission);
            assert!(!valid(bad));
        }
    }
    #[test]
    fn configuration_rejects_wrong_types_defaults_unknown_fields_and_duplicate_keys() {
        let mut m = fixture();
        m["echobird"]["permissions"] = json!(["configuration"]);
        m["echobird"]["contributes"]["configuration"] = json!([{"key":"mode","title":"Mode","type":"string","default":"a","options":["a","b"]}]);
        assert!(valid(m.clone()));
        for value in [json!(false), json!("outside"), json!("x".repeat(4097))] {
            let mut bad = m.clone();
            bad["echobird"]["contributes"]["configuration"][0]["default"] = value;
            assert!(!valid(bad));
        }
        let mut bad = m.clone();
        bad["echobird"]["contributes"]["configuration"][0]["secret"] = json!(true);
        assert!(!valid(bad));
        let field = m["echobird"]["contributes"]["configuration"][0].clone();
        m["echobird"]["contributes"]["configuration"]
            .as_array_mut()
            .unwrap()
            .push(field);
        assert!(!valid(m));
    }
    #[test]
    fn old_manifests_serialize_without_new_optional_fields() {
        let mut value = fixture();
        value["echobird"]["contributes"]
            .as_object_mut()
            .unwrap()
            .remove("themes");
        value["echobird"]["contributes"]["pages"] =
            json!([{"id":"app","title":"App","entry":"ui/index.html"}]);
        value["echobird"]["contributes"]["providers"] = json!([]);
        let m: Manifest = serde_json::from_value(value.clone()).unwrap();
        assert!(m.validate().is_ok());
        assert_eq!(serde_json::to_value(m).unwrap(), value);
    }
}
