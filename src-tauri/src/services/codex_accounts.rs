use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

const LEGACY_BACKUP_FILE: &str = "codex-auth.bak.json";
#[cfg(target_os = "macos")]
const KEYCHAIN_SERVICE: &str = "Codex Auth";
const OAUTH_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const OAUTH_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexAccountSummary {
    pub id: String,
    pub email: String,
    pub plan: Option<String>,
    pub quota_percent: Option<i32>,
    pub active: bool,
}

const USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";

#[derive(Debug)]
struct AccountMetadata {
    id: String,
    email: String,
    plan: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountQuotaCache {
    quota_percent: Option<i32>,
    plan: Option<String>,
}

fn echobird_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".echobird"))
        .ok_or_else(|| "Could not resolve home directory".to_string())
}

pub(crate) fn codex_home() -> Result<PathBuf, String> {
    if let Ok(raw) = std::env::var("CODEX_HOME") {
        let trimmed = raw.trim().trim_matches('"').trim_matches('\'').trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    dirs::home_dir()
        .map(|home| home.join(".codex"))
        .ok_or_else(|| "Could not resolve home directory".to_string())
}

fn account_store_dir() -> Result<PathBuf, String> {
    Ok(echobird_dir()?.join("codex-accounts"))
}

fn quota_path(store_dir: &Path, account_id: &str) -> PathBuf {
    store_dir.join(format!("{account_id}.quota.json"))
}

fn decode_jwt_payload(token: &str) -> Option<Value> {
    let payload = token.split('.').nth(1)?;
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(payload))
        .ok()?;
    serde_json::from_slice(&decoded).ok()
}

fn jwt_is_expired(token: &str) -> bool {
    decode_jwt_payload(token)
        .and_then(|payload| payload.get("exp").and_then(Value::as_i64))
        .is_some_and(|expiry| expiry <= chrono::Utc::now().timestamp())
}

async fn refresh_auth_tokens(auth: &mut Value) -> Result<(), String> {
    let refresh_token = auth
        .get("tokens")
        .and_then(|tokens| non_empty_string(tokens.get("refresh_token")))
        .ok_or_else(|| "This account has no refresh token".to_string())?;
    let response = reqwest::Client::new()
        .post(OAUTH_TOKEN_URL)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::USER_AGENT, "Codex Desktop")
        .header("originator", "Codex Desktop")
        .json(&serde_json::json!({
            "client_id": OAUTH_CLIENT_ID,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }))
        .send()
        .await
        .map_err(|error| format!("Token refresh request failed: {error}"))?;
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("Token refresh response was invalid: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "Token refresh failed with HTTP {}",
            status.as_u16()
        ));
    }
    let access_token = non_empty_string(body.get("access_token"))
        .ok_or_else(|| "Token refresh response has no access token".to_string())?;
    let tokens = auth
        .get_mut("tokens")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "Saved account has no token object".to_string())?;
    tokens.insert("access_token".to_string(), Value::String(access_token));
    if let Some(id_token) = non_empty_string(body.get("id_token")) {
        tokens.insert("id_token".to_string(), Value::String(id_token));
    }
    if let Some(next_refresh_token) = non_empty_string(body.get("refresh_token")) {
        tokens.insert(
            "refresh_token".to_string(),
            Value::String(next_refresh_token),
        );
    }
    Ok(())
}

async fn request_usage(
    access_token: &str,
    account_id: Option<&str>,
) -> Result<reqwest::Response, String> {
    let mut request = reqwest::Client::new()
        .get(USAGE_URL)
        .bearer_auth(access_token)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::USER_AGENT, "Codex Desktop")
        .header("originator", "Codex Desktop")
        .header("x-openai-target-path", "/backend-api/wham/usage")
        .header("x-openai-target-route", "/backend-api/wham/usage");
    if let Some(account_id) = account_id.filter(|value| !value.is_empty()) {
        request = request.header("ChatGPT-Account-Id", account_id);
    }
    request
        .send()
        .await
        .map_err(|error| format!("Quota request failed: {error}"))
}

fn non_empty_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn auth_claims(value: &Value) -> Option<&Value> {
    value.get("https://api.openai.com/auth")
}

