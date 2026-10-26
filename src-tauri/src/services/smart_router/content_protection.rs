use axum::response::Response;
use hmac::{Hmac, Mac};
use rand::RngCore;
use regex::Regex;
use serde_json::Value;
use sha2::Sha256;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

#[path = "content_protection/stream.rs"]
mod stream;
#[cfg(test)]
#[path = "content_protection/tests.rs"]
mod tests;

const PREFIX: &str = "{{SECRET_";
const MAX_VALUES: usize = 8192;
const MAX_SECRET_BYTES: usize = 16 * 1024 * 1024;
pub(super) const FAILURE: &str = "Sensitive information protection could not safely process this request. Nothing was sent. Retry or start a new conversation.";

type SharedEngine = Arc<Mutex<Engine>>;
static ENGINES: OnceLock<Mutex<HashMap<(PathBuf, PathBuf), SharedEngine>>> = OnceLock::new();
static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
fn patterns() -> &'static Vec<Regex> {
    PATTERNS.get_or_init(|| {
    [
        r"(?s)-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----.*?-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----",
        r"\bsk-(?:ant-|proj-|or-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}",
        r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|glpat-[A-Za-z0-9_-]{20,})",
        r"\b(?:AIza[0-9A-Za-z_-]{35}|(?:AKIA|ASIA)[A-Z0-9]{16})\b",
        r"\b(?:xox[abposr]-[A-Za-z0-9-]{10,}|(?:sk|rk)_live_[A-Za-z0-9]{20,})",
        r"\b(?:hf_[A-Za-z0-9]{30,}|gsk_[A-Za-z0-9]{40,}|xai-[A-Za-z0-9_-]{30,}|npm_[A-Za-z0-9]{30,})",
        r"\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}",
        r#"[A-Za-z][A-Za-z0-9+.-]*://[^\s:@/?#"'<>]*:([^\s@/?#"'<>]{4,})@"#,
        r#"(?i)\b[A-Za-z0-9_.-]*(?:api[_-]?key|access[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|credential|token)["']?\s*[:=]\s*["']?([^\s"'`,;<>\[\]{}]{8,})"#,
        r#"(?i)\bBearer[ \t]+([A-Za-z0-9._~+/=-]{8,})"#,
        r#"(?i)(?:密码|密碼|口令|密钥|密鑰|金鑰|令牌|权杖|權杖|api[ _-]?key|token|password)[ \t]*(?:为|為|是|[:：=])[ \t]*["'“「]?([A-Za-z0-9_./\\+=~!@#$%^&*()?-]{4,})"#,
    ]
    .into_iter()
    .map(|pattern| Regex::new(pattern).expect("static credential pattern"))
    .collect()
})
}

pub(super) fn enabled(path: &Path) -> Result<bool, &'static str> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error)
            if error.kind() == std::io::ErrorKind::NotFound
                && std::fs::symlink_metadata(path).is_err() =>
        {
            return Ok(false)
        }
        Err(_) => return Err(FAILURE),
    };
    let settings: Value = serde_json::from_slice(&bytes).map_err(|_| FAILURE)?;
    if !settings.is_object() {
        return Err(FAILURE);
    }
    match settings.get("sensitiveInfoProtection") {
        None => Ok(false),
        Some(Value::Bool(value)) => Ok(*value),
        _ => Err(FAILURE),
    }
}

pub(super) struct Protection(SharedEngine);

impl Protection {
    pub(super) fn prepare(
        body: &mut Value,
        scope: &Path,
        settings: &Path,
    ) -> Result<Self, &'static str> {
        let engine = {
            let mut engines = ENGINES
                .get_or_init(|| Mutex::new(HashMap::new()))
                .lock()
                .map_err(|_| FAILURE)?;
            let identity = (scope.to_path_buf(), settings.to_path_buf());
            if let Some(engine) = engines.get(&identity) {
                engine.clone()
            } else {
                let path = settings.with_file_name("content-protection.key");
                let key = match std::fs::read(&path) {
                    Ok(bytes) => bytes.try_into().map_err(|_| FAILURE)?,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        let mut key = [0; 32];
                        rand::rngs::OsRng
                            .try_fill_bytes(&mut key)
                            .map_err(|_| FAILURE)?;
                        crate::services::native_account_files::write_private_file(&path, &key)
                            .map_err(|_| FAILURE)?;
                        key
                    }
                    Err(_) => return Err(FAILURE),
                };
                let engine = Arc::new(Mutex::new(Engine::new(
                    key,
                    scope.to_string_lossy().as_bytes(),
                )));
                engines.insert(identity, engine.clone());
                engine
            }
        };
        Self::with_engine(body, engine)
    }

    fn with_engine(body: &mut Value, engine: SharedEngine) -> Result<Self, &'static str> {
        {
            let mut store = engine.lock().map_err(|_| FAILURE)?;
            let mut result = Ok(());
            request_strings(body, false, false, true, &mut |key, text, signed| {
                if !signed && result.is_ok() {
                    result = store.discover(key, text);
                }
            });
            result?;
            request_strings(body, false, false, true, &mut |_, text, signed| {
                let masked = store.mask(text);
                if signed {
                    if masked != *text || patterns().iter().any(|pattern| pattern.is_match(text)) {
                        result = Err(FAILURE);
                    }
                } else {
                    *text = masked;
                }
            });
            result?;
        }
        Ok(Self(engine))
    }

    pub(super) async fn restore(self, response: Response) -> Response {
        stream::restore(self.0, response).await
    }
}

