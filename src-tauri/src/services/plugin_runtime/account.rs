use super::*;
use std::process::Stdio;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const MAX_MESSAGE: usize = 1024 * 1024;

struct ActiveWorker<'a> {
    runtime: &'a PluginRuntime,
    key: (String, String),
}

impl Drop for ActiveWorker<'_> {
    fn drop(&mut self) {
        if let Some(token) = self.runtime.workers.lock().unwrap().remove(&self.key) {
            token.cancel();
        }
    }
}

impl PluginRuntime {
    pub async fn account_operation(
        &self,
        manager: &PluginManager,
        id: &str,
        provider_id: &str,
        operation: &str,
        params: Value,
    ) -> Result<Value, String> {
        let generation = super::super::developer_preview::token()?;
        let plugin = manager
            .list()?
            .into_iter()
            .find(|plugin| plugin.id == id)
            .ok_or("Account plugin is not installed")?;
        if !plugin.enabled {
            return Err("Account plugin is disabled".into());
        }
        let root = manager.package_root(&plugin)?;
        let manifest = super::super::plugin_manager::manifest::Manifest::read(&root)?;
        if manifest != plugin.manifest {
            return Err("Installed plugin manifest changed".into());
        }
        let provider = manifest
            .echobird
            .contributes
            .providers
            .iter()
            .find(|provider| provider.id == provider_id)
            .ok_or("Unknown account plugin provider")?;
        if !provider
            .operations
            .iter()
            .any(|declared| declared == operation)
        {
            return Err("Account plugin operation was not declared".into());
        }
        let worker = manifest
            .echobird
            .worker
            .as_ref()
            .ok_or("Account plugin has no code module")?;
        if worker.runtime.as_deref() == Some("native") || !manifest.tools().is_empty() {
            let application = provider
                .applications
                .first()
                .ok_or("Account plugin has no application")?;
            return super::super::plugin_accounts::call(application, operation, params).await;
        }
        let request_id = uuid::Uuid::new_v4().to_string();
        let request = json!({
            "jsonrpc": "2.0", "id": request_id,
            "method": operation,
            "params": {"providerId": provider_id, "input": params}
        });
        let bytes = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
        if bytes.len() > MAX_MESSAGE {
            return Err("Account plugin request exceeds 1 MiB".into());
        }
        let key = (id.to_string(), request_id.clone());
        let cancelled = CancellationToken::new();
        {
            let mut workers = self.workers.lock().unwrap();
            if generation.is_cancelled() || workers.keys().any(|(plugin, _)| plugin == id) {
                return Err("Account plugin is paused or already processing an operation".into());
            }
            workers.insert(key.clone(), cancelled.clone());
        }
        let _active = ActiveWorker { runtime: self, key };
        let current = manager
            .list()?
            .into_iter()
            .find(|current| current.id == id)
            .ok_or("Account plugin was removed")?;
        if !current.enabled || current.directory != plugin.directory {
            return Err("Account plugin changed before the operation".into());
        }
        let result = tokio::select! {
            biased;
            _ = generation.cancelled() => Err("Developer preview is paused".into()),
            _ = cancelled.cancelled() => Err("Account plugin operation was cancelled".into()),
            result = run(&root, &worker.entry, bytes, &request_id) => result,
        };
        result
    }
}

