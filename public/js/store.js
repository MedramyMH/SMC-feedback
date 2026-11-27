// Data layer. Two interchangeable back-ends:
//   • Supabase (shared by the whole team) when config.js has a URL + anon key
//   • Local demo (this browser only) when it does not
import config from './config.js';

export const DEMO = !(config.SUPABASE_URL && config.SUPABASE_ANON_KEY);
const BUCKET = 'photos';
const LIST_LIMIT = 3000;

const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }));

const ext = (blob) => (blob.type === 'image/png' ? 'png' : 'jpg');

/* ------------------------------------------------------------------ */
/*  Supabase back-end                                                  */
/* ------------------------------------------------------------------ */
function supabaseStore() {
  let sb = null;
  let user = null;
  const urlCache = new Map(); // path -> { url, exp }

  const client = async () => {
    if (!sb) {
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      sb = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
    }
    return sb;
  };

  const toUser = (u) =>
    u && {
      id: u.id,
      email: u.email,
      name: u.user_metadata?.name || (u.email || '').split('@')[0],
    };

  const check = ({ data, error }) => {
    if (error) throw error;
    return data;
  };

  return {
    demo: false,
    get user() { return user; },

    async init() {
      const c = await client();
      const { data } = await c.auth.getSession();
      user = toUser(data.session?.user);
      return user;
    },
    async onAuth(cb) {
      const c = await client();
      c.auth.onAuthStateChange((_evt, session) => {
        user = toUser(session?.user);
        cb(user);
      });
    },
    async signIn(email, password) {
      const c = await client();
      const data = check(await c.auth.signInWithPassword({ email, password }));
      user = toUser(data.user);
      return user;
    },
    async signUp(email, password, name) {
      const c = await client();
      const data = check(await c.auth.signUp({
        email, password,
        options: { data: { name }, emailRedirectTo: location.origin },
      }));
      user = toUser(data.session?.user || null);
      return { user, needsConfirm: !data.session };
    },
    async resetPassword(email) {
      const c = await client();
      check(await c.auth.resetPasswordForEmail(email, { redirectTo: location.origin }));
    },
    async signOut() {
      const c = await client();
      await c.auth.signOut();
      user = null;
    },
    async setName(name) {
      const c = await client();
      const data = check(await c.auth.updateUser({ data: { name } }));
      user = toUser(data.user);
      await this.saveSettings({ display_name: name });
      return user;
    },

    async list() {
      const c = await client();
      return check(
        await c.from('interventions').select('*').order('start_time', { ascending: false }).limit(LIST_LIMIT),
      );
    },
    async create(row) {
      const c = await client();
      return check(await c.from('interventions').insert({ ...row, created_by: user.id }).select().single());
    },
    async update(id, patch) {
      const c = await client();
      return check(await c.from('interventions').update(patch).eq('id', id).select().single());
    },
    async remove(id) {
      const c = await client();
      check(await c.from('interventions').delete().eq('id', id));
    },

    async uploadPhoto(blob) {
      const c = await client();
      const d = new Date();
      const path = `${user.id}/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}/${uid()}.${ext(blob)}`;
      check(await c.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false }));
      return path;
    },
    async photoUrls(paths) {
      const now = Date.now();
      const out = {};
      const missing = [];
      for (const p of new Set(paths)) {
        const hit = urlCache.get(p);
        if (hit && hit.exp > now) out[p] = hit.url;
        else missing.push(p);
      }
      if (missing.length) {
        const c = await client();
        const { data } = await c.storage.from(BUCKET).createSignedUrls(missing, 3600);
        for (const r of data || []) {
          if (r.signedUrl) {
            out[r.path] = r.signedUrl;
            urlCache.set(r.path, { url: r.signedUrl, exp: now + 50 * 60 * 1000 });
          }
        }
      }
      return out;
    },
    async deletePhotos(paths) {
      if (!paths?.length) return;
      const c = await client();
      await c.storage.from(BUCKET).remove(paths); // non-owners: silently refused by RLS
    },

    async subscribe(cb) {
      const c = await client();
      c.channel('interventions-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'interventions' }, (p) =>
          cb(p.eventType, p.new, p.old))
        .subscribe();
    },

    async getSettings() {
      const c = await client();
      const { data } = await c.from('user_settings').select('*').eq('user_id', user.id).maybeSingle();
      return data || null;
    },
    async saveSettings(patch) {
      const c = await client();
      await c.from('user_settings').upsert({ user_id: user.id, ...patch, updated_at: new Date().toISOString() });
    },
    async savePushSubscription(sub) {
      const c = await client();
      const j = sub.toJSON();
      check(await c.from('push_subscriptions').upsert(
        { user_id: user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth },
        { onConflict: 'endpoint' },
      ));
    },
    async deletePushSubscription(endpoint) {
      const c = await client();
      await c.from('push_subscriptions').delete().eq('endpoint', endpoint);
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Local demo back-end (localStorage + IndexedDB for photos)          */
/* ------------------------------------------------------------------ */
function localStore() {
  const KEY = 'smc_demo_interventions';
  const listeners = [];
  const objectUrls = new Map();

  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
  };
  const write = (rows) => localStorage.setItem(KEY, JSON.stringify(rows));

  let dbp = null;
  const idb = () =>
    (dbp ||= new Promise((res, rej) => {
      const r = indexedDB.open('smc_demo_photos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('photos');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  const tx = async (mode, fn) => {
    const db = await idb();
    return new Promise((res, rej) => {
      const t = db.transaction('photos', mode);
      const req = fn(t.objectStore('photos'));
      t.oncomplete = () => res(req?.result);
      t.onerror = () => rej(t.error);
    });
  };

  const user = { id: 'demo-user', email: 'demo@local', name: localStorage.getItem('smc_demo_name') || 'Demo user' };

  // other tabs of the demo
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) listeners.forEach((cb) => cb('SYNC'));
  });

  return {
    demo: true,
    get user() { return user; },
    async init() { return user; },
    async onAuth() {},
    async signIn() { return user; },
    async signUp() { return { user }; },
    async resetPassword() {},
    async signOut() {},
    async setName(name) {
      user.name = name;
      localStorage.setItem('smc_demo_name', name);
      return user;
    },

    async list() {
      return read().sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
    },
    async create(row) {
      const now = new Date().toISOString();
      const full = {
        id: uid(), created_at: now, updated_at: now, status: 'open', photos: [], time_mode: 'actual',
        start_time: now, end_time: null, duration_min: null, last_reminder_at: null,
        created_by: user.id, ...row,
      };
      write([full, ...read()]);
      return full;
    },
    async update(id, patch) {
      const rows = read();
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) throw new Error('Not found');
      rows[i] = { ...rows[i], ...patch, updated_at: new Date().toISOString() };
      write(rows);
      return rows[i];
    },
    async remove(id) {
      write(read().filter((r) => r.id !== id));
    },

    async uploadPhoto(blob) {
      const path = `demo/${uid()}.${ext(blob)}`;
      await tx('readwrite', (s) => s.put(blob, path));
      return path;
    },
    async photoUrls(paths) {
      const out = {};
      for (const p of new Set(paths)) {
        if (!objectUrls.has(p)) {
          const blob = await tx('readonly', (s) => s.get(p));
          if (blob) objectUrls.set(p, URL.createObjectURL(blob));
        }
        if (objectUrls.has(p)) out[p] = objectUrls.get(p);
      }
      return out;
    },
    async deletePhotos(paths) {
      for (const p of paths || []) await tx('readwrite', (s) => s.delete(p));
    },

    async subscribe(cb) { listeners.push(cb); },
    async getSettings() { return null; },
    async saveSettings() {},
    async savePushSubscription() {},
    async deletePushSubscription() {},
  };
}

export const store = DEMO ? localStore() : supabaseStore();
