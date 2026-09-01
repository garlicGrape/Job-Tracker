import { describe, it, expect } from 'vitest';
import { addApplication, getApplications, setOffer } from '../src/lib/store';
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
      receivedOffer: true
    });
    expect(apps[1]).toMatchObject({
      company: 'Globex',
      title: 'Backend',
      dateApplied: '2026-08-25',
      receivedOffer: false
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
