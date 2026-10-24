# Terrabithia Ops

Internal operations app for Terrabithia. Phase 0 provides Google sign-in, database-enforced access control and an empty dashboard. Business modules and historical imports are planned in [the specification](TERRABITHIA_OPS_SPEC.md).

## Current setup

- Supabase: `terrabithia-ops-mumbai` (`vjhyrurokepepvauweka`), Mumbai / `ap-south-1`.
- First administrator: `rohithmsasi@gmail.com`, seeded in `allowed_emails`.
- Vercel project: `terrabithia-ops`, separate from the public website. The existing deployment and its old Supabase integration have not been replaced in this phase.
- Phase 0 changes remain uncommitted pending owner review. Real Google administrator sign-in has been verified locally; unlisted access is covered by database and callback tests. A second Google account has not been tested in the browser.

## Local development

Use Node.js 24 LTS and pnpm. Install dependencies with `pnpm install --frozen-lockfile`, then copy `.env.example` to `.env.local` and fill in the three public values:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL of the intended Supabase project |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public publishable key for the same project |
| `NEXT_PUBLIC_APP_URL` | Exact app origin, locally `http://localhost:3000` |

The legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is accepted only as a fallback. Phase 0 does not need a service-role key or ingestion secret. Never prefix either private value with `NEXT_PUBLIC_`. `.env.local` and its backup are ignored by Git.

```sh
pnpm dev
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

The database tests run the migration against an isolated PGlite PostgreSQL instance with Supabase-style roles and JWT subject settings. They do not write to the hosted project. Callback tests cover missing/expired codes, denied accounts, database failures and redirect safety. A real browser sign-in is a separate integration check.

## Authentication setup

1. Enable Google in Supabase Authentication → Sign In / Providers. Add the Google client ID and secret there; keep the secret out of this repository.
2. In Google Cloud, authorize `https://vjhyrurokepepvauweka.supabase.co/auth/v1/callback` for this project's web OAuth client.
3. In Supabase Authentication → URL Configuration, allow `http://localhost:3000/auth/callback` for local development. Before deployment, set the production Site URL and allow its exact `/auth/callback` URL.
4. Visit `/login` and sign in using an approved Google account. Unlisted accounts land on `/no-access`, where they can sign out and choose another account.

Authorization reads the current database membership on every protected request. User metadata never grants roles. All protected pages and future mutations must call the server authorization helpers; hiding navigation or checking the layout alone is insufficient. RLS remains the final access boundary.

## Migrations and access management

The Phase 0 migration is `supabase/migrations/20261024140635_auth_foundation.sql`. It has already been applied to the Mumbai project. Create future migrations with `pnpm exec supabase migration new <name>`, test them and verify the linked project before pushing. Do not reapply this migration manually to a database that already contains it.

For a fresh project only, seed the first admin through a trusted database connection before their first login:

```sql
insert into public.allowed_emails (email, role)
values ('owner@example.com', 'admin');
```

An authenticated administrator can subsequently call the transactional RPC:

```ts
await supabase.rpc('set_user_access', {
  target_email: 'teammate@example.com',
  target_role: 'sales',
  active: true,
});
```

The operation normalizes email, updates any existing profile, records an audit event and prevents removal of the last active admin. Setting `active: false` revokes access even for existing sessions. Direct client writes to access tables and audit logs are prohibited. The administration UI belongs to Phase 5.

Supabase's advisor flags the intentionally exposed `SECURITY DEFINER` access-management RPC. It requires the caller's current database role to be admin, uses an empty search path, has no anonymous execution grant, and is covered by authorization tests. See [advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Deployment and later phases

Use the existing Ops Vercel project, not the public website project. Before the first new deployment, replace the old Supabase integration configuration with the Mumbai project's matching values, set `NEXT_PUBLIC_APP_URL` to the chosen production origin and verify Supabase's redirect allow-list. Preview environments must use a separate Supabase project or branch. Domain setup, production smoke tests and backup/restore verification remain outstanding.

Sheets remain available, but Ops does not depend on them. The future website submission flow will deliver independently to Ops and the existing Apps Script. No ingestion endpoint or spreadsheet importer is implemented yet; do not change the website or import historical records until those phases have been reviewed.

Work follows specification §14. Pause at each phase for owner review and commit only after approval.
