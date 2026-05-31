import { MAX_TOKENS } from './modelRegistry';
import { getTemperature, TaskType } from './modelRouter';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

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
  const body = {
    model,
    messages,
    stream: true,
    max_tokens: MAX_TOKENS[model] ?? 2048,
    temperature: getTemperature(model, taskType),
  };

  let response: Response;
  try {
    response = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
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

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let usage: UsageResult = { promptTokens: 0, completionTokens: 0 };

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
            usage = {
              promptTokens: parsed.usage.prompt_tokens ?? 0,
              completionTokens: parsed.usage.completion_tokens ?? 0,
            };
          }
        } catch {
          // malformed SSE chunk — skip
        }
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
