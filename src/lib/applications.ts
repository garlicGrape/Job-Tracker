/**
 * Shared domain logic for Job Tracker.
 *
 * Framework-free so Vitest can import it directly. The React UI and any
 * Lovable restyle should call these helpers rather than reimplementing
 * validation or CSV rules.
 */
import type { Application, ApplicationInput } from './types';

/**
 * Abuse / integrity limits. Postgres CHECKs and triggers in
 * supabase/schema.sql use the same numbers so a direct API call cannot
 * skip them. Keep the SQL file in sync when changing these.
 */
export const LIMITS = {
  maxCompanyLength: 200,
  maxTitleLength: 200,
  maxPostingUrlLength: 2048,
  maxApplicationsPerUser: 500,
  maxWritesPerWindow: 30,
  writeWindowMinutes: 10,
  maxCsvBytes: 512 * 1024
} as const;

/**
 * Coerce an arbitrary truthy/checkbox value into a real boolean.
 */
export function toBoolean(value: unknown): boolean {
  return (
    value === true ||
    value === 'true' ||
    value === 'TRUE' ||
    value === 1 ||
    value === '1' ||
    value === 'Yes' ||
    value === 'YES' ||
    value === 'yes'
  );
}

/**
 * Neutralize spreadsheet formula injection. A value beginning with =, +, -, @
 * (or a leading tab / carriage return) is treated as a formula by Excel and
 * Google Sheets, so we prefix it with an apostrophe when writing CSV.
 */
export function escapeFormula(value: unknown): string {
  const str = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    return "'" + str;
  }
  return str;
}

/**
 * Validate a YYYY-MM-DD string and confirm it is a real calendar date.
 * Dates are stored as text, never Date objects, to avoid timezone drift.
 */
export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parts = value.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (month < 1 || month > 12) {
    return false;
  }
  const daysInMonth = new Date(year, month, 0).getDate();
  return day >= 1 && day <= daysInMonth;
}

/**
 * Trim a posting URL and, when the value has no scheme, prefix https:// so
 * pasted hostnames like linkedin.com/jobs/view/123 still round-trip.
 */
export function normalizePostingUrl(value: unknown): string {
  const trimmed = (value == null ? '' : String(value)).trim();
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return trimmed;
  }
  return 'https://' + trimmed;
}

/**
 * True when value is empty (URL is optional) or a real http(s) URL.
 */
export function isValidHttpUrl(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validate and normalize a raw application payload. Returns a clean object
 * without an id; throws on invalid input.
 */
export function validateApplication(
  app: ApplicationInput | null | undefined
): Omit<Application, 'id'> {
  if (!app || typeof app !== 'object') {
    throw new Error('Invalid application.');
  }
  const company = (app.company == null ? '' : String(app.company)).trim();
  const title = (app.title == null ? '' : String(app.title)).trim();
  const dateApplied = (app.dateApplied == null ? '' : String(app.dateApplied)).trim();
  const postingUrl = normalizePostingUrl(app.postingUrl);

  if (!company) {
    throw new Error('Company is required.');
  }
  if (!title) {
    throw new Error('Title is required.');
  }
  if (company.length > LIMITS.maxCompanyLength) {
    throw new Error(`Company must be at most ${LIMITS.maxCompanyLength} characters.`);
  }
  if (title.length > LIMITS.maxTitleLength) {
    throw new Error(`Title must be at most ${LIMITS.maxTitleLength} characters.`);
  }
  if (!isValidDate(dateApplied)) {
    throw new Error('Date Applied must be a valid date in YYYY-MM-DD format.');
  }
  if (postingUrl.length > LIMITS.maxPostingUrlLength) {
    throw new Error(`Posting URL must be at most ${LIMITS.maxPostingUrlLength} characters.`);
  }
  if (!isValidHttpUrl(postingUrl)) {
    throw new Error('Posting URL must be a valid http or https URL.');
  }

  return {
    company,
    title,
    dateApplied,
    receivedOffer: toBoolean(app.receivedOffer),
    postingUrl
  };
}

export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'app-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function createApplication(
  app: ApplicationInput,
  id: string = createId()
): Application {
  return { id, ...validateApplication(app) };
}

/**
 * Reject a write that would take an account past the listing cap.
 */
export function assertApplicationQuota(nextCount: number): void {
  if (nextCount > LIMITS.maxApplicationsPerUser) {
    throw new Error(
      `Too many listings (max ${LIMITS.maxApplicationsPerUser} per account). Delete some before adding more.`
    );
  }
}

export function assertCsvByteSize(bytes: number): void {
  if (bytes > LIMITS.maxCsvBytes) {
    throw new Error('CSV file is too large (max 512 KB).');
  }
}

/**
 * Map Postgres / PostgREST constraint text to the same messages the
 * client validator uses. Unknown messages pass through unchanged.
 */
export function mapDatabaseError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('too many listings')) {
    return `Too many listings (max ${LIMITS.maxApplicationsPerUser} per account). Delete some before adding more.`;
  }
  if (lower.includes('too many listing writes')) {
    return 'Too many listing writes in a short time. Try again in a few minutes.';
  }
  if (lower.includes('applications_company_len')) {
    return `Company must be at most ${LIMITS.maxCompanyLength} characters.`;
  }
  if (lower.includes('applications_title_len')) {
    return `Title must be at most ${LIMITS.maxTitleLength} characters.`;
  }
  if (lower.includes('applications_date_applied_fmt')) {
    return 'Date Applied must be a valid date in YYYY-MM-DD format.';
  }
  if (lower.includes('applications_posting_url')) {
    return `Posting URL must be a valid http or https URL (max ${LIMITS.maxPostingUrlLength} characters).`;
  }
  if (lower.includes('check constraint')) {
    return 'That listing is too large or in the wrong format.';
  }
  return message;
}
