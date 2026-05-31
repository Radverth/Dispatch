import * as vscode from 'vscode';
import * as path from 'path';

const PLAN_FILENAME = 'PLAN.md';

export type ChecklistState = '[ ]' | '[>]' | '[x]' | '[~]';

export interface PlanStatus {
  done: number;
  inProgress: number;
  pending: number;
  failed: number;
  projectName?: string;
  projectDir?: string;
}

export class PlanManager {
  private planUri: vscode.Uri;

  // projectDir is the directory that contains PLAN.md (may be workspace root or a subdirectory)
  constructor(private readonly projectDir: string) {
    this.planUri = vscode.Uri.file(path.join(projectDir, PLAN_FILENAME));
  }

  // Walk up from activeFilePath to find the nearest PLAN.md within workspaceRoot.
  // Returns a PlanManager scoped to that directory, or undefined if none found.
  static async findForFile(workspaceRoot: string, activeFilePath: string): Promise<PlanManager | undefined> {
    let dir = path.dirname(activeFilePath);
    while (dir.startsWith(workspaceRoot)) {
      const candidate = vscode.Uri.file(path.join(dir, PLAN_FILENAME));
      try {
        await vscode.workspace.fs.stat(candidate);
        return new PlanManager(dir);
      } catch {
        // not found here — go up
      }
      const parent = path.dirname(dir);
      if (parent === dir) break; // filesystem root
      dir = parent;
    }
    return undefined;
  }

  // Find all PLAN.md files in the workspace (one level deep into subdirectories)
  static async findAll(workspaceRoot: string): Promise<PlanManager[]> {
    const managers: PlanManager[] = [];

    // Check workspace root
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(path.join(workspaceRoot, PLAN_FILENAME)));
      managers.push(new PlanManager(workspaceRoot));
    } catch { /* none at root */ }

    // Check one level of subdirectories
    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(workspaceRoot));
      for (const [name, type] of entries) {
        if (type !== vscode.FileType.Directory) continue;
        const subdir = path.join(workspaceRoot, name);
        try {
          await vscode.workspace.fs.stat(vscode.Uri.file(path.join(subdir, PLAN_FILENAME)));
          managers.push(new PlanManager(subdir));
        } catch { /* no PLAN.md in this subdir */ }
      }
    } catch { /* can't read directory */ }

    return managers;
  }

  // Create a new project: make the directory, write PLAN.md inside it.
  // Returns the PlanManager for the new project.
  static async createProject(workspaceRoot: string, projectName: string, content: string): Promise<PlanManager> {
    const safeName = sanitiseDirName(projectName);
    const projectDir = path.join(workspaceRoot, safeName);

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(projectDir));

    const pm = new PlanManager(projectDir);
    await pm.create(content);
    return pm;
  }

  get projectName(): string {
    return path.basename(this.projectDir);
  }

  async exists(): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(this.planUri);
      return true;
    } catch {
      return false;
    }
  }

  async read(): Promise<string | undefined> {
    try {
      const bytes = await vscode.workspace.fs.readFile(this.planUri);
      return Buffer.from(bytes).toString('utf8');
    } catch {
      return undefined;
    }
  }

  async create(content: string): Promise<void> {
    await vscode.workspace.fs.writeFile(this.planUri, Buffer.from(content, 'utf8'));
  }

  async updateChecklistItem(
    searchText: string,
    fromState: ChecklistState,
    toState: ChecklistState,
  ): Promise<boolean> {
    const content = await this.read();
    if (!content) return false;

    const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(${escapeState(fromState)})( ${escaped})`);
    if (!pattern.test(content)) return false;

    const updated = content.replace(pattern, `${toState}$2`);
    await vscode.workspace.fs.writeFile(this.planUri, Buffer.from(updated, 'utf8'));
    return true;
  }

  async appendToSection(section: '## Surprises & Discoveries' | '## Change Log', text: string): Promise<void> {
    const content = await this.read();
    if (!content) return;

    const idx = content.indexOf(section);
    if (idx === -1) return;

    const lineEnd = content.indexOf('\n', idx);
    const insertion = lineEnd === -1
      ? content + '\n' + text
      : content.slice(0, lineEnd + 1) + '\n' + text + '\n' + content.slice(lineEnd + 1);

    await vscode.workspace.fs.writeFile(this.planUri, Buffer.from(insertion, 'utf8'));
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
      done:        (content.match(/\[x\]/g) || []).length,
      inProgress:  (content.match(/\[>\]/g) || []).length,
      pending:     (content.match(/\[ \]/g) || []).length,
      failed:      (content.match(/\[~\]/g) || []).length,
      projectName: this.projectName,
      projectDir:  this.projectDir,
    };
  }

  getPlanUri(): vscode.Uri {
    return this.planUri;
  }

  getProjectDir(): string {
    return this.projectDir;
  }
}

function sanitiseDirName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s\-_]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 64) || 'Project';
}

function escapeState(state: ChecklistState): string {
  return state.replace(/[[\]]/g, '\\$&').replace('>', '\\>');
}
