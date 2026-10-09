//! Manus desktop sessions. Change only session credentials and login verification;
//! unrelated Chromium storage and Manus settings remain owned by the native client.
use super::cursor_auth::{read, write};
use super::electron_storage::{cipher, decrypt, decrypt_bytes, encrypt, encrypt_bytes, Cipher};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::Path, path::PathBuf, time::Duration};

const HOST: &str = "api.manus.im";
const COOKIE: &str = "session_id";
const LOGIN_SECONDS: i64 = 60;
static ACCOUNT_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static PENDING: std::sync::Mutex<Option<Pending>> = std::sync::Mutex::new(None);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credits {
    pub total: i64,
    pub free: Option<i64>,
    pub refresh: Option<i64>,
    pub next_refresh_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub email: String,
    pub plan: Option<String>,
    pub active: bool,
    pub credits: Option<Credits>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginStart {
    pub login_id: String,
    pub verification_uri: String,
    pub expires_at: i64,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginPoll {
    pub account: Option<Account>,
    pub awaiting_client_exit: bool,
    pub expires_at: Option<i64>,
}

#[derive(Clone, Serialize, Deserialize)]
struct Saved {
    account: Account,
    session: String,
}
type Store = BTreeMap<String, Saved>;

#[derive(Clone)]
struct Pending {
    id: String,
    device_id: String,
    nonce: String,
    started: i64,
    previous: Option<String>,
    expires: i64,
    awaiting_client_exit: bool,
    cancelled: bool,
}

impl Pending {
    fn begin_client_exit(&mut self, id: &str, now: i64) -> Result<(), String> {
        self.validate(id, now)?;
        if !self.awaiting_client_exit {
            self.awaiting_client_exit = true;
            self.expires = now + LOGIN_SECONDS;
        }
        Ok(())
    }

    fn validate(&self, id: &str, now: i64) -> Result<(), String> {
        if self.id != id || self.cancelled {
            return Err("accountError.cancelled".into());
        }
        if now >= self.expires {
            return Err("accountError.expired".into());
        }
        Ok(())
    }
}

fn data_dir() -> Result<PathBuf, String> {
    #[cfg(windows)]
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let store = PathBuf::from(local)
            .join("Packages/ManusAI.Manus_vajzd2mq3s8wj/LocalCache/Roaming/Manus");
        if store.is_dir() {
            return Ok(store);
        }
    }
    dirs::config_dir()
        .map(|dir| dir.join("Manus"))
        .ok_or_else(|| "accountError.home".into())
}

fn store_path() -> Result<PathBuf, String> {
    Ok(dirs::home_dir()
        .ok_or("accountError.home")?
        .join(".echobird/manus-accounts.json"))
}

fn load_store() -> Result<Store, String> {
    let path = store_path()?;
    if !path.exists() {
        return Ok(Store::new());
    }
    read(&path)
}

fn cookie_db(dir: &Path, writable: bool) -> Result<Connection, String> {
    let path = dir.join("Network/Cookies");
    let flags = if writable {
        OpenFlags::SQLITE_OPEN_READ_WRITE
    } else {
        OpenFlags::SQLITE_OPEN_READ_ONLY
    };
    let db = Connection::open_with_flags(path, flags).map_err(|_| "accountError.closeClient")?;
    db.busy_timeout(Duration::from_secs(2))
        .map_err(|_| "accountError.read")?;
    Ok(db)
}

fn cookie_read_error(error: rusqlite::Error) -> String {
    if matches!(error, rusqlite::Error::SqliteFailure(ref failure, _) if matches!(failure.code, rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked))
    {
        "accountError.closeClient".into()
    } else {
        "accountError.read".into()
    }
}

fn cookie_value(
    db: &Connection,
    dir: &Path,
    load_cipher: impl FnOnce(&Path) -> Result<Cipher, String>,
) -> Result<Option<String>, String> {
    let row: Option<(String, Vec<u8>)> = db
        .query_row(
            "SELECT value, encrypted_value FROM cookies WHERE host_key=?1 AND name=?2 AND path='/'",
            params![HOST, COOKIE],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(cookie_read_error)?;
    let Some((plain, encrypted)) = row else {
        return Ok(None);
    };
    if !plain.is_empty() {
        return Ok(Some(plain));
    }
    if encrypted.is_empty() {
        return Ok(None);
    }
    let bytes = decrypt_bytes(&load_cipher(dir)?, &encrypted)?;
    let version: i64 = db
        .query_row("SELECT value FROM meta WHERE key='version'", [], |row| {
            row.get::<_, String>(0)
        })
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let token = if version >= 24 {
        bytes
            .strip_prefix(Sha256::digest(HOST.as_bytes()).as_slice())
            .ok_or("accountError.format")?
    } else {
        &bytes
    };
    String::from_utf8(token.to_vec())
        .map(Some)
        .map_err(|_| "accountError.format".into())
}

fn native_session(dir: &Path) -> Result<Option<String>, String> {
    if !dir.join("Network/Cookies").exists() {
        return Ok(None);
    }
    cookie_value(&cookie_db(dir, false)?, dir, cipher)
}

fn set_cookie(
    db: &Connection,
    dir: &Path,
    token: Option<&str>,
    load_cipher: impl FnOnce(&Path) -> Result<Cipher, String>,
) -> Result<(), String> {
    let existing: Option<Vec<u8>> = db
        .query_row(
            "SELECT encrypted_value FROM cookies WHERE host_key=?1 AND name=?2 AND path='/'",
            params![HOST, COOKIE],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "accountError.read")?;
    if token.is_none() {
        db.execute(
            "DELETE FROM cookies WHERE host_key=?1 AND name=?2 AND path='/'",
            params![HOST, COOKIE],
        )
        .map_err(|_| "accountError.write")?;
        return Ok(());
    }
    let token = token.ok_or("accountError.invalidAccount")?;
    let encrypted = existing.as_ref().is_some_and(|v| !v.is_empty()) || cfg!(target_os = "macos");
    let (plain, secret) = if encrypted {
        let version: i64 = db
            .query_row("SELECT value FROM meta WHERE key='version'", [], |row| {
                row.get::<_, String>(0)
            })
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        let mut bytes = Vec::new();
        if version >= 24 {
            bytes.extend_from_slice(&Sha256::digest(HOST.as_bytes()));
        }
        bytes.extend_from_slice(token.as_bytes());
        (String::new(), encrypt_bytes(&load_cipher(dir)?, &bytes)?)
    } else {
        (token.to_string(), Vec::new())
    };
    if existing.is_some() {
        db.execute(
            "UPDATE cookies SET value=?1, encrypted_value=?2 WHERE host_key=?3 AND name=?4 AND path='/'",
            params![plain, secret, HOST, COOKIE],
        )
        .map_err(|_| "accountError.write")?;
    } else {
        let now = (chrono::Utc::now().timestamp() + 11_644_473_600) * 1_000_000;
        let expires = now + 365 * 24 * 60 * 60 * 1_000_000;
        db.execute(
            "INSERT INTO cookies (creation_utc,host_key,top_frame_site_key,name,value,encrypted_value,path,expires_utc,is_secure,is_httponly,last_access_utc,has_expires,is_persistent,priority,samesite,source_scheme,source_port,last_update_utc,source_type,has_cross_site_ancestor) VALUES (?1,?2,'',?3,?4,?5,'/',?6,1,1,?1,1,1,1,1,2,443,?1,0,0)",
            params![now, HOST, COOKIE, plain, secret, expires],
        )
        .map_err(|_| "accountError.write")?;
    }
    Ok(())
}

fn write_native(dir: &Path, token: Option<&str>) -> Result<(), String> {
    if token.is_none() && !dir.join("Network/Cookies").exists() {
        return Ok(());
    }
    if native_session(dir)?.as_deref() != token {
        // The official client invalidates device verification when its token changes.
        invalidate_verification(dir)?;
    }
    let mut db = cookie_db(dir, true)?;
    let tx = db.transaction().map_err(|_| "accountError.write")?;
    set_cookie(&tx, dir, token, cipher)?;
    tx.commit().map_err(|_| "accountError.write".into())
}

fn invalidate_verification(dir: &Path) -> Result<(), String> {
    let path = dir.join("localStorage.json");
    let mut data: Value = read(&path)?;
    let object = data.as_object_mut().ok_or("accountError.format")?;
    if object
        .remove("desktopLoginVerifiedDeviceId:https://api.manus.im/")
        .is_some()
    {
        write(&path, &data)?;
    }
    Ok(())
}

fn device_id(dir: &Path) -> Result<String, String> {
    let value: Value = read(&dir.join("localStorage.json"))?;
    value["deviceId"]
        .as_str()
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| "accountError.initializeClient".into())
}

async fn close_app() -> Result<(), String> {
    #[cfg(windows)]
    {
        // Manus 2.x hides its main window on Close and keeps running in the tray.
        super::cursor_auth::close_windows_client("Manus", true).await
    }
    #[cfg(target_os = "macos")]
    {
        super::cursor_auth::close_client("manus", "Manus").await
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Err("accountError.unavailable".into())
    }
}

async fn profile(token: &str) -> Result<Account, String> {
    let response = request(token, "UserInfo").await?;
    let id = response["userId"]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or("accountError.authResponse")?;
    let email = response["email"]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or("accountError.authResponse")?;
    Ok(Account {
        id: format!("{:x}", Sha256::digest(id.as_bytes())),
        email: email.into(),
        plan: response["membershipVersion"].as_str().map(str::to_owned),
        active: false,
        credits: None,
    })
}

async fn request(token: &str, method: &str) -> Result<Value, String> {
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "accountError.network")?
        .post(format!("https://api.manus.im/user.v1.UserService/{method}"))
        .bearer_auth(token)
        .header("Connect-Protocol-Version", "1")
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
    response
        .json()
        .await
        .map_err(|_| "accountError.format".into())
}

