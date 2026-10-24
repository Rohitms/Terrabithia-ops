# Terrabithia Ops — Business Management Tool (Build Spec)

> This file is the single source of truth for building the tool. Read it fully before writing code.
> Work **phase by phase** (Section 14). After each phase: run tests, summarise what was done, list anything deferred, and stop for review.

---

## 1. Context

**Terrabithia** (terrabithia.in) is an outdoor event venue business in Kerala (Thrissur/Kochi area): weddings, haldi, engagement, bride-to-be events, farm stays. Riverside venue.

Today:
- Leads, bookings and website leads all live in **Google Sheets**.
- Website leads are added to a Sheet **automatically by a Google Apps Script**. Preserve this capture, but make Ops intake independent of the Sheet and Apps Script (§7.3). The app is the operational source of truth; the Sheet remains a parallel capture/archive.
- The public website is a Next.js site on **Vercel**, code on **GitHub**.
- The website Sheet stores the full contact name in `Name` and event details in `Occasion` (e.g. `Bride To Be December 1st Week 50pax`). Map these to parser inputs `first_name` and `last_name` respectively; preserve both raw values.

Goal: an internal web app (separate repo, own subdomain) to manage **leads, follow-ups, bookings, payments and upcoming events**, with **multi-role users**, and room to add modules later.

### Non-goals for v1
WhatsApp/Instagram API automation, invoicing/GST, public customer portal, payment gateway, native mobile app.

---

## 2. Tech Stack (fixed)

| Concern | Choice |
|---|---|
| Framework | Next.js (App Router, latest stable), TypeScript `strict` |
| UI | Tailwind CSS + shadcn/ui, lucide-react icons |
| Tables / forms | TanStack Table, react-hook-form + zod |
| Dates | date-fns + date-fns-tz (display in `Asia/Kolkata`) |
| DB / Auth | Supabase (Postgres, Auth with Google OAuth, RLS). Region: ap-south-1 (Mumbai) |
| Hosting | Vercel, subdomain of terrabithia.in (default: `app.terrabithia.in`) |
| Tests | Vitest (unit), Playwright (a few e2e smoke tests, optional in v1) |
| Package manager | pnpm |

Use `@supabase/ssr` for cookie-based auth in server components, server actions and route handlers.

---

## 3. Repository Layout

```
terrabithia-ops/
├─ src/
│  ├─ app/
│  │  ├─ (auth)/login/page.tsx
│  │  ├─ (app)/
│  │  │  ├─ layout.tsx              # shell: sidebar + topbar, role-aware nav
│  │  │  ├─ dashboard/page.tsx
│  │  │  ├─ leads/                  # list, new, [id]
│  │  │  ├─ followups/page.tsx
│  │  │  ├─ bookings/               # list, new, [id]
│  │  │  ├─ calendar/page.tsx
│  │  │  ├─ events/page.tsx         # upcoming events list
│  │  │  ├─ templates/page.tsx
│  │  │  └─ settings/{users,general}/page.tsx
│  │  └─ api/
│  │     └─ ingest/lead/route.ts    # webhook used by Apps Script / website
│  ├─ components/                   # ui/ (shadcn), plus feature components
│  ├─ lib/
│  │  ├─ supabase/{server,client,admin}.ts
│  │  ├─ auth/{getUser,requireRole}.ts
│  │  ├─ parseLead.ts               # PROVIDED BASELINE — adapt with regression tests (§7.4)
│  │  ├─ phone.ts                   # E.164 normalisation (default +91)
│  │  ├─ rules/                     # status transitions, follow-up scheduling
│  │  └─ format.ts                  # INR, dates
│  ├─ actions/                      # server actions per module
│  └─ types/                        # generated supabase types
├─ supabase/
│  ├─ migrations/                   # SQL migrations (schema in §5)
│  └─ seed.sql
├─ scripts/
│  └─ import-sheet.ts               # one-off Google Sheet importer (§9)
├─ tests/
└─ TERRABITHIA_OPS_SPEC.md           # this file
```

---

## 4. Roles & Permissions

Roles are enforced **twice**: in the database via RLS (authoritative) and in server actions via `requireRole()` (defence in depth + good error messages). UI hides what a role can't use, but never relies on that.

| Capability | admin | manager | sales | viewer |
|---|:--:|:--:|:--:|:--:|
| Manage users / roles / settings | ✅ | ❌ | ❌ | ❌ |
| Leads: view | all | all | assigned + unassigned | ❌ |
| Leads: create/edit | ✅ | ✅ | assigned to self; may claim unassigned | ❌ |
| Leads: delete | ✅ | ❌ | ❌ | ❌ |
| Follow-ups: view/edit | all | all | assigned | ❌ |
| Bookings: view | ✅ (with amounts) | ✅ (with amounts) | read-only, **no amounts** | read-only, **no amounts** |
| Bookings: create/edit | ✅ | ✅ | ❌ | ❌ |
| Payments: view/add | ✅ | ✅ | ❌ | ❌ |
| Calendar / upcoming events | ✅ | ✅ | ✅ | ✅ |
| Templates: use | ✅ | ✅ | ✅ | ❌ |
| Templates: edit | ✅ | ✅ | ❌ | ❌ |
| Dashboard money widgets | ✅ | ✅ | ❌ | ❌ |
| Global activity log / full diffs | ✅ | ✅ (read) | ❌ | ❌ |
| Lead timeline | all | all | visible leads, safe events only | ❌ |

**Access model:** Google sign-in is the only enabled provider. Access requires an active allow-list entry; an unlisted identity may authenticate but receives only the "no access" page and an inactive profile. Normalise emails with `lower(trim(email))` before storing them.

- `allowed_emails` is authoritative for role and active state. Admin-only transactional database operations add/update entries and synchronise existing `profiles`, including users who attempted login before approval. Deactivation updates both in the same transaction; signing in again must not reactivate them. Protect the last active admin from removal/deactivation/demotion.
- The auth-user creation trigger handles first login. Serialize it with allow-list updates by normalised email to avoid onboarding races. Access checks read current database state, so deactivation takes effect on subsequent requests with an existing token.
- Sales-created leads are assigned to their creator. A sales user may claim an unassigned lead through an atomic database operation; exactly one claimant wins. Staff can assign/reassign; sales cannot assign to another user. Transfer open lead follow-ups with the lead. Preserve completed follow-up ownership for history.
- New ingested leads and their follow-ups start unassigned. Staff see the unassigned follow-up queue; sales see a claim action and open-follow-up count on unassigned leads. Claiming makes the follow-ups visible to the claimant.

---

## 5. Database Schema (Supabase Postgres)

Create as ordered migrations in `supabase/migrations/`. Timezone: store `timestamptz`; pure calendar dates use `date`. Currency INR, `numeric(12,2)`.

The SQL below defines the data contract; migrations must also implement the grants, policies, transactional operations and triggers specified in §4–7. Auth tables/helpers and their policies belong to Phase 0; business tables belong to Phase 1. Do not run this block as a substitute for the complete migrations.

