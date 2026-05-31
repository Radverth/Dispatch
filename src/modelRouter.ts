import { ROUTING_MODELS, getModelGroup } from './modelRegistry';

const PLANNING_SIGNALS = [
  'plan', 'design', 'architect', 'how should', 'what approach',
  'structure', 'organise', 'organize', 'scaffold', 'new feature',
  'add support for', 'how do i build', 'best way to', 'should i',
];

const REFACTOR_SIGNALS = [
  'refactor', 'redesign', 'move', 'extract', 'split',
  'consolidate', 'migrate', 'rewrite', 'restructure', 'reorganise',
];

const PROSE_SIGNALS = [
  'email', 'draft', 'write a', 'document', 'letter',
  'report', 'summary', 'summarise', 'summarize', 'compose', 'message',
];

const CODE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go',
  '.java', '.cs', '.cpp', '.c', '.php', '.rb', '.swift',
  '.kt', '.sh', '.bash', '.yml', '.yaml', '.json', '.toml',
];

export type TaskType = 'planning' | 'refactor' | 'code' | 'prose' | 'mechanical';

export interface RoutingDecision {
  model: string;
  taskType: TaskType;
  group: '1M' | '10M';
}

export function detectTaskType(prompt: string, activeFileExtension?: string): TaskType {
  const lower = prompt.toLowerCase();

  if (PLANNING_SIGNALS.some(s => lower.includes(s))) return 'planning';
  if (REFACTOR_SIGNALS.some(s => lower.includes(s))) return 'refactor';
  if (PROSE_SIGNALS.some(s => lower.includes(s))) return 'prose';

  if (activeFileExtension && CODE_EXTENSIONS.includes(activeFileExtension)) {
    // Short mechanical prompts on code files
    if (prompt.length < 60) return 'mechanical';
    return 'code';
  }

  return 'code';
}

export function routeTask(
  prompt: string,
  activeFileExtension?: string,
  manualOverride?: string,
): RoutingDecision {
  if (manualOverride) {
    // Caller is responsible for not passing deprecated or gpt-5-chat-latest here
    return {
      model: manualOverride,
      taskType: detectTaskType(prompt, activeFileExtension),
      group: determineGroup(manualOverride),
    };
  }

  const taskType = detectTaskType(prompt, activeFileExtension);

  switch (taskType) {
    case 'planning':
      return { model: ROUTING_MODELS.planning, taskType, group: '1M' };
    case 'refactor':
      return { model: ROUTING_MODELS.complexCode, taskType, group: '1M' };
    case 'prose':
      return { model: ROUTING_MODELS.prose, taskType, group: '10M' };
    case 'mechanical':
      return { model: ROUTING_MODELS.mechanical, taskType, group: '10M' };
    case 'code':
      return { model: ROUTING_MODELS.singleFile, taskType, group: '10M' };
  }
}

function determineGroup(model: string): '1M' | '10M' {
  return getModelGroup(model) === '10M' ? '10M' : '1M';
}

export function getTemperature(model: string, taskType: TaskType): number {
  if (model.startsWith('o3') || model.startsWith('o1') || model.startsWith('o4')) return 1.0;
  if (taskType === 'prose') return 0.7;
  return 0.2;
}
