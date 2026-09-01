/**
 * Passphrase-encrypted persistence. The ciphertext lives in the same
 * KeyValueStorage the rest of the app uses; the passphrase never does.
 *
 * Framework-free so Vitest can import it from Node. Uses Web Crypto
 * (globalThis.crypto.subtle), not window.
 */
import type { Application } from './types';
import { STORAGE_KEY } from './types';
import { createApplication } from './applications';
import type { KeyValueStorage } from './store';

export const DEFAULT_PBKDF2_ITERATIONS = 210_000;
export const MIN_PASSPHRASE_LENGTH = 8;

export type StorageKind = 'empty' | 'plaintext' | 'vault';

export type VaultEnvelope = {
  v: 1;
  kdf: 'PBKDF2';
  hash: 'SHA-256';
  iter: number;
  salt: string;
  iv: string;
  ciphertext: string;
};

export type VaultOptions = {
  iterations?: number;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function isVaultEnvelope(value: unknown): value is VaultEnvelope {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return (
    rec.v === 1 &&
    rec.kdf === 'PBKDF2' &&
    rec.hash === 'SHA-256' &&
    typeof rec.iter === 'number' &&
    rec.iter > 0 &&
    typeof rec.salt === 'string' &&
    typeof rec.iv === 'string' &&
    typeof rec.ciphertext === 'string'
  );
}

export function inspectStorage(storage: KeyValueStorage): StorageKind {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return 'empty';
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isVaultEnvelope(parsed)) return 'vault';
    if (Array.isArray(parsed)) return 'plaintext';
    return 'empty';
  } catch {
    return 'empty';
  }
}

export function validatePassphrase(passphrase: unknown): string {
  if (typeof passphrase !== 'string') {
    throw new Error('Passphrase is required.');
  }
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
  }
  return passphrase;
}

/**
 * Encrypt the application list and replace whatever is currently stored.
 * The passphrase is used to derive a key and is not written to storage.
 */
export async function lockApplications(
  storage: KeyValueStorage,
  passphrase: string,
  apps: Application[],
  options: VaultOptions = {}
): Promise<void> {
  const secret = validatePassphrase(passphrase);
  const iterations = options.iterations ?? DEFAULT_PBKDF2_ITERATIONS;
  const envelope = await encryptJson(JSON.stringify(apps), secret, iterations);
  storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
}

/**
 * Decrypt the vault. Throws if the passphrase is wrong or storage is not a vault.
 */
export async function unlockApplications(
  storage: KeyValueStorage,
  passphrase: string
): Promise<Application[]> {
  const secret = validatePassphrase(passphrase);
  const envelope = readEnvelope(storage);
  const plaintext = await decryptJson(envelope, secret);
  return applicationsFromPlaintext(plaintext);
}

/**
 * Re-encrypt the current list with the same passphrase (new salt and IV).
 */
export async function persistLocked(
  storage: KeyValueStorage,
  passphrase: string,
  apps: Application[],
  options: VaultOptions = {}
): Promise<void> {
  const existing = readEnvelope(storage);
  const iterations = options.iterations ?? existing.iter;
  await lockApplications(storage, passphrase, apps, { iterations });
}

/**
 * Delete the vault (and any plaintext list). Irreversible without a CSV backup.
 */
export function wipeVault(storage: KeyValueStorage): void {
  storage.setItem(STORAGE_KEY, '');
}

function readEnvelope(storage: KeyValueStorage): VaultEnvelope {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) {
    throw new Error('No encrypted applications found.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('No encrypted applications found.');
  }
  if (!isVaultEnvelope(parsed)) {
    throw new Error('Applications are not encrypted yet.');
  }
  return parsed;
}

function applicationsFromPlaintext(plaintext: string): Application[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new Error('Could not read encrypted applications.');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Could not read encrypted applications.');
  }
  const apps: Application[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== 'string') continue;
    try {
      apps.push(
        createApplication(
          {
            company: rec.company,
            title: rec.title,
            dateApplied: rec.dateApplied,
            receivedOffer: rec.receivedOffer,
            postingUrl: rec.postingUrl
          },
          rec.id
        )
      );
    } catch {
      // Skip rows that fail the same validation the form uses.
    }
  }
  return apps;
}

function getSubtle(): SubtleCrypto {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || !cryptoObj.subtle) {
    throw new Error('Web Crypto is not available.');
  }
  return cryptoObj.subtle;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const subtle = getSubtle();
  const material = await subtle.importKey(
    'raw',
    textEncoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256'
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptJson(
  plaintext: string,
  passphrase: string,
  iterations: number
): Promise<VaultEnvelope> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(passphrase, salt, iterations);
  const cipherBuf = await getSubtle().encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    textEncoder.encode(plaintext)
  );
  return {
    v: 1,
    kdf: 'PBKDF2',
    hash: 'SHA-256',
    iter: iterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipherBuf))
  };
}

async function decryptJson(envelope: VaultEnvelope, passphrase: string): Promise<string> {
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  const key = await deriveKey(passphrase, salt, envelope.iter);
  try {
    const plainBuf = await getSubtle().decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ciphertext as BufferSource
    );
    return textDecoder.decode(plainBuf);
  } catch {
    throw new Error('Wrong passphrase.');
  }
}
