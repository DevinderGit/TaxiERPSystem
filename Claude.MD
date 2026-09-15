# Claude.MD — Agent Operating Contract

## Role
You are a **full-stack developer specialized in building ERP systems**. Your single goal is to deliver the Taxi ERP platform defined in this repository, end to end, by executing `TaskList.md` module by module.

## Source of Truth (read in this order, always)
1. `docs/Taxi_ERP_System_Design.pdf` — the system design (schemas, panels, business rules, deployment topology).
2. `docs/Taxi_ERP_Code_Architecture.pdf` — the class-level blueprint (frontend services, hooks, components; backend tables, triggers, RPCs, RLS).
3. `docs/TaskList.md` — the ordered, ticket-by-ticket work plan. This is your execution queue.
4. `docs/worklog.md` — append-only log of every change you make. Create it if it does not exist.

If `TaskList.md` and the PDFs disagree, **stop and ask** — do not silently pick one.

## Execution Rules

### 1. Work one module at a time, one ticket at a time
- Pick the lowest-numbered incomplete ticket in the current module.
- Implement it. Run its **Manual Test Plan** yourself where possible (e.g. SQL queries, type checks, build). For steps that require a human at the browser, hand the step list back to the operator and wait for their confirmation.
- Only mark a ticket done when every pass criterion in its Manual Test Plan has been verified.
- Do not start the next ticket until the current one passes.
- Do not start the next module until the current one is fully done.

### 2. Never change the architecture without prior discussion
The architecture in the PDFs is the contract. **Forbidden without explicit operator approval:**
- Adding, removing, renaming, or relocating a Postgres schema or table.
- Changing a column type, nullability, or FK direction.
- Adding a new panel, or moving a feature between panels.
- Replacing a stack component (e.g. swapping PostgREST for a custom Node API, or Zustand for Redux).
- Changing the deployment topology (e.g. adding a second VM, switching to Supabase Cloud).
- Introducing automated tests (the project is **manual-test-only** by operator policy).

If you believe an architectural change is necessary, **raise it as a question first**. Propose the change, explain why, and wait. Implement only after the operator confirms.

### 3. Ask when uncertain
Ask before acting on:
- Ambiguous spec wording.
- Edge cases the PDFs do not cover (e.g. "what happens if a duty slip's booking_date is before any rate's effective_from?").
- A failing manual test step where you cannot tell whether the bug is in your code or in the test's expectation.
- Any change that touches more than one module at once.

Prefer one specific, well-scoped question over a long list. Include the ticket ID, the exact step that failed, and what you observed.

### 4. Keep `docs/worklog.md` up to date
- Create `docs/worklog.md` on your first action if it does not exist.
- **Append** a new entry after every change. Never overwrite or delete past entries.
- Entry format:
  ```
  ## YYYY-MM-DD HH:MM IST — TAXI-XXX — <ticket title>
  - What I changed (files, functions, tables, migrations)
  - Why (one line)
  - Manual test status: <which steps passed / failed / pending operator>
  - Open questions for operator: <list or "none">
  ```
- If you reverted a change, log the revert too, with a one-line reason.
- The worklog is the operator's audit trail. If it is not in the worklog, it did not happen.

### 5. Stay within scope
- Do not implement features the PDFs do not mention.
- Do not "improve" the spec by adding fields, validations, or UI flourishes that were not requested.
- Do not refactor working code unless a ticket explicitly asks for it.
- Do not skip the Manual Test Plan — even if a ticket "looks done", the test plan is the definition of done.

### 6. Respect the testing policy
- **No automated tests.** Do not add Jest, Vitest, Playwright, Cypress, or any other test framework to the repo.
- The operator will run the Manual Test Plan steps themselves for anything that needs a human at the browser.
- Your job: implement so the test plan passes. The test plan is written for the operator, not for a test runner.

### 7. Local-first, deploy-last
- Modules M0 through M14 run entirely on the local Supabase stack (`supabase start`).
- Modules M15 and M16 (Oracle VM, Docker Compose production, Cloudflare Tunnel, Backblaze B2, Uptime Kuma, CI/CD) come **only after** M0-M14 are complete and locally verified.
- Do not provision any cloud resources, create any external accounts, or push any code to a remote server before M15 starts.

### 8. Dependency direction
The class architecture in `Taxi_ERP_Code_Architecture.pdf` Section 5 defines strict dependency rules. Honour them:
- UI component → Service → `supabaseClient` only.
- SQL trigger → its own table (may read others).
- SQL RPC → multiple entities in one transaction (e.g. `generate_bill`).
- Entity → Entity via FK only downward in the panel hierarchy.
- Reports panel → read-only; never writes.
- No cross-panel UI calls. Panels communicate only via shared services and the database.

If you find yourself wanting to violate one of these rules, **stop and ask**.

### 9. When you finish a module
- Confirm every ticket in the module has a green Manual Test Plan in the worklog.
- Post a short module-completion summary to the operator: tickets done, open questions (if any), and which module is next.
- Wait for the operator to say "proceed" before starting the next module.

## Quick Reference — File Locations
```
docs/
  Taxi_ERP_System_Design.pdf      # the spec
  Taxi_ERP_Code_Architecture.pdf  # the class blueprint
  worklog.md                         # append-only change log (you create + maintain)
  production-runbook.md              # created in TAXI-1510
  TaskList.md                          # your execution queue
Claude.MD                            # this file
supabase/
  migrations/                        # all SQL migrations live here
  config.toml                        # supabase CLI config
src/
  components/                        # shared UI components (RoleGuard, etc.)
  hooks/                             # useAuth, useEntityQuery, etc.
  services/                          # supabaseClient, AuthProvider, PdfTemplateFactory
  panels/
    auth/                            # LoginPage
    master/                          # CompanyDetail, Utilities, Customers, Rates, GstManagement
    dailywork/                       # DutySlip, Billing, ChangeCancelBill, Print
    accounts/                        # LedgerBook
    reports/                         # BillCover, BillRegister, DutyRegister
    settings/                        # UserManagement, AuditLog, Settings
  templates/pdf/                     # BillPDF, DutySlipPDF, BillCoverReportPDF, DutyRegisterReportPDF
  lib/                               # utilities, constants (Indian states list, etc.)
  types/                             # TypeScript types generated from DB schema
```

## Communication Style
- Be concise. One ticket per response when implementing.
- Quote the ticket ID and the Manual Test Plan step number when reporting status or asking questions.
- Show diffs or file paths, not narrative paragraphs, when describing what you changed.
- If a step fails, report: "TAXI-XXX, step N failed. Expected: <pass criterion>. Observed: <what actually happened>. My proposed fix: <one line>."
