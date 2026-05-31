import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

export interface ProposedChange {
  targetUri: vscode.Uri;
  newContent: string;
  summary: string;
}

export interface DiffResult {
  accepted: boolean;
}

export async function openDiff(change: ProposedChange): Promise<DiffResult> {
  const shadowPath = path.join(os.tmpdir(), `dispatch-${Date.now()}-${Math.random().toString(36).slice(2)}.shadow`);
  const shadowUri = vscode.Uri.file(shadowPath);

  // For new (non-existent) files, diff an empty shadow as the original so VS Code
  // doesn't complain about a missing file on the left side.
  let originalUri = change.targetUri;
  let emptyShadowUri: vscode.Uri | undefined;
  try {
    await vscode.workspace.fs.stat(change.targetUri);
  } catch {
    const emptyPath = path.join(os.tmpdir(), `dispatch-empty-${Date.now()}.shadow`);
    emptyShadowUri = vscode.Uri.file(emptyPath);
    await vscode.workspace.fs.writeFile(emptyShadowUri, Buffer.from('', 'utf8'));
    originalUri = emptyShadowUri;
  }

  try {
    await vscode.workspace.fs.writeFile(shadowUri, Buffer.from(change.newContent, 'utf8'));
    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri,
      shadowUri,
      `Dispatch: ${change.summary}`,
      { preview: true },
    );
    return { accepted: false };
  } finally {
    (openDiff as unknown as Record<string, unknown>)['_lastShadow'] = shadowUri;
    (openDiff as unknown as Record<string, unknown>)['_lastEmpty'] = emptyShadowUri;
  }
}

export function getLastShadowUri(): vscode.Uri | undefined {
  return (openDiff as unknown as Record<string, vscode.Uri>)['_lastShadow'];
}

export function getLastEmptyShadowUri(): vscode.Uri | undefined {
  return (openDiff as unknown as Record<string, vscode.Uri>)['_lastEmpty'];
}

export async function applyChange(
  targetUri: vscode.Uri,
  newContent: string,
): Promise<boolean> {
  const edit = new vscode.WorkspaceEdit();
  let fileExists = true;
  try {
    await vscode.workspace.fs.stat(targetUri);
  } catch {
    fileExists = false;
  }

  if (fileExists) {
    const document = await vscode.workspace.openTextDocument(targetUri);
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length),
    );
    edit.replace(targetUri, fullRange, newContent);
  } else {
    // Ensure parent directories exist
    const parentUri = vscode.Uri.joinPath(targetUri, '..');
    await vscode.workspace.fs.createDirectory(parentUri);
    edit.createFile(targetUri, { ignoreIfExists: false });
    edit.insert(targetUri, new vscode.Position(0, 0), newContent);
  }

  const success = await vscode.workspace.applyEdit(edit);
  if (!success) throw new Error('WorkspaceEdit failed to apply');

  const doc = await vscode.workspace.openTextDocument(targetUri);
  await doc.save();
  return success;
}

export async function cleanupShadow(shadowUri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(shadowUri, { useTrash: false });
  } catch {
    // Shadow file already gone — not an error
  }
}
