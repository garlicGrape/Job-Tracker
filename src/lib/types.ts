/**
 * CSV column order. `Received Offer` stays in place so a spreadsheet or an
 * older export still imports positionally; `Status` is appended.
 */
export const HEADERS = [
  'Company',
  'Title',
  'Date Applied',
  'Received Offer',
  'Posting URL',
  'Status'
] as const;

export const STORAGE_KEY = 'job-tracker.applications';

/**
 * Pipeline stages, in the order an application usually moves through them.
 * `receivedOffer` is kept as a mirror of `status === 'offer'` so the CSV
 * column and older rows keep working.
 */
export const STATUSES = ['applied', 'interviewing', 'offer', 'rejected'] as const;

export type ApplicationStatus = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  rejected: 'Rejected'
};

/** Stages that are still waiting on the company. */
export const OPEN_STATUSES: ApplicationStatus[] = ['applied', 'interviewing'];

/** Stages that mean the company answered, whatever the answer was. */
export const ANSWERED_STATUSES: ApplicationStatus[] = ['interviewing', 'offer', 'rejected'];

export type ApplicationInput = {
  company?: unknown;
  title?: unknown;
  dateApplied?: unknown;
  status?: unknown;
  receivedOffer?: unknown;
  postingUrl?: unknown;
};

export type Application = {
  id: string;
  company: string;
  title: string;
  dateApplied: string;
  status: ApplicationStatus;
  receivedOffer: boolean;
  postingUrl: string;
};
