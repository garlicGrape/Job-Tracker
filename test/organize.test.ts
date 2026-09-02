import { describe, it, expect } from 'vitest';
import {
  isSortKey,
  matchesQuery,
  matchesStatus,
  organizeApplications,
  sortApplications
} from '../src/lib/organize';
import type { Application, ApplicationStatus } from '../src/lib/types';

function app(
  id: string,
  company: string,
  dateApplied: string,
  status: ApplicationStatus = 'applied',
  title = 'Dev'
): Application {
  return { id, company, title, dateApplied, status, postingUrl: '' };
}

const APPS: Application[] = [
  app('1', 'Acme', '2026-08-20', 'applied', 'Frontend Engineer'),
  app('2', 'globex', '2026-08-25', 'rejected', 'Backend Engineer'),
  app('3', 'Initech', '2026-08-25', 'interviewing', 'Data Analyst'),
  app('4', 'Umbrella', '2026-07-01', 'offer', 'Analyst')
];

describe('matchesQuery', () => {
  it('matches company or title, case-insensitively, and blank matches all', () => {
    expect(matchesQuery(APPS[0], 'acme')).toBe(true);
    expect(matchesQuery(APPS[0], 'FRONT')).toBe(true);
    expect(matchesQuery(APPS[0], 'backend')).toBe(false);
    expect(matchesQuery(APPS[0], '')).toBe(true);
    expect(matchesQuery(APPS[0], '   ')).toBe(true);
    expect(matchesQuery(APPS[0], undefined)).toBe(true);
  });
});

describe('matchesStatus', () => {
  it('handles all, active, and a single status', () => {
    expect(APPS.filter((a) => matchesStatus(a, 'all')).map((a) => a.id)).toEqual(['1', '2', '3', '4']);
    expect(APPS.filter((a) => matchesStatus(a, undefined)).map((a) => a.id)).toEqual(['1', '2', '3', '4']);
    expect(APPS.filter((a) => matchesStatus(a, 'active')).map((a) => a.id)).toEqual(['1', '3']);
    expect(APPS.filter((a) => matchesStatus(a, 'rejected')).map((a) => a.id)).toEqual(['2']);
    expect(APPS.filter((a) => matchesStatus(a, 'offer')).map((a) => a.id)).toEqual(['4']);
  });
});

describe('sortApplications', () => {
  it('sorts newest first by default, breaking ties by company', () => {
    expect(sortApplications(APPS).map((a) => a.id)).toEqual(['2', '3', '1', '4']);
  });

  it('sorts oldest first', () => {
    expect(sortApplications(APPS, 'oldest').map((a) => a.id)).toEqual(['4', '1', '2', '3']);
  });

  it('sorts by company ignoring case', () => {
    expect(sortApplications(APPS, 'company').map((a) => a.company)).toEqual([
      'Acme',
      'globex',
      'Initech',
      'Umbrella'
    ]);
  });

  it('sorts by pipeline stage: offer, interviewing, applied, rejected', () => {
    expect(sortApplications(APPS, 'status').map((a) => a.status)).toEqual([
      'offer',
      'interviewing',
      'applied',
      'rejected'
    ]);
  });

  it('does not mutate the input', () => {
    const copy = [...APPS];
    sortApplications(APPS, 'oldest');
    expect(APPS).toEqual(copy);
  });
});

describe('organizeApplications', () => {
  it('filters then sorts', () => {
    const result = organizeApplications(APPS, { query: 'engineer', status: 'all', sort: 'oldest' });
    expect(result.map((a) => a.id)).toEqual(['1', '2']);
  });

  it('combines a status filter with a search', () => {
    expect(organizeApplications(APPS, { query: 'analyst', status: 'active' }).map((a) => a.id)).toEqual(['3']);
    expect(organizeApplications(APPS, { query: 'nothing', status: 'all' })).toEqual([]);
  });

  it('defaults to every listing, newest first', () => {
    expect(organizeApplications(APPS).map((a) => a.id)).toEqual(['2', '3', '1', '4']);
  });
});

describe('isSortKey', () => {
  it('guards select values from the UI', () => {
    expect(isSortKey('newest')).toBe(true);
    expect(isSortKey('status')).toBe(true);
    expect(isSortKey('random')).toBe(false);
    expect(isSortKey(undefined)).toBe(false);
  });
});
