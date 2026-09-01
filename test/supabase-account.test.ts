import { describe, it, expect } from 'vitest';
import {
  createSupabaseAccountApi,
  fromRow,
  toRow,
  type ApplicationRow
} from '../src/lib/supabase-account';
import {
  loadSupabaseConfig,
  parsePublishableKey,
  parsePublicConfig,
  parseSupabaseUrl
} from '../src/lib/supabase-config';
import { createApplication, LIMITS, mapDatabaseError } from '../src/lib/applications';
import type { SupabaseClient } from '@supabase/supabase-js';

type FakeUser = { id: string; email: string; password: string };

function createFakeSupabase() {
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
        for (const row of rows) {
          if (row.user_id !== current!.id) continue;
          const ok = state.filters.every(([col, val]) => (row as Record<string, unknown>)[col] === val);
          if (ok) Object.assign(row, patch);
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

describe('row mapping', () => {
  it('stores dates as YYYY-MM-DD text columns, not Date objects', () => {
    const row = toRow('user-1', {
      id: 'app-1',
      company: 'Acme',
      title: 'Dev',
      dateApplied: '2026-09-01',
      receivedOffer: false,
      postingUrl: 'https://jobs.example.com/role'
    });
    expect(typeof row.date_applied).toBe('string');
    expect(row.date_applied).toBe('2026-09-01');
    expect(fromRow(row)).toMatchObject({
      company: 'Acme',
      dateApplied: '2026-09-01',
      postingUrl: 'https://jobs.example.com/role'
    });
  });
});

describe('Supabase account API', () => {
  it('lets a signed-in user persist applications across sign-out and sign-in', async () => {
    const api = createSupabaseAccountApi(createFakeSupabase());
    const me = await api.signUp('me@example.com', 'correct-horse');
    expect(me.email).toBe('me@example.com');
    await api.add({
      company: 'SecretCo',
      title: 'Staff Engineer',
      dateApplied: '2026-09-01',
      receivedOffer: true,
      postingUrl: 'https://jobs.example.com/role'
    });
    await api.signOut();
    expect(await api.restore()).toBeNull();
    await api.signIn('me@example.com', 'correct-horse');
    const list = await api.list();
    expect(list).toHaveLength(1);
    expect(list[0].company).toBe('SecretCo');
    expect(list[0].receivedOffer).toBe(true);
  });

  it('does not show another account’s listings', async () => {
    const client = createFakeSupabase();
    const api = createSupabaseAccountApi(client);
    await api.signUp('ada@example.com', 'password1');
    await api.add({ company: 'AdaCorp', title: 'PM', dateApplied: '2026-01-01' });
    await api.signOut();
    await api.signUp('bob@example.com', 'password1');
    await api.add({ company: 'BobLLC', title: 'Eng', dateApplied: '2026-02-01' });
    const bobs = await api.list();
    expect(bobs.map((a) => a.company)).toEqual(['BobLLC']);
    await api.signOut();
    await api.signIn('ada@example.com', 'password1');
    const adas = await api.list();
    expect(adas.map((a) => a.company)).toEqual(['AdaCorp']);
  });

  it('removes a listing without touching the rest of the account', async () => {
    const api = createSupabaseAccountApi(createFakeSupabase());
    await api.signUp('me@example.com', 'correct-horse');
    await api.add({ company: 'KeepCo', title: 'Eng', dateApplied: '2026-01-01' });
    await api.add({ company: 'DropCo', title: 'PM', dateApplied: '2026-02-01' });
    const before = await api.list();
    expect(before.map((a) => a.company)).toEqual(['KeepCo', 'DropCo']);
    const drop = before.find((a) => a.company === 'DropCo');
    expect(drop).toBeDefined();
    const after = await api.remove(drop!.id);
    expect(after.map((a) => a.company)).toEqual(['KeepCo']);
  });

  it('does not delete another account’s listing', async () => {
    const client = createFakeSupabase();
    const api = createSupabaseAccountApi(client);
    await api.signUp('ada@example.com', 'password1');
    await api.add({ company: 'AdaCorp', title: 'PM', dateApplied: '2026-01-01' });
    const adaList = await api.list();
    await api.signOut();
    await api.signUp('bob@example.com', 'password1');
    await api.add({ company: 'BobLLC', title: 'Eng', dateApplied: '2026-02-01' });
    await api.remove(adaList[0].id);
    const bobs = await api.list();
    expect(bobs.map((a) => a.company)).toEqual(['BobLLC']);
    await api.signOut();
    await api.signIn('ada@example.com', 'password1');
    expect((await api.list()).map((a) => a.company)).toEqual(['AdaCorp']);
  });

  it('rejects remove without a valid id', async () => {
    const api = createSupabaseAccountApi(createFakeSupabase());
    await api.signUp('me@example.com', 'correct-horse');
    await expect(api.remove('')).rejects.toThrow(/invalid application id/i);
  });

  it('rejects a wrong password', async () => {
    const api = createSupabaseAccountApi(createFakeSupabase());
    await api.signUp('me@example.com', 'correct-horse');
    await api.signOut();
    await expect(api.signIn('me@example.com', 'wrong-pass')).rejects.toThrow(/invalid login/i);
  });

  it('keeps far more listings than the old 500 ceiling and reads every page', async () => {
    const api = createSupabaseAccountApi(createFakeSupabase());
    await api.signUp('me@example.com', 'correct-horse');
    const many = Array.from({ length: 2400 }, (_, i) =>
      createApplication(
        {
          company: 'Acme ' + String(i).padStart(4, '0'),
          title: 'Dev',
          dateApplied: '2026-01-01'
        },
        `id-${String(i).padStart(4, '0')}`
      )
    );
    const stored = await api.addMany(many);
    // Larger than LIMITS.pageSize, so list() only returns this many if it
    // walked past the first page.
    expect(stored).toHaveLength(2400);
    expect(stored[0].company).toBe('Acme 0000');
    expect(stored[2399].company).toBe('Acme 2399');
    expect(new Set(stored.map((a) => a.id)).size).toBe(2400);
  });

  it('appends a CSV import instead of replacing what is already saved', async () => {
    const api = createSupabaseAccountApi(createFakeSupabase());
    await api.signUp('me@example.com', 'correct-horse');
    await api.add({ company: 'OldCo', title: 'Dev', dateApplied: '2026-01-01' });
    const imported = [
      createApplication({ company: 'NewCo', title: 'PM', dateApplied: '2026-02-01' }, 'id-new')
    ];
    const list = await api.addMany(imported);
    expect(list.map((a) => a.company)).toEqual(['OldCo', 'NewCo']);
  });

  it('rejects a single write larger than the per-statement cap', async () => {
    const api = createSupabaseAccountApi(createFakeSupabase());
    await api.signUp('me@example.com', 'correct-horse');
    await api.add({ company: 'KeepMe', title: 'Dev', dateApplied: '2026-01-01' });
    const huge = Array.from({ length: LIMITS.maxRowsPerWrite + 1 }, (_, i) =>
      createApplication({ company: 'Acme', title: 'Dev', dateApplied: '2026-01-01' }, `big-${i}`)
    );
    await expect(api.addMany(huge)).rejects.toThrow(/in one write/i);
    expect(await api.list()).toEqual([expect.objectContaining({ company: 'KeepMe' })]);
  });

  it('rejects writes past the hourly row budget without capping the total', async () => {
    const api = createSupabaseAccountApi(createFakeSupabase());
    await api.signUp('me@example.com', 'correct-horse');
    const batches = LIMITS.maxRowsPerHour / LIMITS.maxRowsPerWrite;
    for (let b = 0; b < batches; b++) {
      const batch = Array.from({ length: LIMITS.maxRowsPerWrite }, (_, i) =>
        createApplication(
          { company: 'Acme', title: 'Dev', dateApplied: '2026-01-01' },
          `b${b}-${i}`
        )
      );
      await api.addMany(batch);
    }
    await expect(
      api.add({ company: 'OverBudget', title: 'Dev', dateApplied: '2026-01-02' })
    ).rejects.toThrow(/past hour/i);
  });

  it('maps Postgres check-constraint and rate-limit text to client messages', () => {
    expect(mapDatabaseError('new row violates check constraint "applications_company_len"')).toMatch(
      /at most 200/
    );
    expect(
      mapDatabaseError('Too many listings in one write (max 5000). Split the import into smaller files.')
    ).toMatch(/in one write/);
    expect(
      mapDatabaseError('Too many listings added in the past hour. Try again later.')
    ).toMatch(/past hour/);
    expect(mapDatabaseError('Auth session missing!')).toBe('Auth session missing!');
  });
});

describe('publishable key config', () => {
  it('accepts a publishable key and https project URL', () => {
    const config = parsePublicConfig({
      url: 'https://abcd.supabase.co/',
      publishableKey: 'sb_publishable_testkey'
    });
    expect(config.url).toBe('https://abcd.supabase.co');
    expect(config.publishableKey).toBe('sb_publishable_testkey');
    expect(parseSupabaseUrl('https://abcd.supabase.co')).toBe('https://abcd.supabase.co');
    expect(parsePublishableKey('sb_publishable_testkey')).toBe('sb_publishable_testkey');
  });

  it('rejects secret keys and legacy JWT anon keys', () => {
    expect(() => parsePublishableKey('sb_secret_nope')).toThrow(/secret key/i);
    expect(() => parsePublishableKey('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig')).toThrow(
      /legacy jwt/i
    );
    expect(() => parsePublishableKey('not-a-key')).toThrow(/sb_publishable_/);
  });

  it('loads runtime config.json and ignores missing files', async () => {
    const missing = await loadSupabaseConfig({
      fetch: async () => new Response('Not found', { status: 404 }),
      configUrl: 'https://example.test/config.json'
    });
    expect(missing).toBeNull();

    const loaded = await loadSupabaseConfig({
      fetch: async () =>
        new Response(
          JSON.stringify({
            url: 'https://abcd.supabase.co',
            publishableKey: 'sb_publishable_fromfile'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        ),
      configUrl: 'https://example.test/config.json'
    });
    expect(loaded?.publishableKey).toBe('sb_publishable_fromfile');
  });
});

