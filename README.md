# SMC Maintenance Log

A phone-first web app for sharing maintenance interventions across the team.
It uses **Supabase** for the shared database, photos, logins and live updates, and **Netlify** for hosting and the background reminder job.
It installs on phones like a normal app ("Add to Home Screen").

## What it does

| Feature | How it works |
|---|---|
| **Instant capture** | Tap the yellow camera button. The photo uploads straight away and an *ongoing* intervention starts with its timer running from that moment. |
| **Fill details later** | When the job is done, tap **Finish**. Choose Machine (SMC1–8), Station, Component (Cassette 1–10, Conveyor 1–4, Asyrile, Scanners, Main cabinet, AI) and Type (Maintenance, Adjustment, Spare part, Code, Programming), then add a description. You can also add more photos. |
| **Actual or manual time** | *Actual time* records the time from the photo until Finish, and you can edit the start and end. *Manual* lets you type the action duration yourself. |
| **"Is it finished?" reminders** | Pick an interval in Settings (5 min to 2 h). While one of your interventions is open you get a reminder each time that interval passes. It comes as a banner with a sound when the app is open, and as a phone notification when the app is closed (needs background push, see step 3). |
| **Same issue again** | Tap ↻ on any intervention (or *Same issue again* on its detail page). Everything is copied, so you only change the duration, or you can start a new timer. When you fill in a new intervention, **"Same as a previous issue…"** fills in all the fields in one tap. |
| **Filters and categories** | You can search, filter by period, machine, station, component (including "all cassettes" and "all conveyors"), type, status and "only mine", and group by day, machine, station, component, type, person or same issue. Each group shows its count and total time. |
| **Statistics** | Shows counts and time spent per machine, type, station and component, plus the issues that keep coming back. Tap a bar to open that list. |
| **Edit, delete, export** | Anyone in the team can edit an intervention, but only the person who created it can delete it. You can export the filtered list or all data to CSV (opens in Excel). |
| **Live team sync** | Changes from teammates show up instantly, without refreshing. |

## Project structure

```
public/                   ← the website (no build step needed)
  index.html, css/app.css
  js/app.js               ← screens & logic
  js/store.js             ← Supabase data layer (+ local demo mode)
  js/lists.js             ← the choice lists (edit to add machines/components…)
  js/config.js            ← keys (generated on Netlify from env vars)
  sw.js                   ← offline shell + notifications
netlify/functions/reminders.mjs   ← runs every 5 min, sends push reminders
supabase/schema.sql       ← tables, security rules, photo storage
scripts/                  ← build-config + VAPID key generator
```

---

## Setup (about 15 minutes)

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste all of `supabase/schema.sql` and click **Run**.
3. Go to **Project Settings → API** and copy three values:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** key → `SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (secret. It goes only into Netlify, never into the website.)
4. Go to **Authentication → URL Configuration** and set **Site URL** to your Netlify address (after step 4 below). Sign-up confirmation and password-reset emails use this address.
5. *(Recommended)* Once all your team members have created accounts, turn off **Allow new users to sign up** in Supabase’s Authentication settings. Strangers then can't register. You can still add people later from **Authentication → Users → Add user**.

### 2. Push keys (for reminders when the app is closed)

On any computer with Node.js 18 or newer:

```bash
node scripts/generate-vapid-keys.mjs
```

It prints `VAPID_PUBLIC_KEY=…` and `VAPID_PRIVATE_KEY=…`. Keep both.

### 3. Netlify

1. Put this folder in a GitHub, GitLab or Bitbucket repository.
2. In Netlify, go to **Add new site → Import an existing project** and choose the repository. The build settings are read from `netlify.toml`, so you don't need to change anything.
3. Go to **Site configuration → Environment variables** and add:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | from step 1 |
| `SUPABASE_ANON_KEY` | from step 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | from step 1 (secret) |
| `VAPID_PUBLIC_KEY` | from step 2 |
| `VAPID_PRIVATE_KEY` | from step 2 (secret) |
| `VAPID_SUBJECT` | `mailto:you@yourcompany.com` |

4. Go to **Deploys → Trigger deploy**. When it finishes, put the site URL into Supabase (step 1.4).

The **reminders** function shows up under **Logs → Functions** and runs every 5 minutes.

> **Drag-and-drop deploy (no Git)?** You can drag the `public/` folder onto Netlify instead. Before you do, put your URL and anon key into `public/js/config.js` by hand. The background push job will not run this way. In-app reminders still work while the app is open or in the background.

### 4. On each phone

1. Open the site and create an account (name, email, password).
2. Install it:
   - **Android (Chrome):** menu ⋮ → *Install app* / *Add to Home screen*
   - **iPhone (Safari):** Share → *Add to Home Screen*. This is required on iPhone for notifications, and needs iOS 16.4 or newer.
3. Open **Settings** in the app, choose the reminder interval and tap **Enable notifications**.

---

## Try it without Supabase (demo mode)

If `config.js` has no keys, the app runs in **demo mode**. Data stays in that browser only and the dot in the top bar is yellow. To run it locally:

```bash
cd public && python3 -m http.server 5173
# open http://localhost:5173
```

## Customising

- **Lists**: edit `public/js/lists.js`. For example, add `SMC9` or rename a station. Existing records keep their old text.
- **Reminder choices**: `REMINDER_CHOICES` in the same file.
- **Colours**: CSS variables at the top of `public/css/app.css`. `--accent` is the safety yellow.

## Notes

- Photos are resized to at most 1600 px (JPEG) before upload so they stay quick over factory Wi-Fi or mobile data. They are stored in a **private** bucket that only signed-in team members can read.
- The app loads the latest 3000 interventions. Filtering and statistics run on the phone, so they are instant.
- Background reminders are checked every 5 minutes. A 5-minute interval can therefore arrive up to 5 minutes late when the app is closed. While the app is open, reminders are on time.
- A reminder is never sent twice. The app and the server job share the `last_reminder_at` field.
