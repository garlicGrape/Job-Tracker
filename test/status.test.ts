import { describe, it, expect } from 'vitest';
import {
  createApplication,
  isApplicationStatus,
  mapDatabaseError,
  normalizeStatus,
  resolveStatus,
  validateApplication
} from '../src/lib/applications';
import { applicationsToCsv, parseApplicationsCsv, splitCsvLine } from '../src/lib/csv';
import { createSupabaseAccountApi, fromRow, toRow } from '../src/lib/supabase-account';
import { STATUSES } from '../src/lib/types';
import { createFakeSupabase } from './fake-supabase';

describe('status values', () => {
  it('offers exactly the four pipeline stages', () => {
    expect(STATUSES).toEqual(['applied', 'interviewing', 'offer', 'rejected']);
    for (const status of STATUSES) {
      expect(isApplicationStatus(status)).toBe(true);
    }
    expect(isApplicationStatus('ghosted')).toBe(false);
  });

  it('reads labels, aliases, and stray casing', () => {
    expect(normalizeStatus('Rejected')).toBe('rejected');
    expect(normalizeStatus('  INTERVIEWING ')).toBe('interviewing');
    expect(normalizeStatus('interview')).toBe('interviewing');
    expect(normalizeStatus('declined')).toBe('rejected');
    expect(normalizeStatus('offered')).toBe('offer');
    expect(normalizeStatus('waiting')).toBe('applied');
  });

  it('falls back rather than throwing on unknown text', () => {
    expect(normalizeStatus('who knows')).toBe('applied');
    expect(normalizeStatus(undefined, 'offer')).toBe('offer');
    expect(normalizeStatus(null, 'rejected')).toBe('rejected');
  });

  it('promotes a legacy offer flag when no status is given', () => {
    expect(resolveStatus({ receivedOffer: true })).toBe('offer');
    expect(resolveStatus({ receivedOffer: false })).toBe('applied');
    expect(resolveStatus({})).toBe('applied');
    expect(resolveStatus({ status: 'rejected', receivedOffer: true })).toBe('rejected');
  });
});

describe('validation with stages', () => {
  it('defaults to applied and keeps receivedOffer as a mirror', () => {
    const app = validateApplication({ company: 'Acme', title: 'Dev', dateApplied: '2026-01-01' });
    expect(app.status).toBe('applied');
    expect(app.receivedOffer).toBe(false);
  });

  it('accepts each stage and mirrors the offer flag', () => {
    for (const status of STATUSES) {
      const app = validateApplication({
        company: 'Acme',
        title: 'Dev',
        dateApplied: '2026-01-01',
        status
      });
      expect(app.status).toBe(status);
      expect(app.receivedOffer).toBe(status === 'offer');
    }
  });

  it('marks a listing rejected without disturbing the other fields', () => {
    const app = createApplication(
      {
        company: 'Acme',
        title: 'Dev',
        dateApplied: '2026-01-01',
        postingUrl: 'https://jobs.acme.test/dev',
        status: 'rejected'
      },
      'app-1'
    );
    expect(app).toEqual({
      id: 'app-1',
      company: 'Acme',
      title: 'Dev',
      dateApplied: '2026-01-01',
      status: 'rejected',
      receivedOffer: false,
      postingUrl: 'https://jobs.acme.test/dev'
    });
  });

  it('maps the Postgres status constraint to a client message', () => {
    expect(
      mapDatabaseError('new row violates check constraint "applications_status_valid"')
    ).toMatch(/applied, interviewing, offer, rejected/);
  });
});

describe('status round-trips through CSV', () => {
  it('writes a Status column and reads it back', () => {
    const apps = STATUSES.map((status, i) =>
      createApplication(
        { company: 'Acme ' + i, title: 'Dev', dateApplied: '2026-01-0' + (i + 1), status },
        'id-' + i
      )
    );
    const csv = applicationsToCsv(apps);
    const lines = csv.trim().split(/\r?\n/);
    expect(splitCsvLine(lines[0])[5]).toBe('Status');
    expect(lines.slice(1).map((line) => splitCsvLine(line)[5])).toEqual([
      'Applied',
      'Interviewing',
      'Offer',
      'Rejected'
    ]);
    expect(parseApplicationsCsv(csv).map((a) => a.status)).toEqual(STATUSES);
  });

  it('prefers the Status column over the legacy offer flag', () => {
    const csv = [
      'Company,Title,Date Applied,Received Offer,Posting URL,Status',
      'Acme,Dev,2026-01-01,TRUE,,Rejected'
    ].join('\n');
    const [app] = parseApplicationsCsv(csv);
    expect(app.status).toBe('rejected');
    expect(app.receivedOffer).toBe(false);
  });

  it('imports a sheet whose columns are reordered or renamed', () => {
    const csv = ['Company,Title,Stage,Date', 'Acme,Dev,Interviewing,2026-01-01'].join('\n');
    const [app] = parseApplicationsCsv(csv);
    expect(app).toMatchObject({
      company: 'Acme',
      title: 'Dev',
      dateApplied: '2026-01-01',
      status: 'interviewing'
    });
  });

  it('still imports a legacy four-column export', () => {
    const csv = [
      'Company,Title,Date Applied,Received Offer',
      'Acme,Dev,2026-01-01,TRUE',
      'Globex,PM,2026-01-02,FALSE'
    ].join('\n');
    expect(parseApplicationsCsv(csv).map((a) => a.status)).toEqual(['offer', 'applied']);
  });

  it('ignores an unrecognized stage instead of dropping the row', () => {
    const csv = [
      'Company,Title,Date Applied,Received Offer,Posting URL,Status',
      'Acme,Dev,2026-01-01,FALSE,,¯\\_(ツ)_/¯'
    ].join('\n');
    const [app] = parseApplicationsCsv(csv);
    expect(app.status).toBe('applied');
  });
});

