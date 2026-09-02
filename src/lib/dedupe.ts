/**
 * Duplicate detection for listings.
 *
 * Two listings are the same application when they name the same company and
 * title on the same day. Applying to one role again months later is a real
 * second application, so the date belongs in the key rather than out of it.
 *
 * Framework-free and non-mutating, like the rest of src/lib.
 */
import type { Application, ApplicationInput } from './types';

/** Joins key parts. No typed value contains it, so parts cannot run together. */
const SEPARATOR = '\u0000';

/**
 * Fold a value the way a person compares two listings: neither case nor a
 * doubled space makes "Acme  Corp" a different company from "acme corp".
 */
function fold(value: unknown): string {
  return (value == null ? '' : String(value)).trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Key that identifies one application: the fields a person would use to say
 * "I already logged that". The parts are joined on NUL, which no typed value
 * contains, so "Acme Inc" / "Engineer" cannot collide with "Acme" / "Inc
 * Engineer" the way any printable separator would let them.
 */
export function duplicateKey(
  app: Pick<Application, 'company' | 'title' | 'dateApplied'>
): string {
  return [fold(app.company), fold(app.title), fold(app.dateApplied)].join(SEPARATOR);
}

/** The same key, read from unvalidated form input. */
export function inputDuplicateKey(input: ApplicationInput): string {
  return [fold(input.company), fold(input.title), fold(input.dateApplied)].join(SEPARATOR);
}

/**
 * The first listing that is the same application as `input`, or null. Pass
 * `ignoreId` while editing so a row cannot match itself.
 */
export function findDuplicate(
  apps: Application[],
  input: ApplicationInput,
  ignoreId: string | null = null
): Application | null {
  const key = inputDuplicateKey(input);
  return apps.find((app) => app.id !== ignoreId && duplicateKey(app) === key) ?? null;
}

export type ImportPlan = {
  /** Rows worth writing: new to the account and not repeated in the file. */
  fresh: Application[];
  /** Rows the account already holds. */
  existingDuplicates: number;
  /** Rows the file itself repeats. */
  fileDuplicates: number;
  /** Everything left out, whichever reason. */
  skipped: number;
};

/**
 * Decide what an import should actually write. Re-importing a CSV this app
 * exported is the ordinary case, and without this it doubles every listing:
 * parsed rows always carry fresh ids, so the primary key never catches it.
 */
export function planImport(incoming: Application[], existing: Application[]): ImportPlan {
  const held = new Set(existing.map(duplicateKey));
  const seen = new Set<string>();
  const fresh: Application[] = [];
  let existingDuplicates = 0;
  let fileDuplicates = 0;

  for (const app of incoming) {
    const key = duplicateKey(app);
    if (held.has(key)) {
      existingDuplicates += 1;
      continue;
    }
    if (seen.has(key)) {
      fileDuplicates += 1;
      continue;
    }
    seen.add(key);
    fresh.push(app);
  }

  return {
    fresh,
    existingDuplicates,
    fileDuplicates,
    skipped: existingDuplicates + fileDuplicates
  };
}
