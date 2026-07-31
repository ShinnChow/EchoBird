//! "我的AI生涯" (My AI Career) data layer — cross-tool session history +
//! contribution heatmap. Ported from Coffee CLI's `server.rs` history
//! scanner, trimmed to four first-class tool families.
//!
//! Each family reads its on-disk session store DIRECTLY (independent of
//! EchoBird's tool detection — we just scan the four well-known roots).
//! Desktop and CLI variants of a family share one session store, so they
//! fold into a single family here (e.g. EchoBird's `claudecode` +
//! `claudedesktop` tool ids both map to the `Claude` family →
//! `~/.claude/projects`).
//!
//! | Family   | Root                              | Shape                  |
//! |----------|-----------------------------------|------------------------|
//! | Claude   | `~/.claude/projects`              | JSONL, depth 2         |
//! | Codex    | `~/.codex/sessions`               | JSONL rollout, depth 4 |
//! | OpenCode | `~/.local/share/opencode`         | SQLite (`opencode.db`) |
//! | Hermes   | `<HERMES_HOME>/state.db`          | SQLite (`state.db`)    |
//! | MiMo     | `~/.local/share/mimocode`         | SQLite (`mimocode.db`) |
//!
//! Two surfaces consume this: the per-family history list (paginated, one
//! family at a time — keeps the payload small) and the contribution heatmap
//! (all four families aggregated, 210-day lookback, on-disk count cache).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

// ─── Tool families ───────────────────────────────────────────────────────

/// The first-class families. CLI + desktop variants fold into one. MiMo Code is
/// Xiaomi's OpenCode fork (same Drizzle/SQLite store, different data dir + db
/// name) — it rides the same reader as OpenCode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Family {
    Claude,
    Codex,
    OpenCode,
    Hermes,
    MiMo,
}

impl Family {
    pub const ALL: [Family; 5] = [
        Family::Claude,
        Family::Codex,
        Family::OpenCode,
        Family::Hermes,
        Family::MiMo,
    ];

    /// Stable id used in the IPC payload + frontend family cards.
    pub fn as_id(self) -> &'static str {
        match self {
            Family::Claude => "claude",
            Family::Codex => "codex",
            Family::OpenCode => "opencode",
            Family::Hermes => "hermes",
            Family::MiMo => "mimo",
        }
    }

    pub fn from_id(s: &str) -> Option<Self> {
        match s {
            "claude" => Some(Family::Claude),
            "codex" => Some(Family::Codex),
            "opencode" => Some(Family::OpenCode),
            "hermes" => Some(Family::Hermes),
            "mimo" => Some(Family::MiMo),
            _ => None,
        }
    }

    /// JSONL scan depth for the file-walking families; `None` for the SQLite
    /// families (OpenCode, MiMo, Hermes) that bypass the mtime-then-parse
    /// pipeline.
    fn jsonl_depth(self) -> Option<u8> {
        match self {
            Family::Claude => Some(2), // ~/.claude/projects/<hash>/<hash>.jsonl
            Family::Codex => Some(4),  // ~/.codex/sessions/<Y>/<M>/<D>/rollout-*.jsonl
            Family::OpenCode | Family::Hermes | Family::MiMo => None,
        }
    }

    /// On-disk session-store root for this family.
    fn root(self, home: &Path) -> PathBuf {
        match self {
            Family::Claude => home.join(".claude").join("projects"),
            Family::Codex => home.join(".codex").join("sessions"),
            Family::OpenCode => home.join(".local").join("share").join("opencode"),
            Family::Hermes => hermes_home(),
            // MiMo Code (Xiaomi's OpenCode fork) — `~/.local/share/mimocode`,
            // same `.local/share/<app>` pattern as OpenCode (db = mimocode.db).
            Family::MiMo => home.join(".local").join("share").join("mimocode"),
        }
    }
}

/// Resolve Hermes Agent's data root. macOS/Linux use `~/.hermes`; Windows
/// uses `%LOCALAPPDATA%\hermes` (the official installer's choice); an
/// absolute `$HERMES_HOME` overrides both. Mirrors Coffee CLI's
/// `tools::hermes::hermes_home`.
fn hermes_home() -> PathBuf {
    if let Ok(v) = std::env::var("HERMES_HOME") {
        let trimmed = v.trim();
        if !trimmed.is_empty() {
            let candidate = PathBuf::from(trimmed);
            if candidate.is_absolute() {
                return candidate;
            }
        }
    }
    #[cfg(windows)]
    {
        if let Some(local) = dirs::data_local_dir() {
            return local.join("hermes");
        }
    }
    dirs::home_dir().unwrap_or_default().join(".hermes")
}

// ─── Wire types (snake_case to match the ported frontend) ────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct SavedSession {
    pub id: String,
    pub name: String,
    pub tool: String,
    pub cwd: String,
    pub session_token: Option<String>,
    pub saved_at: String,
    pub file_path: Option<String>,
    pub turn_count: Option<u32>,
}

/// One tuple per session file: mtime (seconds since epoch) + an approximate
/// message count. The frontend buckets these into local-day boxes.
#[derive(Serialize)]
pub struct HeatmapEntry {
    pub ts: i64,
    pub count: u32,
}

// ─── Title extraction helpers ────────────────────────────────────────────

/// XML-style tags / synthetic prompts injected by the tools when run inside
/// an IDE or shell. Filtered out of title extraction so the list shows what
/// the user actually typed.
///
/// The last entry is Claude Code's compaction / prior-session summary prompt.
/// It lands in the jsonl as a bare `user` message (no `<session-start-hook-
/// additional-context>` wrapper — that tag is stripped before disk), so we
/// must anchor on the literal prefix, not a structural tag. Without this,
/// every post-compaction session shows up titled
/// "Below is a conversation log from a Claud...". Mirrors Coffee CLI 9748a48.
const SYSTEM_INJECTION_TAGS: &[&str] = &[
    "<environment_context>",
    "<ide_opened_file>",
    "<ide_closed_file>",
    "<ide_selection>",
    "<system-reminder>",
    "<command-message>",
    "<command-name>",
    "# AGENTS.md",
    "Below is a conversation log from a Claude Code coding session",
];

fn is_system_injected(text: &str) -> bool {
    let t = text.trim();
    SYSTEM_INJECTION_TAGS.iter().any(|tag| t.starts_with(tag))
}