async fn run(
    root: &std::path::Path,
    entry: &str,
    mut request: Vec<u8>,
    request_id: &str,
) -> Result<Value, String> {
    // Code modules run as trusted native-user code; this process boundary is not a sandbox.
    let node = which::which("node").map_err(|_| "Node.js is required for account code modules")?;
    let mut command = crate::utils::process::async_command(node);
    command.env_clear();
    for key in [
        "SystemRoot",
        "WINDIR",
        "PATH",
        "PATHEXT",
        "TEMP",
        "TMP",
        "TMPDIR",
        "HOME",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
    ] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    let mut child = command
        .args(["--no-warnings", "--"])
        .arg(root.join(entry))
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "Could not start the account code module")?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or("Account module input is unavailable")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Account module output is unavailable")?;
    request.push(b'\n');
    let exchange = async {
        let write = async {
            stdin
                .write_all(&request)
                .await
                .map_err(|_| "Account module input failed")?;
            drop(stdin);
            Ok::<_, String>(())
        };
        let read = async {
            let mut bytes = Vec::new();
            stdout
                .take((MAX_MESSAGE + 1) as u64)
                .read_to_end(&mut bytes)
                .await
                .map_err(|_| "Account module output failed")?;
            if bytes.len() > MAX_MESSAGE {
                return Err("Account module response exceeds 1 MiB".to_string());
            }
            Ok(bytes)
        };
        let (_, bytes) = tokio::try_join!(write, read)?;
        if !child
            .wait()
            .await
            .map_err(|_| "Account module wait failed")?
            .success()
        {
            return Err("Account code module failed".into());
        }
        parse_response(&bytes, request_id)
    };
    tokio::time::timeout(Duration::from_secs(120), exchange)
        .await
        .map_err(|_| "Account code module timed out")?
}

fn parse_response(bytes: &[u8], request_id: &str) -> Result<Value, String> {
    let response: Value =
        serde_json::from_slice(bytes).map_err(|_| "Invalid account module response")?;
    if response.get("jsonrpc").and_then(Value::as_str) != Some("2.0")
        || response.get("id").and_then(Value::as_str) != Some(request_id)
        || response.get("error").is_some() == response.get("result").is_some()
    {
        return Err("Account module response does not match its request".into());
    }
    if response.get("error").is_some() {
        // Provider failures may include secrets; UI-safe errors are normalized by the host.
        return Err("Account plugin reported an operation failure".into());
    }
    Ok(response["result"].clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn response_identity_and_result_are_required() {
        assert_eq!(
            parse_response(br#"{"jsonrpc":"2.0","id":"one","result":[]}"#, "one").unwrap(),
            json!([])
        );
        for bytes in [
            br#"{"jsonrpc":"2.0","id":"other","result":[]}"#.as_slice(),
            br#"{"jsonrpc":"2.0","id":"one","error":{},"result":[]}"#.as_slice(),
            br#"{"jsonrpc":"2.0","id":"one"}"#.as_slice(),
        ] {
            assert!(parse_response(bytes, "one").is_err());
        }
    }

    #[test]
    fn pausing_the_host_cancels_registered_code_operations() {
        let runtime = PluginRuntime::default();
        let token = CancellationToken::new();
        runtime
            .workers
            .lock()
            .unwrap()
            .insert(("fixture.account".into(), "one".into()), token.clone());
        runtime.pause_sessions();
        assert!(token.is_cancelled());
        assert!(runtime.workers.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn code_module_process_reads_one_request_without_a_window() {
        if which::which("node").is_err() {
            return;
        }
        let directory =
            std::env::temp_dir().join(format!("echobird-code-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        struct TestDirectory(std::path::PathBuf);
        impl Drop for TestDirectory {
            fn drop(&mut self) {
                assert!(self.0.parent().unwrap() == std::env::temp_dir());
                std::fs::remove_file(self.0.join("account.mjs")).unwrap();
                std::fs::remove_dir(&self.0).unwrap();
            }
        }
        let _cleanup = TestDirectory(directory.clone());
        std::fs::write(
            directory.join("account.mjs"),
            r#"
import readline from 'node:readline';
for await (const line of readline.createInterface({input:process.stdin})) {
    const request = JSON.parse(line);
    console.log(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{
        provider:request.params.providerId,
        method:request.method,
        leakedEnvironment:!!process.env.ECHOBIRD_PRIVATE_TEST
    }}));
}
"#,
        )
        .unwrap();
        let request = serde_json::to_vec(&json!({
            "jsonrpc":"2.0","id":"one","method":"accounts",
            "params":{"providerId":"fixture"}
        }))
        .unwrap();
        let result = run(&directory, "account.mjs", request, "one")
            .await
            .unwrap();
        assert_eq!(result["provider"], "fixture");
        assert_eq!(result["method"], "accounts");
        assert_eq!(result["leakedEnvironment"], false);
    }
}
