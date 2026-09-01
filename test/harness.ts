/**
 * In-memory Storage stand-in for tests. The real app uses window.localStorage.
 */
import type { KeyValueStorage } from '../src/lib/store';
import { STORAGE_KEY } from '../src/lib/types';

export function createMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key: string, value: string) {
      data[key] = String(value);
    }
  };
}

export function storedRows(storage: KeyValueStorage) {
  const raw = storage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

export const HEADER_ROW = ['Company', 'Title', 'Date Applied', 'Received Offer'];
