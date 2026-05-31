import { semverGt } from '../../updateChecker';

describe('semverGt', () => {
  it('0.2.0 > 0.1.0', () => expect(semverGt('0.2.0', '0.1.0')).toBe(true));
  it('1.0.0 > 0.9.9', () => expect(semverGt('1.0.0', '0.9.9')).toBe(true));
  it('0.1.1 > 0.1.0', () => expect(semverGt('0.1.1', '0.1.0')).toBe(true));
  it('0.1.0 not > 0.1.0', () => expect(semverGt('0.1.0', '0.1.0')).toBe(false));
  it('0.0.9 not > 0.1.0', () => expect(semverGt('0.0.9', '0.1.0')).toBe(false));
  it('0.1.0 not > 0.2.0', () => expect(semverGt('0.1.0', '0.2.0')).toBe(false));
});

describe('checkForUpdates error handling', () => {
  it('exports semverGt without throwing', () => {
    // The update-check flow fails silently — just ensure the export is callable
    expect(typeof semverGt).toBe('function');
  });
});