/// Truncate a candidate title to 40 chars, appending an ellipsis if longer.
fn make_title(raw: &str) -> String {
    let safe = raw.replace('\n', " ");
    let mut chars = safe.chars();
    let chunk: String = chars.by_ref().take(40).collect();
    if chars.next().is_some() {
        format!("{}...", chunk)
    } else {
        chunk
    }
}

fn mtime_millis(path: &Path) -> String {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis().to_string())
        .unwrap_or_default()
}

fn turns_from_messages(total_messages: u32) -> u32 {
    if total_messages > 0 {
        std::cmp::max(1, total_messages.div_ceil(2))
    } else {
        0
    }
}

// ─── Per-family parsers ──────────────────────────────────────────────────

/// Generic agent JSONL parser (Claude Code). One JSON object per line; pulls
/// `sessionId` / `cwd` off any row, counts user+assistant messages, and uses
/// the first real user message as the title. Files with no real user message
/// are internal compaction/summary sub-tasks and are not user-visible sessions.
fn parse_agent_jsonl(file_path: &Path, family: Family) -> Option<SavedSession> {
    use std::io::BufRead;
    let file = std::fs::File::open(file_path).ok()?;
    let reader = std::io::BufReader::new(file);

    let mut session_id = file_path.file_stem()?.to_string_lossy().to_string();
    let mut cwd = String::new();
    let mut title = String::new();
    let mut total_messages = 0u32;
    let mut real_user_messages = 0u32;

    for line in reader.lines().map_while(Result::ok) {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        if let Some(s) = value.get("sessionId").and_then(|v| v.as_str()) {
            if !s.is_empty() {
                session_id = s.to_string();
            }
        }
        if let Some(c) = value.get("cwd").and_then(|v| v.as_str()) {
            if cwd.is_empty() && !c.is_empty() {
                cwd = c.to_string();
            }
        }

        let mut msg_obj = value.get("message").and_then(|v| v.as_object());
        if msg_obj.is_none() {
            if let Some(payload) = value.get("payload").and_then(|v| v.as_object()) {
                if payload.get("type").and_then(|v| v.as_str()) == Some("message") {
                    msg_obj = Some(payload);
                }
            }
        }
        let Some(msg_obj) = msg_obj else { continue };
        let role = msg_obj.get("role").and_then(|v| v.as_str()).unwrap_or("");
        if role == "user" || role == "assistant" {
            total_messages += 1;
        }
        if role == "user" {
            let is_real_user = match msg_obj.get("content") {
                Some(content) if content.is_string() => content
                    .as_str()
                    .is_some_and(|text| !is_system_injected(text)),
                Some(content) if content.is_array() => content.as_array().is_some_and(|arr| {
                    arr.iter().any(|block| {
                        let bt = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
                        if bt != "text" && bt != "input_text" {
                            return false;
                        }
                        block
                            .get("text")
                            .and_then(|v| v.as_str())
                            .is_some_and(|text| !is_system_injected(text))
                    })
                }),
                _ => false,
            };
            if is_real_user {
                real_user_messages += 1;
            }
        }
        if role != "user" || !title.is_empty() {
            continue;
        }
        if let Some(content_str) = msg_obj.get("content").and_then(|v| v.as_str()) {
            if !is_system_injected(content_str) {
                title = make_title(content_str);
            }
        } else if let Some(arr) = msg_obj.get("content").and_then(|v| v.as_array()) {
            for block in arr {
                let bt = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if bt != "text" && bt != "input_text" {
                    continue;
                }
                if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                    if is_system_injected(text) {
                        continue;
                    }
                    title = make_title(text);
                    break;
                }
            }
        }
    }

    // Fallback cwd from the encoded project-folder name (`C--Users--x` → `C:\Users\x`).
    if cwd.is_empty() {
        if let Some(folder) = file_path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
        {
            if folder.contains("--") {
                let mut parts = folder.split("--");
                if let Some(drive) = parts.next() {
                    let rest: Vec<&str> = parts.collect();
                    cwd = if cfg!(target_os = "windows") {
                        format!("{}:\\{}", drive, rest.join("\\"))
                    } else {
                        format!("/{}/{}", drive, rest.join("/"))
                    };
                }
            }
        }
    }

    if real_user_messages == 0 {
        return None;
    }

    if title.is_empty() {
        title = "Claude Code Session".to_string();
    }

    let id = family.as_id();
    Some(SavedSession {
        id: format!("{}_native_{}", id, session_id),
        name: title,
        tool: id.to_string(),
        cwd,
        session_token: Some(session_id),
        saved_at: mtime_millis(file_path),
        file_path: Some(file_path.to_string_lossy().into_owned()),
        turn_count: Some(turns_from_messages(total_messages)),
    })
}

/// Whether a Codex `session_meta` payload describes an internal sub-agent
/// rollout rather than a user-created top-level session. Codex (incl. Codex
/// Desktop) writes one rollout JSONL per spawned sub-agent, which re-inherits
/// the parent's first user message and would otherwise show up as a duplicate
/// top-level card. Two conclusive markers (see Codex's `SessionMeta` in
/// codex-rs/protocol/src/protocol.rs):
///
///   - `source` is an object `{"subagent": ...}` (`SessionSource::SubAgent`;
///     user sessions serialize `source` as a string like "cli"/"vscode").
///     The parent thread id lives nested under
///     `source.subagent.thread_spawn.parent_thread_id`, NOT as a top-level
///     field, so a top-level `parent_thread_id` lookup would miss real
///     sub-agent rollouts. Also catches older rollouts that predate
///     `thread_source`.
///   - `thread_source == "subagent"` (`ThreadSource::Subagent`).
///
/// `forked_from_id` is deliberately NOT a marker: it identifies user-initiated
/// fork/resume sessions, which are legit top-level user sessions. Mirrors
/// orca's `isCodexWorkerSession` and cc-switch's `is_subagent_source`.
fn is_codex_subagent_session(payload: &serde_json::Value) -> bool {
    if payload
        .get("source")
        .and_then(|v| v.as_object())
        .is_some_and(|obj| obj.contains_key("subagent"))
    {
        return true;
    }
    payload
        .get("thread_source")
        .and_then(|v| v.as_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("subagent"))
}