```sql
create extension if not exists btree_gist;
create extension if not exists pg_trgm;
create schema if not exists private; -- not exposed through the Data API

-- ENUMS
create type app_role         as enum ('admin','manager','sales','viewer');
create type lead_status      as enum ('new','contacted','site_visit','quoted','negotiating','won','lost');
create type lead_source      as enum ('website','instagram','whatsapp','phone','referral','walk_in','other');
create type date_precision   as enum ('day','week','month');
create type followup_status  as enum ('open','done','skipped');
create type followup_channel as enum ('call','whatsapp','instagram','email','visit','other');
create type booking_status   as enum ('tentative','confirmed','completed','cancelled');
create type payment_method   as enum ('cash','upi','bank_transfer','card','cheque','other');
create type booking_kind     as enum ('main','small');          -- small = small event / photoshoot
create type time_slot        as enum ('daytime','evening','full_day');
create type payment_direction as enum ('receipt','refund');
create type payment_purpose   as enum ('event','security');

-- USERS
create table allowed_emails (
  id uuid not null unique default gen_random_uuid(), -- stable audit identity before first login
  email text primary key check (email = lower(btrim(email))),
  role  app_role not null default 'viewer',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique check (email = lower(btrim(email))),
  full_name text,
  role app_role not null default 'viewer',
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

-- Trigger: on new auth user, create profile; activate + set role only if email is allow-listed.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a public.allowed_emails%rowtype;
begin
  select * into a from public.allowed_emails where email = lower(btrim(new.email));
  insert into public.profiles (id, email, full_name, role, is_active)
  values (new.id, lower(btrim(new.email)),
          coalesce(new.raw_user_meta_data->>'full_name', new.email),
          coalesce(a.role, 'viewer'),
          coalesce(a.is_active, false) and new.email_confirmed_at is not null);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- RLS helpers
create function private.current_app_role() returns app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p join public.allowed_emails a on a.email = p.email
  where p.id = auth.uid() and p.is_active and a.is_active and p.role = a.role
$$;
create function private.is_staff() returns boolean   -- admin or manager
language sql stable as $$ select private.current_app_role() in ('admin','manager') $$;

-- CONTACTS
create table contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text unique,                -- E.164, e.g. +919446606880
  email text,
  instagram text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contacts_name_trgm on contacts using gin (name gin_trgm_ops);

-- LEADS
create table leads (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id),
  status lead_status not null default 'new',
  source lead_source not null default 'website',
  event_type text,                         -- 'Wedding','Haldi','Bride to be',...
  event_date date,
  date_precision date_precision,
  guests_min int, guests_max int,
  budget numeric(12,2),
  message text,
  assigned_to uuid references profiles(id),
  site_visit_at timestamptz,
  lost_reason text,
  needs_review boolean not null default false,
  review_reasons text[] not null default '{}',
  raw_first text, raw_last text,           -- original sheet/form values, never discard
  external_id text unique,                 -- immutable submission/import identity (§7.2)
  ingest_fingerprint text,                 -- hash of canonical source payload, not parsed fields
  parse_reference_at timestamptz not null,  -- original submitted_at, never recomputed on replay
  parser_version text,
  manual_fields text[] not null default '{}', -- fields protected from automatic re-parse
  sheet_row int,
  last_activity_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lost_needs_reason check (status <> 'lost' or nullif(btrim(lost_reason), '') is not null)
);
create index leads_status_idx on leads(status);
create index leads_event_date_idx on leads(event_date);
create index leads_assigned_idx on leads(assigned_to);
create index leads_review_idx on leads(needs_review) where needs_review;

-- FOLLOW-UPS (attach to a lead and/or a booking)
create table followups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete cascade,
  booking_id uuid,                          -- FK added after bookings exists
  due_at timestamptz not null,
  channel followup_channel not null default 'whatsapp',
  note text,
  rule_key text, -- null for manual tasks; otherwise first_response/status_contacted/etc.
  status followup_status not null default 'open',
  outcome text,
  completed_at timestamptz,
  assigned_to uuid references profiles(id),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  constraint followup_target check ((lead_id is not null)::int + (booking_id is not null)::int = 1)
);
create index followups_due_idx on followups(due_at) where status = 'open';
create index followups_lead_idx on followups(lead_id);
create index followups_booking_idx on followups(booking_id);
create unique index followups_open_lead_rule on followups(lead_id, rule_key)
  where status = 'open' and rule_key is not null;
create unique index followups_open_booking_rule on followups(booking_id, rule_key)
  where status = 'open' and rule_key is not null;

-- BOOKINGS
create table bookings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid unique references leads(id),
  contact_id uuid not null references contacts(id),
  title text not null,                      -- e.g. "Arunima — Wedding"
  kind booking_kind not null default 'main',   -- 'main' = one per day; 'small' = small event / photoshoot
  slot time_slot,                           -- daytime / evening / full_day (null for multi-day stays)
  start_time time, end_time time,           -- optional exact timings (informational)
  overlap_ack boolean not null default false,  -- small booking sharing a day with a main one: owner confirmed
  event_type text not null,
  start_date date not null,
  end_date date not null,                   -- inclusive event end; checkout date for farm stays
  is_stay boolean not null default false,
  occupied_dates daterange generated always as (
    case when is_stay then daterange(start_date, end_date, '[)')
         else daterange(start_date, end_date, '[]') end
  ) stored,
  guests_expected int,
  status booking_status not null default 'tentative',

  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dates_ok check (end_date >= start_date),
  constraint stay_dates_ok check (not is_stay or (end_date > start_date and kind = 'main' and slot is null)),
  constraint small_is_single_day check (kind <> 'small' or start_date = end_date),
  -- Venue policy: ONE confirmed MAIN event per date range (daytime or evening, slot is informational).
  -- Small events / photoshoots are deliberately NOT covered; they are warned about in the app (see 6.4).
  constraint no_double_confirmed_main exclude using gist
    (occupied_dates with &&) where (status = 'confirmed' and kind = 'main')
);
alter table followups add constraint followups_booking_fk
  foreign key (booking_id) references bookings(id) on delete cascade;
create index bookings_dates_idx on bookings using gist (occupied_dates);

-- STAFF-ONLY DETAILS: never place prices or free-form notes on the shared bookings row.
create table booking_details (
  booking_id uuid primary key references bookings(id) on delete restrict,
  external_id text unique, -- immutable import ID; kept out of shared booking data
  source_fingerprint text,
  source lead_source not null default 'other',
  package_name text,
  total_amount numeric(12,2) check (total_amount >= 0), -- event price, excludes security deposit
  security_deposit_due numeric(12,2) check (security_deposit_due >= 0),
  notes text,
  overlap_note text,
  cancelled_reason text,
  completion_override_reason text
);

-- PAYMENTS
create table payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete restrict,
  external_id text unique, -- import key or payment-form operation UUID
  direction payment_direction not null default 'receipt',
  purpose payment_purpose not null default 'event',
  source_fingerprint text,
  amount numeric(12,2) not null check (amount > 0),
  paid_on date, -- required for new entries; unknown historical dates stay null, never today
  method payment_method, -- required for new entries; unknown historical method stays null
  reference text,
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index payments_booking_idx on payments(booking_id);

-- Booking money summary (staff only); RLS on booking_details/payments is authoritative.
create view booking_financials with (security_invoker = true) as
with totals as (
  select booking_id,
    coalesce(sum(case when purpose = 'event' then
      case when direction = 'receipt' then amount else -amount end else 0 end),0) as paid,
    coalesce(sum(case when purpose = 'security' and direction = 'receipt' then amount else 0 end),0) as security_received,
    coalesce(sum(case when purpose = 'security' and direction = 'refund' then amount else 0 end),0) as security_returned
  from payments group by booking_id
)
select d.booking_id, d.total_amount, coalesce(t.paid,0) as paid,
       d.total_amount - coalesce(t.paid,0) as balance,
       coalesce(t.security_received,0) as security_received,
       coalesce(t.security_returned,0) as security_returned,
       coalesce(t.security_received,0) - coalesce(t.security_returned,0) as security_held
from booking_details d left join totals t on t.booking_id = d.booking_id;

-- Amount-free view for sales / viewer roles
create view bookings_safe with (security_invoker = true) as
select id, lead_id, contact_id, title, event_type, kind, slot, start_time, end_time,
       start_date, end_date, is_stay, occupied_dates, guests_expected, status, created_at
from bookings;

-- MESSAGE TEMPLATES (the owner copy-pastes WhatsApp/Instagram replies today)
create table message_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel followup_channel not null default 'whatsapp',
  body text not null,       -- placeholders: {{name}} {{event_type}} {{event_date}} {{guests}}
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- SETTINGS: typed/validated per key by admin-only mutations; active staff can read.
create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- RAW INGEST LOG: persist authenticated, size-bounded JSON before business processing
create table raw_ingest (
  id uuid primary key default gen_random_uuid(),
  payload jsonb not null,
  result text not null default 'pending' check (result in ('pending','ok','duplicate','error','conflict')),
  error text,
  lead_id uuid references leads(id) on delete set null,
  received_at timestamptz not null default now()
);

-- SAFE LEAD TIMELINE: structured events only, no raw audit diffs or financial/free-text data.
create table lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  event text not null check (event in ('created','status_changed','assigned','reviewed','fields_updated','followup_done')),
  from_status lead_status,
  to_status lead_status,
  created_at timestamptz not null default now()
);
create index lead_events_lead_idx on lead_events(lead_id, created_at);

-- ACTIVITY LOG
create table activity_log (
  id bigint generated always as identity primary key,
  actor_id uuid references profiles(id) on delete set null,
  entity_type text not null,          -- 'lead','booking','payment','followup','user'
  entity_id uuid not null,
  action text not null,               -- 'created','status_changed','updated','deleted',...
  diff jsonb,
  created_at timestamptz not null default now()
);
create index activity_entity_idx on activity_log(entity_type, entity_id, created_at desc);

-- updated_at trigger for contacts, leads, bookings
create function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger t_contacts before update on contacts for each row execute function touch_updated_at();
create trigger t_leads    before update on leads    for each row execute function touch_updated_at();
create trigger t_bookings before update on bookings for each row execute function touch_updated_at();
```

