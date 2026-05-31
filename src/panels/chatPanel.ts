import * as vscode from 'vscode';
import { checkForUpdates } from '../updateChecker';
import { SecretManager } from '../secretManager';
import { UsageTracker } from '../usageTracker';
import { PlanManager } from '../planManager';
import { routeTask } from '../modelRouter';
import { sanitise } from '../sanitiser';
import { streamCompletion, Message, validateApiKey } from '../apiClient';
import { openDiff, applyChange, cleanupShadow, getLastShadowUri } from '../diffEditor';
import {
  PROMPT_GLOBAL_SYSTEM, PROMPT_PLANNING_SYSTEM, PROMPT_CODE_SYSTEM,
  PROMPT_REFACTOR_SYSTEM, PROMPT_PROSE_SYSTEM, PROMPT_MECHANICAL_SYSTEM,
} from '../prompts';
import { BUDGETS } from '../modelRegistry';

function getSystemPrompt(taskType: string): string {
  switch (taskType) {
    case 'planning':   return PROMPT_PLANNING_SYSTEM;
    case 'refactor':   return PROMPT_REFACTOR_SYSTEM;
    case 'prose':      return PROMPT_PROSE_SYSTEM;
    case 'mechanical': return PROMPT_MECHANICAL_SYSTEM;
    default:           return PROMPT_CODE_SYSTEM;
  }
}