/// Strip Codex Desktop's synthetic "Files mentioned by the user"
/// preamble from a user `input_text` block, returning the user's real
/// request text for title display.
///
/// Codex Desktop (the ChatGPT desktop app's Codex/agent mode;
/// `session_meta.originator == "Codex Desktop"`) packs attached-file
/// references and the user's actual question into a single block:
///
/// ```text
/// \n# Files mentioned by the user:\n\n## <file>: <path>\n...\n\n## My request for Codex:\n<real text>
/// ```
///
/// Without stripping, the history title becomes the meaningless
/// "# Files mentioned by the user: ## <file>..." preamble instead of
/// the user's real first question. We split on the `## My request for`
/// marker and return what follows it (after the product name + colon);
/// if the block has the preamble but no request marker (user attached
/// files with no accompanying text), we return empty so the caller
/// treats it like any other system injection and keeps scanning.
/// Blocks without the preamble are returned unchanged.
fn strip_codex_desktop_file_preamble(text: &str) -> &str {
    const PREAMBLE: &str = "# Files mentioned by the user";
    if !text.contains(PREAMBLE) {
        return text;
    }
    const MARKER: &str = "## My request for";
    let Some(idx) = text.find(MARKER) else {
        return ""; // files-only message, no real text -> skip
    };
    let after_marker = &text[idx + MARKER.len()..];
    // Skip the product name (e.g. "Codex") and the colon that ends
    // the marker, then any leading whitespace.
    match after_marker.find(':') {
        Some(colon) => after_marker[colon + 1..].trim_start(),
        None => after_marker.trim_start(),
    }
}

/// Codex rollout JSONL: first row is `session_meta` (carries id + cwd;
/// `originator` is `"Codex Desktop"` for the ChatGPT desktop app's
/// Codex/agent mode, `"codex-tui"` for the terminal CLI; both share the
/// same row schema). Sub-agent rollouts are filtered out here. Subsequent
/// `response_item` / `user_message` rows hold the conversation.
fn parse_codex_session_jsonl(file_path: &Path) -> Option<SavedSession> {
    use std::io::BufRead;
    let file = std::fs::File::open(file_path).ok()?;
    let reader = std::io::BufReader::new(file);

    let mut session_id = file_path.file_stem()?.to_string_lossy().to_string();
    let mut cwd = String::new();
    let mut title = String::new();
    let mut total_messages = 0u32;

    for line in reader.lines().map_while(Result::ok) {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        let row_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let Some(payload) = value.get("payload") else {
            continue;
        };

        if row_type == "session_meta" {
            // Codex (incl. Codex Desktop) writes a separate rollout JSONL for
            // every sub-agent it spawns; these inherit the parent's first user
            // message and would surface as duplicate top-level cards. See
            // `is_codex_subagent_session` for the marker rationale.
            // `forked_from_id` is NOT a marker (user fork/resume = top-level).
            if is_codex_subagent_session(payload) {
                return None;
            }
            if let Some(id) = payload.get("id").and_then(|v| v.as_str()) {
                if !id.is_empty() {
                    session_id = id.to_string();
                }
            }
            if let Some(c) = payload.get("cwd").and_then(|v| v.as_str()) {
                if !c.is_empty() {
                    cwd = c.to_string();
                }
            }
            continue;
        }

        let payload_type = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let is_msg = (row_type == "response_item" && payload_type == "message")
            || row_type == "user_message";
        if !is_msg {
            continue;
        }
        let role = payload.get("role").and_then(|v| v.as_str()).unwrap_or("");
        if role == "user" || role == "assistant" {
            total_messages += 1;
        }
        if role != "user" || !title.is_empty() {
            continue;
        }
        let Some(arr) = payload.get("content").and_then(|v| v.as_array()) else {
            continue;
        };
        for block in arr {
            let bt = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if bt != "input_text" && bt != "text" {
                continue;
            }
            if let Some(raw) = block.get("text").and_then(|v| v.as_str()) {
                // Codex Desktop packs attached files + the real question into
                // one `input_text` block prefixed with
                // "# Files mentioned by the user"; strip that preamble so the
                // title is the user's actual request. Returns "" for
                // files-only blocks (no text).
                let text = strip_codex_desktop_file_preamble(raw);
                if text.is_empty() || is_system_injected(text) {
                    continue;
                }
                title = make_title(text);
                break;
            }
        }
    }

    if title.is_empty() {
        title = "Codex Session".to_string();
    }

    Some(SavedSession {
        id: format!("codex_native_{}", session_id),
        name: title,
        tool: "codex".to_string(),
        cwd,
        session_token: Some(session_id),
        saved_at: mtime_millis(file_path),
        file_path: Some(file_path.to_string_lossy().into_owned()),
        turn_count: Some(turns_from_messages(total_messages)),
    })
}

// ─── Directory walking ───────────────────────────────────────────────────

/// Recursively collect `*.jsonl` files up to `depth` directory levels,
/// tagging each with its family. Mirrors Coffee CLI's
/// `collect_jsonl_paths_with_mtime`.
fn collect_jsonl_paths(
    dir: PathBuf,
    depth: u8,
    family: Family,
    out: &mut Vec<(SystemTime, PathBuf, Family)>,
) {
    if depth == 0 || !dir.is_dir() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                let mtime = entry
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .unwrap_or(UNIX_EPOCH);
                out.push((mtime, path, family));
            }
        } else if path.is_dir() {
            collect_jsonl_paths(path, depth - 1, family, out);
        }
    }
}

// ─── OpenCode (SQLite) ───────────────────────────────────────────────────
//
// OpenCode's authoritative session store is `opencode.db` (SQLite, FULL
// history). ⚠️ There is ALSO a `storage/session/` + `storage/message/` JSON
// dir, but it is VESTIGIAL — only a couple of legacy sessions linger there
// (verified 2026-06-15: 2 JSON sessions vs 99 in the db). Do NOT "optimise" by
// reading the JSON store to drop rusqlite — it silently loses ~all OpenCode
// history. The bundled-SQLite weight (~0.6 MB in the NSIS installer) is the
// price of reading the real store.

/// MiMo Code's db. Authoritatively `~/.local/share/mimocode/mimocode.db` (its
/// OpenCode fork's `.local/share/<app>` root); an older/alt install may use
/// `~/.config/mimocode` — fall back to it if the primary is absent.
fn mimo_db_path(home: &Path) -> PathBuf {
    let primary = home
        .join(".local")
        .join("share")
        .join("mimocode")
        .join("mimocode.db");
    if primary.is_file() {
        return primary;
    }
    home.join(".config").join("mimocode").join("mimocode.db")
}

