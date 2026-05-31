const MAX_INPUT_LENGTH = 8000;

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(previous|all)\s+instructions/i,
  /^(you are now|act as)\b/im,
  /reveal\s+your\s+system\s+prompt/i,
  /disregard\s+your/i,
  /(.)\1{20,}/, // repetitive special characters
];

export interface SanitiseResult {
  ok: boolean;
  text: string;
  reason?: string;
}

export function sanitise(input: string): SanitiseResult {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return { ok: false, text: '', reason: 'Input is empty.' };
  }

  if (trimmed.length > MAX_INPUT_LENGTH) {
    return {
      ok: false,
      text: trimmed.slice(0, MAX_INPUT_LENGTH),
      reason: `Input exceeds ${MAX_INPUT_LENGTH} characters and has been truncated. Please shorten your message.`,
    };
  }

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        ok: false,
        text: '',
        reason: 'Your message contains content that cannot be processed. Please rephrase.',
      };
    }
  }

  return { ok: true, text: trimmed };
}
