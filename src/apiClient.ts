import { MAX_TOKENS } from './modelRegistry';
import { getTemperature, TaskType } from './modelRouter';

const URL_CHAT      = 'https://api.openai.com/v1/chat/completions';
const URL_RESPONSES = 'https://api.openai.com/v1/responses';

// Models that require the /v1/responses endpoint
const RESPONSES_API_MODELS = new Set([
  'gpt-4.1-2025-04-14',
  'gpt-4.1-mini-2025-04-14',
  'gpt-4.1-nano-2025-04-14',
  'o3-2025-04-16',
  'o4-mini-2025-04-16',
  'codex-mini-latest',
  'gpt-5.1-codex-mini',
  'gpt-5.4-mini-2026-03-17',
  'gpt-5.4-nano-2026-03-17',
  'gpt-5-mini-2025-08-07',
  'gpt-5-nano-2025-08-07',
  'gpt-5.5-2026-04-23',
  'gpt-5.4-2026-03-05',
  'gpt-5.2-2025-12-11',
  'gpt-5.1-2025-11-13',
  'gpt-5.1-codex',
  'gpt-5-codex',
  'gpt-5-2025-08-07',
  'gpt-5-chat-latest',
]);

// Models on /v1/responses that DO accept temperature (gpt-4.1 family only)
// All other responses-API models (o-series, gpt-5.x, codex) reject the parameter
const RESPONSES_TEMPERATURE_MODELS = new Set([
  'gpt-4.1-2025-04-14',
  'gpt-4.1-mini-2025-04-14',
  'gpt-4.1-nano-2025-04-14',
]);

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface UsageResult {
  promptTokens: number;
  completionTokens: number;
}

export interface StreamCallbacks {
  onChunk: (delta: string) => void;
  onDone: (usage: UsageResult) => void;
  onError: (err: Error) => void;
}

export async function streamCompletion(
  apiKey: string,
  model: string,
  messages: Message[],
  taskType: TaskType,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  if (RESPONSES_API_MODELS.has(model)) {
    await streamResponses(apiKey, model, messages, taskType, callbacks, signal);
  } else {
    await streamChatCompletions(apiKey, model, messages, taskType, callbacks, signal);
  }
}

// ── /v1/chat/completions ──────────────────────────────────────────────────────

async function streamChatCompletions(
  apiKey: string,
  model: string,
  messages: Message[],
  taskType: TaskType,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const body = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: MAX_TOKENS[model] ?? 2048,
    temperature: getTemperature(model, taskType),
  };

  let response: Response;
  try {
    response = await fetch(URL_CHAT, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    return;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    callbacks.onError(new Error(`OpenAI API error ${response.status}: ${text}`));
    return;
  }

  const usage: UsageResult = { promptTokens: 0, completionTokens: 0 };
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  try {
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) callbacks.onChunk(delta);
          if (parsed.usage) {
            usage.promptTokens    = parsed.usage.prompt_tokens ?? 0;
            usage.completionTokens = parsed.usage.completion_tokens ?? 0;
          }
        } catch { /* malformed chunk */ }
      }
    }
  } finally {
    reader.cancel();
  }

  callbacks.onDone(usage);
}

// ── /v1/responses ─────────────────────────────────────────────────────────────

async function streamResponses(
  apiKey: string,
  model: string,
  messages: Message[],
  taskType: TaskType,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  // Split system prompt into `instructions`, rest into `input`
  const systemMsg = messages.find(m => m.role === 'system');
  const inputMsgs = messages.filter(m => m.role !== 'system');

  const body: Record<string, unknown> = {
    model,
    input: inputMsgs.map(m => ({ role: m.role, content: m.content })),
    stream: true,
    max_output_tokens: MAX_TOKENS[model] ?? 2048,
  };

  if (systemMsg) body['instructions'] = systemMsg.content;

  if (RESPONSES_TEMPERATURE_MODELS.has(model)) {
    body['temperature'] = getTemperature(model, taskType);
  }

  let response: Response;
  try {
    response = await fetch(URL_RESPONSES, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    return;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    callbacks.onError(new Error(`OpenAI API error ${response.status}: ${text}`));
    return;
  }

  const usage: UsageResult = { promptTokens: 0, completionTokens: 0 };
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  try {
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          // Text delta
          if (parsed.type === 'response.output_text.delta' && parsed.delta) {
            callbacks.onChunk(parsed.delta);
          }
          // Usage on completion
          if (parsed.type === 'response.completed' && parsed.response?.usage) {
            usage.promptTokens     = parsed.response.usage.input_tokens ?? 0;
            usage.completionTokens = parsed.response.usage.output_tokens ?? 0;
          }
        } catch { /* malformed chunk */ }
      }
    }
  } finally {
    reader.cancel();
  }

  callbacks.onDone(usage);
}

export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}