/// One page of a Drizzle/SQLite tool's sessions, newest first. OpenCode and its
/// MiMo Code fork share the schema (session + message tables, `time_updated` ms,
/// `time_archived`) — only the db path differs. `tool`/`label` set the
/// SavedSession id-prefix + `tool` tag and the fallback title.
///
/// `parent_id IS NULL` excludes sub-agent sessions: OpenCode writes one row
/// per spawned sub-agent (parallel / task tool) with `parent_id` pointing at
/// the parent. Its own desktop excludes those from the root list
/// (`isNull(parent_id)`) and loads them on-demand from the parent's
/// timeline — sub-agents can't be independently resumed, so hiding them
/// matches the canonical UX instead of flattening children into the list.
fn drizzle_history_page(
    db_path: &Path,
    tool: &str,
    label: &str,
    offset: usize,
    limit: usize,
) -> Vec<SavedSession> {
    let Ok(conn) = rusqlite::Connection::open_with_flags(
        db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) else {
        return Vec::new();
    };
    let query = "SELECT s.id, s.title, s.directory, s.time_updated, COUNT(m.id) as msg_count \
                 FROM session s \
                 LEFT JOIN message m ON m.session_id = s.id \
                 WHERE s.time_archived IS NULL \
                   AND s.parent_id IS NULL \
                 GROUP BY s.id \
                 ORDER BY s.time_updated DESC \
                 LIMIT ?1 OFFSET ?2";
    let Ok(mut stmt) = conn.prepare(query) else {
        return Vec::new();
    };
    let db_str = db_path.to_string_lossy().into_owned();
    let rows = stmt.query_map([limit as i64, offset as i64], |row| {
        let id: String = row.get(0)?;
        let title: String = row
            .get::<_, Option<String>>(1)
            .unwrap_or(None)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| format!("{} Session", label));
        let directory: String = row
            .get::<_, Option<String>>(2)
            .unwrap_or(None)
            .unwrap_or_default();
        let time_updated: i64 = row.get(3).unwrap_or(0);
        let msg_count: i64 = row.get(4).unwrap_or(0);
        Ok(SavedSession {
            id: format!("{}_native_{}", tool, id),
            name: title,
            tool: tool.to_string(),
            cwd: directory,
            session_token: Some(id),
            saved_at: time_updated.to_string(),
            file_path: Some(db_str.clone()),
            turn_count: Some(std::cmp::max(1, msg_count / 2) as u32),
        })
    });
    match rows {
        Ok(iter) => iter.flatten().collect(),
        Err(_) => Vec::new(),
    }
}

/// Drizzle/SQLite heatmap entries (timestamp + message count per session) past
/// the cutoff. `time_updated` is milliseconds; we emit seconds. Shared by
/// OpenCode + its MiMo Code fork.
fn collect_drizzle_heatmap_entries(db_path: &Path, cutoff_secs: i64, out: &mut Vec<HeatmapEntry>) {
    let Ok(conn) = rusqlite::Connection::open_with_flags(
        db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) else {
        return;
    };
    let cutoff_ms = cutoff_secs.saturating_mul(1000);
    let query = "SELECT s.time_updated, COUNT(m.id) AS msg_count \
                 FROM session s \
                 LEFT JOIN message m ON m.session_id = s.id \
                 WHERE s.time_archived IS NULL AND s.time_updated >= ?1 \
                 GROUP BY s.id";
    let Ok(mut stmt) = conn.prepare(query) else {
        return;
    };
    let rows = stmt.query_map([cutoff_ms], |row| {
        let ts_ms: i64 = row.get(0)?;
        let count: i64 = row.get(1)?;
        Ok((ts_ms, count))
    });
    if let Ok(iter) = rows {
        for (ts_ms, count) in iter.flatten() {
            if count > 0 {
                out.push(HeatmapEntry {
                    ts: ts_ms / 1000,
                    count: count as u32,
                });
            }
        }
    }
}

// ─── Message counting (heatmap) ──────────────────────────────────────────

/// Cheap line-count for JSONL files; every non-empty line is one "turn".
/// Capped at 32 MiB so a runaway session can't stall the scan.
fn count_jsonl_message_lines(path: &Path) -> u32 {
    use std::io::{BufRead, BufReader, Read};
    let Ok(file) = std::fs::File::open(path) else {
        return 0;
    };
    const MAX_BYTES: u64 = 32 * 1024 * 1024;
    let mut br = BufReader::new(file.take(MAX_BYTES));
    let mut buf: Vec<u8> = Vec::with_capacity(512);
    let mut count = 0u32;
    while let Ok(n) = br.read_until(b'\n', &mut buf) {
        if n == 0 {
            break;
        }
        if buf.iter().any(|&b| !b.is_ascii_whitespace()) {
            count = count.saturating_add(1);
        }
        buf.clear();
    }
    count
}

// ─── Hermes (SQLite) ─────────────────────────────────────────────────────
//
// Hermes (like OpenCode) keeps every session in a SQLite db — `state.db`
// (sessions + messages tables + FTS5 search). The `sessions/` dir is only a
// gateway routing index (`sessions.json`) / optional JSONL exports, NOT the
// session store, so we read the db. `started_at` is epoch SECONDS (float);
// `message_count` is a column, so no message-table JOIN is needed.

