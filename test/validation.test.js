import { describe, it, expect } from 'vitest';
import { setup } from './harness.js';

describe('validation', () => {
  it('accepts a valid application', () => {
    const { code, grid } = setup();
    const result = code.addApplication({
      company: 'Acme Corp',
      title: 'Senior Engineer',
      dateApplied: '2026-08-20',
      receivedOffer: false
    });
    expect(result).toHaveLength(1);
    expect(result[0].company).toBe('Acme Corp');
    // header + one data row
    expect(grid).toHaveLength(2);
  });

  it('requires a company', () => {
    const { code } = setup();
    expect(() =>
      code.addApplication({ company: '', title: 'Dev', dateApplied: '2026-08-20' })
    ).toThrow(/company is required/i);
  });

  it('requires a title', () => {
    const { code } = setup();
    expect(() =>
      code.addApplication({ company: 'Acme', title: '   ', dateApplied: '2026-08-20' })
    ).toThrow(/title is required/i);
  });

  it('rejects a malformed date', () => {
    const { code } = setup();
    expect(() =>
      code.addApplication({ company: 'Acme', title: 'Dev', dateApplied: '08/20/2026' })
    ).toThrow(/YYYY-MM-DD/);
  });

  it('rejects an impossible calendar date', () => {
    const { code } = setup();
    expect(() =>
      code.addApplication({ company: 'Acme', title: 'Dev', dateApplied: '2026-02-30' })
    ).toThrow(/valid date/i);
  });

  it('trims surrounding whitespace on text fields', () => {
    const { code } = setup();
    const result = code.addApplication({
      company: '  Globex  ',
      title: '  Full Stack Developer  ',
      dateApplied: '2026-08-25'
    });
    expect(result[0].company).toBe('Globex');
    expect(result[0].title).toBe('Full Stack Developer');
  });

  it('coerces the offer flag to a real boolean', () => {
    const { code } = setup();
    const yes = code.addApplication({
      company: 'A',
      title: 'B',
      dateApplied: '2026-01-01',
      receivedOffer: 'true'
    });
    expect(yes[0].receivedOffer).toBe(true);

    const { code: code2 } = setup();
    const missing = code2.addApplication({
      company: 'A',
      title: 'B',
      dateApplied: '2026-01-01'
    });
    expect(missing[0].receivedOffer).toBe(false);
  });
});
