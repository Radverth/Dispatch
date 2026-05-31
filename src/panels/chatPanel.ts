import * as vscode from 'vscode';
import * as path from 'path';
import { SecretManager } from '../secretManager';
import { UsageTracker } from '../usageTracker';
import { PlanManager } from '../planManager';
import { routeTask } from '../modelRouter';
import { sanitise } from '../sanitiser';
import { streamCompletion, Message } from '../apiClient';
import { openDiff, applyChange, cleanupShadow, getLastShadowUri } from '../diffEditor';
import { PROMPT_GLOBAL_SYSTEM, PROMPT_PLANNING_SYSTEM, PROMPT_CODE_SYSTEM, PROMPT_REFACTOR_SYSTEM, PROMPT_PROSE_SYSTEM, PROMPT_MECHANICAL_SYSTEM } from '../prompts';
import { BUDGETS } from '../modelRegistry';

function getSystemPrompt(taskType: string): string {
  switch (taskType) {
    case 'planning':  return PROMPT_PLANNING_SYSTEM;
    case 'refactor':  return PROMPT_REFACTOR_SYSTEM;
    case 'prose':     return PROMPT_PROSE_SYSTEM;
    case 'mechanical': return PROMPT_MECHANICAL_SYSTEM;
    default:          return PROMPT_CODE_SYSTEM;
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
  }

  private async _handleMessage(msg: { type: string; [key: string]: unknown }): Promise<void> {
    switch (msg.type) {
      case 'sendMessage':
        await this._handleUserMessage(String(msg.text), String(msg.model || ''));
        break;
      case 'acceptDiff':
        await this._handleAcceptDiff();
        break;
      case 'rejectDiff':
        await this._handleRejectDiff();
        break;
      case 'feedbackYes':
        await this._handleFeedbackYes(String(msg.taskText || ''));
        break;
      case 'feedbackNo':
        await this._handleFeedbackNo(String(msg.taskText || ''));
        break;
    }
  }

  private async _handleUserMessage(text: string, manualModel: string): Promise<void> {
    const result = sanitise(text);
    if (!result.ok) {
      this._post({ type: 'error', text: result.reason ?? 'Invalid input.' });
      return;
    }

    const apiKey = await this.secrets.getApiKey();
    if (!apiKey) {
      this._post({ type: 'error', text: 'No API key set. Use Dispatch: Set API Key.' });
      return;
    }

    // Budget check
    const budget = this.usage.getBudgetStatus();
    const routing = routeTask(
      result.text,
      vscode.window.activeTextEditor?.document.uri.fsPath.split('.').pop() ? `.${vscode.window.activeTextEditor?.document.uri.fsPath.split('.').pop()}` : undefined,
      manualModel || undefined,
    );

    const pct = routing.group === '1M' ? budget.group1MPercent : budget.group10MPercent;
    if (pct >= 1.0) {
      const choice = await vscode.window.showWarningMessage(
        `Dispatch: ${routing.group} group daily budget exhausted.`,
        'Continue anyway', 'Cancel',
      );
      if (choice !== 'Continue anyway') return;
    } else if (pct >= BUDGETS.group1M.warnThreshold) {
      this._post({
        type: 'budgetWarning',
        group: routing.group,
        percent: Math.round(pct * 100),
        model: routing.model,
      });
    }

    // Load PLAN.md context
    let planContent: string | undefined;
    if (this.workspaceRoot) {
      const pm = new PlanManager(this.workspaceRoot);
      if (await pm.exists()) {
        planContent = await pm.read();
        if (planContent) {
          const status = pm.getStatus(planContent);
          this._post({ type: 'planStatus', ...status });
        }
      } else if (routing.taskType === 'planning') {
        // Will create PLAN.md from response
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
      onDone: (usage) => {
        this.usage.recordUsage(routing.model, usage.promptTokens, usage.completionTokens);
        this._history.push({ role: 'user', content: result.text });
        this._history.push({ role: 'assistant', content: fullResponse });
        // Keep history manageable
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
    // Handle PLAN.md creation for planning tasks
    if (taskType === 'planning' && this.workspaceRoot) {
      const pm = new PlanManager(this.workspaceRoot);
      if (!await pm.exists()) {
        await pm.create(response);
        const choice = await vscode.window.showInformationMessage('PLAN.md created.', 'Open');
        if (choice === 'Open' && pm.getPlanUri()) {
          await vscode.window.showTextDocument(pm.getPlanUri()!);
        }
        return;
      }
    }

    // Extract proposed code block for diff view (code-type tasks)
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

    // Extract LOG line
    const logMatch = response.match(/^LOG:\s*(.+)$/m);
    if (logMatch && this.workspaceRoot) {
      // Store for use after feedback
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
    }
  }

  private async _handleRejectDiff(): Promise<void> {
    const shadowUri = getLastShadowUri();
    if (shadowUri) await cleanupShadow(shadowUri);
    this._pendingChange = undefined;
    this._post({ type: 'diffRejected' });
  }

  private async _handleFeedbackYes(taskText: string): Promise<void> {
    if (!this.workspaceRoot) return;
    const pm = new PlanManager(this.workspaceRoot);
    if (taskText) await pm.updateChecklistItem(taskText, '[>]', '[x]');
    // Change log appended by extension after receiving the LOG line
  }

  private async _handleFeedbackNo(taskText: string): Promise<void> {
    if (!this.workspaceRoot) return;
    const pm = new PlanManager(this.workspaceRoot);
    if (taskText) {
      await pm.updateChecklistItem(taskText, '[>]', '[~]');
      const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      await pm.appendSurprise(`[${timestamp}] User reported change did not work.`);
    }
  }

  private _post(msg: Record<string, unknown>): void {
    this._view?.webview.postMessage(msg);
  }

  private _getHtml(webview: vscode.Webview): string {
    const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media');
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'dispatch.css'));
    const chatJsUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'chat.js'));
    const nonce = getNonce();

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
  <title>Dispatch Chat</title>
</head>
<body>
  <div id="update-bar" class="bar update-bar hidden">
    A Dispatch update is available.
    <button id="btn-update">Update</button>
    <button id="btn-dismiss-update">Dismiss</button>
  </div>
  <div id="budget-bar" class="bar budget-bar hidden"></div>
  <div id="model-bar" class="model-bar">
    <span id="model-label">—</span>
    <select id="model-override">
      <option value="">Auto</option>
      <optgroup label="1M Group">
        <option value="gpt-5.5-2026-04-23">gpt-5.5-2026-04-23</option>
        <option value="gpt-5.1-codex">gpt-5.1-codex</option>
        <option value="gpt-5.4-2026-03-05">gpt-5.4-2026-03-05</option>
        <option value="gpt-5.2-2025-12-11">gpt-5.2-2025-12-11</option>
        <option value="gpt-5.1-2025-11-13">gpt-5.1-2025-11-13</option>
        <option value="gpt-5-codex">gpt-5-codex</option>
        <option value="gpt-5-2025-08-07">gpt-5-2025-08-07</option>
        <option value="o3-2025-04-16">o3-2025-04-16</option>
        <option value="o1-2024-12-17">o1-2024-12-17</option>
        <option value="gpt-4.1-2025-04-14">gpt-4.1-2025-04-14</option>
        <option value="gpt-4o-2024-11-20">gpt-4o-2024-11-20</option>
      </optgroup>
      <optgroup label="10M Group">
        <option value="gpt-5.1-codex-mini">gpt-5.1-codex-mini</option>
        <option value="gpt-5.4-mini-2026-03-17">gpt-5.4-mini-2026-03-17</option>
        <option value="gpt-5.4-nano-2026-03-17">gpt-5.4-nano-2026-03-17</option>
        <option value="gpt-5-mini-2025-08-07">gpt-5-mini-2025-08-07</option>
        <option value="gpt-5-nano-2025-08-07">gpt-5-nano-2025-08-07</option>
        <option value="gpt-4.1-mini-2025-04-14">gpt-4.1-mini-2025-04-14</option>
        <option value="o4-mini-2025-04-16">o4-mini-2025-04-16</option>
        <option value="codex-mini-latest">codex-mini-latest</option>
      </optgroup>
    </select>
  </div>
  <div id="plan-status" class="plan-status hidden"></div>
  <div id="messages"></div>
  <div id="diff-actions" class="diff-actions hidden">
    <span id="diff-summary"></span>
    <button id="btn-accept">Accept</button>
    <button id="btn-reject">Reject</button>
  </div>
  <div id="feedback-actions" class="feedback-actions hidden">
    Did that work?
    <button id="btn-yes">Yes</button>
    <button id="btn-no">No</button>
  </div>
  <div class="input-row">
    <textarea id="input" placeholder="Ask Dispatch..." rows="3"></textarea>
    <button id="btn-send">Send</button>
  </div>
  <script nonce="${nonce}" src="${chatJsUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