struct Secret {
    value: String,
    token: String,
}

struct Engine {
    key: [u8; 32],
    scope: Vec<u8>,
    secrets: Vec<Secret>,
    prefixes: HashMap<[u8; 4], Vec<usize>>,
    tokens: HashMap<String, usize>,
    bytes: usize,
}

impl Engine {
    fn new(key: [u8; 32], scope: &[u8]) -> Self {
        Self {
            key,
            scope: scope.into(),
            secrets: Vec::new(),
            prefixes: HashMap::new(),
            tokens: HashMap::new(),
            bytes: 0,
        }
    }

    fn remember(&mut self, value: &str) -> Result<(), &'static str> {
        if value.len() < 4 || value.starts_with(PREFIX) || placeholder_value(value) {
            return Ok(());
        }
        let mut hash = Hmac::<Sha256>::new_from_slice(&self.key).map_err(|_| FAILURE)?;
        hash.update(&self.scope);
        hash.update(&[0]);
        hash.update(value.as_bytes());
        let digest = hash.finalize().into_bytes();
        let token = [PREFIX, &hex::encode(&digest[..16]), "}}"].concat();
        if let Some(index) = self.tokens.get(&token) {
            return if self.secrets[*index].value == value {
                Ok(())
            } else {
                Err(FAILURE)
            };
        }
        if self.secrets.len() >= MAX_VALUES
            || self.bytes.saturating_add(value.len()) > MAX_SECRET_BYTES
        {
            return Err(FAILURE);
        }
        let index = self.secrets.len();
        self.prefixes
            .entry(value.as_bytes()[..4].try_into().unwrap())
            .or_default()
            .push(index);
        self.bytes += value.len();
        self.tokens.insert(token.clone(), index);
        self.secrets.push(Secret {
            value: value.into(),
            token,
        });
        Ok(())
    }

    fn discover(&mut self, key: &str, text: &str) -> Result<(), &'static str> {
        if secret_field(key) {
            self.remember(text)?;
        }
        for pattern in patterns().iter() {
            for captures in pattern.captures_iter(text) {
                let found = captures.get(1).or_else(|| captures.get(0)).unwrap();
                self.remember(found.as_str())?;
            }
        }
        Ok(())
    }

    fn mask(&self, text: &str) -> String {
        let mut result = String::new();
        let mut cursor = 0;
        let mut copied = 0;
        while cursor + 4 <= text.len() {
            if let Some(token) = text
                .get(cursor..cursor + PREFIX.len() + 34)
                .filter(|token| token.starts_with(PREFIX))
            {
                if self.tokens.contains_key(token) {
                    cursor += token.len();
                    continue;
                }
            }
            let prefix: [u8; 4] = text.as_bytes()[cursor..cursor + 4].try_into().unwrap();
            let found = self
                .prefixes
                .get(&prefix)
                .into_iter()
                .flatten()
                .map(|index| &self.secrets[*index])
                .filter(|secret| text.as_bytes()[cursor..].starts_with(secret.value.as_bytes()))
                .max_by_key(|secret| secret.value.len());
            if let Some(secret) = found {
                result.push_str(&text[copied..cursor]);
                result.push_str(&secret.token);
                cursor += secret.value.len();
                copied = cursor;
            } else {
                cursor += 1;
            }
        }
        if copied == 0 {
            return text.into();
        }
        result.push_str(&text[copied..]);
        result
    }

    fn restore(&self, text: &str, escaped: bool) -> String {
        let mut output = String::new();
        let mut rest = text;
        while let Some(start) = rest.find(PREFIX) {
            output.push_str(&rest[..start]);
            rest = &rest[start..];
            let Some(end) = rest.find("}}") else { break };
            let token = &rest[..end + 2];
            if let Some(index) = self.tokens.get(token) {
                let value = &self.secrets[*index].value;
                if escaped {
                    let json = serde_json::to_string(value).expect("string JSON");
                    output.push_str(&json[1..json.len() - 1]);
                } else {
                    output.push_str(value);
                }
            } else {
                output.push_str(token);
            }
            rest = &rest[end + 2..];
        }
        output.push_str(rest);
        output
    }
}

