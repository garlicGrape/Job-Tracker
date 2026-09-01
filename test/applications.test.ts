import { describe, it, expect } from 'vitest';
import {
  addApplication,
  getApplications,
  removeApplication,
  setOffer,
  updateApplication
} from '../src/lib/store';
import { createMemoryStorage, storedRows } from './harness';

describe('reading applications', () => {
  it('returns an empty array when nothing is stored', () => {
    const storage = createMemoryStorage();
    expect(getApplications(storage)).toEqual([]);
  });

  it('returns an empty array for corrupt JSON', () => {
    const storage = createMemoryStorage({ 'job-tracker.applications': '{not json' });
    expect(getApplications(storage)).toEqual([]);
  });

  it('maps each record to id and fields', () => {
    const storage = createMemoryStorage();
    addApplication(storage, {
      company: 'Acme',
      title: 'Frontend',
      dateApplied: '2026-08-20',
      receivedOffer: true
    });
    addApplication(storage, {
      company: 'Globex',
      title: 'Backend',
      dateApplied: '2026-08-25',
      receivedOffer: false
    });
    const apps = getApplications(storage);
    expect(apps).toHaveLength(2);
    expect(apps[0]).toMatchObject({
      company: 'Acme',
      title: 'Frontend',
      dateApplied: '2026-08-20',
      receivedOffer: true,
      postingUrl: ''
    });
    expect(apps[1]).toMatchObject({
      company: 'Globex',
      title: 'Backend',
      dateApplied: '2026-08-25',
      receivedOffer: false,
      postingUrl: ''
    });
    expect(apps[0].id).not.toBe(apps[1].id);
  });

  it('stores dates as plain YYYY-MM-DD strings, never Date objects', () => {
    const storage = createMemoryStorage();
    addApplication(storage, { company: 'Acme', title: 'Dev', dateApplied: '2026-12-31' });
    const stored = storedRows(storage)[0].dateApplied;
    expect(typeof stored).toBe('string');
    expect(stored).toBe('2026-12-31');
  });
});

describe('setOffer', () => {
  it('writes the boolean on the matching application', () => {
    const storage = createMemoryStorage();
    const [first] = addApplication(storage, {
      company: 'Acme',
      title: 'Dev',
      dateApplied: '2026-08-20',
      receivedOffer: false
    });
    setOffer(storage, first.id, true);
    expect(getApplications(storage)[0].receivedOffer).toBe(true);
    setOffer(storage, first.id, false);
    expect(getApplications(storage)[0].receivedOffer).toBe(false);
  });

  it('does not touch other applications', () => {
    const storage = createMemoryStorage();
    const [first] = addApplication(storage, {
      company: 'Acme',
      title: 'Dev',
      dateApplied: '2026-08-20',
      receivedOffer: false
    });
    addApplication(storage, {
      company: 'Globex',
      title: 'PM',
      dateApplied: '2026-08-25',
      receivedOffer: false
    });
    const secondId = getApplications(storage)[1].id;
    setOffer(storage, secondId, true);
    const apps = getApplications(storage);
    expect(apps.find((a) => a.id === first.id)?.receivedOffer).toBe(false);
    expect(apps.find((a) => a.id === secondId)?.receivedOffer).toBe(true);
  });

  it('rejects a missing id', () => {
    const storage = createMemoryStorage();
    addApplication(storage, { company: 'Acme', title: 'Dev', dateApplied: '2026-08-20' });
    expect(() => setOffer(storage, 'missing-id', true)).toThrow(/not found/i);
    expect(() => setOffer(storage, '', true)).toThrow(/invalid application id/i);
  });
});

