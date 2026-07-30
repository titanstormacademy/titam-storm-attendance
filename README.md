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

Apply the SQL files in `supabase/migrations/` in filename order. Existing installations that already ran the initial schema must also run `202607300002_legacy_parity.sql`. The first registered account becomes an administrator.

## Verification

```bash
npm run lint
npm run typecheck
npm run build
```

## Cloudflare Pages

- Build command: `npm run build`
- Output directory: `dist`
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
