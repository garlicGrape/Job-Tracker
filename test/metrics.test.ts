import { describe, it, expect } from 'vitest';
import {
  FOLLOW_UP_DAYS,
  addDays,
  computeMetrics,
  countByStatus,
  daysWaiting,
  needsFollowUp,
  weekStartOf,
  weeklyActivity
} from '../src/lib/metrics';
import { createApplication, daysBetween, todayIsoDate } from '../src/lib/applications';
import type { ApplicationInput } from '../src/lib/types';

const TODAY = '2026-03-01';

let seq = 0;
function app(input: ApplicationInput) {
  return createApplication(input, 'id-' + ++seq);
}

/** A small pipeline: 2 applied, 1 interviewing, 1 offer, 2 rejected. */
function pipeline() {
  return [
    app({ company: 'Acme', title: 'Dev', dateApplied: '2026-02-28' }),
    app({ company: 'Globex', title: 'Dev', dateApplied: '2026-01-01' }),
    app({ company: 'Initech', title: 'PM', dateApplied: '2026-02-20', status: 'interviewing' }),
    app({ company: 'Hooli', title: 'Staff', dateApplied: '2026-02-10', status: 'offer' }),
    app({ company: 'Acme', title: 'Intern', dateApplied: '2026-02-01', status: 'rejected' }),
    app({ company: 'Umbrella', title: 'SRE', dateApplied: '2025-12-01', status: 'rejected' })
  ];
}