export class ChatPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'dispatch.chatView';

  private _view?: vscode.WebviewView;
  private readonly _history: Message[] = [];
  private _abortController?: AbortController;
  private _pendingChange?: { targetUri: vscode.Uri; newContent: string; summary: string };

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly secrets: SecretManager,
    private readonly usage: UsageTracker,
    private readonly workspaceRoot: string | undefined,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };

    webviewView.webview.html = this._getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(msg => this._handleMessage(msg));
    webviewView.onDidDispose(() => { this._view = undefined; });

    // Send initial state once the webview is ready
    this._sendInitialState();
  }

  private async _sendInitialState(): Promise<void> {
    const key = await this.secrets.getApiKey();
    if (!key) {
      this._post({ type: 'showSplash' });
    } else {
      this._post({ type: 'showChat' });
      await this._sendPlanStatus();
    }
  }

  private async _sendPlanStatus(): Promise<void> {
    if (!this.workspaceRoot) return;
    const pm = new PlanManager(this.workspaceRoot);
    if (await pm.exists()) {
      const content = await pm.read();
      if (content) {
        this._post({ type: 'planStatus', ...pm.getStatus(content) });
      }
    }
  }

  private async _handleMessage(msg: { type: string; [key: string]: unknown }): Promise<void> {
    switch (msg.type) {
      case 'saveApiKey':     await this._handleSaveApiKey(String(msg.key)); break;
      case 'clearApiKey':    await this._handleClearApiKey(); break;
      case 'requestState':   await this._sendInitialState(); break;
      case 'sendMessage':    await this._handleUserMessage(String(msg.text), String(msg.model || '')); break;
      case 'acceptDiff':     await this._handleAcceptDiff(); break;
      case 'rejectDiff':     await this._handleRejectDiff(); break;
      case 'feedbackYes':    await this._handleFeedbackYes(String(msg.taskText || ''), String(msg.logText || ''), String(msg.model || '')); break;
      case 'feedbackNo':     await this._handleFeedbackNo(String(msg.taskText || '')); break;
      case 'checkUpdates':   await this._handleCheckUpdates(); break;
    }
  }

  private async _handleSaveApiKey(key: string): Promise<void> {
    const trimmed = key.trim();
    if (!trimmed) {
      this._post({ type: 'keyError', text: 'Key cannot be empty.' });
      return;
    }
    this._post({ type: 'keyValidating' });
    const valid = await validateApiKey(trimmed);
    if (valid) {
      await this.secrets.setApiKey(trimmed);
      this._post({ type: 'showChat' });
      await this._sendPlanStatus();
    } else {
      this._post({ type: 'keyError', text: 'Invalid key — please check and try again.' });
    }
  }

  private async _handleClearApiKey(): Promise<void> {
    await this.secrets.clearApiKey();
    this._post({ type: 'showSplash' });
  }

  private async _handleUserMessage(text: string, manualModel: string): Promise<void> {
    const result = sanitise(text);
    if (!result.ok) {
      this._post({ type: 'error', text: result.reason ?? 'Invalid input.' });
      return;
    }

    const apiKey = await this.secrets.getApiKey();
    if (!apiKey) {
      this._post({ type: 'showSplash' });
      return;
    }

    const ext = vscode.window.activeTextEditor?.document.uri.fsPath;
    const fileExt = ext ? `.${ext.split('.').pop()}` : undefined;
    const routing = routeTask(result.text, fileExt, manualModel || undefined);

    const budget = this.usage.getBudgetStatus();
    const pct = routing.group === '1M' ? budget.group1MPercent : budget.group10MPercent;

    if (pct >= 1.0) {
      const choice = await vscode.window.showWarningMessage(
        `Dispatch: ${routing.group} group daily budget exhausted.`,
        'Continue anyway', 'Cancel',
      );
      if (choice !== 'Continue anyway') return;
    } else if (pct >= BUDGETS.group1M.warnThreshold) {
      this._post({ type: 'budgetWarning', group: routing.group, percent: Math.round(pct * 100), model: routing.model });
    }

    let planContent: string | undefined;
    if (this.workspaceRoot) {
      const pm = new PlanManager(this.workspaceRoot);
      if (await pm.exists()) {
        planContent = await pm.read();
        if (planContent) {
          this._post({ type: 'planStatus', ...pm.getStatus(planContent) });
        }
      }
    }

    const userContent = planContent
      ? `<plan-context>\n${planContent}\n</plan-context>\n\n<user-request>\n${result.text}\n</user-request>`
      : result.text;

    const messages: Message[] = [
      { role: 'system', content: PROMPT_GLOBAL_SYSTEM + '\n\n' + getSystemPrompt(routing.taskType) },
      ...this._history,
      { role: 'user', content: userContent },
    ];

    this._post({ type: 'modelLabel', model: routing.model, group: routing.group });
    this._post({ type: 'startStream' });

    this._abortController = new AbortController();
    let fullResponse = '';

    await streamCompletion(apiKey, routing.model, messages, routing.taskType, {
      onChunk: (delta) => {
        fullResponse += delta;
        this._post({ type: 'chunk', delta });
      },
      onDone: (usageResult) => {
        this.usage.recordUsage(routing.model, usageResult.promptTokens, usageResult.completionTokens);
        this._history.push({ role: 'user', content: result.text });
        this._history.push({ role: 'assistant', content: fullResponse });
        if (this._history.length > 20) this._history.splice(0, 2);
        this._post({ type: 'endStream' });
        this._handleModelResponse(fullResponse, routing.model, routing.taskType);
      },
      onError: (err) => {
        this._post({ type: 'error', text: `API error: ${err.message}` });
      },
    }, this._abortController.signal);
  }

  private async _handleModelResponse(response: string, model: string, taskType: string): Promise<void> {
    if (taskType === 'planning' && this.workspaceRoot) {
      const pm = new PlanManager(this.workspaceRoot);
      if (!await pm.exists()) {
        await pm.create(response);

        // Extract project name from PLAN.md title line: "# PLAN.md — Project Name"
        const titleMatch = response.match(/^#\s*PLAN\.md\s*[-—]\s*(.+)$/m);
        const projectName = titleMatch?.[1]?.trim();
        if (projectName) {
          await pm.ensureProjectDirectory(projectName);
        }

        const choice = await vscode.window.showInformationMessage('PLAN.md created.', 'Open');
        if (choice === 'Open' && pm.getPlanUri()) {
          await vscode.window.showTextDocument(pm.getPlanUri()!);
        }
        return;
      }
    }

    const codeMatch = response.match(/```[\w]*\n([\s\S]*?)```/);
    if (codeMatch && vscode.window.activeTextEditor) {
      const targetUri = vscode.window.activeTextEditor.document.uri;
      const newContent = codeMatch[1];
      const summaryMatch = response.match(/Summary:\s*(.+)/i);
      const summary = summaryMatch ? summaryMatch[1].trim() : 'Proposed change';
      this._pendingChange = { targetUri, newContent, summary };
      await openDiff({ targetUri, newContent, summary });
      this._post({ type: 'showDiffActions', summary });
    }

    const logMatch = response.match(/^LOG:\s*(.+)$/m);
    if (logMatch) {
      this._post({ type: 'pendingLog', logText: logMatch[1], model });
    }
  }

  private async _handleAcceptDiff(): Promise<void> {
    if (!this._pendingChange) return;
    const shadowUri = getLastShadowUri();
    try {
      await applyChange(this._pendingChange.targetUri, this._pendingChange.newContent);
      this._post({ type: 'diffAccepted', summary: this._pendingChange.summary });
    } finally {
      if (shadowUri) await cleanupShadow(shadowUri);
      this._pendingChange = undefined;
    }
  }

  private async _handleRejectDiff(): Promise<void> {
    const shadowUri = getLastShadowUri();
    if (shadowUri) await cleanupShadow(shadowUri);
    this._pendingChange = undefined;
    this._post({ type: 'diffRejected' });
  }

  private async _handleFeedbackYes(taskText: string, logText: string, model: string): Promise<void> {
    if (!this.workspaceRoot) return;
    const pm = new PlanManager(this.workspaceRoot);
    if (taskText) await pm.updateChecklistItem(taskText, '[>]', '[x]');
    if (logText) await pm.appendChangeLog(model, logText);
  }

  private async _handleFeedbackNo(taskText: string): Promise<void> {
    if (!this.workspaceRoot) return;
    const pm = new PlanManager(this.workspaceRoot);
    if (taskText) {
      await pm.updateChecklistItem(taskText, '[>]', '[~]');
      await pm.appendSurprise('User reported change did not work.');
    }
  }

  private async _handleCheckUpdates(): Promise<void> {
    this._post({ type: 'updateChecking' });
    const ext = vscode.extensions.getExtension('Tom-Austin.dispatch');
    const version: string = ext?.packageJSON?.version ?? '0.0.0';
    await checkForUpdates(version);
    this._post({ type: 'updateCheckDone' });
  }

  private _post(msg: Record<string, unknown>): void {
    this._view?.webview.postMessage(msg);
  }

  private _getHtml(webview: vscode.Webview): string {
    const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media');
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'dispatch.css'));
    const jsUri  = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'chat.js'));
    const nonce  = getNonce();

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
      <button id="settings-btn" class="icon-btn" title="Settings">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
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
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
