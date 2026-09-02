import { describe, it, expect } from 'vitest';
import {
  SORT_OPTIONS,
  STATUS_FILTERS,
  STATUS_FILTER_LABELS,
  filterApplications,
  groupByStatus,
  isOpen,
  matchesQuery,
  matchesStatusFilter,
  organizeApplications,
  sortApplications
} from '../src/lib/organize';
import { createApplication } from '../src/lib/applications';
import type { Application, ApplicationInput } from '../src/lib/types';

let seq = 0;
function app(input: ApplicationInput) {
  return createApplication(input, 'id-' + ++seq);
}

function sample(): Application[] {
  return [
    app({
      company: 'Globex',
      title: 'Backend Engineer',
      dateApplied: '2026-01-05',
      postingUrl: 'https://jobs.globex.test/backend'
    }),
    app({ company: 'acme', title: 'Frontend Engineer', dateApplied: '2026-02-20' }),
    app({ company: 'Initech', title: 'Data Analyst', dateApplied: '2026-02-01', status: 'interviewing' }),
    app({ company: 'Hooli', title: 'Staff Engineer', dateApplied: '2026-01-20', status: 'offer' }),
    app({ company: 'Umbrella', title: 'Site Reliability', dateApplied: '2026-02-10', status: 'rejected' })
  ];
}

const companies = (apps: Application[]) => apps.map((a) => a.company);

describe('filter options', () => {
  it('exposes every stage plus the all and open views', () => {
    expect(STATUS_FILTERS).toEqual([
      'all',
      'open',
      'followup',
      'applied',
      'interviewing',
      'offer',
      'rejected'
    ]);
    for (const filter of STATUS_FILTERS) {
      expect(STATUS_FILTER_LABELS[filter]).toBeTruthy();
    }
    expect(SORT_OPTIONS.map((o) => o.value)).toEqual([
      'newest',
      'oldest',
      'stage',
      'company',
      'title'
    ]);
  });
});

describe('filtering', () => {
  it('treats applied and interviewing as open', () => {
    const apps = sample();
    expect(apps.filter(isOpen).map((a) => a.status)).toEqual([
      'applied',
      'applied',
      'interviewing'
    ]);
  });

  it('keeps everything under the all filter', () => {
    expect(filterApplications(sample(), { status: 'all' })).toHaveLength(5);
    expect(filterApplications(sample())).toHaveLength(5);
  });

  it('narrows to a single stage', () => {
    expect(companies(filterApplications(sample(), { status: 'rejected' }))).toEqual(['Umbrella']);
    expect(companies(filterApplications(sample(), { status: 'offer' }))).toEqual(['Hooli']);
    expect(companies(filterApplications(sample(), { status: 'open' }))).toEqual([
      'Globex',
      'acme',
      'Initech'
    ]);
  });

  it('matches a query against company, title, URL, and stage label', () => {
    const [globex, acme, initech, hooli, umbrella] = sample();
    expect(matchesQuery(acme, 'ACME')).toBe(true);
    expect(matchesQuery(acme, 'front')).toBe(true);
    expect(matchesQuery(globex, 'jobs.globex.test')).toBe(true);
    expect(matchesQuery(umbrella, 'reject')).toBe(true);
    expect(matchesQuery(hooli, 'offer')).toBe(true);
    expect(matchesQuery(initech, 'nothing here')).toBe(false);
    expect(matchesQuery(initech, '   ')).toBe(true);
  });

  it('requires every term, drawn from any field, in any order', () => {
    const [globex] = sample();
    // Company and title together: the whole point of splitting on whitespace.
    expect(matchesQuery(globex, 'Globex Backend')).toBe(true);
    expect(matchesQuery(globex, 'backend globex')).toBe(true);
    expect(matchesQuery(globex, 'globex   backend')).toBe(true);
    // One term nothing matches still rejects the row.
    expect(matchesQuery(globex, 'Globex Frontend')).toBe(false);
  });

  it('combines a query with a stage filter', () => {
    const apps = sample();
    expect(companies(filterApplications(apps, { query: 'engineer', status: 'open' }))).toEqual([
      'Globex',
      'acme'
    ]);
    expect(filterApplications(apps, { query: 'engineer', status: 'rejected' })).toEqual([]);
  });

  it('honors a single-stage filter check', () => {
    const [globex] = sample();
    expect(matchesStatusFilter(globex, 'applied')).toBe(true);
    expect(matchesStatusFilter(globex, 'open')).toBe(true);
    expect(matchesStatusFilter(globex, 'rejected')).toBe(false);
  });

  it('filters to what has gone quiet, measured against a given day', () => {
    const apps = sample();
    // Globex applied 2026-01-05 and Initech is interviewing since 2026-02-01;
    // both are open. On this day only Globex has waited past the threshold.
    expect(companies(filterApplications(apps, { status: 'followup', today: '2026-01-25' }))).toEqual([
      'Globex'
    ]);
    // A day later Initech has crossed the threshold too, but acme (applied
    // the day before) has not.
    expect(
      companies(filterApplications(apps, { status: 'followup', today: '2026-02-21' }))
    ).toEqual(['Globex', 'Initech']);
    expect(filterApplications(apps, { status: 'followup', today: '2026-01-10' })).toEqual([]);
  });

  it('never calls a closed stage a follow-up, however old', () => {
    const apps = sample();
    const due = filterApplications(apps, { status: 'followup', today: '2030-01-01' });
    expect(companies(due)).toEqual(['Globex', 'acme', 'Initech']);
  });
});

