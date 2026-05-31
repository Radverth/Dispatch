# Dispatch

A VS Code extension for developers holding complimentary OpenAI API tokens under OpenAI's data-sharing programme. Dispatch gives you smart model routing, a diff-first code review flow, a living PLAN.md task system, and a real-time daily token usage dashboard — all from a single API key. No backend. No telemetry. No social login.

---

## Requirements

- VS Code 1.85.0 or later
- An OpenAI API key with access to the complimentary token programme
- **Linux only:** `libsecret` for secure key storage

```bash
# Ubuntu / Debian
sudo apt-get install libsecret-1-dev

# Fedora
sudo dnf install libsecret-devel
```

---

## Installation

### From GitHub Releases (recommended)

1. Go to the [Releases](../../releases) page
2. Download the VSIX for your platform:
   - **Windows:** `dispatch-win32-x64.vsix`
   - **Linux:** `dispatch-linux-x64.vsix`
3. In VS Code, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
4. Run **Extensions: Install from VSIX...**
5. Select the downloaded file
6. Reload VS Code when prompted

### From the Command Line

```bash
code --install-extension dispatch-win32-x64.vsix   # Windows
code --install-extension dispatch-linux-x64.vsix   # Linux
```

---

## Setup

On first launch, Dispatch will prompt you to add your API key.

1. Click **Set Key** in the notification, or open the Command Palette and run **Dispatch: Set API Key**
2. Paste your OpenAI API key and press Enter
3. Dispatch validates the key against the OpenAI API and saves it securely
4. The Chat and Usage panels activate immediately

Your key is stored exclusively in VS Code's built-in secret storage (Windows Credential Manager on Windows, libsecret on Linux). It is never written to any file, log, or settings.json.

---

## Daily Token Allowances

Dispatch is designed for users on the complimentary OpenAI token programme:

| Group | Models | Daily allowance |
|---|---|---|
| 1M | gpt-5.x, gpt-4.x, o1, o3 families | 250,000 tokens |
| 10M | mini, nano, codex-mini families | 2,500,000 tokens |

Dispatch tracks usage per group and warns at 80% of each daily budget. Token counts shown are estimates derived from the OpenAI API response — verify exact consumption at [platform.openai.com](https://platform.openai.com).

---

## Features

### Smart Model Routing

Dispatch analyses your prompt and active file to select the right model automatically:

| Task type | Model used | Group |
|---|---|---|
| Planning, architecture | gpt-5.5-2026-04-23 | 1M |
| Complex / multi-file coding | gpt-5.1-codex | 1M |
| Standard single-file coding | gpt-5.1-codex-mini | 10M |
| Prose, email, documents | gpt-5.4-mini-2026-03-17 | 10M |
| Short mechanical edits | gpt-5.4-nano-2026-03-17 | 10M |
| Deep reasoning (manual) | o3-2025-04-16 | 1M |

You can override the model at any time using the dropdown in the Chat panel.

---

### Diff-First Code Review

Dispatch never modifies your files without your review.

1. Type a coding request in the Chat panel
2. Dispatch streams its reasoning and a plain-English summary of the proposed change
3. A diff view opens automatically: your current file on the left, the proposed change on the right
4. **Accept** — the change is applied via VS Code's WorkspaceEdit (fully undoable with `Ctrl+Z`)
5. **Reject** — your file is untouched

After accepting, Dispatch asks "Did that work?" Your Yes / No response updates PLAN.md automatically.

---

### PLAN.md Living Document

On your first coding request in a new workspace, Dispatch creates a `PLAN.md` at the project root. This is the persistent working memory for your project.

```
[ ]  Pending
[>]  In progress
[x]  Confirmed done
[~]  Failed — needs rework
```

Every coding call includes the full PLAN.md as context. Checklist items update automatically based on your feedback. You can edit PLAN.md freely at any time — your changes take effect on the next call.

---

### Usage Dashboard

Open the **Usage** tab in the Dispatch sidebar to see:

- Today's token consumption for each group, with progress bars
- A 7-day bar chart for both groups
- Per-model breakdown for today
- Warning indicators at 80% of daily budget

> Token counts are estimates. Verify at platform.openai.com

---

## Command Palette

All commands are available via `Ctrl+Shift+P` / `Cmd+Shift+P`:

| Command | Description |
|---|---|
| **Dispatch: Set API Key** | Save your OpenAI API key |
| **Dispatch: Clear API Key** | Remove the stored key |
| **Dispatch: Validate API Key** | Check the stored key is still valid |
| **Dispatch: Open Chat** | Focus the Chat panel |
| **Dispatch: View Usage Dashboard** | Focus the Usage panel |
| **Dispatch: Open PLAN.md** | Open the workspace PLAN.md |
| **Dispatch: Reset Today's Usage** | Clear today's token counts |
| **Dispatch: Check for Updates** | Manually check for a new version |

---

## Updates

Dispatch checks for updates silently on each session start. If a new version is available, a notification appears in the Chat panel. Click **Update** to install it in the background — no browser, no release pages. If an update fails, reload VS Code and reinstall from the Releases page.

---

## Privacy

- No analytics, no telemetry, no usage data sent anywhere except the OpenAI API
- Your API key never leaves VS Code's secret storage
- Outbound connections: `api.openai.com` only (update checks use `api.github.com`)

---

## Building from Source

```bash
git clone https://github.com/radverth/dispatch.git
cd dispatch
npm install
npm run compile
npx vsce package --target linux-x64   # or win32-x64
```

Run checks:

```bash
npm run lint          # ESLint
npx tsc --noEmit      # TypeScript
npm run test:unit     # Jest unit tests
```

---

## Licence

MIT — see [LICENSE](LICENSE)

---

*Created by Tom Austin*
