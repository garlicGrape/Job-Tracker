/**
 * Pipeline metrics computed from the listing array. Framework-free and pure:
 * pass `today` as YYYY-MM-DD so the numbers are reproducible in tests and do
 * not drift with the browser's timezone.
 */
import { STATUSES, type Application, type ApplicationStatus } from './types';

export type WeekBucket = {
  /** Monday of that calendar week, YYYY-MM-DD. */
  weekStart: string;
  count: number;
};

export type PipelineMetrics = {
  total: number;
  byStatus: Record<ApplicationStatus, number>;
  /** Still open: applied + interviewing. */
  active: number;
  /** Heard back in any form: interviewing + offer + rejected. */
  responded: number;
  responseRate: number | null;
  /** Reached an interview or further: interviewing + offer. */
  interviewRate: number | null;
  offerRate: number | null;
  rejectionRate: number | null;
  last7Days: number;
  last30Days: number;
  /** Distinct companies, case-insensitive. */
  companies: number;
  /** Average applications per week from the first application to today. */
  perWeek: number | null;
  /** Days the oldest listing still marked "applied" has waited. */
  longestWaitingDays: number | null;
  /** Median days since applied across active listings. */
  medianActiveDays: number | null;
  firstApplied: string | null;
  lastApplied: string | null;
  /** Oldest week first; the last bucket is the current week. */
  weekly: WeekBucket[];
};

const DAY_MS = 86_400_000;

function toUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

/** Whole days from `fromIso` to `toIso`; negative when `toIso` is earlier. */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((toUtc(toIso) - toUtc(fromIso)) / DAY_MS);
}

export function addDays(iso: string, days: number): string {
  return fromUtc(toUtc(iso) + days * DAY_MS);
}

/** Monday on or before the given date. */
export function weekStartOf(iso: string): string {
  const ms = toUtc(iso);
  const dow = new Date(ms).getUTCDay(); // 0 = Sunday
  const back = (dow + 6) % 7;
  return fromUtc(ms - back * DAY_MS);
}

function ratio(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function emptyByStatus(): Record<ApplicationStatus, number> {
  const out = {} as Record<ApplicationStatus, number>;
  for (const status of STATUSES) out[status] = 0;
  return out;
}

export function computeMetrics(
  apps: Application[],
  today: string,
  weeks: number = 8
): PipelineMetrics {
  const byStatus = emptyByStatus();
  const companies = new Set<string>();
  let last7Days = 0;
  let last30Days = 0;
  let firstApplied: string | null = null;
  let lastApplied: string | null = null;
  let longestWaitingDays: number | null = null;
  const activeAges: number[] = [];

  for (const app of apps) {
    byStatus[app.status] += 1;
    companies.add(app.company.trim().toLowerCase());
    const age = daysBetween(app.dateApplied, today);
    if (age >= 0 && age < 7) last7Days += 1;
    if (age >= 0 && age < 30) last30Days += 1;
    if (firstApplied === null || app.dateApplied < firstApplied) firstApplied = app.dateApplied;
    if (lastApplied === null || app.dateApplied > lastApplied) lastApplied = app.dateApplied;
    if (app.status === 'applied' && (longestWaitingDays === null || age > longestWaitingDays)) {
      longestWaitingDays = age;
    }
    if (app.status === 'applied' || app.status === 'interviewing') {
      activeAges.push(age);
    }
  }

  const total = apps.length;
  const active = byStatus.applied + byStatus.interviewing;
  const responded = byStatus.interviewing + byStatus.offer + byStatus.rejected;

  let perWeek: number | null = null;
  if (firstApplied !== null) {
    const spanDays = Math.max(daysBetween(firstApplied, today), 0) + 1;
    perWeek = total / (spanDays / 7);
  }

  const bucketCount = Math.max(1, Math.floor(weeks));
  const currentWeek = weekStartOf(today);
  const weekly: WeekBucket[] = [];
  for (let i = bucketCount - 1; i >= 0; i--) {
    weekly.push({ weekStart: addDays(currentWeek, -7 * i), count: 0 });
  }
  const firstBucket = weekly[0].weekStart;
  const afterLast = addDays(currentWeek, 7);
  for (const app of apps) {
    if (app.dateApplied < firstBucket || app.dateApplied >= afterLast) continue;
    const idx = Math.floor(daysBetween(firstBucket, app.dateApplied) / 7);
    weekly[idx].count += 1;
  }

  return {
    total,
    byStatus,
    active,
    responded,
    responseRate: ratio(responded, total),
    interviewRate: ratio(byStatus.interviewing + byStatus.offer, total),
    offerRate: ratio(byStatus.offer, total),
    rejectionRate: ratio(byStatus.rejected, total),
    last7Days,
    last30Days,
    companies: companies.size,
    perWeek,
    longestWaitingDays,
    medianActiveDays: median(activeAges),
    firstApplied,
    lastApplied,
    weekly
  };
}

/** "42%" for 0.42; an em dash when there is nothing to divide. */
export function formatPercent(rate: number | null): string {
  if (rate === null) return '—';
  return `${Math.round(rate * 100)}%`;
}
