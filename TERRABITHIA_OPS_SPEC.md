# Terrabithia Ops — Business Management Tool (Build Spec)

> This file is the single source of truth for building the tool. Read it fully before writing code.
> Work **phase by phase** (Section 14). After each phase: run tests, summarise what was done, list anything deferred, and stop for review.

---

## 1. Context

**Terrabithia** (terrabithia.in) is an outdoor event venue business in Kerala (Thrissur/Kochi area): weddings, haldi, engagement, bride-to-be events, farm stays. Riverside venue.

Today:
- Leads, bookings and website leads all live in **Google Sheets**.
- Website leads are added to a Sheet **automatically by a Google Apps Script**. This must keep working and is important to the owner.
- The public website is a Next.js site on **Vercel**, code on **GitHub**.
- Contact name is stored in the Sheet's *first name* field. **Occasion date and expected guest count are stored in the *last name* field** (e.g. `Bride To Be December 1st Week 50pax`). The new system must parse these automatically.

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
│  │  ├─ parseLead.ts               # PROVIDED FILE — copy as-is (see §7.4)
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
└─ SPEC.md                          # this file
```

---

## 4. Roles & Permissions

Roles are enforced **twice**: in the database via RLS (authoritative) and in server actions via `requireRole()` (defence in depth + good error messages). UI hides what a role can't use, but never relies on that.

| Capability | admin | manager | sales | viewer |
|---|:--:|:--:|:--:|:--:|
| Manage users / roles / settings | ✅ | ❌ | ❌ | ❌ |
| Leads: view | all | all | assigned + unassigned | ❌ |
| Leads: create/edit | ✅ | ✅ | ✅ (own/assigned) | ❌ |
| Leads: delete | ✅ | ❌ | ❌ | ❌ |
| Follow-ups: view/edit | all | all | assigned | ❌ |
| Bookings: view | ✅ (with amounts) | ✅ (with amounts) | read-only, **no amounts** | read-only, **no amounts** |
| Bookings: create/edit | ✅ | ✅ | ❌ | ❌ |
| Payments: view/add | ✅ | ✅ | ❌ | ❌ |
| Calendar / upcoming events | ✅ | ✅ | ✅ | ✅ |
| Templates: use | ✅ | ✅ | ✅ | ❌ |
| Templates: edit | ✅ | ✅ | ❌ | ❌ |
| Dashboard money widgets | ✅ | ✅ | ❌ | ❌ |
| Activity log | ✅ | ✅ (read) | ❌ | ❌ |

**Access model:** no open signup. An admin adds an email to `allowed_emails` with a role; the user then signs in with Google. Anyone not on the list gets a "no access" page (profile is created with `is_active = false`).

---

## 5. Database Schema (Supabase Postgres)

Create as ordered migrations in `supabase/migrations/`. Timezone: store `timestamptz`; pure calendar dates use `date`. Currency INR, `numeric(12,2)`.

```sql
create extension if not exists btree_gist;
create extension if not exists pg_trgm;

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
create type time_slot        as enum ('morning','evening','full_day');

-- USERS
create table allowed_emails (
  email text primary key,
  role  app_role not null default 'viewer',
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role app_role not null default 'viewer',
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

-- Trigger: on new auth user, create profile; activate + set role only if email is allow-listed.
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare a allowed_emails%rowtype;
begin
  select * into a from allowed_emails where lower(email) = lower(new.email);
  insert into profiles (id, email, full_name, role, is_active)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.email),
          coalesce(a.role, 'viewer'),
          a.email is not null);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- RLS helpers
create function app_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and is_active
$$;
create function is_staff() returns boolean   -- admin or manager
language sql stable as $$ select app_role() in ('admin','manager') $$;

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
  lost_reason text,
  needs_review boolean not null default false,
  review_reasons text[] not null default '{}',
  raw_first text, raw_last text,           -- original sheet/form values, never discard
  external_id text unique,                 -- idempotency key (see §7.2)
  sheet_row int,
  last_activity_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lost_needs_reason check (status <> 'lost' or lost_reason is not null)
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
  status followup_status not null default 'open',
  outcome text,
  completed_at timestamptz,
  assigned_to uuid references profiles(id),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  constraint followup_target check (lead_id is not null or booking_id is not null)
);
create index followups_due_idx on followups(due_at) where status = 'open';

