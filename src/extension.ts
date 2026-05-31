import * as vscode from 'vscode';
import { SecretManager } from './secretManager';
import { UsageTracker } from './usageTracker';
import { PlanManager } from './planManager';
import { validateApiKey } from './apiClient';
import { checkForUpdates } from './updateChecker';
import { ChatPanel } from './panels/chatPanel';
import { UsagePanel } from './panels/usagePanel';

let updateChecked = false;

export function activate(context: vscode.ExtensionContext): void {
  const secrets = new SecretManager(context.secrets);
  const usage = new UsageTracker(context.globalState);
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  const chatProvider = new ChatPanel(context.extensionUri, secrets, usage, workspaceRoot);
  const usageProvider = new UsagePanel(context.extensionUri, usage);

  // 'dispatch.chatViewPanel' is the same provider registered for the bottom panel container
  // so users can drag it to the right sidebar (secondary sidebar)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatPanel.viewType, chatProvider),
    vscode.window.registerWebviewViewProvider('dispatch.chatViewPanel', chatProvider),
    vscode.window.registerWebviewViewProvider(UsagePanel.viewType, usageProvider),
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('dispatch.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'Paste your OpenAI API key',
        password: true,
        ignoreFocusOut: true,
        validateInput: v => (v && v.trim().length > 0) ? undefined : 'Key cannot be empty',
      });
      if (!key) return;
      const valid = await validateApiKey(key.trim());
      if (valid) {
        await secrets.setApiKey(key.trim());
        vscode.window.showInformationMessage('API key saved.');
      } else {
        const retry = await vscode.window.showErrorMessage('Invalid key — please try again.', 'Try Again');
        if (retry) await vscode.commands.executeCommand('dispatch.setApiKey');
      }
    }),

    vscode.commands.registerCommand('dispatch.clearApiKey', async () => {
      await secrets.clearApiKey();
      vscode.window.showInformationMessage('API key cleared.');
    }),

    vscode.commands.registerCommand('dispatch.validateApiKey', async () => {
      const key = await secrets.getApiKey();
      if (!key) {
        vscode.window.showWarningMessage('No API key set.');
        return;
      }
      const valid = await validateApiKey(key);
      vscode.window.showInformationMessage(valid ? 'API key is valid.' : 'API key is invalid.');
    }),

    vscode.commands.registerCommand('dispatch.openChat', () => {
      vscode.commands.executeCommand('dispatch.chatView.focus');
    }),

    vscode.commands.registerCommand('dispatch.viewUsage', () => {
      vscode.commands.executeCommand('dispatch.usageView.focus');
    }),

    vscode.commands.registerCommand('dispatch.openPlan', async () => {
      if (!workspaceRoot) {
        vscode.window.showWarningMessage('No workspace open.');
        return;
      }
      const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
      let pm: PlanManager | undefined;
      if (activeFile) {
        pm = await PlanManager.findForFile(workspaceRoot, activeFile);
      }
      if (!pm) {
        const all = await PlanManager.findAll(workspaceRoot);
        if (all.length === 0) {
          vscode.window.showWarningMessage('No PLAN.md in this workspace. Start a coding task to create one.');
          return;
        }
        if (all.length === 1) {
          pm = all[0];
        } else {
          const items = all.map(p => ({ label: p.projectName, description: p.getProjectDir(), pm: p }));
          const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Select a project' });
          if (!pick) return;
          pm = pick.pm;
        }
      }
      await vscode.window.showTextDocument(pm.getPlanUri());
    }),

    vscode.commands.registerCommand('dispatch.resetUsage', async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Reset today's usage data?", { modal: true }, 'Reset',
      );
      if (confirm === 'Reset') {
        usage.resetToday();
        usageProvider.refresh();
        vscode.window.showInformationMessage("Today's usage reset.");
      }
    }),

    vscode.commands.registerCommand('dispatch.checkUpdates', async () => {
      const ext = vscode.extensions.getExtension('tomaustin.dispatch');
      const version: string = ext?.packageJSON?.version ?? '0.0.0';
      await checkForUpdates(version);
    }),
  );

  // Prompt for API key on first activation if missing
  secrets.getApiKey().then(key => {
    if (!key) {
      vscode.window.showInformationMessage(
        'Dispatch: Add your OpenAI API key to get started.', 'Set Key',
      ).then(choice => {
        if (choice === 'Set Key') vscode.commands.executeCommand('dispatch.setApiKey');
      });
    }
  });

  // Silent update check — once per session
  if (!updateChecked) {
    updateChecked = true;
    const ext = vscode.extensions.getExtension('tomaustin.dispatch');
    const version: string = ext?.packageJSON?.version ?? '0.0.0';
    checkForUpdates(version);
  }
}

export function deactivate(): void {
  // nothing
}
