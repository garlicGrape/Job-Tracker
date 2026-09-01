import { describe, it, expect } from 'vitest';
import { setup } from './harness.js';

// The stored value lives in the sheet grid; row 0 is the header, row 1 is the
// first application. Company is column 0, Title is column 1.
function storedCompany(grid) {
  return grid[1][0];
}
function storedTitle(grid) {
  return grid[1][1];
}

describe('formula-injection escaping', () => {
  const dangerous = ['=', '+', '-', '@'];

  for (const prefix of dangerous) {
    it(`prefixes a company beginning with "${prefix}" with an apostrophe`, () => {
      const { code, grid } = setup();
      code.addApplication({
        company: prefix + 'SUM(A1:A9)',
        title: 'Engineer',
        dateApplied: '2026-01-01'
      });
      expect(storedCompany(grid)).toBe("'" + prefix + 'SUM(A1:A9)');
    });
  }

  it('escapes the title field too', () => {
    const { code, grid } = setup();
    code.addApplication({
      company: 'Acme',
      title: '=HYPERLINK("http://evil","x")',
      dateApplied: '2026-01-01'
    });
    expect(storedTitle(grid)).toBe('\'=HYPERLINK("http://evil","x")');
  });

  it('leaves ordinary text untouched', () => {
    const { code, grid } = setup();
    code.addApplication({
      company: 'Acme Corp',
      title: 'Senior Engineer',
      dateApplied: '2026-01-01'
    });
    expect(storedCompany(grid)).toBe('Acme Corp');
    expect(storedTitle(grid)).toBe('Senior Engineer');
  });

  it('does not corrupt the value the client reads back', () => {
    const { code } = setup();
    const result = code.addApplication({
      company: '=1+1',
      title: 'Dev',
      dateApplied: '2026-01-01'
    });
    // Reading returns exactly what is stored (escaped), never an evaluated formula.
    expect(result[0].company).toBe("'=1+1");
  });
});
