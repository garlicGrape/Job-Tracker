export const HEADERS = ['Company', 'Title', 'Date Applied', 'Status', 'Posting URL'] as const;

export const STORAGE_KEY = 'job-tracker.applications';

/**
 * Pipeline stage of one listing. Stored as lowercase text; the CHECK in
 * supabase/schema.sql accepts exactly these values.
 */
export const STATUSES = ['applied', 'interviewing', 'offer', 'rejected'] as const;

export type ApplicationStatus = (typeof STATUSES)[number];

export type ApplicationInput = {
  company?: unknown;
  title?: unknown;
  dateApplied?: unknown;
  status?: unknown;
  /** Legacy boolean from the five-field era; `true` maps to status `offer`. */
  receivedOffer?: unknown;
  postingUrl?: unknown;
};

export type Application = {
  id: string;
  company: string;
  title: string;
  dateApplied: string;
  status: ApplicationStatus;
  postingUrl: string;
};
