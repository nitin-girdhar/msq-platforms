# HRMS - Stitch parity plan

**Goal:** every HR screen matches the Stitch project "HRMS" (id `7964813948240899929`, design system "Nexus HRMS Self-Service"), while keeping what already works: tenant branding tokens, dark mode, capability-gated access, RLS on every table, and the rule that user-facing words go through `useTerm`.

**Audit date:** 2026-10-04. Method: every Stitch desktop screenshot was compared with the same screen as built (`stitch-redsign` branch, local stack), role by role. The 12 Stitch mobile screens were not yet compared one by one; that is Phase 5.

**Status key:** DONE = structure matches Stitch; PARTIAL = right idea, visibly different; MISSING = does not exist.
**Size:** S = a day or less, M = a few days, L = a week or more (relative, not a commitment).

---

## 1. Where we are

| Stitch screen | Route | Status |
|---|---|---|
| Employee 360 (+ interactive tabs) | `/employees/[id]` | DONE structure (rebuilt 2026-10-04); data-dependent cards still thin |
| Employee Profile & Account Settings | `/profile` | DONE structure (rebuilt 2026-10-04) |
| Documents & Compliance Vault | `/documents` | PARTIAL |
| Monthly Attendance & Payroll Report Matrix | `/reports` | PARTIAL |
| Attendance & Shift Timesheet | `/attendance` | PARTIAL |
| Attendance Punch & Regularization Hub | `/attendance` | PARTIAL |
| Leave Management & Time-Off (apply) | `/leave` | PARTIAL |
| Leave Management & Approvals Hub | `/leave/approvals` | PARTIAL |
| Payroll & Compensation Overview | `/payroll` | PARTIAL (viewer only) |
| Employee Dashboard | `/dashboard` | PARTIAL (about 25% of the design) |
| Employee Directory & Workforce Roster | `/employees` | PARTIAL |
| Daily Attendance & Shift Roster | `/attendance/team` | PARTIAL |
| My Team & Department Roster | `/team` | PARTIAL |
| Workforce Shift Roster & Schedule Planner (admin) | none | MISSING |

---

## 2. Cross-cutting gaps (fix once, every screen benefits)

| # | Gap | Where Stitch shows it | Work | Size |
|---|---|---|---|---|
| X1 | **Profile photos / avatars** in lists, headers, rosters | every screen | Identity already stores avatars (`/users/:id/photo`, authenticated). Expose `has_photo` in the HR views and add one `PersonAvatar` component (photo, else initials). | M |
| X2 | **Header: global search, shift status pill, notifications bell** | every screen | Search = employees/pages the actor may open (capability-filtered, server-side). Shift pill = today's shift from the roster API. Bell = needs an HR renderer on the notification stream (none exists today). | L |
| X3 | **Sidebar footer: "Working time" and "Assigned shift" cards** | every screen | Both derive from today's attendance state already fetched on the dashboard. | S |
| X4 | **Breadcrumbs + page-header pattern** (title, subtitle, action buttons, status chip) | every screen | One `HrPageHeader` replacing per-screen variations. | S |
| X5 | **Shared building blocks:** KPI stat card, slot chip, status pill, donut, data table with pagination and rows-per-page, filter chip bar | every screen | Build once in `hr-web/components/common`, reuse. Prerequisite for most phases. | M |
| X6 | **Slot vocabulary:** "Slot 1 Core / Slot 2 Collab / Night +1D" | roster, timesheet, punch, directory | Our model is `hr.shifts` + `shift_segments` (kept by decision). Show segment order as "Slot N" with the segment's own name; night = segment crossing midnight. No fixed 4-tier model. | S |
| X7 | **Sidebar items we do not have:** Recruitment, Performance, Expenses, Helpdesk, Settings, Announcements page | sidebar | Decision D1. Announcements already exists as a dashboard panel; Tasks is a cross-product link. | - |
| X8 | **Mobile** | 12 Stitch mobile screens | Compare and fix each at 390 px (Phase 5). | L |

---

## 3. Screen by screen

