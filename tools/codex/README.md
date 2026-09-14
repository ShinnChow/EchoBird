# Codex Integration

This directory holds the Codex CLI and ChatGPT desktop integration assets:

- `config.json` — global integration settings
- `paths.json` — desktop installation hints and Microsoft Store activation metadata

## How it works

When a user selects a model, EchoBird writes the provider's real base URL,
API key, and model ID to `~/.codex/config.toml` and `~/.codex/auth.json`.
Codex CLI and ChatGPT then call the provider's Responses endpoint directly.
`wire_api = "responses"` and `web_search = "live"` are always enabled; there
are no Responses or Web Search switches in App Manager.

Providers used with this integration must implement the Responses API. The
former local Responses-to-Chat translation proxy has been removed.

## Source map

| Concern                 | Where it lives                                                |
| ----------------------- | ------------------------------------------------------------- |
| Config application      | `src-tauri/src/services/tool_config_manager/codex.rs`         |
| Legacy proxy migration  | `src-tauri/src/services/codex_proxy/config_manager.rs`        |
| Onboarding skip         | `src-tauri/src/services/codex_proxy/onboarding_bypass.rs`     |
| Binary resolution       | `src-tauri/src/services/codex_proxy/codex_binary.rs`          |
| CLI + Desktop launching | `src-tauri/src/services/process_manager.rs` (`start_codex_*`) |

## Troubleshooting

### Codex returns 401 / 403 from the upstream

The provider rejected your credentials. Re-check the API key in EchoBird's
model settings and apply the model again.

### The provider rejects `/responses`

The selected provider does not implement the Responses API. Choose a compatible
endpoint; EchoBird no longer translates Responses requests to Chat Completions.

### Codex CLI shows mojibake or TUI degrades

Make sure `@openai/codex` is installed globally:

```bash
npm i -g @openai/codex
```

### ChatGPT desktop will not launch

Install ChatGPT from <https://openai.com/codex> or the Microsoft Store.
