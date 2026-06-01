import * as vscode from 'vscode';
import { checkForUpdates } from '../updateChecker';
import { SecretManager } from '../secretManager';
import { UsageTracker } from '../usageTracker';
import { PlanManager } from '../planManager';
import { ChatHistory } from '../chatHistory';
import { routeTask } from '../modelRouter';
import { sanitise } from '../sanitiser';
import { streamCompletion, Message, validateApiKey } from '../apiClient';
import { openDiff, applyChange, cleanupShadow, getLastShadowUri, getLastEmptyShadowUri } from '../diffEditor';
import {
  PROMPT_GLOBAL_SYSTEM, PROMPT_PLANNING_SYSTEM, PROMPT_CODE_SYSTEM,
  PROMPT_REFACTOR_SYSTEM, PROMPT_PROSE_SYSTEM, PROMPT_MECHANICAL_SYSTEM,
} from '../prompts';
import { BUDGETS } from '../modelRegistry';
import { getChatHtml } from './chatPanelHtml';

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
  private readonly _chatHistory: ChatHistory;
  private _abortController?: AbortController;
  private _pendingChange?: { targetUri: vscode.Uri; newContent: string; summary: string };
  private _activePm?: PlanManager;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly secrets: SecretManager,
    private readonly usage: UsageTracker,
    private readonly workspaceRoot: string | undefined,
    private readonly globalState: vscode.Memento,
    private readonly log: vscode.OutputChannel,
    private readonly extensionVersion: string,
  ) {
    this._chatHistory = new ChatHistory(globalState);
  }

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
    webviewView.webview.html = getChatHtml(webviewView.webview, this.extensionUri);
    webviewView.webview.onDidReceiveMessage(msg => this._handleMessage(msg));
    webviewView.onDidDispose(() => { this._view = undefined; });
    this._sendInitialState();
  }

  private async _sendInitialState(): Promise<void> {
    const key = await this.secrets.getApiKey();
    if (!key) {
      this._post({ type: 'showSplash' });
      return;
    }
    const session = await this._chatHistory.ensureActive();
    this._post({ type: 'showChat' });
    this._post({ type: 'restoreMessages', messages: session.messages });
    this._post({ type: 'sessionsUpdate', sessions: this._chatHistory.summaryList() });
    await this._sendPlanStatus();
  }

  private async _sendPlanStatus(): Promise<void> {
    if (!this.workspaceRoot) return;
    const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
    let pm: PlanManager | undefined;
    if (activeFile) pm = await PlanManager.findForFile(this.workspaceRoot, activeFile);
    if (!pm) {
      const all = await PlanManager.findAll(this.workspaceRoot);
      pm = all[0];
    }
    if (pm) {
      const content = await pm.read();
      if (content) this._post({ type: 'planStatus', ...pm.getStatus(content) });
    }
  }

  private async _handleMessage(msg: { type: string; [key: string]: unknown }): Promise<void> {
    switch (msg.type) {
      case 'saveApiKey':   await this._handleSaveApiKey(String(msg.key)); break;
      case 'clearApiKey':  await this._handleClearApiKey(); break;
      case 'requestState': await this._sendInitialState(); break;
      case 'sendMessage':  await this._handleUserMessage(String(msg.text), String(msg.model || '')); break;
      case 'acceptDiff':   await this._handleAcceptDiff(); break;
      case 'rejectDiff':   await this._handleRejectDiff(); break;
      case 'feedbackYes':  await this._handleFeedbackYes(String(msg.taskText || ''), String(msg.logText || ''), String(msg.model || '')); break;
      case 'feedbackNo':   await this._handleFeedbackNo(String(msg.taskText || '')); break;
      case 'checkUpdates': await this._handleCheckUpdates(); break;
      case 'newChat':      await this._handleNewChat(); break;
      case 'switchChat':   await this._handleSwitchChat(String(msg.id)); break;
      case 'deleteChat':   await this._handleDeleteChat(String(msg.id)); break;
    }
  }

  private async _handleSaveApiKey(key: string): Promise<void> {
    const trimmed = key.trim();
    if (!trimmed) { this._post({ type: 'keyError', text: 'Key cannot be empty.' }); return; }
    this._post({ type: 'keyValidating' });
    const valid = await validateApiKey(trimmed);
    if (valid) {
      await this.secrets.setApiKey(trimmed);
      const session = await this._chatHistory.ensureActive();
      this._post({ type: 'showChat' });
      this._post({ type: 'restoreMessages', messages: session.messages });
      this._post({ type: 'sessionsUpdate', sessions: this._chatHistory.summaryList() });
      await this._sendPlanStatus();
    } else {
      this._post({ type: 'keyError', text: 'Invalid key — please check and try again.' });
    }
  }

  private async _handleClearApiKey(): Promise<void> {
    await this.secrets.clearApiKey();
    this._post({ type: 'showSplash' });
  }

  private async _handleNewChat(): Promise<void> {
    const session = await this._chatHistory.newSession();
    this._post({ type: 'restoreMessages', messages: session.messages });
    this._post({ type: 'sessionsUpdate', sessions: this._chatHistory.summaryList() });
  }

  private async _handleSwitchChat(id: string): Promise<void> {
    const session = await this._chatHistory.setActive(id);
    if (!session) return;
    this._post({ type: 'restoreMessages', messages: session.messages });
    this._post({ type: 'sessionsUpdate', sessions: this._chatHistory.summaryList() });
  }

  private async _handleDeleteChat(id: string): Promise<void> {
    await this._chatHistory.deleteSession(id);
    const session = await this._chatHistory.ensureActive();
    this._post({ type: 'restoreMessages', messages: session.messages });
    this._post({ type: 'sessionsUpdate', sessions: this._chatHistory.summaryList() });
  }

  private async _handleUserMessage(text: string, manualModel: string): Promise<void> {
    const result = sanitise(text);
    if (!result.ok) {
      this._post({ type: 'error', text: result.reason ?? 'Invalid input.' });
      return;
    }
    const apiKey = await this.secrets.getApiKey();
    if (!apiKey) { this._post({ type: 'showSplash' }); return; }

    const session = await this._chatHistory.ensureActive();
    const ext = vscode.window.activeTextEditor?.document.uri.fsPath;
    const fileExt = ext ? `.${ext.split('.').pop()}` : undefined;
    const routing = routeTask(result.text, fileExt, manualModel || undefined);

    const budget = this.usage.getBudgetStatus();
    const pct = routing.group === '1M' ? budget.group1MPercent : budget.group10MPercent;
    if (pct >= 1.0) {
      const choice = await vscode.window.showWarningMessage(
        `Dispatch: ${routing.group} group daily budget exhausted.`, 'Continue anyway', 'Cancel',
      );
      if (choice !== 'Continue anyway') return;
    } else if (pct >= BUDGETS.group1M.warnThreshold) {
      this._post({ type: 'budgetWarning', group: routing.group, percent: Math.round(pct * 100), model: routing.model });
    }

    // Find active project PLAN.md
    if (this.workspaceRoot) {
      const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
      if (activeFile) this._activePm = await PlanManager.findForFile(this.workspaceRoot, activeFile);
    }

    let planContent: string | undefined;
    if (this._activePm && await this._activePm.exists()) {
      planContent = await this._activePm.read();
      if (planContent) this._post({ type: 'planStatus', ...this._activePm.getStatus(planContent) });
    }

    const userContent = planContent
      ? `<plan-context>\n${planContent}\n</plan-context>\n\n<user-request>\n${result.text}\n</user-request>`
      : result.text;

    const apiHistory: Message[] = session.apiHistory;
    const messages: Message[] = [
      { role: 'system', content: PROMPT_GLOBAL_SYSTEM + '\n\n' + getSystemPrompt(routing.taskType) },
      ...apiHistory,
      { role: 'user', content: userContent },
    ];

    this._post({ type: 'modelLabel', model: routing.model, group: routing.group });
    this._post({ type: 'startStream' });
    this.log.appendLine(`[${new Date().toISOString()}] → ${routing.model} (${routing.group}) | task: ${routing.taskType}`);

    this._abortController = new AbortController();
    let fullResponse = '';

    await streamCompletion(apiKey, routing.model, messages, routing.taskType, {
      onChunk: (delta) => { fullResponse += delta; this._post({ type: 'chunk', delta }); },
      onDone: async (usageResult) => {
        this.usage.recordUsage(routing.model, usageResult.promptTokens, usageResult.completionTokens);
        this.log.appendLine(`    tokens: ${usageResult.promptTokens} prompt / ${usageResult.completionTokens} completion`);
        // Strip code blocks for display — code goes to the diff view, not the chat bubble
        const displayText = fullResponse.replace(/```[\w]*\n[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim();
        const newHistory: Message[] = [
          ...apiHistory,
          { role: 'user', content: result.text },
          { role: 'assistant', content: fullResponse },
        ];
        await this._chatHistory.addMessage(session.id, { role: 'user', text: result.text }, newHistory);
        await this._chatHistory.addMessage(session.id, { role: 'assistant', text: displayText }, newHistory);
        this._post({ type: 'sessionsUpdate', sessions: this._chatHistory.summaryList() });
        this._post({ type: 'trimLastMessage', text: displayText });
        this._post({ type: 'endStream' });
        this._handleModelResponse(fullResponse, routing.model, routing.taskType);
      },
      onError: (err) => {
        this.log.appendLine(`[${new Date().toISOString()}] ERROR: ${err.message}`);
        this._post({ type: 'trimLastMessage', text: '' });
        this._post({ type: 'endStream' });
        this._post({ type: 'error', text: `API error: ${err.message}` });
      },
    }, this._abortController.signal);
  }

  private async _handleModelResponse(response: string, model: string, taskType: string): Promise<void> {
    // Create a project when the response looks like an actual plan:
    // has checklist items OR a ## Tasks section (model may use numbered list despite instructions)
    const looksLikePlan = /\[ \]|\[>\]/.test(response) || /^##\s*Tasks/m.test(response);
    if (taskType === 'planning' && this.workspaceRoot && looksLikePlan) {
      const titleMatch = response.match(/^#\s*PLAN\.md\s*[-—]\s*(.+)$/m);
      const projectName = titleMatch?.[1]?.trim() ?? 'Project';

      // Normalise numbered tasks to checkboxes so the tracker works
      const normalised = response.replace(/^(\s*)\d+\.\s+/gm, '$1- [ ] ');
      const newPm = await PlanManager.createProject(this.workspaceRoot, projectName, normalised);
      this._activePm = newPm;
      this._post({ type: 'planStatus', ...newPm.getStatus(normalised) });

      // Create empty placeholder files listed in ## Files so directories exist
      const plannedFiles = extractPlannedFiles(normalised, '');
      const projectDir = newPm.getProjectDir();
      for (const relPath of plannedFiles) {
        const fileUri = vscode.Uri.joinPath(vscode.Uri.file(projectDir), relPath);
        const parentUri = vscode.Uri.joinPath(fileUri, '..');
        try {
          await vscode.workspace.fs.stat(fileUri);
        } catch {
          await vscode.workspace.fs.createDirectory(parentUri);
          await vscode.workspace.fs.writeFile(fileUri, Buffer.from('', 'utf8'));
        }
      }

      // Tell the user PLAN.md is ready and how to proceed
      const fileList = plannedFiles.length ? '\n' + plannedFiles.map(f => '  • ' + f).join('\n') : '';
      this._post({ type: 'chunk', delta: `\n\n_PLAN.md saved.${fileList}\n\nSay **"do it"** or name a task to start executing._` });

      const choice = await vscode.window.showInformationMessage(
        `Project "${newPm.projectName}" created with PLAN.md.`, 'Open PLAN.md',
      );
      if (choice === 'Open PLAN.md') await vscode.window.showTextDocument(newPm.getPlanUri());
      return;
    }

    // Match a closed code block, or fall back to an unclosed one (truncated response)
    const codeMatch = response.match(/```([\w]*)\n([\s\S]*?)```/) ??
                      response.match(/```([\w]*)\n([\s\S]+)$/);
    if (codeMatch) {
      let targetUri: vscode.Uri | undefined;

      // 1. Explicit path from the model always wins — anchor to project dir if active
      {
        const newFilePath = extractNewFilePath(response);
        if (newFilePath) {
          const base = this._activePm?.getProjectDir() ?? this.workspaceRoot;
          if (base) targetUri = vscode.Uri.joinPath(vscode.Uri.file(base), newFilePath);
        }
      }

      // 2. Active editor — but never overwrite PLAN.md itself
      if (!targetUri) {
        const active = vscode.window.activeTextEditor?.document.uri;
        if (active && !active.fsPath.endsWith('PLAN.md')) {
          targetUri = active;
        }
      }

      // 3a. If no explicit path but we have a planned file that already exists in the
      //     project directory, prefer that over prompting (handles "make a change to X")
      if (!targetUri && this.workspaceRoot && this._activePm) {
        const content = await this._activePm.read();
        if (content) {
          const lang = codeMatch[1];
          const planned = extractPlannedFiles(content, lang);
          for (const rel of planned) {
            const candidate = vscode.Uri.joinPath(vscode.Uri.file(this._activePm.getProjectDir()), rel);
            try {
              await vscode.workspace.fs.stat(candidate);
              targetUri = candidate;
              break;
            } catch { /* not on disk yet */ }
          }
        }
      }

      // 4. Planned files not yet on disk — pick one if multiple match
      if (!targetUri && this._activePm) {
        const content = await this._activePm.read();
        if (content) {
          const lang = codeMatch[1];
          const planned = extractPlannedFiles(content, lang);
          const projectDir = vscode.Uri.file(this._activePm.getProjectDir());
          const unwritten: string[] = [];
          for (const rel of planned) {
            try { await vscode.workspace.fs.stat(vscode.Uri.joinPath(projectDir, rel)); }
            catch { unwritten.push(rel); }
          }
          const candidates = unwritten.length ? unwritten : planned;
          if (candidates.length === 1) {
            targetUri = vscode.Uri.joinPath(projectDir, candidates[0]);
          } else if (candidates.length > 1) {
            const pick = await vscode.window.showQuickPick(candidates, { placeHolder: 'Which file to write?' });
            if (pick) targetUri = vscode.Uri.joinPath(projectDir, pick);
          }
        }
      }

      // 5. Last resort: ask the user, anchored to project dir if one is active
      if (!targetUri) {
        const base = this._activePm?.getProjectDir() ?? this.workspaceRoot;
        if (base) {
          const lang = codeMatch[1];
          const placeholder = langToExt(lang) ? `scripts/output${langToExt(lang)}` : 'output.txt';
          const input = await vscode.window.showInputBox({
            prompt: 'Save to (relative path in project)',
            placeHolder: placeholder,
            ignoreFocusOut: true,
          });
          if (input?.trim()) {
            targetUri = vscode.Uri.joinPath(vscode.Uri.file(base), input.trim());
          }
        }
      }

      if (targetUri) {
        const newContent = codeMatch[2];
        const summaryMatch = response.match(/Summary:\s*(.+)/i);
        const summary = summaryMatch ? summaryMatch[1].trim() : 'Proposed change';
        this._pendingChange = { targetUri, newContent, summary };
        await openDiff({ targetUri, newContent, summary });
        this._post({ type: 'showDiffActions', summary });
      }
    }

    const logMatch = response.match(/^LOG:\s*(.+)$/m);
    if (logMatch) this._post({ type: 'pendingLog', logText: logMatch[1], model });
  }

  private async _handleAcceptDiff(): Promise<void> {
    if (!this._pendingChange) return;
    const shadowUri = getLastShadowUri();
    const emptyUri  = getLastEmptyShadowUri();
    try {
      await applyChange(this._pendingChange.targetUri, this._pendingChange.newContent);
      this._post({ type: 'diffAccepted', summary: this._pendingChange.summary });
    } finally {
      if (shadowUri) await cleanupShadow(shadowUri);
      if (emptyUri)  await cleanupShadow(emptyUri);
      this._pendingChange = undefined;
    }
  }

  private async _handleRejectDiff(): Promise<void> {
    const shadowUri = getLastShadowUri();
    const emptyUri  = getLastEmptyShadowUri();
    if (shadowUri) await cleanupShadow(shadowUri);
    if (emptyUri)  await cleanupShadow(emptyUri);
    this._pendingChange = undefined;
    this._post({ type: 'diffRejected' });
  }

  private async _handleFeedbackYes(taskText: string, logText: string, model: string): Promise<void> {
    const pm = this._activePm;
    if (!pm) return;
    if (taskText) {
      // Try [>] first (in-progress), fall back to [ ] (pending) so the tick always lands
      const updated = await pm.updateChecklistItem(taskText, '[>]', '[x]');
      if (!updated) await pm.updateChecklistItem(taskText, '[ ]', '[x]');
    }
    if (logText) await pm.appendChangeLog(model, logText);
  }

  private async _handleFeedbackNo(taskText: string): Promise<void> {
    const pm = this._activePm;
    if (!pm) return;
    if (taskText) {
      const updated = await pm.updateChecklistItem(taskText, '[>]', '[~]');
      if (!updated) await pm.updateChecklistItem(taskText, '[ ]', '[~]');
      await pm.appendSurprise('User reported change did not work.');
    }
  }

  private async _handleCheckUpdates(): Promise<void> {
    this._post({ type: 'updateChecking' });
    const result = await checkForUpdates(this.extensionVersion);
    const statusText =
      result === 'upToDate'    ? 'You\'re up to date.' :
      result === 'updateFound' ? 'Update available — see notification.' :
                                 'Could not check for updates.';
    this._post({ type: 'updateCheckDone', statusText });
  }

  private _post(msg: Record<string, unknown>): void {
    this._view?.webview.postMessage(msg);
  }
}

// Parse a new file path from the model response.
// Looks for explicit "NEW FILE: path" or "Summary: Adding `path`" patterns.
function extractNewFilePath(response: string): string | undefined {
  const explicit = response.match(/^NEW FILE:\s*([^\s\n]+)/m);
  if (explicit) return explicit[1].trim();
  const inSummary = response.match(/Summary:.*?(?:adding|creating|writing)\s+[`']([^`'\n]+\.[a-zA-Z0-9]+)[`']/i);
  return inSummary?.[1];
}

// Extract file paths from PLAN.md's ## Files section, optionally filtered by extension
function extractPlannedFiles(planContent: string, lang: string): string[] {
  const section = planContent.match(/^##\s*Files\s*\n([\s\S]*?)(?=^##|$)/m);
  if (!section) return [];
  const ext = langToExt(lang);
  return [...section[1].matchAll(/`([^`]+\.[a-zA-Z0-9]+)`/g)]
    .map(m => m[1])
    .filter(p => !ext || p.endsWith(ext));
}

function langToExt(lang: string): string {
  const map: Record<string, string> = {
    typescript: '.ts', javascript: '.js', python: '.py', powershell: '.ps1',
    bash: '.sh', sh: '.sh', rust: '.rs', go: '.go', java: '.java',
    csharp: '.cs', cs: '.cs', cpp: '.cpp', c: '.c', ruby: '.rb',
    php: '.php', swift: '.swift', kotlin: '.kt', yaml: '.yml', json: '.json',
  };
  return map[lang.toLowerCase()] ?? '';
}
