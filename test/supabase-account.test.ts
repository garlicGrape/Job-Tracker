import { describe, it, expect } from 'vitest';
import { createSupabaseAccountApi, fromRow, toRow } from '../src/lib/supabase-account';
import {
  loadSupabaseConfig,
  parsePublishableKey,
  parsePublicConfig,
  parseSupabaseUrl
} from '../src/lib/supabase-config';
import { createApplication, LIMITS, mapDatabaseError } from '../src/lib/applications';
import { createFakeSupabase } from './fake-supabase';

describe('row mapping', () => {
  it('stores dates as YYYY-MM-DD text columns, not Date objects', () => {
    const row = toRow('user-1', {
      id: 'app-1',
      company: 'Acme',
      title: 'Dev',
      dateApplied: '2026-09-01',
      status: 'applied',
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

