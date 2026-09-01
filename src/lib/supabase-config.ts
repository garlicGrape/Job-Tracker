/**
 * Public Supabase config. The publishable key is low-privilege (same as the
 * old anon key): RLS still gates every query. Secret keys (sb_secret_ / 
 * service_role) must never reach the browser.
 */
export type SupabasePublicConfig = {
  url: string;
  publishableKey: string;
};

export function parseSupabaseUrl(value: unknown): string {
  const url = (value == null ? '' : String(value)).trim().replace(/\/$/, '');
  if (!url) {
    throw new Error('Supabase project URL is missing.');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Supabase project URL is not a valid URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Supabase project URL must be https.');
  }
  return parsed.origin;
}

export function parsePublishableKey(value: unknown): string {
  const key = (value == null ? '' : String(value)).trim();
  if (!key) {
    throw new Error('Publishable key is missing.');
  }
  if (key.startsWith('sb_secret_')) {
    throw new Error('Do not put a secret key in the browser. Use the publishable key (sb_publishable_...).');
  }
  if (/service_role/i.test(key)) {
    throw new Error('Do not put a service_role key in the browser. Use the publishable key.');
  }
  if (key.startsWith('eyJ')) {
    throw new Error(
      'Legacy JWT anon/service_role keys are not used. In Supabase go to Settings → API Keys, create the new keys, and copy the publishable key (sb_publishable_...).'
    );
  }
  if (!key.startsWith('sb_publishable_')) {
    throw new Error('Expected a publishable key starting with sb_publishable_.');
  }
  return key;
}

export function parsePublicConfig(raw: unknown): SupabasePublicConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid Supabase config.');
  }
  const rec = raw as Record<string, unknown>;
  return {
    url: parseSupabaseUrl(rec.url),
    publishableKey: parsePublishableKey(rec.publishableKey ?? rec.publishable_key)
  };
}

export async function loadSupabaseConfig(options: {
  fetch: typeof fetch;
  configUrl: string;
  env?: { url?: string; publishableKey?: string };
}): Promise<SupabasePublicConfig | null> {
  const file = await readConfigFile(options.fetch, options.configUrl);
  if (file) {
    return parsePublicConfig(file);
  }
  const url = options.env?.url?.trim();
  const publishableKey = options.env?.publishableKey?.trim();
  if (!url && !publishableKey) {
    return null;
  }
  return parsePublicConfig({ url, publishableKey });
}

async function readConfigFile(fetchFn: typeof fetch, configUrl: string): Promise<unknown | null> {
  try {
    const response = await fetchFn(configUrl, { cache: 'no-store' });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error('Could not read config.json.');
    }
    return await response.json();
  } catch (err) {
    if (err instanceof Error && /config\.json/i.test(err.message)) {
      throw err;
    }
    return null;
  }
}
