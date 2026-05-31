import * as vscode from 'vscode';
import { applyChange, cleanupShadow } from '../../diffEditor';

const mockFs = vscode.workspace.fs as jest.Mocked<typeof vscode.workspace.fs>;
const mockApplyEdit = vscode.workspace.applyEdit as jest.Mock;
const mockOpenDoc = vscode.workspace.openTextDocument as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('applyChange', () => {
  it('calls applyEdit and returns true', async () => {
    const fakeDoc = {
      positionAt: (_: number) => ({ line: 0, character: 0 }),
      getText: () => 'old content',
    };
    mockOpenDoc.mockResolvedValue(fakeDoc);
    mockApplyEdit.mockResolvedValue(true);

    const uri = vscode.Uri.file('/workspace/file.ts');
    const result = await applyChange(uri, 'new content');
    expect(result).toBe(true);
    expect(mockApplyEdit).toHaveBeenCalled();
  });

  it('throws when applyEdit returns false', async () => {
    const fakeDoc = {
      positionAt: () => ({ line: 0, character: 0 }),
      getText: () => '',
    };
    mockOpenDoc.mockResolvedValue(fakeDoc);
    mockApplyEdit.mockResolvedValue(false);

    const uri = vscode.Uri.file('/workspace/file.ts');
    await expect(applyChange(uri, 'x')).rejects.toThrow('WorkspaceEdit failed');
  });
});

describe('cleanupShadow', () => {
  it('deletes the shadow file', async () => {
    mockFs.delete.mockResolvedValue(undefined);
    const uri = vscode.Uri.file('/tmp/shadow.ts');
    await cleanupShadow(uri);
    expect(mockFs.delete).toHaveBeenCalledWith(uri, { useTrash: false });
  });

  it('does not throw if shadow file is already gone', async () => {
    mockFs.delete.mockRejectedValue(new Error('not found'));
    const uri = vscode.Uri.file('/tmp/shadow.ts');
    await expect(cleanupShadow(uri)).resolves.toBeUndefined();
  });
});
