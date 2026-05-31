# Dispatch — VS Code Extension

## Project Summary
A VS Code extension routing AI coding and writing tasks to the optimal OpenAI
model based on task type, tracking daily token usage, and maintaining a living
PLAN.md for all coding work. Diff-first code review flow. Silent auto-update.

No backend. No telemetry. Windows + Linux only. API key only.

## Tech Stack
- TypeScript strict mode
- VS Code Extension API (minimum 1.85.0)
- Node.js 18 native fetch — no axios, no node-fetch
- Webview panels: vanilla HTML/CSS/JS — no React, no bundler for webviews
- Build: tsc only
- Tests: Jest (unit) + @vscode/test-cli/Mocha (integration)
- Lint: ESLint + @typescript-eslint
- Package: @vscode/vsce

## Repository
GitHub repo: tomaustin/dispatch
Update check fetches GitHub Releases API — this is internal infrastructure only.
The user never sees GitHub, release pages, URLs, or version numbers on failure.

## Directory Layout
src/
  extension.ts      — activate(), deactivate(), command registration
  apiClient.ts      — OpenAI SSE streaming
  modelRouter.ts    — task detection, model selection
  modelRegistry.ts  — model lists, group membership, deprecated flags
  planManager.ts    — PLAN.md create/read/updateChecklist/appendLog
  diffEditor.ts     — shadow file, diff launch, accept/reject, cleanup
  usageTracker.ts   — globalState usage tracking
  secretManager.ts  — SecretStorage wrapper
  updateChecker.ts  — version check + silent install
  prompts.ts        — all system prompt constants
  sanitiser.ts      — input validation, injection detection
  panels/
    chatPanel.ts    — Webview chat
    usagePanel.ts   — Webview usage dashboard

## Never Do
- Write the API key to any file, log, console, or output channel
- Use localStorage or sessionStorage in webviews
- Add npm packages to the production VSIX bundle without approval
- Delete workspace files
- Write to the real file before the user accepts the diff
- Show raw code blocks in the chat panel for coding responses —
  the diff view is where the user reads proposed code
- Use gpt-4.5-preview-2025-02-27 — it is shut down
- Use gpt-5-chat-latest in routing — manual override only
- Use `any` in TypeScript without an explanatory comment
- Construct system prompts by string concatenation at runtime
- Fetch external URLs other than api.openai.com and api.github.com
- Relax webview CSP — connect-src must only include api.openai.com
- Show the user any reference to GitHub, release pages, URLs, or
  version numbers when an auto-update fails — the error message is:
  "Dispatch update failed. Please reinstall the extension." — nothing more

## Always Do
- Use vscode.SecretStorage for the API key
- Run `npx tsc --noEmit` after every change
- Prefix all commands with `dispatch.` in package.json contributes
- Stream API responses via SSE
- Show model name and group in chat panel on every response
- Open a diff view automatically for every coding response
- Write proposed changes to a shadow temp file first — never touch the real
  file until the user accepts the diff
- Clean up shadow files in a finally block — always, even on error
- Show "Did that work?" after every accepted diff
- Update PLAN.md checklist based on user's Yes/No feedback
- Keep each src/ file under 300 lines — split if larger
- Sanitise all user input through sanitiser.ts
- Check applyEdit return value — handle false as an error
- Dispose webview panels via onDidDispose()
- Namespace all globalState keys with 'dispatch.' prefix
- Include User-Agent header in GitHub API calls

## Output Quality Rules
- Reason before writing: state your understanding and approach before code
- Critique before output: check correctness, edge cases, security, style
- Show evidence: after changes, confirm tsc --noEmit passes; show output
- Targeted edits only: never rewrite a whole file for a small change
- Explain the WHY: state what problem the change solves and why this approach
- Flag risks: breaking changes, security implications, side effects
- No placeholder code: no TODO, no stubs, no incomplete implementations
- One task at a time: note unrelated issues in PLAN.md, don't bundle them
- If ambiguous: state interpretation explicitly, then proceed

## PLAN.md Behaviour
- Read at the start of every coding session
- Checklist states: [ ] pending  [>] in progress  [x] confirmed  [~] failed
- Mark [>] when beginning a task
- Mark [x] when user confirms success (Yes on feedback prompt)
- Mark [~] when user reports failure (No on feedback prompt)
- Append to ## Surprises & Discoveries when unexpected issues arise
- Append to ## Change Log after every completed task
- Never overwrite the full file — surgical line replacements only

## Auto-Update Rules
- Update check is silent infrastructure — never expose GitHub or release URLs
- On failure: show "Dispatch update failed. Please reinstall the extension."
- No version numbers, no links, no references to GitHub, no further instruction
- User clicks Update → silent download and install → reload prompt on success

## Model Routing
### 1M Group — 250K tokens/day
  gpt-5.5-2026-04-23       → planning, architecture, escalation
  gpt-5.1-codex            → complex multi-file coding
  o3-2025-04-16            → deep reasoning, user-triggered only

### 10M Group — 2.5M tokens/day
  gpt-5.1-codex-mini       → standard single-file coding
  gpt-5.4-mini-2026-03-17  → prose, email, documents
  gpt-5.4-nano-2026-03-17  → mechanical edits, PLAN.md updates

Full lists including fallbacks: modelRegistry.ts

## Budget
1M: 250,000 tokens/day — warn at 80%, soft block at 100%
10M: 2,500,000 tokens/day — warn at 80%, soft block at 100%
Disclaimer: "Estimates only — verify at platform.openai.com"

## Credit
"Dispatch · Created by Tom Austin" in Usage dashboard footer.
No GitHub links, no personal URLs, nowhere in the UI.

## Build Commands
npm run compile          # tsc
npm run watch            # tsc --watch
npm run lint             # eslint src/
npm run test:unit        # jest
npm run test:integration # vscode-test
npx vsce package         # build .vsix

## Common Mistakes
- Do not write to the real file before diff is accepted
- Do not forget to delete shadow files in a finally block
- Do not show raw code blocks in chat for coding responses
- Do not call applyEdit without checking the boolean return
- Do not forget onDidDispose() for Webview panels
- Do not put any part of the API key in error messages
- Do not let the SSE stream reader leak — cancel in finally
- globalState keys must be 'dispatch.X' not 'X'
- GitHub API without User-Agent returns 403
