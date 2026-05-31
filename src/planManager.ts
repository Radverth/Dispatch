import * as vscode from 'vscode';
import * as path from 'path';

const PLAN_FILENAME = 'PLAN.md';

export type ChecklistState = '[ ]' | '[>]' | '[x]' | '[~]';

export interface PlanStatus {
  done: number;
  inProgress: number;
  pending: number;
  failed: number;
}

export class PlanManager {
  private planUri: vscode.Uri | undefined;

  constructor(private readonly workspaceRoot: string) {
    this.planUri = vscode.Uri.file(path.join(workspaceRoot, PLAN_FILENAME));
  }

  async exists(): Promise<boolean> {
    if (!this.planUri) return false;
    try {
      await vscode.workspace.fs.stat(this.planUri);
      return true;
    } catch {
      return false;
    }
  }

  async read(): Promise<string | undefined> {
    if (!this.planUri) return undefined;
    try {
      const bytes = await vscode.workspace.fs.readFile(this.planUri);
      return Buffer.from(bytes).toString('utf8');
    } catch {
      return undefined;
    }
  }

  async ensureProjectDirectory(projectName: string): Promise<string | undefined> {
    // Derive a safe directory name from the project name
    const safeName = projectName
      .replace(/[^a-zA-Z0-9\s\-_]/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 64);

    if (!safeName) return undefined;

    const dirUri = vscode.Uri.file(path.join(this.workspaceRoot, safeName));
    try {
      await vscode.workspace.fs.stat(dirUri);
      // Directory already exists — nothing to do
    } catch {
      await vscode.workspace.fs.createDirectory(dirUri);
    }
    return safeName;
  }

  async create(content: string): Promise<void> {
    if (!this.planUri) return;
    await vscode.workspace.fs.writeFile(
      this.planUri,
      Buffer.from(content, 'utf8'),
    );
  }

  async updateChecklistItem(
    searchText: string,
    fromState: ChecklistState,
    toState: ChecklistState,
  ): Promise<boolean> {
    const content = await this.read();
    if (!content) return false;

    const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `(${escapeState(fromState)})( ${escaped})`,
    );
    if (!pattern.test(content)) return false;

    const updated = content.replace(pattern, `${toState}$2`);
    await vscode.workspace.fs.writeFile(
      this.planUri!,
      Buffer.from(updated, 'utf8'),
    );
    return true;
  }

  async appendToSection(section: '## Surprises & Discoveries' | '## Change Log', text: string): Promise<void> {
    const content = await this.read();
    if (!content || !this.planUri) return;

    const marker = section;
    const idx = content.indexOf(marker);
    if (idx === -1) return;

    // Find end of the section header line
    const lineEnd = content.indexOf('\n', idx);
    const insertion = lineEnd === -1
      ? content + '\n' + text
      : content.slice(0, lineEnd + 1) + '\n' + text + '\n' + content.slice(lineEnd + 1);

    await vscode.workspace.fs.writeFile(
      this.planUri,
      Buffer.from(insertion, 'utf8'),
    );
  }

  async appendChangeLog(model: string, summary: string): Promise<void> {
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    await this.appendToSection('## Change Log', `- [${timestamp}] ${model}: ${summary}`);
  }

  async appendSurprise(note: string): Promise<void> {
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    await this.appendToSection('## Surprises & Discoveries', `- [${timestamp}] ${note}`);
  }

  getStatus(content: string): PlanStatus {
    return {
      done:       (content.match(/\[x\]/g) || []).length,
      inProgress: (content.match(/\[>\]/g) || []).length,
      pending:    (content.match(/\[ \]/g) || []).length,
      failed:     (content.match(/\[~\]/g) || []).length,
    };
  }

  getPlanUri(): vscode.Uri | undefined {
    return this.planUri;
  }
}

function escapeState(state: ChecklistState): string {
  return state.replace(/[[\]]/g, '\\$&').replace('>', '\\>');
}