/// Best display text out of a decoded JSON message-content value: a bare
/// string, the first `{type:"text", text:…}` block of an array, or an object's
/// `text` / `content` field. `None` if no non-empty text is found.
fn first_json_text(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::String(s) => {
            let s = s.trim();
            (!s.is_empty()).then(|| s.to_string())
        }
        serde_json::Value::Array(arr) => arr.iter().find_map(|el| match el.as_object() {
            Some(obj) => {
                if obj.get("type").and_then(|t| t.as_str()).unwrap_or("text") != "text" {
                    return None;
                }
                obj.get("text")
                    .and_then(|t| t.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
            }
            None => first_json_text(el),
        }),
        serde_json::Value::Object(obj) => obj
            .get("text")
            .and_then(|t| t.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .or_else(|| obj.get("content").and_then(first_json_text)),
        _ => None,
    }
}

/// Decode a Hermes `messages.content` cell to display text. Hermes stores a
/// plain string for scalar text, or `"\x00json:"` + JSON for structured /
/// multimodal content (per its `_encode_content`). Mirror that: strip the
/// prefix and pull text out of the JSON, else use the raw string.
fn hermes_decode_text(content: &str) -> String {
    if let Some(rest) = content.strip_prefix("\u{0}json:") {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(rest) {
            if let Some(t) = first_json_text(&v) {
                return t;
            }
        }
    }
    content.to_string()
}

/// First non-empty user-message text for a session — Hermes' title-preview
/// source. Mirrors its SQL: earliest `role='user'` message that has content.
fn hermes_first_user_text(conn: &rusqlite::Connection, session_id: &str) -> Option<String> {
    let content: Option<String> = conn
        .query_row(
            "SELECT content FROM messages \
             WHERE session_id = ?1 AND role = 'user' AND content IS NOT NULL \
             ORDER BY timestamp, id LIMIT 1",
            [session_id],
            |row| row.get(0),
        )
        .ok()?;
    let text = hermes_decode_text(&content?);
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

/// One page of Hermes sessions, newest first, from `state.db`. The displayed
/// name mirrors Hermes' own `_build_session_title` fallback chain (explicit
/// `title` → first user-message preview → cwd basename → "New thread") — most
/// sessions get an auto-generated `title` after their first turn, and untitled
/// ones show the first user message rather than a generic label.
fn hermes_history_page(db_path: &Path, offset: usize, limit: usize) -> Vec<SavedSession> {
    let Ok(conn) = rusqlite::Connection::open_with_flags(
        db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) else {
        return Vec::new();
    };
    let db_str = db_path.to_string_lossy().into_owned();

    // Collect the page first so the prepared statement is dropped before we run
    // the per-session title-preview queries on the same connection.
    struct Raw {
        id: String,
        title: String,
        cwd: String,
        started_at: f64,
        msg_count: i64,
    }
    let raws: Vec<Raw> = {
        let query = "SELECT id, title, cwd, started_at, message_count \
                     FROM sessions \
                     WHERE archived = 0 \
                     ORDER BY started_at DESC \
                     LIMIT ?1 OFFSET ?2";
        let Ok(mut stmt) = conn.prepare(query) else {
            return Vec::new();
        };
        let rows = stmt.query_map([limit as i64, offset as i64], |row| {
            Ok(Raw {
                id: row.get(0)?,
                title: row
                    .get::<_, Option<String>>(1)
                    .unwrap_or(None)
                    .unwrap_or_default(),
                cwd: row
                    .get::<_, Option<String>>(2)
                    .unwrap_or(None)
                    .unwrap_or_default(),
                started_at: row.get::<_, Option<f64>>(3).unwrap_or(None).unwrap_or(0.0),
                msg_count: row.get::<_, Option<i64>>(4).unwrap_or(None).unwrap_or(0),
            })
        });
        match rows {
            Ok(iter) => iter.flatten().collect(),
            Err(_) => return Vec::new(),
        }
    };

    raws.into_iter()
        .map(|r| {
            let explicit = r.title.trim();
            let name = if !explicit.is_empty() {
                make_title(explicit)
            } else {
                hermes_first_user_text(&conn, &r.id)
                    .map(|t| make_title(&t))
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| {
                        let leaf = Path::new(&r.cwd)
                            .file_name()
                            .and_then(|s| s.to_str())
                            .unwrap_or("");
                        if leaf.is_empty() {
                            "Hermes Session".to_string()
                        } else {
                            leaf.to_string()
                        }
                    })
            };
            SavedSession {
                id: format!("hermes_native_{}", r.id),
                name,
                tool: "hermes".to_string(),
                cwd: r.cwd,
                // started_at is epoch seconds; the frontend wants ms.
                saved_at: ((r.started_at * 1000.0) as i64).to_string(),
                file_path: Some(db_str.clone()),
                turn_count: Some(turns_from_messages(r.msg_count.max(0) as u32)),
                session_token: Some(r.id),
            }
        })
        .collect()
}

/// Hermes heatmap entries: one per session past the cutoff — its `started_at`
/// day + `message_count`. `started_at` is epoch seconds (float); we emit seconds.
fn collect_hermes_heatmap_entries(db_path: &Path, cutoff_secs: i64, out: &mut Vec<HeatmapEntry>) {
    let Ok(conn) = rusqlite::Connection::open_with_flags(
        db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) else {
        return;
    };
    let query = "SELECT started_at, message_count FROM sessions \
                 WHERE archived = 0 AND started_at >= ?1";
    let Ok(mut stmt) = conn.prepare(query) else {
        return;
    };
    let rows = stmt.query_map([cutoff_secs as f64], |row| {
        let started_at: f64 = row.get(0)?;
        let count: i64 = row.get::<_, Option<i64>>(1).unwrap_or(None).unwrap_or(0);
        Ok((started_at, count))
    });
    if let Ok(iter) = rows {
        for (started_at, count) in iter.flatten() {
            if count > 0 {
                out.push(HeatmapEntry {
                    ts: started_at as i64,
                    count: count as u32,
                });
            }
        }
    }
}

// ─── Heatmap count cache ─────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
struct CachedCount {
    mtime: i64,
    count: u32,
}

fn count_cache_path() -> PathBuf {
    crate::utils::platform::echobird_dir()
        .join("cache")
        .join("ai-career-heatmap-counts.json")
}

fn read_count_cache() -> HashMap<String, CachedCount> {
    std::fs::read_to_string(count_cache_path())
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

fn write_count_cache(map: &HashMap<String, CachedCount>) {
    let path = count_cache_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(map) {
        let _ = std::fs::write(&path, json);
    }
}

// ─── Public entry points (called by ai_career_commands) ──────────────────

/// One page of a single family's session history, newest first. Per-family
/// scanning keeps the payload small; the frontend pages in more on scroll.
pub fn family_history(family: Family, offset: usize, limit: usize) -> Vec<SavedSession> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };

    // OpenCode + MiMo (its fork) + Hermes keep sessions in a SQLite db, not flat
    // files. OpenCode/MiMo share one reader (`drizzle_*`); Hermes has its own.
    if family == Family::OpenCode {
        return drizzle_history_page(
            &Family::OpenCode.root(&home).join("opencode.db"),
            "opencode",
            "OpenCode",
            offset,
            limit,
        );
    }
    if family == Family::MiMo {
        return drizzle_history_page(&mimo_db_path(&home), "mimo", "MiMo", offset, limit);
    }
    if family == Family::Hermes {
        return hermes_history_page(&Family::Hermes.root(&home).join("state.db"), offset, limit);
    }

    let mut candidates: Vec<(SystemTime, PathBuf, Family)> = Vec::new();
    match family {
        Family::Claude | Family::Codex => {
            if let Some(depth) = family.jsonl_depth() {
                collect_jsonl_paths(family.root(&home), depth, family, &mut candidates);
            }
        }
        Family::OpenCode | Family::Hermes | Family::MiMo => unreachable!(),
    }

    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    candidates
        .into_iter()
        .skip(offset)
        .take(limit)
        .filter_map(|(_, path, _)| match family {
            Family::Claude => parse_agent_jsonl(&path, Family::Claude),
            Family::Codex => parse_codex_session_jsonl(&path),
            Family::OpenCode | Family::Hermes | Family::MiMo => None,
        })
        .collect()
}

