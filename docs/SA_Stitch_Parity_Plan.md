# Super Admin (lookup-admin) — Stitch redesign

Source: Stitch project "Super Admin Screens" (`8904403738887121637`). Six designed screens; the seven untitled
`image.png` captures are reference shots of the current app.

Scope (agreed 2026-10-05): the designed screens plus the shell/tokens. Gate per page. Pure mock-up decoration is
dropped; every functional invention is listed at the gate for accept/reject.

| # | Screen | Route | Status |
|---|--------|-------|--------|
| 1 | Meta Ad Accounts | `/dashboard/meta-ad-accounts` | Built incl. additions; awaiting gate |
| 2 | Meta Page Mapping (+ New Mapping modal) | `/dashboard/meta-mappings` | Built, awaiting gate |
| 3 | Meta Campaign Mapping & Classification | `/dashboard/meta-campaigns` | Built, awaiting gate |
| 4 | Meta Lead Pull + Staged Leads review | `/dashboard/lead-pull` | Built, awaiting gate |
| 5 | Capability Matrix (desktop drilldown + mobile) | `/dashboard/capabilities/matrix` | Built, awaiting gate |

## Shared pieces
- `components/meta-nav/MetaTabs.tsx` — the five-tab Meta pipeline strip (built on `PageTabs`), used by pages 1–4 and
  the Lead Inbox. Routes unchanged.
- Pages use `PageHeader` / `PageBody` / `Alert` / `Button` from `@platform/ui-kit` and theme tokens only.

## Gate 1 — Meta Ad Accounts
Built: tab strip, header + Sync action, search, All / Walk Enabled / Disabled filter chips with counts,
status badges, footer count. No API or capability change (same `/meta/ad-accounts` calls, same gateway guards).

Added after the gate-1 review (2026-10-05, user approved all four):
- **Bulk enable/disable**: row checkboxes + select-all, a bulk bar (Enable walk / Disable walk / Clear). New
  `POST /meta/ad-accounts/bulk` (gateway `withSuperAdmin` -> meta-conversion-api, `RANKS.SUPER_ADMIN`, ids
  validated `act_<digits>`, max 500), one UPDATE on the platform-level table via `withServiceTx`.
- **With Errors filter + Fetch result column**: schema **1.69.0** adds `ext.meta_ad_accounts.last_error` /
  `last_error_at`. The campaign fetch writes them when an account's walk fails and clears them on the next clean
  walk. Existing DBs: `db_scripts/one_time/apply_ad_account_errors_dryrun.sql`, then `apply_ad_account_errors.sql`.
- **Check token permissions**: `GET /meta/ad-accounts/token-permissions` calls Graph `/debug_token` on the shared
  token and returns validity, expiry, granted scopes and the required ones that are missing (ads_read,
  leads_retrieval, pages_show_list, pages_read_engagement). The token is never returned. Shown as ONE panel, not
  a per-row column: scopes belong to the token, not to an ad account, so a per-row column would repeat one value.
- **Footer**: "Trigger Lead Pull" and "Next: Page & Branch Mapping" are plain links (no action is triggered).

Not built (pure decoration): Webhook/Token-health chips, scheduler text, Graph API version, stage-1/2/3 cards.
Deploy order: apply the SQL, then rebuild meta-conversion-api, api-gateway and lookup-admin images (the new
columns are read by the list query, so the SQL must land first).

## Gate 5 — Capability Matrix
Rebuilt as `CapabilityMatrixShell` (the old `CapabilityMatrixClient` is gone). Resolver, staging and save logic are
unchanged: `resolveCapabilityMatrix` / `ownGrantsByKey` from `@platform/rbac`, `capabilitiesApi.putGrants`, and the
`superadmin.*` subtree still hidden for roles below super_admin (admin-service remains the boundary).
- Department chips (departments that hold an active role) -> role chips -> effective-access bar (granted / total
  operations and scopes the role would hold once saved).
