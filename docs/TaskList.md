# Taxi ERP — TaskList.md

> **Project:** Taxi ERP Platform 
> **Stack:** React 18 + Vite 5 · Self-hosted Supabase (PostgreSQL 16, PostgREST, GoTrue, Storage) · TanStack Query · Zustand · React Hook Form + Zod · @react-pdf/renderer
> **Hosting (END of project):** Oracle Always Free ARM A1.Flex · Cloudflare Tunnel · Backblaze B2
> **Workflow:** Develop & test locally first → deploy Oracle + Docker last
> **Testing policy:** Manual testing only. No automated tests. Each task has a click-by-click manual test checklist the operator follows.

---

## How to read this file

- Each ticket has an ID (`TAXI-XXX`), Type, Module, Description, Dependencies, and a **Manual Test Plan** written as numbered click-by-click steps.
- Tasks are grouped into **Modules**. A module is "done" only when every ticket inside it is implemented AND its manual test plan passes.
- Always finish the current module before starting the next. The dependency graph is strict (Master → Daily Work → Accounts → Reports → Oracle/Docker).
- When a test step says "you should see …", that is your pass criterion. If you don't see it, do NOT move on — file it as a bug for the agent.

---

## Module Map

| # | Module | Phase | Tickets |
|---|--------|-------|---------|
| M0 | Project Scaffolding & Local Dev Environment | Local | TAXI-001 → TAXI-006 |
| M1 | Database Foundation (Schemas, Tables, RLS, Triggers) | Local | TAXI-101 → TAXI-110 |
| M2 | Auth & User Management | Local | TAXI-201 → TAXI-205 |
| M3 | Master Panel — Company Detail | Local | TAXI-301 → TAXI-303 |
| M4 | Master Panel — Utilities (Vehicles + Document No. Control) | Local | TAXI-401 → TAXI-405 |
| M5 | Master Panel — Customers | Local | TAXI-501 → TAXI-505 |
| M6 | Master Panel — Rate Management | Local | TAXI-601 → TAXI-606 |
| M7 | Master Panel — GST Management | Local | TAXI-701 → TAXI-705 |
| M8 | Daily Work — Duty Slip CRUD + Flexible Duty Popup | Local | TAXI-801 → TAXI-810 |
| M9 | Daily Work — Billing (Generate Bill RPC) | Local | TAXI-901 → TAXI-908 |
| M10 | Daily Work — Change / Cancel Bill | Local | TAXI-1001 → TAXI-1005 |
| M11 | Daily Work — Print Bill / Duty Slip (PDF) | Local | TAXI-1101 → TAXI-1104 |
| M12 | Accounts — Ledger Book + Manual Receipt/Payment | Local | TAXI-1201 → TAXI-1207 |
| M13 | Reports — Bill Cover, Bill Register, Duty Register | Local | TAXI-1301 → TAXI-1306 |
| M14 | Cross-Cutting — Audit Log, Settings, Role Guards | Local | TAXI-1401 → TAXI-1404 |
| M15 | Oracle Cloud VM + Docker Compose Production Setup | Deploy | TAXI-1501 → TAXI-1510 |
| M16 | Cloudflare Tunnel + Backblaze B2 Backups + Uptime Kuma | Deploy | TAXI-1601 → TAXI-1606 |

---

# MODULE M0 — Project Scaffolding & Local Dev Environment

Goal: A running React + Vite dev server and a local self-hosted Supabase stack on the developer's laptop. No business logic yet — just the skeleton.

---

### TAXI-001 — Initialize Vite + React 18 + TypeScript project
**Type:** Task · **Module:** M0 · **Depends on:** —
**Description:** Scaffold the frontend SPA with Vite 5, React 18, TypeScript strict mode. Establish the folder layout: `src/{components,hooks,services,panels,templates,lib,types}`.

**Manual Test Plan:**
1. Open a terminal in the project root.
2. Run `npm run dev`.
3. Open the URL printed in the terminal (usually `http://localhost:5173`) in your browser.
4. **Pass criterion:** You see the default Vite + React welcome page with the Vite and React logos, no errors in the browser console (F12 → Console tab).
5. Press `Ctrl+C` in the terminal to stop the dev server. It should stop cleanly with no errors.

---

### TAXI-002 — Install core frontend dependencies
**Type:** Task · **Module:** M0 · **Depends on:** TAXI-001
**Description:** Install runtime deps: `@supabase/supabase-js`, `@tanstack/react-query`, `@tanstack/react-table`, `zustand`, `react-hook-form`, `zod`, `@react-pdf/renderer`, `react-router-dom`. Install dev deps: `typescript`, `@types/react`, `@types/react-dom`, `eslint`, `prettier`.

**Manual Test Plan:**
1. Open `package.json` in your editor.
2. **Pass criterion:** All the above packages appear under `dependencies` or `devDependencies` with valid version numbers.
3. Run `npm run build` in the terminal.
4. **Pass criterion:** Build completes with no errors. A `dist/` folder appears in the project root.
5. Run `npm run lint`.
6. **Pass criterion:** Lint exits 0 with no errors (warnings are acceptable at this stage).

---

### TAXI-003 — Set up Supabase CLI + local self-hosted stack
**Type:** Task · **Module:** M0 · **Depends on:** TAXI-001
**Description:** Install Supabase CLI. Run `supabase init` to create the `supabase/` folder. Run `supabase start` to spin up local Postgres 16, GoTrue, PostgREST, Storage, Studio on Docker. Capture the printed local URLs and anon/service keys into a `.env.local` file.

**Manual Test Plan:**
1. Run `supabase start` in a terminal (Docker Desktop must be running first).
2. Wait until the command prints a table of local services with URLs and keys.
3. Open the **API URL** (usually `http://localhost:54321`) in your browser.
4. **Pass criterion:** You see a JSON response like `{"message":"Welcome to PostgREST"}` or similar — no connection error.
5. Open the **Studio URL** (usually `http://localhost:54323`) in your browser.
6. **Pass criterion:** The Supabase Studio dashboard loads. You can see the Table Editor, SQL Editor, and Authentication tabs in the left sidebar.
7. Open `.env.local` in your editor.
8. **Pass criterion:** The file contains `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_SUPABASE_SERVICE_ROLE_KEY` with non-empty values.

---

### TAXI-004 — Create typed supabaseClient singleton
**Type:** Feature · **Module:** M0 · **Depends on:** TAXI-003
**Description:** Implement `src/services/supabaseClient.ts` as a singleton exporting a typed Supabase client. Reads env vars from `import.meta.env`. Exposes `from(table)`, `rpc(name, args)`, `storage.bucket(name)`, `auth`, `channel(name)`.

**Manual Test Plan:**
1. Start the frontend (`npm run dev`) and the local Supabase stack (`supabase start`).
2. Open the app in your browser.
3. Open DevTools (F12) → Console.
4. Run this in the console: `await window.__supabase?.auth.getSession()` — if not exposed globally, instead open React DevTools, find the `App` component, and confirm `supabaseClient` is imported.
5. **Pass criterion:** No runtime errors on page load. The Network tab (F12 → Network) shows no failed requests to `localhost:54321`.
6. In `supabase/migrations/` create a tiny test table `hello (id int, msg text)`, insert one row, and run `supabase db reset`. In the app, temporarily call `supabaseClient.from('hello').select()` and log the result.
7. **Pass criterion:** The console prints an array with your inserted row.

---

### TAXI-005 — Set up TanStack Query + Zustand providers
**Type:** Feature · **Module:** M0 · **Depends on:** TAXI-002
**Description:** Wrap `App` with `QueryClientProvider` (auto-refetch on focus, stale-5min default) and a root Zustand store for ephemeral UI state (modal open/close, form drafts). Create `src/hooks/useEntityQuery.ts` as a generic wrapper exposing `list`, `get`, `create`, `update`, `delete`, `invalidate`.

**Manual Test Plan:**
1. Start the app. Open DevTools → Console.
2. **Pass criterion:** No React warnings about missing providers.
3. Open React DevTools → Components tree.
4. **Pass criterion:** `App` is wrapped by `QueryClientProvider` (you should see the `queryClient` prop when you click on it).
5. From any temporary component, call `useEntityQuery('customers').list()` (the table can be empty).
6. **Pass criterion:** The hook returns `{ data: [], isLoading: false, isError: false }` — not `undefined`, not throwing.

---

### TAXI-006 — Set up React Router with lazy-loaded panel routes
**Type:** Feature · **Module:** M0 · **Depends on:** TAXI-005
**Description:** Implement `AppRouter` with routes `/master/*`, `/daily-work/*`, `/accounts/*`, `/reports/*`, `/login`, `/unauthorized`. Each panel module is `React.lazy()`-imported. Add a top nav bar with links to each panel. Add a placeholder home page at `/`.

**Manual Test Plan:**
1. Start the app and open `http://localhost:5173/`.
2. **Pass criterion:** You see a top nav bar with four links: Master, Daily Work, Accounts, Reports.
3. Click **Master**.
4. **Pass criterion:** The URL changes to `/master` and a placeholder "Master Panel — Coming Soon" page loads. No errors in the console.
5. Repeat for **Daily Work**, **Accounts**, **Reports** — each route loads its placeholder.
6. Manually type `http://localhost:5173/some-fake-url` in the address bar.
7. **Pass criterion:** A "Not Found" page or redirect to `/` is shown (not a blank screen).
8. Open DevTools → Network, reload the page, click through all four panels.
9. **Pass criterion:** Each panel navigation triggers a separate JS chunk download (lazy-loading works).

---
# MODULE M1 — Database Foundation

Goal: All six schemas (`core`, `master`, `operations`, `billing`, `accounts`, `system`) created with their tables, enums, indexes, triggers, and RLS policies. No UI yet — purely SQL migrations.

> **Pattern:** Every migration file lives in `supabase/migrations/` and is named `YYYYMMDDHHMMSS_description.sql`. Run `supabase db reset` to apply all migrations in order. After every ticket, run the manual test plan against Supabase Studio's SQL Editor or Table Editor.

---

### TAXI-101 — Create schemas + core.companies + core.user_profiles
**Type:** Task · **Module:** M1 · **Depends on:** TAXI-003
**Description:** Create the six schemas. Create `core.companies` (id, name, legal_name, owner_name, gstin UNIQUE, pan, address_line1/2, city, state, pincode, phone, email, logo_path, is_active, timestamps). Create `user_role` enum (`owner`, `operator`, `accountant`, `viewer`). Create `core.user_profiles` (id uuid PK → auth.users, company_id FK, full_name, role, is_active, timestamps). Add trigger to auto-create a profile row when a new `auth.users` row is inserted.

**Manual Test Plan:**
1. Run `supabase db reset`.
2. **Pass criterion:** Terminal prints no errors and ends with "Finished supabase db reset".
3. Open Supabase Studio → Table Editor.
4. **Pass criterion:** You see `core.companies` and `core.user_profiles` tables listed.
5. Open SQL Editor, run: `SELECT * FROM core.companies;`
6. **Pass criterion:** Returns 0 rows, no error.
7. Open Supabase Studio → Authentication → Users → Add user (email + password).
8. Run `SELECT id, email FROM auth.users;` — copy the user's UUID.
9. Run `SELECT * FROM core.user_profiles WHERE id = '<that-uuid>';`
10. **Pass criterion:** A profile row exists for that user (auto-created by trigger). The `role` column shows `viewer` (default).

---

### TAXI-102 — Create master.customers + master.vehicle_groups + master.vehicle_types + master.vehicles
**Type:** Task · **Module:** M1 · **Depends on:** TAXI-101
**Description:** Create `client_type` enum (`company`, `personal`). Create `master.customers` per spec (Section 4.3 of System Design). Create `master.vehicle_groups`, `master.vehicle_types`, `master.vehicles` per spec (Section 4.4). Apply the indexes from the spec.

**Manual Test Plan:**
1. Run `supabase db reset`. **Pass criterion:** No errors.
2. In Supabase Studio → Table Editor, insert one row into `core.companies` manually (fill all NOT NULL fields).
3. Open `master.customers` in Table Editor → Insert row.
4. **Pass criterion:** You can fill `name`, `phone`, `client_type='company'`, `company_name`, `gstin`, `state`, and save successfully.
5. Try to insert a customer with `company_id = 999999` (does not exist).
6. **Pass criterion:** Insert fails with a foreign-key violation error.
7. Open `master.vehicle_groups`, insert "Sedan", "SUV". Open `master.vehicle_types`, insert "AC", "Non-AC".
8. Open `master.vehicles`, insert a vehicle referencing the group and type IDs you just created.
9. **Pass criterion:** Vehicle saves successfully. Try to insert a duplicate `registration_no` for the same company — should fail with unique violation.

---

### TAXI-103 — Create master.rates + master.gst_config + master.document_sequences
**Type:** Task · **Module:** M1 · **Depends on:** TAXI-102
**Description:** Create `duty_type` enum (`per_km`, `per_hour`, `per_day`, `local_package`, `outstation`, `flexible`). Create `master.rates` per Section 4.5. Create `master.gst_config` per Section 4.6. Create `sequence_mode` enum (`auto`, `manual`) and `master.document_sequences` per Section 4.9. Apply all UNIQUE constraints and indexes from the spec.

**Manual Test Plan:**
1. Run `supabase db reset`. **Pass criterion:** No errors.
2. Insert a customer, a vehicle_group, a vehicle_type.
3. Insert a `master.rates` row with `duty_type='per_km'`, `base_rate=500`, `per_km_rate=12`.
4. **Pass criterion:** Row saves. Try to insert a duplicate `(company_id, customer_id, vehicle_group_id, vehicle_type_id, duty_type, effective_from)` — should fail with unique violation.
5. Insert a `master.gst_config` row for the same customer with `igst_rate=5.00`, `cgst_rate=2.5`, `sgst_rate=2.5`.
6. **Pass criterion:** Row saves. The `is_interstate` column should be auto-populated once the trigger in TAXI-106 is added (for now it can be null).
7. Insert a `master.document_sequences` row with `sequence_key='duty_slip'`, `prefix='DS-'`, `next_value=1`, `mode='auto'`, `padding_length=4`.
8. **Pass criterion:** Row saves. Try to insert a second row with the same `sequence_key` for the same company — should fail.

---

### TAXI-104 — Create operations.duty_slips + billing.bills + billing.bill_duty_slips
**Type:** Task · **Module:** M1 · **Depends on:** TAXI-103
**Description:** Create `operations.duty_slips` per Section 4.7 (note the `total_km` GENERATED column). Create `billing.bills` per Section 4.8 (note `total_tax` and `total_after_tax` GENERATED columns). Create `billing.bill_duty_slips` junction. Apply the partial unique index `uq_duty_slip_active_bill` that ensures a duty slip is on at most one non-cancelled bill.

