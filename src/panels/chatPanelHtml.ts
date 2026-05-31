import * as vscode from 'vscode';

export function getChatHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const mediaUri = vscode.Uri.joinPath(extensionUri, 'media');
  const cssUri   = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'dispatch.css'));
  const jsUri    = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'chat.js'));
  const nonce    = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             script-src 'nonce-${nonce}';
             style-src ${webview.cspSource};
             img-src ${webview.cspSource} data:;
             connect-src https://api.openai.com;">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>

  <!-- ── Splash screen ── -->
  <div id="screen-splash" class="screen hidden">
    <div class="splash-inner">
      <div class="splash-logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
        </svg>
      </div>
      <h1 class="splash-title">Dispatch</h1>
      <p class="splash-sub">Paste your OpenAI API key to get started.</p>
      <div class="key-field">
        <input id="splash-key-input" type="password" placeholder="sk-..." spellcheck="false" autocomplete="off">
        <button id="splash-save-btn">Save key</button>
      </div>
      <p id="splash-error" class="key-error hidden"></p>
      <p class="splash-hint">Your key is stored in VS Code's secure secret storage and never written to any file.</p>
    </div>
  </div>

  <!-- ── Settings screen ── -->
  <div id="screen-settings" class="screen hidden">
    <div class="settings-header">
      <button id="settings-back-btn" class="icon-btn" title="Back to chat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <span>Settings</span>
    </div>
    <div class="settings-body">
      <label class="settings-label">API Key</label>
      <div class="key-field">
        <input id="settings-key-input" type="password" placeholder="sk-…" spellcheck="false" autocomplete="off">
        <button id="settings-save-btn">Update</button>
      </div>
      <p id="settings-error" class="key-error hidden"></p>
      <button id="settings-clear-btn" class="danger-btn">Clear API key</button>
      <div class="settings-divider"></div>
      <label class="settings-label">Updates</label>
      <button id="settings-update-btn" class="btn-secondary">Check for updates</button>
      <p id="settings-update-status" class="settings-update-status hidden"></p>
    </div>
  </div>

  <!-- ── Chat screen ── -->
  <div id="screen-chat" class="screen hidden">

    <div class="chat-header">
      <div class="header-left">
        <span id="model-label" class="model-label">—</span>
        <select id="model-override" title="Override model">
          <option value="">Auto</option>
          <optgroup label="1M Group">
            <option value="gpt-5.5-2026-04-23">gpt-5.5</option>
            <option value="gpt-5.1-codex">gpt-5.1-codex</option>
            <option value="gpt-5.4-2026-03-05">gpt-5.4</option>
            <option value="gpt-5.2-2025-12-11">gpt-5.2</option>
            <option value="gpt-5-codex">gpt-5-codex</option>
            <option value="gpt-5-2025-08-07">gpt-5</option>
            <option value="o3-2025-04-16">o3</option>
            <option value="o1-2024-12-17">o1</option>
            <option value="gpt-4.1-2025-04-14">gpt-4.1</option>
            <option value="gpt-4o-2024-11-20">gpt-4o</option>
          </optgroup>
          <optgroup label="10M Group">
            <option value="gpt-5.1-codex-mini">codex-mini</option>
            <option value="gpt-5.4-mini-2026-03-17">gpt-5.4-mini</option>
            <option value="gpt-5.4-nano-2026-03-17">gpt-5.4-nano</option>
            <option value="gpt-5-mini-2025-08-07">gpt-5-mini</option>
            <option value="gpt-5-nano-2025-08-07">gpt-5-nano</option>
            <option value="gpt-4.1-mini-2025-04-14">gpt-4.1-mini</option>
            <option value="o4-mini-2025-04-16">o4-mini</option>
            <option value="codex-mini-latest">codex-mini-latest</option>
          </optgroup>
        </select>
      </div>
      <div style="display:flex;gap:2px;align-items:center;">
        <button id="btn-new-chat" class="icon-btn" title="New chat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <button id="settings-btn" class="icon-btn" title="Settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Session switcher -->
    <div id="sessions-bar" class="sessions-bar hidden">
      <div id="sessions-list" class="sessions-list"></div>
    </div>

    <div id="budget-bar" class="budget-bar hidden"></div>
    <div id="plan-status" class="plan-status hidden"></div>

    <div id="messages"></div>

    <div id="diff-actions" class="action-bar hidden">
      <span id="diff-summary" class="action-label"></span>
      <div class="action-btns">
        <button id="btn-accept" class="btn-primary">Accept</button>
        <button id="btn-reject" class="btn-secondary">Reject</button>
      </div>
    </div>

    <div id="feedback-actions" class="action-bar hidden">
      <span class="action-label">Did that work?</span>
      <div class="action-btns">
        <button id="btn-yes" class="btn-primary">Yes</button>
        <button id="btn-no" class="btn-secondary">No</button>
      </div>
    </div>

    <div class="input-area">
      <textarea id="input" placeholder="Ask Dispatch…" rows="3"></textarea>
      <button id="btn-send" title="Send">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
    </div>

  </div>

  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