- Three-pane drilldown: Tools -> Modules/Pages -> Operations & Scopes, each pane searchable; Allow all / Deny all on
  the visible rows. Tools whose operations hang directly off the tool get one synthetic "Direct operations" module.
  Below `lg` the same data is an accordion (tool -> module -> operations), as in the mobile design.
- Grant/Deny ✓/✕ and Allow all / Deny all at ALL THREE levels (tool, module/page, operation/scope). Tool and page/tab
  grants are navigation grants: a page follows its tool, so granting a tool turns its pages on but never its
  operations (those never inherit); denying a tool or page switches off everything beneath it (shown as Blocked).
- Staged-changes banner (latest change, Discard, Review & Save). Review opens a modal listing from -> to; saving is
  still one `putGrants`. Changing a row back to its saved state drops it from the staged set.
- Rules table (desktop): search, All / Granted / Inherited / Explicit Deny / Modified filters, origin text, quick
  Grant/Deny, Export Matrix (CSV of every operation and scope with its state).
Helpers: `src/lib/capability-tree.ts`. Components: `components/capabilities/*`.

Deviations from the design (for decision):
- No "~" (clear to inherit) quick toggle: the grant API only takes true/false.
- Dropped as decoration or without data: members count, "Inherits <role>", Audit Trail, Policy Sync/schema chip,
  the invented constraint expressions (`team:eq($user.team_id)`) — the capability description is shown instead.
- Tenant stays in the top-bar switcher (not a chip on this page), same as every Super Admin screen.
- The design's own left navigation (Tenant Settings, Audit Logs, API Keys, Directory Sync, Compliance) is not built;
  the platform shell is used.
- The rules table is hidden on phones.

Staging rule (fixed 2026-10-05): a change is dropped from the staged set only when it matches the role's own SAVED row,
or, with no saved row, what a row-less node resolves to right now (a page/tab follows its parent as staged; anything
else is off). Comparing with the saved resolution lost a deny on a page whose tool was being granted in the same batch.

## Gates 2-4 — Meta Page Mapping, Campaign Mapping, Lead Pull (2026-10-05)
All Meta pages (and the Lead Inbox) now share `PageHeader` + the five-tab `MetaTabs` strip, token-only styling
(`components/meta-*`, `lead-pull` were migrated off hex / `slate-*`), and previous/next footer navigation.

**Page Mapping**: stat cards (total / page-level / form overrides / inactive, computed from the rows), search,
All / Page-Level / Form-Level chips, branch filter, a truthful routing-precedence note (a lead with no mapping lands
in the Lead Review Inbox, NOT a "tenant default" as the mock-up says), Export CSV (client-side), footer links.
The New/Edit modal already had every field in the design; labels aligned ("Facebook Page", "Target Branch",
"Create Mapping"). AG Grid kept.
**Campaign Mapping**: three stacked tables became tabs (Needs Confirmation / Needs Mapping / Confirmed & Routed) with
a stat strip computed from the rows, last-sync time, a "last fetch" result panel (warnings with a "Resolve in Page
Mapping" link) moved out of the button, search + promoted-page filter, a Confirm All Filtered bar (the
"pick a type for EVERY row" guard is unchanged) and "Rule Engine Settings" linking to Campaign Types.
**Lead Pull**: layout only (header, tabs, alerts, footer). Polling, apply queue, remap and the verdict grid are
untouched.

Not built (need a decision / backend):
- Page Mapping: Token Health column and "Validate Page Tokens" (per-page Graph check); "Unmapped Inbound" stat
  (needs an inbox count call); per-row "bolt" quick action.
- Campaign Mapping: "Archived Campaigns" tab and per-row hide (no archive state exists); row selection checkboxes
  and "Auto-assign via Rules" (Confirm All on Needs Confirmation already accepts the suggestions); the Rule Engine
  slide-over (the real rules live on Campaign Types, linked instead); "Dismiss non-blocking" warnings.
- Lead Pull: "Apply Selected Leads" (Apply takes the whole run), "Discard Batch" (no delete endpoint; a new pull
  replaces the run), "Export Staged CSV", "Pull History Logs", the Graph rate-limit and webhook-health chips.
