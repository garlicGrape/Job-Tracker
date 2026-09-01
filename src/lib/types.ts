export const HEADERS = [
  'Company',
  'Title',
  'Date Applied',
  'Received Offer',
  'Posting URL'
] as const;

export const STORAGE_KEY = 'job-tracker.applications';

export type ApplicationInput = {
  company?: unknown;
  title?: unknown;
  dateApplied?: unknown;
  receivedOffer?: unknown;
  postingUrl?: unknown;
};

export type Application = {
  id: string;
  company: string;
  title: string;
  dateApplied: string;
  receivedOffer: boolean;
  postingUrl: string;
};