### 5.1 RLS policy rules

Enable RLS on **every** table, with explicit grants and policies for `authenticated`; grant nothing to `anon`. Every business policy checks active membership via `private.current_app_role()`. The `private` schema is not exposed through the Data API. Helpers have a fixed search path, explicit function ownership and narrowly scoped `EXECUTE` grants; revoke default `PUBLIC` execution. Any privileged mutation must perform its own role and input checks and must never accept a caller-supplied actor as authoritative.

- `leads`: staff read all; sales read assigned-to-self and unassigned rows. Sales inserts must have `assigned_to = auth.uid()` and `created_by = auth.uid()`. Sales updates require assignment to self in both `USING` and `WITH CHECK`; a database guard prohibits changing owner, creator, import identity or raw provenance. Unassigned claim is a dedicated, row-locked privileged operation with an explicit sales-role check. Only admin deletes; linked bookings prevent deletion.
- `bookings`: contains only shared schedule fields. All active roles may select; only staff may mutate. `booking_details`, `payments` and `booking_financials` are **staff only**. Money and free-form private notes never appear in shared columns, including `title` (generated from contact name and event type). `bookings_safe` stays `security_invoker = true`; non-staff pages use it. Direct reads of `bookings` are safe too because it contains no financial columns. Do not add private columns later without revisiting this boundary.
- `profiles`: users read their own row; admin reads all. Changes to role/active state and `allowed_emails` are restricted to admin-only transactional operations (§4); prohibit direct client writes. For assignee pickers, expose only active staff IDs/display names through a role-checked directory function (no emails or inactive users).
- `contacts`: staff read/write all; sales read contacts attached to a visible lead. Sales contact creation/editing uses a transaction that validates lead ownership, dedupes by phone without revealing inaccessible contacts, and rejects editing a shared contact linked to another salesperson's assigned lead. Request staff assistance for those edits. Viewer access to bookings does not imply access to contact phone/email/notes.
- `followups`: staff read/write all; sales read/edit only assigned-to-self lead tasks whose lead is still assigned to self. Booking reminders are staff-only, including notes. A database guard prevents sales from changing target/assignee or creating tasks for inaccessible leads.
- `message_templates`: admin/manager/sales read, staff mutate. `settings`: active admin/manager/sales read, admin mutates.
- `raw_ingest`: admin read only; service-role ingestion/import writes. `activity_log`: admin/manager read; writes only from trusted database operations/triggers. `lead_events`: read when the parent lead is visible; only trusted operations write allow-listed event fields. Sales timelines use `lead_events` and their permitted follow-ups, never raw audit diffs.
- Mutations of status, assignment, booking dates, payments and user access must enforce business rules and write audit entries atomically at the database layer. UI/server-action checks supplement this. Reject direct API writes that bypass those rules; do not grant generic privileged RPC execution.

Write database/API tests using real role sessions (not the service key): sales cannot read another user's assigned lead, reassign a lead, spoof its creator or reopen a closed lead; concurrent claims have one winner; sales/viewer cannot read financial rows through tables, views, joins or RPCs; viewer has no lead/contact access; inactive users lose all business access. Also test permitted calendar reads, safe sales timelines, first login, approval after an unsuccessful first login and deactivation with an existing token.

