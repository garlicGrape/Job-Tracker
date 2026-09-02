import { STORAGE_KEY, type Application, type ApplicationInput, type ApplicationStatus } from './types';
import { createApplication, isApplicationStatus, isValidHttpUrl, resolveStatus } from './applications';

export type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/**
 * What may be on disk: the current shape, plus older records that carried a
 * `receivedOffer` boolean instead of `status` and/or no `postingUrl`.
 */
type StoredApplication = Omit<Application, 'postingUrl' | 'status'> & {
  postingUrl?: string;
  status?: string;
  receivedOffer?: boolean;
};

function isApplicationRecord(value: unknown): value is StoredApplication {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.id === 'string' &&
    typeof rec.company === 'string' &&
    typeof rec.title === 'string' &&
    typeof rec.dateApplied === 'string' &&
    (rec.status === undefined || typeof rec.status === 'string') &&
    (rec.receivedOffer === undefined || typeof rec.receivedOffer === 'boolean') &&
    (rec.status !== undefined || rec.receivedOffer !== undefined) &&
    (rec.postingUrl === undefined || typeof rec.postingUrl === 'string')
  );
}

function upgradeRecord(app: StoredApplication): Application {
  const postingUrl = app.postingUrl ?? '';
  const status: ApplicationStatus = isApplicationStatus(app.status)
    ? app.status
    : app.receivedOffer
      ? 'offer'
      : 'applied';
  return {
    id: app.id,
    company: app.company,
    title: app.title,
    dateApplied: app.dateApplied,
    status,
    postingUrl: isValidHttpUrl(postingUrl) ? postingUrl : ''
  };
}

export function getApplications(storage: KeyValueStorage): Application[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isApplicationRecord).map(upgradeRecord);
  } catch {
    return [];
  }
}

function persist(storage: KeyValueStorage, apps: Application[]): Application[] {
  storage.setItem(STORAGE_KEY, JSON.stringify(apps));
  return apps;
}

/**
 * Append a new application. Returns the full list, newest last.
 */
export function addApplication(
  storage: KeyValueStorage,
  app: ApplicationInput
): Application[] {
  const next = [...getApplications(storage), createApplication(app)];
  return persist(storage, next);
}

/**
 * Replace the fields of an existing application, keeping its id.
 */
export function updateApplication(
  storage: KeyValueStorage,
  id: string,
  app: ApplicationInput
): Application[] {
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid application id.');
  }
  const apps = getApplications(storage);
  const idx = apps.findIndex((a) => a.id === id);
  if (idx < 0) {
    throw new Error('Application not found.');
  }
  const updated = createApplication(app, id);
  const next = apps.map((a, i) => (i === idx ? updated : a));
  return persist(storage, next);
}

/**
 * Remove an application by id. Returns the remaining list.
 */
export function removeApplication(storage: KeyValueStorage, id: string): Application[] {
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid application id.');
  }
  const apps = getApplications(storage);
  const idx = apps.findIndex((a) => a.id === id);
  if (idx < 0) {
    throw new Error('Application not found.');
  }
  return persist(
    storage,
    apps.filter((a) => a.id !== id)
  );
}

/**
 * Move one application to a new pipeline stage (applied, interviewing,
 * offer, rejected). Accepts the same spellings the form and CSV do.
 */
export function setStatus(
  storage: KeyValueStorage,
  id: string,
  status: unknown
): Application[] {
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid application id.');
  }
  const next = resolveStatus(status);
  const apps = getApplications(storage);
  const idx = apps.findIndex((a) => a.id === id);
  if (idx < 0) {
    throw new Error('Application not found.');
  }
  return persist(
    storage,
    apps.map((a, i) => (i === idx ? { ...a, status: next } : a))
  );
}

/**
 * Replace the entire list (used by CSV import).
 */
export function replaceApplications(
  storage: KeyValueStorage,
  apps: Application[]
): Application[] {
  return persist(storage, apps);
}
