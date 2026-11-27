// Netlify Scheduled Function — runs every 5 minutes.
// For every OPEN intervention, if the owner's reminder interval has passed since
// the start (or since the last reminder), send an "Is it finished?" web-push
// notification to all of that person's phones/browsers.
//
// Needs these Netlify environment variables:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

export const config = { schedule: '*/5 * * * *' };

const fmt = (min) => {
  min = Math.round(min);
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
};

export default async () => {
  const {
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
    VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT = 'mailto:admin@example.com',
  } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.log('reminders: not configured, skipping');
    return new Response('not configured');
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: open, error } = await sb
    .from('interventions')
    .select('id, created_by, machine, station, component, type, start_time, last_reminder_at')
    .eq('status', 'open');
  if (error) { console.error(error); return new Response('error', { status: 500 }); }
  if (!open?.length) return new Response('nothing open');

  const userIds = [...new Set(open.map((i) => i.created_by).filter(Boolean))];
  const [{ data: settings }, { data: subs }] = await Promise.all([
    sb.from('user_settings').select('user_id, reminder_minutes').in('user_id', userIds),
    sb.from('push_subscriptions').select('*').in('user_id', userIds),
  ]);
  const every = new Map((settings || []).map((s) => [s.user_id, s.reminder_minutes]));
  const subsByUser = new Map();
  for (const s of subs || []) {
    if (!subsByUser.has(s.user_id)) subsByUser.set(s.user_id, []);
    subsByUser.get(s.user_id).push(s);
  }

  const now = Date.now();
  let sent = 0;
  for (const iv of open) {
    const interval = every.get(iv.created_by) ?? 15;
    if (!interval) continue;
    const last = new Date(iv.last_reminder_at || iv.start_time).getTime();
    if (now - last < interval * 60000) continue;
    const targets = subsByUser.get(iv.created_by) || [];
    if (!targets.length) continue;

    const where = [iv.machine, iv.station, iv.component].filter(Boolean).join(' · ') || 'New intervention';
    const payload = JSON.stringify({
      id: iv.id,
      title: `Still open · ${fmt((now - new Date(iv.start_time)) / 60000)}`,
      body: `${where}${iv.type ? ` (${iv.type})` : ''} — is the intervention finished?`,
    });

    // mark first so the app (if open) and this job don't both remind
    await sb.from('interventions').update({ last_reminder_at: new Date(now).toISOString() }).eq('id', iv.id);

    await Promise.all(targets.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 900, urgency: 'high' });
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await sb.from('push_subscriptions').delete().eq('id', s.id); // phone unsubscribed
        } else {
          console.error('push failed', err.statusCode, err.body);
        }
      }
    }));
  }
  console.log(`reminders: sent ${sent}`);
  return new Response(`sent ${sent}`);
};