/// Contribution-heatmap entries across all five families, 210-day lookback.
/// Past session files are immutable once their mtime settles, so per-file
/// counts are cached on disk and skipped on subsequent scans.
pub fn message_heatmap() -> Vec<HeatmapEntry> {
    const LOOKBACK_SECS: u64 = 210 * 86_400;
    let now = SystemTime::now();
    let cutoff = now
        .checked_sub(Duration::from_secs(LOOKBACK_SECS))
        .unwrap_or(UNIX_EPOCH);

    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };

    // Collect file candidates for the JSONL families only (OpenCode, MiMo, and
    // Hermes are separate SQLite passes below).
    let mut candidates: Vec<(SystemTime, PathBuf, Family)> = Vec::new();
    for family in Family::ALL {
        match family {
            Family::Claude | Family::Codex => {
                if let Some(depth) = family.jsonl_depth() {
                    collect_jsonl_paths(family.root(&home), depth, family, &mut candidates);
                }
            }
            Family::OpenCode | Family::Hermes | Family::MiMo => {}
        }
    }

    let mut cache = read_count_cache();
    let mut cache_dirty = false;
    let mut keep: HashSet<String> = HashSet::new();
    let mut out: Vec<HeatmapEntry> = Vec::with_capacity(candidates.len());

    for (mtime, path, _) in &candidates {
        if *mtime < cutoff {
            continue;
        }
        let ts = mtime
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let key = path.to_string_lossy().into_owned();
        keep.insert(key.clone());

        let count = match cache.get(&key) {
            Some(entry) if entry.mtime == ts => entry.count,
            _ => {
                let c = count_jsonl_message_lines(path);
                cache.insert(
                    key.clone(),
                    CachedCount {
                        mtime: ts,
                        count: c,
                    },
                );
                cache_dirty = true;
                c
            }
        };
        if count > 0 {
            out.push(HeatmapEntry { ts, count });
        }
    }

    // Prune entries for files that vanished from disk.
    let before = cache.len();
    cache.retain(|k, _| keep.contains(k));
    if cache.len() != before {
        cache_dirty = true;
    }
    if cache_dirty {
        write_count_cache(&cache);
    }

    // SQLite second pass — OpenCode, MiMo (its fork), and Hermes keep sessions
    // in a SQLite db (not flat files). Each collector opens its db read-only and
    // returns early if it's missing, so no is_file() guard is needed.
    let cutoff_secs = cutoff
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    collect_drizzle_heatmap_entries(
        &Family::OpenCode.root(&home).join("opencode.db"),
        cutoff_secs,
        &mut out,
    );
    collect_drizzle_heatmap_entries(&mimo_db_path(&home), cutoff_secs, &mut out);
    collect_hermes_heatmap_entries(
        &Family::Hermes.root(&home).join("state.db"),
        cutoff_secs,
        &mut out,
    );

    out
}

/// Rough "≈ N tokens" estimate: sum the on-disk byte size of every session
/// file across the five families (capped per file), which the frontend
/// divides by a bytes-per-token ratio. Deliberately approximate — it measures
/// content volume, so it works even when a provider doesn't report real usage
/// (third-party models often log 0 tokens). Stat-only (no file reads), cheap.
pub fn estimate_token_bytes() -> u64 {
    let Some(home) = dirs::home_dir() else {
        return 0;
    };
    const MAX_PER_FILE: u64 = 32 * 1024 * 1024;
    let mut total: u64 = 0;
    for family in Family::ALL {
        match family {
            Family::Hermes => {
                // Hermes keeps all sessions in one SQLite db; its file size
                // stands in for the family's content volume.
                if let Ok(m) = std::fs::metadata(family.root(&home).join("state.db")) {
                    total = total.saturating_add(m.len());
                }
            }
            Family::Claude | Family::Codex => {
                if let Some(depth) = family.jsonl_depth() {
                    sum_jsonl_sizes(family.root(&home), depth, MAX_PER_FILE, &mut total);
                }
            }
            Family::OpenCode => {
                // One shared DB holds every OpenCode session; its file size
                // stands in for the family's content volume.
                if let Ok(m) = std::fs::metadata(family.root(&home).join("opencode.db")) {
                    total = total.saturating_add(m.len());
                }
            }
            Family::MiMo => {
                // MiMo Code's SQLite db (its OpenCode fork's `mimocode.db`).
                if let Ok(m) = std::fs::metadata(mimo_db_path(&home)) {
                    total = total.saturating_add(m.len());
                }
            }
        }
    }
    total
}

