/**
 * Search, filter, and sort for the listing table. Pure functions over the
 * array the account API returns; the UI keeps the chosen options in state.
 */
import type { Application, ApplicationStatus } from './types';

export type SortKey = 'newest' | 'oldest' | 'company' | 'status';

export type StatusFilter = 'all' | 'active' | ApplicationStatus;

export type OrganizeOptions = {
  query?: string;
  status?: StatusFilter;
  sort?: SortKey;
};

export const SORT_KEYS: readonly SortKey[] = ['newest', 'oldest', 'company', 'status'];

export const SORT_LABELS: Record<SortKey, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  company: 'Company A–Z',
  status: 'By status'
};

/** Pipeline order used by the status sort: closest to a job first. */
export const STATUS_ORDER: readonly ApplicationStatus[] = [
  'offer',
  'interviewing',
  'applied',
  'rejected'
];

export function isSortKey(value: unknown): value is SortKey {
  return typeof value === 'string' && (SORT_KEYS as readonly string[]).includes(value);
}

export function normalizeQuery(query: unknown): string {
  return (query == null ? '' : String(query)).trim().toLowerCase();
}

/** Case-insensitive substring match on company or title. Blank matches all. */
export function matchesQuery(app: Application, query: unknown): boolean {
  const q = normalizeQuery(query);
  if (!q) return true;
  return app.company.toLowerCase().includes(q) || app.title.toLowerCase().includes(q);
}

export function matchesStatus(app: Application, filter: StatusFilter | undefined): boolean {
  if (!filter || filter === 'all') return true;
  if (filter === 'active') return app.status === 'applied' || app.status === 'interviewing';
  return app.status === filter;
}

function byDateDesc(a: Application, b: Application): number {
  return b.dateApplied.localeCompare(a.dateApplied) || a.company.localeCompare(b.company);
}

/** Returns a sorted copy; the input array is never mutated. */
export function sortApplications(apps: Application[], sort: SortKey = 'newest'): Application[] {
  const copy = [...apps];
  switch (sort) {
    case 'oldest':
      return copy.sort(
        (a, b) => a.dateApplied.localeCompare(b.dateApplied) || a.company.localeCompare(b.company)
      );
    case 'company':
      return copy.sort(
        (a, b) =>
          a.company.localeCompare(b.company, undefined, { sensitivity: 'base' }) || byDateDesc(a, b)
      );
    case 'status':
      return copy.sort(
        (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || byDateDesc(a, b)
      );
    case 'newest':
    default:
      return copy.sort(byDateDesc);
  }
}

export function organizeApplications(
  apps: Application[],
  options: OrganizeOptions = {}
): Application[] {
  const filtered = apps.filter(
    (app) => matchesStatus(app, options.status) && matchesQuery(app, options.query)
  );
  return sortApplications(filtered, options.sort);
}