fn placeholder_value(value: &str) -> bool {
    matches!(
        value.to_ascii_lowercase().as_str(),
        "undefined"
            | "null"
            | "none"
            | "false"
            | "true"
            | "password"
            | "changeme"
            | "your_api_key"
            | "your-api-key"
    ) || value.starts_with(['$', '<', '{'])
}

fn secret_field(key: &str) -> bool {
    let key = key.to_ascii_lowercase().replace(['_', '-'], "");
    if matches!(
        key.as_str(),
        "密码" | "密碼" | "密钥" | "密鑰" | "令牌" | "口令"
    ) {
        return true;
    }
    [
        "apikey",
        "password",
        "accesstoken",
        "refreshtoken",
        "clientsecret",
    ]
    .iter()
    .any(|suffix| key.ends_with(suffix))
        || matches!(
            key.as_str(),
            "apikey"
                | "accesskey"
                | "accesskeyid"
                | "secretkey"
                | "secretaccesskey"
                | "accesskeysecret"
                | "privatekey"
                | "token"
                | "accesstoken"
                | "refreshtoken"
                | "authtoken"
                | "clientsecret"
                | "secret"
                | "password"
                | "passwd"
                | "dbpassword"
                | "authorization"
        )
}

fn signed_block(value: &Value) -> bool {
    let kind = value["type"].as_str().unwrap_or_default();
    kind == "redacted_thinking"
        || (matches!(kind, "thinking" | "reasoning") || kind.starts_with("reasoning."))
            && ["signature", "encrypted_content"]
                .iter()
                .any(|key| value[*key].as_str().is_some_and(|value| !value.is_empty()))
        || ["thoughtSignature", "thought_signature"]
            .iter()
            .any(|key| value[*key].as_str().is_some_and(|value| !value.is_empty()))
}

fn protocol_field(key: &str) -> bool {
    matches!(
        key,
        "model"
            | "id"
            | "call_id"
            | "tool_call_id"
            | "tool_use_id"
            | "previous_response_id"
            | "role"
            | "type"
            | "name"
            | "signature"
            | "encrypted_content"
            | "thoughtSignature"
            | "thought_signature"
            | "data"
            | "url"
            | "image_url"
            | "file_id"
            | "mime_type"
            | "media_type"
            | "server_label"
            | "namespace"
            | "prompt_cache_key"
            | "client_metadata"
    )
}

fn request_strings(
    value: &mut Value,
    business: bool,
    signed: bool,
    root: bool,
    visit: &mut impl FnMut(&str, &mut String, bool),
) {
    match value {
        Value::String(text) if !text.starts_with("data:") => visit("", text, signed),
        Value::Array(values) => {
            for value in values {
                request_strings(value, business, signed, false, visit);
            }
        }
        Value::Object(_) => {
            let sealed = !business && signed_block(value);
            let kind = value["type"].as_str().unwrap_or_default().to_owned();
            let binary = kind == "base64"
                && (value["media_type"].is_string() || value["mime_type"].is_string());
            for (key, child) in value.as_object_mut().unwrap() {
                if !business && protocol_field(key) || binary && key == "data" {
                    continue;
                }
                if !business
                    && root
                    && (matches!(
                        key.as_str(),
                        "tools"
                            | "functions"
                            | "tool_choice"
                            | "response_format"
                            | "output_config"
                            | "output_format"
                            | "reasoning"
                            | "stream_options"
                    ) || key == "text" && child.is_object())
                {
                    descriptions(child, visit);
                    continue;
                }
                let nested_business = business
                    || (key == "input" && matches!(kind.as_str(), "tool_use" | "server_tool_use"))
                    || key == "content" && kind == "tool_result"
                    || key == "args";
                if let Value::String(text) = child {
                    if text.starts_with("data:") {
                        continue;
                    }
                    if key == "arguments" {
                        if let Ok(mut json) = serde_json::from_str::<Value>(text) {
                            request_strings(&mut json, true, signed || sealed, false, visit);
                            *text = serde_json::to_string(&json).expect("parsed arguments");
                            continue;
                        }
                    }
                    visit(key, text, signed || sealed);
                } else {
                    request_strings(child, nested_business, signed || sealed, false, visit);
                }
            }
        }
        _ => {}
    }
}

fn descriptions(value: &mut Value, visit: &mut impl FnMut(&str, &mut String, bool)) {
    match value {
        Value::Object(map) => {
            for (key, value) in map {
                if let Value::String(text) = value {
                    if key == "description" {
                        visit(key, text, false);
                    }
                } else {
                    descriptions(value, visit);
                }
            }
        }
        Value::Array(values) => {
            for value in values {
                descriptions(value, visit);
            }
        }
        _ => {}
    }
}
