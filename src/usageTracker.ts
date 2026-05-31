import * as vscode from 'vscode';
import { getModelGroup, BUDGETS } from './modelRegistry';

interface DayUsage {
  date: string; // YYYY-MM-DD
  byModel: Record<string, { prompt: number; completion: number }>;
}

const KEY_USAGE = 'dispatch.usage';
const MAX_DAYS = 30;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export class UsageTracker {
  constructor(private readonly state: vscode.Memento) {}

  recordUsage(model: string, promptTokens: number, completionTokens: number): void {
    const history = this.getHistory();
    const date = today();
    let day = history.find(d => d.date === date);
    if (!day) {
      day = { date, byModel: {} };
      history.push(day);
    }
    if (!day.byModel[model]) {
      day.byModel[model] = { prompt: 0, completion: 0 };
    }
    day.byModel[model].prompt += promptTokens;
    day.byModel[model].completion += completionTokens;

    // Prune beyond MAX_DAYS
    const pruned = history
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-MAX_DAYS);

    this.state.update(KEY_USAGE, pruned);
  }

  getTodayTotals(): { group1M: number; group10M: number; byModel: Record<string, number> } {
    const day = this.getHistory().find(d => d.date === today());
    const byModel: Record<string, number> = {};
    let group1M = 0;
    let group10M = 0;

    if (day) {
      for (const [model, usage] of Object.entries(day.byModel)) {
        const total = usage.prompt + usage.completion;
        byModel[model] = total;
        const group = getModelGroup(model);
        if (group === '1M') group1M += total;
        else if (group === '10M') group10M += total;
      }
    }

    return { group1M, group10M, byModel };
  }

  getLast7Days(): Array<{ date: string; group1M: number; group10M: number }> {
    const history = this.getHistory();
    const result: Array<{ date: string; group1M: number; group10M: number }> = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const day = history.find(h => h.date === dateStr);
      let group1M = 0;
      let group10M = 0;

      if (day) {
        for (const [model, usage] of Object.entries(day.byModel)) {
          const total = usage.prompt + usage.completion;
          const group = getModelGroup(model);
          if (group === '1M') group1M += total;
          else if (group === '10M') group10M += total;
        }
      }
      result.push({ date: dateStr, group1M, group10M });
    }
    return result;
  }

  resetToday(): void {
    const history = this.getHistory().filter(d => d.date !== today());
    this.state.update(KEY_USAGE, history);
  }

  getBudgetStatus(): { group1MPercent: number; group10MPercent: number } {
    const { group1M, group10M } = this.getTodayTotals();
    return {
      group1MPercent: group1M / BUDGETS.group1M.dailyTokens,
      group10MPercent: group10M / BUDGETS.group10M.dailyTokens,
    };
  }

  private getHistory(): DayUsage[] {
    return this.state.get<DayUsage[]>(KEY_USAGE, []);
  }
}
