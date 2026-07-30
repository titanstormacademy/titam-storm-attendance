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

Apply `supabase/migrations/202607300001_initial_schema.sql` once to a fresh Supabase project. The first registered account becomes an administrator.

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