fn account_id_from_auth(auth: &Value) -> Option<String> {
    auth.get("tokens")
        .and_then(|tokens| non_empty_string(tokens.get("account_id")))
        .or_else(|| {
            token_payload(auth, "access_token").and_then(|payload| {
                auth_claims(&payload).and_then(|claims| {
                    non_empty_string(claims.get("chatgpt_account_id"))
                        .or_else(|| non_empty_string(claims.get("account_id")))
                })
            })
        })
}

fn token_payload(auth: &Value, key: &str) -> Option<Value> {
    auth.get("tokens")
        .and_then(|tokens| tokens.get(key))
        .and_then(Value::as_str)
        .and_then(decode_jwt_payload)
}

#[cfg(target_os = "macos")]
fn keychain_account(base_dir: &Path) -> String {
    let resolved = fs::canonicalize(base_dir).unwrap_or_else(|_| base_dir.to_path_buf());
    format!(
        "cli|{}",
        &hex::encode(Sha256::digest(resolved.to_string_lossy().as_bytes()))[..16]
    )
}

#[cfg(target_os = "macos")]
fn read_keychain_raw(base_dir: &Path) -> Result<Option<Vec<u8>>, String> {
    let output = std::process::Command::new("security")
        .args(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a"])
        .arg(keychain_account(base_dir))
        .args(["-w"])
        .output()
        .map_err(|error| format!("Failed to read Codex Keychain: {error}"))?;
    if !output.status.success() {
        return Ok(None);
    }
    let raw = output.stdout;
    if raw.is_empty() {
        Ok(None)
    } else {
        Ok(Some(raw))
    }
}

#[cfg(not(target_os = "macos"))]
fn read_keychain_raw(_base_dir: &Path) -> Result<Option<Vec<u8>>, String> {
    Ok(None)
}

#[cfg(target_os = "macos")]
fn write_keychain_raw(base_dir: &Path, raw: &[u8]) -> Result<(), String> {
    let secret = String::from_utf8(raw.to_vec())
        .map_err(|error| format!("Codex Keychain payload is not UTF-8: {error}"))?;
    let output = std::process::Command::new("security")
        .args(["add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a"])
        .arg(keychain_account(base_dir))
        .arg("-w")
        .arg(&secret)
        .output()
        .map_err(|error| format!("Failed to write Codex Keychain: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Failed to write Codex Keychain: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

#[cfg(not(target_os = "macos"))]
fn write_keychain_raw(_base_dir: &Path, _raw: &[u8]) -> Result<(), String> {
    Ok(())
}

fn is_oauth_auth(auth: &Value) -> bool {
    let auth_mode = auth
        .get("auth_mode")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if auth_mode.eq_ignore_ascii_case("apikey") {
        return false;
    }

    auth.get("tokens")
        .and_then(Value::as_object)
        .is_some_and(|tokens| {
            ["id_token", "access_token"]
                .iter()
                .any(|key| non_empty_string(tokens.get(*key)).is_some())
        })
}

fn metadata_from_auth(auth: &Value, raw: &[u8]) -> Result<AccountMetadata, String> {
    if !is_oauth_auth(auth) {
        return Err(
            "The current Codex credentials are not a signed-in ChatGPT account".to_string(),
        );
    }

    let id_payload = token_payload(auth, "id_token");
    let access_payload = token_payload(auth, "access_token");
    let email = id_payload
        .as_ref()
        .and_then(|payload| non_empty_string(payload.get("email")))
        .or_else(|| {
            access_payload
                .as_ref()
                .and_then(|payload| non_empty_string(payload.get("email")))
        });
    let account_id = account_id_from_auth(auth);
    let plan = id_payload
        .as_ref()
        .and_then(auth_claims)
        .and_then(|claims| non_empty_string(claims.get("chatgpt_plan_type")))
        .or_else(|| {
            access_payload
                .as_ref()
                .and_then(auth_claims)
                .and_then(|claims| non_empty_string(claims.get("chatgpt_plan_type")))
        });

    let identity = account_id
        .as_deref()
        .or(email.as_deref())
        .map(str::as_bytes)
        .unwrap_or(raw);
    let id = hex::encode(Sha256::digest(identity));
    let email = email
        .or(account_id)
        .unwrap_or_else(|| "OpenAI account".to_string());

    Ok(AccountMetadata { id, email, plan })
}

fn read_oauth_snapshot(path: &Path) -> Option<(Vec<u8>, Value)> {
    let raw = fs::read(path).ok()?;
    let auth: Value = serde_json::from_slice(&raw).ok()?;
    is_oauth_auth(&auth).then_some((raw, auth))
}

fn read_current_oauth_snapshot(auth_path: &Path) -> Option<(Vec<u8>, Value)> {
    read_oauth_snapshot(auth_path).or_else(|| {
        let base_dir = auth_path.parent()?;
        let raw = read_keychain_raw(base_dir).ok()??;
        let auth: Value = serde_json::from_slice(&raw).ok()?;
        is_oauth_auth(&auth).then_some((raw, auth))
    })
}

pub(crate) fn has_effective_oauth_snapshot(auth_path: &Path, backup_path: &Path) -> bool {
    effective_snapshot(auth_path, backup_path).is_ok()
}

fn effective_snapshot(auth_path: &Path, backup_path: &Path) -> Result<(Vec<u8>, Value), String> {
    if let Some(snapshot) = read_current_oauth_snapshot(auth_path) {
        return Ok(snapshot);
    }
    read_oauth_snapshot(backup_path).ok_or_else(|| {
        "No signed-in ChatGPT account was found. Sign in with ChatGPT or Codex first.".to_string()
    })
}

fn write_private_file(path: &Path, raw: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create account directory: {error}"))?;
    }
    fs::write(path, raw).map_err(|error| format!("Failed to save account: {error}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Failed to secure account file: {error}"))?;
    }
    Ok(())
}

fn save_snapshot(raw: &[u8], auth: &Value, store_dir: &Path) -> Result<AccountMetadata, String> {
    let metadata = metadata_from_auth(auth, raw)?;
    write_private_file(&store_dir.join(format!("{}.json", metadata.id)), raw)?;
    Ok(metadata)
}

fn read_quota_cache(store_dir: &Path, account_id: &str) -> Option<AccountQuotaCache> {
    let cache: AccountQuotaCache =
        serde_json::from_slice(&fs::read(quota_path(store_dir, account_id)).ok()?).ok()?;
    if cache
        .quota_percent
        .is_some_and(|value| !(0..=100).contains(&value))
    {
        return None;
    }
    Some(cache)
}

fn active_account_id(auth_path: &Path) -> Option<String> {
    read_current_oauth_snapshot(auth_path)
        .and_then(|(raw, auth)| metadata_from_auth(&auth, &raw).ok())
        .map(|metadata| metadata.id)
}

fn build_summary(
    mut metadata: AccountMetadata,
    active_id: Option<&str>,
    store_dir: &Path,
) -> CodexAccountSummary {
    let quota = read_quota_cache(store_dir, &metadata.id);
    if let Some(plan) = quota.as_ref().and_then(|cache| cache.plan.clone()) {
        metadata.plan = Some(plan);
    }
    CodexAccountSummary {
        active: active_id == Some(metadata.id.as_str()),
        quota_percent: quota.and_then(|cache| cache.quota_percent),
        id: metadata.id,
        email: metadata.email,
        plan: metadata.plan,
    }
}

fn quota_percent_from_usage(body: &Value) -> Result<Option<i32>, String> {
    let Some(window) = body
        .get("rate_limit")
        .and_then(|rate_limit| rate_limit.get("secondary_window"))
    else {
        return Ok(None);
    };
    let used = [
        "used_percent",
        "usedPercent",
        "used_percentage",
        "usedPercentage",
    ]
    .iter()
    .find_map(|key| window.get(*key).and_then(Value::as_f64));
    if let Some(used) = used {
        return Ok(Some((100.0 - used).round().clamp(0.0, 100.0) as i32));
    }

    let remaining = [
        "remaining_percent",
        "remainingPercent",
        "remaining_percentage",
        "remainingPercentage",
    ]
    .iter()
    .find_map(|key| window.get(*key).and_then(Value::as_f64));
    Ok(remaining.map(|value| value.round().clamp(0.0, 100.0) as i32))
}

pub(crate) fn save_effective_snapshot_at(
    auth_path: &Path,
    backup_path: &Path,
    store_dir: &Path,
) -> Result<CodexAccountSummary, String> {
    let (raw, auth) = effective_snapshot(auth_path, backup_path)?;
    let metadata = save_snapshot(&raw, &auth, store_dir)?;
    let mut summary = build_summary(metadata, None, store_dir);
    summary.active = true;
    Ok(summary)
}

pub fn capture_current_account() -> Result<CodexAccountSummary, String> {
    let codex_dir = codex_home()?;
    let state_dir = echobird_dir()?;
    save_effective_snapshot_at(
        &codex_dir.join("auth.json"),
        &state_dir.join(LEGACY_BACKUP_FILE),
        &state_dir.join("codex-accounts"),
    )
}

fn valid_account_id(account_id: &str) -> bool {
    account_id.len() == 64
        && account_id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn list_accounts_at(
    auth_path: &Path,
    store_dir: &Path,
) -> Result<Vec<CodexAccountSummary>, String> {
    let active_id = active_account_id(auth_path);
    if !store_dir.exists() {
        return Ok(Vec::new());
    }

    let mut accounts = Vec::new();
    for entry in fs::read_dir(store_dir)
        .map_err(|error| format!("Failed to read saved accounts: {error}"))?
    {
        let Ok(entry) = entry else { continue };
        if entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Some((raw, auth)) = read_oauth_snapshot(&entry.path()) else {
            continue;
        };
        let Ok(metadata) = metadata_from_auth(&auth, &raw) else {
            continue;
        };
        accounts.push(build_summary(metadata, active_id.as_deref(), store_dir));
    }
    accounts.sort_by(|left, right| left.email.to_lowercase().cmp(&right.email.to_lowercase()));
    Ok(accounts)
}

pub fn list_accounts() -> Result<Vec<CodexAccountSummary>, String> {
    let codex_dir = codex_home()?;
    list_accounts_at(&codex_dir.join("auth.json"), &account_store_dir()?)
}

fn switch_account_at(
    account_id: &str,
    auth_path: &Path,
    backup_path: &Path,
    store_dir: &Path,
) -> Result<CodexAccountSummary, String> {
    if !valid_account_id(account_id) {
        return Err("Invalid account id".to_string());
    }

    if let Ok((raw, auth)) = effective_snapshot(auth_path, backup_path) {
        let _ = save_snapshot(&raw, &auth, store_dir);
    }

    let saved_path = store_dir.join(format!("{account_id}.json"));
    let raw = fs::read(&saved_path).map_err(|_| "Saved account not found".to_string())?;
    let auth: Value = serde_json::from_slice(&raw)
        .map_err(|error| format!("Saved account is invalid: {error}"))?;
    let metadata = metadata_from_auth(&auth, &raw)?;

    let keychain_is_current = read_keychain_raw(auth_path.parent().unwrap_or(Path::new("")))
        .ok()
        .flatten()
        .is_some()
        && read_oauth_snapshot(auth_path).is_none();
    let target = if !keychain_is_current
        && (read_oauth_snapshot(auth_path).is_some() || !backup_path.exists())
    {
        auth_path
    } else {
        backup_path
    };
    if keychain_is_current {
        write_keychain_raw(auth_path.parent().unwrap_or(Path::new("")), &raw)?;
    } else {
        write_private_file(target, &raw)?;
    }

    let mut summary = build_summary(metadata, None, store_dir);
    summary.active = true;
    Ok(summary)
}

pub(crate) fn restore_legacy_oauth(auth_path: &Path, backup_path: &Path) -> Result<bool, String> {
    if !backup_path.exists() {
        return Ok(false);
    }
    let raw =
        fs::read(backup_path).map_err(|error| format!("Failed to read account backup: {error}"))?;
    let keychain_was_used = read_keychain_raw(auth_path.parent().unwrap_or(Path::new("")))
        .ok()
        .flatten()
        .is_some();
    write_private_file(auth_path, &raw)?;
    if keychain_was_used {
        write_keychain_raw(auth_path.parent().unwrap_or(Path::new("")), &raw)?;
    }
    fs::remove_file(backup_path)
        .map_err(|error| format!("Failed to remove account backup: {error}"))?;
    Ok(true)
}

pub fn switch_account(account_id: &str) -> Result<CodexAccountSummary, String> {
    let codex_dir = codex_home()?;
    let state_dir = echobird_dir()?;
    switch_account_at(
        account_id,
        &codex_dir.join("auth.json"),
        &state_dir.join(LEGACY_BACKUP_FILE),
        &account_store_dir()?,
    )
}

pub fn delete_account(account_id: &str) -> Result<(), String> {
    if !valid_account_id(account_id) {
        return Err("Invalid account id".to_string());
    }
    let path = account_store_dir()?.join(format!("{account_id}.json"));
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("Failed to delete account: {error}"))?;
    }
    let quota = quota_path(&account_store_dir()?, account_id);
    if quota.exists() {
        fs::remove_file(quota)
            .map_err(|error| format!("Failed to delete account quota: {error}"))?;
    }
    Ok(())
}

pub async fn refresh_account_quota(account_id: &str) -> Result<CodexAccountSummary, String> {
    if !valid_account_id(account_id) {
        return Err("Invalid account id".to_string());
    }
    let codex_dir = codex_home()?;
    let store_dir = account_store_dir()?;
    let saved_path = store_dir.join(format!("{account_id}.json"));
    let raw = fs::read(&saved_path).map_err(|_| "Saved account not found".to_string())?;
    let mut auth: Value = serde_json::from_slice(&raw)
        .map_err(|error| format!("Saved account is invalid: {error}"))?;
    let metadata = metadata_from_auth(&auth, &raw)?;
    let chatgpt_account_id = account_id_from_auth(&auth);
    let mut access_token = auth
        .get("tokens")
        .and_then(|tokens| non_empty_string(tokens.get("access_token")))
        .ok_or_else(|| "This account has no access token for quota lookup".to_string())?;

    if jwt_is_expired(&access_token) {
        refresh_auth_tokens(&mut auth).await?;
        access_token = auth
            .get("tokens")
            .and_then(|tokens| non_empty_string(tokens.get("access_token")))
            .ok_or_else(|| "Token refresh produced no access token".to_string())?;
        let refreshed_raw = serde_json::to_vec_pretty(&auth)
            .map_err(|error| format!("Failed to encode refreshed account: {error}"))?;
        write_private_file(&saved_path, &refreshed_raw)?;
        if active_account_id(&codex_dir.join("auth.json")) == Some(account_id.to_string()) {
            let auth_path = codex_dir.join("auth.json");
            let keychain_is_current = read_keychain_raw(&codex_dir).ok().flatten().is_some()
                && read_oauth_snapshot(&auth_path).is_none();
            write_private_file(&auth_path, &refreshed_raw)?;
            if keychain_is_current {
                write_keychain_raw(&codex_dir, &refreshed_raw)?;
            }
        }
    }

    let mut response = request_usage(&access_token, chatgpt_account_id.as_deref()).await?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        refresh_auth_tokens(&mut auth).await?;
        access_token = auth
            .get("tokens")
            .and_then(|tokens| non_empty_string(tokens.get("access_token")))
            .ok_or_else(|| "Token refresh produced no access token".to_string())?;
        let refreshed_raw = serde_json::to_vec_pretty(&auth)
            .map_err(|error| format!("Failed to encode refreshed account: {error}"))?;
        write_private_file(&saved_path, &refreshed_raw)?;
        response = request_usage(&access_token, chatgpt_account_id.as_deref()).await?;
    }
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("Quota response was invalid: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "Quota request failed with HTTP {}",
            status.as_u16()
        ));
    }
    let mut quota_percent = quota_percent_from_usage(&body)?;
    if quota_percent.is_none() {
        quota_percent =
            read_quota_cache(&store_dir, account_id).and_then(|cache| cache.quota_percent);
    }
    let plan = non_empty_string(body.get("plan_type"));
    write_private_file(
        &quota_path(&store_dir, account_id),
        serde_json::to_string(&serde_json::json!({
            "quotaPercent": quota_percent,
            "plan": plan,
        }))
        .map_err(|error| format!("Failed to encode quota: {error}"))?
        .as_bytes(),
    )?;

    let active_id = active_account_id(&codex_dir.join("auth.json"));
    Ok(build_summary(metadata, active_id.as_deref(), &store_dir))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "echobird-codex-accounts-{name}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn jwt(payload: Value) -> String {
        let payload = serde_json::to_vec(&payload).unwrap();
        format!(
            "header.{}.signature",
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload)
        )
    }

    fn oauth(email: &str, account_id: &str, refresh_token: &str) -> Vec<u8> {
        serde_json::to_vec_pretty(&json!({
            "auth_mode": "chatgpt",
            "tokens": {
                "id_token": jwt(json!({
                    "email": email,
                    "https://api.openai.com/auth": { "chatgpt_plan_type": "pro" }
                })),
                "access_token": jwt(json!({
                    "https://api.openai.com/auth": { "chatgpt_account_id": account_id }
                })),
                "refresh_token": refresh_token,
                "account_id": account_id
            }
        }))
        .unwrap()
    }

    #[test]
    fn captures_and_deduplicates_current_oauth_account() {
        let dir = temp_dir("capture");
        let auth_path = dir.join("codex/auth.json");
        let backup_path = dir.join("state/codex-auth.bak.json");
        let store_dir = dir.join("state/codex-accounts");
        write_private_file(
            &auth_path,
            &oauth("first@example.com", "acc-1", "refresh-1"),
        )
        .unwrap();

        let first = save_effective_snapshot_at(&auth_path, &backup_path, &store_dir).unwrap();
        write_private_file(
            &auth_path,
            &oauth("first@example.com", "acc-1", "refresh-2"),
        )
        .unwrap();
        let second = save_effective_snapshot_at(&auth_path, &backup_path, &store_dir).unwrap();

        assert_eq!(first.id, second.id);
        assert_eq!(first.email, "first@example.com");
        assert_eq!(first.plan.as_deref(), Some("pro"));
        assert_eq!(first.quota_percent, None);
        assert_eq!(fs::read_dir(&store_dir).unwrap().count(), 1);
        let stored = fs::read_to_string(store_dir.join(format!("{}.json", first.id))).unwrap();
        assert!(stored.contains("refresh-2"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn switches_the_backup_while_api_auth_is_active() {
        let dir = temp_dir("api-switch");
        let auth_path = dir.join("codex/auth.json");
        let backup_path = dir.join("state/codex-auth.bak.json");
        let store_dir = dir.join("state/codex-accounts");
        let first = oauth("first@example.com", "acc-1", "refresh-1");
        let second = oauth("second@example.com", "acc-2", "refresh-2");
        write_private_file(&backup_path, &first).unwrap();
        write_private_file(&auth_path, br#"{"OPENAI_API_KEY":"sk-test"}"#).unwrap();
        let second_value: Value = serde_json::from_slice(&second).unwrap();
        let second_metadata = save_snapshot(&second, &second_value, &store_dir).unwrap();

        switch_account_at(&second_metadata.id, &auth_path, &backup_path, &store_dir).unwrap();

        assert_eq!(
            fs::read(&auth_path).unwrap(),
            br#"{"OPENAI_API_KEY":"sk-test"}"#
        );
        assert_eq!(fs::read(&backup_path).unwrap(), second);
        let accounts = list_accounts_at(&auth_path, &store_dir).unwrap();
        assert_eq!(accounts.len(), 2);
        assert!(accounts.iter().all(|account| !account.active));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_api_key_credentials_as_an_account() {
        let dir = temp_dir("api-only");
        let auth_path = dir.join("codex/auth.json");
        let backup_path = dir.join("state/codex-auth.bak.json");
        let store_dir = dir.join("state/codex-accounts");
        write_private_file(&auth_path, br#"{"OPENAI_API_KEY":"sk-test"}"#).unwrap();

        let error = save_effective_snapshot_at(&auth_path, &backup_path, &store_dir).unwrap_err();
        assert!(error.contains("No signed-in ChatGPT account"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn quota_prefers_the_weekly_window() {
        let body = json!({
            "rate_limit": {
                "primary_window": { "used_percent": 10 },
                "secondary_window": { "used_percent": 80 }
            }
        });
        assert_eq!(quota_percent_from_usage(&body).unwrap(), Some(20));
    }

    #[test]
    fn missing_weekly_window_is_not_an_error() {
        let body = json!({
            "rate_limit": { "primary_window": { "used_percent": 10 } }
        });
        assert_eq!(quota_percent_from_usage(&body).unwrap(), None);
    }
}
