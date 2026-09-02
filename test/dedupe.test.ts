import { describe, it, expect } from 'vitest';
import {
  duplicateKey,
  findDuplicate,
  inputDuplicateKey,
  planImport
} from '../src/lib/dedupe';
import { createApplication } from '../src/lib/applications';
import { applicationsToCsv, parseApplicationsCsv } from '../src/lib/csv';
import { createSupabaseAccountApi } from '../src/lib/supabase-account';
import { createFakeSupabase } from './fake-supabase';
import type { Application, ApplicationInput } from '../src/lib/types';

let seq = 0;
function app(input: ApplicationInput) {
  return createApplication(input, 'id-' + ++seq);
}

function sample(): Application[] {
  return [
    app({ company: 'Acme', title: 'Senior Engineer', dateApplied: '2026-02-01' }),
    app({ company: 'Globex', title: 'Data Analyst', dateApplied: '2026-02-05' }),
    app({ company: 'Initech', title: 'Backend Engineer', dateApplied: '2026-02-09' })
  ];
}

describe('duplicate keys', () => {
  it('ignores case and repeated whitespace', () => {
    const a = app({ company: 'Acme Corp', title: 'Senior Engineer', dateApplied: '2026-02-01' });
    const b = app({ company: '  acme   corp ', title: 'SENIOR  Engineer', dateApplied: '2026-02-01' });
    expect(duplicateKey(a)).toBe(duplicateKey(b));
  });

  it('keeps different fields apart, including a re-application on another day', () => {
    const base = app({ company: 'Acme', title: 'Engineer', dateApplied: '2026-02-01' });
    const later = app({ company: 'Acme', title: 'Engineer', dateApplied: '2026-06-01' });
    const other = app({ company: 'Acme', title: 'Designer', dateApplied: '2026-02-01' });
    expect(duplicateKey(base)).not.toBe(duplicateKey(later));
    expect(duplicateKey(base)).not.toBe(duplicateKey(other));
  });

  it('does not let a value spill across the separator', () => {
    const a = app({ company: 'Acme Inc', title: 'Engineer', dateApplied: '2026-02-01' });
    const b = app({ company: 'Acme', title: 'Inc Engineer', dateApplied: '2026-02-01' });
    expect(duplicateKey(a)).not.toBe(duplicateKey(b));
  });

  it('reads the same key from raw form input', () => {
    const saved = app({ company: 'Acme', title: 'Engineer', dateApplied: '2026-02-01' });
    expect(inputDuplicateKey({ company: ' acme ', title: 'Engineer', dateApplied: '2026-02-01' })).toBe(
      duplicateKey(saved)
    );
  });

  it('stays stable when other fields differ', () => {
    const a = app({ company: 'Acme', title: 'Engineer', dateApplied: '2026-02-01' });
    const b = app({
      company: 'Acme',
      title: 'Engineer',
      dateApplied: '2026-02-01',
      status: 'rejected',
      postingUrl: 'https://jobs.acme.test/1'
    });
    expect(duplicateKey(a)).toBe(duplicateKey(b));
  });
});

describe('findDuplicate', () => {
  it('finds a listing already tracked', () => {
    const apps = sample();
    const hit = findDuplicate(apps, {
      company: 'globex',
      title: 'Data Analyst',
      dateApplied: '2026-02-05'
    });
    expect(hit?.company).toBe('Globex');
  });

  it('returns null when nothing matches', () => {
    expect(
      findDuplicate(sample(), { company: 'Hooli', title: 'Engineer', dateApplied: '2026-02-05' })
    ).toBeNull();
  });

  it('does not report a row edited in place as its own duplicate', () => {
    const apps = sample();
    const target = apps[0];
    const payload = { company: target.company, title: target.title, dateApplied: target.dateApplied };
    expect(findDuplicate(apps, payload, target.id)).toBeNull();
    expect(findDuplicate(apps, payload)).toBe(target);
  });

  it('still flags an edit that collides with a different row', () => {
    const apps = sample();
    const hit = findDuplicate(
      apps,
      { company: 'Globex', title: 'Data Analyst', dateApplied: '2026-02-05' },
      apps[0].id
    );
    expect(hit).toBe(apps[1]);
  });
});

