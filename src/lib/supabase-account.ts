/**
 * Account + listings API backed by Supabase (Postgres + Auth).
 * Framework-free: pass a Supabase client. Tests pass a fake client.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createApplication } from './applications';
import type { Application, ApplicationInput } from './types';

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
  update(id: string, input: ApplicationInput): Promise<Application[]>;
  remove(id: string): Promise<Application[]>;
  setOffer(id: string, received: boolean): Promise<Application[]>;
  replaceAll(apps: Application[]): Promise<Application[]>;
};

export type ApplicationRow = {
  id: string;
  user_id: string;
  company: string;
  title: string;
  date_applied: string;
  received_offer: boolean;
  posting_url: string | null;
};

export function fromRow(row: ApplicationRow): Application {
  return {
    id: row.id,
    company: row.company,
    title: row.title,
    dateApplied: row.date_applied,
    receivedOffer: Boolean(row.received_offer),
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
    received_offer: app.receivedOffer,
    posting_url: app.postingUrl
  };
}

function throwOn(error: { message: string } | null): void {
  if (error) {
    throw new Error(error.message);
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

  async function list(): Promise<Application[]> {
    const { data, error } = await client
      .from('applications')
      .select('id,company,title,date_applied,received_offer,posting_url')
      .order('date_applied', { ascending: true });
    throwOn(error);
    return (data ?? []).map((row) => fromRow(row as ApplicationRow));
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

    async update(id, input) {
      await requireUser();
      const app = createApplication(input, id);
      const { error } = await client
        .from('applications')
        .update({
          company: app.company,
          title: app.title,
          date_applied: app.dateApplied,
          received_offer: app.receivedOffer,
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

    async setOffer(id, received) {
      await requireUser();
      const { error } = await client
        .from('applications')
        .update({ received_offer: received })
        .eq('id', id);
      throwOn(error);
      return list();
    },

    async replaceAll(apps) {
      const user = await requireUser();
      const { error: delError } = await client.from('applications').delete().eq('user_id', user.id);
      throwOn(delError);
      if (apps.length > 0) {
        const rows = apps.map((app) => toRow(user.id, createApplication(app, app.id)));
        const { error } = await client.from('applications').insert(rows);
        throwOn(error);
      }
      return list();
    }
  };
}
