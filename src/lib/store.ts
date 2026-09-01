import { STORAGE_KEY, type Application, type ApplicationInput } from './types';
import { assertApplicationQuota, createApplication, isValidHttpUrl, toBoolean } from './applications';

export type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type StoredApplication = Omit<Application, 'postingUrl'> & { postingUrl?: string };

function isApplicationRecord(value: unknown): value is StoredApplication {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.id === 'string' &&
    typeof rec.company === 'string' &&
    typeof rec.title === 'string' &&
    typeof rec.dateApplied === 'string' &&
    typeof rec.receivedOffer === 'boolean' &&
    (rec.postingUrl === undefined || typeof rec.postingUrl === 'string')
  );
}

function withPostingUrl(app: StoredApplication): Application {
  const postingUrl = app.postingUrl ?? '';
  return {
    ...app,
    postingUrl: isValidHttpUrl(postingUrl) ? postingUrl : ''
  };
}

export function getApplications(storage: KeyValueStorage): Application[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isApplicationRecord).map(withPostingUrl);
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
  assertApplicationQuota(next.length);
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
 * Toggle the "Received Offer" flag for a specific application id.
 */
export function setOffer(
  storage: KeyValueStorage,
  id: string,
  received: unknown
): Application[] {
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid application id.');
  }
  const apps = getApplications(storage);
  const idx = apps.findIndex((a) => a.id === id);
  if (idx < 0) {
    throw new Error('Application not found.');
  }
  const next = apps.map((a, i) =>
    i === idx ? { ...a, receivedOffer: toBoolean(received) } : a
  );
  return persist(storage, next);
}

/**
 * Replace the entire list (used by CSV import).
 */
export function replaceApplications(
  storage: KeyValueStorage,
  apps: Application[]
): Application[] {
  assertApplicationQuota(apps.length);
  return persist(storage, apps);
}