Verified locally as root@root.com on the MSquare tenant. The Fitclass tenant (27 mappings) is not reachable from that
login, so the Page Mapping grid was not seen with rows; its columns and renderers are unchanged apart from tokens.

## Schema 1.70.0 — the deferred actions, now built (2026-10-05)
Tables: see `DB_model.md` ("Schema 1.70.0"). Existing databases: `db_scripts/one_time/apply_meta_console_1_70_dryrun.sql`
then `apply_meta_console_1_70.sql` (adds the columns, the two tables, grants, RLS, the history trigger and seeds history from
the run that exists). Deploy order: SQL first, then meta-conversion-api, api-gateway and lookup-admin images.

| Feature | Where | Notes |
|---|---|---|
| Token Health column + Validate Page Tokens | Page Mapping | `POST /meta/pages/health/validate` checks, per mapped page, that the shared token still holds a page token and that the app is subscribed (`/{page}/subscribed_apps`); result stored in `ext.meta_page_health`. Chips: Subscribed / Not subscribed / Token expired (Meta code 190) / No page token / Check failed / Not checked. No token is stored or returned. |
| Unmapped Inbound stat | Page Mapping | Open `unmapped` rows in `ext.meta_lead_inbox` for the tenant plus the tenant-less ones. No new endpoint. |
| Archived tab, Hide / Restore | Campaign Mapping | `POST /meta/campaigns/archive`. Visibility only: an archived campaign keeps its type and keeps routing; fetches never un-archive. |
| Row checkboxes + bulk bar | Campaign Mapping | Confirm Selected (needs a type on every selected row) and Hide / Restore Selected. |
| Rule Engine slide-over | Campaign Mapping | Lists the tenant's ordered rules (first match wins), reorder with Save Rule Order (existing `PUT /campaign-types/rules/order`). Adding / editing rules stays on Campaign Types, where a pattern can be tested. |
| Apply Selected Leads | Lead Pull | `POST /meta/lead-pull/runs/:id/selection`. Ticks live on `scratch.meta_pull_leads.apply_selected`; unticked rows stay pending for a later Apply. Apply count = importable AND ticked. |
| Discard Batch | Lead Pull | `POST /meta/lead-pull/runs/:id/discard` (completed or failed runs only): status `discarded`, staged leads deleted. |
| Export Staged CSV | Lead Pull | Client-side from the staged list. Contact details are never part of that list, so the file has ids, form, branch, verdict, reason and the Apply tick only. |
| Pull History Logs | Lead Pull | `GET /meta/lead-pull/history`, from `ext.meta_pull_run_history` (summary only). |

Verified locally (root, MSquare tenant): archive/restore, selection untick-all / tick-one, discard (+ second discard 409),
history trigger followed the run to `discarded`, validate on a tenant with no mappings returns an empty list. NOT exercised:
Apply with a partial selection (it would import real leads), and Validate Page Tokens against Meta (no mapped pages on
this tenant; Fitclass is not reachable from this login).

## Part 1 of the second batch — Lookups, CAPI, Catalogs, Campaign Types, Users, Branding, Modules (2026-10-06)
Layout/chrome only; every endpoint, gateway call and save path is unchanged. All pages use `PageHeader` / `PageBody`, theme
tokens, 44px taps below `sm`. The SA shell and the top-bar tenant switcher are untouched.

