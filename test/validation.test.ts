import { describe, it, expect } from 'vitest';
import { addApplication, getApplications, replaceApplications } from '../src/lib/store';
import { assertCsvByteSize, LIMITS } from '../src/lib/applications';
import { createMemoryStorage } from './harness';

describe('validation', () => {
  it('accepts a valid application', () => {
    const storage = createMemoryStorage();
    const result = addApplication(storage, {
      company: 'Acme Corp',
      title: 'Senior Engineer',
      dateApplied: '2026-08-20',
      receivedOffer: false
    });
    expect(result).toHaveLength(1);
    expect(result[0].company).toBe('Acme Corp');
    expect(result[0].id).toEqual(expect.any(String));
    expect(getApplications(storage)).toHaveLength(1);
  });

  it('requires a company', () => {
    const storage = createMemoryStorage();
    expect(() =>
      addApplication(storage, { company: '', title: 'Dev', dateApplied: '2026-08-20' })
    ).toThrow(/company is required/i);
  });

  it('requires a title', () => {
    const storage = createMemoryStorage();
    expect(() =>
      addApplication(storage, { company: 'Acme', title: '   ', dateApplied: '2026-08-20' })
    ).toThrow(/title is required/i);
  });

  it('rejects a malformed date', () => {
    const storage = createMemoryStorage();
    expect(() =>
      addApplication(storage, { company: 'Acme', title: 'Dev', dateApplied: '08/20/2026' })
    ).toThrow(/YYYY-MM-DD/);
  });

  it('rejects an impossible calendar date', () => {
    const storage = createMemoryStorage();
    expect(() =>
      addApplication(storage, { company: 'Acme', title: 'Dev', dateApplied: '2026-02-30' })
    ).toThrow(/valid date/i);
  });

  it('trims surrounding whitespace on text fields', () => {
    const storage = createMemoryStorage();
    const result = addApplication(storage, {
      company: '  Globex  ',
      title: '  Full Stack Developer  ',
      dateApplied: '2026-08-25'
    });
    expect(result[0].company).toBe('Globex');
    expect(result[0].title).toBe('Full Stack Developer');
  });

  it('coerces the offer flag to a real boolean', () => {
    const storage = createMemoryStorage();
    const yes = addApplication(storage, {
      company: 'A',
      title: 'B',
      dateApplied: '2026-01-01',
      receivedOffer: 'true'
    });
    expect(yes[0].receivedOffer).toBe(true);

    const storage2 = createMemoryStorage();
    const missing = addApplication(storage2, {
      company: 'A',
      title: 'B',
      dateApplied: '2026-01-01'
    });
    expect(missing[0].receivedOffer).toBe(false);
  });

  it('accepts an omitted posting URL', () => {
    const storage = createMemoryStorage();
    const result = addApplication(storage, {
      company: 'Acme',
      title: 'Dev',
      dateApplied: '2026-01-01'
    });
    expect(result[0].postingUrl).toBe('');
  });

  it('stores a valid posting URL', () => {
    const storage = createMemoryStorage();
    const result = addApplication(storage, {
      company: 'Acme',
      title: 'Dev',
      dateApplied: '2026-01-01',
      postingUrl: 'https://jobs.acme.test/dev'
    });
    expect(result[0].postingUrl).toBe('https://jobs.acme.test/dev');
  });

  it('prefixes https:// when a hostname is pasted without a scheme', () => {
    const storage = createMemoryStorage();
    const result = addApplication(storage, {
      company: 'Acme',
      title: 'Dev',
      dateApplied: '2026-01-01',
      postingUrl: 'jobs.acme.test/dev'
    });
    expect(result[0].postingUrl).toBe('https://jobs.acme.test/dev');
  });

  it('trims whitespace on the posting URL', () => {
    const storage = createMemoryStorage();
    const result = addApplication(storage, {
      company: 'Acme',
      title: 'Dev',
      dateApplied: '2026-01-01',
      postingUrl: '  https://jobs.acme.test/dev  '
    });
    expect(result[0].postingUrl).toBe('https://jobs.acme.test/dev');
  });

  it('rejects a non-http posting URL', () => {
    const storage = createMemoryStorage();
    expect(() =>
      addApplication(storage, {
        company: 'Acme',
        title: 'Dev',
        dateApplied: '2026-01-01',
        postingUrl: 'javascript:alert(1)'
      })
    ).toThrow(/posting url/i);
    expect(() =>
      addApplication(storage, {
        company: 'Acme',
        title: 'Dev',
        dateApplied: '2026-01-01',
        postingUrl: 'not a url'
      })
    ).toThrow(/posting url/i);
  });

  it('rejects oversized company, title, and posting URL', () => {
    const storage = createMemoryStorage();
    expect(() =>
      addApplication(storage, {
        company: 'A'.repeat(201),
        title: 'Dev',
        dateApplied: '2026-01-01'
      })
    ).toThrow(/at most 200 characters/i);
    expect(() =>
      addApplication(storage, {
        company: 'Acme',
        title: 'T'.repeat(201),
        dateApplied: '2026-01-01'
      })
    ).toThrow(/at most 200 characters/i);
    expect(() =>
      addApplication(storage, {
        company: 'Acme',
        title: 'Dev',
        dateApplied: '2026-01-01',
        postingUrl: 'https://jobs.example.com/' + 'a'.repeat(2048)
      })
    ).toThrow(/at most 2048 characters/i);
  });

  it('rejects replacing the list past the per-account cap', () => {
    const storage = createMemoryStorage();
    const apps = Array.from({ length: LIMITS.maxApplicationsPerUser + 1 }, (_, i) => ({
      id: 'id-' + i,
      company: 'Acme',
      title: 'Dev',
      dateApplied: '2026-01-01',
      receivedOffer: false,
      postingUrl: ''
    }));
    expect(() => replaceApplications(storage, apps)).toThrow(/max 500/);
    expect(getApplications(storage)).toHaveLength(0);
  });

  it('rejects an oversized CSV before it is parsed', () => {
    expect(() => assertCsvByteSize(LIMITS.maxCsvBytes + 1)).toThrow(/512 kb/i);
    expect(() => assertCsvByteSize(LIMITS.maxCsvBytes)).not.toThrow();
  });
});

