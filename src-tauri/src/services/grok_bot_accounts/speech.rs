//! Grok Bot's own saved catalog. Cursor and Grok Build stores are never consulted.
use super::{
    cipher, data_dir, decrypt, encrypt, identity, read, selected_team, store_path, summary, write,
    Account, Cipher, Saved, Store, ACCESS, ACCOUNT_LOCK, REFRESH,
};
use crate::services::cursor_accounts::speech::{refresh_pair, should_rotate};
use serde_json::{json, Value};
use std::path::Path;

pub(crate) async fn list_saved_accounts() -> Result<Vec<Account>, String> {
    list_saved_accounts_at(&store_path()?).await
}

async fn list_saved_accounts_at(path: &Path) -> Result<Vec<Account>, String> {
    let _guard = ACCOUNT_LOCK.lock().await;
    if !path.exists() {
        return Ok(vec![]);
    }
    let store: Store = read(path)?;
    Ok(store
        .iter()
        .map(|(id, entry)| Account {
            id: id.clone(),
            email: entry
                .email
                .as_deref()
                .filter(|email| !email.trim().is_empty())
                .unwrap_or("—")
                .to_owned(),
            active: false,
            usage: entry.usage.clone(),
        })
        .collect())
}

pub(crate) async fn speech_credentials(
    id: &str,
    rejected: Option<&Value>,
) -> Result<Value, String> {
    selected_credentials(id, rejected, false).await
}

pub(crate) async fn proxy_credentials(id: &str, force: bool) -> Result<Value, String> {
    selected_credentials(id, None, force).await
}

async fn selected_credentials(
    id: &str,
    rejected: Option<&Value>,
    force: bool,
) -> Result<Value, String> {
    let _guard = ACCOUNT_LOCK.lock().await;
    let path = store_path()?;
    let mut store: Store = read(&path)?;
    let key = cipher(&data_dir()?)?;
    let entry = store.get_mut(id).ok_or("accountError.invalidAccount")?;
    summary(id, &entry.row, None, &key)?;
    let mut token = decrypt(
        &key,
        entry.row.get(ACCESS).ok_or("accountError.invalidAccount")?,
    )?;
    let team = selected_team(&entry.row, &key)?;
    if should_rotate(&token, rejected, force)? {
        let refresh = decrypt(
            &key,
            entry
                .row
                .get(REFRESH)
                .ok_or("accountError.invalidAccount")?,
        )?;
        let rotated = refresh_pair(&refresh).await?;
        replace_pair(
            id,
            entry,
            &key,
            &rotated.access_token,
            &rotated.refresh_token,
        )?;
        token = rotated.access_token;
        write(&path, &store)?;
    }
    Ok(json!({"accessToken":token,"teamId":team}))
}

fn replace_pair(
    id: &str,
    entry: &mut Saved,
    key: &Cipher,
    access: &str,
    refresh: &str,
) -> Result<(), String> {
    if identity(access)? != id || refresh.is_empty() {
        return Err("accountError.invalidAccount".into());
    }
    let access = encrypt(key, access)?;
    let refresh = encrypt(key, refresh)?;
    entry.row.insert(ACCESS.into(), access);
    entry.row.insert(REFRESH.into(), refresh);
    entry.email = Some(summary(id, &entry.row, None, key)?.email);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use cbc::cipher::KeyInit;

    fn token(subject: &str) -> String {
        format!(
            "header.{}.signature",
            URL_SAFE_NO_PAD.encode(json!({"sub":subject,"exp":i64::MAX}).to_string())
        )
    }

    #[tokio::test]
    async fn saved_directory_reads_its_file_without_native_secrets_or_passive_writes() {
        let root =
            std::env::temp_dir().join(format!("grokbot-speech-saved-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("grokbot-accounts.json");
        assert!(!root.join("Grok Bot/sand-secrets.json").exists());
        assert!(list_saved_accounts_at(&path).await.unwrap().is_empty());
        assert!(!path.exists());
        let stored = json!({
            "cached-bot":{"row":{"cursor-access-token":"not-decryptable"},"applied":true,"email":"bot@example.test","usage":{"plan":"cached-bot-plan","remainingPercent":61.0,"resetAt":null}},
            "legacy-bot":{"row":{"cursor-access-token":"not-decryptable"},"applied":false},
            "blank-bot":{"row":{},"applied":false,"email":""}
        });
        std::fs::write(&path, serde_json::to_vec(&stored).unwrap()).unwrap();
        let before = std::fs::read(&path).unwrap();
        let legacy: Store = read(&path).unwrap();
        assert!(serde_json::to_value(&legacy).unwrap()["legacy-bot"]
            .get("email")
            .is_none());
        let rows = list_saved_accounts_at(&path).await.unwrap();
        assert_eq!(rows.len(), 3);
        let cached = rows.iter().find(|row| row.id == "cached-bot").unwrap();
        assert_eq!(cached.email, "bot@example.test");
        assert_eq!(
            cached.usage.as_ref().unwrap().plan.as_deref(),
            Some("cached-bot-plan")
        );
        assert_eq!(cached.usage.as_ref().unwrap().remaining_percent, Some(61.0));
        assert_eq!(
            rows.iter()
                .find(|row| row.id == "legacy-bot")
                .unwrap()
                .email,
            "—"
        );
        assert_eq!(
            rows.iter().find(|row| row.id == "blank-bot").unwrap().email,
            "—"
        );
        assert!(rows.iter().all(|row| !row.active));
        assert_eq!(before, std::fs::read(&path).unwrap());
        assert!(!serde_json::to_string(&rows)
            .unwrap()
            .contains("not-decryptable"));
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        std::fs::write(&path, b"bad-json").unwrap();
        assert!(list_saved_accounts_at(&path).await.is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"bad-json");
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_dir(&root).unwrap();
    }

    #[test]
    fn saved_rows_and_rotation_are_isolated_and_preserve_team_profile_and_cached_usage() {
        let key = Cipher::Gcm(Box::new(
            aes_gcm::Aes256Gcm::new_from_slice(&[9; 32]).unwrap(),
        ));
        let access = token("bot");
        let id = identity(&access).unwrap();
        let (_, row) = super::super::login_row(
            &json!({"accessToken":access,"refreshToken":"old","selectedTeamId":42}),
            &key,
        )
        .unwrap();
        let mut entry = Saved {
            row,
            applied: false,
            email: None,
            usage: Some(crate::services::cursor_usage::Usage {
                plan: Some("saved-plan".into()),
                ..Default::default()
            }),
        };
        let profile = entry.row[super::super::PROFILE].clone();
        let before = serde_json::to_vec(&entry).unwrap();
        assert!(replace_pair(&id, &mut entry, &key, &token("cursor-other"), "wrong").is_err());
        assert_eq!(before, serde_json::to_vec(&entry).unwrap());
        replace_pair(
            &id,
            &mut entry,
            &key,
            &format!("{access}rotated"),
            "new-refresh",
        )
        .unwrap();
        assert_eq!(decrypt(&key, &entry.row[REFRESH]).unwrap(), "new-refresh");
        assert_eq!(entry.row[super::super::PROFILE], profile);
        assert_eq!(entry.email.as_deref(), Some("bot"));
        assert_eq!(selected_team(&entry.row, &key).unwrap(), Some(42));
        assert!(!entry.applied);
        assert_eq!(
            entry.usage.as_ref().unwrap().plan.as_deref(),
            Some("saved-plan")
        );
        let encoded = serde_json::to_string(&entry).unwrap();
        assert!(!encoded.contains("new-refresh"));
        assert!(!encoded.contains(&access));
    }
}
