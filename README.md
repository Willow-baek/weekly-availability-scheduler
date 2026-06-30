# Weekly Availability Scheduler

A React + Vite weekly availability scheduler for Jaiden, Hansol, and Jieun, with Supabase Realtime sync and timezone-aware rendering.

## Live deployment

This repo includes a GitHub Pages workflow. Add these repository secrets before the first deployment:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Then enable GitHub Pages with **Source: GitHub Actions** in the repository settings.

## Setup

1. Create or update the Supabase tables by running `supabase/schema.sql` in the Supabase SQL editor. Re-run it after feature updates to add new columns such as meeting duration and attendees.
2. Copy `.env.example` to `.env.local`.
3. Add your Supabase project URL and anon key:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

4. Install and run:

```bash
npm install
npm run dev
```

Without Supabase credentials, the app still opens in local demo mode, but availability and meeting notes will not sync or persist.