fn nonce(dir: &Path) -> Result<Option<String>, String> {
    let value: Value = read(&dir.join("localStorage.json"))?;
    Ok(value["login_nonce"].as_str().map(str::to_owned))
}

fn begin_nonce(dir: &Path, nonce: &str) -> Result<(), String> {
    let path = dir.join("localStorage.json");
    let mut data: Value = read(&path)?;
    let object = data.as_object_mut().ok_or("accountError.format")?;
    if object
        .get("login_nonce")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.is_empty())
    {
        return Err("accountError.busy".into());
    }
    object.insert("login_nonce".into(), nonce.into());
    write(&path, &data)
}

fn clear_nonce(dir: &Path, nonce: &str) -> Result<(), String> {
    let path = dir.join("localStorage.json");
    let mut data: Value = read(&path)?;
    let object = data.as_object_mut().ok_or("accountError.format")?;
    if object.get("login_nonce").and_then(Value::as_str) == Some(nonce) {
        object.remove("login_nonce");
        write(&path, &data)?;
    }
    Ok(())
}

fn login_session(
    dir: &Path,
    pending: &Pending,
    load_cipher: impl FnOnce(&Path) -> Result<Cipher, String>,
) -> Result<Option<String>, String> {
    if !dir.join("Network/Cookies").exists() {
        return Ok(None);
    }
    let mut db = cookie_db(dir, false)?;
    let tx = db.transaction().map_err(cookie_read_error)?;
    let updated: Option<i64> = tx
        .query_row(
            "SELECT last_update_utc FROM cookies WHERE host_key=?1 AND name=?2 AND path='/'",
            params![HOST, COOKIE],
            |row| row.get(0),
        )
        .optional()
        .map_err(cookie_read_error)?;
    // Nonce consumption precedes the official async exchange. Never import its old Cookie.
    if !updated.is_some_and(|updated| updated >= pending.started) {
        return Ok(None);
    }
    let token = cookie_value(&tx, dir, load_cipher)?.filter(|token| !token.is_empty());
    if token.is_some() && token == pending.previous {
        return Ok(None);
    }
    Ok(token)
}

