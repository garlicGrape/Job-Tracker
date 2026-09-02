/**
 * Pipeline metrics derived from a list of applications.
 *
 * Framework-free and pure: pass the list and the day to measure against, get
 * numbers back. Everything here is computed from fields the app already
 * stores (stage + date applied), so no extra columns are needed.
 */
import { daysBetween, todayIsoDate } from './applications';
import {
  ANSWERED_STATUSES,
  OPEN_STATUSES,
  STATUSES,
  type Application,
  type ApplicationStatus
} from './types';

export type StatusCounts = Record<ApplicationStatus, number>;

/**
 * How long an open application may sit before it is worth chasing. Two weeks
 * is the point where most pipelines have either moved or gone quiet, and it
 * is the default everywhere staleness is asked about.
 */
export const FOLLOW_UP_DAYS = 14;

/**
 * Whole days an application has been waiting. Future dates count as 0 rather
 * than negative, so a listing entered ahead of time is never "overdue".
 */
export function daysWaiting(app: Application, today: string = todayIsoDate()): number {
  return Math.max(0, daysBetween(app.dateApplied, today));
}

/**
 * True when a listing is still open and has waited past the threshold. Closed
 * stages (offer, rejected) are never stale: the company already answered.
 */
export function needsFollowUp(
  app: Application,
  today: string = todayIsoDate(),
  afterDays: number = FOLLOW_UP_DAYS
): boolean {
  return OPEN_STATUSES.includes(app.status) && daysWaiting(app, today) >= afterDays;
}

export type WeekBucket = {
  /** Monday of that calendar week, YYYY-MM-DD. */
  weekStart: string;
  count: number;
};

export type Metrics = {
  total: number;
  counts: StatusCounts;
  /** Still waiting on the company: applied + interviewing. */
  open: number;
  /** The company answered: interviewing + offer + rejected. */
  answered: number;
  /** Share of all applications that got any answer, 0-100. */
  responseRate: number;
  /** Share that reached interviews or better, 0-100. */
  interviewRate: number;
  /** Share that ended in an offer, 0-100. */
  offerRate: number;
  /** Share that ended in a rejection, 0-100. */
  rejectionRate: number;
  appliedLast7Days: number;
  appliedLast30Days: number;
  /** Applications per week over the last 30 days, one decimal place. */
  weeklyPace: number;
  /** Average age in days of the applications still waiting. */
  avgOpenAgeDays: number;
  /** The oldest application still waiting, if any. */
  longestOpenWait: { days: number; company: string; title: string } | null;
  /** Open applications that have waited past FOLLOW_UP_DAYS. */
  followUpCount: number;
  distinctCompanies: number;
  /** Most recent date applied, or '' when the list is empty. */
  lastAppliedDate: string;
};

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

function emptyCounts(): StatusCounts {
  const counts = {} as StatusCounts;
  for (const status of STATUSES) {
    counts[status] = 0;
  }
  return counts;
}

export function countByStatus(apps: Application[]): StatusCounts {
  const counts = emptyCounts();
  for (const app of apps) {
    counts[app.status] += 1;
  }
  return counts;
}

export function computeMetrics(
  apps: Application[],
  today: string = todayIsoDate()
): Metrics {
  const counts = countByStatus(apps);
  const total = apps.length;
  const open = OPEN_STATUSES.reduce((sum, status) => sum + counts[status], 0);
  const answered = ANSWERED_STATUSES.reduce((sum, status) => sum + counts[status], 0);

  let appliedLast7Days = 0;
  let appliedLast30Days = 0;
  let openAgeTotal = 0;
  let followUpCount = 0;
  let longestOpenWait: Metrics['longestOpenWait'] = null;
  let lastAppliedDate = '';
  const companies = new Set<string>();

  for (const app of apps) {
    companies.add(app.company.trim().toLowerCase());
    if (app.dateApplied > lastAppliedDate) {
      lastAppliedDate = app.dateApplied;
    }
    // Negative ages come from dates in the future; they are not "recent".
    const age = daysBetween(app.dateApplied, today);
    if (age >= 0 && age < 7) appliedLast7Days += 1;
    if (age >= 0 && age < 30) appliedLast30Days += 1;
    if (OPEN_STATUSES.includes(app.status)) {
      const waited = Math.max(0, age);
      openAgeTotal += waited;
      if (waited >= FOLLOW_UP_DAYS) {
        followUpCount += 1;
      }
      if (!longestOpenWait || waited > longestOpenWait.days) {
        longestOpenWait = { days: waited, company: app.company, title: app.title };
      }
    }
  }

  return {
    total,
    counts,
    open,
    answered,
    responseRate: percent(answered, total),
    interviewRate: percent(counts.interviewing + counts.offer, total),
    offerRate: percent(counts.offer, total),
    rejectionRate: percent(counts.rejected, total),
    appliedLast7Days,
    appliedLast30Days,
    weeklyPace: Math.round((appliedLast30Days / 30) * 7 * 10) / 10,
    avgOpenAgeDays: open > 0 ? Math.round(openAgeTotal / open) : 0,
    longestOpenWait,
    followUpCount,
    distinctCompanies: companies.size,
    lastAppliedDate
  };
}

const DAY_MS = 86_400_000;

function fromUtc(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

function toUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Shift a YYYY-MM-DD string by whole days on the UTC calendar. */
export function addDays(iso: string, days: number): string {
  return fromUtc(toUtc(iso) + days * DAY_MS);
}

/** Monday on or before the given date. */
export function weekStartOf(iso: string): string {
  const ms = toUtc(iso);
  const dow = new Date(ms).getUTCDay(); // 0 = Sunday
  return fromUtc(ms - ((dow + 6) % 7) * DAY_MS);
}

/**
 * Applications per calendar week (Monday to Sunday) for the most recent
 * `weeks` weeks, oldest first, the current week last. Dates before the window
 * or after the current week are left out.
 */
export function weeklyActivity(
  apps: Application[],
  today: string = todayIsoDate(),
  weeks: number = 8
): WeekBucket[] {
  const bucketCount = Math.max(1, Math.floor(weeks));
  const currentWeek = weekStartOf(today);
  const buckets: WeekBucket[] = [];
  for (let i = bucketCount - 1; i >= 0; i--) {
    buckets.push({ weekStart: addDays(currentWeek, -7 * i), count: 0 });
  }
  const first = buckets[0].weekStart;
  const afterLast = addDays(currentWeek, 7);
  for (const app of apps) {
    if (app.dateApplied < first || app.dateApplied >= afterLast) continue;
    buckets[Math.floor(daysBetween(first, app.dateApplied) / 7)].count += 1;
  }
  return buckets;
}