describe('date arithmetic', () => {
  it('counts whole days between two YYYY-MM-DD strings', () => {
    expect(daysBetween('2026-03-01', '2026-03-01')).toBe(0);
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
    expect(daysBetween('2026-01-01', '2026-03-01')).toBe(59);
    expect(daysBetween('2026-03-02', '2026-03-01')).toBe(-1);
  });

  it('crosses a daylight-saving boundary without gaining or losing a day', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
  });

  it('returns 0 for malformed input', () => {
    expect(daysBetween('nope', '2026-03-01')).toBe(0);
    expect(daysBetween('2026-03-01', '')).toBe(0);
  });

  it('formats today as YYYY-MM-DD in local time', () => {
    expect(todayIsoDate(new Date(2026, 2, 1, 23, 30))).toBe('2026-03-01');
    expect(todayIsoDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('countByStatus', () => {
  it('counts every stage, including the empty ones', () => {
    expect(countByStatus(pipeline())).toEqual({
      applied: 2,
      interviewing: 1,
      offer: 1,
      rejected: 2
    });
  });

  it('returns zeros for an empty list', () => {
    expect(countByStatus([])).toEqual({ applied: 0, interviewing: 0, offer: 0, rejected: 0 });
  });
});

describe('computeMetrics', () => {
  const metrics = computeMetrics(pipeline(), TODAY);

  it('splits open from answered', () => {
    expect(metrics.total).toBe(6);
    expect(metrics.open).toBe(3);
    expect(metrics.answered).toBe(4);
  });

  it('reports response, interview, offer, and rejection rates as percentages', () => {
    expect(metrics.responseRate).toBe(67);
    expect(metrics.interviewRate).toBe(33);
    expect(metrics.offerRate).toBe(17);
    expect(metrics.rejectionRate).toBe(33);
  });

  it('counts recent activity and a weekly pace', () => {
    expect(metrics.appliedLast7Days).toBe(1);
    expect(metrics.appliedLast30Days).toBe(4);
    expect(metrics.weeklyPace).toBe(0.9);
    expect(metrics.lastAppliedDate).toBe('2026-02-28');
  });

  it('measures how long the open applications have been waiting', () => {
    // Open: Acme 1 day, Globex 59 days, Initech 9 days.
    expect(metrics.avgOpenAgeDays).toBe(23);
    expect(metrics.longestOpenWait).toEqual({ days: 59, company: 'Globex', title: 'Dev' });
  });

  it('counts distinct companies case-insensitively', () => {
    expect(metrics.distinctCompanies).toBe(5);
    expect(
      computeMetrics(
        [
          app({ company: 'Acme', title: 'A', dateApplied: TODAY }),
          app({ company: 'acme  ', title: 'B', dateApplied: TODAY })
        ],
        TODAY
      ).distinctCompanies
    ).toBe(1);
  });

  it('ignores closed listings when measuring the wait', () => {
    const closedOnly = computeMetrics(
      [app({ company: 'Acme', title: 'Dev', dateApplied: '2020-01-01', status: 'rejected' })],
      TODAY
    );
    expect(closedOnly.open).toBe(0);
    expect(closedOnly.avgOpenAgeDays).toBe(0);
    expect(closedOnly.longestOpenWait).toBeNull();
  });

  it('does not count a future date as recent activity', () => {
    const future = computeMetrics(
      [app({ company: 'Acme', title: 'Dev', dateApplied: '2026-03-10' })],
      TODAY
    );
    expect(future.appliedLast7Days).toBe(0);
    expect(future.appliedLast30Days).toBe(0);
    expect(future.avgOpenAgeDays).toBe(0);
  });

  it('divides by zero safely on an empty account', () => {
    expect(computeMetrics([], TODAY)).toEqual({
      total: 0,
      counts: { applied: 0, interviewing: 0, offer: 0, rejected: 0 },
      open: 0,
      answered: 0,
      responseRate: 0,
      interviewRate: 0,
      offerRate: 0,
      rejectionRate: 0,
      appliedLast7Days: 0,
      appliedLast30Days: 0,
      weeklyPace: 0,
      avgOpenAgeDays: 0,
      longestOpenWait: null,
      followUpCount: 0,
      distinctCompanies: 0,
      lastAppliedDate: ''
    });
  });

  it('defaults to the real today when no date is passed', () => {
    const live = computeMetrics([app({ company: 'Acme', title: 'Dev', dateApplied: todayIsoDate() })]);
    expect(live.appliedLast7Days).toBe(1);
    expect(live.avgOpenAgeDays).toBe(0);
  });
});

describe('weeklyActivity', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('finds the Monday of a week', () => {
    expect(weekStartOf('2026-09-02')).toBe('2026-08-31'); // Wednesday
    expect(weekStartOf('2026-08-31')).toBe('2026-08-31'); // Monday
    expect(weekStartOf('2026-09-06')).toBe('2026-08-31'); // Sunday
    expect(weekStartOf('2026-09-07')).toBe('2026-09-07'); // next Monday
  });

  it('returns empty buckets, oldest first and the current week last', () => {
    const weeks = weeklyActivity([], '2026-09-02', 8);
    expect(weeks).toHaveLength(8);
    expect(weeks[0].weekStart).toBe('2026-07-13');
    expect(weeks[7].weekStart).toBe('2026-08-31');
    expect(weeks.every((w) => w.count === 0)).toBe(true);
  });

  it('buckets applications by Monday-start week and drops dates outside the window', () => {
    const apps = [
      app({ company: 'A', title: 'Dev', dateApplied: '2026-08-31' }), // Monday of this week
      app({ company: 'B', title: 'Dev', dateApplied: '2026-09-02' }), // today
      app({ company: 'C', title: 'Dev', dateApplied: '2026-09-06' }), // Sunday, still this week
      app({ company: 'D', title: 'Dev', dateApplied: '2026-09-07' }), // next week, excluded
      app({ company: 'E', title: 'Dev', dateApplied: '2026-08-30' }), // Sunday of last week
      app({ company: 'F', title: 'Dev', dateApplied: '2026-08-24' }), // Monday of last week
      app({ company: 'G', title: 'Dev', dateApplied: '2026-07-13' }), // oldest bucket
      app({ company: 'H', title: 'Dev', dateApplied: '2026-07-12' }) // before the window
    ];
    expect(weeklyActivity(apps, '2026-09-02', 8).map((w) => w.count)).toEqual([
      1, 0, 0, 0, 0, 0, 2, 3
    ]);
  });

  it('never returns fewer than one bucket', () => {
    expect(weeklyActivity([], '2026-09-02', 0)).toHaveLength(1);
  });
});

describe('follow-ups', () => {
  it('counts days waiting and never goes negative on a future date', () => {
    expect(daysWaiting(app({ company: 'A', title: 'Dev', dateApplied: '2026-02-15' }), TODAY)).toBe(14);
    expect(daysWaiting(app({ company: 'B', title: 'Dev', dateApplied: TODAY }), TODAY)).toBe(0);
    expect(daysWaiting(app({ company: 'C', title: 'Dev', dateApplied: '2026-03-20' }), TODAY)).toBe(0);
  });

  it('flags an open listing on the threshold day, not the day before', () => {
    const eve = app({ company: 'A', title: 'Dev', dateApplied: addDays(TODAY, -(FOLLOW_UP_DAYS - 1)) });
    const due = app({ company: 'B', title: 'Dev', dateApplied: addDays(TODAY, -FOLLOW_UP_DAYS) });
    expect(needsFollowUp(eve, TODAY)).toBe(false);
    expect(needsFollowUp(due, TODAY)).toBe(true);
  });

  it('never flags a stage the company already answered', () => {
    const old = '2025-01-01';
    expect(needsFollowUp(app({ company: 'A', title: 'Dev', dateApplied: old }), TODAY)).toBe(true);
    expect(
      needsFollowUp(app({ company: 'B', title: 'Dev', dateApplied: old, status: 'interviewing' }), TODAY)
    ).toBe(true);
    expect(
      needsFollowUp(app({ company: 'C', title: 'Dev', dateApplied: old, status: 'offer' }), TODAY)
    ).toBe(false);
    expect(
      needsFollowUp(app({ company: 'D', title: 'Dev', dateApplied: old, status: 'rejected' }), TODAY)
    ).toBe(false);
  });

  it('honors a custom threshold', () => {
    const waited = app({ company: 'A', title: 'Dev', dateApplied: '2026-02-25' }); // 4 days
    expect(needsFollowUp(waited, TODAY, 3)).toBe(true);
    expect(needsFollowUp(waited, TODAY, 5)).toBe(false);
  });

  it('reports the same count through computeMetrics', () => {
    // Globex applied 2026-01-01 and is still open; Initech has been
    // interviewing only 9 days, and the offer and rejections never count.
    expect(computeMetrics(pipeline(), TODAY).followUpCount).toBe(1);
    expect(computeMetrics([], TODAY).followUpCount).toBe(0);
    expect(pipeline().filter((a) => needsFollowUp(a, TODAY))).toHaveLength(1);
  });

  it('defaults to today when no day is given', () => {
    expect(needsFollowUp(app({ company: 'A', title: 'Dev', dateApplied: todayIsoDate() }))).toBe(
      false
    );
    expect(daysWaiting(app({ company: 'B', title: 'Dev', dateApplied: todayIsoDate() }))).toBe(0);
  });
});
