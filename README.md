# Titan Storm Basketball Academy

React, Supabase, and Cloudflare Pages application for managing students, classes, attendance, payments, coaches, payouts, and branch operations.

## Stack

- React + TypeScript + Vite
- Mantine UI
- Supabase Auth, PostgreSQL, Storage, and Edge Functions
- Cloudflare Pages

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Configure `.env.local` with the Supabase project URL and publishable key. Never expose a Supabase secret or service-role key in frontend variables.

## Database

Apply the SQL files in `supabase/migrations/` in filename order. Existing installations that already ran the initial schema must also run `202607300002_legacy_parity.sql`. New accounts always start as staff. To bootstrap the first account administrator, create the account and run this once in the Supabase SQL Editor, replacing the email:

```sql
update public.profiles
set role = 'admin', login_kind = 'account'
where id = (select id from auth.users where email = 'owner@example.com');
```

After bootstrap, that administrator can assign roles from Settings.

## Verification

```bash
npm run lint
npm run typecheck
npm run build
npm run test:e2e
npx supabase test db
```

## Cloudflare Pages

- Build command: `npm run build`
- Output directory: `dist`
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
