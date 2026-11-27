// Runs on Netlify at deploy time: writes public/js/config.js from environment
// variables so you never have to commit keys. Locally, with no env vars set,
// it leaves the file untouched (the app runs in demo mode).
import { writeFileSync } from 'node:fs';

const { SUPABASE_URL = 'https://cpdjiwolgzusshbsadvd.supabase.co', SUPABASE_ANON_KEY = 'sb_publishable_Gn-nH2J0skLks_ID0ohBPQ_6RzTdSrP', VAPID_PUBLIC_KEY = 'Medramy12345*-' } = process.env;

NEXT_PUBLIC_SUPABASE_URL=https://cpdjiwolgzusshbsadvd.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_Gn-nH2J0skLks_ID0ohBPQ_6RzTdSrP

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.log('build-config: SUPABASE_URL / SUPABASE_ANON_KEY not set — keeping existing public/js/config.js');
  process.exit(0);
}

const out = `// Generated at build time by scripts/build-config.mjs — do not edit on Netlify.
export default ${JSON.stringify({ SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY }, null, 2)};
`;
writeFileSync(new URL('../public/js/config.js', import.meta.url), out);
console.log('build-config: wrote public/js/config.js', VAPID_PUBLIC_KEY ? '(with push key)' : '(no push key)');