describe('updateApplication', () => {
  it('replaces fields on the matching application and keeps the id', () => {
    const storage = createMemoryStorage();
    const [first] = addApplication(storage, {
      company: 'Acme',
      title: 'Dev',
      dateApplied: '2026-08-20',
      receivedOffer: false
    });
    const next = updateApplication(storage, first.id, {
      company: 'Acme Inc',
      title: 'Senior Dev',
      dateApplied: '2026-08-21',
      receivedOffer: true,
      postingUrl: 'https://jobs.acme.test/senior'
    });
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      id: first.id,
      company: 'Acme Inc',
      title: 'Senior Dev',
      dateApplied: '2026-08-21',
      receivedOffer: true,
      postingUrl: 'https://jobs.acme.test/senior'
    });
  });

  it('does not touch other applications', () => {
    const storage = createMemoryStorage();
    const [first] = addApplication(storage, {
      company: 'Acme',
      title: 'Dev',
      dateApplied: '2026-08-20'
    });
    addApplication(storage, {
      company: 'Globex',
      title: 'PM',
      dateApplied: '2026-08-25'
    });
    updateApplication(storage, first.id, {
      company: 'Acme',
      title: 'Staff Dev',
      dateApplied: '2026-08-20'
    });
    const apps = getApplications(storage);
    expect(apps).toHaveLength(2);
    expect(apps[0].title).toBe('Staff Dev');
    expect(apps[1].title).toBe('PM');
  });

  it('rejects a missing id', () => {
    const storage = createMemoryStorage();
    addApplication(storage, { company: 'Acme', title: 'Dev', dateApplied: '2026-08-20' });
    expect(() =>
      updateApplication(storage, 'missing-id', {
        company: 'Acme',
        title: 'Dev',
        dateApplied: '2026-08-20'
      })
    ).toThrow(/not found/i);
    expect(() =>
      updateApplication(storage, '', {
        company: 'Acme',
        title: 'Dev',
        dateApplied: '2026-08-20'
      })
    ).toThrow(/invalid application id/i);
  });

  it('rejects invalid replacement fields without writing', () => {
    const storage = createMemoryStorage();
    const [first] = addApplication(storage, {
      company: 'Acme',
      title: 'Dev',
      dateApplied: '2026-08-20'
    });
    expect(() =>
      updateApplication(storage, first.id, {
        company: '',
        title: 'Dev',
        dateApplied: '2026-08-20'
      })
    ).toThrow(/company is required/i);
    expect(getApplications(storage)[0].company).toBe('Acme');
  });
});

describe('removeApplication', () => {
  it('deletes the matching application and keeps the rest', () => {
    const storage = createMemoryStorage();
    const [first] = addApplication(storage, {
      company: 'Acme',
      title: 'Dev',
      dateApplied: '2026-08-20'
    });
    addApplication(storage, {
      company: 'Globex',
      title: 'PM',
      dateApplied: '2026-08-25'
    });
    const next = removeApplication(storage, first.id);
    expect(next).toHaveLength(1);
    expect(next[0].company).toBe('Globex');
    expect(getApplications(storage)).toHaveLength(1);
  });

  it('rejects a missing id', () => {
    const storage = createMemoryStorage();
    addApplication(storage, { company: 'Acme', title: 'Dev', dateApplied: '2026-08-20' });
    expect(() => removeApplication(storage, 'missing-id')).toThrow(/not found/i);
    expect(() => removeApplication(storage, '')).toThrow(/invalid application id/i);
    expect(getApplications(storage)).toHaveLength(1);
  });
});

describe('legacy records without postingUrl', () => {
  it('loads four-field JSON and defaults postingUrl to empty', () => {
    const storage = createMemoryStorage({
      'job-tracker.applications': JSON.stringify([
        {
          id: 'legacy-1',
          company: 'Acme',
          title: 'Dev',
          dateApplied: '2026-08-20',
          receivedOffer: false
        }
      ])
    });
    expect(getApplications(storage)).toEqual([
      {
        id: 'legacy-1',
        company: 'Acme',
        title: 'Dev',
        dateApplied: '2026-08-20',
        receivedOffer: false,
        postingUrl: ''
      }
    ]);
  });
});

