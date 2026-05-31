import { getModelGroup, isDeprecated, GROUP_1M_MODELS, GROUP_10M_MODELS, DEPRECATED_MODELS } from '../../modelRegistry';

describe('modelRegistry', () => {
  it('gpt-5.5-2026-04-23 is in 1M group', () => {
    expect(getModelGroup('gpt-5.5-2026-04-23')).toBe('1M');
  });
  it('gpt-5.1-codex-mini is in 10M group', () => {
    expect(getModelGroup('gpt-5.1-codex-mini')).toBe('10M');
  });
  it('unknown model returns unknown', () => {
    expect(getModelGroup('gpt-fake')).toBe('unknown');
  });
  it('gpt-4.5-preview is deprecated', () => {
    expect(isDeprecated('gpt-4.5-preview-2025-02-27')).toBe(true);
  });
  it('gpt-5.1-codex is not deprecated', () => {
    expect(isDeprecated('gpt-5.1-codex')).toBe(false);
  });
  it('GROUP_1M_MODELS does not contain deprecated model', () => {
    expect(GROUP_1M_MODELS).not.toContain('gpt-4.5-preview-2025-02-27');
  });
  it('GROUP_10M_MODELS has correct count', () => {
    expect(GROUP_10M_MODELS.length).toBeGreaterThanOrEqual(10);
  });
  it('DEPRECATED_MODELS contains gpt-4.5-preview', () => {
    expect(DEPRECATED_MODELS).toContain('gpt-4.5-preview-2025-02-27');
  });
});
