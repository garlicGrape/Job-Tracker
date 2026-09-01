/**
 * Write dist/config.json from GitHub Actions secrets so the publishable key
 * is not committed. Secret keys are rejected.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const url = (process.env.SUPABASE_URL ?? '').trim().replace(/\/$/, '');
const publishableKey = (process.env.SUPABASE_PUBLISHABLE_KEY ?? '').trim();

if (!url && !publishableKey) {
  console.log('No SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY — skipping runtime config.');
  process.exit(0);
}

if (!url.startsWith('https://')) {
  console.error('SUPABASE_URL must be an https project URL.');
  process.exit(1);
}
if (!publishableKey.startsWith('sb_publishable_')) {
  console.error('SUPABASE_PUBLISHABLE_KEY must start with sb_publishable_. Do not use a secret or legacy JWT key.');
  process.exit(1);
}

mkdirSync('dist', { recursive: true });
const dest = join('dist', 'config.json');
writeFileSync(dest, JSON.stringify({ url, publishableKey }, null, 2) + '\n');
console.log('Wrote', dest);