-- BOOKINGS
create table bookings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid unique references leads(id),
  contact_id uuid not null references contacts(id),
  title text not null,                      -- e.g. "Arunima — Wedding"
  kind booking_kind not null default 'main',   -- 'main' = one per day; 'small' = small event / photoshoot
  slot time_slot,                           -- morning / evening / full_day (null for multi-day stays)
  start_time time, end_time time,           -- optional exact timings (informational)
  overlap_ack boolean not null default false,  -- small booking sharing a day with a main one: owner confirmed
  overlap_note text,                        -- e.g. "photoshoot 6-8am, before wedding setup"
  event_type text not null,
  start_date date not null,
  end_date date not null,                   -- same as start_date for single-day events
  guests_expected int,
  package_name text,
  total_amount numeric(12,2),
  status booking_status not null default 'tentative',
  notes text,
  cancelled_reason text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dates_ok check (end_date >= start_date),
  constraint small_is_single_day check (kind <> 'small' or start_date = end_date),
  -- Venue policy: ONE confirmed MAIN event per date range (morning or evening, slot is informational).
  -- Small events / photoshoots are deliberately NOT covered; they are warned about in the app (see 6.4).
  constraint no_double_confirmed_main exclude using gist
    (daterange(start_date, end_date, '[]') with &&) where (status = 'confirmed' and kind = 'main')
);
alter table followups add constraint followups_booking_fk
  foreign key (booking_id) references bookings(id) on delete cascade;
create index bookings_dates_idx on bookings using gist (daterange(start_date, end_date, '[]'));

-- PAYMENTS
create table payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  paid_on date not null default current_date,
  method payment_method not null default 'upi',
  reference text,
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- Booking money summary (staff only)
create view booking_financials with (security_invoker = true) as
select b.id as booking_id, b.total_amount,
       coalesce(sum(p.amount),0) as paid,
       coalesce(b.total_amount,0) - coalesce(sum(p.amount),0) as balance
from bookings b left join payments p on p.booking_id = b.id
group by b.id;

-- Amount-free view for sales / viewer roles
create view bookings_safe with (security_invoker = true) as
select id, lead_id, contact_id, title, event_type, kind, slot, start_time, end_time,
       start_date, end_date, guests_expected, status, created_at
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

-- RAW INGEST LOG: store every incoming payload FIRST so a lead is never lost
create table raw_ingest (
  id uuid primary key default gen_random_uuid(),
  payload jsonb not null,
  result text,              -- 'ok','duplicate','error'
  error text,
  lead_id uuid references leads(id),
  received_at timestamptz not null default now()
);

