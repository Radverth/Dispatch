import * as vscode from 'vscode';
import { UsageTracker } from '../usageTracker';
import { BUDGETS } from '../modelRegistry';

export class UsagePanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'dispatch.usageView';

  private _view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly usage: UsageTracker,
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

    webviewView.webview.html = this._buildHtml(webviewView.webview);
    webviewView.onDidDispose(() => { this._view = undefined; });
  }

  refresh(): void {
    if (!this._view) return;
    this._view.webview.html = this._buildHtml(this._view.webview);
  }

  private _buildHtml(webview: vscode.Webview): string {
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'dispatch.css'),
    );
    const nonce = getNonce();
    const today = this.usage.getTodayTotals();
    const week = this.usage.getLast7Days();
    const budget1M = BUDGETS.group1M.dailyTokens;
    const budget10M = BUDGETS.group10M.dailyTokens;
    const pct1M = Math.min(100, Math.round((today.group1M / budget1M) * 100));
    const pct10M = Math.min(100, Math.round((today.group10M / budget10M) * 100));
    const warn1M = pct1M >= 80;
    const warn10M = pct10M >= 80;

    const modelRows = Object.entries(today.byModel)
      .sort((a, b) => b[1] - a[1])
      .map(([model, tokens]) => `<tr><td>${escHtml(model)}</td><td>${tokens.toLocaleString()}</td></tr>`)
      .join('');

    const maxWeek = Math.max(...week.map(d => Math.max(d.group1M, d.group10M)), 1);
    const barChart = week.map(d => {
      const h1 = Math.round((d.group1M / maxWeek) * 60);
      const h10 = Math.round((d.group10M / maxWeek) * 60);
      const label = d.date.slice(5); // MM-DD
      return `<div class="bar-col">
        <div class="bar-stack">
          <div class="bar-seg bar-10m" style="height:${h10}px" title="10M: ${d.group10M.toLocaleString()}"></div>
          <div class="bar-seg bar-1m" style="height:${h1}px" title="1M: ${d.group1M.toLocaleString()}"></div>
        </div>
        <div class="bar-label">${label}</div>
      </div>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${cssUri}">
  <title>Dispatch Usage</title>
</head>
<body class="usage-body">
  <h2>Today · 1M Group</h2>
  <div class="progress-row">
    <div class="progress-bar"><div class="progress-fill ${warn1M ? 'warn' : ''}" style="width:${pct1M}%"></div></div>
    <div class="progress-meta">
      <span class="${warn1M ? 'warn-text' : ''}">${today.group1M.toLocaleString()} / ${budget1M.toLocaleString()}</span>
      <span class="${warn1M ? 'warn-text' : ''}">${pct1M}%${warn1M ? ' ⚠' : ''}</span>
    </div>
  </div>

  <h2>Today · 10M Group</h2>
  <div class="progress-row">
    <div class="progress-bar"><div class="progress-fill ${warn10M ? 'warn' : ''}" style="width:${pct10M}%"></div></div>
    <div class="progress-meta">
      <span class="${warn10M ? 'warn-text' : ''}">${today.group10M.toLocaleString()} / ${budget10M.toLocaleString()}</span>
      <span class="${warn10M ? 'warn-text' : ''}">${pct10M}%${warn10M ? ' ⚠' : ''}</span>
    </div>
  </div>

  <h2>Last 7 Days</h2>
  <div class="bar-chart">${barChart}</div>
  <div class="chart-legend">
    <span class="legend-1m">■ 1M</span>
    <span class="legend-10m">■ 10M</span>
  </div>

  <h2>Today by Model</h2>
  <table class="model-table">
    <thead><tr><th>Model</th><th>Tokens</th></tr></thead>
    <tbody>${modelRows || '<tr><td colspan="2">No usage today.</td></tr>'}</tbody>
  </table>

  <p class="disclaimer">⚠ Token counts are estimates. Verify at platform.openai.com</p>
  <p class="footer">Dispatch · Created by Tom Austin</p>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