### 3.1 Dashboard (`/dashboard`) - PARTIAL, size L
Stitch: greeting with date and shift line; profile summary card (avatar, contact, base location, reporting unit, shift model); "Today's attendance & shift log" with one card per slot (check in/out, hours) plus total logged and break gap; four KPI cards (present days, leaves taken, overtime, pending tasks); quick-actions grid; upcoming holidays with date tiles and countdown; leave-balance donut with accrued/availed and "request encashment"; three announcements; recent activity log.
Ours: punch card, flat leave-balance box, holidays box, announcements box.
- **UI:** all of the above blocks. Quick actions link only to screens the actor can open.
- **API:** one `GET /dashboard/me` aggregate (KPIs for the month, per-slot punches for today, recent activity from the audit log scoped to the actor, pending task count from Tasks via the existing cross-product read). Overtime needs a definition (D5).
- **DB:** none. Base location and reporting unit come from existing org/branch and department.

### 3.2 Attendance Punch & Regularization Hub (`/attendance`) - PARTIAL, size L
Stitch: in-page live selfie panel and GPS map panel (not a modal), slot selector, break punch, three stat cards, the regularization form inline on the page, and a history table with ticket id, slot, type, reviewer, status.
Ours: hero card with modal punch flow, three stat cards, regularization in a modal, list of requests.
- **UI:** move selfie + geofence into an in-page panel; inline regularization form; history as a table with ticket ids and reviewer.
- **Decisions:** map tile provider (D2), break punch (D3).
- **API/DB:** regularization ticket number (human id like `REG-8921`, a sequence per org); break punch needs an event type `break_out/break_in` and rules for how it affects worked time (only if D3 = yes).

### 3.3 Timesheet (`/attendance`, calendar) - PARTIAL, size M
Stitch: five KPI cards (total hours vs target, slot adherence, night allowance earned, exceptions, attendance rate), three views (Monthly calendar, Detailed daily slot log, Shift regularization), slot filter chips, calendar cells showing slot dots (4/4) and hours, day breakdown timeline with inter-slot breaks, regularization and supervisor log table.
Ours: calendar, side panel with sessions and breaks (built 2026-10-04), punch-log tab.
- **UI:** KPI strip, slot dots per day, view tabs, regularization log with audit link.
- **API:** month summary endpoint with target hours (from shift) and adherence; night allowance only if D1/D4 = yes.

### 3.4 Leave apply / time-off (`/leave`) - PARTIAL, size L
Stitch: four balance cards (used/quota bars, validity, encashable, expiring comp-off), "Apply for time off" form on the page with leave-type tiles, duration mode (full/1st half/2nd half/slot specific), applicable slot, dates with duration, **handover colleague**, reason, **supporting document upload**, **save as draft**; team availability panel; upcoming holidays panel; history table with leave id, reviewer, status and actions.
Ours: apply in a modal, empty-state boxes, status filter.
- **UI:** page layout as above.
- **DB:** `hr.leave_requests` gains `handover_user_id`, `attachment_document_id` (reuse the documents vault blob store), `status = draft`, and a readable `request_no` (`LV-44912`). Slot-specific leave maps to half-day plus segment id (new column `segment_id`).
- **API:** draft save/submit, attachment upload (reuse the vault endpoint with a `leave_attachment` category), team availability read (already exists for the approvals tab).

### 3.5 Leave approvals hub (`/leave/approvals`) - PARTIAL, size M
Stitch: three summary cards (urgent pending with SLA, team availability today, annual quota), three tabs, filter chips (All / Urgent SLA / by type), select-all with Approve Selected / Reject Selected, request cards with SLA chip, handover, attachment, Request Info / Reject / Approve, and a "Recent decision ledger" table.
Ours: tabs and cards exist (bulk, SLA, request info built in H7); summary cards, filter chips, handover/attachment lines and the ledger are missing.
- **UI:** summary cards, chips, ledger. **API:** ledger = last N decided requests the actor decided (small read). Handover/attachment depend on 3.4.

