import * as vscode from 'vscode';
import { PlanManager } from '../../planManager';

const mockFs = vscode.workspace.fs as jest.Mocked<typeof vscode.workspace.fs>;

function utf8(s: string) { return Buffer.from(s, 'utf8'); }

beforeEach(() => jest.clearAllMocks());

describe('PlanManager', () => {
  it('exists() returns false when stat throws', async () => {
    mockFs.stat.mockRejectedValue(new Error('not found'));
    const pm = new PlanManager('/workspace');
    expect(await pm.exists()).toBe(false);
  });

  it('exists() returns true when stat resolves', async () => {
    mockFs.stat.mockResolvedValue({} as never);
    const pm = new PlanManager('/workspace');
    expect(await pm.exists()).toBe(true);
  });

  it('read() returns content', async () => {
    mockFs.readFile.mockResolvedValue(utf8('# PLAN.md') as never);
    const pm = new PlanManager('/workspace');
    expect(await pm.read()).toBe('# PLAN.md');
  });

  it('create() writes file', async () => {
    mockFs.writeFile.mockResolvedValue(undefined);
    const pm = new PlanManager('/workspace');
    await pm.create('content');
    expect(mockFs.writeFile).toHaveBeenCalled();
  });

  it('updateChecklistItem transitions [ ] to [>]', async () => {
    const content = '- [ ] Implement login\n';
    mockFs.readFile.mockResolvedValue(utf8(content) as never);
    mockFs.writeFile.mockResolvedValue(undefined);
    const pm = new PlanManager('/workspace');
    const result = await pm.updateChecklistItem('Implement login', '[ ]', '[>]');
    expect(result).toBe(true);
    const written = Buffer.from(mockFs.writeFile.mock.calls[0][1]).toString('utf8');
    expect(written).toContain('[>] Implement login');
  });

  it('updateChecklistItem transitions [>] to [x]', async () => {
    const content = '- [>] Implement login\n';
    mockFs.readFile.mockResolvedValue(utf8(content) as never);
    mockFs.writeFile.mockResolvedValue(undefined);
    const pm = new PlanManager('/workspace');
    const result = await pm.updateChecklistItem('Implement login', '[>]', '[x]');
    expect(result).toBe(true);
    const written = Buffer.from(mockFs.writeFile.mock.calls[0][1]).toString('utf8');
    expect(written).toContain('[x] Implement login');
  });

  it('updateChecklistItem transitions [>] to [~]', async () => {
    const content = '- [>] Broken task\n';
    mockFs.readFile.mockResolvedValue(utf8(content) as never);
    mockFs.writeFile.mockResolvedValue(undefined);
    const pm = new PlanManager('/workspace');
    await pm.updateChecklistItem('Broken task', '[>]', '[~]');
    const written = Buffer.from(mockFs.writeFile.mock.calls[0][1]).toString('utf8');
    expect(written).toContain('[~] Broken task');
  });

  it('updateChecklistItem re-queues [~] to [>]', async () => {
    const content = '- [~] Failed task\n';
    mockFs.readFile.mockResolvedValue(utf8(content) as never);
    mockFs.writeFile.mockResolvedValue(undefined);
    const pm = new PlanManager('/workspace');
    await pm.updateChecklistItem('Failed task', '[~]', '[>]');
    const written = Buffer.from(mockFs.writeFile.mock.calls[0][1]).toString('utf8');
    expect(written).toContain('[>] Failed task');
  });

  it('updateChecklistItem returns false when item not found', async () => {
    mockFs.readFile.mockResolvedValue(utf8('- [ ] Other task\n') as never);
    const pm = new PlanManager('/workspace');
    const result = await pm.updateChecklistItem('Missing task', '[ ]', '[>]');
    expect(result).toBe(false);
  });

  it('getStatus counts all states', () => {
    const content = '- [x] done\n- [>] wip\n- [ ] todo\n- [ ] todo2\n- [~] fail\n';
    const pm = new PlanManager('/workspace');
    const s = pm.getStatus(content);
    expect(s.done).toBe(1);
    expect(s.inProgress).toBe(1);
    expect(s.pending).toBe(2);
    expect(s.failed).toBe(1);
  });
});
