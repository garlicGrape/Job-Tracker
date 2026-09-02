/**
 * Account + listings API backed by Supabase (Postgres + Auth).
 * Framework-free: pass a Supabase client. Tests pass a fake client.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  LIMITS,
  assertWriteBatchSize,
  createApplication,
  isApplicationStatus,
  mapDatabaseError,
  resolveStatus
} from './applications';
import type { Application, ApplicationInput, ApplicationStatus } from './types';

export type PublicUser = {
  id: string;
  email: string;
};

export type AccountApi = {
  signUp(email: string, password: string): Promise<PublicUser>;
  signIn(email: string, password: string): Promise<PublicUser>;
  signOut(): Promise<void>;
  restore(): Promise<PublicUser | null>;
  list(): Promise<Application[]>;
  add(input: ApplicationInput): Promise<Application[]>;
  addMany(apps: Application[]): Promise<Application[]>;
  update(id: string, input: ApplicationInput): Promise<Application[]>;
  remove(id: string): Promise<Application[]>;
  /** Move one listing to a new pipeline stage without touching other fields. */
  setStatus(id: string, status: ApplicationStatus): Promise<Application[]>;
};

export type ApplicationRow = {
  id: string;
  user_id: string;
  company: string;
  title: string;
  date_applied: string;
  status: string;
  posting_url: string | null;
};

export function fromRow(row: ApplicationRow): Application {
  return {
    id: row.id,
    company: row.company,
    title: row.title,
    dateApplied: row.date_applied,
    status: isApplicationStatus(row.status) ? row.status : 'applied',
    postingUrl: row.posting_url ?? ''
  };
}

export function toRow(userId: string, app: Application): ApplicationRow {
  return {
    id: app.id,
    user_id: userId,
    company: app.company,
    title: app.title,
    date_applied: app.dateApplied,
    status: app.status,
    posting_url: app.postingUrl
  };
}

function throwOn(error: { message: string } | null): void {
  if (error) {
    throw new Error(mapDatabaseError(error.message));
  }
}

export function createAccountApiFromConfig(config: {
  url: string;
  publishableKey: string;
}): AccountApi {
  return createSupabaseAccountApi(createClient(config.url, config.publishableKey));
}

export function createSupabaseAccountApi(client: SupabaseClient): AccountApi {
  async function requireUser(): Promise<PublicUser> {
    const { data, error } = await client.auth.getUser();
    throwOn(error);
    const user = data.user;
    if (!user?.email) {
      throw new Error('Sign in to continue.');
    }
    return { id: user.id, email: user.email };
  }

  /**
   * Read every listing for the signed-in account. PostgREST caps a single
   * response, so an unlimited account has to be walked page by page. The
   * secondary sort on id keeps page boundaries stable when many listings
   * share a date.
   */
  async function list(): Promise<Application[]> {
    const all: Application[] = [];
    for (let from = 0; ; from += LIMITS.pageSize) {
      const { data, error } = await client
        .from('applications')
        .select('id,company,title,date_applied,status,posting_url')
        .order('date_applied', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + LIMITS.pageSize - 1);
      throwOn(error);
      const page = (data ?? []) as ApplicationRow[];
      for (const row of page) {
        all.push(fromRow(row));
      }
      if (page.length < LIMITS.pageSize) {
        return all;
      }
    }
  }

  return {
    async signUp(email, password) {
      const { data, error } = await client.auth.signUp({ email, password });
      throwOn(error);
      if (!data.session || !data.user?.email) {
        throw new Error('Account created. Confirm your email, then sign in.');
      }
      return { id: data.user.id, email: data.user.email };
    },

    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      throwOn(error);
      if (!data.user?.email) {
        throw new Error('Sign in to continue.');
      }
      return { id: data.user.id, email: data.user.email };
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      throwOn(error);
    },

    async restore() {
      const { data, error } = await client.auth.getSession();
      throwOn(error);
      const user = data.session?.user;
      if (!user?.email) return null;
      return { id: user.id, email: user.email };
    },

    list,

    async add(input) {
      const user = await requireUser();
      const app = createApplication(input);
      const { error } = await client.from('applications').insert(toRow(user.id, app));
      throwOn(error);
      return list();
    },

    /**
     * Append a batch (CSV import). One statement, so it is one write against
     * the rate limit and it never deletes anything the account already has.
     */
    async addMany(apps) {
      const user = await requireUser();
      assertWriteBatchSize(apps.length);
      if (apps.length === 0) {
        return list();
      }
      const rows = apps.map((app) => toRow(user.id, createApplication(app, app.id)));
      const { error } = await client.from('applications').insert(rows);
      throwOn(error);
      return list();
    },

    async update(id, input) {
      await requireUser();
      const app = createApplication(input, id);
      const { error } = await client
        .from('applications')
        .update({
          company: app.company,
          title: app.title,
          date_applied: app.dateApplied,
          status: app.status,
          posting_url: app.postingUrl
        })
        .eq('id', id);
      throwOn(error);
      return list();
    },

    async remove(id) {
      await requireUser();
      if (!id || typeof id !== 'string') {
        throw new Error('Invalid application id.');
      }
      const { error } = await client.from('applications').delete().eq('id', id);
      throwOn(error);
      return list();
    },

    async setStatus(id, status) {
      await requireUser();
      if (!id || typeof id !== 'string') {
        throw new Error('Invalid application id.');
      }
      const next = resolveStatus(status);
      const { error } = await client
        .from('applications')
        .update({ status: next })
        .eq('id', id);
      throwOn(error);
      return list();
    }
  };
}