### 3.6 Payroll (`/payroll`) - PARTIAL, size L
Stitch: net take-home, shift differentials, statutory deductions, projected CTC KPIs; component breakdown (earnings vs deductions bar and table); net disbursed banner with UTR and date; multi-shift differentials card; income tax / TDS planning; bank and compliance details; historical archive by financial year with per-row view/download.
Ours: payslip list/detail and HR draft/publish/lock tools. A viewer, by decision.
- **Build:** KPI cards from the published payslip; earnings/deductions split with the proportion bar; FY tabs on the archive; **payslip PDF** (server-side render, needs a PDF library, D6); bank details card from the statutory record we already hold.
- **Not built unless decided (D6):** TDS planning and old-vs-new regime compare, Form 16, YTD/CTC projection (needs salary structures), UTR/disbursal tracking (needs a payment-run record).
- **DB:** only if D6 includes disbursal (`hr.payroll_runs` with UTR/value date) or salary structures.

### 3.7 Documents vault (`/documents`) - PARTIAL, size M
Stitch: four summary tiles (KYC dossier, tax proofs, shift allowance proofs, mandatory policies), category tabs with counts, search, assessment-year chips, document rows with type icon/size/date/hash and view/download, a **tax-proof submission panel** (section, amount, receipt no., upload, progress bar to a declared target), "download dossier (ZIP)", policy acknowledgement.
Ours: upload, status chips, review queue, 360 tab (built 2026-10-04), tax section and amount fields exist.
- **UI:** tiles, category tabs, search, AY filter, view-in-place, submission panel with progress.
- **API:** download as ZIP (server-side streaming), per-FY declared target (small table or tenant setting).
- **DB:** `hr.policy_acknowledgements` + `hr.policies` if D7 = yes. Raise file limit from 3 MB to 15 MB only if body-limit and storage are re-tested (D8).
- **Dropped on purpose:** DigiLocker, "cryptographic hash certified", ISO 27001/KMS decoration.

### 3.8 Employee directory (`/employees`) - PARTIAL, size M
Stitch: avatar + status dot + "YOU" badge, designation with **level**, department with **squad**, active shift slot column with break/overtime sub-line, four KPI cards (workforce with active/leave/notice, shift allocation, top functions bar, new cohort), department and shift filters, "more filters", status/slot pills (on duty, remote, on leave, per slot), table/grid toggle, pagination with rows per page, Export CSV, Bulk Actions, Add New Employee.
Ours: three counts, search, department filter, status tabs, table/cards, CSV, edit modal.
- **UI:** all of the above; clicking a row opens Employee 360 (today it opens an edit modal).
- **DB:** employee fields behind the design - `grade` (L4), `squad`, `cost_center`, `notice_period_days`, `work_mode` (Hybrid/Remote/Office), `seat_label` (D4). These also fill the Employee 360 tiles that are blank today.
- **API:** list read returns today's shift, on-duty/leave state and photo flag in one query; server-side pagination and filters (client-side today).

### 3.9 Daily roster (`/attendance/team`) - PARTIAL, size L
Stitch: day navigator with Jump to Today, branch and department filters, six KPIs (scheduled, on duty, late, leaves and off, unmarked with Nudge, night shifts), slot chips, table with assigned shift / in punch with source / out punch / worked-hours bar / status chip, **Presence compliance donut**, **Pending exceptions panel with inline Approve / Reject**, HR desk card, pagination, Export XLS, Bulk Regularize, Manual Punch Override.
Ours: five KPIs, status chips, simple table, nudge/bulk/manual punch (built H7), pending regularizations below.
- **UI:** two-column layout (table + right rail), assigned shift and punch source columns, donut, inline exceptions.
- **API:** day read gains assigned shift, in/out source, worked minutes, flags; XLS export (CSV exists); pagination.

### 3.10 My team (`/team`) - PARTIAL, size M
Stitch: avatars and level, multi-slot cells (two slot chips per day), YOU row first, slot filter chips, "Peer shift swap & handover desk" with ticket cards (your slot, peer slot, consent, manager sign-off, nudge, withdraw), "Leadership & escalation" card (direct manager with contact, secondary approver, urgent escalation).
Ours: KPI cards, week navigator, single-chip cells, swap request modal.
- **UI:** multi-chip cells, slot filter, swap desk in the page, leadership card from the manager chain (now returned by the profile API).
- **Not available:** "on-call hotdesk", "Teams chat" links - no data source; omit.