fn parse_credits(value: &Value) -> Result<Credits, String> {
    let total = value["totalCredits"].as_i64().ok_or("accountError.quota")?;
    if total < 0 {
        return Err("accountError.quota".into());
    }
    Ok(Credits {
        total,
        free: value["freeCredits"].as_i64(),
        refresh: value["refreshCredits"].as_i64(),
        next_refresh_at: value["nextRefreshTime"]
            .as_str()
            .and_then(|raw| chrono::DateTime::parse_from_rfc3339(raw).ok())
            .map(|date| date.timestamp()),
    })
}

pub async fn list() -> Result<Vec<Account>, String> {
    let _guard = ACCOUNT_LOCK.lock().await;
    Ok(load_store()?
        .into_values()
        .map(|saved| saved.account)
        .collect())
}

pub async fn start_login() -> Result<LoginStart, String> {
    if !cfg!(any(windows, target_os = "macos")) {
        return Err("accountError.unavailable".into());
    }
    let _guard = ACCOUNT_LOCK.lock().await;
    if PENDING.lock().map_err(|_| "accountError.busy")?.is_some() {
        return Err("accountError.busy".into());
    }
    let dir = data_dir()?;
    if !dir.is_dir() {
        return Err("accountError.initializeClient".into());
    }
    let device_id = device_id(&dir)?;
    let previous = match native_session(&dir) {
        Ok(token) => token,
        Err(error) if error == "accountError.closeClient" => None,
        Err(error) => return Err(error),
    };
    let id = uuid::Uuid::new_v4().to_string();
    let nonce = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now();
    let expires = now.timestamp() + LOGIN_SECONDS;
    let mut url = url::Url::parse("https://manus.im/login").map_err(|_| "accountError.auth")?;
    url.query_pairs_mut().extend_pairs([
        ("from", "desktop"),
        ("type", "signIn"),
        ("nonce", nonce.as_str()),
    ]);
    begin_nonce(&dir, &nonce)?;
    *PENDING.lock().map_err(|_| "accountError.busy")? = Some(Pending {
        id: id.clone(),
        device_id,
        nonce,
        started: now.timestamp_micros() + 11_644_473_600_000_000,
        previous,
        expires,
        awaiting_client_exit: false,
        cancelled: false,
    });
    // Remove this attempt's nonce even if its frontend disappears.
    let expired_id = id.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let remaining = {
                let Ok(mut guard) = PENDING.lock() else {
                    return;
                };
                let Some(pending) = guard
                    .as_mut()
                    .filter(|pending| pending.id == expired_id && !pending.cancelled)
                else {
                    return;
                };
                let remaining = (pending.expires - chrono::Utc::now().timestamp()).max(0);
                if remaining == 0 {
                    pending.cancelled = true;
                }
                remaining as u64
            };
            if remaining == 0 {
                let _ = cancel_login(&expired_id).await;
                return;
            }
            tokio::time::sleep(Duration::from_secs(remaining)).await;
        }
    });
    Ok(LoginStart {
        login_id: id,
        expires_at: expires,
        verification_uri: url.into(),
    })
}

