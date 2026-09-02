/**
 * In-memory stand-in for a Supabase project: Auth plus the `applications`
 * table, including the parts of supabase/schema.sql that the client relies on
 * (row-level security, field CHECKs, the offer/stage mirror, and the
 * write-rate trigger). Tests never touch a live project.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApplicationRow } from '../src/lib/supabase-account';
import { LIMITS } from '../src/lib/applications';
import { STATUSES } from '../src/lib/types';

type FakeUser = { id: string; email: string; password: string };

export function createFakeSupabase() {
  const users: FakeUser[] = [];
  const rows: ApplicationRow[] = [];
  let current: FakeUser | null = null;
  let idSeq = 0;
  let rowsThisHour = 0;

  function constraintError(row: ApplicationRow): string | null {
    if (row.company.length < 1 || row.company.length > LIMITS.maxCompanyLength) {
      return 'new row for relation "applications" violates check constraint "applications_company_len"';
    }
    if (row.title.length < 1 || row.title.length > LIMITS.maxTitleLength) {
      return 'new row for relation "applications" violates check constraint "applications_title_len"';
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date_applied)) {
      return 'new row for relation "applications" violates check constraint "applications_date_applied_fmt"';
    }
    if (!(STATUSES as readonly string[]).includes(String(row.status))) {
      return 'new row for relation "applications" violates check constraint "applications_status_valid"';
    }
    if (Boolean(row.received_offer) !== (row.status === 'offer')) {
      return 'new row for relation "applications" violates check constraint "applications_offer_matches_stage"';
    }
    const url = row.posting_url ?? '';
    if (url.length > LIMITS.maxPostingUrlLength) {
      return 'new row for relation "applications" violates check constraint "applications_posting_url_len"';
    }
    if (url !== '' && !/^https?:\/\//i.test(url)) {
      return 'new row for relation "applications" violates check constraint "applications_posting_url_http"';
    }
    return null;
  }

  function authUser() {
    return current ? { id: current.id, email: current.email } : null;
  }

  function visible() {
    if (!current) return [];
    return rows.filter((r) => r.user_id === current!.id);
  }

  /**
   * Stands in for the applications_write_rate trigger: bounds rows per
   * statement and rows per rolling hour. There is no total-row ceiling.
   */
  function tryInsert(batch: ApplicationRow[]) {
    if (!current) {
      return { data: null, error: { message: 'Sign in to continue.' } };
    }
    for (const row of batch) {
      if (row.user_id !== current.id) {
        return { data: null, error: { message: 'row-level security violation' } };
      }
      const constraint = constraintError(row);
      if (constraint) {
        return { data: null, error: { message: constraint } };
      }
    }
    if (batch.length > LIMITS.maxRowsPerWrite) {
      return {
        data: null,
        error: {
          message: `Too many listings in one write (max ${LIMITS.maxRowsPerWrite}). Split the import into smaller files.`
        }
      };
    }
    if (rowsThisHour + batch.length > LIMITS.maxRowsPerHour) {
      return {
        data: null,
        error: { message: 'Too many listings added in the past hour. Try again later.' }
      };
    }
    rowsThisHour += batch.length;
    rows.push(...batch);
    return { data: null, error: null };
  }

  const from = () => {
    const state: {
      filters: Array<[string, string]>;
      action: 'select' | 'insert' | 'update' | 'delete';
      payload: unknown;
      range: [number, number] | null;
    } = { filters: [], action: 'select', payload: null, range: null };

    const builder = {
      select() {
        state.action = 'select';
        return builder;
      },
      insert(payload: ApplicationRow | ApplicationRow[]) {
        state.action = 'insert';
        state.payload = payload;
        return Promise.resolve(run());
      },
      update(payload: Partial<ApplicationRow>) {
        state.action = 'update';
        state.payload = payload;
        return builder;
      },
      delete() {
        state.action = 'delete';
        return builder;
      },
      eq(column: string, value: string) {
        state.filters.push([column, value]);
        return builder;
      },
      order() {
        return builder;
      },
      // PostgREST caps a single response, so reads are paged.
      range(from: number, to: number) {
        state.range = [from, to];
        return Promise.resolve(run());
      },
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve);
      }
    };

    function run() {
      if (!current && state.action !== 'select') {
        return { data: null, error: { message: 'Sign in to continue.' } };
      }
      if (state.action === 'insert') {
        const batch = Array.isArray(state.payload) ? state.payload : [state.payload];
        return tryInsert(batch as ApplicationRow[]);
      }
      if (state.action === 'update') {
        const patch = state.payload as Partial<ApplicationRow>;
        const matched: ApplicationRow[] = [];
        for (const row of rows) {
          if (row.user_id !== current!.id) continue;
          const ok = state.filters.every(([col, val]) => (row as Record<string, unknown>)[col] === val);
          if (ok) matched.push(row);
        }
        for (const row of matched) {
          const constraint = constraintError({ ...row, ...patch });
          if (constraint) {
            return { data: null, error: { message: constraint } };
          }
        }
        for (const row of matched) {
          Object.assign(row, patch);
        }
        return { data: null, error: null };
      }
      if (state.action === 'delete') {
        for (let i = rows.length - 1; i >= 0; i--) {
          const row = rows[i];
          if (row.user_id !== current!.id) continue;
          const ok = state.filters.every(([col, val]) => (row as Record<string, unknown>)[col] === val);
          if (ok) rows.splice(i, 1);
        }
        return { data: null, error: null };
      }
      const sorted = visible().sort(
        (a, b) => a.date_applied.localeCompare(b.date_applied) || a.id.localeCompare(b.id)
      );
      if (!state.range) {
        return { data: sorted, error: null };
      }
      const [from, to] = state.range;
      return { data: sorted.slice(from, to + 1), error: null };
    }

    return builder;
  };

  const client = {
    auth: {
      async signUp({ email, password }: { email: string; password: string }) {
        if (users.some((u) => u.email === email.toLowerCase())) {
          return { data: { user: null, session: null }, error: { message: 'User already registered' } };
        }
        const user: FakeUser = { id: 'user-' + ++idSeq, email: email.toLowerCase(), password };
        users.push(user);
        current = user;
        const session = { user: authUser() };
        return { data: { user: authUser(), session }, error: null };
      },
      async signInWithPassword({ email, password }: { email: string; password: string }) {
        const user = users.find((u) => u.email === email.toLowerCase() && u.password === password);
        if (!user) {
          return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
        }
        current = user;
        return { data: { user: authUser(), session: { user: authUser() } }, error: null };
      },
      async signOut() {
        current = null;
        return { error: null };
      },
      async getUser() {
        if (!current) return { data: { user: null }, error: { message: 'Auth session missing!' } };
        return { data: { user: authUser() }, error: null };
      },
      async getSession() {
        if (!current) return { data: { session: null }, error: null };
        return { data: { session: { user: authUser() } }, error: null };
      }
    },
    from(_table: string) {
      return from();
    }
  };

  return client as unknown as SupabaseClient;
}