### 3.11 Matrix report (`/reports`) - PARTIAL, size M
Stitch: month and branch selectors, Excel and PDF dossier, Lock for Payroll, five KPIs (headcount, avg punctuality, planned days, overtime hours, discrepancies), legend filter pills that isolate a code, search, sticky table with role/level, assigned shift, day columns, and a **Payable** column (e.g. 30.0 / 30).
Ours: muster matrix and monthly summary tabs plus month-end sign-off (2026-10-04).
- **UI:** KPI strip, legend pills as filters, shift and level columns, payable column; PDF export.
- **API:** payable days per person (present + paid leave + holidays + weekly off) from the same rules the muster uses; overtime hours (needs D5).

### 3.12 Shift roster planner (admin) - MISSING, size L (the largest single item)
Stitch: Day/Week/Month toggle, branch, department and slot filters, per-slot capacity cards (assigned vs required, "optimum / 95% cap / balanced"), staff by day grid where **any cell is clickable to edit**, shift-stamp legend, **Adjustment & Swap desk** and **weekly-off reschedule requests** side panel with approve/decline, **capacity distribution donut**, Assign Shift Pattern, Bulk Reallocate, Export XLSX, **Publish & Notify Roster**, fatigue (11 h rest) check.
Ours: shift assignments admin (Attendance admin) and the read-only weekly roster; swap approvals exist; 11 h rest rule exists in the swap library.
- **DB:** `hr.shift_requirements` (required headcount per shift per branch per weekday) for capacity; `hr.weekly_off_requests` (employee, from date, to date, reason, status); roster publish state (`hr.roster_publications`: branch, week, published_by, published_at) so "draft vs published" is real.
- **API:** week grid read with capacity per slot; cell edit (assign/clear/replace for one person and day, fatigue-checked, audited); pattern assign (a shift over a date range for a set of people); bulk reallocate; publish (and notify, see X2); weekly-off request create/decide.
- **Access:** new capability `hr.attendance.roster.manage` (back-filled from effective holders of `hr.attendance.admin.assignments.manage`), RLS on the new tables, service-login policy sweep.
- This is the screen to ask "is it yours" about: see D9 and the open question on the super-admin roster.

---

## 4. Proposed order

| Phase | Content | Why this order |
|---|---|---|
| **P0 Foundation** | X1, X3, X4, X5, X6 | Every later screen uses them; avoids rework. |
| **P1 Self-service core** | Dashboard 3.1, Punch hub 3.2, Timesheet 3.3, Leave apply 3.4 | What every employee sees daily. |
| **P2 Manager and HR** | Approvals 3.5, Daily roster 3.9, Directory 3.8, My team 3.10, Matrix 3.11 | Builds on P0 components; the employee fields (3.8) also complete Employee 360. |
| **P3 Planner** | 3.12 | Largest; needs new tables and capability; depends on slot vocabulary (X6) and capacity data. |
| **P4 Payroll and Vault depth** | 3.6, 3.7 | Depends on decisions D6-D8; PDF and ZIP need new libraries. |
| **P5 Header, notifications, mobile, QA** | X2, X8, Employee 360 data fill | Notification renderer is its own piece of work; mobile pass is per screen. |

Every phase ends with: typecheck and unit tests; grep gate (no hex, no `slate-`); the react skill checklist; desktop and 390 px screenshots against Stitch; real-flow checks through the gateway (the 2026-10-04 flow runs found two genuine bugs that unit tests missed); `docs/Architecture.md` and `docs/DB_model.md` updated; a `one_time` apply script plus dry run for any schema change, **each followed by the service-login policy sweep** (`apply_widen_service_login_policies.sql`).

---

## 5. Decisions needed before building

