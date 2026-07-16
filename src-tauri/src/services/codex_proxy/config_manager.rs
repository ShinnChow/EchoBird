// Codex config + relay file management — port of tools/codex/lib/config-manager.cjs.
//
// Two filesystem locations:
//
//   ~/.codex/config.toml        ← Codex's own config. We own its shape
//                                 end-to-end (canonical 13-line template
//                                 with base_url = http://127.0.0.1:53682/v1
//                                 and wire_api = "responses"). `apply_codex`
//                                 in tool_config_manager.rs writes this
//                                 whenever Codex is selected; this module
//                                 provides a defensive read-and-rewrite-
//                                 if-drifted helper used by
//                                 `process_manager::start_codex_native`
//                                 as a pre-spawn self-heal.
//
//   ~/.echobird/codex.json      ← The relay file. EchoBird writes the
//                                 currently-selected model / API key /
//                                 upstream base_url here, and the proxy
//                                 reads it FRESH on every incoming
//                                 request so model switches take effect
//                                 without restarting Codex or the proxy.
//
// Both paths can be overridden via env vars for tests:
//   ECHOBIRD_CODEX_CONFIG_DIR  → overrides ~/.codex
//   ECHOBIRD_RELAY_DIR         → overrides ~/.echobird
//
// The path-derivation helpers are split from the IO helpers so the IO
// layer is testable with explicit paths.

use serde_json::Value;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use super::CODEX_PROXY_PORT;

/// File name (under the relay dir) where EchoBird writes the
/// currently-selected Codex upstream config.
pub const RELAY_FILENAME: &str = "codex.json";

/// File name (under the Codex dir) Codex reads at startup. Used by
/// `process_manager.rs::start_codex_native` to address `~/.codex/config.toml`
/// for the pre-spawn self-heal check.
pub const CODEX_CONFIG_FILENAME: &str = "config.toml";

/// The base_url Codex sees. The same value is baked into
/// `apply_codex` over in `tool_config_manager.rs` — keep them in sync.
#[allow(dead_code)]
pub fn codex_proxy_url() -> String {
    format!("http://127.0.0.1:{CODEX_PROXY_PORT}/v1")
}

/// The exact 13-line config.toml shape we own. Codex must see this
/// verbatim — any drift (different model id, missing review_model,
/// changed wire_api) breaks the protocol bridge. `apply_codex` writes
/// the same template, and `ensure_canonical_config` rewrites if drift
/// is detected.
#[allow(dead_code)]
pub fn canonical_config_toml() -> String {
    format!(
        "model_provider = \"OpenAI\"\n\
         model = \"gpt-5.5\"\n\
         review_model = \"gpt-5.5\"\n\
         model_reasoning_effort = \"high\"\n\
         disable_response_storage = true\n\
         model_context_window = 1000000\n\
         model_auto_compact_token_limit = 900000\n\
         \n\
         [model_providers.OpenAI]\n\
         name = \"OpenAI\"\n\
         base_url = \"{url}\"\n\
         wire_api = \"responses\"\n\
         requires_openai_auth = true\n",
        url = codex_proxy_url()
    )
}

/// Default Codex config directory: env override → `~/.codex`. Called
/// by `process_manager.rs::start_codex_native` to locate the canonical
/// config + global-state files before spawning Codex.
pub fn default_codex_dir() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("ECHOBIRD_CODEX_CONFIG_DIR") {
        if !p.is_empty() {
            return Some(PathBuf::from(p));
        }
    }
    dirs::home_dir().map(|h| h.join(".codex"))
}

/// Default relay directory: env override → `~/.echobird`.
pub fn default_relay_dir() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("ECHOBIRD_RELAY_DIR") {
        if !p.is_empty() {
            return Some(PathBuf::from(p));
        }
    }
    dirs::home_dir().map(|h| h.join(".echobird"))
}

/// Outcome of `ensure_canonical_config`. The `reason` field is a stable
/// tag suitable for logging / tests.
#[derive(Debug, PartialEq, Eq)]
pub struct EnsureOutcome {
    pub wrote: bool,
    pub reason: &'static str,
}

