/**
 * Shared domain logic for Job Tracker.
 *
 * Framework-free so Vitest can import it directly. The React UI and any
 * Lovable restyle should call these helpers rather than reimplementing
 * validation or CSV rules.
 */
import type { Application, ApplicationInput } from './types';

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

  if (!company) {
    throw new Error('Company is required.');
  }
  if (!title) {
    throw new Error('Title is required.');
  }
  if (!isValidDate(dateApplied)) {
    throw new Error('Date Applied must be a valid date in YYYY-MM-DD format.');
  }

  return {
    company,
    title,
    dateApplied,
    receivedOffer: toBoolean(app.receivedOffer)
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
