import config from './config.js';
import { store, DEMO } from './store.js';
import { MACHINES, STATIONS, COMPONENT_GROUPS, TYPES, TYPE_COLORS, REMINDER_CHOICES } from './lists.js';
import {
  $, $$, esc, fmtDuration, fmtElapsed, fmtTime, fmtDate, fmtDateTime, toLocalInput, fromLocalInput,
  minutesBetween, durationOf, compressImage, downloadCSV, urlBase64ToUint8Array, beep,
} from './util.js';

/* ================================================================== */
/*  State                                                              */
/* ================================================================== */
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full */ } },
};

const defaultFilters = () => ({
  q: '', machine: '', station: '', component: '', type: '', status: '', mine: false,
  period: '30', from: '', to: '', group: 'day',
});

const state = {
  user: null,
  items: [],
  view: 'ongoing',
  filters: { ...defaultFilters(), ...LS.get('smc_filters', {}) },
  filtersOpen: false,
  historyLimit: 150,
  statsPeriod: LS.get('smc_stats_period', '30'),
  statsMetric: LS.get('smc_stats_metric', 'count'),
  settings: {
    reminder_minutes: LS.get('smc_reminder', 15),
    sound: LS.get('smc_sound', true),
  },
  highlight: null,
};

const me = () => state.user?.id;
const find = (id) => state.items.find((i) => i.id === id);
const label = (iv) => [iv.machine, iv.station, iv.component].filter(Boolean).join(' · ') || 'New intervention';
const isComplete = (iv) => iv.machine && iv.station && iv.component && iv.type;
const issueKey = (iv) => [iv.machine, iv.station, iv.component, iv.type].join('|');

function upsertLocal(row) {
  if (!row) return;
  const i = state.items.findIndex((x) => x.id === row.id);
  if (i >= 0) state.items[i] = { ...state.items[i], ...row };
  else state.items.push(row);
  state.items.sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
}
const removeLocal = (id) => { state.items = state.items.filter((x) => x.id !== id); };

/* ================================================================== */
/*  Icons                                                              */
/* ================================================================== */
const I = {
  cam: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.8"/></svg>',
  img: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
  repeat: '<svg viewBox="0 0 24 24"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  filter: '<svg viewBox="0 0 24 24"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>',
  dl: '<svg viewBox="0 0 24 24"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
};

/* ================================================================== */
/*  Toasts & sheets                                                    */
/* ================================================================== */
function toast(msg, { action, fn, error = false, ms = 4500 } = {}) {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' error' : '');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { el.remove(); fn?.(); };
  host.appendChild(el);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

function openSheet(html, { cls = '', dismissable = true, onMount } = {}) {
  const d = document.createElement('dialog');
  d.className = `sheet ${cls}`;
  d.innerHTML = `<div class="sheet-inner">${html}</div>`;
  document.body.appendChild(d);
  d.showModal();
  d.addEventListener('close', () => d.remove());
  if (dismissable) d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  $$('[data-close]', d).forEach((b) => b.addEventListener('click', () => d.close()));
  onMount?.(d);
  hydratePhotos(d);
  return d;
}

function confirmSheet(title, text, okLabel = 'Confirm', danger = false) {
  return new Promise((res) => {
    let ok = false;
    const d = openSheet(`
      <h3 class="sheet-title">${esc(title)}</h3>
      <p class="muted">${esc(text)}</p>
      <div class="sheet-foot">
        <button class="btn ghost" data-close>Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button>
      </div>`, { cls: 'small' });
    $('[data-ok]', d).onclick = () => { ok = true; d.close(); };
    d.addEventListener('close', () => res(ok));
  });
}

async function hydratePhotos(root) {
  const imgs = $$('img[data-photo]:not([src])', root);
  if (!imgs.length) return;
  try {
    const urls = await store.photoUrls(imgs.map((i) => i.dataset.photo));
    imgs.forEach((i) => { const u = urls[i.dataset.photo]; if (u) i.src = u; else i.classList.add('broken'); });
  } catch { imgs.forEach((i) => i.classList.add('broken')); }
}

/* ================================================================== */
/*  Shared bits of markup                                              */
/* ================================================================== */
const typeBadge = (t) => (t ? `<span class="tbadge" style="--c:${TYPE_COLORS[t] || '#888'}">${esc(t)}</span>` : '');
const machineBadge = (m) => `<span class="mbadge">${esc(m || '—')}</span>`;

function thumb(iv, size = '') {
  const n = iv.photos?.length || 0;
  return `<div class="thumb ${size}">${n ? `<img data-photo="${esc(iv.photos[0])}" alt="">` : I.cam}${n > 1 ? `<span class="count">${n}</span>` : ''}</div>`;
}

/* ================================================================== */
/*  ONGOING view                                                       */
/* ================================================================== */
function renderOngoing() {
  const open = state.items.filter((i) => i.status === 'open')
    .sort((a, b) => (b.created_by === me()) - (a.created_by === me()) || new Date(a.start_time) - new Date(b.start_time));
  const el = $('#view-ongoing');
  el.innerHTML = `
    <div class="view-head">
      <div><h2>Ongoing</h2><p class="muted">${open.length ? `${open.length} open intervention${open.length > 1 ? 's' : ''}` : 'Nothing running'}</p></div>
      <button class="btn" data-action="new">${I.plus}<span>New</span></button>
    </div>
    ${open.length ? '' : `
      <div class="empty">
        <div class="empty-icon">${I.cam}</div>
        <h3>Something happened?</h3>
        <p>Tap the yellow camera button. The photo is saved right away and the timer starts — fill in the details when you finish.</p>
      </div>`}
    <div class="cards">${open.map(ongoingCard).join('')}</div>`;
  hydratePhotos(el);
  tick();
}

function ongoingCard(iv) {
  const mine = iv.created_by === me();
  return `
  <article class="card ${mine ? 'mine' : ''} ${state.highlight === iv.id ? 'flash' : ''}" data-id="${iv.id}" data-action="open">
    ${thumb(iv)}
    <div class="card-body">
      <div class="card-title">${iv.machine ? machineBadge(iv.machine) : ''} <span>${esc([iv.station, iv.component].filter(Boolean).join(' · ') || 'New intervention')}</span></div>
      <div class="card-sub">${typeBadge(iv.type)} ${isComplete(iv) ? '' : '<span class="warn">Details to fill</span>'}</div>
      ${iv.description ? `<p class="card-desc">${esc(iv.description)}</p>` : ''}
      <div class="card-meta">${I.clock} ${fmtDate(iv.start_time)} ${fmtTime(iv.start_time)} · ${esc(mine ? 'You' : iv.created_by_name || 'Team')}</div>
    </div>
    <div class="timer" data-since="${iv.start_time}">${fmtElapsed(Date.now() - new Date(iv.start_time))}</div>
    <div class="card-actions">
      <button class="btn ghost sm" data-action="edit">${I.edit}<span>Details</span></button>
      <button class="btn primary sm" data-action="finish">${I.check}<span>Finish</span></button>
    </div>
  </article>`;
}

/* ================================================================== */
/*  HISTORY view                                                       */
/* ================================================================== */
function periodRange(period, from, to) {
  const now = new Date();
  if (period === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); return [d, null]; }
  if (period === 'custom') {
    return [from ? new Date(from + 'T00:00') : null, to ? new Date(to + 'T23:59:59') : null];
  }
  if (period === 'all') return [null, null];
  return [new Date(now.getTime() - Number(period) * 86400000), null];
}

