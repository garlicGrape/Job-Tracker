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
    distinctCompanies: companies.size,
    lastAppliedDate
  };
}