-- ACTIVITY LOG
create table activity_log (
  id bigint generated always as identity primary key,
  actor_id uuid references profiles(id),
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

Enable RLS on **every** table. Policies must follow the matrix in §4. Required patterns:

```sql
alter table leads enable row level security;

create policy leads_select on leads for select using (
  app_role() in ('admin','manager')
  or (app_role() = 'sales' and (assigned_to = auth.uid() or assigned_to is null))
);
create policy leads_insert on leads for insert with check (app_role() in ('admin','manager','sales'));
create policy leads_update on leads for update using (
  app_role() in ('admin','manager')
  or (app_role() = 'sales' and assigned_to = auth.uid())
);
create policy leads_delete on leads for delete using (app_role() = 'admin');
```

- `payments`, `booking_financials`, base `bookings` table: **staff only** (admin/manager).
- `sales`/`viewer` read bookings **only via `bookings_safe`** (grant select on the view; the base table policy denies them). Since the view is `security_invoker`, add a narrow select policy on `bookings` for sales/viewer **or** make `bookings_safe` `security_definer` with a role check — pick one and document it in the migration. The calendar and events pages must use `bookings_safe` for non-staff.
- `profiles`: users can read their own row; admin can read/update all. `allowed_emails`: admin only.
- `raw_ingest`: admin read only; writes happen with the service role key.
- `contacts`: visible to anyone who can see a lead for that contact (join-based policy) plus staff.
- `activity_log`: insert via service/server only; read for admin/manager.

Write **RLS tests** (SQL or Vitest against a local Supabase) proving: a sales user cannot read another user's assigned lead, cannot read payments, and a viewer cannot see `total_amount`.

---

## 6. Business Rules

### 6.1 Lead status flow
`new → contacted → site_visit → quoted → negotiating → won | lost` (forward or backward moves allowed; `won`/`lost` can be re-opened by admin/manager).
- Moving to `lost` **requires** `lost_reason` (dialog with preset reasons: Date unavailable, Budget, Chose another venue, No response, Postponed, Other).
- Moving to `won` opens **"Convert to booking"** pre-filled from the lead (contact, event type, date, guests). Won without a booking is allowed but shows a warning badge.
- Every status change writes `activity_log` and updates `leads.last_activity_at`.

### 6.2 Auto follow-ups (defaults configurable in `settings/general`, stored in a `settings` key-value table or env for v1)
| Trigger | Follow-up created |
|---|---|
| New lead ingested | `+2 hours` "First response" via WhatsApp |
| Status → `contacted` | `+2 days` |
| Status → `site_visit` | `+1 day` after the visit |
| Status → `quoted` | `+3 days` |
| Status → `negotiating` | `+2 days` |
| Booking `confirmed` | follow-up at `start_date − 7 days` ("Confirm final details") and balance reminder at `start_date − 14 days` if balance > 0 |

Marking a follow-up **done** prompts: *outcome note* + *"Schedule next follow-up"* (quick chips: tomorrow / 3 days / 1 week / custom) or *"Mark lead won/lost"*. Never leave an active lead with zero open follow-ups without a visible warning.

### 6.3 Stale lead
A lead in `new..negotiating` with no activity for **7 days** (configurable) is flagged "Stale" in lists and counted on the dashboard.

### 6.4 Double-booking and small events
**Venue policy:** one **main** event per day, either morning or evening (or a full day / multi-day stay). A **small event or photoshoot** may share the day as an exception.

- Every booking has a `kind`: `main` (wedding, engagement, haldi, bride-to-be, farm stay...) or `small` (small event, photoshoot). It also has a `slot` (morning / evening / full_day) and optional `start_time`/`end_time`.
- **Main vs main:** the DB constraint `no_double_confirmed_main` blocks overlapping **confirmed** main bookings. Tentative mains may overlap; the UI warns and requires an explicit confirm. Map the Postgres exclusion violation to a friendly error ("Date already booked by <title>").
- **Small bookings** are single-day and never hard-blocked. When creating or confirming one on a day that already has a main booking (tentative or confirmed, including inside a multi-day stay):
  - Show a warning listing the main booking and its slot.
  - If the slots match, or the main is `full_day`/multi-day, show a **stronger warning** ("Clashes with <main> — same slot. Consider the other slot.").
  - Require the user to tick "I've checked this works" and enter a short note; store as `overlap_ack` + `overlap_note`.
- **Small per day:** warn when more than `max_small_per_day` (setting, default 2) small bookings fall on one date.
- **Creating or confirming a main on a day that has small bookings:** allowed; show an info banner listing them so the owner can reschedule or keep them.
- **Lead date check:** show **"Date booked"** only when the lead's day has a confirmed main booking. If only small bookings exist, show **"Small event that day"** (informational).
- Photoshoots with no guests are normal: `guests_expected` stays optional.

### 6.5 Approximate dates
`date_precision` of `week`/`month` means the date is the **start** of the week/month. Show these as "1st week of Dec 2026" / "Dec 2026", not as an exact day. On the calendar they appear as a faint tentative band, never blocking.

### 6.6 Money
`balance = total_amount − sum(payments)`. A booking cannot be marked `completed` with balance > 0 unless an admin overrides (warn, don't hard block). Show amounts as `₹1,25,000` (Indian grouping, `en-IN`).

### 6.7 Phone numbers
Normalise to E.164, default country `+91` (strip spaces, dashes, leading `0`, handle `+91`/`91` prefixes). Dedupe contacts by phone. If no phone, create the contact without one and flag the lead `needs_review`.

---

## 7. Lead Ingestion (critical feature)

### 7.1 Endpoint
`POST /api/ingest/lead`
- Header `x-ingest-secret: <INGEST_SECRET>` (constant-time compare). Reject with 401 otherwise.
- JSON body, validated with zod:

```ts
{
  external_id?: string,        // optional; recommended "sheet:<sheetId>:<row>" or submission id
  first_name: string,          // raw
  last_name?: string,          // raw (contains occasion/date/pax)
  phone?: string,
  email?: string,
  message?: string,
  source?: 'website' | 'instagram' | 'whatsapp' | 'phone' | 'referral' | 'walk_in' | 'other',
  submitted_at?: string,       // ISO
  sheet_row?: number
}
```

> **Real website-leads Sheet columns (confirmed):**
> `Date | Name | WhatsApp | Occasion | Result | Submission Timestamp | Country | City | Device Type | OS / Device | Browser | State / Region | Traffic Source`
>
> Field mapping for the ingest payload:
> - `first_name` ← `Name` (full name; no separate last_name column — pass empty string for `last_name`)
> - `phone` ← `WhatsApp`
> - `message` ← `Occasion`
> - `source` ← `"website"` (hardcoded)
> - `submitted_at` ← `Submission Timestamp`
> - `sheet_row` ← row number
> - Store `Country`, `City`, `Device Type`, `OS / Device`, `Browser`, `State / Region`, `Traffic Source` as extra metadata in the `raw_ingest.payload` JSON for analytics use later.
> - `Result` is the owner's manual status column in the Sheet; ignore during ingestion (the app's `lead_status` replaces it).

### 7.2 Processing steps (in order)
1. **Insert the raw payload into `raw_ingest` first** (service role). Even if later steps fail, the lead is recoverable.
2. Compute `external_id` if absent: `sha256(normalisedPhone + '|' + (submitted_at ?? '') + '|' + first_name)`.
3. If a lead with that `external_id` exists → respond `200 { duplicate: true, lead_id }` and mark `raw_ingest.result = 'duplicate'`. (Apps Script can fire twice; this must be idempotent.)
4. `parseLead(first_name, last_name)` → `{ name, eventType, eventDate, datePrecision, guestMin, guestMax, needsReview, reviewReasons }`.
5. Normalise phone; **upsert contact** by phone (or create without phone).
6. Insert lead with parsed fields, `raw_first`, `raw_last`, `needs_review`, `review_reasons`, `source` (default `website`).
7. Create the auto follow-up (§6.2).
8. Write `activity_log` (`created`, actor = null/system).
9. Update `raw_ingest` with `result = 'ok'` and `lead_id`.
10. Respond `200 { ok: true, lead_id, needs_review }`.

Failures: catch, set `raw_ingest.result='error'` + message, respond `500`. Add basic rate limiting (e.g. Upstash or a simple in-memory/IP limit) and a body size cap.

### 7.3 Apps Script hook (Phase 1: keep Sheet flow, add webhook)
Add to the **existing** script, *after* the existing Sheet write. It must never break the Sheet flow:

```javascript
function pushToOps_(row) {
  try {
    const props = PropertiesService.getScriptProperties();
    const url = props.getProperty('OPS_INGEST_URL');       // https://app.terrabithia.in/api/ingest/lead
    const secret = props.getProperty('OPS_INGEST_SECRET');
    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-ingest-secret': secret },
      payload: JSON.stringify({
        external_id: 'sheet:' + SpreadsheetApp.getActive().getId() + ':' + row.rowNumber,
        first_name: row.firstName,
        last_name: row.lastName,
        phone: row.phone,
        email: row.email,
        message: row.message,
        source: 'website',
        submitted_at: new Date().toISOString(),
        sheet_row: row.rowNumber
      }),
      muteHttpExceptions: true
    });
  } catch (e) {
    console.error('Ops push failed: ' + e); // Sheet is the safety net; the importer can backfill
  }
}
```

**Phase 2 (later):** point the website form directly at `/api/ingest/lead` and retire the Apps Script; keep a Sheet mirror only if wanted.

### 7.4 `parseLead` (provided file — do not rewrite)
Copy the provided `parseLead.ts` to `src/lib/parseLead.ts`. Behaviour it implements:
- Joins first + last name and extracts, in order: **guest count** (`100pax`, `150-200 pax`, `~120 guests`), **date**, **event type**; the remainder is the **name**.
- Date forms: `December 26`, `Jan 10 2027`, `28 February 2027`, `December 1st Week` (precision `week`), month only (precision `month`), `dd/mm[/yyyy]` (India day-first). No year → next occurrence from "now".
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

Add more cases as real-world failures show up. When parsing is wrong in production, the fix is: update the parser, add a test, and re-parse from `raw_first`/`raw_last` (build an admin action "Re-parse selected leads").

---

## 8. Modules & Screens

General UI rules: **mobile-first** (the owner will use this on a phone), large tap targets, sticky filters, loading skeletons, empty states, optimistic updates where safe, toasts for results, confirm dialogs for destructive actions. Dark mode optional.

### 8.1 Dashboard (`/dashboard`)
- Cards: new leads (7d), follow-ups due today, **overdue** follow-ups, stale leads, leads needing review, upcoming events (next 30 days).
- Staff only: revenue received this month, outstanding balances (confirmed, upcoming), conversion rate by source (last 90 days).
- Lists: "Today's follow-ups" (with one-tap WhatsApp/call), "Next 5 events".

### 8.2 Leads (`/leads`, `/leads/new`, `/leads/[id]`)
- **List:** TanStack table; columns: name, phone, event type, event date (with precision formatting), guests, status chip, source, assigned to, last activity, flags (Needs review / Stale / Date booked). Search (name/phone, trigram), filters (status, source, assigned, event month, needs review, stale), sort, URL-synced filters, pagination. Quick inline status change.
- **Detail:** header with contact + big action buttons: **Call** (`tel:`), **WhatsApp** (`https://wa.me/<E164 no plus>?text=<encoded template>`), copy phone. Sections: summary, editable fields, **raw_first/raw_last** (collapsed, "Re-parse" button), timeline (activity + follow-ups), open follow-ups, notes, "Convert to booking".
- **Needs review view:** shows raw text next to parsed fields with inline fix + "Mark reviewed".
- **New lead:** manual entry for Instagram/WhatsApp/phone leads (same data model, `source` chosen) — also runs through the same follow-up rules.

### 8.3 Follow-ups (`/followups`)
Tabs: **Overdue / Today / Upcoming / Done**. Each row: lead/booking, due time, channel, note, quick actions (WhatsApp with template picker, call, Done, Snooze: 1h / tomorrow / custom). "Done" flow per §6.2. Filter by assignee.

### 8.4 Bookings (`/bookings`, `/bookings/[id]`)
- List with status, dates, guests, total, paid, balance (staff) / without amounts (sales, viewer).
- Detail: summary, dates, package, notes; **payments** table + "Add payment"; balance bar; linked lead; follow-ups; status actions (confirm / complete / cancel with reason).
- Create from lead conversion or manually. The form asks **kind** (main / small), **slot** (morning / evening / full day) and optional times. Conflict and overlap warnings per §6.4.

### 8.5 Calendar & Events (`/calendar`, `/events`)
- **Calendar:** month view (and agenda on mobile). Main bookings: confirmed = solid, tentative = striped/outlined, with a slot icon (sun = morning, moon = evening). Small events/photoshoots: compact chips under the main one, and a "+1 small" badge on narrow cells. Approximate lead dates = faint band. Click → booking/lead; clicking a day opens that day's detail (main + small bookings + leads wanting that date). Role-aware data source (`bookings_safe` for non-staff).
- **Events list:** upcoming confirmed/tentative bookings (next 90 days default), filterable; shows days-to-go, guests, balance due (staff).

### 8.6 Templates (`/templates`)
CRUD for reusable WhatsApp/Instagram message templates with placeholders `{{name}} {{event_type}} {{event_date}} {{guests}}`. Everywhere a WhatsApp action exists, offer a template picker that fills placeholders and opens `wa.me` with the text (and a "Copy text" fallback for Instagram).

### 8.7 Settings
- `/settings/users` (admin): manage `allowed_emails`, change roles, deactivate users.
- `/settings/general` (admin): follow-up default intervals, stale-lead days, lost-reason presets, event types list.

### 8.8 Navigation
Sidebar (desktop) / bottom bar (mobile): Dashboard, Leads, Follow-ups, Calendar, Bookings, Templates, Settings. Hide items the role can't use. Design nav as a registry (`modules.ts`) so new modules are added by one entry + one folder.

---

## 9. Migration from Google Sheets

`scripts/import-sheet.ts` — run locally, idempotent, with `--dry-run`.

1. Input: CSV export(s) of the three sheets below. Sheets API optional later.
2. A column-mapping config at the top of the script (header name → field) — see §16 for real headers.
3. **Leads/contacts sheet** (the owner's manual leads tracker):
   - `Contact Name` → `contacts.name`
   - `Phone Number` → `contacts.phone` (normalise E.164)
   - `Notes` → `contacts.notes`
   - `Creation Date` → `leads.created_at` (import as historical timestamp)
   - `Status` → **free-form string; do not map**. All imported leads are created as `new`. Optionally append the sheet's status text to `contacts.notes` for reference.
   - `WhatsApp Chat` → store as note or ignore (URL not structured)
   - `Task ID` → `leads.external_id` prefix `"sheet-leads:"`
   - `Sortable date` → used only for ordering; ignore after import
4. **Website leads sheet** (auto-populated by Apps Script):
   - `Name` → parse as `first_name` (no last_name column; pass `""` for last)
   - `Occasion` → `last_name` field fed into `parseLead()` for event type / date / guests
   - `WhatsApp` → `contacts.phone`
   - `Submission Timestamp` → `leads.created_at`
   - `Result` → **free-form string; do not map**. All imported leads are created as `new`. Optionally append the value to `contacts.notes` for reference.
   - Metadata fields (`Country`, `City`, `Device Type`, `OS / Device`, `Browser`, `State / Region`, `Traffic Source`) → stored in `raw_ingest.payload`
5. **Event bookings sheet**:
   - `Booked date` → `bookings.created_at` (historical)
   - `Name` → match to existing contact by name/phone; create if missing
   - `Column 2` → likely phone; inspect data and map to `contacts.phone`
   - `Event status` → `bookings.status` (see §16 mapping)
   - `Occassion` → `bookings.event_type`
   - `referral source` → `leads.source`
   - `Pax` → `bookings.guests_expected`
   - `Rate` → `bookings.total_amount`
   - `Deposit`, `Advance paid`, `Final Payment` → three rows in `payments` (with `method='bank_transfer'` as default; inspect actual data)
   - `pending` → derived field; cross-check against `balance` view after import; flag discrepancies
   - `Total` → cross-check equals `Deposit + Advance paid + Final Payment`; flag if not
   - `Deposit Returned?` → note field on the booking or a boolean flag (add `deposit_returned boolean` column to `bookings` if needed — see §16)
   - `Net Revenue` → derived (`Total − Deposit Returned`); do not store, recompute
   - `slno.` → ordering only, ignore
   - `Column 17` → inspect; if empty, ignore
6. Print a report: rows read, created, duplicates skipped, `needs_review` count (list the raw values), payment discrepancies, and any bookings that conflict on dates.
7. **Do not** create auto follow-ups for imported historical leads unless `--with-followups` is passed.

Cutover plan: run the importer → enable webhook alongside the Apps Script → compare counts for ~2 weeks → make the app the source of truth → keep the Sheet as a read-only archive.

---

## 10. Security & Privacy

- Service role key **only** in server code (`lib/supabase/admin.ts`, ingest route, scripts). Never expose to the client.
- Validate every input with zod on the server; never trust client role claims — read the role from the DB.
- `INGEST_SECRET` compared in constant time; rotate if leaked.
- Treat phone numbers/emails as personal data: no logging of full payloads to third parties, no analytics on PII.
- Add security headers (`next.config.ts`), CSRF-safe server actions only, cookies `httpOnly`/`secure`.
- Backups: enable Supabase daily backups (or schedule `pg_dump`); document restore steps in `README`.

---

## 11. Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # server only
INGEST_SECRET=                      # shared with Apps Script
NEXT_PUBLIC_APP_URL=https://app.terrabithia.in
DEFAULT_COUNTRY_CODE=+91
APP_TIMEZONE=Asia/Kolkata
```

Provide `.env.example` and fail fast at startup if required vars are missing (zod-validated `env.ts`).

---

## 12. Deployment

1. New GitHub repo → import into a **new Vercel project** (separate from the public website).
2. Add the domain `app.terrabithia.in` in Vercel; at the DNS provider for terrabithia.in add a `CNAME app → cname.vercel-dns.com` (use the exact value Vercel shows).
3. Supabase: create project (Mumbai), run migrations, enable Google provider, set Site URL and redirect URLs to the production + preview + `localhost:3000` origins; create the Google OAuth client (authorised redirect URI = the Supabase callback URL).
4. Seed the first admin: insert the owner's email into `allowed_emails` with role `admin` **before** first login.
5. Set env vars in Vercel (Production + Preview). Preview deployments use a separate Supabase project or branch.

---

## 13. Quality Bar

- TypeScript `strict`, no `any` without a comment; ESLint + Prettier; generated Supabase types committed.
- Unit tests: `parseLead`, `phone`, status-transition rules, follow-up scheduling, money/balance math, Indian currency formatting.
- RLS tests (§5.1) and an ingest endpoint test (auth, idempotency, bad payload, parser flags).
- Server components by default; client components only where interactivity is needed.
- Every mutation: zod validation → `requireRole()` → DB write → `activity_log` → `revalidatePath`.
- Accessible forms (labels, focus states), usable at 360px width.
- Small, reviewable commits; README with setup, env, migration, and import instructions.

---

## 14. Build Phases (work in this order; stop after each)

### Phase 0 — Scaffold
- [ ] Next.js + TS + Tailwind + shadcn/ui, pnpm, ESLint/Prettier, Vitest.
- [ ] Supabase client helpers (server/client/admin), `env.ts`, `.env.example`.
- [ ] App shell: sidebar/bottom nav registry, protected `(app)` layout, `/login` with Google OAuth.
- **Done when:** an allow-listed Google account can sign in and see an empty dashboard; a non-listed account sees "no access".

### Phase 1 — Schema, roles, ingestion
- [ ] Migrations for §5 (all tables, enums, triggers, views) and RLS per §5.1 + RLS tests.
- [ ] `parseLead.ts` copied in + tests (§7.4), `phone.ts` + tests.
- [ ] `/api/ingest/lead` per §7.2 with tests; Apps Script snippet documented in README.
- [ ] `scripts/import-sheet.ts` with `--dry-run` (§9).
- **Done when:** a curl POST creates contact + lead + follow-up; replaying it is a no-op; importing a sample CSV reports correct counts and review flags.

### Phase 2 — Leads
- [ ] Leads list (search/filters/sort), detail, create, edit, status change with rules (§6.1), lost-reason dialog, needs-review workflow, re-parse action, assignment.
- [ ] Call / WhatsApp buttons (template picker can be a stub until Phase 4).
- **Done when:** the owner can run the full lead pipeline on a phone without touching the Sheet.

### Phase 3 — Follow-ups & dashboard
- [ ] Auto follow-up rules (§6.2), follow-ups page (Overdue/Today/Upcoming/Done), done/snooze/next flows, stale-lead flag.
- [ ] Dashboard v1 (non-money widgets).
- **Done when:** "Today" shows everything due, and finishing one prompts the next step.

### Phase 4 — Bookings, payments, calendar, templates
- [ ] Lead → booking conversion, bookings list/detail, payments, balance, status actions.
- [ ] Double-booking handling (§6.4) incl. friendly error mapping; `bookings_safe` for sales/viewer.
- [ ] Calendar (month + agenda), events list, approximate-date bands.
- [ ] Message templates CRUD + picker wired into all WhatsApp actions.
- [ ] Dashboard money widgets (staff only).
- **Done when:** a second confirmed *main* booking on the same day is rejected with a clear message; a *small* booking/photoshoot on a day with a main booking saves only after the overlap warning is acknowledged; and a sales user can see the calendar but no amounts.

### Phase 5 — Users, settings, hardening
- [ ] `/settings/users` (allowed emails, roles, deactivate), `/settings/general`.
- [ ] Activity log views (lead/booking timelines; admin global log).
- [ ] Security headers, rate limiting, error boundaries, 404/403 pages, README, backup notes.
- **Done when:** the admin can onboard a new staff member with a role in under a minute and the role is demonstrably enforced.

---

## 15. Assumptions & Open Items (confirm or adjust)

1. **One main event per day; small events/photoshoots may share the day** (warned, not blocked). If you ever want two *main* events on one day (morning + evening), extend the exclusion constraint to include `slot`, treating `full_day` and multi-day as overlapping both.
2. **Lead payload fields** are now confirmed — see §16 for the real column mapping from all three sheets.
3. **Subdomain** `app.terrabithia.in` is a placeholder — change freely.
4. **Farm stays** are modelled as multi-day bookings (`start_date`..`end_date`); room-level inventory is a later module.
5. **Statuses, lost reasons, event types, follow-up intervals** are sensible defaults and are editable in settings.
6. Imported historical leads do not generate follow-ups unless requested.
7. **`Deposit Returned?`** column in the bookings sheet: decide before import whether to add a `deposit_returned boolean` column to the `bookings` table or model it as a negative payment. Leaning towards a boolean flag + a `deposit_returned_amount numeric(12,2)` so Net Revenue is always computable.

---

## 16. Real Google Sheets Column Mapping

This section records the **actual column headers** from the three source sheets. Use these in `scripts/import-sheet.ts` and when building the ingest payload in the Apps Script hook.

### 16.1 Leads / Contacts tracker (owner's manual Sheet)

| Sheet column | Maps to | Notes |
|---|---|---|
| Contact Name | `contacts.name` | |
| Phone Number | `contacts.phone` | Normalise → E.164 (`+91` default) |
| Notes | `contacts.notes` | |
| Creation Date | `leads.created_at` | Parse as `Asia/Kolkata` timestamp |
| Status | *(free-form string, ignore)* | All imports default to `leads.status = 'new'`; optionally append raw text to `contacts.notes` |
| WhatsApp Chat | *(note / ignore)* | May be a wa.me URL; not structured |
| Task ID | `leads.external_id` | Prefix with `"sheet-leads:"` for idempotency |
| Sortable date | *(sort key only)* | Ignore after import |

### 16.2 Website leads Sheet (auto-populated by Apps Script)

| Sheet column | Maps to | Notes |
|---|---|---|
| Date | *(informational)* | Use `Submission Timestamp` instead for precision |
| Name | `first_name` in ingest payload | Full name; no separate last_name column — pass `""` for `last_name` |
| WhatsApp | `contacts.phone` | Normalise → E.164 |
| Occasion | `last_name` in `parseLead()` | Contains event type / date / guest count — feed directly into the parser |
| Result | *(free-form string, ignore)* | All imports default to `leads.status = 'new'`; optionally append raw text to `contacts.notes` |
| Submission Timestamp | `leads.created_at` / `submitted_at` | Primary timestamp |
| Country | `raw_ingest.payload.country` | Metadata only |
| City | `raw_ingest.payload.city` | Metadata only |
| Device Type | `raw_ingest.payload.device_type` | Metadata only |
| OS / Device | `raw_ingest.payload.os_device` | Metadata only |
| Browser | `raw_ingest.payload.browser` | Metadata only |
| State / Region | `raw_ingest.payload.state_region` | Metadata only |
| Traffic Source | `raw_ingest.payload.traffic_source` | Metadata only |

### 16.3 Event bookings Sheet

| Sheet column | Maps to | Notes |
|---|---|---|
| slno. | *(ordering)* | Ignore |
| Booked date | `bookings.created_at` | Historical timestamp |
| Name | `contacts.name` | Match to existing contact; create if new |
| Column 2 | `contacts.phone` | **Inspect data** — likely phone number |
| Event status | `bookings.status` | Map labels → `booking_status` enum (**confirm labels**) |
| Occassion | `bookings.event_type` | Note: typo in Sheet header is intentional |
| referral source | `leads.source` | Map to `lead_source` enum |
| Pax | `bookings.guests_expected` | Integer |
| Rate | `bookings.total_amount` | `numeric(12,2)`, INR |
| Deposit | `payments` row 1 | `note = 'Deposit'` |
| Advance paid | `payments` row 2 | `note = 'Advance'` |
| Final Payment | `payments` row 3 | `note = 'Final'` |
| pending | *(derived)* | Cross-check vs `balance` view; flag discrepancies |
| Total | *(derived / cross-check)* | Should equal sum of Deposit + Advance + Final |
| Deposit Returned? | `bookings.deposit_returned` | Add `deposit_returned boolean default false` + `deposit_returned_amount numeric(12,2)` to `bookings` table (open item §15.7) |
| Net Revenue | *(derived)* | `Total − deposit_returned_amount`; do not store |
| Column 17 | *(inspect)* | Map if non-empty; ignore otherwise |

### 16.4 Apps Script payload (updated)

The `pushToOps_` function in §7.3 must map the **Website leads Sheet** columns:

```javascript
payload: JSON.stringify({
  external_id: 'sheet:' + SpreadsheetApp.getActive().getId() + ':' + row.rowNumber,
  first_name: row['Name'],          // full name; no last_name column
  last_name: '',                     // empty — Occasion goes into message
  phone: row['WhatsApp'],
  message: row['Occasion'],          // parseLead() will extract event/date/pax from this
  source: 'website',
  submitted_at: row['Submission Timestamp'] || new Date().toISOString(),
  sheet_row: row.rowNumber,
  // metadata stored as-is in raw_ingest.payload:
  country: row['Country'],
  city: row['City'],
  device_type: row['Device Type'],
  os_device: row['OS / Device'],
  browser: row['Browser'],
  state_region: row['State / Region'],
  traffic_source: row['Traffic Source']
}),
```

Update the ingest zod schema (§7.1) to accept these optional metadata fields and pass them through to `raw_ingest.payload`.

## 16. Future Modules (design the nav/registry so these slot in)
Quotes & tariff PDF generator · expenses & vendor tracking · staff/task assignment for events · post-event feedback & review requests · inventory (decor, tents, furniture) · reports (conversion by source, monthly revenue, occupancy) · WhatsApp Business API integration · Google Calendar sync · farm-stay room management.
