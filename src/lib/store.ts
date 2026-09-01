import { STORAGE_KEY, type Application, type ApplicationInput } from './types';
import { createApplication, isValidHttpUrl, toBoolean } from './applications';
import { isVaultEnvelope } from './vault';

export type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/**
 * In-memory KeyValueStorage used after the vault is unlocked, so store
 * helpers stay synchronous while localStorage holds only ciphertext.
 */
export function createSessionStorage(apps: Application[] = []): KeyValueStorage {
  let serialized = JSON.stringify(apps);
  return {
    getItem(key: string) {
      return key === STORAGE_KEY ? serialized : null;
    },
    setItem(key: string, value: string) {
      if (key === STORAGE_KEY) serialized = value;
    }
  };
}

function assertUnlocked(storage: KeyValueStorage): void {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isVaultEnvelope(parsed)) {
      throw new Error('Applications are locked. Unlock with your passphrase first.');
    }
  } catch (err) {
    if (err instanceof Error && /locked/i.test(err.message)) {
      throw err;
    }
  }
}

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
  assertUnlocked(storage);
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isApplicationRecord).map(withPostingUrl);
  } catch (err) {
    if (err instanceof Error && /locked/i.test(err.message)) {
      throw err;
    }
    return [];
  }
}

function persist(storage: KeyValueStorage, apps: Application[]): Application[] {
  assertUnlocked(storage);
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
  return persist(storage, apps);
}
