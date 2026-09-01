import { describe, it, expect } from 'vitest';
import { addApplication, getApplications } from '../src/lib/store';
import {
  inspectStorage,
  lockApplications,
  persistLocked,
  unlockApplications,
  wipeVault
} from '../src/lib/vault';
import { STORAGE_KEY } from '../src/lib/types';
import { createMemoryStorage, storedRows } from './harness';

const FAST = { iterations: 10_000 };
const PASS = 'correct-horse';
const SAMPLE = {
  company: 'SecretCo',
  title: 'Staff Engineer',
  dateApplied: '2026-09-01',
  receivedOffer: false,
  postingUrl: 'https://jobs.example.com/role'
};

describe('inspectStorage', () => {
  it('reports empty when nothing is stored', () => {
    expect(inspectStorage(createMemoryStorage())).toBe('empty');
  });

  it('reports plaintext for a JSON application list', () => {
    const storage = createMemoryStorage();
    addApplication(storage, SAMPLE);
    expect(inspectStorage(storage)).toBe('plaintext');
  });

  it('reports vault after lockApplications', async () => {
    const storage = createMemoryStorage();
    const apps = addApplication(storage, SAMPLE);
    await lockApplications(storage, PASS, apps, FAST);
    expect(inspectStorage(storage)).toBe('vault');
  });
});

describe('encrypted vault', () => {
  it('round-trips applications with a passphrase', async () => {
    const storage = createMemoryStorage();
    const apps = addApplication(storage, SAMPLE);
    await lockApplications(storage, PASS, apps, FAST);
    const unlocked = await unlockApplications(storage, PASS);
    expect(unlocked).toHaveLength(1);
    expect(unlocked[0]).toMatchObject({
      company: 'SecretCo',
      title: 'Staff Engineer',
      dateApplied: '2026-09-01',
      receivedOffer: false,
      postingUrl: 'https://jobs.example.com/role'
    });
    expect(unlocked[0].id).toBe(apps[0].id);
  });

  it('does not write the company name or passphrase in plaintext', async () => {
    const storage = createMemoryStorage();
    const apps = addApplication(storage, SAMPLE);
    await lockApplications(storage, PASS, apps, FAST);
    const raw = storage.getItem(STORAGE_KEY) ?? '';
    expect(raw).not.toContain('SecretCo');
    expect(raw).not.toContain('Staff Engineer');
    expect(raw).not.toContain(PASS);
    expect(raw).toContain('"kdf":"PBKDF2"');
  });

  it('keeps dates as YYYY-MM-DD strings after unlock', async () => {
    const storage = createMemoryStorage();
    const apps = addApplication(storage, SAMPLE);
    await lockApplications(storage, PASS, apps, FAST);
    const unlocked = await unlockApplications(storage, PASS);
    expect(typeof unlocked[0].dateApplied).toBe('string');
    expect(unlocked[0].dateApplied).toBe('2026-09-01');
  });

  it('rejects the wrong passphrase without revealing the list', async () => {
    const storage = createMemoryStorage();
    const apps = addApplication(storage, SAMPLE);
    await lockApplications(storage, PASS, apps, FAST);
    await expect(unlockApplications(storage, 'wrong-pass')).rejects.toThrow(/wrong passphrase/i);
    expect(inspectStorage(storage)).toBe('vault');
  });

  it('rejects a short passphrase', async () => {
    const storage = createMemoryStorage();
    await expect(lockApplications(storage, 'short', [], FAST)).rejects.toThrow(/at least 8/i);
  });

  it('migrates an existing plaintext list into the vault', async () => {
    const storage = createMemoryStorage();
    addApplication(storage, SAMPLE);
    const existing = getApplications(storage);
    expect(inspectStorage(storage)).toBe('plaintext');
    await lockApplications(storage, PASS, existing, FAST);
    expect(inspectStorage(storage)).toBe('vault');
    const unlocked = await unlockApplications(storage, PASS);
    expect(unlocked.map((a) => a.company)).toEqual(['SecretCo']);
  });

  it('persistLocked updates the ciphertext and still unlocks', async () => {
    const storage = createMemoryStorage();
    const apps = addApplication(storage, SAMPLE);
    await lockApplications(storage, PASS, apps, FAST);
    const next = addApplication(createMemoryStorage(), {
      company: 'Globex',
      title: 'PM',
      dateApplied: '2026-09-02'
    });
    await persistLocked(storage, PASS, [...apps, ...next], FAST);
    const unlocked = await unlockApplications(storage, PASS);
    expect(unlocked.map((a) => a.company)).toEqual(['SecretCo', 'Globex']);
  });

  it('refuses plaintext store reads and writes while locked', async () => {
    const storage = createMemoryStorage();
    const apps = addApplication(storage, SAMPLE);
    await lockApplications(storage, PASS, apps, FAST);
    const before = storage.getItem(STORAGE_KEY);
    expect(() => getApplications(storage)).toThrow(/locked/i);
    expect(() => addApplication(storage, SAMPLE)).toThrow(/locked/i);
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
  });

  it('wipeVault clears storage so a new passphrase can be set', async () => {
    const storage = createMemoryStorage();
    const apps = addApplication(storage, SAMPLE);
    await lockApplications(storage, PASS, apps, FAST);
    wipeVault(storage);
    expect(inspectStorage(storage)).toBe('empty');
    expect(getApplications(storage)).toEqual([]);
    expect(storedRows(storage)).toEqual([]);
  });
});