pub async fn poll_login(id: &str) -> Result<LoginPoll, String> {
    let _guard = ACCOUNT_LOCK.lock().await;
    let pending = {
        let guard = PENDING.lock().map_err(|_| "accountError.busy")?;
        let Some(pending) = guard
            .as_ref()
            .filter(|pending| pending.id == id && !pending.cancelled)
        else {
            return Ok(LoginPoll::default());
        };
        pending.validate(id, chrono::Utc::now().timestamp())?;
        pending.clone()
    };
    let dir = data_dir()?;
    match nonce(&dir)? {
        Some(nonce) if nonce == pending.nonce => return Ok(LoginPoll::default()),
        Some(_) => return Err("accountError.cancelled".into()),
        None => {}
    }
    if device_id(&dir)? != pending.device_id {
        return Err("accountError.initializeClient".into());
    }
    let pending = {
        let mut guard = PENDING.lock().map_err(|_| "accountError.busy")?;
        let current = guard.as_mut().ok_or("accountError.cancelled")?;
        current.begin_client_exit(id, chrono::Utc::now().timestamp())?;
        current.clone()
    };
    let token = match login_session(&dir, &pending, cipher) {
        Ok(token) => token,
        // The official Windows client holds an exclusive lock. Wait for normal tray Quit.
        Err(error) if error == "accountError.closeClient" => None,
        Err(error) => return Err(error),
    };
    let Some(token) = token else {
        return Ok(LoginPoll {
            account: None,
            awaiting_client_exit: true,
            expires_at: Some(pending.expires),
        });
    };
    let mut account = profile(&token).await?;
    // Cancellation wins while UserInfo is pending; guard the synchronous save too.
    let mut guard = PENDING.lock().map_err(|_| "accountError.busy")?;
    let Some(current) = guard
        .as_ref()
        .filter(|pending| pending.id == id && !pending.cancelled)
    else {
        return Ok(LoginPoll::default());
    };
    current.validate(id, chrono::Utc::now().timestamp())?;
    if device_id(&dir)? != pending.device_id || nonce(&dir)?.is_some() {
        return Err("accountError.cancelled".into());
    }
    let mut store = load_store()?;
    account.credits = store
        .get(&account.id)
        .and_then(|saved| saved.account.credits.clone());
    // The official browser callback already logged this account into Manus.
    for saved in store.values_mut() {
        saved.account.active = false;
    }
    account.active = true;
    store.insert(
        account.id.clone(),
        Saved {
            account: account.clone(),
            session: encrypt(&cipher(&dir)?, &token)?,
        },
    );
    write(&store_path()?, &store)?;
    *guard = None;
    Ok(LoginPoll {
        account: Some(account),
        awaiting_client_exit: false,
        expires_at: None,
    })
}