/// Verify config.toml at `codex_config_path` points Codex at our proxy.
/// If missing or drifted, rewrite it to the canonical template.
/// Idempotent: cheap when already correct, self-healing when not.
/// Called by `process_manager.rs::start_codex_native` as a pre-spawn
/// self-heal in case the file got edited outside EchoBird.
///
/// Relay-mode exception: when the relay file at `relay_config_path`
/// carries `relayMode: true`, the user has chosen to bypass our proxy
/// and point Codex straight at the upstream. The canonical "must
/// contain 127.0.0.1:53682" rule no longer applies — the real upstream
/// URL is what we wrote on purpose. Skip the drift check entirely in
/// that case so we don't undo the user's choice. Passing the relay
/// path explicitly (rather than re-deriving via env vars) keeps tests
/// hermetic.
pub fn ensure_canonical_config(
    codex_config_path: &Path,
    relay_config_path: &Path,
) -> io::Result<EnsureOutcome> {
    if relay_mode_active(relay_config_path) {
        return Ok(EnsureOutcome {
            wrote: false,
            reason: "relay-mode-skip",
        });
    }

    let template = canonical_config_toml();
    let proxy_url = codex_proxy_url();
    let provider_section = "[model_providers.OpenAI]";

    // File missing → bootstrap with the full canonical template.
    let existing = match fs::read_to_string(codex_config_path) {
        Ok(c) => c,
        Err(_) => {
            if let Some(parent) = codex_config_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(codex_config_path, template)?;
            return Ok(EnsureOutcome {
                wrote: true,
                reason: "missing",
            });
        }
    };

    let had_section = existing.contains(provider_section);

    // Canonicalize ALL 11 fields we own — overwrite-in-place if present,
    // insert if missing. Codex's own runtime state ([projects.*] /
    // [tui.*] / [plugins.*]) and unrelated user-edited top-level keys
    // (e.g. `hide_agent_reasoning`) are preserved. Same helper
    // `apply_codex` uses on every model switch, so both code paths agree
    // on canonical shape — no drift between "user applied a model" and
    // "Codex was spawned cold".
    let new_content =
        crate::services::tool_config_manager::write_codex_canonical_fields(&existing, &proxy_url);

    if new_content == existing {
        return Ok(EnsureOutcome {
            wrote: false,
            reason: "already-canonical",
        });
    }

    if let Some(parent) = codex_config_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(codex_config_path, new_content)?;
    Ok(EnsureOutcome {
        wrote: true,
        // "missing-section" = file existed but our provider section did
        //   not (a sibling tool overwrote it, or the user hand-edited).
        // "drifted" = section was there but at least one of our 11
        //   canonical fields was wrong (stale base_url from a previous
        //   relay-mode session, sibling tool flipped wire_api, etc.).
        reason: if had_section {
            "drifted"
        } else {
            "missing-section"
        },
    })
}

/// Read the relay file and return whether `relayMode` is truthy.
/// Returns false on any error (missing file, malformed JSON, missing
/// key) — the canonical-self-heal path is the safe default.
fn relay_mode_active(relay_config_path: &Path) -> bool {
    let Some(v) = read_echobird_relay(relay_config_path) else {
        return false;
    };
    v.get("relayMode")
        .and_then(|x| x.as_bool())
        .unwrap_or(false)
}

