/**
 * Write dist/config.json from GitHub Actions secrets so the publishable key
 * is not committed. Secret keys are rejected.
 *
 * Accepted secret names (first match wins):
 *   SUPABASE_URL or VITE_SUPABASE_URL
 *   SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_PUBLISHABLE_KEY
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function first(...values) {
  for (const value of values) {
    const trimmed = (value ?? '').trim();
    if (trimmed) return trimmed;
  }
  return '';
}

const url = first(process.env.SUPABASE_URL, process.env.VITE_SUPABASE_URL).replace(/\/$/, '');
const publishableKey = first(
  process.env.SUPABASE_PUBLISHABLE_KEY,
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY
);

if (!url || !publishableKey) {
  console.error(`
Missing GitHub Actions secrets. The live site cannot sign in without them.

Add repository secrets (Settings → Secrets and variables → Actions):
  SUPABASE_URL                 https://YOUR_PROJECT.supabase.co
  SUPABASE_PUBLISHABLE_KEY     sb_publishable_...

If the job uses the github-pages environment, also add the same names under
Settings → Environments → github-pages → Environment secrets.

Then re-run the "pages" workflow (Actions → pages → Run workflow).
`);
  process.exit(1);
}

if (!url.startsWith('https://')) {
  console.error('SUPABASE_URL must be an https project URL.');
  process.exit(1);
}
if (!publishableKey.startsWith('sb_publishable_')) {
  console.error(
    'SUPABASE_PUBLISHABLE_KEY must start with sb_publishable_. Do not use a secret or legacy JWT key.'
  );
  process.exit(1);
}

mkdirSync('dist', { recursive: true });
const dest = join('dist', 'config.json');
writeFileSync(dest, JSON.stringify({ url, publishableKey }, null, 2) + '\n');
console.log('Wrote', dest);