| # | Decision | Recommendation |
|---|---|---|
| D1 | Sidebar items Recruitment, Performance, Expenses, Helpdesk, Settings | Leave out (separate products). Add Announcements as a page; Tasks stays the cross-product link. |
| D2 | Live GPS map in the punch screen (needs a tile provider; coordinates leave the platform) | Show distance and geofence status without a map; add a map only if you accept the provider. |
| D3 | Break punch (out/in during a slot) | Skip; slots already model the gap between sessions. |
| D4 | New employee fields: grade/level, squad, cost centre, notice period, work mode, seat | Add (one schema version); they fill directory, 360 and dashboard. |
| D5 | Overtime and night differential/allowance: define and compute, or leave out | Define overtime as worked minutes beyond shift length per day; leave the monetary differential out until payroll depth (D6) is decided. |
| D6 | Payroll depth: PDF payslip, FY archive, bank card (small); TDS planning, Form 16, CTC projection, UTR tracking (large) | Build the small set; defer the large set. |
| D7 | Policy acknowledgements in the vault | Defer. |
| D8 | Raise upload limit 3 MB to 15 MB | Keep 3 MB until a streaming upload path replaces base64-in-JSON. |
| D9 | Planner scope: all of 3.12, or grid + cell edit + publish first, swap/WO desk and capacity donut second | Two steps. |
| D10 | Header global search | Build, capability-filtered. |

## 6. Left out on purpose (Stitch decoration with no real data behind it)
KYC "L4 verified", DigiLocker links, SHA-256 / HSM / KMS / ISO 27001 badges, "Biometric Geofence Validated" ticker, "Nexus Shield" audit lines, zodiac / donor / Slack handle fields, "Nexus Auto-Rule" as an approver name, hardware floor/desk beyond a seat label, device list and notification toggles (no sessions table; nothing consumes preferences).

---

## 7. Progress log

**2026-10-05 - decisions received:** D1, D2, D3, D5, D7 left out for now; D4 yes (columns on `hr.employee_profiles`); D6 small payroll set yes; D8 upload limit configurable up to 3.5 MB; D9 planner in two parts, in the side nav; D10 (header search) not yet decided.

| Item | Status | Notes |
|---|---|---|
| Employee fields (grade, squad, cost centre, notice period, work mode, seat) | DONE | Schema 1.66.0; edit form, directory, Employee 360 |
| Configurable document upload limit | DONE | 100 KB to 3.5 MB per branch; `hr.document_settings` |
| Roster planner part 1 | DONE | Grid, cell edit, shift pattern, requirements, publish |
| Roster planner part 2 | DONE | Day/Week/Month views, capacity donut, bulk reallocate, swap desk |
| Planner: weekly-off change requests | NOT BUILT | Needs a decision: ~12 places read `weekly_off_pattern` (attendance resolution, leave counting, reports); half-honouring an approval would misstate pay |
| Planner: notify on publish | NOT BUILT | Needs an HR renderer on the notification stream |
| Shared blocks (avatar, stat card, status pill, pagination) | DONE | `components/common` |
| Employee Directory | DONE | Server-side paging, filters, tab counts (fixes the old 20-row cap); today's shift, grade/squad, avatars |
| Dashboard | MOSTLY | Profile card, KPI strip, quick actions, leave donut, dated holidays. Missing: recent-activity log, per-slot punch log |
| Leave approvals hub | DONE | Summary cards, filter chips, decision ledger. Handover/attachment lines wait on Leave apply |
| Daily roster | MOSTLY | Six KPIs, shift column, punch source, presence donut, shift chips, paging. Missing: inline pending-exceptions panel, XLS export |
| Matrix report | MOSTLY | KPI strip, legend filter, search, paging, payable-of-days. Missing: PDF dossier, shift/level columns |
| Payroll (small set, D6) | DONE | KPI cards, FY archive tabs, payslip document (browser Save-as-PDF), bank card, breakdown bar. No TDS/Form 16/CTC by decision |
| Employee 360 / My profile | DONE structure | |
| Punch hub in-page (selfie/geofence panels, inline regularization) | DONE | Panel with live distance vs radius; inline form. No map (D2), no break punch (D3) |
| Timesheet KPI strip + view tabs | MOSTLY | Worked-vs-target and attendance-rate added. Missing: Detailed slot log / Shift regularization tabs, slot filter chips, night allowance (D5) |
| Leave apply page (handover, attachment, draft, history table) | DONE | Schema 1.67.0. Draft is browser-local by design. Slot-specific leave not built |
| Documents vault tabs / tax-proof panel / ZIP | DONE | Tiles, category tabs with counts, search, FY chips, tax-by-section summary, ZIP dossier (own + HR). No receipt number or declared target (needs columns) |
| My team: swap desk in page, leadership card | DONE | Ticket cards, sign-off progress, leadership card. No Nudge manager (needs a notification renderer) |
| Header search, notifications bell | DONE | Ctrl+/ pages + people; bell = live "waiting for you" counts (not an event feed: nothing stores HR events). Sidebar working-time and shift cards built (H12) |
| Mobile pass (12 Stitch mobile screens) | IN PROGRESS | Tab bar cut to 4 + More; header actions wrap; 390px overflow scan of every route |