describe('status round-trips through Postgres rows', () => {
  it('writes the stage and the mirrored offer flag', () => {
    const row = toRow('user-1', {
      id: 'app-1',
      company: 'Acme',
      title: 'Dev',
      dateApplied: '2026-09-01',
      status: 'offer',
      receivedOffer: true,
      postingUrl: ''
    });
    expect(row.status).toBe('offer');
    expect(row.received_offer).toBe(true);
    expect(fromRow(row).status).toBe('offer');
  });

  it('derives the stage for a row written before the column existed', () => {
    const base = {
      id: 'app-1',
      user_id: 'user-1',
      company: 'Acme',
      title: 'Dev',
      date_applied: '2026-09-01',
      posting_url: ''
    };
    expect(fromRow({ ...base, received_offer: true }).status).toBe('offer');
    expect(fromRow({ ...base, received_offer: false }).status).toBe('applied');
    expect(fromRow({ ...base, received_offer: false, status: null }).status).toBe('applied');
  });
});

describe('setStatus through the account API', () => {
  it('marks a listing rejected and keeps it in the account', async () => {
    const api = createSupabaseAccountApi(createFakeSupabase());
    await api.signUp('me@example.com', 'correct-horse');
    await api.add({ company: 'Acme', title: 'Dev', dateApplied: '2026-01-01' });
    const [before] = await api.list();
    expect(before.status).toBe('applied');

    const after = await api.setStatus(before.id, 'rejected');
    expect(after).toHaveLength(1);
    expect(after[0].status).toBe('rejected');
    expect(after[0].receivedOffer).toBe(false);
  });

  it('walks the whole pipeline, offer flag following the stage', async () => {
    const api = createSupabaseAccountApi(createFakeSupabase());
    await api.signUp('me@example.com', 'correct-horse');
    await api.add({ company: 'Acme', title: 'Dev', dateApplied: '2026-01-01' });
    const [app] = await api.list();

    expect((await api.setStatus(app.id, 'interviewing'))[0]).toMatchObject({
      status: 'interviewing',
      receivedOffer: false
    });
    expect((await api.setStatus(app.id, 'offer'))[0]).toMatchObject({
      status: 'offer',
      receivedOffer: true
    });
    expect((await api.setStatus(app.id, 'rejected'))[0]).toMatchObject({
      status: 'rejected',
      receivedOffer: false
    });
  });

  it('keeps setOffer working as a shorthand for the offer stage', async () => {
    const api = createSupabaseAccountApi(createFakeSupabase());
    await api.signUp('me@example.com', 'correct-horse');
    await api.add({ company: 'Acme', title: 'Dev', dateApplied: '2026-01-01' });
    const [app] = await api.list();
    expect((await api.setOffer(app.id, true))[0].status).toBe('offer');
    expect((await api.setOffer(app.id, false))[0].status).toBe('applied');
  });

  it('does not change another account’s listing', async () => {
    const client = createFakeSupabase();
    const api = createSupabaseAccountApi(client);
    await api.signUp('ada@example.com', 'password1');
    await api.add({ company: 'AdaCorp', title: 'PM', dateApplied: '2026-01-01' });
    const [adas] = await api.list();
    await api.signOut();

    await api.signUp('bob@example.com', 'password1');
    await api.setStatus(adas.id, 'rejected');
    await api.signOut();

    await api.signIn('ada@example.com', 'password1');
    expect((await api.list())[0].status).toBe('applied');
  });

  it('rejects a status change without an id', async () => {
    const api = createSupabaseAccountApi(createFakeSupabase());
    await api.signUp('me@example.com', 'correct-horse');
    await expect(api.setStatus('', 'rejected')).rejects.toThrow(/invalid application id/i);
  });
});
