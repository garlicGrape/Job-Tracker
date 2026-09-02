/**
 * Search, filter, sort, and group listings.
 *
 * Framework-free and non-mutating: every function returns a new array, so the
 * React layer can treat the account's full list as read-only and keep the
 * organizing rules unit-tested.
 */
import {
  OPEN_STATUSES,
  STATUSES,
  STATUS_LABELS,
  type Application,
  type ApplicationStatus
} from './types';

/** `all` and `open` are views across stages; the rest are single stages. */
export type StatusFilter = 'all' | 'open' | ApplicationStatus;

export const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'open', ...STATUSES];

export const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'All',
  open: 'Open',
  ...STATUS_LABELS
};

export type SortKey = 'newest' | 'oldest' | 'company' | 'title' | 'stage';

export const SORT_OPTIONS: readonly { value: SortKey; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'stage', label: 'Stage' },
  { value: 'company', label: 'Company A–Z' },
  { value: 'title', label: 'Title A–Z' }
];

/** Most promising first, so "Stage" sorting surfaces what needs attention. */
const STAGE_RANK: Record<ApplicationStatus, number> = {
  offer: 0,
  interviewing: 1,
  applied: 2,
  rejected: 3
};

export type OrganizeOptions = {
  query?: string;
  status?: StatusFilter;
  sort?: SortKey;
};

export type StatusGroup = {
  status: ApplicationStatus;
  label: string;
  items: Application[];
};

export function isOpen(app: Application): boolean {
  return OPEN_STATUSES.includes(app.status);
}

export function matchesStatusFilter(app: Application, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'open') return isOpen(app);
  return app.status === filter;
}

/**
 * Case-insensitive substring match over company, title, posting URL, and the
 * stage label, so typing "reject" or "acme" both work.
 */
export function matchesQuery(app: Application, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [app.company, app.title, app.postingUrl, STATUS_LABELS[app.status]]
    .join(' \u0000 ')
    .toLowerCase()
    .includes(needle);
}

export function filterApplications(
  apps: Application[],
  options: { query?: string; status?: StatusFilter } = {}
): Application[] {
  const query = options.query ?? '';
  const status = options.status ?? 'all';
  return apps.filter((app) => matchesStatusFilter(app, status) && matchesQuery(app, query));
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

export function sortApplications(apps: Application[], sort: SortKey = 'newest'): Application[] {
  const byNewest = (a: Application, b: Application) =>
    b.dateApplied.localeCompare(a.dateApplied) || compareText(a.company, b.company);

  const copy = [...apps];
  switch (sort) {
    case 'oldest':
      return copy.sort(
        (a, b) => a.dateApplied.localeCompare(b.dateApplied) || compareText(a.company, b.company)
      );
    case 'company':
      return copy.sort((a, b) => compareText(a.company, b.company) || byNewest(a, b));
    case 'title':
      return copy.sort((a, b) => compareText(a.title, b.title) || byNewest(a, b));
    case 'stage':
      return copy.sort((a, b) => STAGE_RANK[a.status] - STAGE_RANK[b.status] || byNewest(a, b));
    case 'newest':
    default:
      return copy.sort(byNewest);
  }
}

/**
 * Bucket listings by stage in pipeline order. Empty stages are dropped so the
 * UI does not render headers with nothing under them.
 */
export function groupByStatus(apps: Application[]): StatusGroup[] {
  return STATUSES.map((status) => ({
    status,
    label: STATUS_LABELS[status],
    items: apps.filter((app) => app.status === status)
  })).filter((group) => group.items.length > 0);
}

export function organizeApplications(
  apps: Application[],
  options: OrganizeOptions = {}
): Application[] {
  return sortApplications(filterApplications(apps, options), options.sort ?? 'newest');
}