| Screen | Route | Built |
|---|---|---|
| Lookups generic editor + Lead Stages | `/dashboard/lookups/[table]` | Header with Back, "Manage CAPI event mapping" (lead-stage) and New; search + chips (All / Active / Inactive; lead-stage: All / Active / Terminal / Requires follow-up), counts computed from the loaded rows; lead-stage stat cards (active/total, follow-up gates, terminal). AG Grid, Create/Edit modals unchanged. |
| CAPI Event Mapping | `/dashboard/lookups/lead-stage/capi-events` | Header with Save, mapped-stages stat, unmapped list. Same GET/PUT. |
| Catalog Versions | `/dashboard/catalogs` | Header with behind-count, All / Behind-current-only chips, desktop matrix, phone cards per tenant (`CatalogVersionsView`). |
| Campaign Types & Rules | `/dashboard/campaign-types` | Two columns on desktop (rules + tester left, types right). Same calls. |
| Users | `/dashboard/users` | People / Reporting lines switch kept (44px); Reporting lines uses the page header. People is the shared `@platform/team-web` TeamShell and keeps its own header (shared package, not edited here). |
| Tenant Branding directory | `/dashboard/branding` | Search, All / Active / Inactive chips, initial tile (`TenantBrandingDirectory`). |
| Tenant Branding (per tenant) | `/dashboard/tenants/[id]/branding` | Page header, same five cards and the same save bar; save/upload/rotate logic untouched. |
| Tenant Modules | `/dashboard/tenants/[id]/modules` | Header with Save and "n / 4 active"; same checkboxes and disable confirmation. |

Dropped as decoration: cluster/version chips, Audit Log / Audit Spec / Dispatch Audit buttons, pipeline banner, Meta CAPI health,
gateway/webhook/pixel cards, dispatch stream, test-event code, topology diagram, Push Token Bundle, sparklines, usage caps.

Needs a decision (no backing data or endpoint today): CAPI "New event mapping"/Test Connection/last-fired/payload/dedup columns
(the map table holds stage -> event type only); Lead Stage drag-reorder, colour dot, per-row quick actions; Branding directory stat
cards (branded / default / locked counts need a per-tenant branding list endpoint), per-tenant "Updated by", primary-theme swatch,
Push Token Bundle, New Tenant Branding, and the live preview panel; Modules Config / Request License / usage sparklines / fifth module;
Users Bulk Import, Active-accounts chip, filters inside the shared TeamShell; Campaign Types per-rule "state" toggle exists (Active),
rank drag, Audit Spec.

Bug fix in the same batch: `GET /lookups/lead-stage-capi-events` returned 500 (permission denied for table
lead_stage_capi_event_map). Cause: leads-service runs as the NOINHERIT login `lms_svc`; the table, `ext.meta_capi_event_types` and the
two views were granted to `app_user` only. Fixed in `07_grants.sql` (schema 1.71.0); `app_user` also gains DELETE (clearing a stage's
event is a real delete). Existing databases: `db_scripts/one_time/apply_capi_event_map_grants_dryrun.sql`, then
`apply_capi_event_map_grants.sql`. No image rebuild is needed for the fix.

## Part 2 — Platform / Module consoles, Re-run Assignment, Lead Inbox (2026-10-06)
Designs: `super-admin-platform-console`, `super-admin-lms-module-console`, `super-admin-re-run-auto-assignment-desktop`,
`super-admin-meta-lead-inbox-desktop` (+ the four 390px variants). No API, gateway guard or confirm flow changed.

- **Platform home + Module consoles** (`/dashboard/m/[module]`, `components/console/ModuleConsole.tsx`): the flat card grid is now
  grouped into sections (Platform: Tenant Management & Licensing / Lookups & Taxonomy; LMS: Meta Lead Pipeline & Integrations /
  Operations & Allocation / Pipeline Taxonomy & Lookups). Unlisted cards fall into the module's last section, so nothing can go
  missing. Section chips (All / each section, counts computed) and a client-side Filter box narrow the view only. Every card is
  still a link (e2e `main a[href*=...]` counts unchanged). `/dashboard` still redirects to `/dashboard/m/platform`.
- **Re-run Auto-Assignment**: `PageHeader` + three numbered panels. 1 Scope and filters (branches, campaign types), 3 Confirm
  and execute (Preview / Assign N leads / Start over; same preview-then-assign gating, same cursor/batch logic), 2 Impact (the
  existing preview/result as four stat tiles + the by-branch table with reasons). The 3-step layout is supported because the
  existing dry-run returns exactly these figures.
- **Meta Lead Inbox**: stat tiles (counts by reason, computed from the loaded rows), Open / Resolved / Ignored segmented control
  (same state as the old select), client-side search, reason badge, "Showing n of m" footer. Retry / Ignore / Refresh and scope
  select unchanged.
