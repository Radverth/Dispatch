export const GROUP_1M_MODELS = [
  'gpt-5.5-2026-04-23',
  'gpt-5.4-2026-03-05',
  'gpt-5.2-2025-12-11',
  'gpt-5.1-2025-11-13',
  'gpt-5.1-codex',
  'gpt-5-codex',
  'gpt-5-2025-08-07',
  'gpt-4.1-2025-04-14',
  'gpt-4o-2024-11-20',
  'gpt-4o-2024-08-06',
  'gpt-4o-2024-05-13',
  'o3-2025-04-16',
  'o1-2024-12-17',
  'o1-preview-2024-09-12',
  'gpt-5-chat-latest', // manual override only — never use in routing
] as const;

export const GROUP_10M_MODELS = [
  'gpt-5.1-codex-mini',
  'gpt-5.4-mini-2026-03-17',
  'gpt-5.4-nano-2026-03-17',
  'gpt-5-mini-2025-08-07',
  'gpt-5-nano-2025-08-07',
  'gpt-4.1-mini-2025-04-14',
  'gpt-4.1-nano-2025-04-14',
  'gpt-4o-mini-2024-07-18',
  'o4-mini-2025-04-16',
  'o1-mini-2024-09-12',
  'codex-mini-latest',
] as const;

export const DEPRECATED_MODELS = [
  'gpt-4.5-preview-2025-02-27', // shut down 14/07/2025
] as const;

export const ROUTING_MODELS = {
  planning:    'gpt-5.5-2026-04-23',
  complexCode: 'gpt-5.1-codex',
  singleFile:  'gpt-5.1-codex-mini',
  prose:       'gpt-5.4-mini-2026-03-17',
  mechanical:  'gpt-5.4-nano-2026-03-17',
  deepReason:  'o3-2025-04-16',
  escalation:  'gpt-5.5-2026-04-23',
} as const;

export type Group1MModel = typeof GROUP_1M_MODELS[number];
export type Group10MModel = typeof GROUP_10M_MODELS[number];
export type AnyModel = Group1MModel | Group10MModel;

export function getModelGroup(model: string): '1M' | '10M' | 'unknown' {
  if ((GROUP_1M_MODELS as readonly string[]).includes(model)) return '1M';
  if ((GROUP_10M_MODELS as readonly string[]).includes(model)) return '10M';
  return 'unknown';
}

export function isDeprecated(model: string): boolean {
  return (DEPRECATED_MODELS as readonly string[]).includes(model);
}

export const MAX_TOKENS: Record<string, number> = {
  'gpt-5.5-2026-04-23':      4096,
  'gpt-5.4-2026-03-05':      4096,
  'gpt-5.2-2025-12-11':      4096,
  'gpt-5.1-2025-11-13':      4096,
  'gpt-5.1-codex':           4096,
  'gpt-5-codex':             4096,
  'gpt-5-2025-08-07':        4096,
  'gpt-4.1-2025-04-14':      4096,
  'gpt-4o-2024-11-20':       4096,
  'gpt-4o-2024-08-06':       4096,
  'gpt-4o-2024-05-13':       4096,
  'o3-2025-04-16':           4096,
  'o1-2024-12-17':           4096,
  'o1-preview-2024-09-12':   4096,
  'gpt-5-chat-latest':       4096,
  'gpt-5.1-codex-mini':      2048,
  'gpt-5.4-mini-2026-03-17': 2048,
  'gpt-5.4-nano-2026-03-17': 1024,
  'gpt-5-mini-2025-08-07':   2048,
  'gpt-5-nano-2025-08-07':   1024,
  'gpt-4.1-mini-2025-04-14': 2048,
  'gpt-4.1-nano-2025-04-14': 1024,
  'gpt-4o-mini-2024-07-18':  2048,
  'o4-mini-2025-04-16':      2048,
  'o1-mini-2024-09-12':      2048,
  'codex-mini-latest':       2048,
};

export const BUDGETS = {
  group1M:  { dailyTokens: 250_000,   warnThreshold: 0.8 },
  group10M: { dailyTokens: 2_500_000, warnThreshold: 0.8 },
} as const;