pub async fn cancel_login(id: &str) -> Result<(), String> {
    {
        let mut guard = PENDING.lock().map_err(|_| "accountError.busy")?;
        let Some(pending) = guard.as_mut().filter(|pending| pending.id == id) else {
            return Ok(());
        };
        pending.cancelled = true;
    }
    let _guard = ACCOUNT_LOCK.lock().await;
    let mut guard = PENDING.lock().map_err(|_| "accountError.busy")?;
    if let Some(pending) = guard.as_ref().filter(|pending| pending.id == id) {
        let result = clear_nonce(&data_dir()?, &pending.nonce);
        *guard = None;
        result?;
    }
    Ok(())
}

pub async fn switch(id: &str) -> Result<Account, String> {
    let _guard = ACCOUNT_LOCK.lock().await;
    let dir = data_dir()?;
    let path = store_path()?;
    let mut store = load_store()?;
    let saved = store.get(id).ok_or("accountError.invalidAccount")?;
    let token = decrypt(&cipher(&dir)?, &saved.session)?;
    if profile(&token).await?.id != id {
        return Err("accountError.invalidAccount".into());
    }
    close_app().await?;
    let previous = native_session(&dir)?;
    if let Err(error) = write_native(&dir, Some(&token)) {
        let _ = super::process_manager::start_tool("manus", None, None).await;
        return Err(error);
    }
    for (key, saved) in &mut store {
        saved.account.active = key == id;
    }
    if let Err(error) = write(&path, &store) {
        write_native(&dir, previous.as_deref())
            .map_err(|rollback| format!("accountError.rollback|{error} {rollback}"))?;
        let _ = super::process_manager::start_tool("manus", None, None).await;
        return Err(error);
    }
    Ok(store
        .get(id)
        .ok_or("accountError.invalidAccount")?
        .account
        .clone())
}

pub async fn refresh(id: &str) -> Result<Account, String> {
    let _guard = ACCOUNT_LOCK.lock().await;
    let dir = data_dir()?;
    let mut store = load_store()?;
    let saved = store.get_mut(id).ok_or("accountError.invalidAccount")?;
    let token = decrypt(&cipher(&dir)?, &saved.session)?;
    saved.account.credits = Some(parse_credits(
        &request(&token, "GetAvailableCredits").await?,
    )?);
    let account = saved.account.clone();
    write(&store_path()?, &store)?;
    Ok(account)
}