/// Read the relay file fresh. Called by the proxy on EVERY incoming
/// request so model switches take effect without restarting anything:
/// EchoBird's `apply_codex` rewrites this JSON, and the next request
/// the proxy sees uses the new model / key / upstream URL.
///
/// Returns None if the file is missing or malformed — caller should
/// respond with a clear error to Codex.
pub fn read_echobird_relay(relay_config_path: &Path) -> Option<Value> {
    let content = fs::read_to_string(relay_config_path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Detect the official OpenAI host. Used by the proxy to skip the
/// model-id rewrite for real OpenAI calls (OpenAI's `/responses`
/// endpoint already accepts Codex's request shape verbatim).
pub fn is_openai(url: &str) -> bool {
    !url.is_empty() && url.contains("api.openai.com")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn unique_tmpdir(label: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let dir = std::env::temp_dir().join(format!("echobird_cfg_{label}_{pid}_{n}"));
        fs::create_dir_all(&dir).expect("tmpdir create");
        dir
    }

    // ---- canonical_config_toml ----

    #[test]
    fn canonical_template_contains_proxy_url() {
        let t = canonical_config_toml();
        assert!(t.contains("127.0.0.1:53682"), "got: {t}");
        assert!(t.contains("wire_api = \"responses\""), "got: {t}");
        assert!(t.contains("model = \"gpt-5.5\""), "got: {t}");
        assert!(t.contains("[model_providers.OpenAI]"), "got: {t}");
    }

    #[test]
    fn canonical_template_is_13_content_lines() {
        // The template was historically described as "13 lines". Verify
        // the line count stays stable so accidental edits get caught.
        let t = canonical_config_toml();
        let lines: Vec<&str> = t.lines().collect();
        // 7 top-level + 1 blank + 5 provider block = 13 lines, plus
        // the trailing newline. (Dropped `network_access` — was a dead
        // line: wrong location, wrong type, also overridden by
        // sandbox_mode = "danger-full-access".)
        assert_eq!(lines.len(), 13, "got {} lines: {t}", lines.len());
    }

    // ---- ensure_canonical_config ----

    /// Build a relay path that does NOT exist so `relay_mode_active`
    /// returns false. Use this whenever the test exercises the
    /// canonical-self-heal path, not the relay-mode bypass.
    fn missing_relay_path(dir: &Path) -> PathBuf {
        dir.join("nonexistent-relay.json")
    }

    #[test]
    fn ensure_writes_when_file_missing() {
        let dir = unique_tmpdir("missing");
        let cfg = dir.join(CODEX_CONFIG_FILENAME);
        assert!(!cfg.exists());

        let out = ensure_canonical_config(&cfg, &missing_relay_path(&dir)).expect("ok");
        assert_eq!(out.reason, "missing");
        assert!(out.wrote);
        let written = fs::read_to_string(&cfg).unwrap();
        assert!(written.contains("127.0.0.1:53682"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ensure_no_op_when_already_canonical() {
        let dir = unique_tmpdir("canonical");
        let cfg = dir.join(CODEX_CONFIG_FILENAME);
        fs::write(&cfg, canonical_config_toml()).unwrap();

        let out = ensure_canonical_config(&cfg, &missing_relay_path(&dir)).expect("ok");
        assert_eq!(out.reason, "already-canonical");
        assert!(!out.wrote);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ensure_rewrites_when_drifted() {
        let dir = unique_tmpdir("drifted");
        let cfg = dir.join(CODEX_CONFIG_FILENAME);
        // Drifted shape: full provider section present, but base_url
        // points at a third-party upstream rather than the proxy.
        // This is the typical post-relay-toggle-off state.
        fs::write(
            &cfg,
            "model_provider = \"OpenAI\"\n\
             model = \"gpt-5.5\"\n\
             \n\
             [model_providers.OpenAI]\n\
             name = \"OpenAI\"\n\
             base_url = \"https://api.openai.com/v1\"\n\
             wire_api = \"responses\"\n\
             \n\
             [projects.\"/home/user/work\"]\n\
             trust_level = \"trusted\"\n",
        )
        .unwrap();

        let out = ensure_canonical_config(&cfg, &missing_relay_path(&dir)).expect("ok");
        assert_eq!(out.reason, "drifted");
        assert!(out.wrote);
        let written = fs::read_to_string(&cfg).unwrap();
        // base_url surgically swapped to the proxy URL.
        assert!(written.contains("127.0.0.1:53682"));
        assert!(!written.contains("api.openai.com"));
        // Codex's [projects.*] trust state survives — the whole point
        // of going surgical instead of full-template rewrite.
        assert!(written.contains("[projects.\"/home/user/work\"]"));
        assert!(written.contains("trust_level = \"trusted\""));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ensure_appends_when_section_missing() {
        // File exists but has no [model_providers.OpenAI] section yet
        // (e.g. fresh user with custom top-level keys, never run Codex
        // through EchoBird). Old behaviour was "drift → wipe", new
        // behaviour is "missing-section → append, preserve existing".
        let dir = unique_tmpdir("missingsec");
        let cfg = dir.join(CODEX_CONFIG_FILENAME);
        fs::write(
            &cfg,
            "# user's hand-written config\nhide_agent_reasoning = true\n",
        )
        .unwrap();

        let out = ensure_canonical_config(&cfg, &missing_relay_path(&dir)).expect("ok");
        assert_eq!(out.reason, "missing-section");
        assert!(out.wrote);
        let written = fs::read_to_string(&cfg).unwrap();
        // User's existing content preserved.
        assert!(written.contains("# user's hand-written config"));
        assert!(written.contains("hide_agent_reasoning = true"));
        // Our section appended.
        assert!(written.contains("[model_providers.OpenAI]"));
        assert!(written.contains("127.0.0.1:53682"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ensure_creates_parent_dir_if_missing() {
        let dir = unique_tmpdir("nested");
        // Two levels of non-existent subdirs.
        let cfg = dir.join("sub1").join("sub2").join(CODEX_CONFIG_FILENAME);
        let out = ensure_canonical_config(&cfg, &missing_relay_path(&dir)).expect("ok");
        assert_eq!(out.reason, "missing");
        assert!(cfg.exists());

        fs::remove_dir_all(&dir).ok();
    }

    // ---- relay-mode bypass ----

    #[test]
    fn ensure_skips_drift_when_relay_mode_active() {
        // Relay mode = user has chosen to point Codex straight at the
        // real upstream. We must NOT undo that by rewriting back to
        // the 127.0.0.1 canonical, regardless of what's in config.toml.
        let dir = unique_tmpdir("relayskip");
        let cfg = dir.join(CODEX_CONFIG_FILENAME);
        let relay = dir.join(RELAY_FILENAME);

        // config.toml that would otherwise be "drifted" (points at
        // a third-party upstream, not our proxy).
        fs::write(
            &cfg,
            "model_provider = \"OpenAI\"\n\
             base_url = \"https://cc-vibe.com/v1\"\n",
        )
        .unwrap();
        // Relay file flags relay mode.
        fs::write(
            &relay,
            serde_json::json!({
                "baseUrl": "https://cc-vibe.com/v1",
                "relayMode": true,
            })
            .to_string(),
        )
        .unwrap();

        let out = ensure_canonical_config(&cfg, &relay).expect("ok");
        assert_eq!(out.reason, "relay-mode-skip");
        assert!(!out.wrote);
        // config.toml left alone.
        let after = fs::read_to_string(&cfg).unwrap();
        assert!(after.contains("cc-vibe.com"));
        assert!(!after.contains("127.0.0.1:53682"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ensure_self_heals_when_relay_mode_false() {
        // relayMode: false explicitly — same behavior as no relay
        // file at all: canonical-self-heal applies (surgical drift fix,
        // since the provider section is present).
        let dir = unique_tmpdir("relayfalse");
        let cfg = dir.join(CODEX_CONFIG_FILENAME);
        let relay = dir.join(RELAY_FILENAME);
        fs::write(
            &cfg,
            "model_provider = \"OpenAI\"\n\
             [model_providers.OpenAI]\n\
             base_url = \"https://api.openai.com/v1\"\n",
        )
        .unwrap();
        fs::write(
            &relay,
            serde_json::json!({
                "baseUrl": "https://api.openai.com/v1",
                "relayMode": false,
            })
            .to_string(),
        )
        .unwrap();

        let out = ensure_canonical_config(&cfg, &relay).expect("ok");
        assert_eq!(out.reason, "drifted");
        assert!(out.wrote);
        let after = fs::read_to_string(&cfg).unwrap();
        assert!(after.contains("127.0.0.1:53682"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ensure_self_heals_when_relay_file_malformed() {
        // Garbage in relay file → relayMode treated as false → drift
        // check runs as normal. Don't accidentally fail open.
        let dir = unique_tmpdir("relaybad2");
        let cfg = dir.join(CODEX_CONFIG_FILENAME);
        let relay = dir.join(RELAY_FILENAME);
        fs::write(
            &cfg,
            "model_provider = \"OpenAI\"\n\
             [model_providers.OpenAI]\n\
             base_url = \"https://api.openai.com/v1\"\n",
        )
        .unwrap();
        fs::write(&relay, "not-json-at-all{").unwrap();

        let out = ensure_canonical_config(&cfg, &relay).expect("ok");
        assert_eq!(out.reason, "drifted");
        assert!(out.wrote);

        fs::remove_dir_all(&dir).ok();
    }

    // ---- read_echobird_relay ----

    #[test]
    fn relay_returns_none_when_file_missing() {
        let dir = unique_tmpdir("relaymiss");
        let p = dir.join(RELAY_FILENAME);
        assert_eq!(read_echobird_relay(&p), None);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn relay_returns_parsed_json_when_present() {
        // Use the same field names apply_codex actually writes:
        // baseUrl / apiKey / actualModel / modelName / providerId.
        // `read_echobird_relay` just parses to Value — the camelCase
        // contract lives in server.rs::read_relay_or_error — but the
        // test fixture should reflect real schema so a schema
        // regression in apply_codex would also flag this test.
        let dir = unique_tmpdir("relayok");
        let p = dir.join(RELAY_FILENAME);
        let payload = json!({
            "baseUrl": "https://api.deepseek.com/v1",
            "apiKey": "sk-test",
            "actualModel": "deepseek-chat",
            "modelName": "deepseek-chat",
            "providerId": "OpenAI",
        });
        fs::write(&p, serde_json::to_string(&payload).unwrap()).unwrap();

        let out = read_echobird_relay(&p).expect("some");
        assert_eq!(out["baseUrl"], "https://api.deepseek.com/v1");
        assert_eq!(out["apiKey"], "sk-test");
        assert_eq!(out["actualModel"], "deepseek-chat");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn relay_returns_none_when_malformed_json() {
        let dir = unique_tmpdir("relaybad");
        let p = dir.join(RELAY_FILENAME);
        fs::write(&p, "not-json-at-all{").unwrap();
        assert_eq!(read_echobird_relay(&p), None);
        fs::remove_dir_all(&dir).ok();
    }

    // ---- is_openai ----

    #[test]
    fn is_openai_matches_official_host() {
        assert!(is_openai("https://api.openai.com/v1"));
        assert!(is_openai("https://api.openai.com/v1/chat/completions"));
    }

    #[test]
    fn is_openai_rejects_third_party_hosts() {
        assert!(!is_openai("https://api.deepseek.com/v1"));
        assert!(!is_openai("https://api.minimax.io/v1"));
        assert!(!is_openai("http://127.0.0.1:53682/v1"));
    }

    #[test]
    fn is_openai_rejects_empty_string() {
        assert!(!is_openai(""));
    }

    // ---- sibling-tool tamper recovery ----

    #[test]
    fn ensure_recovers_when_sibling_tool_flipped_top_level_provider() {
        // Scenario: cc-switch (or similar) rewrote model_provider to a
        // different provider and changed model to that provider's id.
        // Our [model_providers.OpenAI] section is intact. Pre-fix, an
        // apply / pre-spawn check that only touched base_url would
        // leave the wrong top-level pointer in place; Codex would read
        // the sibling tool's `model_provider = "anthropic"` and not
        // find a matching [model_providers.anthropic] section.
        let dir = unique_tmpdir("sibling_top");
        let cfg = dir.join(CODEX_CONFIG_FILENAME);
        fs::write(
            &cfg,
            "model_provider = \"anthropic\"\n\
             model = \"claude-sonnet-4-6\"\n\
             \n\
             [model_providers.OpenAI]\n\
             name = \"OpenAI\"\n\
             base_url = \"http://127.0.0.1:53682/v1\"\n\
             wire_api = \"responses\"\n\
             requires_openai_auth = true\n\
             \n\
             [projects.\"/home/user/work\"]\n\
             trust_level = \"trusted\"\n",
        )
        .unwrap();

        let out = ensure_canonical_config(&cfg, &missing_relay_path(&dir)).expect("ok");
        assert!(out.wrote);
        let after = fs::read_to_string(&cfg).unwrap();
        // Top-level keys restored.
        assert!(after.contains("model_provider = \"OpenAI\""));
        assert!(after.contains("model = \"gpt-5.5\""));
        assert!(!after.contains("anthropic"));
        assert!(!after.contains("claude-sonnet-4-6"));
        // Codex runtime state preserved.
        assert!(after.contains("[projects.\"/home/user/work\"]"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ensure_recovers_when_sibling_tool_flipped_provider_table_keys() {
        // Scenario: sibling tool kept [model_providers.OpenAI] but
        // rewrote wire_api / requires_openai_auth inside. Pre-fix, an
        // apply that only touched base_url would leave wire_api =
        // "chat" + requires_openai_auth = false, and Codex would talk
        // Chat-Completions wire to us — completely breaking the Codex
        // CLI / Desktop integration.
        let dir = unique_tmpdir("sibling_table");
        let cfg = dir.join(CODEX_CONFIG_FILENAME);
        fs::write(
            &cfg,
            "model_provider = \"OpenAI\"\n\
             model = \"gpt-5.5\"\n\
             \n\
             [model_providers.OpenAI]\n\
             name = \"Anthropic\"\n\
             base_url = \"http://127.0.0.1:53682/v1\"\n\
             wire_api = \"chat\"\n\
             requires_openai_auth = false\n",
        )
        .unwrap();

        let out = ensure_canonical_config(&cfg, &missing_relay_path(&dir)).expect("ok");
        assert!(out.wrote);
        let after = fs::read_to_string(&cfg).unwrap();
        assert!(after.contains("name = \"OpenAI\""));
        assert!(after.contains("wire_api = \"responses\""));
        assert!(after.contains("requires_openai_auth = true"));
        assert!(!after.contains("wire_api = \"chat\""));
        assert!(!after.contains("requires_openai_auth = false"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ensure_recovers_when_top_level_canonical_keys_missing() {
        // Scenario: file has the OpenAI section + correct base_url but
        // the top-level keys we own (model_reasoning_effort,
        // disable_response_storage, model_context_window,
        // model_auto_compact_token_limit, review_model) are missing —
        // a sibling tool wrote a minimal "just enough for them" config.
        // Pre-fix, "section present + base_url right" returned
        // already-canonical without checking these — Codex would use
        // its own defaults for reasoning effort + context window,
        // user-visible behavior would silently diverge.
        let dir = unique_tmpdir("missing_topkeys");
        let cfg = dir.join(CODEX_CONFIG_FILENAME);
        fs::write(
            &cfg,
            "model_provider = \"OpenAI\"\n\
             model = \"gpt-5.5\"\n\
             \n\
             [model_providers.OpenAI]\n\
             name = \"OpenAI\"\n\
             base_url = \"http://127.0.0.1:53682/v1\"\n\
             wire_api = \"responses\"\n\
             requires_openai_auth = true\n",
        )
        .unwrap();

        let out = ensure_canonical_config(&cfg, &missing_relay_path(&dir)).expect("ok");
        assert!(out.wrote);
        let after = fs::read_to_string(&cfg).unwrap();
        assert!(after.contains("model_reasoning_effort = \"high\""));
        assert!(after.contains("disable_response_storage = true"));
        assert!(after.contains("model_context_window = 1000000"));
        assert!(after.contains("model_auto_compact_token_limit = 900000"));
        assert!(after.contains("review_model = \"gpt-5.5\""));

        fs::remove_dir_all(&dir).ok();
    }
}
