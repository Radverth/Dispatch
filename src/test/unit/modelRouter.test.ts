import { detectTaskType, routeTask, getTemperature } from '../../modelRouter';
import { ROUTING_MODELS } from '../../modelRegistry';

describe('detectTaskType', () => {
  it('detects planning from "plan"', () => {
    expect(detectTaskType('Can you plan this feature?')).toBe('planning');
  });
  it('detects planning from "architect"', () => {
    expect(detectTaskType('How should I architect this?')).toBe('planning');
  });
  it('detects refactor', () => {
    expect(detectTaskType('Please refactor this module')).toBe('refactor');
  });
  it('detects prose from email', () => {
    expect(detectTaskType('Write an email to the team')).toBe('prose');
  });
  it('detects mechanical for short code prompt', () => {
    expect(detectTaskType('Fix typo', '.ts')).toBe('mechanical');
  });
  it('detects code for longer .ts prompt', () => {
    expect(detectTaskType('Add null checking to the parseUser function so it handles undefined inputs', '.ts')).toBe('code');
  });
  it('defaults to code for unknown', () => {
    expect(detectTaskType('do something')).toBe('code');
  });
  it('detects planning from "scaffold"', () => {
    expect(detectTaskType('scaffold a new feature')).toBe('planning');
  });
  it('detects refactor from "extract"', () => {
    expect(detectTaskType('extract this logic into a helper')).toBe('refactor');
  });
  it('detects prose from "summarise"', () => {
    expect(detectTaskType('summarise this document')).toBe('prose');
  });
  it('detects prose from "draft"', () => {
    expect(detectTaskType('draft a message')).toBe('prose');
  });
  it('detects planning from "new feature"', () => {
    expect(detectTaskType('I need a new feature')).toBe('planning');
  });
});

describe('routeTask', () => {
  it('routes planning to 1M model', () => {
    const r = routeTask('plan the auth module');
    expect(r.model).toBe(ROUTING_MODELS.planning);
    expect(r.group).toBe('1M');
  });
  it('routes code to 10M model', () => {
    const r = routeTask('fix parseUser for null inputs', '.ts');
    expect(r.group).toBe('10M');
  });
  it('respects manual override', () => {
    const r = routeTask('anything', '.ts', 'o3-2025-04-16');
    expect(r.model).toBe('o3-2025-04-16');
  });
  it('routes prose to prose model', () => {
    const r = routeTask('write a report');
    expect(r.model).toBe(ROUTING_MODELS.prose);
  });
  it('routes refactor to complexCode model', () => {
    const r = routeTask('refactor the user module');
    expect(r.model).toBe(ROUTING_MODELS.complexCode);
  });
});

describe('getTemperature', () => {
  it('returns 1.0 for o-series', () => {
    expect(getTemperature('o3-2025-04-16', 'code')).toBe(1.0);
    expect(getTemperature('o1-2024-12-17', 'code')).toBe(1.0);
  });
  it('returns 0.7 for prose', () => {
    expect(getTemperature('gpt-5.4-mini-2026-03-17', 'prose')).toBe(0.7);
  });
  it('returns 0.2 for code', () => {
    expect(getTemperature('gpt-5.1-codex-mini', 'code')).toBe(0.2);
  });
});