**Manual Test Plan:**
1. Run `supabase db reset`. **Pass criterion:** No errors.
2. Insert one customer, one vehicle, one rate (any duty_type except `flexible`).
3. Insert a duty slip manually: fill all NOT NULL fields, set `opening_km=10000`, `closing_km=10050`.
4. **Pass criterion:** Duty slip saves. Query `SELECT total_km FROM operations.duty_slips WHERE id = <id>;` — should return `50` (auto-computed).
5. Insert a `billing.bills` row with `grand_total=1500` and minimal fields.
6. **Pass criterion:** Bill saves. Query `SELECT total_tax, total_after_tax FROM billing.bills WHERE id = <id>;` — both should be 0 (no GST yet) and `total_after_tax` should equal `total_before_tax`.
7. Insert a row into `billing.bill_duty_slips` linking the bill to the duty slip.
8. Try to insert a second bill and link the SAME duty slip to it (with the duty slip's status not `cancelled`).
9. **Pass criterion:** Second link insert fails with a unique violation on `uq_duty_slip_active_bill`.

---

### TAXI-105 — Create accounts.ledger_entries + system.audit_log + system.settings
**Type:** Task · **Module:** M1 · **Depends on:** TAXI-104
**Description:** Create `ledger_entry_type` enum (`sale`, `receipt`, `payment`, `adjustment`, `opening_balance`). Create `accounts.ledger_entries` per Section 4.10. Create `system.audit_log` per Section 4.11 (JSONB old_row/new_row). Create `system.settings` per Section 4.11.

**Manual Test Plan:**
1. Run `supabase db reset`. **Pass criterion:** No errors.
2. Insert a `sale` ledger entry referencing the bill from TAXI-104 with `debit_amount=1500`, `narration='Bill BILL-0001 raised'`.
3. **Pass criterion:** Row saves.
4. Insert a `receipt` ledger entry with `credit_amount=1500`, `payment_mode='upi'`, `reference_no='UPI-12345'`.
5. **Pass criterion:** Row saves.
6. Open `system.settings`, insert `setting_key='default_tax_rate'`, `setting_value='5'`, `data_type='number'`.
7. **Pass criterion:** Row saves. Try to insert a second row with the same key for the same company — should fail unique violation.

---

### TAXI-106 — Implement fn_set_interstate trigger on master.gst_config
**Type:** Feature · **Module:** M1 · **Depends on:** TAXI-105
**Description:** Implement `master.fn_set_interstate()` PL/pgSQL function per Section 4.6. Attach as `trg_gst_interstate` BEFORE INSERT OR UPDATE on `master.gst_config`. The function compares `customer.state` to `company.state` and sets `NEW.is_interstate`.

**Manual Test Plan:**
1. Make sure your test company has `state='Delhi'`.
2. Create a customer with `state='Maharashtra'` (different state).
3. Insert a `master.gst_config` row for that customer with `igst_rate=5`.
4. **Pass criterion:** Query `SELECT is_interstate FROM master.gst_config WHERE customer_id = <id>;` returns `true`.
5. Create a second customer with `state='Delhi'` (same state).
6. Insert a `master.gst_config` row for that customer.
7. **Pass criterion:** `is_interstate` is `false` for that row.
8. Edit the second customer's `state` to `'Karnataka'`, then UPDATE the gst_config row (e.g. bump `igst_rate` to 12).
9. **Pass criterion:** `is_interstate` flips to `true` automatically after the update.

---

### TAXI-107 — Implement fn_assign_duty_slip_no trigger on operations.duty_slips
**Type:** Feature · **Module:** M1 · **Depends on:** TAXI-106
**Description:** Implement `operations.fn_assign_duty_slip_no()` per Section 4.9. Attach as `trg_duty_slip_no` BEFORE INSERT. Logic: if `NEW.duty_slip_no IS NULL`, fetch next value from `master.document_sequences` (sequence_key='duty_slip'), format with prefix + lpad(next_value, padding_length, '0') + suffix, increment `next_value`. If sequence row missing, fallback to `'DS-' || NEW.id`. If `duty_slip_no` is provided (manual mode), use it as-is.

**Manual Test Plan:**
1. Confirm `master.document_sequences` has a row with `sequence_key='duty_slip'`, `prefix='DS-'`, `next_value=1`, `padding_length=4`, `mode='auto'`.
2. Insert a duty slip WITHOUT setting `duty_slip_no` (let the trigger fill it).
3. **Pass criterion:** `SELECT duty_slip_no FROM operations.duty_slips ORDER BY id DESC LIMIT 1;` returns `'DS-0001'`.
4. Check `master.document_sequences` again — `next_value` should now be `2`.
5. Insert a second duty slip. **Pass criterion:** `duty_slip_no` is `'DS-0002'`.
6. Update the sequence row: set `mode='manual'`. Insert a duty slip with `duty_slip_no='CUSTOM-001'` explicitly.
7. **Pass criterion:** The row saves with `duty_slip_no='CUSTOM-001'`. The sequence's `next_value` does NOT increment.
8. Try to insert a duty slip with `duty_slip_no=NULL` while in manual mode — the fallback `'DS-' || id` should apply.
9. **Pass criterion:** The row saves with a fallback number like `'DS-5'`.

---

### TAXI-108 — Implement fn_calculate_gst trigger on billing.bills
**Type:** Feature · **Module:** M1 · **Depends on:** TAXI-107
**Description:** Implement `billing.fn_calculate_gst()` BEFORE INSERT on `billing.bills` per the GST decision tree in Section 5.5. Logic: read `master.gst_config` for `(company_id, customer_id) where effective_to IS NULL`. If `is_interstate=true`: `igst_amount = (base+extra) * igst_rate / 100`, `cgst=sgst=0`. Else: `cgst = sgst = (base+extra) * cgst_rate / 100`, `igst=0`. Compute `round_off` so `grand_total` is a whole rupee.

**Manual Test Plan:**
1. Setup: company in Delhi, customer in Maharashtra (interstate), `gst_config.igst_rate=5`.
2. Insert a bill with `base_amount=1000`, `extra_amount=200`, `customer_id=<that customer>`.
3. **Pass criterion:** `SELECT igst_amount, cgst_amount, sgst_amount, total_tax, total_after_tax FROM billing.bills WHERE id = <id>;` returns `igst_amount=60` (5% of 1200), `cgst=0`, `sgst=0`, `total_tax=60`, `total_after_tax=1260`.
4. Setup: company in Delhi, customer in Delhi (intra-state), `gst_config.cgst_rate=2.5, sgst_rate=2.5`.
5. Insert a bill for that customer with same amounts.
6. **Pass criterion:** `cgst=30`, `sgst=30`, `igst=0`, `total_tax=60`, `total_after_tax=1260`.
7. Insert a bill with `base_amount=1000.50`. **Pass criterion:** `grand_total` is a whole rupee (e.g. `1261`), and `round_off` is `0.50` or `-0.50`.

---

### TAXI-109 — Implement fn_audit_row generic trigger + attach to all business tables
**Type:** Feature · **Module:** M1 · **Depends on:** TAXI-108
**Description:** Implement `system.fn_audit_row()` generic trigger function per Section 9.2. On INSERT/UPDATE/DELETE, insert a row into `system.audit_log` with `table_name=TG_TABLE_NAME`, `record_id`, `action=TG_OP`, `old_row`/`new_row` as JSONB (use `to_jsonb(OLD)`/`to_jsonb(NEW)`), `changed_by=auth.uid()`. Attach this trigger to all business tables: customers, vehicles, vehicle_groups, vehicle_types, rates, gst_config, document_sequences, duty_slips, bills, bill_duty_slips, ledger_entries. Add an RLS policy on `system.audit_log` that denies all writes except via the trigger function.

**Manual Test Plan:**
1. Run `supabase db reset`. Log in as a test user (so `auth.uid()` returns a value).
2. Insert a customer row via the Supabase Studio Table Editor.
3. Open `system.audit_log` → **Pass criterion:** One row exists with `table_name='customers'`, `action='INSERT'`, `new_row` containing your customer data, `changed_by` set to your user's UUID.
4. Update the customer (change the phone number).
5. **Pass criterion:** A new audit_log row appears with `action='UPDATE'`, `old_row` showing the old phone, `new_row` showing the new phone.
6. Delete the customer.
7. **Pass criterion:** A new audit_log row appears with `action='DELETE'`, `old_row` showing the deleted customer, `new_row=NULL`.
8. Try to manually INSERT into `system.audit_log` via SQL Editor as the anon role.
9. **Pass criterion:** Insert is blocked by RLS (you get a "row-level security policy" error).

---

### TAXI-110 — Implement RLS policies + helper functions on all tenant-scoped tables
**Type:** Feature · **Module:** M1 · **Depends on:** TAXI-109
**Description:** Implement `public.current_company_id()` and `public.current_user_role()` STABLE SQL functions per Section 4.12. Enable RLS on every tenant-scoped table. Apply the canonical three-policy shape to each: (1) `*_tenant_isolation` FOR ALL using `company_id = current_company_id()`, (2) `*_write_requires_operator` FOR INSERT WITH CHECK `current_user_role() IN ('owner','operator')`, (3) `*_update_requires_operator_or_accountant` FOR UPDATE. Generate policies via a SQL script to avoid hand-writing 30+ policies.

**Manual Test Plan:**
1. Set up the Supabase Auth hook so the JWT carries `company_id` and `user_role` claims (this is done in M2 — for now you can hard-code a test JWT claim in the SQL editor using `set local role` and `set local request.jwt.claim.company_id`).
2. Create two users belonging to two different companies.
3. As user A, insert a customer with `company_id = A`.
4. **Pass criterion:** Insert succeeds.
5. As user A, try to insert a customer with `company_id = B` (a different company).
6. **Pass criterion:** Insert is blocked by RLS.
7. As user A, run `SELECT * FROM master.customers;`
8. **Pass criterion:** You only see customer A's rows — never B's.
9. As a user with `role='viewer'`, try to INSERT a customer.
10. **Pass criterion:** Insert blocked — viewer role is not in the operator list.

---
# MODULE M2 — Auth & User Management

Goal: A working login screen, JWT claims carrying `company_id` and `user_role`, role-based UI gating, and a user-management screen for the `owner` role.

---

### TAXI-201 — Implement AuthProvider + useAuth hook
**Type:** Feature · **Module:** M2 · **Depends on:** TAXI-110
**Description:** Implement `src/services/AuthProvider.tsx` wrapping the app. Exposes `session`, `user`, `role`, `companyId`, `signIn(email, password)`, `signOut()`, `refresh()`. Refreshes the session on window focus. Decodes JWT claims `company_id` and `user_role` from the access token.

**Manual Test Plan:**
1. Start the app. Open `http://localhost:5173/login`.
2. **Pass criterion:** You see a login form with email and password fields and a Sign In button.
3. Enter credentials for a test user you created in Supabase Studio → Authentication.
4. Click **Sign In**.
5. **Pass criterion:** The URL changes to `/` (home). No errors in the console.
6. Open React DevTools → find `AuthProvider`. **Pass criterion:** The `session`, `user`, `role`, `companyId` props are all populated (not null/undefined).
7. Refresh the page (F5).
8. **Pass criterion:** You stay logged in (session persists across reload).
9. Click **Sign Out** (add a temporary button somewhere visible).
10. **Pass criterion:** URL returns to `/login`. `AuthProvider` shows `session=null`.

---

### TAXI-202 — Configure Supabase Auth hook to inject company_id + user_role into JWT
**Type:** Feature · **Module:** M2 · **Depends on:** TAXI-201
**Description:** Implement a Supabase Auth hook (a PL/pgSQL function invoked at token issuance) that reads `core.user_profiles.company_id` and `.role` for the authenticated user and injects them as JWT claims `company_id` and `user_role`. Register the hook in `supabase/config.toml` under `[auth.hook.custom_access_token]`.

**Manual Test Plan:**
1. Log in as a test user via the app.
2. Open DevTools → Application → Local Storage → find the `sb-<ref>-auth-token` key.
3. Copy the access token (the long JWT). Paste it into https://jwt.io (or run `console.log(atob(token.split('.')[1]))` in the console).
4. **Pass criterion:** The decoded payload contains `company_id` (a number) and `user_role` (a string like `operator`).
5. Update the user's role in `core.user_profiles` to `accountant` via SQL.
6. Sign out and sign back in. Decode the new JWT.
7. **Pass criterion:** `user_role` now says `accountant`.

---

### TAXI-203 — Implement RoleGuard component
**Type:** Feature · **Module:** M2 · **Depends on:** TAXI-202
**Description:** Implement `src/components/RoleGuard.tsx`. Props: `allowedRoles: user_role[]`, `fallback?: ReactNode`, `children`. If the current user's role is not in `allowedRoles`, hide children and render `fallback` (default: null). If hard denial (e.g. navigating directly to a forbidden URL), redirect to `/unauthorized`.

**Manual Test Plan:**
1. Log in as a `viewer` user.
2. Add a temporary test page at `/test-guard` wrapped in `<RoleGuard allowedRoles={['owner','operator']}>` rendering "Secret operator content".
3. Navigate to `/test-guard`.
4. **Pass criterion:** You do NOT see "Secret operator content". You either see the fallback (empty) or get redirected to `/unauthorized`.
5. Log out, log in as an `operator` user, navigate to `/test-guard`.
6. **Pass criterion:** "Secret operator content" is visible.
7. Log out, log in as an `owner`, navigate to `/test-guard`.
8. **Pass criterion:** "Secret operator content" is visible.

---

### TAXI-204 — Build Login page UI
**Type:** Feature · **Module:** M2 · **Depends on:** TAXI-203
**Description:** Implement `src/panels/auth/LoginPage.tsx` with email + password fields, a Sign In button, and a small loading spinner on the button while sign-in is in flight. Use React Hook Form + Zod for validation (email format, password min 8 chars). Show inline error messages under each field. On unauthenticated access to any `/master|/daily-work|/accounts|/reports` route, redirect to `/login`.

**Manual Test Plan:**
1. Open `http://localhost:5173/master` while logged out.
2. **Pass criterion:** You are redirected to `/login`.
3. Click **Sign In** without entering anything.
4. **Pass criterion:** Both fields show red error messages ("Email is required", "Password is required"). No API call is made (check Network tab).
5. Type `not-an-email` in the email field and click Sign In.
6. **Pass criterion:** Email field shows "Invalid email format".
7. Type a valid email and a 3-character password.
8. **Pass criterion:** Password field shows "Password must be at least 8 characters".
9. Type valid credentials for a real test user, click Sign In.
10. **Pass criterion:** The button shows a spinner. After ~1 second, you are redirected to `/`. URL is `/`.
11. Type wrong credentials. **Pass criterion:** A red banner appears above the form saying "Invalid login credentials" (or similar).

---

### TAXI-205 — Build User Management page (owner-only)
**Type:** Feature · **Module:** M2 · **Depends on:** TAXI-204
**Description:** Implement `src/panels/settings/UserManagementPage.tsx` at route `/settings/users`. Wrapped in `<RoleGuard allowedRoles={['owner']}>`. Lists all `core.user_profiles` rows for the current company. Owner can: (a) invite a new user (calls Supabase Auth admin invite), (b) change a user's role (dropdown: owner/operator/accountant/viewer), (c) toggle `is_active`. All mutations go through `useEntityQuery('user_profiles')`.

**Manual Test Plan:**
1. Log in as `owner`. Navigate to `/settings/users`.
2. **Pass criterion:** You see a table of users belonging to your company, each with name, email, role dropdown, active toggle, and an "Invite User" button at the top.
3. Log out, log in as `operator`. Navigate to `/settings/users`.
4. **Pass criterion:** You are redirected to `/unauthorized` (or the page is hidden in the nav).
5. Log back in as `owner`. Click **Invite User**, enter a new email, select role `operator`, submit.
6. **Pass criterion:** A new row appears in the table with `is_active=false` (until the invitee accepts). An invite email is sent (check Supabase Studio → Authentication → Users for the new pending user).
7. Change a user's role from `operator` to `accountant` using the dropdown.
8. **Pass criterion:** A green toast/notification says "Role updated". The dropdown now shows `accountant`. Refresh the page — the change persists.
9. Toggle a user's `is_active` to false.
10. **Pass criterion:** The user appears greyed out. Try to log in as that user — login should fail with "User not active" or similar.

---
# MODULE M3 — Master Panel: Company Detail

Goal: The operator can view and edit their own company profile (name, legal name, owner, GSTIN, PAN, address, state, contact, logo). State is critical because it drives GST logic. Logo is uploaded to Supabase Storage.

---

### TAXI-301 — Build Company Detail page UI (read + edit form)
**Type:** Feature · **Module:** M3 · **Depends on:** TAXI-205
**Description:** Implement `src/panels/master/CompanyDetailPage.tsx` at route `/master/company`. A single-record form bound to `core.companies` (the current user's company). Fields: name, legal_name, owner_name, gstin, pan, address_line1, address_line2, city, state (dropdown of Indian states), pincode, phone, email, logo upload. Uses React Hook Form + Zod. Save button calls `supabaseClient.from('companies').update(...)`.

**Manual Test Plan:**
1. Log in as `owner`. Navigate to `/master/company`.
2. **Pass criterion:** The form is pre-filled with your company's data (name, gstin, state, etc.).
3. Change the `phone` field to a new number, click **Save**.
4. **Pass criterion:** A green toast says "Company updated". Refresh the page — the new phone number persists.
5. Clear the `name` field (required), click Save.
6. **Pass criterion:** Save is blocked. The `name` field shows a red error "Name is required".
7. Type an invalid GSTIN (e.g. "ABC"), click Save.
8. **Pass criterion:** Save is blocked. `gstin` field shows "GSTIN must be 15 characters".
9. Try to change `state` to empty. **Pass criterion:** Blocked — state is required (GST logic depends on it).

---

### TAXI-302 — Implement company logo upload to Supabase Storage
**Type:** Feature · **Module:** M3 · **Depends on:** TAXI-301
**Description:** Add a file input + preview to the Company Detail page. On file select, upload to Supabase Storage bucket `company-logos` under the key `<company_id>/<timestamp>.<ext>`. Set `core.companies.logo_path` to the storage key. On page load, fetch a signed URL for the logo and display it.

**Manual Test Plan:**
1. Navigate to `/master/company`.
2. **Pass criterion:** If no logo is set, you see a placeholder image and an "Upload Logo" button.
3. Click **Upload Logo**, pick a JPG or PNG file (< 1 MB) from your computer.
4. **Pass criterion:** A progress spinner appears briefly. Then the uploaded image shows in the preview area.
5. Open Supabase Studio → Storage → `company-logos` bucket.
6. **Pass criterion:** Your uploaded file appears in the bucket under `<company_id>/...`.
7. Refresh the Company Detail page.
8. **Pass criterion:** The logo preview still shows your uploaded image (loaded from a signed URL).
9. Try to upload a 10 MB file. **Pass criterion:** Upload is blocked with an error "File too large (max 1 MB)".
10. Try to upload a `.txt` file. **Pass criterion:** Blocked with "Only JPG and PNG allowed".

---

### TAXI-303 — Enforce RLS + role gating on Company Detail
**Type:** Task · **Module:** M3 · **Depends on:** TAXI-302
**Description:** Confirm the page is wrapped in `<RoleGuard allowedRoles={['owner','operator','accountant']}>`. Viewers can read but not edit. Only owner/operator can edit. The Save button is hidden for `accountant` and `viewer`.

**Manual Test Plan:**
1. Log in as `accountant`. Navigate to `/master/company`.
2. **Pass criterion:** The form is visible and pre-filled. The Save button is hidden (or disabled).
3. Try to edit a field — **Pass criterion:** All fields are read-only (cannot type).
4. Log in as `viewer`. Navigate to `/master/company`.
5. **Pass criterion:** Same as above — read-only, no Save button.
6. Log in as `operator`. **Pass criterion:** All fields editable, Save button visible.
7. Log in as `owner`. **Pass criterion:** All fields editable, Save button visible.

---

# MODULE M4 — Master Panel: Utilities (Vehicles + Document No. Control)

Goal: The Utilities page has two tabs. Tab 1 manages vehicles (CRUD with group/type filters, RC/insurance/permit expiry dates, active flag). Tab 2 manages `master.document_sequences` (prefix/suffix/next_value/mode/padding for duty_slip and bill).

---

### TAXI-401 — Build Utilities page shell with two tabs
**Type:** Feature · **Module:** M4 · **Depends on:** TAXI-303
**Description:** Implement `src/panels/master/UtilitiesPage.tsx` at route `/master/utilities`. Two tabs: "Manage Vehicles" and "Document No. Control". The active tab is reflected in the URL hash (`/master/utilities#vehicles` vs `#doc-seq`). Default tab is Vehicles.

**Manual Test Plan:**
1. Navigate to `/master/utilities`.
2. **Pass criterion:** Two tab buttons are visible: "Manage Vehicles" and "Document No. Control". The Vehicles tab is active by default.
3. Click **Document No. Control**.
4. **Pass criterion:** The URL changes to `/master/utilities#doc-seq`. The Doc No. Control tab content is visible.
5. Refresh the page.
6. **Pass criterion:** You land back on the Doc No. Control tab (state persists via URL hash).
7. Click **Manage Vehicles**. URL changes to `#vehicles`, tab content switches.

---

### TAXI-402 — Implement Vehicle Groups + Vehicle Types CRUD
**Type:** Feature · **Module:** M4 · **Depends on:** TAXI-401
**Description:** Inside the Manage Vehicles tab, add a "Manage Taxonomy" sub-section. Lists existing `vehicle_groups` and `vehicle_types` for the company. Operator can add a new group/type (name + display_order for groups), edit, and delete (delete blocked if any vehicle references it).

**Manual Test Plan:**
1. Navigate to `/master/utilities` → Manage Vehicles tab.
2. **Pass criterion:** A "Manage Taxonomy" section shows two lists: Vehicle Groups (with display order) and Vehicle Types.
3. Click **Add Group**, enter name "Sedan", display_order 1, save.
4. **Pass criterion:** "Sedan" appears in the groups list. A green toast confirms save.
5. Add "SUV" (order 2), "Tempo" (order 3).
6. **Pass criterion:** The list is sorted by display_order ascending.
7. Try to add a duplicate group name "Sedan".
8. **Pass criterion:** Save is blocked with "Group name already exists".
9. Click **Add Type**, enter "AC". **Pass criterion:** "AC" appears in types list. Add "Non-AC", "Electric".
10. Click the delete (trash) icon next to "Tempo" (no vehicles reference it yet).
11. **Pass criterion:** "Tempo" is removed from the list.
12. Now create a vehicle (TAXI-403) referencing "Sedan" group. Come back and try to delete "Sedan".
13. **Pass criterion:** Delete is blocked with "Cannot delete: 1 vehicle uses this group".

---

### TAXI-403 — Implement Vehicle CRUD list with filters
**Type:** Feature · **Module:** M4 · **Depends on:** TAXI-402
**Description:** Implement the main vehicle list inside Manage Vehicles tab. TanStack Table v8 with columns: registration_no, group, type, make, model, RC expiry, insurance expiry, permit expiry, is_active, actions. Filter bar: dropdowns for vehicle_group, vehicle_type, active status; search box for registration_no. "Add Vehicle" button opens a modal form with all vehicle fields. Edit and Delete actions per row.

**Manual Test Plan:**
1. Navigate to Manage Vehicles tab. **Pass criterion:** An empty vehicle table is shown with column headers and an "Add Vehicle" button.
2. Click **Add Vehicle**.
3. **Pass criterion:** A modal opens with fields: registration_no, group (dropdown), type (dropdown), make, model, year, color, chassis_no, engine_no, RC expiry (date picker), insurance_no, insurance expiry, permit_no, permit expiry, is_active toggle.
4. Fill `registration_no='DL 01 AB 1234'`, select group Sedan, type AC, set RC expiry to today+1 year, save.
5. **Pass criterion:** Modal closes. The new vehicle appears in the table.
6. Add two more vehicles: one SUV/Non-AC, one Sedan/Electric.
7. **Pass criterion:** The table shows three rows.
8. In the filter bar, select group = Sedan. **Pass criterion:** Table filters to two rows (Sedan/AC + Sedan/Electric).
9. Clear the filter, select type = Non-AC. **Pass criterion:** Table shows one row.
10. Type "DL 01" in the search box. **Pass criterion:** Table filters to vehicles whose registration starts with "DL 01".
11. Click the edit (pencil) icon on the first row.
12. **Pass criterion:** The modal opens pre-filled with that vehicle's data. Change the color and save.
13. **Pass criterion:** The color column updates in the table.
14. Click the delete (trash) icon on a row.
15. **Pass criterion:** A confirmation dialog asks "Are you sure?". Confirm — the row disappears.
16. Try to add a duplicate registration_no. **Pass criterion:** Blocked with "Registration number already exists".

---

### TAXI-404 — Implement Document No. Control tab UI
**Type:** Feature · **Module:** M4 · **Depends on:** TAXI-403
**Description:** Implement the Document No. Control tab. A table listing all `master.document_sequences` rows for the company. Columns: sequence_key, prefix, next_value, suffix, padding_length, mode, is_active, actions. Add new sequence (for future document types). Edit existing (change prefix/suffix/mode/padding/next_value). Toggle is_active.

**Manual Test Plan:**
1. Navigate to Utilities → Document No. Control tab.
2. **Pass criterion:** A table shows the two default rows: `duty_slip` and `bill` (created during migrations). Each has editable fields.
3. Click on the `duty_slip` row's prefix field, change it from "DS-" to "DSH-". Press Tab or click Save.
4. **Pass criterion:** The cell turns green briefly. The change persists after refresh.
5. Change `next_value` from 1 to 100. **Pass criterion:** Save succeeds.
6. Change `mode` from `auto` to `manual`. **Pass criterion:** Save succeeds.
7. Change `padding_length` from 4 to 6. **Pass criterion:** Save succeeds.
8. Click "Add Sequence". **Pass criterion:** A form appears asking for sequence_key, prefix, suffix, next_value, mode, padding_length.
9. Enter sequence_key='receipt', prefix='RCP-', mode='auto', padding_length=5. Save.
10. **Pass criterion:** The new row appears in the table.
11. Try to add a duplicate sequence_key='duty_slip'. **Pass criterion:** Blocked with "Sequence key already exists".
12. Toggle `is_active` off on the `receipt` row. **Pass criterion:** The row appears greyed out.

---

### TAXI-405 — Verify Document No. Control affects actual duty slip + bill numbering
**Type:** Task · **Module:** M4 · **Depends on:** TAXI-404
**Description:** Integration check: after editing the duty_slip sequence's prefix/next_value/padding, the next duty slip created in Daily Work should use the new format. Same for bills.

**Manual Test Plan:**
1. In Doc No. Control, set duty_slip sequence: prefix='DS-', next_value=1, padding_length=4, mode='auto'.
2. Open Supabase Studio → SQL Editor → insert a duty slip manually (use the trigger from TAXI-107).
3. **Pass criterion:** `SELECT duty_slip_no FROM operations.duty_slips ORDER BY id DESC LIMIT 1;` returns `'DS-0001'`.
4. Go back to Doc No. Control, change prefix to 'TAXI-', padding_length to 6.
5. Insert another duty slip. **Pass criterion:** `duty_slip_no` is `'TAXI-000002'` (next_value was incremented to 2 by the first insert, and the new format applies).
6. Change mode to `manual`.
7. Insert a duty slip with `duty_slip_no='MY-CUSTOM-001'`. **Pass criterion:** Saves with that exact number. `next_value` does not increment.
8. Change mode back to `auto` and insert one more duty slip (without setting duty_slip_no). **Pass criterion:** `duty_slip_no` is `'TAXI-000003'` (next_value is 3, format applies).

---

# MODULE M5 — Master Panel: Customers

Goal: The Customer page stores both B2B clients (`client_type='company'` — requires company_name + gstin) and personal clients (`client_type='personal'` — name + phone only). State field drives GST config. List supports search and filters.

---

### TAXI-501 — Build Customer list page
**Type:** Feature · **Module:** M5 · **Depends on:** TAXI-405
**Description:** Implement `src/panels/master/CustomersPage.tsx` at route `/master/customers`. TanStack Table with columns: name, company_name, client_type, gstin, state, phone, is_active, actions. Filter bar: search box (matches name, phone, or gstin), client_type dropdown, is_active dropdown. "Add Customer" button.

**Manual Test Plan:**
1. Navigate to `/master/customers`.
2. **Pass criterion:** An empty table is shown with the correct column headers, a filter bar above it, and an "Add Customer" button at the top right.
3. Add 3 customers via the form (TAXI-502): 2 company clients (different states) and 1 personal client.
4. **Pass criterion:** All 3 appear in the table.
5. Type the name of one company client in the search box.
6. **Pass criterion:** The table filters to show only that one customer.
7. Clear the search, type the customer's GSTIN in the search box.
8. **Pass criterion:** The table filters to that one customer.
9. Clear the search, select `client_type='personal'` in the dropdown.
10. **Pass criterion:** Table shows only the personal client.
11. Select `is_active='inactive'`. **Pass criterion:** Table shows zero rows (all your customers are active).

---

### TAXI-502 — Build Customer add/edit form with client_type toggle
**Type:** Feature · **Module:** M5 · **Depends on:** TAXI-501
**Description:** Implement a Customer form (modal or drawer) with fields per Section 5.3. The `client_type` radio (company/personal) at the top toggles which fields are required: company requires `company_name` + `gstin`, personal skips both. All customers require `name`, `phone`, `state`. State is a dropdown of Indian states. Form uses React Hook Form + Zod with conditional validation.

**Manual Test Plan:**
1. Click **Add Customer**.
2. **Pass criterion:** Form opens with `client_type='company'` selected by default. Fields: name, company_name (required), gstin (required), address, city, state (required, dropdown), pincode, phone (required), email, pan, is_active, notes.
3. Click the `client_type='personal'` radio.
4. **Pass criterion:** The `company_name` and `gstin` fields disappear (or become optional).
5. Switch back to `company`, try to save with `company_name` empty.
6. **Pass criterion:** Save blocked — `company_name` shows "Company name is required for B2B clients".
7. Try to save with `gstin` empty. **Pass criterion:** Blocked — gstin required.
8. Try to save with `gstin='ABC'` (wrong length). **Pass criterion:** Blocked — "GSTIN must be 15 characters".
9. Fill all required fields for a company client in Maharashtra. Save.
10. **Pass criterion:** Form closes, new row in the table, green toast "Customer created".
11. Click **Add Customer** again, choose `personal`, fill name + phone + state (Delhi). Save.
12. **Pass criterion:** Saves successfully. Row appears in the table with `client_type='personal'` and `company_name` empty.
13. Click edit (pencil) on an existing customer. **Pass criterion:** Form opens pre-filled. Change the phone and save — change persists.

---

### TAXI-503 — Enforce state dropdown for GST correctness
**Type:** Task · **Module:** M5 · **Depends on:** TAXI-502
**Description:** The `state` field on the Customer form must be a dropdown of the 28 Indian states + 8 UTs (use a constant array). No free-text entry. This guarantees the GST config lookup matches the company's state value exactly.

**Manual Test Plan:**
1. Click **Add Customer**, focus the `state` field.
2. **Pass criterion:** A dropdown opens with all 36 states/UTs (Maharashtra, Delhi, Karnataka, Tamil Nadu, etc.). You cannot type a custom value.
3. Select "Maharashtra" and save. **Pass criterion:** Customer saves with `state='Maharashtra'`.
4. Edit the customer, change state to "Karnataka". Save. **Pass criterion:** Change persists.
5. Open the customer's gst_config (after TAXI-701) and verify the `is_interstate` flag flips accordingly.

---

### TAXI-504 — Implement customer deactivate (soft delete)
**Type:** Feature · **Module:** M5 · **Depends on:** TAXI-503
**Description:** Each customer row has a toggle for `is_active`. Deactivating sets `is_active=false`. Inactive customers do NOT appear in the customer dropdown on the Duty Slip form (TAXI-801), but their historical duty slips and bills remain intact.

**Manual Test Plan:**
1. Create a customer "Acme Corp". Create a duty slip for them (after M8).
2. Go back to the Customer list, find Acme Corp, toggle `is_active` to false.
3. **Pass criterion:** The customer row appears greyed out. A toast says "Customer deactivated".
4. Filter the list by `is_active='inactive'`. **Pass criterion:** Acme Corp appears.
5. Filter by `is_active='active'`. **Pass criterion:** Acme Corp does NOT appear.
6. Open the Duty Slip form (TAXI-801) and open the customer dropdown.
7. **Pass criterion:** Acme Corp is NOT in the dropdown.
8. Go back and toggle `is_active` back to true. Open the Duty Slip form again.
9. **Pass criterion:** Acme Corp is back in the dropdown.
10. Open the historical duty slip for Acme Corp — **Pass criterion:** It still loads and shows the customer name correctly.

---

### TAXI-505 — Verify RLS + role gating on Customers
**Type:** Task · **Module:** M5 · **Depends on:** TAXI-504
**Description:** Confirm: viewer can read but not add/edit; accountant can read but not add/edit; operator + owner can add/edit. Verify RLS prevents one company from seeing another company's customers.

**Manual Test Plan:**
1. Log in as `viewer`. Navigate to `/master/customers`.
2. **Pass criterion:** The list is visible. The "Add Customer" button is hidden. Edit/delete actions are hidden.
3. Log in as `accountant`. **Pass criterion:** List visible, no Add button, no edit/delete actions.
4. Log in as `operator`. **Pass criterion:** List visible, Add button visible, edit/delete actions visible.
5. Log in as `owner`. **Pass criterion:** Same as operator.
6. Create a second company (in `core.companies`) and a second user belonging to that company.
7. Log in as the second user.
8. **Pass criterion:** The customer list is empty (you only see your own company's customers, not the first company's).

---
# MODULE M6 — Master Panel: Rate Management

Goal: The Rate Management page is the heart of the billing engine. The operator picks a customer, optionally filters by vehicle_group/vehicle_type, and sees a matrix of (vehicle_group, vehicle_type, duty_type) → rate card. Changing a rate inserts a new row with `effective_from=today` and closes the previous row with `effective_to=yesterday` (time-travel for historical accuracy). The `flexible` duty type has no rate fields.

---

### TAXI-601 — Build Rate Management page shell + customer picker
**Type:** Feature · **Module:** M6 · **Depends on:** TAXI-505
**Description:** Implement `src/panels/master/RateManagementPage.tsx` at route `/master/rates`. Top of the page: a customer dropdown (only active customers). Below: filter dropdowns for vehicle_group and vehicle_type (optional). When a customer is selected, the rate matrix (TAXI-602) loads.

**Manual Test Plan:**
1. Navigate to `/master/rates`.
2. **Pass criterion:** The page shows a "Select Customer" dropdown at the top, empty rate matrix below, and a hint "Please select a customer to view rates".
3. Click the customer dropdown. **Pass criterion:** Only active customers appear (no inactive ones).
4. Select a customer. **Pass criterion:** The rate matrix loads (possibly empty if no rates exist yet — that's fine for now).
5. Without selecting a customer, the matrix should remain empty with the hint visible.
6. Switch to a different customer. **Pass criterion:** The matrix reloads with that customer's rates.

---

### TAXI-602 — Build Rate matrix table (read + add + edit)
**Type:** Feature · **Module:** M6 · **Depends on:** TAXI-601
**Description:** Render rates as a matrix: rows = (vehicle_group, vehicle_type, duty_type) triples; columns = rate fields (base_rate, per_km_rate, per_hour_rate, per_day_rate, extra_hour_rate, extra_km_rate, night_halt_rate, driver_allowance, min_charge, effective_from, effective_to, actions). Cells are editable inline. "Add Rate" button opens a form to create a new rate row. Only the currently-effective rate (effective_to IS NULL) is editable.

**Manual Test Plan:**
1. Select a customer. Click **Add Rate**.
2. **Pass criterion:** A form opens with dropdowns: vehicle_group, vehicle_type, duty_type, and rate fields (base_rate required, others optional based on duty_type).
3. Select vehicle_group=Sedan, vehicle_type=AC, duty_type=per_km. Enter base_rate=500, per_km_rate=12. Save.
4. **Pass criterion:** New row appears in the matrix. `effective_from=today`, `effective_to` is blank.
5. Add a second rate: SUV/Non-AC/per_day, base_rate=3000, per_day_rate=3000. Save.
6. **Pass criterion:** Two rows in the matrix.
7. Click on the base_rate cell of the first row, change 500 to 600, press Enter.
8. **Pass criterion:** A confirmation dialog says "Changing a rate creates a new effective row. The old rate will be closed. Continue?". Click Confirm.
9. **Pass criterion:** The matrix now shows two rows for the same (Sedan/AC/per_km): one with `effective_to=yesterday` (the old rate, base_rate=500), one with `effective_from=today`, `effective_to=NULL`, base_rate=600.
10. Try to edit the old (closed) rate row. **Pass criterion:** Edit is blocked — closed rows are read-only.
11. Add a `flexible` duty_type rate. **Pass criterion:** The rate fields section is hidden (flexible has no rates).

---

### TAXI-603 — Implement rate time-travel (effective_from / effective_to)
**Type:** Feature · **Module:** M6 · **Depends on:** TAXI-602
**Description:** When the operator edits a currently-effective rate, the form performs: (a) UPDATE the existing row SET effective_to = CURRENT_DATE - 1; (b) INSERT a new row with effective_from = CURRENT_DATE, effective_to = NULL, and the new rate values. The duty slip rate lookup (TAXI-803) picks the rate where effective_from <= booking_date AND (effective_to IS NULL OR effective_to >= booking_date).

**Manual Test Plan:**
1. Setup: customer has a rate (Sedan/AC/per_km, base_rate=500, effective_from=2026-01-01, effective_to=NULL).
2. Create a duty slip with booking_date=today referencing that customer+vehicle+duty_type (use the Daily Work form after M8, or insert via SQL for now).
3. **Pass criterion:** The duty slip's `rate_id` points to the rate row, and `base_amount` reflects the 500 base rate.
4. Go back to Rate Management, edit the rate to base_rate=600.
5. **Pass criterion:** Old rate row now has effective_to=yesterday. New rate row has effective_from=today, base_rate=600.
6. Edit the old duty slip's booking_date to yesterday (before the rate change). Save.
7. **Pass criterion:** The duty slip's `base_amount` is still 500 (the rate lookup uses the old rate because booking_date=yesterday falls in the old rate's effective range).
8. Edit the duty slip's booking_date to today. Save.
9. **Pass criterion:** The duty slip's `base_amount` updates to 600 (new rate applies).

---

### TAXI-604 — Validate rate uniqueness on insert
**Type:** Task · **Module:** M6 · **Depends on:** TAXI-603
**Description:** Confirm the UNIQUE constraint `(company_id, customer_id, vehicle_group_id, vehicle_type_id, duty_type, effective_from)` is enforced. The form should catch this server-side and show a friendly error.

**Manual Test Plan:**
1. Select a customer. Add a rate: Sedan/AC/per_km, effective_from=today, base_rate=500. Save.
2. **Pass criterion:** Saves successfully.
3. Try to add a second rate with the SAME (Sedan/AC/per_km, effective_from=today).
4. **Pass criterion:** Save is blocked with a red banner "A rate for this combination already exists with the same effective date".
5. Try to add a rate with the same combination but effective_from=tomorrow.
6. **Pass criterion:** Saves successfully (different effective_from is allowed).
7. Try to add a rate with the same combination but effective_from=yesterday.
8. **Pass criterion:** Saves successfully. The matrix now shows two effective rows for the same combo — the time-travel lookup should pick the most recent one whose effective_from <= booking_date.

---

### TAXI-605 — Implement "Flexible" duty type handling
**Type:** Task · **Module:** M6 · **Depends on:** TAXI-604
**Description:** When `duty_type='flexible'` is selected on the rate form, all rate fields (base_rate, per_km_rate, etc.) are hidden. A note says "Flexible duty type has no rate card. The operator enters a custom amount on each duty slip." Saving a flexible rate creates a row with all rate fields NULL (except base_rate=0 if NOT NULL is required — adjust schema if needed).

**Manual Test Plan:**
1. Add a rate, select duty_type=`flexible`.
2. **Pass criterion:** The rate fields section collapses/disappears. A note appears: "Flexible duty type has no rate card. The operator enters a custom amount on each duty slip."
3. Save the rate. **Pass criterion:** Saves successfully. The matrix shows the row with rate fields blank/N/A.
4. Try to edit the flexible rate. **Pass criterion:** No rate fields to edit (just vehicle_group, vehicle_type, duty_type, effective_from).
5. Try to add a SECOND flexible rate for the same customer+vehicle_group+vehicle_type.
6. **Pass criterion:** Blocked with "Only one flexible rate is allowed per customer+vehicle combo" (or the unique constraint kicks in).

---

### TAXI-606 — Verify rate lookup correctness
**Type:** Task · **Module:** M6 · **Depends on:** TAXI-605
**Description:** Integration test: the rate lookup function (used by the Duty Slip form) must correctly pick the matching rate for a (customer, vehicle_group, vehicle_type, duty_type) triple where effective_from <= booking_date AND (effective_to IS NULL OR effective_to >= booking_date). For flexible, no lookup happens.

**Manual Test Plan:**
1. Setup: customer has two rates for the same (Sedan/AC/per_km): rate A effective_from=2026-01-01 to 2026-06-30 (base_rate=400), rate B effective_from=2026-07-01 to NULL (base_rate=500).
2. Open Supabase Studio → SQL Editor. Write a query that mimics the SPA's rate lookup for booking_date=2026-03-15.
3. **Pass criterion:** The query returns rate A (base_rate=400).
4. Run the same query for booking_date=2026-08-15.
5. **Pass criterion:** Returns rate B (base_rate=500).
6. Run the same query for booking_date=2026-06-30 (boundary).
7. **Pass criterion:** Returns rate A (effective_to is inclusive).
8. Run the same query for a (Sedan/AC/flexible) lookup. **Pass criterion:** Returns NULL or skips the lookup entirely (flexible has no rate).
9. Run the lookup for a (SUV/AC/per_km) combo that has no rate. **Pass criterion:** Returns NULL — the Duty Slip form should warn "No rate configured for this combo".

---

# MODULE M7 — Master Panel: GST Management

Goal: A per-customer GST config screen. The operator picks a customer, sees the current IGST rate (for interstate) or CGST/SGST rates (for intra-state). The `is_interstate` flag is auto-derived by the trigger (TAXI-106) comparing customer.state to company.state — the operator never sets it manually. The page shows a summary like "Customer is in Maharashtra, your company is in Delhi, therefore IGST applies."

---

### TAXI-701 — Build GST Management page UI
**Type:** Feature · **Module:** M7 · **Depends on:** TAXI-606
**Description:** Implement `src/panels/master/GstManagementPage.tsx` at route `/master/gst`. Top: customer dropdown (active only). When selected, shows a form with: is_interstate (read-only, derived), igst_rate (editable), cgst_rate + sgst_rate (editable, typically half of igst each), effective_from, effective_to (read-only). A read-only summary banner shows "Customer is in {state}, your company is in {state}, therefore {IGST | CGST+SGST} applies."

**Manual Test Plan:**
1. Navigate to `/master/gst`.
2. **Pass criterion:** A customer dropdown is shown. No form below until a customer is selected.
3. Select a customer in Maharashtra (your company is in Delhi).
4. **Pass criterion:** The summary banner says "Customer is in Maharashtra, your company is in Delhi, therefore IGST applies." The `is_interstate` field shows "Yes" (read-only).
5. **Pass criterion:** `igst_rate` field is editable. `cgst_rate` and `sgst_rate` fields are visible but greyed out (they are 0 for interstate).
6. Enter `igst_rate=5`. Save.
7. **Pass criterion:** Green toast "GST config saved". The matrix below (TAXI-702) shows the new row.
8. Select a customer in Delhi (same state as your company).
9. **Pass criterion:** Summary banner says "Customer is in Delhi, your company is in Delhi, therefore CGST+SGST applies." `is_interstate=No`. `igst_rate` is greyed out (0). `cgst_rate` and `sgst_rate` are editable.
10. Enter `cgst_rate=2.5, sgst_rate=2.5`. Save. **Pass criterion:** Saves successfully.

---

### TAXI-702 — Implement GST config list with time-travel
**Type:** Feature · **Module:** M7 · **Depends on:** TAXI-701
**Description:** Below the form, show a table of all gst_config rows for the selected customer, sorted by effective_from descending. Columns: effective_from, effective_to, is_interstate, igst_rate, cgst_rate, sgst_rate, status (active/closed). Only the active row (effective_to IS NULL) is editable. Closed rows are read-only.

**Manual Test Plan:**
1. Select a customer with one existing GST config (from TAXI-701).
2. **Pass criterion:** The table shows one row: effective_from=today, effective_to=blank, status=Active.
3. Edit the active row's `igst_rate` from 5 to 12. Save.
4. **Pass criterion:** A confirmation dialog says "Changing the GST rate creates a new effective row. The old rate will be closed. Continue?". Confirm.
5. **Pass criterion:** The table now shows two rows: row 1 with effective_from=today (old), effective_to=yesterday, status=Closed, igst_rate=5. Row 2 with effective_from=today, effective_to=blank, status=Active, igst_rate=12.
6. Try to edit the closed row. **Pass criterion:** Edit blocked — closed rows are read-only.
7. Try to add a new config with the same effective_from as the active row. **Pass criterion:** Blocked with "A config already exists for this effective date".

---

### TAXI-703 — Verify is_interstate auto-derivation on customer state change
**Type:** Task · **Module:** M7 · **Depends on:** TAXI-702
**Description:** Integration: if the operator edits a customer's `state` field (in M5) and the customer has an existing gst_config, the `is_interstate` flag should NOT auto-flip on existing rows (they are historical snapshots). Only NEW gst_config rows created after the state change should reflect the new is_interstate value.

**Manual Test Plan:**
1. Setup: customer in Delhi (same as company), gst_config row with is_interstate=false, cgst=2.5, sgst=2.5, effective_from=2026-01-01.
2. Edit the customer's state to "Maharashtra" via the Customer page.
3. **Pass criterion:** The existing gst_config row STILL shows is_interstate=false (historical row is preserved).
4. Go to GST Management, add a new config for this customer with effective_from=today.
5. **Pass criterion:** The new row's `is_interstate` is automatically `true` (because the customer is now in Maharashtra, company is in Delhi).
6. Open Supabase Studio → SQL Editor, run `SELECT * FROM master.gst_config WHERE customer_id = <id> ORDER BY effective_from;`
7. **Pass criterion:** Two rows: old one with is_interstate=false, new one with is_interstate=true.

---

### TAXI-704 — Verify bill trigger uses the correct gst_config row
**Type:** Task · **Module:** M7 · **Depends on:** TAXI-703
**Description:** Integration: when a bill is created for a customer, the `fn_calculate_gst` trigger (TAXI-108) reads the gst_config row where `effective_to IS NULL` (currently active). Verify this by creating bills with different booking dates and confirming the GST amounts use the historically-correct rate.

**Manual Test Plan:**
1. Setup: customer in Maharashtra, gst_config history: row A (effective_from=2026-01-01 to 2026-06-30, igst_rate=5), row B (effective_from=2026-07-01 to NULL, igst_rate=12).
2. Create a bill with bill_date=2026-03-15 (during row A's period).
3. **Pass criterion:** The bill's `igst_amount` = (base+extra) * 5 / 100.
4. **Note:** If the trigger only reads the currently-active row (row B), this test will FAIL. Discuss with the architect whether the trigger should time-travel by bill_date or always use the current rate. File as a question if uncertain.
5. Create a bill with bill_date=today (during row B's period).
6. **Pass criterion:** The bill's `igst_amount` = (base+extra) * 12 / 100.
7. Delete the active gst_config row (set effective_to=today). Try to create a bill for that customer.
8. **Pass criterion:** Bill insert fails with "No active GST config for this customer" — the trigger should raise an exception.

---

### TAXI-705 — Role gating on GST Management
**Type:** Task · **Module:** M7 · **Depends on:** TAXI-704
**Description:** Confirm: viewer + accountant can read but not edit; operator + owner can read and edit.

**Manual Test Plan:**
1. Log in as `viewer`. Navigate to `/master/gst`. Select a customer.
2. **Pass criterion:** The form is visible but all fields are read-only. No Save button.
3. Log in as `accountant`. **Pass criterion:** Same — read-only.
4. Log in as `operator`. **Pass criterion:** Fields editable, Save button visible.
5. Log in as `owner`. **Pass criterion:** Same as operator.

---
# MODULE M8 — Daily Work: Duty Slip CRUD + Flexible Duty Popup

Goal: The Duty Slip page is a two-section form (booking info + duty info). On save, the SPA calculates `total_km` and `total_hours` client-side, looks up the rate, and posts to `operations.duty_slips`. The trigger assigns `duty_slip_no`. The `flexible` duty type shows a custom rate popup.

---

### TAXI-801 — Build Duty Slip list page
**Type:** Feature · **Module:** M8 · **Depends on:** TAXI-705
**Description:** Implement `src/panels/dailywork/DutySlipListPage.tsx` at route `/daily-work/duty-slips`. TanStack Table with columns: duty_slip_no, booking_date, customer, vehicle, duty_type, total_km, total_hours, total_amount, status, actions. Filter bar: date range, customer dropdown, vehicle dropdown, status dropdown. "New Duty Slip" button. Click a row to open the Duty Slip form in edit mode.

**Manual Test Plan:**
1. Navigate to `/daily-work/duty-slips`.
2. **Pass criterion:** Empty table with the correct columns, a filter bar, and a "New Duty Slip" button.
3. Click **New Duty Slip**. **Pass criterion:** The Duty Slip form (TAXI-802) opens.
4. Create 2 duty slips (one for customer A, one for customer B). **Pass criterion:** Both appear in the table.
5. Filter by customer A. **Pass criterion:** Only customer A's duty slip shows.
6. Filter by date range = today only. **Pass criterion:** Both duty slips show (they were created today).
7. Filter by date range = yesterday only. **Pass criterion:** Zero rows.
8. Filter by status='open'. **Pass criterion:** Both show (new duty slips default to 'open').
9. Click on a duty slip row. **Pass criterion:** The Duty Slip form opens in edit mode, pre-filled with that duty slip's data.

---

### TAXI-802 — Build Duty Slip form (booking + duty sections)
**Type:** Feature · **Module:** M8 · **Depends on:** TAXI-801
**Description:** Implement `src/panels/dailywork/DutySlipForm.tsx`. Two sections: **Booking Info** (customer dropdown, vehicle dropdown, duty_type dropdown, booking_date, booking_ref, guest_name, guest_phone, pickup_location, drop_location) and **Duty Info** (duty_start_dt, duty_end_dt, opening_km, closing_km, extra_km_amount, extra_hour_amount, night_halt_amount, driver_allowance, other_charges, other_charges_remarks, driver_name, driver_phone). Zod validation. On submit: client-side compute `total_km = closing_km - opening_km` and `total_hours = duty_end_dt - duty_start_dt` (in hours), lookup rate, post via `useEntityQuery('duty_slips').create()`.

**Manual Test Plan:**
1. Click **New Duty Slip**. **Pass criterion:** Form opens with two visible sections (Booking Info, Duty Info).
2. Leave customer empty, click Save. **Pass criterion:** Blocked — "Customer is required".
3. Select a customer. **Pass criterion:** The vehicle dropdown filters to active vehicles only.
4. Select a vehicle and duty_type=per_km. Enter booking_date=today, guest_name="John", pickup="Airport", drop="Hotel".
5. In Duty Info, enter duty_start_dt=today 09:00, duty_end_dt=today 11:00, opening_km=10000, closing_km=10050.
6. **Pass criterion:** A live "Computed: 50 km, 2 hours" indicator appears below the duty fields.
7. Click Save. **Pass criterion:** Green toast "Duty slip DS-0001 created". Form closes. New row in the list.
8. Open the new duty slip in edit mode. **Pass criterion:** All fields are pre-filled correctly.
9. Change closing_km to 10060. Save. **Pass criterion:** `total_km` is now 60. `base_amount` recalculates based on the rate.

---

### TAXI-803 — Implement rate lookup on duty slip save
**Type:** Feature · **Module:** M8 · **Depends on:** TAXI-802
**Description:** On Save, the SPA looks up the rate for (customer, vehicle.vehicle_group_id, vehicle.vehicle_type_id, duty_type) where effective_from <= booking_date AND (effective_to IS NULL OR effective_to >= booking_date). If found, populate `rate_id` and compute `base_amount` per the rate type (per_km = per_km_rate * total_km + base_rate; per_hour = per_hour_rate * total_hours + base_rate; per_day = per_day_rate * day_count + base_rate; etc.). Apply min_charge if total < min_charge. If no rate found AND duty_type != flexible, block save with "No rate configured for this customer/vehicle/duty_type combo".

**Manual Test Plan:**
1. Setup: customer A has a rate (Sedan/AC/per_km, base_rate=500, per_km_rate=12, min_charge=300). Vehicle X is a Sedan/AC.
2. Create a duty slip for customer A + vehicle X + per_km. duty_start=09:00, duty_end=11:00, opening_km=10000, closing_km=10020 (20 km).
3. Save. **Pass criterion:** `base_amount` = 500 + (12 * 20) = 740. `total_amount` = 740 (no extras yet).
4. Edit the duty slip, change closing_km to 10005 (5 km). Save.
5. **Pass criterion:** `base_amount` = 500 + (12 * 5) = 560. But min_charge=300, so 560 > 300 — no adjustment. (If min_charge were 600, the base would be 600.)
6. Edit the duty slip, change closing_km to 10000 (0 km — same start and end). Save.
7. **Pass criterion:** `base_amount` = 500 + 0 = 500. Still > min_charge=300, so 500.
8. Edit the rate, set min_charge=700. Save. Edit the duty slip again (don't change anything, just re-save). **Pass criterion:** `base_amount` = 700 (min_charge applies because 500 < 700).
9. Try to create a duty slip for a (customer, vehicle, duty_type) combo with NO rate configured.
10. **Pass criterion:** Save is blocked with "No rate configured for this customer/vehicle/duty_type combo. Please add a rate in Master → Rate Management first."

---

### TAXI-804 — Implement Flexible duty type custom rate popup
**Type:** Feature · **Module:** M8 · **Depends on:** TAXI-803
**Description:** When `duty_type='flexible'` is selected, the SPA suppresses the standard rate lookup. On Save, a modal popup collects: `custom_rate` (numeric, required), `custom_rate_remarks` (free text, required, min 10 chars), and a checkbox "Save this rate to Rate Management for future reuse" (default unchecked). If the checkbox is checked, after saving the duty slip, also INSERT a new row into `master.rates` with the same customer/vehicle/duty_type=flexible, base_rate=custom_rate, effective_from=today.

**Manual Test Plan:**
1. Create a duty slip, select duty_type=`flexible`.
2. **Pass criterion:** The form does NOT show a "No rate configured" warning (flexible skips rate lookup). The rate-related fields (base_amount preview) are hidden.
3. Fill all other fields. Click Save.
4. **Pass criterion:** A modal popup opens with three fields: custom_rate, custom_rate_remarks, "Save this rate for future reuse" checkbox.
5. Leave custom_rate empty, click Confirm. **Pass criterion:** Blocked — "Custom rate is required".
6. Enter custom_rate=1500, remarks="airport drop". Click Confirm. **Pass criterion:** Blocked — "Remarks must be at least 10 characters".
7. Enter remarks="Airport drop flat rate negotiated over phone". Click Confirm.
8. **Pass criterion:** Modal closes. Duty slip saves with `rate_id=NULL`, `custom_rate=1500`, `custom_rate_remarks="Airport drop..."`. `base_amount=1500`.
9. Open Rate Management, look for a new flexible rate for this customer/vehicle combo. **Pass criterion:** No new rate was created (checkbox was unchecked).
10. Repeat steps 1-7, this time check the "Save for reuse" box before clicking Confirm.
11. **Pass criterion:** Duty slip saves. AND a new rate row appears in Rate Management with duty_type=flexible, base_rate=1500, effective_from=today.

---

### TAXI-805 — Implement duty slip status transitions
**Type:** Task · **Module:** M8 · **Depends on:** TAXI-804
**Description:** Status field transitions: `open` (default on create) → `closed` (when duty_end_dt and closing_km are filled) → `billed` (when added to a bill — handled by the GenerateBill RPC in M9) → `cancelled` (manual cancel from the duty slip list). Status changes are logged in audit_log via the generic trigger.

**Manual Test Plan:**
1. Create a duty slip with duty_start_dt and duty_end_dt both filled, opening_km and closing_km both filled.
2. **Pass criterion:** The duty slip saves with `status='closed'` (because duty info is complete).
3. Create a duty slip with only duty_start_dt filled (no end, no closing_km).
4. **Pass criterion:** Saves with `status='open'`.
5. Edit the open duty slip, add duty_end_dt and closing_km. Save.
6. **Pass criterion:** Status flips to `closed`.
7. From the duty slip list, click the "Cancel" action on a closed duty slip.
8. **Pass criterion:** A confirmation dialog asks "Cancel this duty slip? This is irreversible." Confirm.
9. **Pass criterion:** Status flips to `cancelled`. The row appears greyed out in the list.
10. Try to edit a cancelled duty slip. **Pass criterion:** Edit is blocked — "Cancelled duty slips cannot be edited".
11. Open Supabase Studio → `system.audit_log`. Filter by `table_name='duty_slips'`.
12. **Pass criterion:** You see INSERT, UPDATE (for the close), and UPDATE (for the cancel) entries with old/new row snapshots.

---

### TAXI-806 — Validate duty slip fields (Zod schema)
**Type:** Task · **Module:** M8 · **Depends on:** TAXI-805
**Description:** Implement Zod validation: customer_id required, vehicle_id required, duty_type required, booking_date required (not in future beyond today), duty_start_dt required, opening_km >= 0, closing_km >= opening_km (if both present), duty_end_dt > duty_start_dt (if both present), guest_phone valid 10-digit Indian format (optional field but if filled must be valid).

**Manual Test Plan:**
1. Open the Duty Slip form. Set booking_date to tomorrow. Save.
2. **Pass criterion:** Blocked — "Booking date cannot be in the future".
3. Set opening_km=-5. Save. **Pass criterion:** Blocked — "Opening km cannot be negative".
4. Set opening_km=100, closing_km=50. Save. **Pass criterion:** Blocked — "Closing km cannot be less than opening km".
5. Set duty_start_dt=10:00, duty_end_dt=09:00 (same day). Save. **Pass criterion:** Blocked — "Duty end must be after duty start".
6. Set guest_phone="123" (too short). Save. **Pass criterion:** Blocked — "Phone must be 10 digits".
7. Set guest_phone="9876543210" (valid). Save. **Pass criterion:** Saves successfully.

---

### TAXI-807 — Implement duty slip print preview (placeholder for M11)
**Type:** Task · **Module:** M8 · **Depends on:** TAXI-806
**Description:** Add a "Print" button on each duty slip row in the list and on the edit form. Clicking it opens a new browser tab with a placeholder message "PDF rendering coming in M11". The actual PDF rendering is implemented in M11 (TAXI-1101).

**Manual Test Plan:**
1. In the Duty Slip list, click the Print (printer icon) button on a row.
2. **Pass criterion:** A new browser tab opens with the message "PDF rendering coming in M11 — Duty Slip DS-0001".
3. Close the tab. Open a duty slip in edit mode. Click the Print button at the bottom of the form.
4. **Pass criterion:** Same placeholder tab opens.
5. Click Print on a `cancelled` duty slip.
6. **Pass criterion:** A warning toast says "Cancelled duty slips cannot be printed" — print is blocked.

---

### TAXI-808 — Verify audit log entries for duty slip lifecycle
**Type:** Task · **Module:** M8 · **Depends on:** TAXI-807
**Description:** Integration: every INSERT, UPDATE, and status change on a duty slip should produce an audit_log entry. Verify the JSONB snapshots capture the full row.

**Manual Test Plan:**
1. Create a duty slip. Open Supabase Studio → `system.audit_log`, filter `table_name='duty_slips'`.
2. **Pass criterion:** One INSERT entry exists with `new_row` containing the full duty slip data, `old_row=NULL`, `changed_by=<your user UUID>`.
3. Edit the duty slip (change pickup_location). **Pass criterion:** One UPDATE entry exists with `old_row.pickup_location` = old value, `new_row.pickup_location` = new value.
4. Cancel the duty slip. **Pass criterion:** One UPDATE entry exists with `old_row.status='closed'`, `new_row.status='cancelled'`.
5. Try to manually delete an audit_log row via SQL Editor. **Pass criterion:** Blocked by RLS.

---

### TAXI-809 — Verify RLS on duty slips
**Type:** Task · **Module:** M8 · **Depends on:** TAXI-808
**Description:** Confirm: duty slips are tenant-isolated (one company cannot see another's duty slips). Operators and owners can create/edit; accountants and viewers can read but not edit.

**Manual Test Plan:**
1. Log in as `viewer`. Navigate to `/daily-work/duty-slips`.
2. **Pass criterion:** The list is visible. The "New Duty Slip" button is hidden. Edit/Cancel actions are hidden.
3. Log in as `accountant`. **Pass criterion:** Same as viewer — read-only.
4. Log in as `operator`. **Pass criterion:** List visible, New button visible, edit/cancel actions visible.
5. Create a second company + user. Log in as that user.
6. **Pass criterion:** The duty slip list is empty (you only see your own company's duty slips).
7. As user B, try to fetch user A's duty slip via SQL (using the service role key from the client — this should be blocked by RLS since the JWT carries company_id=B).
8. **Pass criterion:** Query returns 0 rows.

---

### TAXI-810 — Duty Slip form performance check (100+ rows)
**Type:** Task · **Module:** M8 · **Depends on:** TAXI-809
**Description:** Performance smoke test: with 100+ duty slips in the database, the list page should load in < 1 second, and the customer/vehicle dropdowns should remain responsive.

**Manual Test Plan:**
1. Open Supabase Studio → SQL Editor. Write a script to insert 100 dummy duty slips for various customers/vehicles (you can use `generate_series`).
2. Run the script. **Pass criterion:** 100 rows inserted successfully.
3. Open the Duty Slip list page in the app.
4. **Pass criterion:** The page loads in under 1 second (check DevTools → Network → first paint time). The table is paginated (e.g. 20 rows per page) with a "Next" button.
5. Click "Next". **Pass criterion:** Next page loads quickly.
6. Filter by customer. **Pass criterion:** Filter applies in < 500ms.
7. Type in the search box. **Pass criterion:** Search results update without lag.
8. Open DevTools → Performance tab. Record a click on a row to open the edit form. **Pass criterion:** No long-running JS task (> 100ms).

---
# MODULE M9 — Daily Work: Billing (Generate Bill RPC)

Goal: The Billing page lets the operator select a customer, see all unbilled duty slips (status=open or closed, bill_id IS NULL), tick the ones to include, optionally adjust remarks, and click Generate Bill. This calls the `generate_bill` RPC which in a single transaction: (a) inserts a bill row with trigger-assigned bill_no, (b) inserts bill_duty_slips junction rows, (c) updates duty_slips.bill_id + status='billed', (d) fires the GST trigger, (e) inserts a sale ledger entry. Returns the bill row.

---

### TAXI-901 — Implement generate_bill PL/pgSQL RPC function
**Type:** Feature · **Module:** M9 · **Depends on:** TAXI-810
**Description:** Implement `billing.generate_bill(p_customer_id bigint, p_duty_slip_ids bigint[], p_remarks text, p_bill_date date)` per Section 6.3. Logic in a single transaction:
1. INSERT into `billing.bills` (customer_id, bill_date, remarks, status='issued', created_by=auth.uid()). The `fn_calculate_gst` trigger (TAXI-108) populates GST amounts. The bill_no is assigned via a trigger (similar to fn_assign_duty_slip_no but for sequence_key='bill').
2. INSERT into `billing.bill_duty_slips` for each p_duty_slip_id, with `included_base`, `included_extra`, `included_total` snapshotted from each duty slip.
3. UPDATE `operations.duty_slips` SET bill_id = new_bill_id, status='billed' WHERE id IN (p_duty_slip_ids).
4. Compute base_amount = SUM(duty_slips.base_amount), extra_amount = SUM(duty_slips.extra_*). UPDATE bill with these totals.
5. INSERT into `accounts.ledger_entries` (entry_type='sale', customer_id, linked_bill_id, debit_amount=grand_total, narration='Bill {bill_no} raised against {customer name}').
6. RETURN the complete bill row.
Raise exceptions if: customer not found, any duty slip doesn't belong to the customer, any duty slip is already billed, no active gst_config for the customer.

**Manual Test Plan:**
1. Setup: create 3 duty slips for customer A (all status=closed, bill_id=NULL). Ensure customer A has an active gst_config.
2. Open Supabase Studio → SQL Editor. Run: `SELECT billing.generate_bill(<customer_A_id>, ARRAY[<ds1_id>, <ds2_id>, <ds3_id>], 'Test bill', CURRENT_DATE);`
3. **Pass criterion:** The function returns a bill row with a bill_no like 'BILL-0001', base_amount=sum of the 3 duty slips' base_amounts, GST amounts populated, grand_total a whole rupee.
4. Query `operations.duty_slips WHERE id IN (ds1,ds2,ds3)`.
5. **Pass criterion:** All 3 duty slips now have `bill_id=<new bill id>`, `status='billed'`.
6. Query `billing.bill_duty_slips WHERE bill_id = <new bill id>`.
7. **Pass criterion:** 3 junction rows exist with snapshotted amounts.
8. Query `accounts.ledger_entries WHERE linked_bill_id = <new bill id>`.
9. **Pass criterion:** One `sale` entry exists with `debit_amount = bill.grand_total`, narration contains the bill_no and customer name.
10. Try to call generate_bill again with the same duty slip IDs.
11. **Pass criterion:** Function raises an exception "Duty slip DS-0001 is already billed".
12. Try to call generate_bill with a duty slip belonging to a different customer.
13. **Pass criterion:** Function raises "Duty slip DS-0005 does not belong to customer A".

---

### TAXI-902 — Implement bill_no assignment trigger (sequence_key='bill')
**Type:** Feature · **Module:** M9 · **Depends on:** TAXI-901
**Description:** Similar to fn_assign_duty_slip_no but for bills. BEFORE INSERT on `billing.bills`: if `bill_no IS NULL`, fetch from `master.document_sequences` where sequence_key='bill', format with prefix + lpad(next_value, padding_length) + suffix, increment next_value.

**Manual Test Plan:**
1. Ensure `master.document_sequences` has a row for sequence_key='bill' with prefix='BILL-', next_value=1, padding_length=4, mode='auto'.
2. Call `generate_bill` to create a bill.
3. **Pass criterion:** The returned bill has `bill_no='BILL-0001'`.
4. Check document_sequences — next_value for 'bill' is now 2.
5. Create a second bill. **Pass criterion:** `bill_no='BILL-0002'`.
6. Switch the sequence to mode='manual'. Create a bill with bill_no='MANUAL-BILL-001' explicitly.
7. **Pass criterion:** Saves with that bill_no. next_value does not increment.

---

### TAXI-903 — Build Billing page UI (customer picker + duty slip list)
**Type:** Feature · **Module:** M9 · **Depends on:** TAXI-902
**Description:** Implement `src/panels/dailywork/BillingPage.tsx` at route `/daily-work/billing`. Top: customer dropdown. Below: a list of unbilled duty slips for that customer (status IN ('open','closed') AND bill_id IS NULL). Each row has a checkbox, duty_slip_no, booking_date, vehicle, total_km, total_hours, total_amount. A "Select All" checkbox at the top. Below the list: remarks text field, total base amount preview, total extra preview, grand total preview. "Generate Bill" button at the bottom.

**Manual Test Plan:**
1. Navigate to `/daily-work/billing`.
2. **Pass criterion:** A customer dropdown is shown. The duty slip list is empty with "Select a customer to view unbilled duty slips".
3. Select customer A (who has 3 unbilled duty slips from TAXI-901 setup, plus some new ones).
4. **Pass criterion:** The list shows all unbilled duty slips for customer A, each with a checkbox.
5. Tick 2 of the duty slips.
6. **Pass criterion:** The totals preview at the bottom updates: base = sum of selected, extra = sum of selected, grand total = base + extra + GST (estimate).
7. Click "Select All". **Pass criterion:** All duty slips are ticked. Totals update.
8. Click "Select All" again. **Pass criterion:** All unticked. Totals go to 0.
9. Tick one duty slip. Click **Generate Bill**.
10. **Pass criterion:** A confirmation dialog shows the bill summary (customer, count, total). Confirm.
11. **Pass criterion:** Green toast "Bill BILL-0001 created". The list refreshes — the billed duty slips disappear (they're now status='billed').

---

### TAXI-904 — Implement Generate Bill RPC call from the SPA
**Type:** Feature · **Module:** M9 · **Depends on:** TAXI-903
**Description:** On Generate Bill click: show confirmation dialog with the summary. On confirm, call `supabaseClient.rpc('generate_bill', { p_customer_id, p_duty_slip_ids: [...], p_remarks, p_bill_date })`. On success: invalidate the duty_slips and bills query cache, show success toast with the bill_no, offer a "Print Bill" link (opens M11 print preview).

**Manual Test Plan:**
1. Setup: customer A has 3 unbilled duty slips. Active gst_config with igst_rate=5 (interstate).
2. Navigate to Billing, select customer A, tick all 3 duty slips (sum of base_amounts = 1500, sum of extras = 300).
3. Click **Generate Bill**.
4. **Pass criterion:** Confirmation dialog shows: "Customer: A, Duty slips: 3, Base: 1500, Extra: 300, GST (5%): 90, Grand Total: 1890".
5. Click Confirm.
6. **Pass criterion:** Loading spinner on the button. After ~1 second, green toast "Bill BILL-0001 created for Rs. 1890".
7. **Pass criterion:** The toast has a "Print Bill" link. Clicking it opens the M11 print preview (placeholder for now).
8. **Pass criterion:** The duty slip list refreshes — the 3 duty slips are gone (now billed).
9. Open the new bill via Supabase Studio → `billing.bills WHERE bill_no='BILL-0001'`.
10. **Pass criterion:** `base_amount=1500, extra_amount=300, total_before_tax=1800, igst_amount=90, total_after_tax=1890, grand_total=1890, status='issued'`.

---

### TAXI-905 — Verify sale ledger entry auto-posted
**Type:** Task · **Module:** M9 · **Depends on:** TAXI-904
**Description:** Integration: after a bill is generated, a `sale` entry should be in `accounts.ledger_entries` with debit_amount=grand_total, linked_bill_id=new bill id, narration="Bill {bill_no} raised against {customer name}".

**Manual Test Plan:**
1. Generate a bill (any amount).
2. Open Supabase Studio → `accounts.ledger_entries WHERE linked_bill_id = <new bill id>`.
3. **Pass criterion:** One row exists with: `entry_type='sale'`, `debit_amount=<grand_total>`, `credit_amount=0`, `narration='Bill BILL-0001 raised against <customer name>'`, `customer_id=<customer id>`, `linked_bill_id=<bill id>`, `linked_duty_slip_id=NULL`, `created_by=<your user UUID>`.
4. Generate a second bill. **Pass criterion:** A second sale entry appears.
5. Open the Ledger Book page (after M12) and filter by the customer.
6. **Pass criterion:** Two sale entries appear, increasing the customer's outstanding balance.

---

### TAXI-906 — Verify Generate Bill is transactional (rollback on error)
**Type:** Task · **Module:** M9 · **Depends on:** TAXI-905
**Description:** Integration: if any step inside generate_bill fails (e.g. gst_config missing, or one of the duty slips becomes billed mid-transaction), the entire transaction rolls back — no partial bill, no duty slip status change.

**Manual Test Plan:**
1. Setup: customer A has 2 unbilled duty slips. Customer A's gst_config has effective_to=today (no active config).
2. Try to generate a bill for customer A.
3. **Pass criterion:** The function raises "No active GST config for customer A". No bill row is created.
4. Query `operations.duty_slips` for those 2 duty slips.
5. **Pass criterion:** Both still have `bill_id=NULL`, `status='closed'` (unchanged).
6. Query `accounts.ledger_entries WHERE linked_bill_id IS NOT NULL AND customer_id = <A>`.
7. **Pass criterion:** No new sale entry was created.
8. Now: in a separate SQL session, manually bill one of the duty slips (set bill_id=999, status='billed'). Try to generate a bill including BOTH duty slips via the SPA.
9. **Pass criterion:** The function raises "Duty slip DS-000X is already billed". No bill row created. The other duty slip is still unbilled.

---

### TAXI-907 — Verify bill totals recompute when duty slips added/removed (preparation for M10)
**Type:** Task · **Module:** M9 · **Depends on:** TAXI-906
**Description:** Preparation for M10 (Change/Cancel Bill). Implement triggers on `billing.bill_duty_slips` (INSERT/DELETE) that recompute the parent bill's `base_amount`, `extra_amount`, and GST. For now, just verify the trigger exists and works for the initial insert done by generate_bill.

**Manual Test Plan:**
1. Generate a bill with 3 duty slips (base sum=1500, extra sum=300).
2. **Pass criterion:** `billing.bills.base_amount=1500, extra_amount=300, total_before_tax=1800`.
3. Manually insert a 4th duty slip for the same customer (status=closed, bill_id=NULL).
4. Open Supabase Studio → SQL Editor. Manually insert into `billing.bill_duty_slips` linking the new duty slip to the bill (with snapshotted amounts).
5. **Pass criterion:** After the insert trigger fires, the bill's `base_amount` and `extra_amount` update to include the 4th duty slip's amounts. GST is recomputed.
6. Manually DELETE that junction row.
7. **Pass criterion:** The bill's totals revert to the 3-duty-slip values.
8. This is a preparation test — M10 will provide UI for adding/removing duty slips.

---

### TAXI-908 — Role gating on Billing page
**Type:** Task · **Module:** M9 · **Depends on:** TAXI-907
**Description:** Confirm: viewer + accountant can read but not generate bills; operator + owner can generate bills.

**Manual Test Plan:**
1. Log in as `viewer`. Navigate to `/daily-work/billing`.
2. **Pass criterion:** Customer dropdown visible, duty slip list visible, but checkboxes are disabled and the Generate Bill button is hidden.
3. Log in as `accountant`. **Pass criterion:** Same as viewer — read-only.
4. Log in as `operator`. **Pass criterion:** Checkboxes enabled, Generate Bill button visible.
5. Log in as `owner`. **Pass criterion:** Same as operator.

---
# MODULE M10 — Daily Work: Change / Cancel Bill

Goal: A bill is mutable until printed. After printing, the operator should issue an amended bill (cancel + reissue) rather than editing. The Change/Cancel page supports: (1) Edit metadata (bill_date, remarks) without touching duty slips; (2) Add/Remove duty slip — opens a popup of unbilled duty slips for the same customer; (3) Cancel bill — sets status='cancelled', frees linked duty slips, posts a reversal ledger entry. Cancellation is irreversible.

---

### TAXI-1001 — Build Change/Cancel Bill list page
**Type:** Feature · **Module:** M10 · **Depends on:** TAXI-908
**Description:** Implement `src/panels/dailywork/ChangeCancelBillPage.tsx` at route `/daily-work/change-cancel-bill`. Lists all bills (status != 'cancelled' shown by default; filter to show cancelled too). Columns: bill_no, bill_date, customer, grand_total, status, actions (Edit, Add/Remove Slips, Cancel, Print). Filter by customer, date range, status.

**Manual Test Plan:**
1. Navigate to `/daily-work/change-cancel-bill`.
2. **Pass criterion:** A list of bills is shown (use the bills created in M9). Default filter hides cancelled bills.
3. Filter by customer A. **Pass criterion:** Only customer A's bills appear.
4. Filter by status='cancelled'. **Pass criterion:** Zero rows (no bills cancelled yet).
5. Toggle "Show cancelled bills" checkbox. **Pass criterion:** Same list (still no cancelled bills).
6. Click the Edit (pencil) action on a bill row.
7. **Pass criterion:** The Edit Bill form (TAXI-1002) opens.

---

### TAXI-1002 — Implement Edit Bill metadata (bill_date + remarks only)
**Type:** Feature · **Module:** M10 · **Depends on:** TAXI-1001
**Description:** Edit form allows changing only `bill_date` and `remarks`. Duty slips cannot be added/removed here (that's TAXI-1003). Totals do NOT recompute on metadata edit. Save calls `supabaseClient.from('bills').update({ bill_date, remarks })`.

**Manual Test Plan:**
1. Open the Edit form for bill BILL-0001.
2. **Pass criterion:** Form shows bill_no (read-only), customer (read-only), bill_date (editable date picker), remarks (editable text), grand_total (read-only).
3. Change bill_date to yesterday. Save.
4. **Pass criterion:** Green toast "Bill updated". Refresh the list — bill_date shows yesterday.
5. Change remarks to "Test remark". Save. **Pass criterion:** Persists.
6. Try to change bill_date to a year from now. **Pass criterion:** Blocked — "Bill date cannot be more than 30 days in the future".
7. Open Supabase Studio → `system.audit_log WHERE table_name='bills' AND record_id=<bill_id>`.
8. **Pass criterion:** UPDATE entries exist capturing the old and new bill_date / remarks.

---

### TAXI-1003 — Implement Add/Remove Duty Slip from a bill
**Type:** Feature · **Module:** M10 · **Depends on:** TAXI-1002
**Description:** On the Change/Cancel page, the "Add/Remove Slips" action opens a modal with two sections: (a) Currently linked duty slips (with a remove button each), (b) Unbilled duty slips for the same customer (with an add button each). Adding a duty slip INSERTs into `billing.bill_duty_slips` and the trigger (TAXI-907) recomputes the bill totals + GST. Removing a duty slip DELETEs the junction row and the trigger recomputes. Removing also sets the duty slip's `bill_id=NULL` and `status='closed'` (if it was 'billed'). Adding sets `bill_id=<bill>` and `status='billed'`.

**Manual Test Plan:**
1. Setup: bill BILL-0001 has 3 duty slips (base sum=1500). Customer A has 1 more unbilled duty slip (base=200).
2. Open the Add/Remove modal for BILL-0001.
3. **Pass criterion:** "Currently Linked" section shows 3 duty slips. "Unbilled Duty Slips" section shows 1 duty slip.
4. Click "Add" next to the unbilled duty slip.
5. **Pass criterion:** Modal shows a brief loading spinner. The duty slip moves from "Unbilled" to "Currently Linked".
6. Close the modal. Refresh the list.
7. **Pass criterion:** BILL-0001's grand_total has increased by 200 (plus GST).
8. Re-open the modal. Click "Remove" next to the duty slip you just added.
9. **Pass criterion:** The duty slip moves back to "Unbilled". The bill's grand_total reverts.
10. Query `operations.duty_slips WHERE id = <removed ds id>`.
11. **Pass criterion:** `bill_id=NULL`, `status='closed'` (no longer billed).
12. Try to add a duty slip that belongs to a DIFFERENT customer. **Pass criterion:** The unbilled list only shows duty slips for the same customer as the bill — so this is impossible from the UI.

---

### TAXI-1004 — Implement Cancel Bill action
**Type:** Feature · **Module:** M10 · **Depends on:** TAXI-1003
**Description:** The "Cancel" action opens a confirmation dialog: "Cancelling bill {bill_no} is irreversible. Linked duty slips will be freed. A reversal ledger entry will be posted. Continue?" On confirm: (a) UPDATE billing.bills SET status='cancelled', cancelled_at=now(), cancelled_by=auth.uid(), cancel_reason=<entered reason>; (b) UPDATE operations.duty_slips SET bill_id=NULL, status='closed' WHERE bill_id=this bill; (c) DELETE FROM billing.bill_duty_slips WHERE bill_id=this bill (junction cleanup); (d) INSERT into accounts.ledger_entries (entry_type='sale', credit_amount=grand_total, narration='Reversal - Bill {bill_no} cancelled', linked_bill_id=this bill).

**Manual Test Plan:**
1. Setup: bill BILL-0001 has 3 duty slips, grand_total=1890.
2. On the Change/Cancel page, click the Cancel action on BILL-0001.
3. **Pass criterion:** A confirmation dialog opens with the message above and a "Cancel Reason" text field (required, min 10 chars).
4. Enter reason "Customer disputed charges". Click Confirm.
5. **Pass criterion:** Green toast "Bill BILL-0001 cancelled". The row's status changes to 'cancelled' and appears greyed out.
6. Query `operations.duty_slips WHERE bill_id = <BILL-0001 id>`.
7. **Pass criterion:** Zero rows — all duty slips have bill_id=NULL.
8. Query `operations.duty_slips` for the previously-linked duty slips.
9. **Pass criterion:** All have `status='closed'` (freed for re-billing).
10. Query `accounts.ledger_entries WHERE linked_bill_id = <BILL-0001 id>`.
11. **Pass criterion:** Two rows: (1) the original `sale` with debit_amount=1890 (from when the bill was issued), (2) a new `sale` entry with `credit_amount=1890`, narration="Reversal - Bill BILL-0001 cancelled".
12. Try to cancel an already-cancelled bill. **Pass criterion:** Blocked — "Bill is already cancelled".
13. Try to edit a cancelled bill (Edit or Add/Remove Slips). **Pass criterion:** Both actions are disabled / hidden.

---

### TAXI-1005 — Verify bill cancellation is irreversible
**Type:** Task · **Module:** M10 · **Depends on:** TAXI-1004
**Description:** Confirm: a cancelled bill cannot be un-cancelled. The operator must generate a NEW bill (with a new bill_no) if they want to re-bill the same duty slips. Verify the audit_log captures the full before-state of the cancellation.

**Manual Test Plan:**
1. Cancel a bill (from TAXI-1004).
2. Try to "Un-cancel" — there is no UI action for this. **Pass criterion:** No un-cancel button exists.
3. Try via SQL: `UPDATE billing.bills SET status='issued' WHERE bill_no='BILL-0001';` as the operator role (RLS-enforced).
4. **Pass criterion:** Update is blocked — there should be an RLS policy or trigger preventing status change from 'cancelled' to anything else.
5. Open Supabase Studio → `system.audit_log WHERE table_name='bills' AND record_id=<BILL-0001 id> ORDER BY changed_at`.
6. **Pass criterion:** You see the INSERT (creation), UPDATE (any metadata edits), and UPDATE (cancellation) entries. The cancellation entry's `old_row` shows `status='issued'`, `new_row` shows `status='cancelled', cancelled_at=<timestamp>`.
7. To re-bill: open the Billing page, select the same customer, tick the freed duty slips, generate a new bill.
8. **Pass criterion:** A new bill BILL-0002 is created (next sequence number). The old BILL-0001 remains cancelled.

---

# MODULE M11 — Daily Work: Print Bill / Duty Slip (PDF)

Goal: A print preview screen renders the bill or duty slip as a PDF in the browser using `@react-pdf/renderer`. The operator picks a document type, enters the number, and sees an A4 preview with a Print button. The same preview is reachable from the Billing page and Duty Slip page. Templates are React components: `BillPDF.tsx`, `DutySlipPDF.tsx`, `BillCoverReportPDF.tsx`, `DutyRegisterReportPDF.tsx`.

---

### TAXI-1101 — Implement BillPDF template component
**Type:** Feature · **Module:** M11 · **Depends on:** TAXI-1005
**Description:** Implement `src/templates/pdf/BillPDF.tsx` using `@react-pdf/renderer`. Layout: company header (logo, name, address, GSTIN) at top, bill_no + bill_date, customer block (name, company, address, GSTIN), line-item table (duty_slip_no, booking_date, vehicle, total_km, total_hours, base_amount, extra_amounts, total), GST breakdown (CGST/SGST or IGST), grand total in words + numbers, footer (signature line). Takes a typed `data` prop with bill + duty_slips + customer + company info.

**Manual Test Plan:**
1. Setup: at least one bill exists with 2+ duty slips.
2. Navigate to `/daily-work/print` (Print page). Select document type "Bill". Enter the bill_no. Click Preview.
3. **Pass criterion:** An A4 preview renders in the browser. Company header (logo + name + address + GSTIN) is at the top.
4. **Pass criterion:** Bill_no and bill_date are shown clearly.
5. **Pass criterion:** Customer block shows name, company_name, address, GSTIN.
6. **Pass criterion:** The line-item table lists all duty slips with their duty_slip_no, booking_date, vehicle registration, total_km, total_hours, base_amount, extra columns, and a total per row.
7. **Pass criterion:** GST breakdown shows CGST/SGST (for intra-state) OR IGST (for inter-state) with rates and amounts.
8. **Pass criterion:** Grand total is shown in numbers AND in words (e.g. "Rupees one thousand eight hundred ninety only").
9. **Pass criterion:** A signature line is at the bottom right.
10. Click the native browser Print button (Ctrl+P or the page's Print button).
11. **Pass criterion:** The browser print dialog opens with the PDF as the content. Save as PDF — the saved file matches the on-screen preview.

---

### TAXI-1102 — Implement DutySlipPDF template component
**Type:** Feature · **Module:** M11 · **Depends on:** TAXI-1101
**Description:** Implement `src/templates/pdf/DutySlipPDF.tsx`. Layout: company header, duty_slip_no + booking_date, customer + guest info, vehicle info (registration, group, type), duty details (start/end dt, opening/closing km, total_km, total_hours), rate breakdown (base, extra_km, extra_hour, night_halt, driver_allowance, other, total), driver details (name, phone), signature lines for operator and driver.

**Manual Test Plan:**
1. Setup: at least one duty slip exists with all fields filled.
2. Navigate to `/daily-work/print`. Select document type "Duty Slip". Enter the duty_slip_no. Click Preview.
3. **Pass criterion:** An A4 preview renders with the company header at top.
4. **Pass criterion:** Duty_slip_no and booking_date are shown.
5. **Pass criterion:** Customer block (name, phone) and guest block (name, phone) are shown.
6. **Pass criterion:** Vehicle info shows registration_no, group, type.
7. **Pass criterion:** Duty details show duty_start_dt, duty_end_dt, opening_km, closing_km, total_km (computed), total_hours (computed).
8. **Pass criterion:** Rate breakdown shows base_amount, extra_km_amount, extra_hour_amount, night_halt_amount, driver_allowance, other_charges + remarks, total_amount.
9. **Pass criterion:** Driver name + phone are shown.
10. **Pass criterion:** Two signature lines at the bottom: "Operator Signature" and "Driver Signature".
11. Click Print. Save as PDF. **Pass criterion:** Saved file matches the preview.
12. Try to preview a `cancelled` duty slip. **Pass criterion:** Blocked with "Cancelled duty slips cannot be printed".

---

### TAXI-1103 — Implement PdfTemplateFactory + Print page UI
**Type:** Feature · **Module:** M11 · **Depends on:** TAXI-1102
**Description:** Implement `src/services/PdfTemplateFactory.ts` as a registry: `render(templateName, data)`, `getBlobURL(templateName, data)`, `supportedTemplates`. Templates: 'bill', 'duty_slip', 'bill_cover_report', 'duty_register_report' (last two stubbed for M13). Implement `src/panels/dailywork/PrintPage.tsx` at route `/daily-work/print`: document type dropdown, number input, Preview button, the preview area, Print button. The same factory is used by the Billing page (Print Bill link) and Duty Slip page (Print button) — both call `PdfTemplateFactory.getBlobURL('bill', data)` and open it in a new tab.

**Manual Test Plan:**
1. Navigate to `/daily-work/print`. **Pass criterion:** Document type dropdown (Bill, Duty Slip), number input (text), Preview button (disabled until both fields are filled).
2. Select "Bill", type "BILL-0001", click Preview.
3. **Pass criterion:** The BillPDF renders in the preview area.
4. Click the "Open in new tab" button. **Pass criterion:** A new browser tab opens with the PDF.
5. In the new tab, press Ctrl+P. **Pass criterion:** Native print dialog opens with the PDF.
6. Go back to the main tab. Select "Duty Slip", type "DS-0001", click Preview.
7. **Pass criterion:** The DutySlipPDF renders.
8. Enter a non-existent number "BILL-9999". Click Preview.
9. **Pass criterion:** Red error "Bill not found".
10. Enter an empty number. Click Preview. **Pass criterion:** Preview button is disabled.
11. From the Billing page, after generating a bill, click the "Print Bill" link in the success toast.
12. **Pass criterion:** A new tab opens with the BillPDF for that bill.
13. From the Duty Slip list, click the Print icon on a row.
14. **Pass criterion:** A new tab opens with the DutySlipPDF for that duty slip.

---

### TAXI-1104 — Verify company logo + GSTIN render correctly on PDFs
**Type:** Task · **Module:** M11 · **Depends on:** TAXI-1103
**Description:** Integration: the PDF templates pull `core.companies` (logo_path, name, address, GSTIN) at render time. If the operator updates the company logo or address in M3, the next PDF printed should reflect the change.

**Manual Test Plan:**
1. Print a bill PDF. Note the company name, address, GSTIN, and logo shown.
2. Navigate to `/master/company`. Change the company's address_line1 and phone. Upload a new logo. Save.
3. Go back to `/daily-work/print`. Print the same bill again.
4. **Pass criterion:** The new PDF shows the updated address, phone, and the new logo.
5. Navigate back to `/master/company`. Change the company's `state` from Delhi to Maharashtra. Save.
6. Print a duty slip PDF.
7. **Pass criterion:** The PDF header shows "Maharashtra" as the company state. (Note: this may affect GST logic on future bills — discuss with the architect.)
8. Remove the company logo (set logo_path=NULL via SQL, or add a "Remove Logo" button if not present).
9. Print a bill PDF. **Pass criterion:** The PDF header shows the company name without a logo image (placeholder or blank space).

---
# MODULE M12 — Accounts: Ledger Book + Manual Receipt/Payment

Goal: The Accounts panel is intentionally minimal — one page (Ledger Book) and one form (Record Receipt/Payment). All financial events already write to `accounts.ledger_entries` via triggers (M9 sale entries, M10 reversal entries). The Accounts panel is mostly a viewer with the ability to add manual receipt/payment entries.

---

### TAXI-1201 — Build Ledger Book page UI
**Type:** Feature · **Module:** M12 · **Depends on:** TAXI-1104
**Description:** Implement `src/panels/accounts/LedgerBookPage.tsx` at route `/accounts/ledger`. Top filter bar: customer dropdown (or "All Customers"), date range (from/to), entry_type filter. Table columns: entry_date, entry_type, narration, debit, credit, running_balance, linked_bill_no (clickable), linked_duty_slip_no (clickable). Default sort: entry_date ascending. Running balance is computed client-side as a cumulative sum (debit - credit). "Record Receipt" and "Record Payment" buttons at the top right.

**Manual Test Plan:**
1. Navigate to `/accounts/ledger`.
2. **Pass criterion:** Filter bar (customer dropdown, date range, entry_type dropdown) and an empty table are shown. "Record Receipt" and "Record Payment" buttons are visible (if your role allows — see TAXI-1207).
3. Select a customer who has bills (from M9). **Pass criterion:** The table shows sale entries (debit column) for each bill issued. Running balance increases with each sale.
4. **Pass criterion:** The `linked_bill_no` column shows the bill_no as a clickable link.
5. Click the bill_no link. **Pass criterion:** You are navigated to `/daily-work/change-cancel-bill` with that bill pre-selected for editing.
6. Filter by date range = today only. **Pass criterion:** Only today's entries show.
7. Filter by entry_type='sale'. **Pass criterion:** Only sale entries show.
8. Switch to "All Customers" view. **Pass criterion:** Entries across all customers are shown, sorted by entry_date. Running balance is per-customer (resets when customer changes).

---

### TAXI-1202 — Implement Record Receipt form
**Type:** Feature · **Module:** M12 · **Depends on:** TAXI-1201
**Description:** Click "Record Receipt" → opens a modal form. Fields: customer (dropdown, required), amount (numeric, required, > 0), payment_mode (dropdown: cash/cheque/upi/bank, required), reference_no (text, optional), entry_date (date picker, default today), narration (text, required, min 10 chars). On save: INSERT into `accounts.ledger_entries` with `entry_type='receipt'`, `credit_amount=amount`, `debit_amount=0`, `customer_id`, `linked_bill_id=NULL`, `linked_duty_slip_id=NULL`, `payment_mode`, `reference_no`, `narration`, `created_by=auth.uid()`.

**Manual Test Plan:**
1. Click **Record Receipt**.
2. **Pass criterion:** Modal opens with the fields above.
3. Leave customer empty, click Save. **Pass criterion:** Blocked — "Customer is required".
4. Select a customer. Leave amount empty. **Pass criterion:** Blocked — "Amount is required".
5. Enter amount=0. **Pass criterion:** Blocked — "Amount must be greater than 0".
6. Enter amount=500, payment_mode='upi', reference_no='UPI-67890', narration="Monthly settlement". Save.
7. **Pass criterion:** Modal closes. Green toast "Receipt of Rs. 500 recorded".
8. The Ledger Book table refreshes. **Pass criterion:** A new row appears with `entry_type='receipt'`, `credit=500`, `debit=0`, running balance decreased by 500 (customer paid down their balance).
9. Query `accounts.ledger_entries WHERE entry_type='receipt' AND customer_id=<id> ORDER BY id DESC LIMIT 1`.
10. **Pass criterion:** Row exists with `credit_amount=500, payment_mode='upi', reference_no='UPI-67890', narration='Monthly settlement'`.
11. Try to save a receipt with narration="abc" (less than 10 chars). **Pass criterion:** Blocked — "Narration must be at least 10 characters".

---

### TAXI-1203 — Implement Record Payment form
**Type:** Feature · **Module:** M12 · **Depends on:** TAXI-1202
**Description:** Click "Record Payment" → opens a modal form. Same fields as Record Receipt but: `entry_type='payment'`, `debit_amount=amount`, `credit_amount=0`. Used for vendor/driver payments. Narration examples: "Driver bata for DS-0001", "Fuel reimbursement", "Vehicle maintenance".

**Manual Test Plan:**
1. Click **Record Payment**.
2. **Pass criterion:** Modal opens with the same fields as Record Receipt.
3. Fill: customer (optional for payments — some payments are to vendors not customers, but for now keep customer required per the schema), amount=300, payment_mode='cash', narration="Driver bata for DS-0001". Save.
4. **Pass criterion:** Modal closes. Green toast "Payment of Rs. 300 recorded".
5. The Ledger Book refreshes. **Pass criterion:** New row with `entry_type='payment'`, `debit=300`, `credit=0`, running balance increased by 300 (debit increases the customer's receivable OR represents an expense — clarify with architect).
6. Query `accounts.ledger_entries WHERE entry_type='payment' ORDER BY id DESC LIMIT 1`.
7. **Pass criterion:** Row exists with `debit_amount=300, payment_mode='cash', narration='Driver bata for DS-0001'`.

---

### TAXI-1204 — Implement manual adjustment entry
**Type:** Feature · **Module:** M12 · **Depends on:** TAXI-1203
**Description:** Add a third button "Manual Adjustment" (visible only to `accountant` and `owner` roles). Opens a form similar to Record Receipt/Payment but with: entry_type='adjustment', customer, debit_amount OR credit_amount (radio: "Increase customer balance" or "Decrease customer balance"), narration (required, min 20 chars — stricter because adjustments are exceptional).

**Manual Test Plan:**
1. Log in as `accountant`. Navigate to `/accounts/ledger`.
2. **Pass criterion:** Three buttons visible: Record Receipt, Record Payment, Manual Adjustment.
3. Click **Manual Adjustment**.
4. **Pass criterion:** Form opens with a radio: "Increase customer balance (debit)" / "Decrease customer balance (credit)".
5. Select "Increase", customer=A, amount=100, narration="Correction for misclassified entry". Save.
6. **Pass criterion:** Blocked — "Narration must be at least 20 characters for adjustments".
7. Enter narration="Correction for misclassified entry in bill BILL-0001". Save.
8. **Pass criterion:** Saves. New row in ledger with `entry_type='adjustment'`, `debit=100`, `credit=0`.
9. Log in as `operator`. Navigate to `/accounts/ledger`.
10. **Pass criterion:** Only "Record Receipt" and "Record Payment" buttons visible. "Manual Adjustment" is hidden (operator role not allowed).

---

### TAXI-1205 — Verify auto-posting rules (sale on bill issue, reversal on cancel)
**Type:** Task · **Module:** M12 · **Depends on:** TAXI-1204
**Description:** Integration: confirm the auto-posting rules from Section 7.2 are working end-to-end. (1) Bill issued → sale row with debit=grand_total. (2) Bill cancelled → sale row with credit=grand_total (reversal). (3) Duty slip closed without bill → no ledger entry. (4) Receipt recorded manually → entry_type=receipt, credit=amount.

**Manual Test Plan:**
1. Open the Ledger Book for a customer with no bills yet.
2. **Pass criterion:** Zero entries (or only opening_balance if any).
3. Generate a bill for Rs. 1890 (3 duty slips). Refresh the Ledger Book.
4. **Pass criterion:** One new `sale` entry with `debit=1890`, narration="Bill BILL-XXXX raised against <customer>". Running balance = 1890.
5. Cancel the bill. Refresh.
6. **Pass criterion:** One new `sale` entry with `credit=1890`, narration="Reversal - Bill BILL-XXXX cancelled". Running balance = 0.
7. Create a duty slip and close it (don't bill it). Refresh.
8. **Pass criterion:** No new ledger entry (duty slip closure alone doesn't post to ledger).
9. Record a manual receipt of Rs. 500. Refresh.
10. **Pass criterion:** New `receipt` entry with `credit=500`. Running balance = -500 (customer has credit balance).

---

### TAXI-1206 — Verify running balance computation
**Type:** Task · **Module:** M12 · **Depends on:** TAXI-1205
**Description:** Confirm the client-side running balance is correct across multiple entries, filters, and pagination. The balance is `cumulative sum of (debit - credit)` ordered by entry_date, then by id.

**Manual Test Plan:**
1. Setup: customer A has 5 entries: sale (debit 1000), sale (debit 500), receipt (credit 800), sale (debit 300), receipt (credit 200).
2. Open the Ledger Book, filter by customer A.
3. **Pass criterion:** Running balance column shows: 1000, 1500, 700, 1000, 800 (in that order).
4. Filter by date range that excludes the first 2 entries. **Pass criterion:** Running balance starts from 0 (filter resets the cumulative sum) — or starts from the opening balance within the filtered range. Discuss with architect which behavior is correct.
5. Filter by entry_type='sale'. **Pass criterion:** Only sale entries show. Running balance is the sum of debits = 1800.
6. Switch to "All Customers" view. **Pass criterion:** Running balance resets when customer changes (each customer's balance is independent).

---

### TAXI-1207 — Role gating on Accounts panel
**Type:** Task · **Module:** M12 · **Depends on:** TAXI-1206
**Description:** Confirm: viewer can read the Ledger Book but not record entries; accountant can read + record receipt/payment + manual adjustment; operator can read + record receipt/payment (no adjustment); owner can do everything.

**Manual Test Plan:**
1. Log in as `viewer`. Navigate to `/accounts/ledger`.
2. **Pass criterion:** Ledger is visible. All three buttons (Receipt, Payment, Adjustment) are hidden.
3. Log in as `operator`. **Pass criterion:** Receipt + Payment buttons visible. Adjustment hidden.
4. Log in as `accountant`. **Pass criterion:** All three buttons visible.
5. Log in as `owner`. **Pass criterion:** All three buttons visible.
6. As `viewer`, try to navigate directly to a hidden "Record Receipt" URL (if it has its own route). **Pass criterion:** Blocked by RoleGuard or redirect to /unauthorized.

---

# MODULE M13 — Reports: Bill Cover, Bill Register, Duty Register

Goal: The Reports panel is read-only — every screen is a saved SQL view rendered as a sortable, filterable TanStack Table v8 with a Print button. Three reports: Bill Cover (summary list), Bill Register (detailed walk-through), Duty Register (duty slip list).

---

### TAXI-1301 — Implement Bill Cover report
**Type:** Feature · **Module:** M13 · **Depends on:** TAXI-1207
**Description:** Implement `src/panels/reports/BillCoverReport.tsx` at route `/reports/bill-cover`. Filter bar: guest_name search, customer dropdown, date range. Table columns: bill_no, bill_date, customer_name, guest_name (if any), duty_slip_count, base+extra, total_tax, grand_total, status. Uses a SQL view `reports.bill_cover` that joins `billing.bills` + `master.customers` + aggregates `billing.bill_duty_slips`. Print button exports the filtered set to PDF via `BillCoverReportPDF` template.

**Manual Test Plan:**
1. Navigate to `/reports/bill-cover`.
2. **Pass criterion:** Filter bar (guest_name search, customer dropdown, date range) and a table are shown.
3. With multiple bills existing, **Pass criterion:** The table lists all bills with the correct columns.
4. Filter by customer A. **Pass criterion:** Only customer A's bills appear.
5. Filter by date range = last 7 days. **Pass criterion:** Only recent bills appear.
6. Type a guest_name in the search. **Pass criterion:** Table filters to bills where any linked duty slip has that guest_name.
7. Sort by grand_total descending. **Pass criterion:** Table re-sorts.
8. Click **Print**.
9. **Pass criterion:** A new tab opens with a PDF containing the filtered table as a printable report. Header shows "Bill Cover Report" + filter criteria + date generated.
10. Log in as a non-owner role (e.g. operator). **Pass criterion:** The report is visible (Reports panel is read-only for all roles including viewer).

---

### TAXI-1302 — Implement Bill Register report
**Type:** Feature · **Module:** M13 · **Depends on:** TAXI-1301
**Description:** Implement `src/panels/reports/BillRegisterReport.tsx` at route `/reports/bill-register`. Two-pane layout: left side is a navigation list of bills (filterable by date range, customer, status), right side is a detail panel showing the full bill preview (company header, customer block, line-item duty slips with km/hours/amounts, GST breakdown, grand total, Print Bill button). Clicking a bill in the left list immediately loads its preview on the right.

**Manual Test Plan:**
1. Navigate to `/reports/bill-register`.
2. **Pass criterion:** Two-pane layout. Left list shows all bills (bill_no, bill_date, customer, grand_total). Right pane is empty with a hint "Select a bill to view".
3. Click a bill in the left list.
4. **Pass criterion:** The right pane loads the full bill preview: company header, customer block, duty slip line items, GST breakdown, grand total.
5. Filter the left list by customer A. **Pass criterion:** List filters to customer A's bills.
6. Filter by status='cancelled'. **Pass criterion:** List shows cancelled bills (with a visual indicator like a red strikethrough).
7. Click the **Print Bill** button in the right pane.
8. **Pass criterion:** A new tab opens with the BillPDF (from M11) for that bill.
9. Resize the browser window smaller. **Pass criterion:** Layout remains usable (left list collapses to a dropdown or stays side-by-side with horizontal scroll — confirm with architect).

---

### TAXI-1303 — Implement Duty Register report
**Type:** Feature · **Module:** M13 · **Depends on:** TAXI-1302
**Description:** Implement `src/panels/reports/DutyRegisterReport.tsx` at route `/reports/duty-register`. Filter bar: date range, customer, vehicle, status. Table columns: duty_slip_no, booking_date, customer_name, vehicle_registration, duty_type, total_km, total_hours, total_amount, bill_no (if billed, clickable), status. Sortable by any column. Print button exports to PDF via `DutyRegisterReportPDF` template.

**Manual Test Plan:**
1. Navigate to `/reports/duty-register`.
2. **Pass criterion:** Filter bar and table are shown.
3. With multiple duty slips existing, **Pass criterion:** Table lists all duty slips with the correct columns.
4. Filter by customer A. **Pass criterion:** Only customer A's duty slips.
5. Filter by vehicle X. **Pass criterion:** Only vehicle X's duty slips.
6. Filter by status='billed'. **Pass criterion:** Only billed duty slips. The bill_no column shows the linked bill as a clickable link.
7. Click a bill_no link. **Pass criterion:** Navigate to `/reports/bill-register` with that bill pre-selected.
8. Sort by total_km descending. **Pass criterion:** Longest-km duty slips at top.
9. Click **Print**. **Pass criterion:** New tab opens with a PDF table of the filtered duty slips. Header shows "Duty Register Report" + filters + date generated.
10. Filter by date range with no matching duty slips. **Pass criterion:** Table is empty with a "No duty slips found" message.

---

### TAXI-1304 — Implement reports.* SQL views (read-only)
**Type:** Task · **Module:** M13 · **Depends on:** TAXI-1303
**Description:** Create SQL views in the `reports` schema: `reports.bill_cover`, `reports.bill_register`, `reports.duty_register`. These are read-only — no INSERT/UPDATE/DELETE. Apply RLS policies that allow all roles to SELECT but no writes. The views join the underlying tables and aggregate as needed.

**Manual Test Plan:**
1. Open Supabase Studio → SQL Editor. Run: `SELECT * FROM reports.bill_cover LIMIT 5;`
2. **Pass criterion:** Returns rows with the expected columns (bill_no, bill_date, customer_name, guest_name, duty_slip_count, base+extra, total_tax, grand_total, status).
3. Run: `SELECT * FROM reports.duty_register LIMIT 5;`
4. **Pass criterion:** Returns rows with duty_slip_no, booking_date, customer_name, vehicle_registration, duty_type, total_km, total_hours, total_amount, bill_no, status.
5. Try to INSERT into `reports.bill_cover`. **Pass criterion:** Blocked — views are read-only.
6. Try to UPDATE `reports.bill_cover`. **Pass criterion:** Blocked.
7. Try to DELETE from `reports.bill_cover`. **Pass criterion:** Blocked.
8. As a user with `viewer` role, run SELECT on the views. **Pass criterion:** Returns rows (viewer can read reports).
9. As `viewer`, try to INSERT. **Pass criterion:** Blocked by RLS.

---

### TAXI-1305 — Implement BillCoverReportPDF + DutyRegisterReportPDF templates
**Type:** Feature · **Module:** M13 · **Depends on:** TAXI-1304
**Description:** Implement `src/templates/pdf/BillCoverReportPDF.tsx` and `DutyRegisterReportPDF.tsx`. Both render a tabular PDF (no individual bill/duty slip PDFs). Layout: report title, filter criteria (customer, date range, status), date generated, a table of the filtered rows, summary footer (total count, total grand_total).

**Manual Test Plan:**
1. Navigate to Bill Cover report. Apply filters (customer A, last 30 days). Click Print.
2. **Pass criterion:** PDF opens in a new tab. Title "Bill Cover Report". Filter criteria shown below the title. Date generated shown.
3. **Pass criterion:** Table has the same columns as the on-screen table.
4. **Pass criterion:** Footer shows "Total: X bills, Rs. Y" where Y is the sum of grand_totals.
5. Navigate to Duty Register report. Apply filters. Click Print.
6. **Pass criterion:** Same structure — title, filters, table, summary footer.
7. Apply a filter that returns zero rows. Click Print.
8. **Pass criterion:** PDF shows "No records found for the selected filters" instead of an empty table.
9. Print with 100+ rows in the result set.
10. **Pass criterion:** PDF paginates correctly (multiple A4 pages, header repeats on each page, no row cut in half).

---

### TAXI-1306 — Reports panel role gating + performance
**Type:** Task · **Module:** M13 · **Depends on:** TAXI-1305
**Description:** Confirm: all roles (including viewer) can read all three reports. No write actions exist. Performance: with 1000+ bills and 5000+ duty slips, each report loads in < 2 seconds.

**Manual Test Plan:**
1. Open Supabase Studio → SQL Editor. Insert 1000 dummy bills and 5000 dummy duty slips (use generate_series).
2. Log in as `viewer`. Navigate to each of the 3 reports.
3. **Pass criterion:** All 3 load. No "Add" or "Edit" buttons anywhere.
4. Open DevTools → Network. Load the Bill Cover report.
5. **Pass criterion:** The API call to `reports.bill_cover` completes in < 2 seconds. The table renders in < 500ms after the data arrives.
6. Filter by date range. **Pass criterion:** Filter applies in < 1 second.
7. Sort by grand_total. **Pass criterion:** Sort applies in < 1 second.
8. Click Print on the Duty Register with 5000 rows. **Pass criterion:** PDF generation takes < 10 seconds (client-side rendering). The PDF paginates correctly.
9. Log in as `operator`, `accountant`, `owner` in turn.
10. **Pass criterion:** All three roles see the same reports as viewer (no extra write actions appear for any role).

---
# MODULE M14 — Cross-Cutting: Audit Log Viewer, Settings, Role Guards Hardening

Goal: Tie up cross-cutting concerns: an Audit Log viewer (for owner only), a Settings page (per-company key/value), and a final pass on role guards across all panels.

---

### TAXI-1401 — Build Audit Log viewer (owner-only)
**Type:** Feature · **Module:** M14 · **Depends on:** TAXI-1306
**Description:** Implement `src/panels/settings/AuditLogPage.tsx` at route `/settings/audit-log`. Wrapped in `<RoleGuard allowedRoles={['owner']}>`. Filter bar: table_name dropdown, action dropdown (INSERT/UPDATE/DELETE), date range, changed_by dropdown. Table columns: changed_at, table_name, action, record_id, changed_by (user name), old_row (truncated, expandable), new_row (truncated, expandable). Click a row to expand and show the full JSONB old/new rows in a side panel.

**Manual Test Plan:**
1. Log in as `owner`. Navigate to `/settings/audit-log`.
2. **Pass criterion:** Filter bar + table are shown. Recent audit entries are listed.
3. Filter by table_name='duty_slips'. **Pass criterion:** Only duty_slips audit entries show.
4. Filter by action='DELETE'. **Pass criterion:** Only delete actions show.
5. Click a row. **Pass criterion:** A side panel opens showing the full `old_row` and `new_row` as pretty-printed JSON.
6. Log in as `operator`. Navigate to `/settings/audit-log`.
7. **Pass criterion:** Redirected to `/unauthorized` (only owner can view audit log).
8. As `owner`, filter by changed_by (select yourself). **Pass criterion:** Only your changes show.
9. Filter by date range = last 7 days. **Pass criterion:** Only recent entries show.

---

### TAXI-1402 — Build Settings page (per-company key/value)
**Type:** Feature · **Module:** M14 · **Depends on:** TAXI-1401
**Description:** Implement `src/panels/settings/SettingsPage.tsx` at route `/settings`. Owner + operator can edit; accountant + viewer read-only. Lists all `system.settings` rows for the current company. Add new setting (key, value, data_type). Edit existing. Delete setting. Pre-populate a few defaults: `default_tax_rate`, `preferred_pdf_font`, `gst_reminder_email_template`.

**Manual Test Plan:**
1. Log in as `owner`. Navigate to `/settings`.
2. **Pass criterion:** A table of settings is shown. Three default rows exist: `default_tax_rate=5`, `preferred_pdf_font=Helvetica`, `gst_reminder_email_template=<some text>`.
3. Click **Add Setting**. Enter key='currency_symbol', value='Rs.', data_type='string'. Save.
4. **Pass criterion:** New row appears in the table.
5. Try to add a duplicate key. **Pass criterion:** Blocked — "Setting key already exists".
6. Edit `default_tax_rate` from 5 to 12. Save. **Pass criterion:** Persists.
7. Delete the `currency_symbol` setting. **Pass criterion:** Confirmation dialog. Confirm — row disappears.
8. Log in as `accountant`. **Pass criterion:** Settings visible but read-only (no Add/Edit/Delete buttons).
9. Log in as `viewer`. **Pass criterion:** Same as accountant — read-only.

---

### TAXI-1403 — Hardening pass: verify RoleGuard on every route
**Type:** Task · **Module:** M14 · **Depends on:** TAXI-1402
**Description:** Audit every route in `AppRouter`. Confirm each is wrapped in the appropriate RoleGuard:
- `/master/company` — owner, operator, accountant (read-only for accountant)
- `/master/utilities` — owner, operator
- `/master/customers` — owner, operator (accountant + viewer read-only)
- `/master/rates` — owner, operator (accountant + viewer read-only)
- `/master/gst` — owner, operator (accountant + viewer read-only)
- `/daily-work/duty-slips` — owner, operator (accountant + viewer read-only)
- `/daily-work/billing` — owner, operator (accountant + viewer read-only)
- `/daily-work/change-cancel-bill` — owner, operator (accountant + viewer read-only)
- `/daily-work/print` — owner, operator, accountant
- `/accounts/ledger` — owner, operator, accountant, viewer (write actions gated separately)
- `/reports/*` — owner, operator, accountant, viewer (all read-only)
- `/settings/users` — owner only
- `/settings/audit-log` — owner only
- `/settings` — owner, operator (accountant + viewer read-only)

**Manual Test Plan:**
1. Create 4 test users: one for each role (owner, operator, accountant, viewer).
2. For each route in the list above, log in as each role and navigate to the route.
3. **Pass criterion:** Each route behaves per the matrix above. Owner can access everything. Operator can access all panels except `/settings/users` and `/settings/audit-log`. Accountant can read everything but write only in `/accounts/ledger` (receipt/payment/adjustment). Viewer can read reports + ledger but write nothing.
4. As `viewer`, try to manually navigate to `/settings/users` by typing the URL.
5. **Pass criterion:** Redirected to `/unauthorized`.
6. As `operator`, try to navigate to `/settings/audit-log`.
7. **Pass criterion:** Redirected to `/unauthorized`.
8. For each write action (Save buttons, Add buttons, Edit/Delete actions), confirm the button is HIDDEN (not just disabled) for roles that don't have permission. This prevents UI clutter.

---

### TAXI-1404 — Final end-to-end smoke test of the full workflow
**Type:** Task · **Module:** M14 · **Depends on:** TAXI-1403
**Description:** A complete walk-through of the entire system as the operator would use it day-to-day. No new code — just verify everything works together.

**Manual Test Plan:**
1. Log in as `owner`. Set up the company profile (`/master/company`) — upload a logo.
2. Set up vehicle groups (Sedan, SUV) and types (AC, Non-AC) in `/master/utilities`.
3. Add 3 vehicles (one per group/type combo).
4. Set up Document No. Control: duty_slip prefix='DS-', bill prefix='BILL-'.
5. Add 2 customers: one B2B in Maharashtra (interstate), one B2B in Delhi (intra-state).
6. Configure GST for both customers in `/master/gst`.
7. Configure rates for both customers in `/master/rates` (per_km for Sedan/AC, per_day for SUV/Non-AC).
8. Log in as `operator`. Create 4 duty slips (2 for each customer, mix of duty types).
9. Print one duty slip PDF — verify it renders correctly.
10. Generate a bill for customer 1 (interstate) with 2 duty slips. Verify IGST applies.
11. Generate a bill for customer 2 (intra-state) with 2 duty slips. Verify CGST+SGST applies.
12. Print both bills as PDF.
13. Cancel one of the bills. Verify the duty slips are freed.
14. Generate a new bill for the same customer with the freed duty slips.
15. Log in as `accountant`. Open the Ledger Book. Verify sale entries (debit) for both bills, the reversal entry (credit) for the cancelled bill, and the new sale entry for the re-bill.
16. Record a receipt of Rs. 1000 from customer 1. Verify the customer's balance decreases.
17. Log in as `viewer`. Open all 3 reports (Bill Cover, Bill Register, Duty Register). Verify all data is visible.
18. Print the Bill Cover report PDF.
19. Log in as `owner`. Open the Audit Log. Verify entries exist for every INSERT/UPDATE/DELETE you performed.
20. **Pass criterion:** All 19 steps above complete without errors. The full workflow is functional end-to-end.

---

# MODULE M15 — Oracle Cloud VM + Docker Compose Production Setup

> **This module starts ONLY after M0-M14 are complete and tested locally.** The app must be fully functional on the local Supabase stack before any production deployment work begins.

Goal: Provision an Oracle Cloud Always Free ARM A1.Flex VM (2 OCPU, 8 GB RAM, Ubuntu 22.04), install Docker + Docker Compose, deploy the self-hosted Supabase stack via docker-compose.yml, deploy the React SPA build, and verify the production app is reachable over HTTPS via Cloudflare Tunnel (M16).

---

### TAXI-1501 — Provision Oracle Cloud Always Free VM
**Type:** Task · **Module:** M15 · **Depends on:** TAXI-1404
**Description:** Sign up for Oracle Cloud (if not already). Provision a VM.Standard.A1.Flex instance with 2 OCPU, 8 GB RAM, 50 GB boot volume, Ubuntu 22.04 image (`canonical-Ubuntu-22.04-aarch64`). Generate an SSH key pair (ed25519, no passphrase) — keep the private key safe (it's used by CI/CD). Configure ingress rules: BLOCK all inbound ports (Cloudflare Tunnel handles ingress). Allow egress on 443 (Cloudflare), 22 (Backblaze B2 S3 API), 53 (DNS). Configure a 4 GB swap file (Oracle A1 instances have no swap by default — Postgres can OOM-kill on memory pressure).

**Manual Test Plan:**
1. Log in to Oracle Cloud Console → Compute → Instances.
2. **Pass criterion:** You see one running instance with shape `VM.Standard.A1.Flex`, 2 OCPU, 8 GB RAM, Ubuntu 22.04.
3. Note the public IP (if assigned — even though we block inbound, the VM has a public IP for outbound).
4. SSH into the VM: `ssh -i <private_key> ubuntu@<vm_ip>`.
5. **Pass criterion:** You get a bash prompt on the VM (no password required, key-based auth works).
6. Run `free -h`. **Pass criterion:** Total memory shows ~8 GB, swap shows ~4 GB (the swap file you created).
7. Run `df -h`. **Pass criterion:** Root filesystem has ~50 GB total, mostly free.
8. Run `uname -a`. **Pass criterion:** Shows aarch64 architecture, Ubuntu 22.04.
9. From your laptop, try to `ping <vm_ip>`. **Pass criterion:** Ping fails (ICMP blocked — all inbound is blocked).
10. From your laptop, try to `curl http://<vm_ip>:8000`. **Pass criterion:** Connection refused/timeout (port 8000 not exposed to the internet).
11. From the VM, run `curl https://cloudflare.com`. **Pass criterion:** Returns HTML (egress on 443 works).

---

### TAXI-1502 — Install Docker + Docker Compose on the VM
**Type:** Task · **Module:** M15 · **Depends on:** TAXI-1501
**Description:** Install Docker Engine (latest stable) and Docker Compose v2 (plugin) on the VM. Add the `ubuntu` user to the `docker` group so sudo isn't needed for docker commands. Verify with `docker run hello-world`.

**Manual Test Plan:**
1. SSH into the VM.
2. Run `docker --version`. **Pass criterion:** Prints a version string (e.g. "Docker version 24.0.x").
3. Run `docker compose version`. **Pass criterion:** Prints "Docker Compose version v2.x.x".
4. Run `docker run hello-world`. **Pass criterion:** Prints "Hello from Docker!" — confirms Docker daemon is running and can pull images.
5. Run `docker ps`. **Pass criterion:** Empty table (no containers running yet) but no permission error (confirms ubuntu user is in docker group).
6. Run `docker images`. **Pass criterion:** Shows `hello-world` image was pulled.
7. Exit SSH, re-SSH, run `docker ps` again. **Pass criterion:** Still works (group membership persists across sessions).

---

### TAXI-1503 — Write production docker-compose.yml for self-hosted Supabase
**Type:** Task · **Module:** M15 · **Depends on:** TAXI-1502
**Description:** Based on the official Supabase self-hosting docker-compose.yml, customize for Taxi ERP. Containers (per System Design Section 10.2): kong (gateway on :8000), postgres:16-alpine (DB on :5432), postgrest (REST API), gotrue (auth on :9999), storage-api (S3 on :5000), postgres-meta (schema admin on :8080), supabase-studio (dashboard on :3000), uptime-kuma (monitoring on :3001), cloudflared (tunnel client). Pin all image versions (do NOT use `:latest` except for cloudflared). Map postgres data to a Docker volume `supabase-db-data` for persistence. Set strong passwords + JWT secrets in a `.env` file (NOT in the compose file). Add `restart: unless-stopped` to every service.

**Manual Test Plan:**
1. SSH into the VM. Navigate to the project directory.
2. Run `docker compose config`. **Pass criterion:** Prints the resolved compose config with all env vars substituted. No errors.
3. Run `docker compose up -d`. **Pass criterion:** All containers start. `docker compose ps` shows all services as "Up" or "healthy".
4. Wait 60 seconds for the stack to initialize. Run `docker compose ps` again.
5. **Pass criterion:** All services still "Up". Postgres shows "healthy". Kong shows "Up" on port 8000.
6. From the VM: `curl http://localhost:8000/rest/v1/` with the anon key header.
7. **Pass criterion:** Returns a JSON list of tables (or a PostgREST welcome message).
8. From the VM: `curl http://localhost:3000` (Studio).
9. **Pass criterion:** Returns the Supabase Studio HTML page.
10. Run `docker compose logs postgres | tail -20`.
11. **Pass criterion:** No errors in the postgres logs. Logs show "database system is ready to accept connections".
12. Run `docker volume ls`. **Pass criterion:** `supabase-db-data` volume exists.
13. Stop the stack: `docker compose down`. **Pass criterion:** All containers stop cleanly.
14. Restart: `docker compose up -d`. **Pass criterion:** Postgres comes back up with the data intact (volume persisted).

---

### TAXI-1504 — Apply DB migrations to the production Postgres
**Type:** Task · **Module:** M15 · **Depends on:** TAXI-1503
**Description:** Run all the SQL migrations from `supabase/migrations/` (the same ones used locally in M1) against the production Postgres. Use `psql` from inside the postgres container: `docker compose exec postgres psql -U postgres -d postgres -f /migrations/001_init.sql` etc. Alternatively use Supabase CLI: `supabase db push --db-url postgresql://postgres:<password>@localhost:5432/postgres`. Verify all schemas, tables, triggers, RLS policies, and the auto-profile trigger exist.

**Manual Test Plan:**
1. SSH into the VM. From the project directory, run `supabase db push --db-url postgresql://postgres:<password>@localhost:5432/postgres`.
2. **Pass criterion:** Command completes with "Finished supabase db push" or similar. No errors.
3. Open Supabase Studio on the VM (port 3000, accessed via SSH tunnel for now: `ssh -L 3000:localhost:3000 ubuntu@<vm_ip>` from your laptop, then open `http://localhost:3000`).
4. **Pass criterion:** Studio loads. Table Editor shows all 6 schemas (core, master, operations, billing, accounts, system) with all tables.
5. Open SQL Editor, run `SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('core','master','operations','billing','accounts','system');`
6. **Pass criterion:** Returns the expected count (around 13 tables).
7. Run `SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trg_%';`
8. **Pass criterion:** Returns trg_duty_slip_no, trg_gst_interstate, and the audit triggers for each business table.
9. Run `SELECT policyname FROM pg_policies WHERE schemaname IN ('master','operations','billing','accounts');`
10. **Pass criterion:** Returns the tenant isolation + role-gate policies for each table.
11. Create a test user via Supabase Studio → Authentication → Add User.
12. **Pass criterion:** A `core.user_profiles` row is auto-created by the trigger.

---

### TAXI-1505 — Build the SPA for production and deploy to the VM
**Type:** Task · **Module:** M15 · **Depends on:** TAXI-1504
**Description:** Run `npm run build` locally (or in CI). The output is a `dist/` folder with static HTML/JS/CSS. Copy `dist/` to the VM (via SCP or CI/CD). Serve it via a simple Caddy or nginx container in the docker-compose.yml, OR via Cloudflare Pages. The SPA's environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) must point to the production Supabase URL (the Cloudflare Tunnel hostname, configured in M16) and production anon key.

**Manual Test Plan:**
1. On your laptop, run `npm run build`.
2. **Pass criterion:** Build completes with no errors. `dist/` folder contains `index.html`, `assets/` folder with hashed JS/CSS files.
3. SCP the `dist/` folder to the VM: `scp -r dist ubuntu@<vm_ip>:/home/ubuntu/taxi-erp/dist`.
4. **Pass criterion:** SCP completes with no errors.
5. SSH into the VM. Verify `ls /home/ubuntu/taxi-erp/dist/` shows `index.html` and `assets/`.
6. If serving via Caddy: ensure the docker-compose.yml has a Caddy container serving `/home/ubuntu/taxi-erp/dist` on port 80 (or 3002).
7. From the VM: `curl http://localhost:3002`.
8. **Pass criterion:** Returns the SPA's `index.html` content.
9. From the VM: `curl http://localhost:3002/assets/index-<hash>.js`.
10. **Pass criterion:** Returns the JS bundle (200 OK, content-type application/javascript).
11. From your laptop (via SSH tunnel): `ssh -L 3002:localhost:3002 ubuntu@<vm_ip>`, then open `http://localhost:3002` in your browser.
12. **Pass criterion:** The SPA loads. You see the login page.
13. **Pass criterion:** Open DevTools → Network. The API calls go to `http://localhost:8000` (or the configured Supabase URL) and succeed (200 OK). No CORS errors.

---

### TAXI-1506 — Configure production environment variables + JWT secrets
**Type:** Task · **Module:** M15 · **Depends on:** TAXI-1505
**Description:** On the VM, create `/home/ubuntu/taxi-erp/.env` with strong production values: `POSTGRES_PASSWORD`, `JWT_SECRET` (64+ random chars), `ANON_KEY` (JWT signed with the JWT_SECRET, role=anon), `SERVICE_ROLE_KEY` (JWT signed, role=service_role), `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD` (for Supabase Studio access). Update the SPA's env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) to production values. Restart the stack.

**Manual Test Plan:**
1. SSH into the VM. Open `/home/ubuntu/taxi-erp/.env`.
2. **Pass criterion:** All required vars are set with strong (not default) values.
3. Run `docker compose down && docker compose up -d`.
4. **Pass criterion:** All containers start cleanly. No env-var-related errors in `docker compose logs`.
5. From the VM: `curl -H "apikey: <new_anon_key>" http://localhost:8000/rest/v1/customers?select=*`.
6. **Pass criterion:** Returns an empty array `[]` (RLS blocks anon role from seeing data, but the API responds).
7. Try the same curl with the OLD anon key.
8. **Pass criterion:** Returns 401 Unauthorized (old key is invalid).
9. Open the SPA in your browser (via SSH tunnel). Try to log in.
10. **Pass criterion:** Login works — the SPA is using the new anon key. The GoTrue auth call succeeds.
11. Open Supabase Studio. Try to log in with `DASHBOARD_USERNAME` + `DASHBOARD_PASSWORD`.
12. **Pass criterion:** Studio login works (basic auth protects the dashboard).

---

### TAXI-1507 — Set up pg_cron + pg_net extensions for scheduled jobs
**Type:** Task · **Module:** M15 · **Depends on:** TAXI-1506
**Description:** Enable `pg_cron` and `pg_net` extensions in the production Postgres. Create the `cron` schema in the `postgres` database. Schedule a nightly backup job (02:00 IST) that runs `pg_dump` and pushes to B2 (the full backup script is in TAXI-1602). Schedule a GST reminder email job (daily 09:00 IST) — stub for now, can be a no-op. Schedule a ledger auto-reconciliation job (weekly Sunday 23:00) — stub.

**Manual Test Plan:**
1. SSH into the VM. Run `docker compose exec postgres psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS pg_cron;"`
2. **Pass criterion:** Command succeeds with "CREATE EXTENSION".
3. Run `docker compose exec postgres psql -U postgres -c "SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_cron','pg_net');"`
4. **Pass criterion:** Both extensions are listed.
5. Run `docker compose exec postgres psql -U postgres -c "SELECT jobid, jobname, schedule, command FROM cron.job;"`
6. **Pass criterion:** Three jobs are listed: nightly backup (02:00), GST reminder (09:00 daily), ledger reconciliation (Sunday 23:00).
7. Manually trigger the nightly backup job: `SELECT cron.schedule_in_database('test-backup', '*/1 * * * *', 'SELECT 1;', 'postgres');` Wait 1 minute. Check `cron.job_run_details`.
8. **Pass criterion:** The test job ran successfully (status='succeeded').
9. Unschedule the test job: `SELECT cron.unschedule('test-backup');`. **Pass criterion:** Job removed.

---

### TAXI-1508 — Configure Uptime Kuma monitoring
**Type:** Task · **Module:** M15 · **Depends on:** TAXI-1507
**Description:** Access Uptime Kuma at `http://localhost:3001` (via SSH tunnel). Create an admin account. Add a monitor: type=HTTP(s), name="Taxi ERP SPA", URL=`http://localhost:3002`, interval=60 seconds. Add another: type=HTTP(s), name="Supabase API", URL=`http://localhost:8000/rest/v1/`, interval=60 seconds, headers=`{"apikey":"<anon_key>"}`. Add a third: type=TCP, name="Postgres", host=localhost, port=5432, interval=60. Configure a notification channel (Discord webhook or email) — at minimum email.

**Manual Test Plan:**
1. SSH tunnel: `ssh -L 3001:localhost:3001 ubuntu@<vm_ip>`. Open `http://localhost:3001` in your browser.
2. **Pass criterion:** Uptime Kuma setup page. Create admin account.
3. **Pass criterion:** After login, the dashboard is empty with an "Add New Monitor" button.
4. Add the three monitors as described.
5. Wait 2 minutes. **Pass criterion:** All three monitors show "Up" status (green) in the dashboard.
6. Stop the SPA container: `docker compose stop caddy` (or whatever serves the SPA).
7. Wait 2 minutes. **Pass criterion:** Uptime Kuma shows the SPA monitor as "Down" (red). A notification is sent to your email/Discord.
8. Restart: `docker compose start caddy`. Wait 2 minutes.
9. **Pass criterion:** Uptime Kuma shows the SPA monitor as "Up" again. Notification sent ("Service recovered").
10. Stop the postgres container. **Pass criterion:** Postgres monitor goes Down within 60 seconds. Notification sent.
11. Restart postgres. **Pass criterion:** Monitor recovers.

---

### TAXI-1509 — Run the full TAXI-1404 smoke test against production
**Type:** Task · **Module:** M15 · **Depends on:** TAXI-1508
**Description:** Re-run the end-to-end smoke test from TAXI-1404, but against the production deployment (via SSH tunnel or via Cloudflare Tunnel after M16). Verify everything that worked locally also works in production.

**Manual Test Plan:**
1. SSH tunnel: `ssh -L 3002:localhost:3002 ubuntu@<vm_ip>`. Open `http://localhost:3002`.
2. **Pass criterion:** SPA loads. Login page visible.
3. Log in as `owner`. **Pass criterion:** Login succeeds.
4. Walk through steps 1-19 of TAXI-1404's smoke test against production.
5. **Pass criterion:** All 19 steps pass with the same results as local. Any discrepancies are bugs to file.
6. Pay special attention to: PDF rendering (sometimes client-side rendering is slow on first load in production — verify the @react-pdf/renderer bundle is loaded), RLS (verify a second company's data is NOT visible), and audit logging (verify entries are written to production Postgres).
7. Open Uptime Kuma. **Pass criterion:** All monitors still "Up" after the smoke test (no crashes from the load).
8. Open Supabase Studio → `system.audit_log`. **Pass criterion:** All your smoke-test actions are logged.

---

### TAXI-1510 — Document the production runbook
**Type:** Task · **Module:** M15 · **Depends on:** TAXI-1509
**Description:** Write `docs/production-runbook.md` covering: how to SSH into the VM, how to restart a single container (`docker compose restart kong`), how to view logs (`docker compose logs -f postgres`), how to apply a new DB migration (`supabase db push`), how to deploy a new SPA build (SCP + restart caddy), how to take a manual backup, how to restore from backup, how to rotate the JWT secret (with downtime procedure). Save in `docs/`.

**Manual Test Plan:**
1. Open `docs/production-runbook.md` in your editor.
2. **Pass criterion:** Document is well-structured with sections for each operation above. Each section has step-by-step commands.
3. Pick one operation (e.g. "restart a single container"). Follow the runbook steps exactly.
4. **Pass criterion:** The operation succeeds as documented.
5. Pick "apply a new DB migration". Create a tiny test migration locally (e.g. add a `notes` column to `system.settings`). Push to production per the runbook.
6. **Pass criterion:** Migration applies. Verify in Supabase Studio that the column exists.
7. Pick "take a manual backup". Follow the runbook.
8. **Pass criterion:** A backup file is created and pushed to B2 (verify in B2 bucket).
9. Pick "restore from backup". Restore to a TEST Postgres container (not the production one).
10. **Pass criterion:** The restored Postgres has all the data up to the backup time.
11. Have a non-developer (or yourself role-playing as one) follow the runbook to restart a container.
12. **Pass criterion:** They can do it without asking you questions — the runbook is clear enough.

---
# MODULE M16 — Cloudflare Tunnel + Backblaze B2 Backups + Uptime Kuma Alerts

> **This is the FINAL module.** After M16, the system is production-live and reachable over HTTPS.

Goal: (1) Cloudflare Tunnel provides free HTTPS ingress — the VM never exposes a public inbound port. (2) Nightly encrypted pg_dump archives are pushed to Backblaze B2. (3) Uptime Kuma alerts are wired to Discord/email. (4) A CI/CD pipeline (GitHub Actions) builds and deploys the SPA on every push to main.

---

### TAXI-1601 — Configure Cloudflare Tunnel for HTTPS ingress
**Type:** Task · **Module:** M16 · **Depends on:** TAXI-1510
**Description:** In Cloudflare Zero Trust dashboard, create a Tunnel. Install the `cloudflared` daemon on the VM (already in docker-compose.yml from TAXI-1503). Configure the tunnel's public hostname (e.g. `taxi.yourdomain.com`) to proxy to `http://localhost:8000` (Kong/Supabase API). Configure a second hostname (e.g. `app.yourdomain.com`) to proxy to `http://localhost:3002` (the SPA via Caddy). Configure a third (e.g. `studio.yourdomain.com`) to proxy to `http://localhost:3000` (Supabase Studio, optionally protected by Cloudflare Access). Apply rate limiting + bot mitigation at the Cloudflare edge.

**Manual Test Plan:**
1. Open Cloudflare Zero Trust dashboard → Networks → Tunnels.
2. **Pass criterion:** You see one tunnel in "Connected" status.
3. Open the tunnel's config. **Pass criterion:** Three public hostnames are mapped: `taxi.yourdomain.com` → localhost:8000, `app.yourdomain.com` → localhost:3002, `studio.yourdomain.com` → localhost:3000.
4. Open `https://app.yourdomain.com` in your browser.
5. **Pass criterion:** The SPA loads over HTTPS (padlock icon in browser). No certificate warnings.
6. **Pass criterion:** You can log in. The SPA's API calls go to `https://taxi.yourdomain.com` (verify in DevTools → Network).
7. Open `https://taxi.yourdomain.com/rest/v1/` with the anon key header.
8. **Pass criterion:** Returns the PostgREST welcome JSON over HTTPS.
9. Open `https://studio.yourdomain.com`.
10. **Pass criterion:** Supabase Studio loads (may require Cloudflare Access email-OTP if you enabled it).
11. From your laptop, try to `curl http://<vm_ip>:8000` directly (bypassing Cloudflare).
12. **Pass criterion:** Connection refused/timeout — the VM's port 8000 is NOT exposed to the internet. Only Cloudflare Tunnel can reach it.
13. In Cloudflare dashboard → Security → WAF, set rate limit: 100 requests/minute per IP for `taxi.yourdomain.com/*`.
14. **Pass criterion:** Rate limit rule is active. (Optional: test by writing a script that hits the API 200 times in a minute — should get 429 Too Many Requests after 100.)

---

### TAXI-1602 — Set up Backblaze B2 + nightly encrypted backup
**Type:** Task · **Module:** M16 · **Depends on:** TAXI-1601
**Description:** Create a Backblaze B2 account (10 GB free tier). Create a bucket `taxi-erp-backups` (private, versioned). Generate a B2 application key with read+write access to that bucket. Install `rclone` on the VM and configure it with the B2 credentials (`rclone config`). Install `age` for encryption — generate a keypair; store the private key OFF the VM (on your laptop, in a password manager). Write a backup script `/home/ubuntu/taxi-erp/scripts/nightly-backup.sh` that: (a) runs `pg_dump -Fc` on the production Postgres, (b) encrypts the dump with `age -r <public_key>`, (c) pushes the encrypted file to B2 via `rclone copy`, (d) deletes local encrypted dumps older than 7 days. Schedule via pg_cron at 02:00 IST. Retention: 30 days of nightly + 12 monthly snapshots.

**Manual Test Plan:**
1. Log in to Backblaze B2 console. **Pass criterion:** Bucket `taxi-erp-backups` exists, is private, has versioning enabled.
2. SSH into the VM. Run `rclone listremotes`.
3. **Pass criterion:** Returns `b2:` (configured).
4. Run `rclone ls b2:taxi-erp-backups/`. **Pass criterion:** Returns empty (no backups yet).
5. Manually run the backup script: `bash /home/ubuntu/taxi-erp/scripts/nightly-backup.sh`.
6. **Pass criterion:** Script runs without errors. Outputs a log line like "Backup pushed to B2: taxi-erp-2026-09-15-0200.dump.age".
7. Run `rclone ls b2:taxi-erp-backups/` again.
8. **Pass criterion:** One `.dump.age` file is listed.
9. Download the encrypted file to your laptop: `rclone copy b2:taxi-erp-backups/taxi-erp-2026-09-15-0200.dump.age ./`.
10. Decrypt it with the private key: `age -d -i <private_key_file> taxi-erp-2026-09-15-0200.dump.age > restored.dump`.
11. **Pass criterion:** Decryption succeeds. `restored.dump` is a valid pg_dump custom-format file (verify with `pg_restore --list restored.dump`).
12. Restore to a test Postgres container: `docker run --rm -v $(pwd):/data postgres:16-alpine pg_restore -U postgres -d postgres -1 /data/restored.dump` (with appropriate env vars).
13. **Pass criterion:** Restore completes. Connect to the test Postgres and verify a few tables have data.
14. Wait for the next 02:00 IST cron run. Check `cron.job_run_details` the next morning.
15. **Pass criterion:** The nightly job ran with status='succeeded'. A new `.dump.age` file is in B2.
16. After 30 days (or simulate by uploading 30 dummy files), verify retention: only the last 30 nightly dumps + 12 monthly snapshots remain in B2.

---

### TAXI-1603 — Wire Uptime Kuma alerts to Discord + email
**Type:** Task · **Module:** M16 · **Depends on:** TAXI-1602
**Description:** In Uptime Kuma, add a Discord notification channel (Discord webhook URL). Add an email notification channel (SMTP config). Attach both channels to all three monitors (SPA, Supabase API, Postgres). Test by stopping a container and verifying alerts fire.

**Manual Test Plan:**
1. In Uptime Kuma → Settings → Notifications. **Pass criterion:** Two channels are set up: Discord and Email. Both show "Working" status after a test send.
2. Attach both channels to the "Taxi ERP SPA" monitor. **Pass criterion:** Both channels are listed in the monitor's notification settings.
3. Stop the SPA container: `docker compose stop caddy`.
4. Wait 60-90 seconds.
5. **Pass criterion:** You receive a Discord message saying "Monitor 'Taxi ERP SPA' is DOWN". You also receive an email with the same message.
6. Restart the SPA: `docker compose start caddy`. Wait 60 seconds.
7. **Pass criterion:** Discord + email say "Monitor 'Taxi ERP SPA' is UP".
8. Stop postgres. **Pass criterion:** All three monitors eventually go DOWN (SPA can't reach DB, API can't reach DB, Postgres directly down). Three DOWN alerts.
9. Restart postgres. **Pass criterion:** All three recover. Three UP alerts.
10. Verify the Discord webhook isn't rate-limited (Discord has a 30-message-per-minute limit per webhook).

---

### TAXI-1604 — Set up GitHub Actions CI/CD pipeline
**Type:** Task · **Module:** M16 · **Depends on:** TAXI-1603
**Description:** Create `.github/workflows/deploy.yml`. On push to `main`: (1) checkout, (2) `npm ci`, (3) `npm run lint`, (4) `npm run build`, (5) SCP the `dist/` folder to the VM using an SSH key stored as a GitHub secret, (6) SSH into the VM and run `docker compose restart caddy` (or whatever serves the SPA). Also add a workflow for DB migrations: on changes to `supabase/migrations/`, SSH into the VM and run `supabase db push`.

**Manual Test Plan:**
1. Make a small change to the SPA (e.g. update the page title in `index.html`).
2. Commit and push to `main`.
3. Open GitHub → Actions tab.
4. **Pass criterion:** A new workflow run starts. Steps: checkout → npm ci → lint → build → SCP → restart caddy.
5. **Pass criterion:** All steps pass green. Total time < 5 minutes.
6. Open `https://app.yourdomain.com` in your browser.
7. **Pass criterion:** The change is live (e.g. new page title visible).
8. Make a small DB migration (e.g. add a `notes` column to `system.settings`). Commit and push.
9. **Pass criterion:** The migrations workflow runs. Step: SSH → `supabase db push` → success.
10. Open Supabase Studio → Table Editor → `system.settings`. **Pass criterion:** The `notes` column exists.
11. Make a change that breaks the build (e.g. introduce a TypeScript error). Push.
12. **Pass criterion:** The workflow fails at the `lint` or `build` step. The production SPA is NOT updated (the old build is still serving). You receive a GitHub email about the failed run.
13. Revert the breaking change. Push. **Pass criterion:** Workflow passes. Production updated.

---

### TAXI-1605 — Final production security review
**Type:** Task · **Module:** M16 · **Depends on:** TAXI-1604
**Description:** Security review of the production deployment. Checklist:
- All inbound ports on the VM are blocked (only Cloudflare Tunnel egress).
- Supabase Studio is protected by Cloudflare Access (email-OTP) OR a strong dashboard password.
- The `service_role` key is NEVER in the SPA bundle (only the `anon` key).
- RLS is enabled on every tenant-scoped table.
- The `system.audit_log` table has an RLS policy denying all direct writes.
- HTTPS is enforced (Cloudflare SSL/TLS mode = "Full" or "Full (strict)").
- The `.env` file on the VM has 600 permissions (`chmod 600 .env`).
- Database backups are encrypted with `age` before leaving the VM.
- No secrets are committed to the git repo (verify with `git log --all -p | grep -i "password\|secret\|key"`).

**Manual Test Plan:**
1. From your laptop, run `nmap -p 1-65535 <vm_ip>` (or use an online port scanner).
2. **Pass criterion:** All ports are filtered/closed. No inbound ports are open.
3. Open `https://studio.yourdomain.com` in a fresh incognito window.
4. **Pass criterion:** Cloudflare Access page appears asking for email OTP (if enabled). OR Studio's basic auth prompt appears.
5. Open the SPA in your browser. Open DevTools → Sources. Search for "service_role" in the JS bundle.
6. **Pass criterion:** No matches found. The service_role key is NOT in the client bundle.
7. Open Supabase Studio → SQL Editor. Run: `SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace IN ('master'::regnamespace, 'operations'::regnamespace, 'billing'::regnamespace, 'accounts'::regnamespace) ORDER BY relname;`
8. **Pass criterion:** Every table shows `relrowsecurity = true` (RLS enabled).
9. Run: `SELECT policyname, cmd FROM pg_policies WHERE tablename = 'audit_log' AND schemaname = 'system';`
10. **Pass criterion:** A policy exists denying all writes (or only allowing SELECT for owner role).
11. SSH into the VM. Run `ls -la /home/ubuntu/taxi-erp/.env`.
12. **Pass criterion:** Permissions are `-rw-------` (600) — only the ubuntu user can read it.
13. In Cloudflare dashboard → SSL/TLS → Overview.
14. **Pass criterion:** SSL/TLS encryption mode is "Full" or "Full (strict)" — not "Flexible" (Flexible is insecure).
15. On your laptop, run `git log --all -p | grep -iE "password|secret|api_key|service_role" | head -20`.
16. **Pass criterion:** No real secrets appear in git history (only placeholder values like `<your-password-here>`).

---

### TAXI-1606 — Production launch + final smoke test
**Type:** Task · **Module:** M16 · **Depends on:** TAXI-1605
**Description:** The system is live. Run the full TAXI-1404 smoke test one final time against `https://app.yourdomain.com` (production, over HTTPS, no SSH tunnel). Verify everything works as the operator would experience it. Then "launch": notify the operator, hand over the runbook, and enter maintenance mode.

**Manual Test Plan:**
1. Open `https://app.yourdomain.com` in your browser.
2. **Pass criterion:** SPA loads over HTTPS. Login page visible. No mixed-content warnings.
3. Log in as `owner`. **Pass criterion:** Login succeeds.
4. Walk through all 19 steps of TAXI-1404's smoke test against the production URL.
5. **Pass criterion:** All 19 steps pass. Pay special attention to:
   - PDF rendering (must work in production — verify @react-pdf/renderer bundle is loaded).
   - File uploads (company logo — verify Supabase Storage is reachable over HTTPS).
   - Rate limiting (verify Cloudflare's rate limit doesn't block legitimate use — logins, page loads, API calls).
6. Open the production Supabase Studio. Verify `system.audit_log` shows all your smoke-test actions.
7. Open Uptime Kuma. **Pass criterion:** All monitors are "Up". No false alarms during the smoke test.
8. Check Backblaze B2. **Pass criterion:** Tonight's backup will run at 02:00 IST — verify the bucket is ready.
9. Hand over to the operator: walk them through the runbook, the login URL, the support contact (you).
10. **Pass criterion:** Operator can log in, create a duty slip, generate a bill, print it, and record a receipt — all without your help.
11. Enter maintenance mode: monthly security patches via Watchtower (auto-update Docker images), quarterly audit_log growth review, annual Oracle Free Tier policy review.

---

## END OF TASKLIST

### Summary

- **17 modules** (M0-M16), **~90 tickets** total.
- **Local development phase (M0-M14):** ~85 tickets. Build and test everything on the local Supabase stack. No production infrastructure needed.
- **Production deployment phase (M15-M16):** ~16 tickets. Provision Oracle VM, deploy Docker Compose, configure Cloudflare Tunnel + Backblaze B2 + Uptime Kuma + CI/CD.
- **Testing policy:** Manual only. Every ticket has a click-by-click Manual Test Plan. No automated tests are written by the agent. The operator follows the steps and verifies the pass criteria.
- **Dependencies are strict:** finish each module before starting the next. The dependency graph is acyclic.
- **Architecture changes:** the agent must NOT change the architecture without first discussing with the operator. See `Claude.MD` for the full agent contract.
