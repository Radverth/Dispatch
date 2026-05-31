import * as vscode from 'vscode';
import { applyChange, cleanupShadow } from '../../diffEditor';

const mockFs = vscode.workspace.fs as jest.Mocked<typeof vscode.workspace.fs>;
const mockApplyEdit = vscode.workspace.applyEdit as jest.Mock;
const mockOpenDoc = vscode.workspace.openTextDocument as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('applyChange', () => {
  it('calls applyEdit and returns true for existing file', async () => {
    const fakeDoc = {
      positionAt: (_: number) => ({ line: 0, character: 0 }),
      getText: () => 'old content',
      save: () => Promise.resolve(true),
    };
    mockFs.stat.mockResolvedValue({} as never);
    mockOpenDoc.mockResolvedValue(fakeDoc);
    mockApplyEdit.mockResolvedValue(true);

    const uri = vscode.Uri.file('/workspace/file.ts');
    const result = await applyChange(uri, 'new content');
    expect(result).toBe(true);
    expect(mockApplyEdit).toHaveBeenCalled();
  });

  it('creates new file when target does not exist', async () => {
    const fakeDoc = {
      positionAt: () => ({ line: 0, character: 0 }),
      getText: () => '',
      save: () => Promise.resolve(true),
    };
    mockFs.stat.mockRejectedValue(new Error('not found'));
    mockFs.createDirectory.mockResolvedValue(undefined);
    mockOpenDoc.mockResolvedValue(fakeDoc);
    mockApplyEdit.mockResolvedValue(true);

    const uri = vscode.Uri.file('/workspace/scripts/new.ps1');
    const result = await applyChange(uri, 'content');
    expect(result).toBe(true);
  });

  it('throws when applyEdit returns false', async () => {
    const fakeDoc = {
      positionAt: () => ({ line: 0, character: 0 }),
      getText: () => '',
      save: () => Promise.resolve(false),
    };
    mockFs.stat.mockResolvedValue({} as never);
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
