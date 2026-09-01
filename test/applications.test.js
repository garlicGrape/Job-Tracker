import { describe, it, expect } from 'vitest';
import { setup, HEADER_ROW } from './harness.js';

describe('header handling', () => {
  it('writes the header on first run when row 1 is empty', () => {
    const { code, grid } = setup([]);
    code.addApplication({ company: 'Acme', title: 'Dev', dateApplied: '2026-01-01' });
    expect(grid[0]).toEqual(HEADER_ROW);
  });

  it('does not duplicate the header when it already exists', () => {
    const { code, grid } = setup([HEADER_ROW.slice()]);
    code.addApplication({ company: 'Acme', title: 'Dev', dateApplied: '2026-01-01' });
    expect(grid[0]).toEqual(HEADER_ROW);
    expect(grid).toHaveLength(2); // header + one data row, header not re-inserted
  });

  it('repairs a missing/incorrect header before appending', () => {
    const { code, grid } = setup([['Wrong', 'Header', 'Here', 'Now']]);
    code.addApplication({ company: 'Acme', title: 'Dev', dateApplied: '2026-01-01' });
    expect(grid[0]).toEqual(HEADER_ROW);
  });
});

describe('reading applications (row mapping)', () => {
  it('returns an empty array for a sheet with only a header', () => {
    const { code } = setup([HEADER_ROW.slice()]);
    expect(code.getApplications()).toEqual([]);
  });

  it('returns an empty array for a brand-new empty sheet', () => {
    const { code } = setup([]);
    expect(code.getApplications()).toEqual([]);
  });

  it('maps each row to the correct 1-indexed rowNumber and fields', () => {
    const { code } = setup([
      HEADER_ROW.slice(),
      ['Acme', 'Frontend', '2026-08-20', true],
      ['Globex', 'Backend', '2026-08-25', false]
    ]);
    const apps = code.getApplications();
    expect(apps).toEqual([
      { rowNumber: 2, company: 'Acme', title: 'Frontend', dateApplied: '2026-08-20', receivedOffer: true },
      { rowNumber: 3, company: 'Globex', title: 'Backend', dateApplied: '2026-08-25', receivedOffer: false }
    ]);
  });

  it('skips fully blank rows', () => {
    const { code } = setup([
      HEADER_ROW.slice(),
      ['Acme', 'Dev', '2026-08-20', false],
      ['', '', '', '']
    ]);
    expect(code.getApplications()).toHaveLength(1);
  });

  it('stores dates as plain YYYY-MM-DD strings, never Date objects', () => {
    const { code, grid } = setup([]);
    code.addApplication({ company: 'Acme', title: 'Dev', dateApplied: '2026-12-31' });
    const stored = grid[1][2];
    expect(typeof stored).toBe('string');
    expect(stored).toBe('2026-12-31');
  });
});

describe('setOffer', () => {
  it('writes the boolean to the offer column of the given row', () => {
    const { code, grid } = setup([
      HEADER_ROW.slice(),
      ['Acme', 'Dev', '2026-08-20', false]
    ]);
    code.setOffer(2, true);
    expect(grid[1][3]).toBe(true);
    code.setOffer(2, false);
    expect(grid[1][3]).toBe(false);
  });

  it('does not touch other rows', () => {
    const { code, grid } = setup([
      HEADER_ROW.slice(),
      ['Acme', 'Dev', '2026-08-20', false],
      ['Globex', 'PM', '2026-08-25', false]
    ]);
    code.setOffer(3, true);
    expect(grid[1][3]).toBe(false);
    expect(grid[2][3]).toBe(true);
  });

  it('rejects the header row and other invalid row numbers', () => {
    const { code } = setup([HEADER_ROW.slice(), ['Acme', 'Dev', '2026-08-20', false]]);
    expect(() => code.setOffer(1, true)).toThrow(/invalid row/i);
    expect(() => code.setOffer(0, true)).toThrow(/invalid row/i);
    expect(() => code.setOffer(2.5, true)).toThrow(/invalid row/i);
  });

  it('rejects a row past the end of the sheet', () => {
    const { code } = setup([HEADER_ROW.slice(), ['Acme', 'Dev', '2026-08-20', false]]);
    expect(() => code.setOffer(99, true)).toThrow(/does not exist/i);
  });
});

describe('LockService', () => {
  it('acquires and releases the script lock exactly once per write', () => {
    const { code, lockState } = setup([]);
    code.addApplication({ company: 'Acme', title: 'Dev', dateApplied: '2026-01-01' });
    expect(lockState.waitCalls).toBe(1);
    expect(lockState.releaseCalls).toBe(1);
    expect(lockState.held).toBe(false);
  });

  it('releases the lock even when the write throws', () => {
    // hasSheet:false makes getSheet_() throw *after* the lock is taken.
    const { code, lockState } = setup([], { hasSheet: false });
    expect(() =>
      code.addApplication({ company: 'Acme', title: 'Dev', dateApplied: '2026-01-01' })
    ).toThrow(/not found/i);
    expect(lockState.waitCalls).toBe(1);
    expect(lockState.releaseCalls).toBe(1);
    expect(lockState.held).toBe(false);
  });

  it('acquires and releases the lock on setOffer', () => {
    const { code, lockState } = setup([HEADER_ROW.slice(), ['Acme', 'Dev', '2026-08-20', false]]);
    code.setOffer(2, true);
    expect(lockState.waitCalls).toBe(1);
    expect(lockState.releaseCalls).toBe(1);
  });
});
