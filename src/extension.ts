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

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatPanel.viewType, chatProvider),
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
      const pm = new PlanManager(workspaceRoot);
      if (!await pm.exists()) {
        vscode.window.showWarningMessage('No PLAN.md in this workspace. Start a coding task to create one.');
        return;
      }
      const uri = pm.getPlanUri();
      if (uri) await vscode.window.showTextDocument(uri);
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
