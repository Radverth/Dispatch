import { UsageTracker } from '../../usageTracker';

function makeMemento(): { get: jest.Mock; update: jest.Mock } {
  const store: Record<string, unknown> = {};
  return {
    get: jest.fn((key: string, def: unknown) => store[key] ?? def),
    update: jest.fn((key: string, val: unknown) => { store[key] = val; }),
  };
}

describe('UsageTracker', () => {
  it('records usage and returns today totals', () => {
    const m = makeMemento();
    const tracker = new UsageTracker(m as never);
    tracker.recordUsage('gpt-5.1-codex-mini', 100, 50);
    const totals = tracker.getTodayTotals();
    expect(totals.group10M).toBe(150);
    expect(totals.byModel['gpt-5.1-codex-mini']).toBe(150);
  });

  it('accumulates across multiple calls', () => {
    const m = makeMemento();
    const tracker = new UsageTracker(m as never);
    tracker.recordUsage('gpt-5.1-codex', 200, 100);
    tracker.recordUsage('gpt-5.1-codex', 300, 200);
    const totals = tracker.getTodayTotals();
    expect(totals.group1M).toBe(800);
  });

  it('splits 1M and 10M groups correctly', () => {
    const m = makeMemento();
    const tracker = new UsageTracker(m as never);
    tracker.recordUsage('gpt-5.1-codex', 100, 0);    // 1M
    tracker.recordUsage('gpt-5.1-codex-mini', 50, 0); // 10M
    const totals = tracker.getTodayTotals();
    expect(totals.group1M).toBe(100);
    expect(totals.group10M).toBe(50);
  });

  it('resetToday clears today data', () => {
    const m = makeMemento();
    const tracker = new UsageTracker(m as never);
    tracker.recordUsage('gpt-5.1-codex-mini', 500, 200);
    tracker.resetToday();
    const totals = tracker.getTodayTotals();
    expect(totals.group10M).toBe(0);
  });

  it('getLast7Days returns 7 entries', () => {
    const m = makeMemento();
    const tracker = new UsageTracker(m as never);
    const days = tracker.getLast7Days();
    expect(days).toHaveLength(7);
  });

  it('getBudgetStatus returns fractions', () => {
    const m = makeMemento();
    const tracker = new UsageTracker(m as never);
    tracker.recordUsage('gpt-5.1-codex', 125000, 0); // 50% of 250K
    const status = tracker.getBudgetStatus();
    expect(status.group1MPercent).toBeCloseTo(0.5);
  });

  it('prunes to 30 days', () => {
    const m = makeMemento();
    const tracker = new UsageTracker(m as never);
    // Inject 35 days of fake history
    const history = Array.from({ length: 35 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i - 1);
      return { date: d.toISOString().slice(0, 10), byModel: {} };
    });
    m.get.mockReturnValue(history);
    tracker.recordUsage('gpt-5.1-codex-mini', 1, 0);
    const saved = m.update.mock.calls[0][1] as unknown[];
    expect(saved.length).toBeLessThanOrEqual(30);
  });
});
