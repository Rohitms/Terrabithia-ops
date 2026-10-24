# Phase 0 review — 24 October 2026

The scaffold and authentication foundation were reviewed and approved for commit on 24 October 2026. Business modules, historical imports and the production rollout remain in later phases.

## Implemented

- Mumbai Supabase project `vjhyrurokepepvauweka`, Google provider enabled, and `rohithmsasi@gmail.com` seeded as admin.
- Auth migration, generated database types, RLS, private authorization helpers and an audited administrator-only access mutation.
- Verified email required for activation; user-supplied metadata cannot choose a role. Approving an existing account updates its profile. Deactivation applies to existing sessions. Last-admin protection prevents removal, demotion or deactivation.
- Server-only data access, validated public environment configuration at startup, session refresh and independent page guards.
- Google login/callback error handling, fixed redirect destinations, account switching via sign-out, and a dashboard that shows only the user's actual identity/role.
- Responsive navigation sends serializable role data to client components and only links implemented pages.
- Next.js 16.4.1 and Zod 4.6.6 replace dependencies with known security advisories.
- README and specification reflect refundable security deposits, daytime slots, checkout-day availability, independent website intake and explicit historical import review.

## Verification

| Check | Result |
| --- | --- |
| Production build | Passed |
| TypeScript strict check | Passed |
| ESLint | Passed |
| Vitest | 20 tests passed |
| Production dependency audit | Zero reported vulnerabilities |
| Real Google admin sign-in | Dashboard reached in browser; profile is active and verified in hosted database |
| Dashboard browser console | No warnings/errors observed |
| Signed-out `/dashboard` and `/no-access` | Redirect to `/login` |
| Missing/invalid callback code | Redirect to login error; cannot redirect to an external `next` URL |
| Hosted anonymous access to profiles, allow-list and audit log | All returned HTTP 401 |
| Unlisted account, role changes, deactivation, last-admin protection | Isolated PostgreSQL/RLS tests passed |
| Supabase security advisor | One intentional warning: authenticated execution of the admin-checked access RPC |

A second, unlisted Google account has not been exercised in the real browser. The no-access decision is covered by database and callback tests. Mobile layout has not yet been tested on a physical phone. The isolated database tests do not constitute a concurrent hosted-database load test.

The RPC warning is expected because PostgreSQL's `authenticated` role includes all signed-in app users. The function checks the caller's current application role before writing, uses an empty search path and denies anonymous execution. Tests prove unlisted users and managers cannot use it. [Supabase advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Review and next phase

Review the local app at `http://localhost:3000/dashboard`. Phase 0 is approved for commit; Phase 1 awaits the owner's instruction to continue.

Vercel is identified and linked locally, but its existing deployment has not been replaced. Its existing environment variables still belong to the old integration. Production environment replacement, preview database isolation, domain setup, Git remote/CI, deployment smoke tests and backup/restore verification remain outstanding. The public website and Sheets are unchanged.
