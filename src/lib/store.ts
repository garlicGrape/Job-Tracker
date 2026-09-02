import { STORAGE_KEY, type Application, type ApplicationInput, type ApplicationStatus } from './types';
import { createApplication, isValidHttpUrl, normalizeStatus, toBoolean } from './applications';

export type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type StoredApplication = Omit<Application, 'postingUrl' | 'status' | 'receivedOffer'> & {
  postingUrl?: string;
  status?: unknown;
  receivedOffer?: unknown;
};

function isApplicationRecord(value: unknown): value is StoredApplication {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.id === 'string' &&
    typeof rec.company === 'string' &&
    typeof rec.title === 'string' &&
    typeof rec.dateApplied === 'string' &&
    (typeof rec.receivedOffer === 'boolean' || typeof rec.status === 'string') &&
    (rec.postingUrl === undefined || typeof rec.postingUrl === 'string')
  );
}

/**
 * Fill in fields added after a record was written: `postingUrl` and, later,
 * `status`. A record saved before stages existed is "offer" when its old
 * offer flag was set and "applied" otherwise.
 */
function normalizeStored(app: StoredApplication): Application {
  const postingUrl = app.postingUrl ?? '';
  const status = normalizeStatus(app.status, toBoolean(app.receivedOffer) ? 'offer' : 'applied');
  return {
    ...app,
    status,
    receivedOffer: status === 'offer',
    postingUrl: isValidHttpUrl(postingUrl) ? postingUrl : ''
  };
}

export function getApplications(storage: KeyValueStorage): Application[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isApplicationRecord).map(normalizeStored);
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
 * Move one application to a different pipeline stage.
 */
export function setStatus(
  storage: KeyValueStorage,
  id: string,
  status: ApplicationStatus
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
    i === idx ? { ...a, status, receivedOffer: status === 'offer' } : a
  );
  return persist(storage, next);
}

/**
 * Toggle the "Received Offer" flag for a specific application id. Kept as a
 * shorthand for the offer stage; clearing it returns the row to "applied".
 */
export function setOffer(
  storage: KeyValueStorage,
  id: string,
  received: unknown
): Application[] {
  return setStatus(storage, id, toBoolean(received) ? 'offer' : 'applied');
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
