import { describe, it, expect } from 'vitest';
import { addDays, computeMetrics, daysBetween, formatPercent, weekStartOf } from '../src/lib/metrics';
import type { Application, ApplicationStatus } from '../src/lib/types';

let seq = 0;
function app(dateApplied: string, status: ApplicationStatus = 'applied', company = 'Acme'): Application {
  seq += 1;
  return { id: `m-${seq}`, company, title: 'Dev', dateApplied, status, postingUrl: '' };
}

const TODAY = '2026-09-02'; // a Wednesday

describe('date helpers', () => {
  it('counts whole days between YYYY-MM-DD strings without timezone drift', () => {
    expect(daysBetween('2026-09-01', '2026-09-02')).toBe(1);
    expect(daysBetween('2026-09-02', '2026-09-02')).toBe(0);
    expect(daysBetween('2026-09-03', '2026-09-02')).toBe(-1);
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
    expect(daysBetween('2025-12-31', '2026-12-31')).toBe(365);
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('finds the Monday of a week', () => {
    expect(weekStartOf('2026-09-02')).toBe('2026-08-31');
    expect(weekStartOf('2026-08-31')).toBe('2026-08-31');
    expect(weekStartOf('2026-09-06')).toBe('2026-08-31');
    expect(weekStartOf('2026-09-07')).toBe('2026-09-07');
  });
});

describe('computeMetrics', () => {
  it('returns zeros and nulls for an empty pipeline', () => {
    const m = computeMetrics([], TODAY);
    expect(m.total).toBe(0);
    expect(m.byStatus).toEqual({ applied: 0, interviewing: 0, offer: 0, rejected: 0 });
    expect(m.responseRate).toBeNull();
    expect(m.offerRate).toBeNull();
    expect(m.perWeek).toBeNull();
    expect(m.longestWaitingDays).toBeNull();
    expect(m.medianActiveDays).toBeNull();
    expect(m.firstApplied).toBeNull();
    expect(m.weekly).toHaveLength(8);
    expect(m.weekly.every((w) => w.count === 0)).toBe(true);
  });

  it('counts each status and derives active and responded totals', () => {
    const m = computeMetrics(
      [
        app('2026-08-01', 'applied'),
        app('2026-08-02', 'applied'),
        app('2026-08-03', 'interviewing'),
        app('2026-08-04', 'offer'),
        app('2026-08-05', 'rejected'),
        app('2026-08-06', 'rejected')
      ],
      TODAY
    );
    expect(m.total).toBe(6);
    expect(m.byStatus).toEqual({ applied: 2, interviewing: 1, offer: 1, rejected: 2 });
    expect(m.active).toBe(3);
    expect(m.responded).toBe(4);
    expect(m.responseRate).toBeCloseTo(4 / 6);
    expect(m.interviewRate).toBeCloseTo(2 / 6);
    expect(m.offerRate).toBeCloseTo(1 / 6);
    expect(m.rejectionRate).toBeCloseTo(2 / 6);
  });

  it('counts recent activity windows and ignores future-dated rows', () => {
    const m = computeMetrics(
      [
        app(TODAY),
        app(addDays(TODAY, -6)),
        app(addDays(TODAY, -7)),
        app(addDays(TODAY, -29)),
        app(addDays(TODAY, -30)),
        app(addDays(TODAY, 3))
      ],
      TODAY
    );
    expect(m.last7Days).toBe(2);
    expect(m.last30Days).toBe(4);
  });

  it('counts distinct companies case-insensitively', () => {
    const m = computeMetrics(
      [app('2026-08-01', 'applied', 'Acme'), app('2026-08-02', 'applied', 'acme '), app('2026-08-03', 'applied', 'Globex')],
      TODAY
    );
    expect(m.companies).toBe(2);
  });

  it('measures pace from the first application to today', () => {
    // 14 days inclusive of both ends = 2 weeks, 4 applications → 2 per week.
    const m = computeMetrics(
      [app(addDays(TODAY, -13)), app(addDays(TODAY, -10)), app(addDays(TODAY, -3)), app(TODAY)],
      TODAY
    );
    expect(m.firstApplied).toBe(addDays(TODAY, -13));
    expect(m.lastApplied).toBe(TODAY);
    expect(m.perWeek).toBeCloseTo(2);
  });

  it('reports the longest wait among unanswered listings and the median active age', () => {
    const m = computeMetrics(
      [
        app(addDays(TODAY, -40), 'applied'),
        app(addDays(TODAY, -10), 'applied'),
        app(addDays(TODAY, -4), 'interviewing'),
        app(addDays(TODAY, -90), 'rejected'),
        app(addDays(TODAY, -60), 'offer')
      ],
      TODAY
    );
    expect(m.longestWaitingDays).toBe(40);
    expect(m.medianActiveDays).toBe(10);
  });

  it('buckets applications into Monday-start weeks, current week last', () => {
    const m = computeMetrics(
      [
        app('2026-08-31'), // Monday of this week
        app('2026-09-02'), // today
        app('2026-09-06'), // Sunday, still this week
        app('2026-08-30'), // Sunday of last week
        app('2026-08-24'), // Monday of last week
        app('2026-07-13'), // Monday, 7 weeks back (oldest bucket)
        app('2026-07-12') // before the window
      ],
      TODAY,
      8
    );
    expect(m.weekly).toHaveLength(8);
    expect(m.weekly[0].weekStart).toBe('2026-07-13');
    expect(m.weekly[7].weekStart).toBe('2026-08-31');
    expect(m.weekly.map((w) => w.count)).toEqual([1, 0, 0, 0, 0, 0, 2, 3]);
  });
});

describe('formatPercent', () => {
  it('rounds to whole percents and shows a dash for nothing to divide', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(1 / 3)).toBe('33%');
    expect(formatPercent(1)).toBe('100%');
  });
});