describe('planImport', () => {
  it('writes everything when the account is empty', () => {
    const incoming = sample();
    const plan = planImport(incoming, []);
    expect(plan.fresh).toEqual(incoming);
    expect(plan.skipped).toBe(0);
  });

  it('skips rows the account already holds', () => {
    const existing = sample();
    const incoming = [
      app({ company: 'acme', title: 'senior engineer', dateApplied: '2026-02-01' }),
      app({ company: 'Hooli', title: 'Staff Engineer', dateApplied: '2026-02-11' })
    ];
    const plan = planImport(incoming, existing);
    expect(plan.fresh.map((a) => a.company)).toEqual(['Hooli']);
    expect(plan.existingDuplicates).toBe(1);
    expect(plan.fileDuplicates).toBe(0);
    expect(plan.skipped).toBe(1);
  });

  it('collapses rows the file repeats', () => {
    const incoming = [
      app({ company: 'Hooli', title: 'Staff Engineer', dateApplied: '2026-02-11' }),
      app({ company: 'Hooli', title: 'Staff Engineer', dateApplied: '2026-02-11' }),
      app({ company: 'Hooli', title: 'Staff Engineer', dateApplied: '2026-02-11' })
    ];
    const plan = planImport(incoming, []);
    expect(plan.fresh).toHaveLength(1);
    expect(plan.fileDuplicates).toBe(2);
    expect(plan.existingDuplicates).toBe(0);
  });

  it('counts a repeat of an already-held row against the account, not the file', () => {
    const existing = sample();
    const incoming = [
      app({ company: 'Acme', title: 'Senior Engineer', dateApplied: '2026-02-01' }),
      app({ company: 'Acme', title: 'Senior Engineer', dateApplied: '2026-02-01' })
    ];
    const plan = planImport(incoming, existing);
    expect(plan.fresh).toHaveLength(0);
    expect(plan.existingDuplicates).toBe(2);
    expect(plan.fileDuplicates).toBe(0);
  });

  it('re-importing an export of the account adds nothing', () => {
    const existing = sample();
    const reimported = parseApplicationsCsv(applicationsToCsv(existing));
    expect(reimported).toHaveLength(existing.length);
    const plan = planImport(reimported, existing);
    expect(plan.fresh).toHaveLength(0);
    expect(plan.skipped).toBe(existing.length);
  });

  it('leaves the inputs untouched', () => {
    const existing = sample();
    const incoming = sample();
    const before = JSON.stringify({ existing, incoming });
    planImport(incoming, existing);
    expect(JSON.stringify({ existing, incoming })).toBe(before);
  });
});

describe('import against a live account', () => {
  it('re-importing an export leaves the account exactly as it was', async () => {
    const api = createSupabaseAccountApi(createFakeSupabase());
    await api.signUp('me@example.com', 'correct-horse');
    await api.add({ company: 'Acme', title: 'Senior Engineer', dateApplied: '2026-02-01' });
    await api.add({ company: 'Globex', title: 'Data Analyst', dateApplied: '2026-02-05' });

    const backup = applicationsToCsv(await api.list());
    const existing = await api.list();
    const plan = planImport(parseApplicationsCsv(backup), existing);
    expect(plan.fresh).toHaveLength(0);

    // Nothing to write, so the account is untouched. Writing plan.fresh
    // unconditionally would be a no-op insert of zero rows.
    const after = plan.fresh.length > 0 ? await api.addMany(plan.fresh) : existing;
    expect(after).toHaveLength(2);
    expect(after.map((a) => a.company).sort()).toEqual(['Acme', 'Globex']);
  });

  it('imports only the new rows from a CSV that partly overlaps the account', async () => {
    const api = createSupabaseAccountApi(createFakeSupabase());
    await api.signUp('me@example.com', 'correct-horse');
    await api.add({ company: 'Acme', title: 'Senior Engineer', dateApplied: '2026-02-01' });

    const csv = applicationsToCsv([
      app({ company: 'Acme', title: 'Senior Engineer', dateApplied: '2026-02-01' }),
      app({ company: 'Hooli', title: 'Staff Engineer', dateApplied: '2026-02-11' })
    ]);
    const plan = planImport(parseApplicationsCsv(csv), await api.list());
    expect(plan.existingDuplicates).toBe(1);

    const after = await api.addMany(plan.fresh);
    expect(after.map((a) => a.company).sort()).toEqual(['Acme', 'Hooli']);
  });
});
