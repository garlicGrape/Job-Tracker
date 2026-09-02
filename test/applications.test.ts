import { describe, it, expect } from 'vitest';
import {
  addApplication,
  getApplications,
  removeApplication,
  setStatus,
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
      status: 'offer'
    });
    addApplication(storage, {
      company: 'Globex',
      title: 'Backend',
      dateApplied: '2026-08-25',
      status: 'applied'
    });
    const apps = getApplications(storage);
    expect(apps).toHaveLength(2);
    expect(apps[0]).toMatchObject({
      company: 'Acme',
      title: 'Frontend',
      dateApplied: '2026-08-20',
      status: 'offer',
      postingUrl: ''
    });
    expect(apps[1]).toMatchObject({
      company: 'Globex',
      title: 'Backend',
      dateApplied: '2026-08-25',
      status: 'applied',
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

describe('setStatus', () => {
  it('moves the matching application through the pipeline', () => {
    const storage = createMemoryStorage();
    const [first] = addApplication(storage, {
      company: 'Acme',
      title: 'Dev',
      dateApplied: '2026-08-20',
      status: 'applied'
    });
    setStatus(storage, first.id, 'interviewing');
    expect(getApplications(storage)[0].status).toBe('interviewing');
    setStatus(storage, first.id, 'rejected');
    expect(getApplications(storage)[0].status).toBe('rejected');
    setStatus(storage, first.id, 'Offer');
    expect(getApplications(storage)[0].status).toBe('offer');
    setStatus(storage, first.id, 'applied');
    expect(getApplications(storage)[0].status).toBe('applied');
  });

  it('does not touch other applications', () => {
    const storage = createMemoryStorage();
    const [first] = addApplication(storage, {
      company: 'Acme',
      title: 'Dev',
      dateApplied: '2026-08-20',
      status: 'applied'
    });
    addApplication(storage, {
      company: 'Globex',
      title: 'PM',
      dateApplied: '2026-08-25',
      status: 'applied'
    });
    const secondId = getApplications(storage)[1].id;
    setStatus(storage, secondId, 'rejected');
    const apps = getApplications(storage);
    expect(apps.find((a) => a.id === first.id)?.status).toBe('applied');
    expect(apps.find((a) => a.id === secondId)?.status).toBe('rejected');
  });

  it('rejects a missing id', () => {
    const storage = createMemoryStorage();
    addApplication(storage, { company: 'Acme', title: 'Dev', dateApplied: '2026-08-20' });
    expect(() => setStatus(storage, 'missing-id', 'rejected')).toThrow(/not found/i);
    expect(() => setStatus(storage, '', 'rejected')).toThrow(/invalid application id/i);
  });

  it('rejects an unknown status without writing', () => {
    const storage = createMemoryStorage();
    const [first] = addApplication(storage, { company: 'Acme', title: 'Dev', dateApplied: '2026-08-20' });
    expect(() => setStatus(storage, first.id, 'ghosted')).toThrow(/status must be one of/i);
    expect(getApplications(storage)[0].status).toBe('applied');
  });
});

describe('updateApplication', () => {
  it('replaces fields on the matching application and keeps the id', () => {
    const storage = createMemoryStorage();
    const [first] = addApplication(storage, {
      company: 'Acme',
      title: 'Dev',
      dateApplied: '2026-08-20',
      status: 'applied'
    });
    const next = updateApplication(storage, first.id, {
      company: 'Acme Inc',
      title: 'Senior Dev',
      dateApplied: '2026-08-21',
      status: 'offer',
      postingUrl: 'https://jobs.acme.test/senior'
    });
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      id: first.id,
      company: 'Acme Inc',
      title: 'Senior Dev',
      dateApplied: '2026-08-21',
      status: 'offer',
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

describe('legacy records', () => {
  it('upgrades a receivedOffer boolean to a status', () => {
    const storage = createMemoryStorage({
      'job-tracker.applications': JSON.stringify([
        { id: 'a', company: 'Acme', title: 'Dev', dateApplied: '2026-08-20', receivedOffer: true },
        { id: 'b', company: 'Globex', title: 'PM', dateApplied: '2026-08-21', receivedOffer: false },
        { id: 'c', company: 'Initech', title: 'QA', dateApplied: '2026-08-22', status: 'rejected' }
      ])
    });
    expect(getApplications(storage).map((a) => a.status)).toEqual(['offer', 'applied', 'rejected']);
  });

  it('loads four-field JSON and defaults postingUrl to empty', () => {
    const storage = createMemoryStorage({
      'job-tracker.applications': JSON.stringify([
        {
          id: 'legacy-1',
          company: 'Acme',
          title: 'Dev',
          dateApplied: '2026-08-20',
          status: 'applied'
        }
      ])
    });
    expect(getApplications(storage)).toEqual([
      {
        id: 'legacy-1',
        company: 'Acme',
        title: 'Dev',
        dateApplied: '2026-08-20',
        status: 'applied',
        postingUrl: ''
      }
    ]);
  });
});