fn sum_jsonl_sizes(dir: PathBuf, depth: u8, cap: u64, total: &mut u64) {
    if depth == 0 || !dir.is_dir() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_file() {
            if p.extension().and_then(|x| x.to_str()) == Some("jsonl") {
                if let Ok(m) = e.metadata() {
                    *total = total.saturating_add(m.len().min(cap));
                }
            }
        } else if p.is_dir() {
            sum_jsonl_sizes(p, depth - 1, cap, total);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn family_id_round_trips() {
        for f in Family::ALL {
            assert_eq!(Family::from_id(f.as_id()), Some(f));
        }
        assert_eq!(Family::from_id("nope"), None);
    }

    #[test]
    fn title_truncates_at_40_chars_with_ellipsis() {
        let long = "a".repeat(50);
        let t = make_title(&long);
        assert!(t.ends_with("..."));
        assert_eq!(t.chars().count(), 43); // 40 + "..."
        assert_eq!(make_title("short"), "short");
    }

    #[test]
    fn newlines_collapsed_in_title() {
        assert_eq!(make_title("line one\nline two"), "line one line two");
    }

    #[test]
    fn system_injected_prompts_detected() {
        assert!(is_system_injected("<ide_opened_file>foo"));
        assert!(is_system_injected("  # AGENTS.md instructions"));
        // Claude Code compaction / prior-session summary prompt lands in the
        // jsonl as a bare user message — must be filtered by literal prefix.
        assert!(is_system_injected(
            "Below is a conversation log from a Claude Code coding session.\nCreate a summary..."
        ));
        assert!(!is_system_injected("real user question"));
    }

    #[test]
    fn turns_are_half_of_messages_rounded_up() {
        assert_eq!(turns_from_messages(0), 0);
        assert_eq!(turns_from_messages(1), 1);
        assert_eq!(turns_from_messages(4), 2);
        assert_eq!(turns_from_messages(5), 3);
    }

    #[test]
    fn jsonl_line_count_skips_blank_lines() {
        let dir = std::env::temp_dir().join("echobird_ai_career_test_count");
        let _ = std::fs::create_dir_all(&dir);
        let f = dir.join("s.jsonl");
        std::fs::write(&f, "{\"a\":1}\n\n  \n{\"b\":2}\n").unwrap();
        assert_eq!(count_jsonl_message_lines(&f), 2);
        let _ = std::fs::remove_file(&f);
    }

    #[test]
    fn parse_agent_jsonl_extracts_title_and_counts() {
        let dir = std::env::temp_dir().join("echobird_ai_career_test_agent");
        let _ = std::fs::create_dir_all(&dir);
        let f = dir.join("sess.jsonl");
        let body = "{\"sessionId\":\"abc\",\"cwd\":\"/tmp/proj\",\"message\":{\"role\":\"user\",\"content\":\"hello world\"}}\n\
                    {\"message\":{\"role\":\"assistant\",\"content\":\"hi\"}}\n";
        std::fs::write(&f, body).unwrap();
        let s = parse_agent_jsonl(&f, Family::Claude).unwrap();
        assert_eq!(s.name, "hello world");
        assert_eq!(s.tool, "claude");
        assert_eq!(s.cwd, "/tmp/proj");
        assert_eq!(s.session_token.as_deref(), Some("abc"));
        assert_eq!(s.turn_count, Some(1)); // 2 messages → 1 turn
        let _ = std::fs::remove_file(&f);
    }

    #[test]
    fn parse_agent_jsonl_drops_pure_compaction_subtask() {
        let dir = std::env::temp_dir().join("echobird_ai_career_test_compaction");
        let _ = std::fs::create_dir_all(&dir);
        let f = dir.join("compact.jsonl");
        let body = "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"Below is a conversation log from a Claude Code coding session.\\nCreate a summary to help the next session quickly understand the context.\"}}\n\
                    {\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"# Session Summary\\n...\"}]}}\n\
                    {\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"### Tasks\\n- did stuff\"}]}}\n";
        std::fs::write(&f, body).unwrap();
        assert!(parse_agent_jsonl(&f, Family::Claude).is_none());
        let _ = std::fs::remove_file(&f);
    }

    #[test]
    fn parse_agent_jsonl_titles_continued_session_after_compaction() {
        let dir = std::env::temp_dir().join("echobird_ai_career_test_compaction_continued");
        let _ = std::fs::create_dir_all(&dir);
        let f = dir.join("continued.jsonl");
        let body = "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"Below is a conversation log from a Claude Code coding session.\\nCreate a summary...\"}}\n\
                    {\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"summary\"}]}}\n\
                    {\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"继续帮我测一下 OSC 52\"}}\n\
                    {\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"好\"}]}}\n";
        std::fs::write(&f, body).unwrap();
        let s = parse_agent_jsonl(&f, Family::Claude).unwrap();
        assert_eq!(s.name, "继续帮我测一下 OSC 52");
        let _ = std::fs::remove_file(&f);
    }

    #[test]
    fn parse_agent_jsonl_counts_mixed_array_real_user_message() {
        let dir = std::env::temp_dir().join("echobird_ai_career_test_agent_array");
        let _ = std::fs::create_dir_all(&dir);
        let f = dir.join("array.jsonl");
        let body = "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"tool_result\",\"tool_use_id\":\"x\",\"content\":\"<ide_opened_file>\"},{\"type\":\"text\",\"text\":\"帮我把这个文件重构一下\"}]}}\n\
                    {\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"好的\"}]}}\n";
        std::fs::write(&f, body).unwrap();
        let s = parse_agent_jsonl(&f, Family::Claude).unwrap();
        assert_eq!(s.name, "帮我把这个文件重构一下");
        let _ = std::fs::remove_file(&f);
    }

    #[test]
    fn parse_codex_pulls_meta_and_skips_injected_title() {
        let dir = std::env::temp_dir().join("echobird_ai_career_test_codex");
        let _ = std::fs::create_dir_all(&dir);
        let f = dir.join("rollout-x.jsonl");
        let body = "{\"type\":\"session_meta\",\"payload\":{\"id\":\"sid\",\"cwd\":\"/w\"}}\n\
                    {\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"# AGENTS.md stuff\"}]}}\n\
                    {\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"real prompt\"}]}}\n";
        std::fs::write(&f, body).unwrap();
        let s = parse_codex_session_jsonl(&f).unwrap();
        assert_eq!(s.name, "real prompt");
        assert_eq!(s.cwd, "/w");
        assert_eq!(s.session_token.as_deref(), Some("sid"));
        let _ = std::fs::remove_file(&f);
    }

    // OpenCode (and its MiMo Code fork) store every spawned sub-agent as a
    // separate `session` row whose `parent_id` points at the parent. Their
    // own desktop excludes those rows from the root list
    // (`WHERE parent_id IS NULL`) and loads them on-demand from the parent's
    // timeline — sub-agents can't be independently resumed. This locks that
    // `drizzle_history_page` matches that canonical UX: only the root parent
    // survives; sub-agent children and archived rows are dropped.
    #[test]
    fn drizzle_page_excludes_subagent_and_archived_sessions() {
        let dir = std::env::temp_dir().join("echobird_ai_career_test_drizzle");
        let _ = std::fs::create_dir_all(&dir);
        let db = dir.join("drizzle.db");
        let _ = std::fs::remove_file(&db);
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode=DELETE;
             CREATE TABLE session (
                id            TEXT PRIMARY KEY,
                title         TEXT,
                directory     TEXT,
                time_updated  INTEGER,
                time_archived INTEGER,
                parent_id     TEXT
             );
             CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT);
             INSERT INTO session (id, title, directory, time_updated, time_archived, parent_id) VALUES
                ('ses_parent',   'Main task',                      '/proj', 3000, NULL, NULL),
                ('ses_child_a',  'Find files (@explore subagent)', '/proj', 3010, NULL, 'ses_parent'),
                ('ses_child_b',  'Refactor (@general subagent)',   '/proj', 3020, NULL, 'ses_parent'),
                ('ses_archived', 'Old session',                    '/proj', 1000, 999,  NULL);
             INSERT INTO message (id, session_id) VALUES
                ('m1', 'ses_parent'), ('m2', 'ses_parent'),
                ('m3', 'ses_child_a'), ('m4', 'ses_archived');",
        )
        .unwrap();
        drop(conn);

        let out = drizzle_history_page(&db, "opencode", "OpenCode Session", 0, 30);

        assert_eq!(out.len(), 1, "expected only the root parent session");
        assert_eq!(out[0].id, "opencode_native_ses_parent");
        assert_eq!(out[0].name, "Main task");

        let _ = std::fs::remove_file(&db);
        let _ = std::fs::remove_dir(&dir);
    }

    // ── Bug A: sub-agent filtering ───────────────────────────────────────

    // Real Codex Desktop sub-agent shape: `source` is an object with a
    // `subagent` key (SessionSource::SubAgent); parent_thread_id is nested
    // under source.subagent.thread_spawn, NOT top-level. Must be dropped.
    #[test]
    fn parse_codex_skips_subagent_source_object() {
        let dir = std::env::temp_dir().join("echobird_ai_career_test_codex_sub_src");
        let _ = std::fs::create_dir_all(&dir);
        let f = dir.join("rollout-sub-src.jsonl");
        let body = "{\"type\":\"session_meta\",\"payload\":{\"id\":\"sub-id\",\"cwd\":\"/w\",\"source\":{\"subagent\":{\"thread_spawn\":{\"parent_thread_id\":\"parent-id\",\"depth\":1,\"agent_role\":\"explorer\"}}}}}\n\
                    {\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"hi\"}]}}\n";
        std::fs::write(&f, body).unwrap();
        assert!(parse_codex_session_jsonl(&f).is_none());
        let _ = std::fs::remove_file(&f);
    }

    // thread_source == "subagent" alone is also enough to drop.
    #[test]
    fn parse_codex_skips_subagent_thread_source() {
        let dir = std::env::temp_dir().join("echobird_ai_career_test_codex_sub_ts");
        let _ = std::fs::create_dir_all(&dir);
        let f = dir.join("rollout-sub-ts.jsonl");
        let body = "{\"type\":\"session_meta\",\"payload\":{\"id\":\"sub-id\",\"cwd\":\"/w\",\"source\":\"vscode\",\"thread_source\":\"subagent\"}}\n\
                    {\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"hi\"}]}}\n";
        std::fs::write(&f, body).unwrap();
        assert!(parse_codex_session_jsonl(&f).is_none());
        let _ = std::fs::remove_file(&f);
    }

    // forked_from_id (user fork/resume) must stay visible - NOT a sub-agent.
    #[test]
    fn parse_codex_keeps_user_fork_session() {
        let dir = std::env::temp_dir().join("echobird_ai_career_test_codex_fork");
        let _ = std::fs::create_dir_all(&dir);
        let f = dir.join("rollout-fork.jsonl");
        let body = "{\"type\":\"session_meta\",\"payload\":{\"id\":\"sid\",\"cwd\":\"/w\",\"source\":\"vscode\",\"thread_source\":\"user\",\"forked_from_id\":\"parent-id\"}}\n\
                    {\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"continue this\"}]}}\n";
        std::fs::write(&f, body).unwrap();
        let s = parse_codex_session_jsonl(&f).unwrap();
        assert_eq!(s.name, "continue this");
        let _ = std::fs::remove_file(&f);
    }

    // ── Bug B: Codex Desktop file-preamble title stripping ──────────────

    // Pure unit tests on the helper (no file I/O).
    #[test]
    fn strips_codex_desktop_file_preamble_to_real_request() {
        let block = "\n# Files mentioned by the user:\n\n\
            ## EchoBird.png: C:/Users/祈羽/Desktop/EchoBird.png\n\n\
            ## My request for Codex:\n\
            这是我们的的官网https://echobird.ai/，本地文件在 C:\\EchoBird\\docs目录下。";
        assert_eq!(
            strip_codex_desktop_file_preamble(block),
            "这是我们的的官网https://echobird.ai/，本地文件在 C:\\EchoBird\\docs目录下。"
        );
    }

    #[test]
    fn codex_desktop_files_only_block_returns_empty() {
        let block = "\n# Files mentioned by the user:\n\n\
            ## EchoBird.png: C:/Users/祈羽/Desktop/EchoBird.png\n";
        assert_eq!(strip_codex_desktop_file_preamble(block), "");
    }

    #[test]
    fn codex_desktop_plain_block_passes_through_unchanged() {
        let block = "新网站保存到 C:\\EchoBird\\new-web 如何\n";
        assert_eq!(strip_codex_desktop_file_preamble(block), block);
    }

    // End-to-end: the existing codex parser path produces the real question
    // as the title, not the file-list preamble.
    #[test]
    fn parse_codex_strips_desktop_file_preamble_in_title() {
        let dir = std::env::temp_dir().join("echobird_ai_career_test_codex_preamble");
        let _ = std::fs::create_dir_all(&dir);
        let f = dir.join("rollout-p.jsonl");
        let body = "{\"type\":\"session_meta\",\"payload\":{\"id\":\"sid\",\"cwd\":\"/w\",\"originator\":\"Codex Desktop\",\"source\":\"vscode\"}}\n\
                    {\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"<environment_context>\\n  <cwd>/w</cwd>\\n</environment_context>\"}]}}\n\
                    {\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"\\n# Files mentioned by the user:\\n\\n## app.png: /w/app.png\\n\\n## My request for Codex:\\n你能看到图片吗?\"}]}}\n";
        std::fs::write(&f, body).unwrap();
        let s = parse_codex_session_jsonl(&f).unwrap();
        assert_eq!(s.name, "你能看到图片吗?");
        let _ = std::fs::remove_file(&f);
    }
}