describe('sorting', () => {
  it('puts the newest application first by default', () => {
    expect(companies(sortApplications(sample()))).toEqual([
      'acme',
      'Umbrella',
      'Initech',
      'Hooli',
      'Globex'
    ]);
  });

  it('reverses for oldest first', () => {
    expect(companies(sortApplications(sample(), 'oldest'))).toEqual([
      'Globex',
      'Hooli',
      'Initech',
      'Umbrella',
      'acme'
    ]);
  });

  it('sorts company and title case-insensitively', () => {
    expect(companies(sortApplications(sample(), 'company'))).toEqual([
      'acme',
      'Globex',
      'Hooli',
      'Initech',
      'Umbrella'
    ]);
    expect(sortApplications(sample(), 'title').map((a) => a.title)).toEqual([
      'Backend Engineer',
      'Data Analyst',
      'Frontend Engineer',
      'Site Reliability',
      'Staff Engineer'
    ]);
  });

  it('orders by stage with the most promising first, newest within a stage', () => {
    expect(companies(sortApplications(sample(), 'stage'))).toEqual([
      'Hooli',
      'Initech',
      'acme',
      'Globex',
      'Umbrella'
    ]);
  });

  it('never mutates the input list', () => {
    const apps = sample();
    const before = companies(apps);
    sortApplications(apps, 'company');
    sortApplications(apps, 'stage');
    expect(companies(apps)).toEqual(before);
  });

  it('breaks a date tie by company', () => {
    const tied = [
      app({ company: 'Zeta', title: 'Dev', dateApplied: '2026-01-01' }),
      app({ company: 'Alpha', title: 'Dev', dateApplied: '2026-01-01' })
    ];
    expect(companies(sortApplications(tied))).toEqual(['Alpha', 'Zeta']);
  });
});

describe('grouping', () => {
  it('buckets by stage in pipeline order and drops empty stages', () => {
    const groups = groupByStatus(sample());
    expect(groups.map((g) => g.status)).toEqual(['applied', 'interviewing', 'offer', 'rejected']);
    expect(groups.map((g) => g.items.length)).toEqual([2, 1, 1, 1]);
    expect(groups[0].label).toBe('Applied');

    const onlyRejected = groupByStatus([
      app({ company: 'Acme', title: 'Dev', dateApplied: '2026-01-01', status: 'rejected' })
    ]);
    expect(onlyRejected.map((g) => g.status)).toEqual(['rejected']);
    expect(groupByStatus([])).toEqual([]);
  });

  it('keeps the incoming order inside a group', () => {
    const groups = groupByStatus(sortApplications(sample(), 'newest'));
    expect(companies(groups[0].items)).toEqual(['acme', 'Globex']);
  });
});

describe('organizeApplications', () => {
  it('filters and sorts in one pass', () => {
    expect(companies(organizeApplications(sample(), { status: 'open', sort: 'oldest' }))).toEqual([
      'Globex',
      'Initech',
      'acme'
    ]);
  });

  it('returns everything, newest first, with no options', () => {
    expect(organizeApplications(sample())).toHaveLength(5);
    expect(organizeApplications(sample())[0].company).toBe('acme');
  });
});