function applyFilters(items, f) {
  const [since, until] = periodRange(f.period, f.from, f.to);
  const q = f.q.trim().toLowerCase();
  return items.filter((iv) => {
    if (f.machine && iv.machine !== f.machine) return false;
    if (f.station && iv.station !== f.station) return false;
    if (f.component) {
      if (f.component.startsWith('group:')) { if (!(iv.component || '').startsWith(f.component.slice(6))) return false; }
      else if (iv.component !== f.component) return false;
    }
    if (f.type && iv.type !== f.type) return false;
    if (f.status && iv.status !== f.status) return false;
    if (f.mine && iv.created_by !== me()) return false;
    const t = new Date(iv.start_time);
    if (since && t < since) return false;
    if (until && t > until) return false;
    if (q) {
      const hay = [iv.machine, iv.station, iv.component, iv.type, iv.description, iv.created_by_name, iv.closed_by_name].join(' ').toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

const sel = (key, options, value, allLabel) => `
  <label class="fsel ${value ? 'on' : ''}"><span>${allLabel}</span>
    <select data-filter="${key}">
      <option value="">All</option>
      ${options.map((o) => (typeof o === 'string'
        ? `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`
        : `<option value="${esc(o.value)}" ${o.value === value ? 'selected' : ''}>${esc(o.label)}</option>`)).join('')}
    </select></label>`;

function componentOptions() {
  return COMPONENT_GROUPS.flatMap((g) => [
    ...(g.numbered ? [{ value: `group:${g.label}`, label: `All ${g.label.toLowerCase()}s` }] : []),
    ...g.items.map((i) => ({ value: i, label: i })),
  ]);
}

function renderHistory() {
  const f = state.filters;
  const list = applyFilters(state.items, f);
  const total = list.reduce((s, iv) => s + (durationOf(iv) || 0), 0);
  const active = ['machine', 'station', 'component', 'type', 'status'].filter((k) => f[k]).length + (f.mine ? 1 : 0);

  const el = $('#view-history');
  el.innerHTML = `
    <div class="view-head">
      <div><h2>History</h2><p class="muted">${list.length} intervention${list.length === 1 ? '' : 's'} · ${fmtDuration(total)} total</p></div>
      <button class="btn ghost" data-action="export" title="Export CSV">${I.dl}<span>CSV</span></button>
    </div>
    <div class="filterbar">
      <label class="search">${I.search}<input type="search" placeholder="Search description, machine, person…" value="${esc(f.q)}" data-filter="q"></label>
      <button class="btn ghost ${state.filtersOpen ? 'on' : ''}" data-action="toggle-filters">${I.filter}<span>Filters${active ? ` (${active})` : ''}</span></button>
    </div>
    <div class="periods">
      ${[['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['all', 'All'], ['custom', 'Custom']]
        .map(([v, l]) => `<button class="pill ${f.period === v ? 'on' : ''}" data-period="${v}">${l}</button>`).join('')}
    </div>
    ${f.period === 'custom' ? `
      <div class="custom-range">
        <label>From <input type="date" data-filter="from" value="${esc(f.from)}"></label>
        <label>To <input type="date" data-filter="to" value="${esc(f.to)}"></label>
      </div>` : ''}
    <div class="filters ${state.filtersOpen ? 'open' : ''}">
      ${sel('machine', MACHINES, f.machine, 'Machine')}
      ${sel('station', STATIONS, f.station, 'Station')}
      ${sel('component', componentOptions(), f.component, 'Component')}
      ${sel('type', TYPES, f.type, 'Type')}
      ${sel('status', [{ value: 'open', label: 'Ongoing' }, { value: 'done', label: 'Finished' }], f.status, 'Status')}
      <label class="fsel"><span>Group by</span>
        <select data-filter="group">
          ${[['none', 'No grouping'], ['day', 'Day'], ['machine', 'Machine'], ['station', 'Station'], ['component', 'Component'], ['type', 'Type'], ['issue', 'Same issue'], ['user', 'Person']]
            .map(([v, l]) => `<option value="${v}" ${f.group === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
      <label class="toggle"><input type="checkbox" data-filter="mine" ${f.mine ? 'checked' : ''}><span>Only mine</span></label>
      <button class="btn ghost sm" data-action="clear-filters">Clear all</button>
    </div>
    <div class="history">${historyList(list, f.group)}</div>`;
  hydratePhotos(el);
}

function groupKey(iv, g) {
  switch (g) {
    case 'day': { const d = new Date(iv.start_time); d.setHours(0, 0, 0, 0); return [d.getTime(), fmtDate(d)]; }
    case 'machine': return [iv.machine || '~', iv.machine || 'No machine'];
    case 'station': return [iv.station || '~', iv.station || 'No station'];
    case 'component': return [iv.component || '~', iv.component || 'No component'];
    case 'type': return [iv.type || '~', iv.type || 'No type'];
    case 'issue': return [issueKey(iv), label(iv) + (iv.type ? ` — ${iv.type}` : '')];
    case 'user': return [iv.created_by_name || '~', iv.created_by_name || 'Unknown'];
    default: return ['all', ''];
  }
}

function historyList(list, g) {
  if (!list.length) {
    return `<div class="empty"><div class="empty-icon">${I.search}</div><h3>No interventions found</h3><p>Try another period or clear the filters.</p></div>`;
  }
  const shown = list.slice(0, state.historyLimit);
  const groups = new Map();
  for (const iv of shown) {
    const [k, l] = groupKey(iv, g);
    if (!groups.has(k)) groups.set(k, { label: l, items: [] });
    groups.get(k).items.push(iv);
  }
  let entries = [...groups.values()];
  if (g !== 'day' && g !== 'none') entries.sort((a, b) => b.items.length - a.items.length);
  const html = entries.map((grp) => {
    const tot = grp.items.reduce((s, iv) => s + (durationOf(iv) || 0), 0);
    return `
      ${g === 'none' ? '' : `<h3 class="group-head"><span>${esc(grp.label)}</span><small>${grp.items.length} · ${fmtDuration(tot)}</small></h3>`}
      ${grp.items.map((iv) => historyRow(iv, g)).join('')}`;
  }).join('');
  const more = list.length > shown.length
    ? `<button class="btn ghost block" data-action="more">Show more (${list.length - shown.length} left)</button>` : '';
  return html + more;
}

function historyRow(iv, g) {
  const open = iv.status === 'open';
  return `
  <article class="row ${open ? 'is-open' : ''}" data-id="${iv.id}" data-action="open">
    <div class="row-time"><b>${fmtTime(iv.start_time)}</b>${g === 'day' ? '' : `<small>${fmtDate(iv.start_time)}</small>`}</div>
    <div class="row-main">
      <div class="row-title">${machineBadge(iv.machine)} <span>${esc([iv.station, iv.component].filter(Boolean).join(' · ') || '—')}</span></div>
      <div class="row-sub">${typeBadge(iv.type)}${iv.repeat_of ? `<span class="rep" title="Repeated issue">${I.repeat}</span>` : ''}<span class="desc">${esc(iv.description || '')}</span></div>
    </div>
    ${iv.photos?.length ? thumb(iv, 'xs') : '<div class="thumb xs none"></div>'}
    <div class="row-dur">${open ? `<b class="live" data-since="${iv.start_time}">${fmtElapsed(Date.now() - new Date(iv.start_time))}</b>` : `<b>${fmtDuration(durationOf(iv))}</b>`}<small>${esc(iv.created_by_name || '')}</small></div>
    <button class="icon-btn" data-action="repeat" title="Same issue again">${I.repeat}</button>
  </article>`;
}

/* ================================================================== */
/*  STATS view                                                         */
/* ================================================================== */
function renderStats() {
  const list = applyFilters(state.items, { ...defaultFilters(), period: state.statsPeriod });
  const done = list.filter((i) => i.status === 'done');
  const total = list.reduce((s, iv) => s + (durationOf(iv) || 0), 0);
  const avg = done.length ? done.reduce((s, iv) => s + (durationOf(iv) || 0), 0) / done.length : 0;
  const openNow = state.items.filter((i) => i.status === 'open').length;
  const metric = state.statsMetric;

  const agg = (keyFn) => {
    const m = new Map();
    for (const iv of list) {
      const k = keyFn(iv);
      if (!k) continue;
      const e = m.get(k) || { key: k, count: 0, time: 0, sample: iv };
      e.count++; e.time += durationOf(iv) || 0;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b[metric] - a[metric]);
  };

  const bars = (title, rows, field, colorFn, labelFn = (r) => r.key, limit = 10) => {
    rows = rows.slice(0, limit);
    const max = Math.max(1, ...rows.map((r) => r[metric]));
    return `
      <section class="panel">
        <h3>${title}</h3>
        ${rows.length ? rows.map((r) => `
          <button class="bar" ${field ? `data-action="drill" data-field="${field}" data-value="${esc(r.key)}"` : `data-action="drill-issue" data-id="${r.sample.id}"`}>
            <span class="bar-label">${esc(labelFn(r))}</span>
            <span class="bar-track"><span class="bar-fill" style="width:${(r[metric] / max) * 100}%;${colorFn ? `background:${colorFn(r)}` : ''}"></span></span>
            <span class="bar-val">${metric === 'count' ? r.count : fmtDuration(r.time)}</span>
          </button>`).join('') : '<p class="muted">No data for this period.</p>'}
      </section>`;
  };

  const recurring = agg((iv) => (isComplete(iv) ? issueKey(iv) : null)).filter((r) => r.count > 1);

  $('#view-stats').innerHTML = `
    <div class="view-head"><div><h2>Statistics</h2><p class="muted">Tap a bar to see those interventions</p></div></div>
    <div class="periods">
      ${[['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['365', '1 year'], ['all', 'All']]
        .map(([v, l]) => `<button class="pill ${state.statsPeriod === v ? 'on' : ''}" data-stats-period="${v}">${l}</button>`).join('')}
    </div>
    <div class="kpis">
      <div class="kpi"><b>${list.length}</b><span>Interventions</span></div>
      <div class="kpi"><b>${fmtDuration(total)}</b><span>Total time</span></div>
      <div class="kpi"><b>${fmtDuration(avg)}</b><span>Average</span></div>
      <div class="kpi ${openNow ? 'hot' : ''}"><b>${openNow}</b><span>Open now</span></div>
    </div>
    <div class="seg">
      <button class="${metric === 'count' ? 'on' : ''}" data-metric="count">By number</button>
      <button class="${metric === 'time' ? 'on' : ''}" data-metric="time">By time spent</button>
    </div>
    <div class="panels">
      ${bars('Machines', agg((i) => i.machine), 'machine')}
      ${bars('Intervention type', agg((i) => i.type), 'type', (r) => TYPE_COLORS[r.key])}
      ${bars('Stations', agg((i) => i.station), 'station')}
      ${bars('Components', agg((i) => i.component), 'component')}
      ${bars('Recurring issues', recurring, null, null, (r) => `${r.sample.machine} · ${r.sample.station} · ${r.sample.component} — ${r.sample.type}`, 12)}
    </div>`;
}

/* ================================================================== */
/*  SETTINGS view                                                      */
/* ================================================================== */
function notifStatus() {
  if (!('Notification' in window)) return ['off', 'Not supported in this browser. On iPhone, add the app to the Home Screen first.'];
  if (Notification.permission === 'granted') return ['on', DEMO || !config.VAPID_PUBLIC_KEY ? 'Allowed (while the app is open or in the background)' : 'Allowed — also when the app is closed'];
  if (Notification.permission === 'denied') return ['off', 'Blocked — allow notifications for this site in your browser settings'];
  return ['ask', 'Not enabled yet'];
}

function renderSettings() {
  const [ns, nt] = notifStatus();
  const s = state.settings;
  $('#view-settings').innerHTML = `
    <div class="view-head"><div><h2>Settings</h2><p class="muted">${esc(state.user?.email || '')}</p></div></div>

    ${DEMO ? `<section class="panel notice">
      <h3>Demo mode</h3>
      <p>Data is stored only in this browser. Add your Supabase keys (see README) to share interventions with the whole team.</p>
    </section>` : ''}

    <section class="panel">
      <h3>Your name</h3>
      <p class="muted">Shown to the team on each intervention.</p>
      <div class="inline">
        <input type="text" id="set-name" value="${esc(state.user?.name || '')}" maxlength="40">
        <button class="btn" data-action="save-name">Save</button>
      </div>
    </section>

    <section class="panel">
      <h3>“Is it finished?” reminder</h3>
      <p class="muted">While one of your interventions is open, you get a reminder at this interval so you don't forget to close it.</p>
      <div class="chips wrap">
        ${REMINDER_CHOICES.map((m) => `<button class="chip ${s.reminder_minutes === m ? 'on' : ''}" data-reminder="${m}">${m ? fmtDuration(m) : 'Off'}</button>`).join('')}
      </div>
      <div class="notif ${ns}">
        <span class="dot"></span><span>${esc(nt)}</span>
      </div>
      <div class="inline">
        ${ns !== 'on' ? '<button class="btn primary" data-action="enable-notif">Enable notifications</button>' : ''}
        <button class="btn ghost" data-action="test-notif">Send a test</button>
      </div>
      <label class="toggle"><input type="checkbox" id="set-sound" ${s.sound ? 'checked' : ''}><span>Sound &amp; vibration for in-app reminders</span></label>
    </section>

    <section class="panel">
      <h3>Data</h3>
      <div class="inline">
        <button class="btn ghost" data-action="export-all">${I.dl}<span>Export everything (CSV)</span></button>
      </div>
    </section>

    ${DEMO ? '' : `<section class="panel">
      <h3>Account</h3>
      <button class="btn danger" data-action="signout">Sign out</button>
    </section>`}

    <p class="muted center small">SMC Maintenance Log · ${DEMO ? 'demo' : 'connected to Supabase'}</p>`;
}

/* ================================================================== */
/*  Detail sheet                                                       */
/* ================================================================== */
function openDetail(id) {
  const iv = find(id);
  if (!iv) return;
  const open = iv.status === 'open';
  const same = isComplete(iv) ? state.items.filter((x) => issueKey(x) === issueKey(iv)) : [iv];
  const mine = iv.created_by === me();
  openSheet(`
    <header class="sheet-head">
      <div>
        <div class="sheet-kicker">${open ? '<span class="status open">Ongoing</span>' : '<span class="status done">Finished</span>'} ${typeBadge(iv.type)}</div>
        <h3 class="sheet-title">${esc(label(iv))}</h3>
      </div>
      <button class="icon-btn" data-close>${I.x}</button>
    </header>
    ${iv.photos?.length ? `<div class="gallery">${iv.photos.map((p, i) => `<img data-photo="${esc(p)}" data-view="${i}" alt="Photo ${i + 1}">`).join('')}</div>` : ''}
    <dl class="facts">
      <div><dt>Machine</dt><dd>${esc(iv.machine || '—')}</dd></div>
      <div><dt>Station</dt><dd>${esc(iv.station || '—')}</dd></div>
      <div><dt>Component</dt><dd>${esc(iv.component || '—')}</dd></div>
      <div><dt>Type</dt><dd>${esc(iv.type || '—')}</dd></div>
      <div><dt>Started</dt><dd>${fmtDateTime(iv.start_time)}</dd></div>
      <div><dt>${open ? 'Running for' : 'Duration'}</dt><dd>${open ? `<b class="live" data-since="${iv.start_time}">${fmtElapsed(Date.now() - new Date(iv.start_time))}</b>` : `<b>${fmtDuration(durationOf(iv))}</b> <small class="muted">${iv.time_mode === 'manual' ? 'manual' : 'timed'}</small>`}</dd></div>
      ${iv.end_time ? `<div><dt>Finished</dt><dd>${fmtDateTime(iv.end_time)}</dd></div>` : ''}
      <div><dt>By</dt><dd>${esc(iv.created_by_name || '—')}${iv.closed_by_name && iv.closed_by_name !== iv.created_by_name ? ` → closed by ${esc(iv.closed_by_name)}` : ''}</dd></div>
    </dl>
    ${iv.description ? `<div class="desc-block">${esc(iv.description)}</div>` : '<p class="muted">No description.</p>'}
    ${same.length > 1 ? `<button class="same-issue" data-action="drill-issue" data-id="${iv.id}">${I.repeat}<span>This issue happened <b>${same.length} times</b> · ${fmtDuration(same.reduce((s, x) => s + (durationOf(x) || 0), 0))} in total</span></button>` : ''}
    <div class="sheet-foot wrap">
      ${mine || DEMO ? `<button class="btn ghost danger-text" data-action="delete" data-id="${iv.id}">${I.trash}<span>Delete</span></button>` : ''}
      <span class="spacer"></span>
      <button class="btn ghost" data-action="repeat" data-id="${iv.id}">${I.repeat}<span>Same issue again</span></button>
      <button class="btn ghost" data-action="edit" data-id="${iv.id}">${I.edit}<span>Edit</span></button>
      ${open ? `<button class="btn primary" data-action="finish" data-id="${iv.id}">${I.check}<span>Finish</span></button>` : ''}
    </div>`, {
    onMount: (d) => {
      $$('[data-view]', d).forEach((img) => img.addEventListener('click', () => openViewer(iv.photos, Number(img.dataset.view))));
      tick();
    },
  });
}

function openViewer(paths, index = 0) {
  let i = index;
  const d = openSheet(`
    <button class="icon-btn viewer-close" data-close>${I.x}</button>
    <img class="viewer-img" alt="">
    ${paths.length > 1 ? '<button class="viewer-nav prev" aria-label="Previous">‹</button><button class="viewer-nav next" aria-label="Next">›</button><div class="viewer-count"></div>' : ''}`,
  { cls: 'viewer' });
  const show = async () => {
    const urls = await store.photoUrls([paths[i]]);
    $('.viewer-img', d).src = urls[paths[i]] || '';
    const c = $('.viewer-count', d); if (c) c.textContent = `${i + 1} / ${paths.length}`;
  };
  $('.prev', d)?.addEventListener('click', () => { i = (i - 1 + paths.length) % paths.length; show(); });
  $('.next', d)?.addEventListener('click', () => { i = (i + 1) % paths.length; show(); });
  show();
}

/* ================================================================== */
/*  Intervention form (new / details / finish / edit)                  */
/* ================================================================== */
function chipGroup(field, options, value, numbered = false) {
  return options.map((o) => {
    const text = numbered ? o.replace(/^\D+/, '') : o;
    const style = field === 'type' ? ` style="--c:${TYPE_COLORS[o]}"` : '';
    return `<button type="button" class="chip ${numbered ? 'num' : ''} ${field === 'type' ? 'typed' : ''} ${o === value ? 'on' : ''}" data-field="${field}" data-value="${esc(o)}"${style}>${esc(text)}</button>`;
  }).join('');
}

function openForm(src, { finish = false } = {}) {
  const isNew = !src?.id;
  const original = src ? structuredClone(src) : null;
  const d0 = src ? structuredClone(src) : {
    status: 'new', photos: [], time_mode: 'actual', start_time: new Date().toISOString(),
    machine: null, station: null, component: null, type: null, description: '',
  };
  d0.photos ||= [];
  if (finish && d0.time_mode === 'actual' && !d0.end_time) d0.end_time = new Date().toISOString();
  if (d0.status === 'open' && !finish) d0.end_time = null;
  const draft = d0;
  const uploaded = [];   // photos uploaded in this form (deleted again if cancelled)
  let uploading = 0;
  let saved = false;

  const title = isNew ? 'New intervention' : finish ? 'Finish intervention' : draft.status === 'open' ? 'Intervention details' : 'Edit intervention';

  const dlg = openSheet(`
    <header class="sheet-head">
      <div><div class="sheet-kicker">${draft.status === 'open' ? '<span class="status open">Ongoing</span>' : draft.status === 'done' ? '<span class="status done">Finished</span>' : ''}</div>
      <h3 class="sheet-title">${title}</h3></div>
      <button class="icon-btn" data-close>${I.x}</button>
    </header>

    <div class="form-photos"></div>

    <button type="button" class="btn ghost block prefill" data-prefill>${I.copy}<span>Same as a previous issue…</span></button>

    <div class="fgroup" data-group="machine"><h4>Machine</h4><div class="chips grid4">${chipGroup('machine', MACHINES, draft.machine)}</div></div>
    <div class="fgroup" data-group="station"><h4>Station</h4><div class="chips wrap">${chipGroup('station', STATIONS, draft.station)}</div></div>
    <div class="fgroup" data-group="component"><h4>Component</h4>
      ${COMPONENT_GROUPS.map((g) => `
        <div class="subgroup">${g.numbered ? `<span class="sublabel">${g.label}</span>` : ''}
          <div class="chips ${g.numbered ? 'numpad' : 'wrap'}">${chipGroup('component', g.items, draft.component, g.numbered)}</div>
        </div>`).join('')}
    </div>
    <div class="fgroup" data-group="type"><h4>Intervention type</h4><div class="chips wrap">${chipGroup('type', TYPES, draft.type)}</div></div>

    <div class="fgroup"><h4>Description</h4>
      <textarea data-bind="description" rows="3" placeholder="What happened, what did you do, parts used…">${esc(draft.description || '')}</textarea>
    </div>

    <div class="fgroup"><h4>Time</h4><div class="time-block"></div></div>

    <div class="sheet-foot sticky"></div>`, { cls: 'form', dismissable: false });

  const renderPhotos = () => {
    $('.form-photos', dlg).innerHTML = `
      ${draft.photos.map((p) => `<div class="ph"><img data-photo="${esc(p)}" alt=""><button type="button" class="ph-rm" data-rm-photo="${esc(p)}" aria-label="Remove photo">${I.x}</button></div>`).join('')}
      ${Array.from({ length: uploading }, () => '<div class="ph loading"><span class="spinner"></span></div>').join('')}
      <label class="ph-add">${I.cam}<span>Camera</span><input type="file" accept="image/*" capture="environment" data-add-photo hidden></label>
      <label class="ph-add">${I.img}<span>Gallery</span><input type="file" accept="image/*" multiple data-add-photo hidden></label>`;
    hydratePhotos(dlg);
  };

  const renderTime = () => {
    const tb = $('.time-block', dlg);
    const manual = draft.time_mode === 'manual';
    const running = draft.status !== 'done';
    tb.innerHTML = `
      <div class="seg">
        <button type="button" class="${!manual ? 'on' : ''}" data-mode="actual">${I.clock}<span>Actual time</span></button>
        <button type="button" class="${manual ? 'on' : ''}" data-mode="manual">${I.edit}<span>Manual</span></button>
      </div>
      <div class="time-fields">
        <label>Start<input type="datetime-local" data-bind="start_time" value="${toLocalInput(draft.start_time)}"></label>
        ${manual ? `
          <label>Duration (min)<input type="number" inputmode="numeric" min="0" step="1" data-bind="duration_min" value="${draft.duration_min ?? ''}" placeholder="e.g. 20"></label>
          <div class="chips wrap quick">${[5, 10, 15, 20, 30, 45, 60, 90, 120].map((m) => `<button type="button" class="chip sm ${Number(draft.duration_min) === m ? 'on' : ''}" data-dur="${m}">${fmtDuration(m)}</button>`).join('')}</div>`
        : `
          <label>End ${running ? '<small class="muted">(empty = still running)</small>' : ''}
            <span class="inline"><input type="datetime-local" data-bind="end_time" value="${toLocalInput(draft.end_time)}"><button type="button" class="btn ghost sm" data-endnow>Now</button></span>
          </label>`}
      </div>
      <div class="computed"></div>`;
    updateComputed();
  };

  const updateComputed = () => {
    const c = $('.computed', dlg);
    if (!c) return;
    if (draft.time_mode === 'manual') {
      const dur = Number(draft.duration_min);
      c.innerHTML = draft.duration_min !== '' && draft.duration_min != null && dur >= 0
        ? `Action duration <b>${fmtDuration(dur)}</b> · ends ${fmtDateTime(new Date(draft.start_time).getTime() + dur * 60000)}`
        : '<span class="muted">Enter the action duration</span>';
    } else if (draft.end_time) {
      const bad = new Date(draft.end_time) < new Date(draft.start_time);
      c.innerHTML = bad ? '<span class="err">End is before start</span>' : `Action duration <b>${fmtDuration(minutesBetween(draft.start_time, draft.end_time))}</b>`;
    } else {
      c.innerHTML = `Running <b class="live" data-since="${draft.start_time}">${fmtElapsed(Date.now() - new Date(draft.start_time))}</b> since the photo / start`;
    }
  };

  const renderFoot = () => {
    const f = $('.sheet-foot', dlg);
    if (draft.status === 'done') {
      f.innerHTML = '<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save="save">Save changes</button>';
    } else {
      f.innerHTML = `
        <button class="btn ghost" data-save="keep">${isNew ? `${I.clock}<span>Start timer</span>` : '<span>Save · keep open</span>'}</button>
        <button class="btn primary" data-save="finish">${I.check}<span>${isNew ? 'Save as finished' : 'Finish'}</span></button>`;
    }
    $$('[data-close]', f).forEach((b) => b.addEventListener('click', () => dlg.close()));
  };

  const setField = (field, value) => {
    draft[field] = value;
    $$(`[data-field="${field}"]`, dlg).forEach((b) => b.classList.toggle('on', b.dataset.value === value));
    $(`[data-group="${field}"]`, dlg)?.classList.remove('missing');
  };

  renderPhotos(); renderTime(); renderFoot();

  dlg.addEventListener('click', async (e) => {
    const t = e.target.closest('button, [data-rm-photo]');
    if (!t) return;
    if (t.dataset.field) setField(t.dataset.field, draft[t.dataset.field] === t.dataset.value ? null : t.dataset.value);
    else if (t.dataset.mode) {
      draft.time_mode = t.dataset.mode;
      if (draft.time_mode === 'manual' && draft.duration_min == null && draft.end_time) draft.duration_min = minutesBetween(draft.start_time, draft.end_time);
      if (draft.time_mode === 'manual' && draft.duration_min == null && draft.status === 'open') draft.duration_min = Math.round(durationOf({ ...draft, status: 'open' }));
      renderTime();
    } else if (t.dataset.dur) { draft.duration_min = Number(t.dataset.dur); renderTime(); }
    else if ('endnow' in t.dataset) { draft.end_time = new Date().toISOString(); renderTime(); }
    else if (t.dataset.rmPhoto) { draft.photos = draft.photos.filter((p) => p !== t.dataset.rmPhoto); renderPhotos(); }
    else if ('prefill' in t.dataset) openPrefill(draft, (srcIv) => {
      ['machine', 'station', 'component', 'type'].forEach((k) => setField(k, srcIv[k]));
      if (srcIv.description) {
        draft.description = srcIv.description;
        $('[data-bind="description"]', dlg).value = srcIv.description;
      }
      if (draft.time_mode === 'manual' && srcIv.duration_min != null && draft.duration_min == null) { draft.duration_min = srcIv.duration_min; renderTime(); }
      draft.repeat_of = srcIv.repeat_of || srcIv.id;
      toast('Filled from previous issue — change anything you need');
    });
    else if (t.dataset.save) save(t.dataset.save, t);
  });

  dlg.addEventListener('input', (e) => {
    const b = e.target.dataset.bind;
    if (!b) return;
    if (b === 'start_time' || b === 'end_time') { draft[b] = fromLocalInput(e.target.value); if (b === 'start_time') draft.last_reminder_at = null; }
    else if (b === 'duration_min') draft.duration_min = e.target.value === '' ? null : Math.max(0, parseInt(e.target.value, 10));
    else draft[b] = e.target.value;
    if (b === 'duration_min') $$('[data-dur]', dlg).forEach((x) => x.classList.toggle('on', Number(x.dataset.dur) === draft.duration_min));
    updateComputed();
  });

  dlg.addEventListener('change', async (e) => {
    if (!('addPhoto' in e.target.dataset)) return;
    const files = [...e.target.files];
    e.target.value = '';
    for (const file of files) {
      uploading++; renderPhotos();
      try {
        const path = await store.uploadPhoto(await compressImage(file));
        draft.photos.push(path); uploaded.push(path);
      } catch (err) { toast('Photo upload failed: ' + (err.message || err), { error: true }); }
      uploading--; renderPhotos();
    }
  });

  dlg.addEventListener('close', () => {
    if (!saved && uploaded.length) store.deletePhotos(uploaded).catch(() => {});
  });

  async function save(kind, btn) {
    if (uploading) { toast('Wait for the photos to finish uploading'); return; }
    if (!draft.start_time) { toast('Set a start time', { error: true }); return; }
    const row = {
      machine: draft.machine, station: draft.station, component: draft.component, type: draft.type,
      description: (draft.description || '').trim() || null,
      photos: draft.photos, time_mode: draft.time_mode, start_time: draft.start_time,
      repeat_of: draft.repeat_of || null,
      updated_by_name: state.user.name,
    };

    if (kind === 'keep') {
      Object.assign(row, { status: 'open', end_time: null, duration_min: null });
      if (draft.start_time !== original?.start_time) row.last_reminder_at = null;
    } else {
      if (kind === 'finish') {
        const missing = ['machine', 'station', 'component', 'type'].filter((k) => !draft[k]);
        if (missing.length) {
          missing.forEach((k) => $(`[data-group="${k}"]`, dlg).classList.add('missing'));
          $(`[data-group="${missing[0]}"]`, dlg).scrollIntoView({ behavior: 'smooth', block: 'center' });
          toast(`Choose ${missing.join(', ')} before finishing`, { error: true });
          return;
        }
      }
      if (draft.time_mode === 'manual') {
        if (draft.duration_min == null || Number.isNaN(draft.duration_min)) { toast('Enter the action duration', { error: true }); return; }
        row.duration_min = draft.duration_min;
        row.end_time = new Date(new Date(draft.start_time).getTime() + draft.duration_min * 60000).toISOString();
      } else {
        const end = draft.end_time || new Date().toISOString();
        if (new Date(end) < new Date(draft.start_time)) { toast('End time is before start time', { error: true }); return; }
        row.end_time = end;
        row.duration_min = minutesBetween(draft.start_time, end);
      }
      row.status = 'done';
      if (original?.status !== 'done') row.closed_by_name = state.user.name;
    }

    btn.disabled = true;
    try {
      const res = isNew
        ? await store.create({ ...row, created_by_name: state.user.name })
        : await store.update(original.id, row);
      saved = true;
      upsertLocal(res);
      const removed = (original?.photos || []).filter((p) => !draft.photos.includes(p));
      if (removed.length) store.deletePhotos(removed).catch(() => {});
      dlg.close();
      if (row.status === 'done') toast(`Saved · ${fmtDuration(row.duration_min)}`, { action: 'Same issue again', fn: () => openRepeat(res.id) });
      else toast(isNew ? 'Timer started' : 'Saved');
      renderAll();
    } catch (err) {
      btn.disabled = false;
      toast('Could not save: ' + (err.message || err), { error: true });
    }
  }
}

/* "Same as a previous issue" picker */
function openPrefill(draft, onPick) {
  const seen = new Map();
  for (const iv of state.items) {
    if (!isComplete(iv) || iv.id === draft.id) continue;
    const k = issueKey(iv) + '|' + (iv.description || '').trim().toLowerCase();
    const e = seen.get(k);
    if (e) e.count++;
    else seen.set(k, { iv, count: 1 });
  }
  const all = [...seen.values()].sort((a, b) =>
    (b.iv.machine === draft.machine) - (a.iv.machine === draft.machine) || b.count - a.count ||
    new Date(b.iv.start_time) - new Date(a.iv.start_time));

  const d = openSheet(`
    <header class="sheet-head"><h3 class="sheet-title">Same as a previous issue</h3><button class="icon-btn" data-close>${I.x}</button></header>
    <label class="search">${I.search}<input type="search" placeholder="Search…" data-q autofocus></label>
    <div class="pick-list"></div>`, { cls: 'picker' });

  const render = (q = '') => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = all.filter(({ iv }) => {
      const hay = [iv.machine, iv.station, iv.component, iv.type, iv.description].join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    }).slice(0, 60);
    $('.pick-list', d).innerHTML = list.length ? list.map(({ iv, count }) => `
      <button class="pick" data-pick="${iv.id}">
        <div class="row-title">${machineBadge(iv.machine)} <span>${esc(iv.station)} · ${esc(iv.component)}</span> ${typeBadge(iv.type)}</div>
        ${iv.description ? `<div class="pick-desc">${esc(iv.description)}</div>` : ''}
        <div class="muted small">${count > 1 ? `${count}× · ` : ''}last ${fmtDate(iv.start_time)} · ${fmtDuration(durationOf(iv))}</div>
      </button>`).join('') : '<p class="muted center">No previous issues yet.</p>';
  };
  render();
  $('[data-q]', d).addEventListener('input', (e) => render(e.target.value));
  d.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    onPick(find(b.dataset.pick));
    d.close();
  });
}

/* ================================================================== */
/*  Repeat: same issue happened again                                  */
/* ================================================================== */
function openRepeat(id) {
  const src = find(id);
  if (!src) return;
  const prevDur = src.status === 'done' ? Math.round(durationOf(src)) : 15;
  const r = { mode: 'done', duration: prevDur || 15, end: new Date().toISOString(), note: '', photos: [] };
  let uploading = 0;
  let saved = false;

  const d = openSheet(`
    <header class="sheet-head">
      <div><div class="sheet-kicker">${I.repeat} Same issue again</div><h3 class="sheet-title">${esc(label(src))}</h3></div>
      <button class="icon-btn" data-close>${I.x}</button>
    </header>
    <div class="repeat-src">${typeBadge(src.type)} ${src.description ? `<span>${esc(src.description)}</span>` : '<span class="muted">No description</span>'}</div>
    <div class="seg">
      <button type="button" class="on" data-rmode="done">${I.check}<span>Already done</span></button>
      <button type="button" data-rmode="timer">${I.clock}<span>Start timer now</span></button>
    </div>
    <div class="rep-done">
      <div class="time-fields">
        <label>Action duration (min)<input type="number" inputmode="numeric" min="0" data-rdur value="${r.duration}"></label>
        <div class="chips wrap quick">${[5, 10, 15, 20, 30, 45, 60, 90, 120].map((m) => `<button type="button" class="chip sm ${m === r.duration ? 'on' : ''}" data-q="${m}">${fmtDuration(m)}</button>`).join('')}</div>
        <label>Finished at<input type="datetime-local" data-rend value="${toLocalInput(r.end)}"></label>
      </div>
    </div>
    <div class="fgroup"><h4>Note <small class="muted">(optional — leave empty to keep the same description)</small></h4>
      <textarea rows="2" data-rnote placeholder="Anything different this time?"></textarea></div>
    <div class="form-photos"></div>
    <div class="sheet-foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-rsave>${I.repeat}<span>Save repeat</span></button></div>`,
  { cls: 'form' });

  const renderPhotos = () => {
    $('.form-photos', d).innerHTML = `
      ${r.photos.map((p) => `<div class="ph"><img data-photo="${esc(p)}" alt=""></div>`).join('')}
      ${Array.from({ length: uploading }, () => '<div class="ph loading"><span class="spinner"></span></div>').join('')}
      <label class="ph-add">${I.cam}<span>Photo</span><input type="file" accept="image/*" capture="environment" data-radd hidden></label>`;
    hydratePhotos(d);
  };
  renderPhotos();

  d.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.rmode) {
      r.mode = b.dataset.rmode;
      $$('[data-rmode]', d).forEach((x) => x.classList.toggle('on', x === b));
      $('.rep-done', d).hidden = r.mode !== 'done';
    } else if (b.dataset.q) {
      r.duration = Number(b.dataset.q);
      $('[data-rdur]', d).value = r.duration;
      $$('[data-q]', d).forEach((x) => x.classList.toggle('on', x === b));
    } else if ('rsave' in b.dataset) {
      if (uploading) return toast('Wait for the photo to upload');
      if (r.mode === 'done' && !(r.duration >= 0)) return toast('Enter the duration', { error: true });
      b.disabled = true;
      const base = {
        machine: src.machine, station: src.station, component: src.component, type: src.type,
        description: r.note.trim() || src.description, photos: r.photos,
        repeat_of: src.repeat_of || src.id, created_by_name: state.user.name, updated_by_name: state.user.name,
      };
      const row = r.mode === 'done'
        ? { ...base, status: 'done', time_mode: 'manual', duration_min: r.duration, end_time: r.end,
            start_time: new Date(new Date(r.end).getTime() - r.duration * 60000).toISOString(), closed_by_name: state.user.name }
        : { ...base, status: 'open', time_mode: 'actual', start_time: new Date().toISOString() };
      try {
        const res = await store.create(row);
        saved = true;
        upsertLocal(res);
        d.close();
        toast(r.mode === 'done' ? `Repeat saved · ${fmtDuration(r.duration)}` : 'Repeat started — timer running');
        if (r.mode === 'timer') { state.highlight = res.id; switchView('ongoing'); }
        renderAll();
      } catch (err) {
        b.disabled = false;
        toast('Could not save: ' + (err.message || err), { error: true });
      }
    }
  });
  d.addEventListener('input', (e) => {
    if ('rdur' in e.target.dataset) {
      r.duration = parseInt(e.target.value, 10);
      $$('[data-q]', d).forEach((x) => x.classList.toggle('on', Number(x.dataset.q) === r.duration));
    }
    if ('rend' in e.target.dataset) r.end = fromLocalInput(e.target.value) || new Date().toISOString();
    if ('rnote' in e.target.dataset) r.note = e.target.value;
  });
  d.addEventListener('change', async (e) => {
    if (!('radd' in e.target.dataset)) return;
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    uploading++; renderPhotos();
    try { r.photos.push(await store.uploadPhoto(await compressImage(file))); }
    catch (err) { toast('Photo upload failed: ' + (err.message || err), { error: true }); }
    uploading--; renderPhotos();
  });
  d.addEventListener('close', () => { if (!saved && r.photos.length) store.deletePhotos(r.photos).catch(() => {}); });
}

/* ================================================================== */
/*  Quick capture (the big camera button)                              */
/* ================================================================== */
let captureAt = null;

function quickCapture() {
  captureAt = new Date().toISOString(); // the moment the problem was noticed
  const input = $('#quick-cam');
  input.value = '';
  input.click();
}

async function onQuickPhoto(file, at) {
  const t = toast.bind(null);
  t('Saving photo…', { ms: 2000 });
  try {
    const blob = await compressImage(file);
    const path = await store.uploadPhoto(blob);
    const iv = await store.create({
      status: 'open', time_mode: 'actual', start_time: at, photos: [path], created_by_name: state.user.name,
    });
    upsertLocal(iv);
    state.highlight = iv.id;
    switchView('ongoing');
    toast('Photo saved — timer is running', { action: 'Add details', fn: () => openForm(find(iv.id)), ms: 7000 });
  } catch (err) {
    toast('Could not save: ' + (err.message || err), { error: true, action: 'Retry', fn: () => onQuickPhoto(file, at), ms: 15000 });
  }
}

/* ================================================================== */
/*  Reminders                                                          */
/* ================================================================== */
let pendingReminder = null;

function checkReminders() {
  const every = state.settings.reminder_minutes;
  if (!every || !state.user) return;
  const now = Date.now();
  for (const iv of state.items) {
    if (iv.status !== 'open' || iv.created_by !== me()) continue;
    const last = new Date(iv.last_reminder_at || iv.start_time).getTime();
    if (now - last < every * 60000) continue;
    iv.last_reminder_at = new Date(now).toISOString();
    store.update(iv.id, { last_reminder_at: iv.last_reminder_at }).catch(() => {});
    remind(iv, (now - new Date(iv.start_time)) / 60000);
  }
}

async function remind(iv, mins) {
  const title = `Still open · ${fmtDuration(mins)}`;
  const body = `${label(iv)}${iv.type ? ` (${iv.type})` : ''} — is the intervention finished?`;
  if (document.visibilityState === 'visible') {
    showReminderBanner(iv, title, body);
  } else {
    pendingReminder = { id: iv.id, title, body };
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const reg = await navigator.serviceWorker?.ready;
        if (reg) await reg.showNotification(title, notifOptions(iv.id, body));
        else new Notification(title, { body, tag: `iv-${iv.id}` });
      } catch { /* ignore */ }
    }
  }
}

const notifOptions = (id, body) => ({
  body, tag: `iv-${id}`, renotify: true, requireInteraction: true,
  icon: '/icons/icon-192.png', badge: '/icons/badge-72.png', vibrate: [200, 100, 200],
  data: { id }, actions: [{ action: 'finish', title: 'Yes, finish it' }, { action: 'later', title: 'Not yet' }],
});

function showReminderBanner(iv, title, body) {
  $('.reminder')?.remove();
  const el = document.createElement('div');
  el.className = 'reminder';
  el.innerHTML = `
    <div class="reminder-icon">${I.clock}</div>
    <div class="reminder-text"><b>${esc(title)}</b><span>${esc(body)}</span></div>
    <div class="reminder-actions">
      <button class="btn ghost sm" data-later>Not yet</button>
      <button class="btn primary sm" data-fin>Finish</button>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('[data-later]').onclick = () => el.remove();
  el.querySelector('[data-fin]').onclick = () => { el.remove(); const x = find(iv.id); if (x) openForm(x, { finish: true }); };
  if (state.settings.sound) { beep(); if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.([200, 100, 200]); }
}

async function enableNotifications() {
  if (!('Notification' in window)) { toast('Notifications are not supported here. On iPhone, add the app to the Home Screen first.', { error: true }); return; }
  const p = await Notification.requestPermission();
  if (p !== 'granted') { toast('Notifications were not allowed', { error: true }); renderSettings(); return; }
  await syncPush(true);
  toast('Notifications enabled');
  renderSettings();
}

async function syncPush(showErrors = false) {
  if (DEMO || !config.VAPID_PUBLIC_KEY || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(config.VAPID_PUBLIC_KEY) });
    await store.savePushSubscription(sub);
  } catch (err) {
    if (showErrors) toast('Background push not available: ' + (err.message || err), { error: true });
  }
}

async function testNotification() {
  const iv = { id: 'test', machine: 'SMC1', station: 'Tape station', component: 'Cassette 1', type: 'Adjustment' };
  if ('Notification' in window && Notification.permission === 'granted') {
    const reg = await navigator.serviceWorker?.ready;
    const body = `${label(iv)} — is the intervention finished?`;
    if (reg) reg.showNotification('Test reminder', notifOptions('test', body));
    else new Notification('Test reminder', { body });
  }
  showReminderBanner(iv, 'Test reminder', 'This is what a reminder looks like.');
}

/* ================================================================== */
/*  Navigation, ticking, global events                                 */
/* ================================================================== */
function switchView(v) {
  state.view = v;
  $$('.view').forEach((s) => { s.hidden = s.id !== `view-${v}`; });
  $$('.tab[data-view]').forEach((t) => t.classList.toggle('on', t.dataset.view === v));
  renderAll();
  window.scrollTo({ top: 0 });
}

function renderAll() {
  const openCount = state.items.filter((i) => i.status === 'open').length;
  const badge = $('#open-badge');
  badge.textContent = openCount;
  badge.hidden = !openCount;
  if (state.view === 'ongoing') renderOngoing();
  if (state.view === 'history') renderHistory();
  if (state.view === 'stats') renderStats();
  if (state.view === 'settings') renderSettings();
  $('#user-btn').textContent = (state.user?.name || '?').trim().slice(0, 2).toUpperCase();
}

function tick() {
  const now = Date.now();
  $$('[data-since]').forEach((el) => { el.textContent = fmtElapsed(now - new Date(el.dataset.since)); });
}

function saveFilters() { LS.set('smc_filters', state.filters); }

function exportRows(list) {
  const head = ['Start', 'End', 'Duration (min)', 'Status', 'Machine', 'Station', 'Component', 'Type', 'Description', 'Time mode', 'Created by', 'Closed by', 'Photos', 'Repeat', 'ID'];
  const rows = list.map((iv) => [
    fmtCsvDate(iv.start_time), fmtCsvDate(iv.end_time), iv.status === 'done' ? Math.round(durationOf(iv)) : '',
    iv.status === 'open' ? 'ongoing' : 'finished', iv.machine, iv.station, iv.component, iv.type, iv.description,
    iv.time_mode, iv.created_by_name, iv.closed_by_name, iv.photos?.length || 0, iv.repeat_of ? 'yes' : '', iv.id,
  ]);
  downloadCSV(`interventions-${new Date().toISOString().slice(0, 10)}.csv`, [head, ...rows]);
}
const fmtCsvDate = (d) => (d ? toLocalInput(d).replace('T', ' ') : '');

function wireGlobal() {
  $('#quick-cam').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) onQuickPhoto(f, captureAt || new Date().toISOString());
  });
  $('#capture-btn').addEventListener('click', quickCapture);
  $$('.tab[data-view]').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));
  $('#user-btn').addEventListener('click', () => switchView('settings'));

  document.addEventListener('click', async (e) => {
    const p = e.target.closest('[data-period]');
    if (p) { state.filters.period = p.dataset.period; saveFilters(); renderHistory(); return; }
    const sp = e.target.closest('[data-stats-period]');
    if (sp) { state.statsPeriod = sp.dataset.statsPeriod; LS.set('smc_stats_period', state.statsPeriod); renderStats(); return; }
    const mt = e.target.closest('[data-metric]');
    if (mt && !mt.closest('dialog')) { state.statsMetric = mt.dataset.metric; LS.set('smc_stats_metric', state.statsMetric); renderStats(); return; }
    const rm = e.target.closest('[data-reminder]');
    if (rm) {
      state.settings.reminder_minutes = Number(rm.dataset.reminder);
      LS.set('smc_reminder', state.settings.reminder_minutes);
      store.saveSettings({ reminder_minutes: state.settings.reminder_minutes }).catch(() => {});
      renderSettings();
      if (state.settings.reminder_minutes && 'Notification' in window && Notification.permission === 'default') enableNotifications();
      return;
    }

    const a = e.target.closest('[data-action]');
    if (!a) return;
    const id = a.dataset.id || a.closest('[data-id]')?.dataset.id;
    const inDialog = a.closest('dialog');
    const act = a.dataset.action;
    if (inDialog && ['edit', 'finish', 'repeat', 'drill-issue'].includes(act)) inDialog.close();

    switch (act) {
      case 'open': openDetail(id); break;
      case 'edit': openForm(find(id)); break;
      case 'finish': openForm(find(id), { finish: true }); break;
      case 'repeat': openRepeat(id); break;
      case 'new': openForm(null); break;
      case 'delete': {
        const iv = find(id);
        if (!iv) break;
        if (!(await confirmSheet('Delete intervention?', `${label(iv)} — this cannot be undone.`, 'Delete', true))) break;
        try {
          await store.remove(id);
          store.deletePhotos(iv.photos).catch(() => {});
          removeLocal(id);
          inDialog?.close();
          renderAll();
          toast('Deleted');
        } catch (err) { toast('Could not delete: ' + (err.message || err), { error: true }); }
        break;
      }
      case 'toggle-filters': state.filtersOpen = !state.filtersOpen; renderHistory(); break;
      case 'clear-filters': state.filters = { ...defaultFilters(), period: state.filters.period, group: state.filters.group }; saveFilters(); renderHistory(); break;
      case 'more': state.historyLimit += 150; renderHistory(); break;
      case 'export': exportRows(applyFilters(state.items, state.filters)); break;
      case 'export-all': exportRows(state.items); break;
      case 'drill': {
        state.filters = { ...defaultFilters(), period: state.statsPeriod === '365' ? 'custom' : state.statsPeriod, group: 'day' };
        if (state.statsPeriod === '365') state.filters.from = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
        state.filters[a.dataset.field] = a.dataset.value;
        saveFilters(); state.filtersOpen = true; switchView('history');
        break;
      }
      case 'drill-issue': {
        const iv = find(id);
        if (!iv) break;
        state.filters = { ...defaultFilters(), period: 'all', group: 'day', machine: iv.machine || '', station: iv.station || '', component: iv.component || '', type: iv.type || '' };
        saveFilters(); state.filtersOpen = true; switchView('history');
        break;
      }
      case 'save-name': {
        const name = $('#set-name').value.trim();
        if (!name) break;
        try { state.user = await store.setName(name); toast('Name saved'); renderAll(); }
        catch (err) { toast(err.message || String(err), { error: true }); }
        break;
      }
      case 'enable-notif': enableNotifications(); break;
      case 'test-notif': testNotification(); break;
      case 'signout': {
        try {
          const reg = await navigator.serviceWorker?.ready;
          const sub = await reg?.pushManager?.getSubscription();
          if (sub) { await store.deletePushSubscription(sub.endpoint); await sub.unsubscribe(); }
        } catch { /* ignore */ }
        await store.signOut();
        location.reload();
        break;
      }
      default: break;
    }
  });

  // filters (inputs & selects)
  let qTimer;
  document.addEventListener('input', (e) => {
    const k = e.target.dataset?.filter;
    if (!k || e.target.closest('dialog')) return;
    if (k === 'q') {
      state.filters.q = e.target.value;
      clearTimeout(qTimer);
      qTimer = setTimeout(() => {
        saveFilters();
        const pos = e.target.selectionStart;
        renderHistory();
        const inp = $('[data-filter="q"]'); inp.focus(); inp.setSelectionRange(pos, pos);
      }, 250);
    }
  });
  document.addEventListener('change', (e) => {
    const k = e.target.dataset?.filter;
    if (k && k !== 'q') {
      state.filters[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      saveFilters(); renderHistory();
    }
    if (e.target.id === 'set-sound') { state.settings.sound = e.target.checked; LS.set('smc_sound', state.settings.sound); }
  });

  document.addEventListener('focusout', () => setTimeout(() => {
    if (deferredRender && !isTyping()) { deferredRender = false; renderAll(); }
  }, 50));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (pendingReminder) {
      const iv = find(pendingReminder.id);
      if (iv?.status === 'open') showReminderBanner(iv, pendingReminder.title, pendingReminder.body);
      pendingReminder = null;
    }
    reload(); // catch up after the phone was locked
  });

  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'open-intervention') handleOpenRequest(e.data.id, e.data.finish);
  });
}

function handleOpenRequest(id, finish) {
  const iv = find(id);
  if (!iv) return;
  $$('dialog').forEach((d) => d.close());
  $('.reminder')?.remove();
  if (finish && iv.status === 'open') openForm(iv, { finish: true });
  else openDetail(id);
}

function handleUrlParams() {
  const p = new URLSearchParams(location.search);
  const id = p.get('finish') || p.get('open');
  if (p.get('capture') === '1') toast('Tap the camera button to capture', { ms: 3000 });
  if (id) handleOpenRequest(id, !!p.get('finish'));
  if ([...p.keys()].length) history.replaceState(null, '', location.pathname);
}

/* ================================================================== */
/*  Data loading & realtime                                            */
/* ================================================================== */
let reloading = false;
async function reload() {
  if (!state.user || reloading) return;
  reloading = true;
  try {
    state.items = await store.list();
    $('#conn').className = 'conn ' + (DEMO ? 'demo' : 'live');
    renderAll();
  } catch (err) {
    $('#conn').className = 'conn off';
    toast('Could not load data: ' + (err.message || err), { error: true });
  } finally { reloading = false; }
}

let deferredRender = false;
const isTyping = () => !!document.activeElement?.matches('.view input, .view select, .view textarea');

function onRemote(evt, row, old) {
  if (evt === 'SYNC') return reload();
  if (evt === 'DELETE') removeLocal(old?.id);
  else upsertLocal(row);
  // don't rebuild the view while someone is typing in it (search box, name…)
  if (isTyping()) { deferredRender = true; return; }
  renderAll();
}

/* ================================================================== */
/*  Auth screen                                                        */
/* ================================================================== */
function renderAuth(mode = 'signin', msg = '') {
  $('#app').hidden = true;
  const a = $('#auth');
  a.hidden = false;
  a.innerHTML = `
    <div class="auth-card">
      <div class="brand big"><span class="logo">${I.cam}</span><div><b>SMC Maintenance</b><small>Team intervention log</small></div></div>
      <form id="auth-form">
        ${mode === 'signup' ? '<label>Your name<input name="name" required maxlength="40" autocomplete="name"></label>' : ''}
        <label>Email<input name="email" type="email" required autocomplete="email"></label>
        ${mode !== 'reset' ? `<label>Password<input name="password" type="password" required minlength="6" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"></label>` : ''}
        ${msg ? `<p class="auth-msg">${esc(msg)}</p>` : ''}
        <button class="btn primary block" type="submit">${mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}</button>
      </form>
      <div class="auth-links">
        ${mode !== 'signin' ? '<button data-mode="signin">I have an account</button>' : '<button data-mode="signup">Create an account</button>'}
        ${mode === 'signin' ? '<button data-mode="reset">Forgot password?</button>' : ''}
      </div>
    </div>`;
  $$('[data-mode]', a).forEach((b) => b.addEventListener('click', () => renderAuth(b.dataset.mode)));
  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      if (mode === 'signin') {
        state.user = await store.signIn(fd.get('email'), fd.get('password'));
        if (!started) startApp();
      } else if (mode === 'signup') {
        const { user, needsConfirm } = await store.signUp(fd.get('email'), fd.get('password'), fd.get('name'));
        if (needsConfirm) renderAuth('signin', 'Check your email to confirm your account, then sign in.');
        else { state.user = user; startApp(); }
      } else {
        await store.resetPassword(fd.get('email'));
        renderAuth('signin', 'If that email exists, a reset link was sent.');
      }
    } catch (err) {
      btn.disabled = false;
      const p = $('.auth-msg', a) || Object.assign(document.createElement('p'), { className: 'auth-msg' });
      p.textContent = err.message || String(err);
      btn.before(p);
    }
  });
}

/* ================================================================== */
/*  Boot                                                               */
/* ================================================================== */
let started = false;
async function startApp() {
  $('#auth').hidden = true;
  $('#app').hidden = false;
  if (!started) {
    started = true;
    wireGlobal();
    store.subscribe(onRemote).catch(() => {});
    setInterval(tick, 1000);
    setInterval(checkReminders, 20000);
    setInterval(() => { state.highlight = null; }, 8000);
  }
  if (!DEMO) {
    try {
      const s = await store.getSettings();
      if (s) {
        state.settings.reminder_minutes = s.reminder_minutes;
        LS.set('smc_reminder', s.reminder_minutes);
      } else {
        await store.saveSettings({ reminder_minutes: state.settings.reminder_minutes, display_name: state.user.name });
      }
    } catch { /* offline */ }
    syncPush();
  }
  switchView(state.view);
  await reload();
  handleUrlParams();
  checkReminders();
}

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  $('#conn').className = 'conn ' + (DEMO ? 'demo' : 'off');
  $('#conn').title = DEMO ? 'Demo mode — data stays on this device' : 'Connected to the team database';
  try {
    state.user = await store.init();
  } catch (err) {
    document.body.innerHTML = `<p style="padding:2rem">Could not start: ${esc(err.message || err)}</p>`;
    return;
  }
  store.onAuth((u) => {
    const prev = state.user?.id;
    state.user = u;
    // run outside the auth callback (calling Supabase inside it can deadlock)
    if (u && u.id !== prev) setTimeout(startApp, 0);
    if (!u && prev) location.reload();
  });
  if (state.user) startApp();
  else renderAuth();
}

boot();
