<p align="center">
  <img src="docs/icon.png" alt="EchoBird" width="140" />
</p>

<h1 align="center">EchoBird</h1>

<p align="center"><strong>AI deployment, no more chicken-and-egg.</strong></p>
<p align="center"><sub>AI 部署,不再是先有鸡还是先有蛋。</sub></p>

<p align="center">
  <a href="https://github.com/edison7009/EchoBird/releases">
    <img src="https://img.shields.io/github/v/release/edison7009/EchoBird?style=flat-square&color=D97757" alt="Release" />
  </a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/built%20with-Tauri%20%2B%20Rust-orange?style=flat-square" alt="Tauri + Rust" />
  <img src="https://img.shields.io/github/license/edison7009/EchoBird?style=flat-square" alt="MIT License" />
</p>

<p align="center">
  <a href="https://echobird.ai">Website</a> ·
  <a href="https://github.com/edison7009/EchoBird/releases/latest">Download</a> ·
  <a href="https://echobird.ai/support/">☕ Buy a coffee</a> ·
  <a href="README.zh-CN.md">中文 README</a>
</p>

> **Note** — This repository is just one of several download channels
> and an issue tracker. For product information, announcements, and
> commercial inquiries, visit [echobird.ai](https://echobird.ai).

---

## 💜 Sponsors

<table>
  <tr>
    <td width="150" align="center">
      <a href="https://www.volcengine.com/activity/ai618?utm_campaign=hw&utm_content=hw&utm_medium=devrel_tool_web&utm_source=OWO&utm_term=EchoBird1"><img src="public/icons/sponsors/volcengine.svg" width="92" alt="Volcengine 火山引擎" /></a>
    </td>
    <td>
      <a href="https://www.volcengine.com/activity/ai618?utm_campaign=hw&utm_content=hw&utm_medium=devrel_tool_web&utm_source=OWO&utm_term=EchoBird1"><strong>火山引擎 Volcengine</strong></a><br/>
      Thanks to <strong>Volcengine</strong> for sponsoring EchoBird! Volcengine is ByteDance's cloud platform, and its Ark Agent Plan is built for <strong>AI Coding</strong> to supercharge your dev workflow — 20,000 agent fuel credits per month plus a curated set of popular coding models. Sign up via <a href="https://www.volcengine.com/activity/ai618?utm_campaign=hw&utm_content=hw&utm_medium=devrel_tool_web&utm_source=OWO&utm_term=EchoBird1">this link</a>: <strong>just ¥9.9 for your first month</strong> as a new user.
    </td>
  </tr>
  <tr>
    <td width="150" align="center">
      <a href="https://passport.compshare.cn/register?referral_code=LlOJAWughXiDXtP9v1Srra"><img src="public/icons/sponsors/compshare.png" width="92" alt="优云智算 CompShare" /></a>
    </td>
    <td>
      <a href="https://passport.compshare.cn/register?referral_code=LlOJAWughXiDXtP9v1Srra"><strong>优云智算 CompShare</strong></a><br/>
      Thanks to <strong>CompShare (优云智算)</strong> for sponsoring EchoBird! CompShare is UCloud's AI cloud platform, offering stable, comprehensive access to domestic and overseas model APIs through a single API key. Its flagship Coding Plan (monthly or pay-per-call) delivers great value and supports GLM5.2, alongside officially-proxied stable overseas models. Plug it into Claude Code, Codex, or call the API directly — with enterprise-grade concurrency, 24/7 support, and self-service invoicing. Sign up via <a href="https://passport.compshare.cn/register?referral_code=LlOJAWughXiDXtP9v1Srra">this link</a> to get a <strong>¥5 free platform credit</strong>!
    </td>
  </tr>
</table>

---

## What is EchoBird?

Friends kept asking me to install **Claude Code**, **OpenClaw**, **Hermes Agent**… every machine was different, and some refused to pay for an LLM. Setup and explanations took forever. So I built **EchoBird** — an Agent inspired by **Songbird**, the genius netrunner from _Cyberpunk 2077_ who solves any tech problem for V…

<p align="center">
  <img src="https://github.com/user-attachments/assets/162f0428-a44d-4e83-9e10-c6b580ef0120" alt="EchoBird — My AI Career dashboard" width="820" />
</p>

## Highlights

EchoBird offers **4 scenarios** sharing a **unified model data hub** — **configure once, used everywhere**.

### 4 scenarios

- **Install & Repair Agent** — let an AI install and fix mainstream tools (Claude Code, OpenClaw, Hermes Agent, …); works locally and remotely
- **One-click local LLM** — bundled vLLM / SGLang / llama.cpp runtimes; pick a quant, hit START
- **My AI Projects** — onboard and manage your own vibe-coded apps and games inside EchoBird
- **App Manager** — one-click launch and management for every AI / Agent app & game

### Shared foundation

- **Model Nexus** — a unified data hub for OpenAI / Anthropic / local LLMs / API Routers; configure once and all 4 scenarios pick it up; one-click latency check before you commit

**Cross-platform** — Windows, macOS, Linux (x64 + arm64)

## Screenshots

### AI News & Star Projects — your daily AI brief

> Day & night, side by side — the rest of the screenshots below follow your GitHub theme.

<table>
<tr>
  <td width="50%"><img src="docs/screenshots/news-en-light.png" alt="AI News (Light)" /></td>
  <td width="50%"><img src="docs/screenshots/news-en-dark.png" alt="AI News (Dark)" /></td>
</tr>
<tr>
  <td align="center"><sub>☀️ Light theme</sub></td>
  <td align="center"><sub>🌙 Dark theme</sub></td>
</tr>
</table>

### Model Nexus — the unified model data hub, configure once

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/model-en-dark.png">
  <img alt="Model Nexus" src="docs/screenshots/model-en-light.png" width="100%">
</picture>

### App Manager — one-click launch and management for every AI / Agent app

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/app-en-dark.png">
  <img alt="App Manager" src="docs/screenshots/app-en-light.png" width="100%">
</picture>

### Local LLM — run models on your own machine

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/localllm-en-dark.png">
  <img alt="Local LLM" src="docs/screenshots/localllm-en-light.png" width="100%">
</picture>

### Install & Repair Agent — chat-driven setup and troubleshooting

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/agent-en-dark.png">
  <img alt="Install & Repair Agent" src="docs/screenshots/agent-en-light.png" width="100%">
</picture>

## Install

### One-line install

**Windows** (PowerShell)

```powershell
irm https://echobird.ai/install.ps1 | iex
```

**macOS / Linux**

```sh
curl -fsSL https://echobird.ai/install.sh | sh
```

The script auto-detects your OS, downloads the right package, and skips if you're already on the latest version.

### Or download a package

Latest release → <https://github.com/edison7009/EchoBird/releases/latest>

| Platform                    | Asset                                  |
| --------------------------- | -------------------------------------- |
| Windows x64                 | `EchoBird_<ver>_Windows_x64-setup.exe` |
| macOS (Apple Silicon)       | `EchoBird_<ver>_macOS_arm64.dmg`       |
| Linux x64 · Debian/Ubuntu   | `EchoBird_<ver>_Linux_x64.deb`         |
| Linux arm64 · Debian/Ubuntu | `EchoBird_<ver>_Linux_arm64.deb`       |
| Linux x64 · Fedora/RHEL     | `EchoBird_<ver>_Linux_x64.rpm`         |
| Linux arm64 · Fedora/RHEL   | `EchoBird_<ver>_Linux_arm64.rpm`       |

## License & Trademarks

**Code** — EchoBird **v5.0.0 and later** are licensed under the
[MIT License](LICENSE). The full source is open — fork it, study it,
ship it. EchoBird
**v4.x and earlier** remain under AGPL-3.0-or-later in perpetuity
(already-released v4.x binaries are not retroactively relicensed).
See [NOTICE](NOTICE) for attribution.

**Trade dress + brand** — EchoBird's primary protection is its **UI / UX trade
dress**: the specific combination of four user-facing surfaces sharing one
central model hub, plus the bundling of two complete reference applications
(Reversi + AI Translator) as user tutorial templates. The wordmark **EchoBird**
is a common-law trademark of edison7009; feature labels like _Model Nexus_ /
_模型中心_ are descriptive and protected only as part of the trade dress.
**Forks are welcome — no need to scrub our name and logo.** If your fork
honestly credits EchoBird as upstream, you may keep our identity visible
(e.g. "EchoBird Community Edition by X"). If you prefer to rebrand entirely,
that's also fine — just keep the NOTICE attribution. The hard lines are:
**commercial SaaS / app-store products literally branded "EchoBird"**
without permission; **presenting the code as your own from-scratch original
work**; and **adopting three or more of our four UI surfaces side-by-side in
a competing product without independent prior-work documentation** (see
[NOTICE](NOTICE) for the formal threshold). See [TRADEMARKS.md](TRADEMARKS.md)
for the full policy.

---

<p align="center">
  Made with 💚 by EchoBird Team<br>
  <sub>⭐ <a href="https://github.com/edison7009/EchoBird">Star on GitHub</a> · <a href="README.zh-CN.md">中文文档</a></sub>
</p>