Design references: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [PostgreSQL view permissions](https://www.postgresql.org/docs/current/sql-createview.html).

---



## 6. Business Rules

### 6.1 Lead status flow
`new → contacted → site_visit → quoted → negotiating → won | lost` (forward or backward moves allowed; `won`/`lost` can be re-opened by admin/manager).
- Moving to `lost` **requires** `lost_reason` (dialog with preset reasons: Date unavailable, Budget, Chose another venue, No response, Postponed, Other).
- Staff moving to `won` are offered **"Convert to booking"**, pre-filled from the lead. Sales may mark won but must request staff conversion. Won without a booking shows a warning badge. Approximate dates require an exact date chosen by staff before conversion; never silently use a week/month anchor as a confirmed date.
- Every real status change writes `activity_log` + a safe `lead_events` entry and updates `leads.last_activity_at` in the same transaction. Re-submitting the current status is a no-op. Only staff may reopen won/lost leads; reopening a booked lead does not silently cancel its booking.

### 6.2 Auto follow-ups

Defaults live in the typed `settings` table; admin edits them in `/settings/general`. Settings changes apply to future scheduling, not existing tasks unless explicitly rescheduled. Implement the scheduling service in Phase 1; add status triggers in Phase 2 and the task UI in Phase 3.

| Trigger | Follow-up created |
|---|---|
| New live/manual lead | `+2 hours` "First response" via WhatsApp |
| Status → `contacted` | `+2 days` |
| Status → `site_visit` | `site_visit_at + 1 day`; require visit timestamp |
| Status → `quoted` | `+3 days` |
| Status → `negotiating` | `+2 days` |
| Staff reopens to `new` | `+2 hours` "First response" |
| Booking `confirmed` | `start_date − 7 days`, 09:00 IST, "Confirm final details"; `start_date − 14 days`, 09:00 IST, balance reminder if known balance > 0 |

- All scheduling uses `Asia/Kolkata`. Relative day intervals preserve local time. A newly generated reminder whose calculated time has passed is due now. Imported historical leads/bookings create no tasks by default (§9).
- One open automatic task per target and `rule_key`, enforced by partial unique indexes. A real lead status transition skips obsolete open automatic lead tasks and creates the applicable task; manual tasks remain. Closing won/lost skips all open lead tasks with a recorded reason. Reopening creates a fresh task; completed/skipped history is retained.
- Confirmation creates booking reminders. Date changes reschedule open automatic reminders; completed reminders are not recreated automatically—show staff a prompt to add a new one. Returning to tentative skips automatic booking reminders; reconfirmation creates fresh ones. Cancellation/completion skips all open booking tasks.
- Payment/price changes close the open balance reminder when balance becomes zero/negative. If a confirmed booking again has a known positive balance, ensure an open balance reminder. Unknown price shows "Price required" and does not imply zero balance. Booking reminders start unassigned in the staff queue; staff may assign them to admin/manager only.
- Each task has exactly one target. Lead tasks inherit lead assignment; open tasks move with reassignment/claim. Database transactions update status/date/payment and dependent tasks together.
- Marking a task **done** requires an outcome note and offers "Schedule next" (tomorrow / 3 days / 1 week / custom) or permitted status actions. Update lead activity on completion and meaningful manual edits/notes; background retries and automatic scheduling do not refresh it. Never leave an active lead with zero open tasks without a visible warning.
- Snoozing changes the existing task. Manual next-task creation uses a client operation UUID to prevent double-submit duplicates. Lead edits that change `site_visit_at` reschedule its open automatic visit task.


### 6.3 Stale lead
A lead in `new..negotiating` with no activity for **7 days** (configurable) is flagged "Stale" in lists and counted on the dashboard.

### 6.4 Double-booking and small events
**Venue policy:** one **main** event per day, either daytime or evening (or a full day / multi-day stay). A **small event or photoshoot** may share the day as an exception.

- Every booking has a `kind`: `main` (wedding, engagement, haldi, bride-to-be, farm stay...) or `small` (small event, photoshoot). It also has a `slot` (daytime / evening / full_day) and optional `start_time`/`end_time`.
- **Farm stays:** `is_stay = true`; `end_date` is checkout and is excluded from occupancy. A stay from Nov 10 to Nov 12 occupies Nov 10–11, so another main event may start Nov 12. Other events include both start/end dates. All conflict checks, calendar bands, lead-date checks and import validation use `occupied_dates`.
- **Main vs main:** the DB constraint `no_double_confirmed_main` blocks overlapping **confirmed** main bookings. Tentative mains may overlap; the UI warns and requires an explicit confirm. Map the Postgres exclusion violation to a friendly error ("Date already booked by <title>").
- **Small bookings** are single-day and never hard-blocked. When creating or confirming one on a day that already has a main booking (tentative or confirmed, including occupied days of a multi-day stay, excluding checkout):
  - Show a warning listing the main booking and its slot.
  - If the slots match, or the main is `full_day`/multi-day, show a **stronger warning** ("Clashes with <main> — same slot. Consider the other slot.").
  - Require the user to tick "I've checked this works" and enter a short note; store as `bookings.overlap_ack` + staff-only `booking_details.overlap_note`.
- **Small per day:** warn when more than `max_small_per_day` (setting, default 2) small bookings fall on one date.
- **Creating or confirming a main on a day that has small bookings:** allowed; show an info banner listing them so the owner can reschedule or keep them. Require explicit acknowledgement of the current list in the save request and audit it.
- Recheck overlaps when kind, slot, dates or stay status changes. Reset stale acknowledgement when these fields change. Enforce acknowledgement + nonblank note for small/main overlap in the database mutation, not just the form. Serialize booking occupancy mutations for this single venue with one transaction-scoped advisory lock, re-read overlaps under that lock, and require retry/acknowledgement if the displayed conflict set changed. Exclude cancelled/completed bookings from active overlap warnings and small-event counts.
- **Lead date check:** show **"Date booked"** only when the lead's day has a confirmed main booking. If only small bookings exist, show **"Small event that day"** (informational).
- Photoshoots with no guests are normal: `guests_expected` stays optional.

### 6.5 Approximate dates
`date_precision` of `week`/`month` means the date is the **start** of the week/month. Show these as "1st week of Dec 2026" / "Dec 2026", not as an exact day. On the calendar they appear as a faint tentative band, never blocking.

### 6.6 Money

**Confirmed business rule: Deposit is refundable security money, separate from the event price.** Store event price in `booking_details.total_amount`; money entries use positive amounts plus `direction` (`receipt`/`refund`) and `purpose` (`event`/`security`). Never use negative payments or a boolean as the refund record.

- `paid = event receipts − event refunds`; `balance = total_amount − paid`. Security receipts/refunds never reduce the event balance. Unknown price means unknown balance, not zero.
- `security_held = security receipts − security refunds`. Allow partial/multiple refunds, recording date, method, reference and reason. Reject refunds above the available amount for that purpose, using a booking-row lock so concurrent refunds cannot overdraw it. Security retention/damage deductions are outside v1; flag for manual resolution, never silently count retained security as event revenue.
- "Event receipts this month" = event receipts minus event refunds dated in that IST calendar month; exclude security money. Show security held separately. Historical entries without payment dates are excluded from monthly totals and shown in an undated-money warning. Avoid labelling this cash measure accounting revenue.
- A staff booking creation creates its details row in the same transaction. Payments are append-only; corrections use an audited reversal/refund and replacement with explanation. Guard against repeated submission with a unique operation ID. A cancellation does not automatically issue a refund or erase payments; staff must review the refund obligation and adjust the agreed event price if appropriate.
- Completing with positive **or unknown** balance requires an admin override with a nonblank reason recorded in `completion_override_reason` and the audit log; manager completion is rejected until resolved. Outstanding security refunds remain visible even on completed/cancelled bookings.
- Use decimal-safe arithmetic or integer paise; format with `en-IN`, e.g. `₹1,25,000`. Import cross-checks follow §9; never guess amounts from a yes/no return flag.


### 6.7 Phone numbers
Normalise to E.164, default country `+91` (strip spaces, dashes, leading `0`, handle `+91`/`91` prefixes). Dedupe contacts by phone. If no phone, create the contact without one and flag the lead `needs_review`.

---

## 7. Lead Ingestion (critical feature)

### 7.1 Endpoint
`POST /api/ingest/lead`
- Server-to-server only. Header `x-ingest-secret: <INGEST_SECRET>`; constant-time compare with length handling. Reject missing/invalid secret with 401. The browser must never receive this secret.
- Require a stable `external_id` generated once per submission and reused by Ops, the Sheet, retries and imports. Reject missing IDs with 422; do not guess identity from phone/name or mutable row numbers.
- Apply a 64 KiB body cap and a distributed rate limit before persistence. Persist authenticated, parseable JSON before business-field validation. Invalid authentication/malformed JSON/oversized bodies are rejected without retaining the payload; validation errors on retained JSON are marked `error` and return 422. Raw storage failure returns 503 so the sender retries.
- JSON business schema (zod), with bounded string lengths and these optional metadata fields:

```ts
{
  external_id: string,       // e.g. "website:<submission UUID>"
  first_name: string,        // Name; allow empty with a review flag
  last_name?: string,        // Occasion: event type/date/guests
  phone?: string,
  email?: string,
  message?: string,          // separate free-form note; NOT a parser input
  source?: 'website' | 'instagram' | 'whatsapp' | 'phone' | 'referral' | 'walk_in' | 'other',
  submitted_at: string,      // immutable original timestamp, ISO with timezone
  sheet_row?: number,        // diagnostic only, never identity
  country?: string, city?: string, device_type?: string,
  os_device?: string, browser?: string, state_region?: string, traffic_source?: string
}
```

Canonical website mapping: `Name → first_name`, `Occasion → last_name`, `WhatsApp → phone`, `Submission Timestamp → submitted_at`, source `website`. A separate note maps to `message`. Store original JSON, including metadata, in `raw_ingest.payload`. Ignore the Sheet's free-form `Result` for operational status. CSV import and live intake use the same mapping.

### 7.2 Processing and transaction boundary
1. Authenticate, bound/parse the body and **commit `raw_ingest` with `result = 'pending'` independently**. Validate business fields; validation failure records a sanitised error against this attempt.
2. Normalise phone and parse `first_name` + `last_name` using the original `submitted_at` as the reference (§7.4). Invalid/missing phone is retained raw, stored as null and flagged; missing/ambiguous event fields do not reject the lead. If the parsed name is empty, store "Unknown contact" and a review flag.
3. Start one database transaction/RPC for the remaining writes. Serialize on `external_id` before any contact write. Compare a canonical payload fingerprint, excluding diagnostic row number and transport metadata, against the stored `ingest_fingerprint`.
4. Existing ID + identical business payload → duplicate, with no contact/lead/follow-up/audit mutations. Existing ID + different business payload → 409 conflict, log the attempt for admin review; never overwrite manual edits. Keep unique constraints as the final concurrency safeguard.
5. Otherwise find/create the contact by normalised phone atomically; without phone, create one only inside this winning transaction. Existing contacts retain nonempty names/contact fields/notes; differing submitted details stay in raw data and raise a review flag rather than overwriting a shared contact.
6. Insert the lead with parsed fields, immutable `raw_first`/`raw_last`, `message`, fingerprint, original `created_at`/`parse_reference_at`, parser version and review flags. For live intake, `last_activity_at` starts at submission time. Create the first-response task, full audit entry and safe lead event atomically. The ingest RPC is executable only by the ingestion service role; it is not a generic client mutation endpoint.
7. Set the raw attempt to `ok` (or `duplicate`) with `lead_id` in the same transaction; commit and return `200 { ok: true, lead_id, needs_review }` (or `{ duplicate: true, lead_id }`).

Any failure after step 2 rolls back all business writes. Update the separately committed raw attempt to `error` and return a retryable 5xx. A crash can leave `pending`; admin replay uses the original payload/ID and safely resolves either an already committed submission or a fresh retry. Provide an admin failed/pending-ingest list and replay action in Phase 1. External HTTP calls never occur inside database transactions.

### 7.3 Website integration and independent Sheet capture

**Target:** the public website's server-side form handler submits independently to Ops and the existing Apps Script. Ops is the primary durable acceptance point. Sheet delivery is a separate attempt and must never be a prerequisite for Ops delivery. This requires a reviewed change in the public website repository; until it lands, label any Apps Script bridge as temporary and do not claim independent intake is complete.

- Generate a submission UUID once, retain it across retries, and reuse the same ISO submission timestamp. Ops accepts `website:<UUID>`; add an `Ops Submission ID` column to the Sheet and store the identical ID. Apps Script must dedupe its Sheet write by that ID under a script lock. Retrying a submission must not append duplicate Sheet rows.
- The public server keeps `INGEST_SECRET` server-only, validates the form and applies abuse protection. Ops acknowledgement is required before displaying success. If Ops fails, preserve the form and ID for retry; the Sheet may still have succeeded. If the Sheet fails after Ops succeeds, the lead is safe in Ops; record a metadata-only delivery failure for reconciliation. Do not fire unawaited requests that can be dropped by a serverless runtime.
- Retry Ops network/429/5xx failures with bounded exponential backoff and the same payload; honour `Retry-After`. Inspect HTTP status and the response body, including 2xx application errors. Do not auto-retry 401/409/422 until configuration/data is corrected. Failed raw attempts and Sheet-only submissions are reconciled by ID.
- A temporary Apps Script → Ops hook may run **after** the existing Sheet write. It must reuse the Sheet's persisted submission ID/timestamp, inspect response status despite `muteHttpExceptions: true`, record delivery status/attempt count/next attempt on the Sheet and use a time-driven retry trigger. Only that temporary hook depends on Sheets; disable it when the independent website handler is verified (duplicate delivery remains harmless during overlap).

Canonical adapter for a Sheet row (values must already be validated; never generate a new identity/timestamp during retry):

```javascript
function opsPayloadFromRow_(row) {
  if (!row['Ops Submission ID'] || !row['Submission Timestamp']) {
    throw new Error('Missing persisted Ops identity or timestamp');
  }
  return {
    external_id: row['Ops Submission ID'],
    first_name: row['Name'] || '',
    last_name: row['Occasion'] || '',
    phone: row['WhatsApp'] || '',
    source: 'website',
    submitted_at: new Date(row['Submission Timestamp']).toISOString(),
    sheet_row: row.rowNumber,
    country: row['Country'], city: row['City'], device_type: row['Device Type'],
    os_device: row['OS / Device'], browser: row['Browser'],
    state_region: row['State / Region'], traffic_source: row['Traffic Source']
  };
}
```

The Sheet remains a parallel capture/archive. Editing it after cutover does not synchronise operational statuses, payments or assignments back into Ops.



### 7.4 `parseLead` (provided baseline + required corrections)
Use the provided `parseLead.ts` as the baseline in `src/lib/parseLead.ts`. Preserve the six regression cases below; corrections are allowed and required where the baseline does not meet this contract:
- Joins first + last name and extracts, in order: **guest count** (`100pax`, `150-200 pax`, `~120 guests`), **date**, **event type**; the remainder is the **name**.
- Date forms: `December 26`, `Jan 10 2027`, `28 February 2027`, `December 1st Week` (precision `week`), month only (precision `month`), `dd/mm[/yyyy]` (India day-first). No year → next occurrence relative to the **original submission's IST calendar date**, never the import/re-parse date. Pass the stored reference explicitly; adapt the baseline's UTC-only year inference to IST. If the current week/month contains the reference date, retain that period rather than jumping a year. Week labels mean day-of-month bands (1–7, 8–14, 15–21, 22–28; "last week" = last seven days of the month).
- Sets `needsReview` with reasons when date/guests/name are missing or the date is approximate. The lead is **always saved**.

Add Vitest tests with at least these cases (use a fixed `now = 2026-10-14`):

| first | last | name | eventType | eventDate | precision | guests |
|---|---|---|---|---|---|---|
| Shifa | Sangeeth December 26 100pax | Shifa Sangeeth | null | 2026-12-26 | day | 100 |
| Akshaya Anil | Bride To Be December 1st Week 50pax | Akshaya Anil | Bride to be | 2026-12-01 | week | 50 |
| Arunima | Wedding Jan 10 2027 100pax | Arunima | Wedding | 2027-01-10 | day | 100 |
| Varna Valsan | Engagement 28 February 2027 200pax | Varna Valsan | Engagement | 2027-02-28 | day | 200 |
| Meera | Haldi 12/11 150-200 guests | Meera | Haldi | 2026-11-12 | day | 150–200 |
| Anu | Wedding | Anu | Wedding | null | null | null (needsReview) |

Add tests for live website mapping, historical import/re-parse year stability, IST midnight boundaries, leap dates, invalid dates, current-month/week approximation and last-week bands. Invalid dates have both `eventDate` and `datePrecision` null plus review reasons.

Store `parse_reference_at` and `parser_version`. Admin "Re-parse selected leads" previews per-field changes from immutable `raw_first`/`raw_last` and the stored reference. Manual edits record names in `manual_fields`; automatic re-parse skips those fields. Replacing a manual correction or changing a shared contact name requires explicit per-field confirmation and an audit entry. Re-parsing never changes status, assignment, follow-ups, payments or original submission time. Historical rows without a trustworthy submission date are quarantined for a supplied reference, not inferred from today's date.

---

## 8. Modules & Screens

General UI rules: **mobile-first** (the owner will use this on a phone), large tap targets, sticky filters, loading skeletons, empty states, optimistic updates where safe, toasts for results, confirm dialogs for destructive actions. Dark mode optional.

### 8.1 Dashboard (`/dashboard`)
- Cards: new leads (7d), follow-ups due today, **overdue** follow-ups, stale leads, leads needing review, upcoming events (next 30 days).
- Staff only: event receipts this month (net of event refunds, excluding security deposits), outstanding balances (confirmed, upcoming), conversion rate by source (last 90 days).
- Lists: "Today's follow-ups" (with one-tap WhatsApp/call), "Next 5 events".

### 8.2 Leads (`/leads`, `/leads/new`, `/leads/[id]`)
- **List:** TanStack table; columns: name, phone, event type, event date (with precision formatting), guests, status chip, source, assigned to, last activity, flags (Needs review / Stale / Date booked). Search (name/phone, trigram), filters (status, source, assigned, event month, needs review, stale), sort, URL-synced filters, pagination. Quick inline status change.
- **Detail:** header with contact + big action buttons: **Call** (`tel:`), **WhatsApp** (`https://wa.me/<E164 no plus>?text=<encoded template>`), copy phone. Sections: summary, editable fields, **raw_first/raw_last** (collapsed, admin "Re-parse" preview), role-filtered timeline (safe lead events for sales; full audit for staff, plus permitted follow-ups), open follow-ups, notes, staff "Convert to booking" / sales "Request booking".
- **Needs review view:** shows raw text next to parsed fields with inline fix + "Mark reviewed".
- **New lead:** manual entry for Instagram/WhatsApp/phone leads (same data model, `source` chosen) — also runs through the same follow-up rules.

### 8.3 Follow-ups (`/followups`)
Tabs: **Overdue / Today / Upcoming / Done**. Each row: lead/booking, due time, channel, note, quick actions (WhatsApp with template picker, call, Done, Snooze: 1h / tomorrow / custom). "Done" flow per §6.2. Filter by assignee.

### 8.4 Bookings (`/bookings`, `/bookings/[id]`)
- List with status, dates, guests, total, paid, balance (staff) / without amounts (sales, viewer).
- Detail: shared summary/dates; staff-only package and private notes; **staff-only payments** table + "Add receipt/refund" (event/security); event balance and security-held summary; linked lead; follow-ups; status actions (confirm / complete / cancel with reason).
- Create from lead conversion or manually. The form asks **kind** (main / small), **slot** (daytime / evening / full day) and optional times. Conflict and overlap warnings per §6.4.

### 8.5 Calendar & Events (`/calendar`, `/events`)
- **Calendar:** month view (and agenda on mobile). Main bookings: confirmed = solid, tentative = striped/outlined, with a slot icon (sun = daytime, moon = evening). Small events/photoshoots: compact chips under the main one, and a "+1 small" badge on narrow cells. Approximate lead dates = faint band, only for leads the role can read; viewers see no lead data. Click → booking/lead; clicking a day opens that day's detail (main + small bookings + leads wanting that date). Role-aware data source (`bookings_safe` for non-staff).
- **Events list:** upcoming confirmed/tentative bookings (next 90 days default), filterable; shows days-to-go, guests, balance due (staff).

### 8.6 Templates (`/templates`)
CRUD for reusable WhatsApp/Instagram message templates with placeholders `{{name}} {{event_type}} {{event_date}} {{guests}}`. Everywhere a WhatsApp action exists, offer a template picker that fills placeholders and opens `wa.me` with the text (and a "Copy text" fallback for Instagram).

### 8.7 Settings
- `/settings/users` (admin): manage `allowed_emails`, change roles, deactivate users.
- `/settings/general` (admin): follow-up default intervals, stale-lead days, lost-reason presets, event types list, `max_small_per_day`. Status enums are fixed in v1; changing statuses requires a migration and rule updates.

### 8.8 Navigation
Sidebar (desktop) / bottom bar (mobile): Dashboard, Leads, Follow-ups, Calendar, Bookings, Templates, Settings. Hide items the role can't use. Design nav as a registry (`modules.ts`) so new modules are added by one entry + one folder.

---

## 9. Migration from Google Sheets / Excel

`scripts/import-sheet.ts` — local, idempotent, supports `.xlsx` and CSV with `--dry-run`. Never edit the original workbook. The inspected files and exact mappings are recorded in §16. Use explicit workbook/tab allow-lists; do not import charts, totals, summaries or repeated booked-date lookup tabs as records.

### 9.1 Identity, staging and replay
- Preserve each source row (including original values, formulas where available, workbook/tab/row provenance and content hash) in an admin-only import staging table. Create `import_runs` and `import_rows` migrations with stable source namespace, record key, fingerprint, raw payload, resolution overrides, processing state, error and linked target IDs. Scope grants/RLS to admin; importer writes with the service key. A dry run emits the same validation report without DB writes.
- Manual leads use `sheet-leads:<Task ID>` across tabs. Website leads use the same `Ops Submission ID` as live intake. For legacy website/bookings rows without IDs, first create an immutable import manifest assigning a UUID per record; reuse that manifest for subsequent runs. Row numbers, filenames, name/date combinations and the incomplete `slno.` column are not stable identity. A changed/reordered export requires explicit matching to the manifest; never treat it as a new batch automatically.
- Booking identity is `booking_details.external_id`. Receipt/refund identities derive from that booking key and the approved allocation entry, e.g. `<booking-id>:opening:event:receipt`. Store fingerprints. Same ID + same content is skipped; changed content is quarantined for explicit reviewed reconciliation, never an automatic financial overwrite.
- One transaction per approved source record writes contact/lead or booking/details/money/audit and marks the staging row imported. A failure rolls back the entire record. A second identical run creates zero contacts, leads, bookings or payments. Concurrent runs must have the same property.
- Dedupe contacts by validated phone. Without phone, name matches are suggestions for admin review, never automatic merges. A contact shared by several source rows may have several legitimate leads/bookings. Keep provenance and differing source notes without overwriting existing contact details.

### 9.2 Lead imports
- `Leads Terrabithia.xlsx`: import `Sheet1` rows 2–687 and headerless `Sheet2` rows 2–66 using the first seven Sheet1 column meanings. There are 686 + 65 records and no shared Task IDs between these tabs. Ignore `Chart1 ...` tabs and `booked dates` as record sources.
- Pass `Contact Name` through the parser as `first_name` and empty `last_name`: these names already contain occasion/date/pax text. Preserve it as `raw_first`; keep free-form Notes and Status as source context. Imported status remains `new`, independent of the old free-form status.
- **Owner-confirmed date correction:** use `Sortable date` as the calendar date when present, combining it with the time in `Creation Date` in IST. Preserve both originals and flag conflicts in the report. On Sheet2, parse unambiguous day-first `dd-MM-yyyy HH:mm` text; native dates without a corroborating sortable date need review if a month/day conversion is ambiguous. Missing/unresolvable reference dates stay in staging. Do not apply a blanket month/day swap.
- Normalise phone cells that Excel stored as numbers to exact digit strings (no `.0` or scientific notation) before E.164 validation. Do not invent lost digits.
- Set `created_at`, `parse_reference_at` and initial `last_activity_at` to the corrected historical timestamp. Parsing uses that stable reference (§7.4). Missing event fields save a reviewable lead, not a rejected record. Historical leads may be stale immediately; exclude them from "new leads in 7 days" unless their actual timestamp qualifies.
- Website lead imports use `Name → first_name`, `Occasion → last_name`, `WhatsApp → phone`, `Submission Timestamp → created_at/parse_reference_at`; retain optional metadata in staging/raw ingest. The website Sheet itself was **not supplied** with the two inspected workbooks; verify its actual export before production import.

### 9.3 Booking imports and money reconciliation
- Use the inspected `Event bookings.xlsx` `Sheet1` rows 2–41 only. Row 42 is totals; Sheet2 is empty. There is no phone column: `Column 2` is a slot. `Column 17` is empty and is ignored.
- Interpret `Booked date` as the event date based on the schedule data and the `booked dates` lookup tab; this is a documented inference, not a booking-creation timestamp. Preview the calendar for owner review before committing. Set a single-day event's `start_date = end_date`; stays require an explicit checkout date. Booking `created_at` is the import time because historical creation time is unavailable; preserve the source date in staging.
- `Day → daytime`, `Evening → evening`; unknown slots require review. Photoshoots/explicit shoots map to `small`; other event types map to `main` unless reviewed otherwise. Stay text requires `is_stay = true` and a supplied checkout date, never a guessed one.
- `completed → completed`, `canceled → cancelled`, `upcoming → tentative` pending staff confirmation. A past date with `upcoming` is flagged, never silently marked completed. Blank/unknown status or missing event date/type stays in staging until resolved. Confirmed imports must pass occupancy constraints; no silent downgrade of confirmed conflicts.
- `Rate → booking_details.total_amount` (event price); `Deposit → security_deposit_due` (security requirement). **Deposit is not a payment receipt.** `Advance paid + Final Payment` are the recorded gross receipts; each source amount is counted only once. Preserve the source payment breakdown and unknown dates/methods; never default historical payment dates to today or methods to bank transfer.
- The new app records every receipt/refund with a purpose, date and method. For legacy rows whose gross receipts equal `Rate + Deposit`, a reviewed opening allocation can assign `Rate` to event receipts and `Deposit` to security receipts, using null dates/methods and references to the original cells. Where security is explicitly zero and no refund ambiguity exists, receipts can be assigned to event. Partial, excess, missing or contradictory values require an explicit allocation in the import manifest; do not assume security-first/event-first collection.
- `Deposit Returned? = true` is evidence of a refund obligation already marked returned, not a new cash receipt. The inspected file has one true entry (row 4, Deposit ₹5,000). A reviewed allocation may record that security refund with unknown date/method; retain the boolean and flag inferred amount for review. False does not prove the deposit was received. Do not create a refund from a missing amount.
- Formula meanings in the source vary. The common pattern is `Total = Rate + Deposit`, `pending = Total − Advance paid − Final Payment`, `Net Revenue = Advance paid + Final Payment − IF(Deposit Returned?, Deposit, 0)`. Some Total cells instead use `SUM(Advance paid, pending)` and others are missing. Do not treat Total as received cash or Net Revenue as event revenue. Cross-check each row against its actual formula/input values, and separately reconcile event balance and security held under §6.6.
- Skip numeric zero receipt cells; keep blanks as unknown, not assumed zero, unless a reviewed source convention justifies it. Never invent a balancing payment. Quarantine financially unresolved booking records until their allocation is reviewed, retaining them visibly in the import report. Completed records with a positive/unknown event balance need an explicit admin import exception reason; do not fabricate payment or silently change their historical status.
- `referral source` belongs to `booking_details.source`; link a lead only when the relationship is verified. No phantom lead is created just to hold attribution. Preserve unmapped free text and map it to `other` until reviewed.

### 9.4 Report and cutover
Report records read, created, duplicates skipped, changed-ID conflicts, quarantined rows/reasons, review flags, date corrections, unknown payment dates, receipt/refund allocation totals and occupancy conflicts. Use source file/tab/row references; keep PII in local/admin-only reports.

Historical imports create no automatic tasks unless `--with-followups` is supplied. With that flag, schedule active leads and future active bookings only; show exact generated tasks in dry-run output. Do not retroactively generate tasks for completed/cancelled bookings. Historical import bypasses live scheduling through a restricted import operation, not a publicly supplied flag on the live endpoint.

Cutover: dry-run + resolve manifest → import → enable independent website delivery to Ops and existing Sheet capture → reconcile submission IDs for approximately two weeks → use Ops for all operational changes. The Sheet continues capturing leads as an independent copy. Ops must keep accepting leads if Sheets/Apps Script fails; remove the temporary Script→Ops bridge once direct delivery is verified.

---


## 10. Security & Privacy

- Service role key **only** in server code (`lib/supabase/admin.ts`, ingest route, scripts). Never expose to the client.
- Validate every input with zod on the server; never trust client role claims — read the role from the DB.
- `INGEST_SECRET` compared in constant time; rotate if leaked.
- Treat phone numbers/emails as personal data: no logging of full payloads to third parties, no analytics on PII.
- Add security headers (`next.config.ts`), CSRF-safe server actions only, cookie handling follows `@supabase/ssr` for the chosen browser/server flow; use HTTPS, appropriate SameSite and secure production cookies. Do not impose `httpOnly` on cookies that the browser Supabase client requires for refresh. Protect OAuth redirect destinations with an allow-list.
- Backups: enable Supabase daily backups (or schedule `pg_dump`); document restore steps in `README`.

---

## 11. Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= # preferred; legacy anon key accepted as fallback
SUPABASE_SERVICE_ROLE_KEY=          # server only
INGEST_SECRET=                      # server-to-server; website and any temporary bridge
NEXT_PUBLIC_APP_URL=https://app.terrabithia.in
DEFAULT_COUNTRY_CODE=+91
APP_TIMEZONE=Asia/Kolkata
```

Provide `.env.example` and validate public configuration at server startup (`env.ts`). Private service and ingestion secrets are server-only, validated when those capabilities are used; Phase 0 does not require them.

---

## 12. Deployment

1. Connect the GitHub repository to the existing **`terrabithia-ops` Vercel project** (separate from the public website).
2. Add the domain `app.terrabithia.in` in Vercel; at the DNS provider for terrabithia.in add a `CNAME app → cname.vercel-dns.com` (use the exact value Vercel shows).
3. Supabase: create project (Mumbai), run migrations, enable Google provider, set Site URL and redirect URLs to the production + preview + `localhost:3000` origins; create the Google OAuth client (authorised redirect URI = the Supabase callback URL).
4. Seed the first admin: insert the owner's email into `allowed_emails` with role `admin` **before** first login.
5. Set env vars in Vercel (Production + Preview). Preview deployments use a separate Supabase project or branch.

---

## 13. Quality Bar

- TypeScript `strict`, no `any` without a comment; ESLint + Prettier; generated Supabase types committed.
- Unit tests: `parseLead`, `phone`, status-transition rules, follow-up scheduling, money/balance math, Indian currency formatting.
- RLS/API tests (§5.1); ingest tests for auth, payload limits/validation, mapping, concurrent duplicates, conflicting IDs, rollback at each write, crash/replay and parser flags. Import tests must show zero new bookings/payments on a second run, quarantine changed rows, preserve historical dates, and reconcile event/security money separately. Integration tests simulate Sheet failure with Ops success and Ops failure with retry using the same submission ID.
- Server components by default; client components only where interactivity is needed.
- Every user mutation: zod validation → `requireRole()` → one database transaction (business write + derived follow-ups + audit) → commit → `revalidatePath`. Ingestion authenticates with its server secret instead of a user role. Audit failures roll back the business mutation. Raw ingestion attempts intentionally persist separately.
- Accessible forms (labels, focus states), usable at 360px width.
- Small, reviewable commits; README with setup, env, migration, and import instructions.

---

## 14. Build Phases (work in this order; stop after each)

### Phase 0 — Scaffold
- [x] Next.js + TS + Tailwind + shadcn/ui, pnpm, ESLint/Prettier, Vitest.
- [x] Supabase client helpers (server/client/admin), `env.ts`, `.env.example`.
- [x] Minimal auth migrations: `app_role`, private helpers, `allowed_emails`, `profiles`, auth trigger, grants/RLS and admin access-sync operation; seed the first admin. Include the audit table needed by access mutations.
- [x] App shell: sidebar/bottom nav registry, protected `(app)` layout, `/login` with Google OAuth and callback handling.
- [x] Auth tests: initial access, deny unlisted account, activate an existing inactive profile, deactivate with an existing session, protect last admin.
- **Done when:** an allow-listed Google account can sign in and see an empty dashboard; a non-listed account sees "no access".

Phase 0 verification (24 October 2026): production build, TypeScript, ESLint and 20 automated tests pass; real Google admin sign-in reaches the local dashboard. Unlisted-account access is covered by database and callback tests; a second Google account has not been exercised in the browser. Changes await owner review and remain uncommitted.

### Phase 1 — Schema, roles, ingestion
- [ ] Remaining §5 business migrations (do not recreate Phase 0 auth objects), grants/RLS per §5.1 and RLS/API tests; shared booking data separated from staff-only details/payments.
- [ ] Parser baseline adapted to §7.4 with historical/IST/re-parse tests; `phone.ts` + tests.
- [ ] Scheduling service + first-response rule, settings defaults, unassigned staff queue data and transactional audit/safe events.
- [ ] Transactional `/api/ingest/lead`, durable raw attempts, failed/pending list + admin replay, body limits/distributed rate limits, concurrent retry tests.
- [ ] Independent website-server integration per §7.3, stable submission IDs and continued Sheet capture; document any temporary Apps Script bridge and its removal criteria.
- [ ] `scripts/import-sheet.ts` with `--dry-run` (§9).
- **Done when:** a POST atomically creates contact + lead + follow-up; concurrent replay creates no duplicates; a forced mid-write failure leaves only the recoverable raw attempt; sample imports report correct counts/review flags and repeat without new money rows. Website intake still succeeds when Sheet capture fails. Unknown historical mappings are quarantined, not guessed; production booking import waits for their resolution.

### Phase 2 — Leads
- [ ] Leads list (search/filters/sort), detail, create, edit, transactional status changes + scheduling, lost-reason dialog, needs-review workflow, admin re-parse preview, atomic claim/assignment and safe lead timeline.
- [ ] Call / WhatsApp buttons (template picker can be a stub until Phase 4).
- **Done when:** the owner can create, claim, edit, review and move leads through statuses on a phone; scheduling is correct and won leads await staff conversion until Phase 4.

### Phase 3 — Follow-ups & dashboard
- [ ] Follow-up lifecycle integration tests (§6.2), follow-ups page (Overdue/Today/Upcoming/Done), done/snooze/next flows, stale-lead flag.
- [ ] Dashboard v1 (non-money widgets).
- **Done when:** "Today" shows everything due, and finishing one prompts the next step.

### Phase 4 — Bookings, payments, calendar, templates
- [ ] Lead → booking conversion, bookings list/detail, event receipts/refunds, security deposits/refunds, separate balances, status actions and booking reminder lifecycle.
- [ ] Double-booking handling (§6.4) incl. friendly error mapping; `bookings_safe` for sales/viewer.
- [ ] Calendar (month + agenda), events list, approximate-date bands.
- [ ] Message templates CRUD + picker wired into all WhatsApp actions.
- [ ] Dashboard money widgets (staff only).
- **Done when:** a second confirmed *main* booking on the same day is rejected with a clear message; a *small* booking/photoshoot on a day with a main booking saves only after the overlap warning is acknowledged; and a sales user can see the calendar but no amounts.

### Phase 5 — Users, settings, hardening
- [ ] `/settings/users` (allowed emails, roles, deactivate), `/settings/general`.
- [ ] Admin global activity log; lead timeline ships in Phase 2 and booking timeline in Phase 4.
- [ ] Hardening review: security headers, error boundaries, 404/403 pages, README and backup/restore verification. Ingest body limits/rate limiting already ship in Phase 1.
- **Done when:** the admin can onboard a new staff member with a role in under a minute and the role is demonstrably enforced.

---

## 15. Decisions and remaining migration checks

### Confirmed with the owner
1. Security deposits are refundable and separate from the event price. The new workflow records event/security receipts and refunds separately; legacy sheet conventions do not dictate the app's workflow.
2. Farm-stay checkout day is available for another main event. Model stays as `[check-in, checkout)` and ordinary events as inclusive dates.
3. Keep the Sheet, but Ops intake must not depend on it. The public website server delivers independently to Ops and the existing Apps Script (§7.3).
4. The Sheet's `Day` label means daytime. Use the `daytime` slot label/enum, distinct from `evening` and `full_day`.
5. `Sortable date` is the correct lead calendar date; retain the time from `Creation Date` (§9.2).

### Implementation defaults
- One main event per occupied day; small events may overlap only after required checks. Room-level farm-stay inventory is deferred.
- `app.terrabithia.in` remains the default subdomain. Status enums are fixed; lost reasons, event types and follow-up intervals are configurable.
- Historical imports do not generate follow-ups by default. Sales may atomically claim an unassigned lead; staff control reassignment and booking conversion.

### Required checks before production migration
- Preview the inferred `Booked date → event date` mapping. `upcoming` is imported as tentative because confirmation cannot be inferred from the label alone; staff review is required before confirming.
- Resolve the specific incomplete booking rows, stay checkout dates, ambiguous legacy payment splits/refund evidence and Sheet2 lead dates flagged in the import report. These block affected records, not scaffolding or new live records.
- Obtain/inspect the website-leads export and the current website form/Apps Script integration before shipping the independent delivery change. The attached leads workbook is the manual tracker, not the website-leads Sheet.

---


## 16. Verified workbook mappings and website payload contract

Inspected on 2026-10-24: `Event bookings.xlsx` and `Leads Terrabithia.xlsx` supplied by the owner. Source files remain unchanged. Record-level PII stays in the files, not this spec. The website Sheet headers below are from the original spec and still require export verification.

### 16.1 Manual leads tracker — `Leads Terrabithia.xlsx`

| Sheet column | Maps to | Notes |
|---|---|---|
| Contact Name | Parser `first_name`; parsed `contacts.name` and lead fields | Contains names plus event/date/guest details; preserve raw text |
| Phone Number | `contacts.phone` | Numeric Excel values require lossless digit normalisation before E.164 |
| Notes | Contact notes/source context | Preserve existing notes on dedupe |
| Creation Date | Time component of historical lead timestamp | IST; mixed native datetimes and day-first strings |
| Sortable date | Authoritative calendar date for timestamp | Owner-confirmed correction; preserve both raw values |
| Status | Source context | All imported leads start `new` |
| WhatsApp Chat | Source context | Do not use URL as a contact identity |
| Task ID | `leads.external_id` | Prefix `sheet-leads:`; same namespace across tabs |

`Sheet1`: 686 records, rows 2–687. `Sheet2`: 65 additional records, rows 2–66, no header row; positional columns A:G match Sheet1. No Task ID overlap was found. Exclude the three `Chart1 ...` summary tabs and `booked dates` from lead import. D2/H2 disagree (May 2 vs February 5, 2026), illustrating the owner-confirmed calendar correction. Sheet2 has no Sortable date and needs its own ambiguity checks.

### 16.2 Website leads Sheet — contract, export not yet inspected

| Sheet column | Maps to | Notes |
|---|---|---|
| Ops Submission ID | `external_id` | New persisted field shared with website/Ops; backfill legacy IDs through manifest |
| Date | Source context | Prefer Submission Timestamp |
| Name | `first_name` / `raw_first` | Full name |
| Occasion | `last_name` / `raw_last` | Parser input for event type/date/pax; never moved into `message` |
| WhatsApp | `phone` | E.164 normalisation |
| Result | Source context | Does not control lead status |
| Submission Timestamp | `submitted_at` / `parse_reference_at` / `created_at` | Immutable original ISO timestamp with timezone |
| Country | `country` metadata | Raw payload only |
| City | `city` metadata | Raw payload only |
| Device Type | `device_type` metadata | Raw payload only |
| OS / Device | `os_device` metadata | Raw payload only |
| Browser | `browser` metadata | Raw payload only |
| State / Region | `state_region` metadata | Raw payload only |
| Traffic Source | `traffic_source` metadata | Raw payload only |

### 16.3 Event bookings — `Event bookings.xlsx`, `Sheet1`

| Sheet column | Maps to | Notes |
|---|---|---|
| slno. | Source context only | Incomplete; not an idempotency key |
| Booked date | Event start/end, subject to import preview | Schedule-date inference; never `created_at`; stay checkout must be supplied separately |
| Name | Contact candidate / booking title | No phone in this workbook; review name matches |
| Column 2 | `bookings.slot` | `Day → daytime` (11 rows), `Evening → evening` (29 rows) |
| Event status | `bookings.status` | `completed → completed` (18), `canceled → cancelled` (4), `upcoming → tentative` pending confirmation (17); one blank |
| Occassion | `bookings.event_type` | Header typo is intentional; explicit shoots are small; stays need checkout |
| referral source | `booking_details.source` | Preserve original text; map unknown labels to `other` |
| Pax | `bookings.guests_expected` | Optional; photoshoots can have no guests |
| Rate | `booking_details.total_amount` | Event price, excluding security |
| Deposit | `booking_details.security_deposit_due` | Required refundable security; **not an additional receipt** |
| Advance paid | Gross receipts to allocate | Preserve source amount; allocate once to event/security (§9.3) |
| Final Payment | Gross receipts to allocate | Same; do not assume date/method |
| pending | Source reconciliation value | Common formula includes unpaid event price + security requirement |
| Total | Source reconciliation value | Often Rate + Deposit, sometimes SUM(Advance paid, pending); not cash received |
| Deposit Returned? | Source refund evidence | Boolean; reviewed security refund entry, not a standalone accounting field |
| Net Revenue | Source reconciliation value | Receipts less marked security return; not authoritative event revenue |
| Column 17 | Ignored | Empty in inspected file |

There are 40 record rows (2–41); row 42 is a totals row and must be excluded. Sheet2 is empty. Rows 30 and 39 lack event dates; row 36 lacks status; row 20 mentions a stay but has no checkout. Several rows lack event type or price. Some `upcoming` dates are already past. Preserve and flag these instead of inferring missing facts.

Money evidence: row 4 has Rate ₹23,000 + Deposit ₹5,000 = Total ₹28,000, with Advance ₹16,500 + Final ₹11,500 = receipts ₹28,000, and the return box checked. Adding Deposit as a third receipt would overstate cash by ₹5,000. This row supports an approved opening allocation of event receipt ₹23,000, security receipt ₹5,000 and security refund ₹5,000, with unknown transaction dates/methods. Row 13's different Total formula (`SUM(K13,M13)`) demonstrates why source formula reconciliation is required.

### 16.4 Canonical payload

§7.1 is the authoritative payload contract; §7.3 provides the single Sheet adapter. Do not maintain a second conflicting payload example. New website submissions supply `external_id`, `submitted_at`, `first_name = Name`, `last_name = Occasion`, phone and optional metadata; `message` is a separate note only.



## 17. Future Modules (design the nav/registry so these slot in)
Quotes & tariff PDF generator · expenses & vendor tracking · staff/task assignment for events · post-event feedback & review requests · inventory (decor, tents, furniture) · reports (conversion by source, monthly revenue, occupancy) · WhatsApp Business API integration · Google Calendar sync · farm-stay room management.