pub async fn delete(id: &str) -> Result<(), String> {
    let _guard = ACCOUNT_LOCK.lock().await;
    let mut store = load_store()?;
    store.remove(id).ok_or("accountError.invalidAccount")?;
    write(&store_path()?, &store)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn login_fixture(token: Option<&str>) -> PathBuf {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(dir.join("Network")).unwrap();
        write(
            &dir.join("localStorage.json"),
            &serde_json::json!({
                "deviceId": "fixture-device", "manus-theme": "dark",
                "desktopLoginBoundDeviceId:https://api.manus.im/": "fixture-device",
                "desktopLoginVerifiedDeviceId:https://api.manus.im/": "fixture-device"
            }),
        )
        .unwrap();
        let db = Connection::open(dir.join("Network/Cookies")).unwrap();
        db.execute_batch("CREATE TABLE cookies(host_key TEXT,name TEXT,path TEXT,value TEXT,encrypted_value BLOB,last_update_utc INTEGER);").unwrap();
        if let Some(token) = token {
            db.execute(
                "INSERT INTO cookies VALUES (?1,?2,'/',?3,x'',1)",
                params![HOST, COOKIE, token],
            )
            .unwrap();
        }
        dir
    }

    fn pending_fixture() -> Pending {
        Pending {
            id: "fixture-login".into(),
            device_id: "fixture-device".into(),
            nonce: "fixture-nonce".into(),
            started: 100,
            previous: Some("old-session".into()),
            expires: 60,
            awaiting_client_exit: false,
            cancelled: false,
        }
    }

    #[test]
    fn native_exit_has_its_own_deadline_and_repeated_polls_do_not_extend_it() {
        let mut pending = pending_fixture();
        pending.begin_client_exit("fixture-login", 45).unwrap();
        assert!(pending.awaiting_client_exit);
        assert_eq!(pending.expires, 105);
        // The browser-stage cleanup wake at 60 must honor the new deadline.
        assert!(pending.validate("fixture-login", 60).is_ok());
        pending.begin_client_exit("fixture-login", 104).unwrap();
        assert_eq!(pending.expires, 105);
        assert_eq!(
            pending.validate("fixture-login", 105).unwrap_err(),
            "accountError.expired"
        );
    }

    #[test]
    fn expired_cancelled_or_replaced_login_cannot_start_an_exit_stage() {
        for (id, now, cancelled, expected) in [
            ("fixture-login", 60, false, "accountError.expired"),
            ("fixture-login", 45, true, "accountError.cancelled"),
            ("older-login", 45, false, "accountError.cancelled"),
        ] {
            let mut pending = pending_fixture();
            pending.cancelled = cancelled;
            assert_eq!(pending.begin_client_exit(id, now).unwrap_err(), expected);
            assert_eq!(pending.expires, 60);
            assert!(!pending.awaiting_client_exit);
        }
    }

    #[test]
    fn native_login_waits_for_a_new_cookie_written_during_this_attempt() {
        let dir = login_fixture(Some("old-session"));
        let pending = pending_fixture();
        let fixture_cipher = |_: &Path| Err("fixture must not request the native keychain".into());
        assert!(login_session(&dir, &pending, fixture_cipher)
            .unwrap()
            .is_none());
        let db = cookie_db(&dir, true).unwrap();
        // Consuming the callback nonce does not mean token exchange has finished.
        db.execute("UPDATE cookies SET last_update_utc=101", [])
            .unwrap();
        assert!(login_session(&dir, &pending, fixture_cipher)
            .unwrap()
            .is_none());
        db.execute(
            "UPDATE cookies SET value='new-session',last_update_utc=99",
            [],
        )
        .unwrap();
        assert!(login_session(&dir, &pending, fixture_cipher)
            .unwrap()
            .is_none());
        db.execute("UPDATE cookies SET last_update_utc=100", [])
            .unwrap();
        assert_eq!(
            login_session(&dir, &pending, fixture_cipher)
                .unwrap()
                .as_deref(),
            Some("new-session")
        );
        db.execute("UPDATE cookies SET value=''", []).unwrap();
        assert!(login_session(&dir, &pending, fixture_cipher)
            .unwrap()
            .is_none());
        drop(db);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn native_cookie_file_lock_stays_pending_until_normal_client_exit() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = login_fixture(Some("new-session"));
        let db = cookie_db(&dir, true).unwrap();
        db.execute("UPDATE cookies SET last_update_utc=101", [])
            .unwrap();
        drop(db);
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(dir.join("Network/Cookies"))
            .unwrap();
        let fixture_cipher = |_: &Path| Err("fixture must not request the native keychain".into());
        assert_eq!(
            login_session(&dir, &pending_fixture(), fixture_cipher).unwrap_err(),
            "accountError.closeClient"
        );
        drop(lock);
        // Positive control: the same database is imported as soon as its owner releases it.
        assert_eq!(
            login_session(&dir, &pending_fixture(), fixture_cipher)
                .unwrap()
                .as_deref(),
            Some("new-session")
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn nonce_cleanup_preserves_settings_cookies_and_other_login_attempts() {
        let dir = login_fixture(Some("old-session"));
        let path = dir.join("localStorage.json");
        let before = std::fs::read(&path).unwrap();
        begin_nonce(&dir, "ours").unwrap();
        assert_eq!(nonce(&dir).unwrap().as_deref(), Some("ours"));
        let ours = std::fs::read(&path).unwrap();
        assert_eq!(begin_nonce(&dir, "other").unwrap_err(), "accountError.busy");
        clear_nonce(&dir, "other").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), ours);
        clear_nonce(&dir, "ours").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert_eq!(
            native_session(&dir).unwrap().as_deref(),
            Some("old-session")
        );
        begin_nonce(&dir, "replacement").unwrap();
        clear_nonce(&dir, "ours").unwrap();
        assert_eq!(nonce(&dir).unwrap().as_deref(), Some("replacement"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reading_device_identity_preserves_settings_and_cookie_state() {
        let dir = login_fixture(None);
        let before = std::fs::read(dir.join("localStorage.json")).unwrap();
        assert_eq!(device_id(&dir).unwrap(), "fixture-device");
        assert_eq!(
            std::fs::read(dir.join("localStorage.json")).unwrap(),
            before
        );
        assert!(native_session(&dir).unwrap().is_none());
        // Explicit native apply still clears only the old device-verification marker.
        invalidate_verification(&dir).unwrap();
        let state: Value = read(&dir.join("localStorage.json")).unwrap();
        assert_eq!(state["deviceId"], "fixture-device");
        assert_eq!(state["manus-theme"], "dark");
        assert_eq!(
            state["desktopLoginBoundDeviceId:https://api.manus.im/"],
            "fixture-device"
        );
        assert!(state
            .get("desktopLoginVerifiedDeviceId:https://api.manus.im/")
            .is_none());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn late_login_results_cannot_commit_after_cancel_expiry_or_replacement() {
        let mut pending = Pending {
            id: "current".into(),
            device_id: "fixture-device".into(),
            nonce: "fixture-nonce".into(),
            started: 100,
            previous: Some("previous".into()),
            expires: 60,
            awaiting_client_exit: false,
            cancelled: false,
        };
        let mut saved = Vec::new();
        let mut commit = |pending: &Pending, id: &str, now| {
            pending.validate(id, now)?;
            saved.push(id.to_string());
            Ok::<_, String>(())
        };
        assert!(commit(&pending, "current", 59).is_ok());
        assert_eq!(
            commit(&pending, "current", 60).unwrap_err(),
            "accountError.expired"
        );
        assert_eq!(
            commit(&pending, "earlier", 59).unwrap_err(),
            "accountError.cancelled"
        );
        pending.cancelled = true;
        assert_eq!(
            commit(&pending, "current", 59).unwrap_err(),
            "accountError.cancelled"
        );
        assert_eq!(saved, ["current"]);
    }

    #[test]
    fn credits_distinguish_unknown_from_zero_and_use_the_actual_balance() {
        assert!(parse_credits(&serde_json::json!({})).is_err());
        let credits = parse_credits(&serde_json::json!({
            "totalCredits": 0,
            "freeCredits": 0,
            "refreshCredits": 0,
            "nextRefreshTime": "2026-09-29T16:00:00Z"
        }))
        .unwrap();
        assert_eq!(credits.total, 0);
        assert_eq!(credits.next_refresh_at, Some(1790697600));
    }

    #[test]
    fn cookie_update_preserves_unrelated_browser_state() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE meta (key TEXT PRIMARY KEY,value TEXT); INSERT INTO meta VALUES ('version','24'); CREATE TABLE cookies(creation_utc INTEGER NOT NULL,host_key TEXT NOT NULL,top_frame_site_key TEXT NOT NULL,name TEXT NOT NULL,value TEXT NOT NULL,encrypted_value BLOB NOT NULL,path TEXT NOT NULL,expires_utc INTEGER NOT NULL,is_secure INTEGER NOT NULL,is_httponly INTEGER NOT NULL,last_access_utc INTEGER NOT NULL,has_expires INTEGER NOT NULL,is_persistent INTEGER NOT NULL,priority INTEGER NOT NULL,samesite INTEGER NOT NULL,source_scheme INTEGER NOT NULL,source_port INTEGER NOT NULL,last_update_utc INTEGER NOT NULL,source_type INTEGER NOT NULL,has_cross_site_ancestor INTEGER NOT NULL); INSERT INTO cookies VALUES (1,'api.manus.im','','session_id','old',x'','/',2,1,1,1,1,1,1,1,2,443,1,0,0); INSERT INTO cookies VALUES (1,'other.example','','other','untouched',x'','/',2,1,1,1,1,1,1,1,2,443,1,0,0);").unwrap();
        // A database fixture must not query the runner's real Manus Keychain entry.
        let fixture_cipher =
            |_: &Path| Ok(super::super::electron_storage::test_ciphers().remove(1));
        set_cookie(&db, Path::new("unused"), Some("new"), fixture_cipher).unwrap();
        assert_eq!(
            cookie_value(&db, Path::new("unused"), fixture_cipher)
                .unwrap()
                .as_deref(),
            Some("new")
        );
        // Exercise all native encryption formats and Chromium's v24 host binding.
        for index in 0..3 {
            db.execute(
                "UPDATE cookies SET value='', encrypted_value=x'01' WHERE host_key=?1",
                [HOST],
            )
            .unwrap();
            let fixture_cipher =
                |_: &Path| Ok(super::super::electron_storage::test_ciphers().remove(index));
            set_cookie(
                &db,
                Path::new("unused"),
                Some("encrypted-token"),
                fixture_cipher,
            )
            .unwrap();
            assert_eq!(
                cookie_value(&db, Path::new("unused"), fixture_cipher)
                    .unwrap()
                    .as_deref(),
                Some("encrypted-token")
            );
            let (plain, encrypted): (String, Vec<u8>) = db
                .query_row(
                    "SELECT value,encrypted_value FROM cookies WHERE host_key=?1",
                    [HOST],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .unwrap();
            assert!(plain.is_empty());
            let key = fixture_cipher(Path::new("unused")).unwrap();
            let bytes = decrypt_bytes(&key, &encrypted).unwrap();
            assert_eq!(&bytes[..32], Sha256::digest(HOST.as_bytes()).as_slice());
            assert_eq!(&bytes[32..], b"encrypted-token");
            assert!(
                set_cookie(&db, Path::new("unused"), Some("replacement"), |_| Err(
                    "accountError.keychain".into()
                ))
                .is_err()
            );
            assert_eq!(
                cookie_value(&db, Path::new("unused"), fixture_cipher)
                    .unwrap()
                    .as_deref(),
                Some("encrypted-token")
            );
        }
        let other: String = db
            .query_row(
                "SELECT value FROM cookies WHERE host_key='other.example'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(other, "untouched");
    }

    #[test]
    fn missing_native_cookie_database_means_not_signed_in() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        assert!(native_session(&dir).unwrap().is_none());
        write_native(&dir, None).unwrap();
    }
}
