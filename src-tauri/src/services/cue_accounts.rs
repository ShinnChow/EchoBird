//! Cue owns its browser nonce in memory. Let the official client sign in and
//! capture only the flushed session cookie and its verified owner after Quit.
use super::cursor_auth::{read, write};
use super::electron_storage::{cipher, decrypt, encrypt};
use super::manus_accounts::{
    cookie_db, native_session, profile, set_cookie, Account, Credits, LoginPoll,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    time::Duration,
};

const LOGIN_SECONDS: i64 = 60;
static ACCOUNT_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static PENDING: std::sync::Mutex<Option<Pending>> = std::sync::Mutex::new(None);

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Owner {
    token_hash: String,
    user_id: String,
}
impl Owner {
    fn matches(&self, token: &str, id: &str) -> bool {
        !token.is_empty()
            && !self.user_id.is_empty()
            && self.token_hash == format!("{:x}", Sha256::digest(token.as_bytes()))
            && id == format!("{:x}", Sha256::digest(self.user_id.as_bytes()))
    }
}
#[derive(Serialize, Deserialize)]
struct Saved {
    account: Account,
    session: String,
    owner: Owner,
}
type Store = BTreeMap<String, Saved>;
#[derive(Clone)]
struct Pending {
    id: String,
    dir: PathBuf,
    device: Option<String>,
    expires: i64,
    awaiting_exit: bool,
}
impl Pending {
    fn validate(&self, id: &str, now: i64) -> Result<(), String> {
        if self.id != id {
            return Err("accountError.cancelled".into());
        }
        if now >= self.expires {
            return Err("accountError.expired".into());
        }
        Ok(())
    }
    fn begin_exit(&mut self, now: i64) {
        if !self.awaiting_exit {
            self.awaiting_exit = true;
            self.expires = now + LOGIN_SECONDS;
        }
    }
    fn bind_device(&mut self, device: &str) -> Result<(), String> {
        if self
            .device
            .as_deref()
            .is_some_and(|expected| expected != device)
        {
            return Err("accountError.initializeClient".into());
        }
        self.device = Some(device.into());
        Ok(())
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginStart {
    login_id: String,
    expires_at: i64,
}

fn data_dir() -> Result<PathBuf, String> {
    #[cfg(windows)]
    if super::tool_manager::get_tool_exe_path("cue").is_none() {
        if let Some(uri) = super::tool_manager::get_tool_launch_uri("cue") {
            if let Some(dir) = super::msix::roaming_data_dir(&uri, "Cue") {
                return Ok(dir);
            }
        }
    }
    dirs::config_dir()
        .map(|p| p.join("Cue"))
        .ok_or_else(|| "accountError.home".into())
}
fn store_path() -> Result<PathBuf, String> {
    Ok(dirs::home_dir()
        .ok_or("accountError.home")?
        .join(".echobird/cue-accounts.json"))
}
fn load_store() -> Result<Store, String> {
    let path = store_path()?;
    if path.exists() {
        read(&path)
    } else {
        Ok(Store::new())
    }
}
fn device_id(dir: &Path) -> Result<Option<String>, String> {
    let path = dir.join("device-id");
    if !path.exists() {
        return Ok(None);
    }
    let device = std::fs::read_to_string(path).map_err(|_| "accountError.read")?;
    if device.trim().is_empty() {
        return Err("accountError.initializeClient".into());
    }
    Ok(Some(device))
}
fn owner(dir: &Path) -> Result<Option<Owner>, String> {
    let path = dir.join("session-owner.json");
    if path.exists() {
        read(&path).map(Some)
    } else {
        Ok(None)
    }
}
fn save_owner(dir: &Path, value: Option<&Owner>) -> Result<(), String> {
    let path = dir.join("session-owner.json");
    if let Some(value) = value {
        write(&path, value)
    } else if path.exists() {
        std::fs::remove_file(path).map_err(|_| "accountError.write".into())
    } else {
        Ok(())
    }
}
fn write_native(dir: &Path, token: Option<&str>, next_owner: Option<&Owner>) -> Result<(), String> {
    let previous_owner = owner(dir)?;
    let mut db = cookie_db(dir, true)?;
    let tx = db.transaction().map_err(|_| "accountError.write")?;
    set_cookie(&tx, dir, token, cipher)?;
    save_owner(dir, next_owner)?;
    if tx.commit().is_err() {
        save_owner(dir, previous_owner.as_ref())?;
        return Err("accountError.write".into());
    }
    Ok(())
}

pub async fn list() -> Result<Vec<Account>, String> {
    let _lock = ACCOUNT_LOCK.lock().await;
    Ok(load_store()?
        .into_values()
        .map(|saved| saved.account)
        .collect())
}
pub async fn start_login() -> Result<LoginStart, String> {
    if !cfg!(any(windows, target_os = "macos")) {
        return Err("accountError.unavailable".into());
    }
    let _lock = ACCOUNT_LOCK.lock().await;
    let dir = data_dir()?;
    let pending = Pending {
        id: uuid::Uuid::new_v4().to_string(),
        device: device_id(&dir)?,
        dir,
        expires: chrono::Utc::now().timestamp() + LOGIN_SECONDS,
        awaiting_exit: false,
    };
    let login = LoginStart {
        login_id: pending.id.clone(),
        expires_at: pending.expires,
    };
    {
        let mut guard = PENDING.lock().map_err(|_| "accountError.busy")?;
        if guard
            .as_ref()
            .is_some_and(|p| p.expires > chrono::Utc::now().timestamp())
        {
            return Err("accountError.busy".into());
        }
        *guard = Some(pending);
    }
    if let Err(error) = super::process_manager::open_tool_for_login("cue").await {
        cancel_login(&login.login_id).await?;
        return Err(error);
    }
    Ok(login)
}
pub async fn cancel_login(id: &str) -> Result<(), String> {
    let mut guard = PENDING.lock().map_err(|_| "accountError.busy")?;
    if guard.as_ref().is_some_and(|p| p.id == id) {
        *guard = None;
    }
    Ok(())
}
pub async fn poll_login(id: &str) -> Result<LoginPoll, String> {
    let _lock = ACCOUNT_LOCK.lock().await;
    let pending = {
        let mut guard = PENDING.lock().map_err(|_| "accountError.busy")?;
        let pending = guard.as_mut().ok_or("accountError.cancelled")?;
        let now = chrono::Utc::now().timestamp();
        pending.validate(id, now)?;
        if let Some(device) = device_id(&pending.dir)? {
            pending.bind_device(&device)?;
        }
        // This local hint changes only the prompt. Authenticated UserInfo verifies it below.
        if owner(&pending.dir)?.is_some_and(|o| !o.user_id.is_empty() && !o.token_hash.is_empty()) {
            pending.begin_exit(now);
        }
        pending.clone()
    };
    let waiting = || LoginPoll {
        account: None,
        awaiting_client_exit: pending.awaiting_exit,
        expires_at: Some(pending.expires),
    };
    if super::process_manager::desktop_tool_is_running("cue").await? {
        return Ok(waiting());
    }
    let Some(device) = pending.device.as_deref() else {
        return Ok(waiting());
    };
    let token = match native_session(&pending.dir) {
        Ok(Some(token)) if !token.is_empty() => token,
        Ok(_) => return Ok(waiting()),
        Err(e) if e == "accountError.closeClient" => return Ok(waiting()),
        Err(e) => return Err(e),
    };
    let Some(owner) = owner(&pending.dir)? else {
        return Ok(waiting());
    };
    let mut account = profile(&token).await?;
    if !owner.matches(&token, &account.id) {
        return Err("accountError.authResponse".into());
    }
    if super::process_manager::desktop_tool_is_running("cue").await? {
        return Ok(waiting());
    }
    let mut guard = PENDING.lock().map_err(|_| "accountError.busy")?;
    guard
        .as_ref()
        .ok_or("accountError.cancelled")?
        .validate(id, chrono::Utc::now().timestamp())?;
    if device_id(&pending.dir)?.as_deref() != Some(device)
        || native_session(&pending.dir)?.as_deref() != Some(&token)
        || !self::owner(&pending.dir)?.is_some_and(|o| o.matches(&token, &account.id))
    {
        return Err("accountError.cancelled".into());
    }
    let mut store = load_store()?;
    // Cue subscriptions are independent of the Manus plan returned by UserInfo.
    account.plan = store.get(&account.id).and_then(|s| s.account.plan.clone());
    account.credits = store
        .get(&account.id)
        .and_then(|s| s.account.credits.clone());
    for saved in store.values_mut() {
        saved.account.active = false;
    }
    account.active = true;
    store.insert(
        account.id.clone(),
        Saved {
            account: account.clone(),
            session: encrypt(&cipher(&pending.dir)?, &token)?,
            owner,
        },
    );
    write(&store_path()?, &store)?;
    *guard = None;
    Ok(LoginPoll {
        account: Some(account),
        ..Default::default()
    })
}

pub async fn switch(id: &str) -> Result<Account, String> {
    let _lock = ACCOUNT_LOCK.lock().await;
    if PENDING
        .lock()
        .map_err(|_| "accountError.busy")?
        .as_ref()
        .is_some_and(|p| p.expires > chrono::Utc::now().timestamp())
    {
        return Err("accountError.busy".into());
    }
    let dir = data_dir()?;
    let mut store = load_store()?;
    let saved = store.get(id).ok_or("accountError.invalidAccount")?;
    let token = decrypt(&cipher(&dir)?, &saved.session)?;
    if !saved.owner.matches(&token, id) || profile(&token).await?.id != id {
        return Err("accountError.invalidAccount".into());
    }
    #[cfg(target_os = "macos")]
    super::cursor_auth::close_client("cue", "Cue").await?;
    // Windows Close hides Cue; never force-kill work or replace a live cookie database.
    if super::process_manager::desktop_tool_is_running("cue").await? {
        return Err("accountError.closeClient".into());
    }
    let previous = native_session(&dir)?;
    let previous_owner = owner(&dir)?;
    write_native(&dir, Some(&token), Some(&saved.owner))?;
    for (key, saved) in &mut store {
        saved.account.active = key == id;
    }
    if let Err(error) = write(&store_path()?, &store) {
        write_native(&dir, previous.as_deref(), previous_owner.as_ref())
            .map_err(|rollback| format!("accountError.rollback|{error} {rollback}"))?;
        return Err(error);
    }
    Ok(store
        .get(id)
        .ok_or("accountError.invalidAccount")?
        .account
        .clone())
}

fn membership(value: &Value) -> Result<(Option<String>, Option<Credits>), String> {
    let membership = value
        .get("membership")
        .filter(|v| v.is_object())
        .ok_or("accountError.format")?;
    let plan = ["membershipVersion", "planKey"].iter().find_map(|key| {
        membership[*key]
            .as_str()
            .filter(|v| !v.trim().is_empty())
            .map(str::to_owned)
    });
    let total = match value.get("remainingCredits") {
        None => None,
        Some(value) => Some(
            value
                .as_i64()
                .or_else(|| value.as_str().and_then(|v| v.parse().ok()))
                .filter(|v| *v >= 0)
                .ok_or("accountError.quota")?,
        ),
    };
    Ok((
        plan,
        total.map(|total| Credits {
            total,
            free: None,
            refresh: None,
            next_refresh_at: None,
        }),
    ))
}
pub async fn refresh(id: &str) -> Result<Account, String> {
    let _lock = ACCOUNT_LOCK.lock().await;
    let dir = data_dir()?;
    let mut store = load_store()?;
    let saved = store.get_mut(id).ok_or("accountError.invalidAccount")?;
    let token = decrypt(&cipher(&dir)?, &saved.session)?;
    let device = device_id(&dir)?.ok_or("accountError.initializeClient")?;
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "accountError.network")?
        .post("https://api.manus.im/user.v1.SubscriptionService/GetAgentsMembership")
        .bearer_auth(token)
        .header("Connect-Protocol-Version", "1")
        .header("x-client-id", device)
        .header("x-client-type", "desktop")
        .json(&serde_json::json!({}))
        .send()
        .await
        .map_err(|_| "accountError.network")?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("accountError.loginRequired".into());
    }
    if !response.status().is_success() {
        return Err(format!("accountError.quota|HTTP {}", response.status()));
    }
    let (plan, credits) = membership(&response.json().await.map_err(|_| "accountError.format")?)?;
    saved.account.plan = plan;
    saved.account.credits = credits;
    let account = saved.account.clone();
    write(&store_path()?, &store)?;
    Ok(account)
}
pub async fn delete(id: &str) -> Result<(), String> {
    let _lock = ACCOUNT_LOCK.lock().await;
    let mut store = load_store()?;
    store.remove(id).ok_or("accountError.invalidAccount")?;
    write(&store_path()?, &store)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cue_plan_and_balance_use_cue_membership_not_manus_credits() {
        let (plan, credits) = membership(&serde_json::json!({
            "membership": {"membershipVersion":"pro"}, "remainingCredits":"1300", "usedCredits":"700"
        })).unwrap();
        assert_eq!(plan.as_deref(), Some("pro"));
        assert_eq!(credits.unwrap().total, 1300);
        assert_eq!(
            membership(&serde_json::json!({"membership":{"planKey":"free"},"remainingCredits":0}))
                .unwrap()
                .1
                .unwrap()
                .total,
            0
        );
        assert!(membership(&serde_json::json!({"membership":{}}))
            .unwrap()
            .1
            .is_none());
        for value in [
            serde_json::json!({}),
            serde_json::json!({"membership":{},"remainingCredits":-1}),
            serde_json::json!({"membership":{},"remainingCredits":"bad"}),
        ] {
            assert!(membership(&value).is_err());
        }
    }
    #[test]
    fn owner_must_match_both_session_and_authenticated_account() {
        let id = format!("{:x}", Sha256::digest(b"user-one"));
        let owner = Owner {
            user_id: "user-one".into(),
            token_hash: format!("{:x}", Sha256::digest(b"session-one")),
        };
        assert!(owner.matches("session-one", &id));
        assert!(!owner.matches("session-two", &id));
        assert!(!owner.matches("session-one", "other-account"));
    }
    #[test]
    fn device_and_exit_deadline_are_bound_to_the_current_attempt() {
        let mut pending = Pending {
            id: "one".into(),
            dir: PathBuf::new(),
            device: None,
            expires: 60,
            awaiting_exit: false,
        };
        pending.bind_device("device-one").unwrap();
        assert!(pending.bind_device("device-two").is_err());
        pending.begin_exit(45);
        pending.begin_exit(100);
        assert_eq!(pending.expires, 105);
        assert!(pending.validate("one", 104).is_ok());
        assert!(pending.validate("one", 105).is_err());
        assert!(pending.validate("old-attempt", 50).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn native_switch_changes_only_cue_session_and_owner_and_can_roll_back() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let dir = root.join("Cue");
        std::fs::create_dir_all(dir.join("Network")).unwrap();
        let manus = root.join("Manus");
        std::fs::create_dir(&manus).unwrap();
        std::fs::write(manus.join("session"), b"other-client-session").unwrap();
        let device_path = dir.join("device-id");
        std::fs::write(&device_path, "device-one").unwrap();
        std::fs::write(dir.join("settings.json"), b"unrelated-settings").unwrap();
        let old_owner = Owner {
            user_id: "old-user".into(),
            token_hash: format!("{:x}", Sha256::digest(b"old-token")),
        };
        save_owner(&dir, Some(&old_owner)).unwrap();
        let db = rusqlite::Connection::open(dir.join("Network/Cookies")).unwrap();
        db.execute_batch("CREATE TABLE cookies(host_key TEXT,name TEXT,path TEXT,value TEXT,encrypted_value BLOB); INSERT INTO cookies VALUES ('api.manus.im','session_id','/','old-token',x''); INSERT INTO cookies VALUES ('unrelated.example','preference','/','keep',x'');").unwrap();
        let new_owner = Owner {
            user_id: "new-user".into(),
            token_hash: format!("{:x}", Sha256::digest(b"new-token")),
        };
        write_native(&dir, Some("new-token"), Some(&new_owner)).unwrap();
        assert_eq!(native_session(&dir).unwrap().as_deref(), Some("new-token"));
        assert_eq!(owner(&dir).unwrap().unwrap().user_id, "new-user");
        write_native(&dir, Some("old-token"), Some(&old_owner)).unwrap();
        assert_eq!(native_session(&dir).unwrap().as_deref(), Some("old-token"));
        assert_eq!(owner(&dir).unwrap().unwrap().user_id, "old-user");
        assert_eq!(
            db.query_row(
                "SELECT value FROM cookies WHERE host_key='unrelated.example'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "keep"
        );
        assert_eq!(std::fs::read_to_string(device_path).unwrap(), "device-one");
        assert_eq!(
            std::fs::read(dir.join("settings.json")).unwrap(),
            b"unrelated-settings"
        );
        assert_eq!(
            std::fs::read(manus.join("session")).unwrap(),
            b"other-client-session"
        );
        drop(db);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cancelling_cue_does_not_cancel_a_newer_attempt_or_write_native_storage() {
        let pending = Pending {
            id: "cue-new".into(),
            dir: PathBuf::new(),
            device: None,
            expires: i64::MAX,
            awaiting_exit: false,
        };
        *PENDING.lock().unwrap() = Some(pending);
        tauri::async_runtime::block_on(cancel_login("cue-old")).unwrap();
        assert_eq!(PENDING.lock().unwrap().as_ref().unwrap().id, "cue-new");
        tauri::async_runtime::block_on(cancel_login("cue-new")).unwrap();
        assert!(PENDING.lock().unwrap().is_none());
        assert!(store_path()
            .unwrap()
            .ends_with(".echobird/cue-accounts.json"));
    }
}