- **Shell**: no change needed — `layout.tsx` already renders `AppShell` (mobile drawer, neutral tenant switcher); tenant logos
  in the header from the mock-ups are not built (the tenant NAME is, per Part 3 below).

Not built (needs a decision / backend): KPI tiles on the consoles (tenant, hub, catalog counts, webhook-form counts, queue
velocity — no summary endpoint); per-card record counts; "Inspect Pipeline Graph", "Trigger Batch Assignment" shortcut,
Flush Cache, Re-index, Export DDL, New Lookup Entity, Audit Logs; Re-run: date/ingestion window, "unassigned condition" filter,
pipeline picker beyond campaign types, simulated per-counselor distribution, zero-weight guardrail list, historical re-run log
and Download CSV (no run history store); Inbox: Bulk Route / Bulk Dismiss, per-row Sanitize / Re-auth / Re-route actions,
date-range filter, rows-per-page pagination, retry-rate and tenant-mismatch tiles, "Pipeline Specs" footer.

## Part 3 — The acting tenant is named on every tenant-scoped screen (2026-10-06)
Layout only; no API, gateway guard, capability or SQL change.

**Why.** Every SA screen acts on the SESSION's tenant (`src/lib/tenant-scope.ts`, since the SA-only tenant cookie was
removed), and login always re-mints the session into the user's HOME tenant (`auth.service.ts` signs
`tenant_id: db_user.tenant_id`). A super admin who switched tenant, edited a catalog, then logged back in therefore
landed on a *different* tenant's rows — which reads exactly like an edit that silently failed to save. Reported against
Campaign Types, where the seeded `sales`/`hiring` types and the five starter `hiring` rules reappeared and the new rows
seemed to vanish. Nothing was lost: writes are fenced per tenant (`tenant_id NOT NULL`, `eq(tenantId, ctx.tenant_id)` on
every mutation, RLS on top), so they were simply off-screen under the other tenant.

The navbar `BranchSwitcher` chip does name the tenant, but it sits far from the data and drops the tenant name whenever
the branch name already starts with it — i.e. precisely in the home-tenant case.

- **`PageHeader` gains `scope?: string | undefined`** (`packages/ui/src/components/page/PageHeader.tsx`) — rendered as a
  chip beside the `<h1>`, not in `subtitle`, because every SA screen already uses `subtitle` for row counts or routing
  explanations. The title truncates before the chip does, and the chip is capped at `8rem` / `14rem` (sm) so a long tenant
  name cannot widen the title row on a phone.
- **`getSelectedTenantName()`** joins `getSelectedTenantId()` in `src/lib/tenant-scope.ts`. It costs nothing: it reads
  `session.tenant_name` off the same request-cached `/auth/me`, and `/auth/me` resolves the name from the TARGET org's
  tenant (`auth.repository.ts` `findUser`: `tgt.tenant_id`, `t.name`), so it always agrees with the id across a
  cross-tenant switch.
- **Wired on all ten tenant-scoped routes**: campaign-types, meta-campaigns, meta-mappings, meta-lead-inbox, lead-pull,
  lead-assignment-rerun, lookups/[table], lookups/lead-stage/capi-events, capabilities/matrix, users. Each page resolves
  the name and the component owning the header forwards it as `scope`.
- **Deliberately unchipped**: the "Pick a tenant in the top bar" empty states (no tenant to name); `lookups/[table]` when
  `config.scope` is neither `tenant` nor `org` (those rows are platform-wide); the Lead Inbox with no tenant selected (it
  is showing the tenant-less rows, so naming the home tenant would mislead).
- **`users`**: `TeamShell` takes `tenantName` for the chip and `scopeLabel` now carries the branch alone, so the subtitle
  reads `12 people · all branches` instead of repeating the tenant. The page also drops its `fetchTenants()` round-trip,
  which existed only to look up a name the session already had.

Not changed (raised, user deferred): persisting the last-selected tenant across login, so a super admin resumes where
they left off; and making `uq_campaign_types_tenant_name` partial on `NOT is_deleted` — today a soft-deleted type's key
is burned and cannot be re-created.
