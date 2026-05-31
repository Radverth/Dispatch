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

  try {
    await vscode.workspace.fs.writeFile(shadowUri, Buffer.from(change.newContent, 'utf8'));

    await vscode.commands.executeCommand(
      'vscode.diff',
      change.targetUri,
      shadowUri,
      `Dispatch: ${change.summary}`,
      { preview: true },
    );

    // Watch for the user saving the shadow file as a signal of acceptance.
    // Acceptance is actually signalled via acceptDiff() called from the chat panel.
    // Here we just return immediately — the panel handles the accept/reject flow.
    return { accepted: false };
  } finally {
    // Shadow file cleanup deferred — caller must call cleanupShadow(shadowUri)
    // after accept/reject decision is made.
    // Store uri on the returned object by augmenting it:
    (openDiff as unknown as Record<string, vscode.Uri>)['_lastShadow'] = shadowUri;
  }
}

export function getLastShadowUri(): vscode.Uri | undefined {
  return (openDiff as unknown as Record<string, vscode.Uri>)['_lastShadow'];
}

export async function applyChange(
  targetUri: vscode.Uri,
  newContent: string,
): Promise<boolean> {
  const document = await vscode.workspace.openTextDocument(targetUri);
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length),
  );
  const edit = new vscode.WorkspaceEdit();
  edit.replace(targetUri, fullRange, newContent);
  const success = await vscode.workspace.applyEdit(edit);
  if (!success) {
    throw new Error('WorkspaceEdit failed to apply');
  }
  return success;
}

export async function cleanupShadow(shadowUri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(shadowUri, { useTrash: false });
  } catch {
    // Shadow file already gone — not an error
  }
}