Found along the way: the directory and the payroll draft picker both fetched only the default 20 employees (fixed); the dashboard greeting caused a hydration warning (fixed).

H12 (2026-10-05, no schema): dashboard Recent activity and Today's slots, sidebar working-time/shift cards, Timesheet Slot log and Shift regularization tabs, own-shift endpoint. Still open (needs schema review): slot-specific regularization/leave, persistent HR notifications.

**2026-10-06 - approved Stitch designs: Org chart and Roster planner (no schema, no new endpoints):**
- Org chart (`OrgChartShell`): desktop is now a top-down chart (avatar, name, title, department chip, direct-report count, expand/collapse per node, Expand all / Collapse all); phone (<768px) is an indented list with 44px rows. Search focuses a person (opens their ancestors, scrolls to and rings the card, clears a department filter that would hide them); department filter keeps the managers above matches (dimmed) so the tree stays connected. Headcount / levels / widest team are derived from the same org-chart rows. Same endpoint (`GET /hr/employees/org-chart`), same `hr.employees.view` page gate, profile links still behind `hr.employees.profile360.view`. "branch" goes through `useTerm`.
- Roster planner (`PlannerShell`): restyle only. Headcount card uses `StatCard`, shift cards show times and "Click to set number needed", avatars in the staff column, "Showing N staff members" footer, percentages in the capacity legend. Phone (<768px) week view is a day strip plus a tappable staff list for the picked day (the capacity cards follow the picked day); the table stays on desktop so e2e selectors (`tr`, `button[title="Change this day"]`, `#cm-to`, `#pm-*`, `#ra-*`, `#pb-note`) are unchanged. 44px taps on phone.
- Not built (needs a decision): org chart zoom/fit/fullscreen/minimap, Tabular view, Assign Report (changing a manager has no endpoint on this screen), Export Hierarchy, status dots, employee codes on cards (not in the org-chart payload, which is deliberately name/title/manager only), legend and "span-of-control" policy text. Planner: drag-and-drop assignment, conflict highlighting beyond the existing 11 h skip list, filter popover button, "view requirements" and "swap log" links, weekly-off requests (see above).

**2026-10-06 - Leave / Attendance administration (the two admin-web screens that render `@hr/web` shells):**
These two routes live in admin-web (`/admin/dashboard/leave/admin`, `/admin/dashboard/attendance/admin`) but render
`LeaveAdminShell` / `AttendanceAdminShell` from this package, so the Admin Stitch pass could not touch them.
Brought up to the same bar here (no schema, no endpoint, no capability change):
- Both section strips are now a real segmented control (`role="tablist"` + `aria-selected`) with 44px targets and
  `flex-1` on phones, dropping to auto width from `sm`. They were 26px high, below the audit's tap minimum.
- Leave > Policies: three derived counters (policies / active / tenant-wide) computed from the rows already loaded,
  and a card list under `lg` in place of the 860px table — on a 390px screen the Active chip, the column people scan
  for, sat off the right edge. The desktop table, `Create / revise policy` and `PolicyFormModal` are unchanged.
- Still on the old pattern (table with a `min-w` and sideways scroll under `lg`), in rough order of width:
  `GeoExceptionsManager` (820px), `ShiftsManager` (720px), `ShiftAssignmentsManager` (680px), `HolidaysManager`
  (480px). The container scrolls rather than the page, so the responsive audit passes; they are a design gap, not a
  defect.
