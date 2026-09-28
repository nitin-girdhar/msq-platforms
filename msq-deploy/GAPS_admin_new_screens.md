# `admin_new_screens` → UAT / PRD rollout gaps

Compared 2026-09-15: `admin_new_screens` against `PWA_changes` (what UAT was last
built from), plus `msq-deploy/.env-uat` / `.env-prd`.
Apply the same steps to **UAT first, then PRD**.

Branch delta:

| Repo | Commits beyond `PWA_changes` |
|---|---|
| msq-platforms | `13e0237` campaign types, `e92507e` arch docs, `05cad31` pwa infra (nginx) |
| msq-lms | `0720c82` campaign types (leads-service, meta-conversion-api, lms-web, meta-sync-scripts) |
| msq-hrms / msq-todo | none (same commit) |

The live server itself was **not** inspected (no SSH access from this machine). Run the
verification queries below on each server before and after.

---

## 1. Database: schema 1.48.1 → 1.50.2 (**blocking**)

New on the branch: `marketing.campaign_types`, `ext.meta_campaigns`, schema `scratch`
(`scratch.meta_pull_runs`, `scratch.meta_pull_leads`), altered `lms.lead_assignment_weights`
(PK becomes `(user_org_mapping_id, campaign_type_id)`), `ext.meta_page_form_org_map`,
`lms.marketing_leads`, `ext.ad_campaigns`, `ext.meta_tenant_config`, new RLS policies,
triggers and functions, and 4 new capabilities.

The init hook runs `db_scripts/00-10` **only on first boot**, and `apply_schema.ps1` re-runs
only 04-08 and 10. So an existing server needs the one_time scripts.

> ⚠ `db_scripts/one_time/*` is **gitignored**. These scripts exist only on this machine
> (`c:\Girdhar\MSquare\repos\msq-platforms\db_scripts\one_time\`). Copy them to the server
> or run them from here. They are not on the branch.

Run as `postgres` / `root_service`. Run each `_dryrun` first. **Order matters:**

| # | Script | Version | Notes |
|---|---|---|---|
| 0 | `SELECT version FROM public.schema_versions ORDER BY applied_at DESC LIMIT 5;` | — | Expect 1.48.0. Don't trust the row alone; check the catalog objects in §5. |
| 1 | `apply_campaign_types_dryrun.sql` → `apply_campaign_types.sql` | 1.48.1 + 1.49.0 | Structure, `admin_tenant_config_policy` on `ext.meta_page_form_org_map`, **the 4 capability nodes and role grants** (`reference_data/` is never re-run anywhere else). Writes the 1.48.1 and 1.49.0 version rows. |
| 2 | `backfill_campaign_types_dryrun.sql` → `backfill_campaign_types.sql` | 1.49.0 data | Types every existing lead/weight as tenant `sales`, then NOT NULL and the PK swap. Must come after #1. |
| 2b | `apply_schema.ps1 -File 04_functions_triggers.sql` | functions only | **Must come before #3.** `apply_scratch_lead_pull.sql` refuses to run without `entity.fn_org_tenant(uuid)`, which only 04 creates. 04 has no `scratch.*` references and runs in one transaction, so it is safe here. It also creates the 1.50.1 trigger and the 1.50.2 department rule. (Found by running it on the container on 2026-09-15.) |
| 3 | `apply_scratch_lead_pull_dryrun.sql` → `apply_scratch_lead_pull.sql` | 1.50.0 | `scratch` schema + USAGE for `app_user, tenant_admin, root_service, lms_svc, meta_svc`, tables, indexes, RLS. Without it, every `/meta/lead-pull` route returns 500 (`relation "scratch.meta_pull_runs" does not exist`). |
| 4 | `alter_scratch_apply_queued_dryrun.sql` → `alter_scratch_apply_queued.sql` | 1.50.1 (CHECK part) | Widens the status CHECK to `apply_queued`. **Run before the new meta-conversion-api image is deployed**, or the first Apply fails with a 23514 error and a 500. |
| 5 | `apply_schema.ps1 -DbHost <server>` (or `-File` for 05, 06, 07, 08, 10) | views/indexes/grants/RLS | **Only after #3 and #4**: 06, 07 and 08 reference `scratch.*`. 05 and 10 don't, and can run any time after 2b. `lms.marketing_leads` RLS (08) calls `lms.fn_user_sees_campaign_type` from 04. |
| 6 | `INSERT INTO public.schema_versions (version, description) VALUES ('1.50.2', '…') ON CONFLICT DO NOTHING;` | 1.50.2 | **No script writes this row.** Copy the description from `09_schema_version.sql`. (#4 already writes `1.50.1`.) |
| 7 | `audit_cross_tenant_weights_dryrun.sql` | read-only | Any rows returned are weights pointing at another tenant's type. Decide delete or re-point case by case. |
| 8 | `report_weight_department_mismatch_dryrun.sql` | read-only | Weights that break the department rule. They're kept, but the picker skips them, so those leads arrive unassigned (`no_department_match`). Fix the role's department or the weights, then run lookup-admin → *Re-run auto-assignment*. |

### Applied: `msq-db-server` container (`.env-uat` credentials), 2026-09-15

This DB's version row said 1.45.0 when it started. The catalog confirmed **1.46.0 and 1.48.0
were never applied**, and 1.47.0's table existed but had no version row. **Expect the same on
prod: run the dry runs for these first.**

Backup: `pg_dump -Fc` at `/tmp/bk/platforms_pre_1_49_20260915_142521.dump` in the container,
and a copy in the Claude session scratchpad.

Order actually run, all exit 0:

1. `apply_admin_team_notify_capability.sql` (1.46.0): 1 capability, 8 grants
2. Data fixes. **Prod will likely need the same two; check the dry runs:**
   - duplicate emails: the inactive `jatinnirwan1410@gmail.com` (019ff0e8…) was renamed to `jatinnirwan1410+dup-019ff0e8@gmail.com`. The active `Jatinnirwan1410@…` account was then lowercased by 1.48.0.
   - tenant *MSquare Professionals* had no `sales`/`hr` departments. Both were inserted with the values `10_tenant_provisioning.sql` uses. Without them `backfill_campaign_types.sql` aborts (dry run §7a).
3. `apply_email_lowercase.sql` (1.48.0)
4. `apply_campaign_types.sql` (1.48.1 + 1.49.0)
5. Missing `1.47.0` version row inserted. The structure was already complete per its dry run.
6. `backfill_campaign_types.sql`: md5 of (lead id, assignee) was identical before and after for 2,944 leads. The 36 weights were unchanged.
7. `04_functions_triggers.sql` (needed before step 8)
8. `05_views.sql`, `10_tenant_provisioning.sql`, `apply_scratch_lead_pull.sql` (1.50.0)
9. `alter_scratch_apply_queued.sql` (1.50.1) → `06_indexes.sql` → `07_grants.sql` → `08_rls.sql`
10. `1.50.2` version row inserted
11. Audits: cross-tenant weights **0 rows**, department mismatch **0 rows**

Verified: all 4 new tables exist; 5 capabilities; 0 untyped leads and weights; composite PK;
tenant-match trigger present; `admin_tenant_config_policy` on `meta_page_form_org_map`;
`scratch` USAGE for `lms_svc` and `meta_svc`; `idx_meta_pull_runs_claimable` covers
`apply_queued`; `lms_svc` is named in the policies on all 5 touched tables; each tenant has
`sales*` (default) and `hiring`.

### Applied: real UAT database (182.77.62.176:5432, `.env-uat` credentials), 2026-09-15

The screens at apps-uat.fitclass.in/sa/dashboard/meta-campaigns and /meta-mappings said
"unavailable". The gateway and lookup-admin were already the new build: new routes returned
401 unauthenticated, not 404. The UAT **database** had none of the 1.48.1+ objects, so
meta-conversion-api failed behind the gateway.

- Started at **1.48.0**. 1.46.0–1.48.0 had been applied properly (3–14 Sep). No duplicate emails.
- Backup: `uat_platforms_pre_1_50_20260915_201037.dump` (6.5 MB, Claude session scratchpad).
- Data fix: `sales` + `hr` departments for *MSquare Professionals* (same blocker as local).
- Chain, all exit 0: `apply_campaign_types` → `backfill_campaign_types` → `04` → `05` → `10`
  → `apply_scratch_lead_pull` → `alter_scratch_apply_queued` → `06` → `07` → `08` → 1.50.2 row.
- Backfill fingerprint identical: 4,557 leads, 48 weights.
- Verified: same checks as the local run, all pass; `ext.meta_campaigns` seeded with 4 rows.
- Audits: cross-tenant **0**. Department mismatch **1 open**: `admin-ggn-sec47@fitclass.in`
  (role Admin, dept Admin) has weight 20 in the **Sales** pool at *Gurugram - Sector 47*. The picker
  now skips it. Fix the role's department or move the weight, then run *Re-run auto-assignment*.

- Known, **left as-is by decision (2026-09-15)**: `ext.meta_page_form_org_map` row for page
  `1158185014038324` has tenant *Fitclass* but org *Gurugram - Civil Lines* (*MSquare
  Professionals*). It was a misconfiguration. Its 459 leads (12 Jul–24 Aug) and campaigns
  `120248869074500615` / `120249033631950615` stay under MSquare. It is the only tenant/org
  mismatch among UAT's 25 mappings. Don't "fix" it during the prod rollout; check prod for its
  own mismatches separately.
- **Fetch campaigns on UAT fails** with "No ad accounts configured": the only integration is the
  shared (`tenant_id NULL`) row, and its new `ad_account_ids` is `{}`. That doesn't fit the
  shared-app, page-routed model. Proposed fix: find ad accounts via `/me/adaccounts`, and pick the
  tenant from each campaign's `adsets{promoted_object}.page_id` via the page map. Not implemented
  yet; the lead path is unaffected.

⚠ **UAT Postgres 5432 is reachable from the public internet.** README §Verifying says only
80/443 should be open. Docker's published `0.0.0.0:5432` bypasses ufw. Close it (bind to
`127.0.0.1` in compose, or firewall in `DOCKER-USER`) once the rollout is done.

## 1b. Database: schema 1.50.2 → 1.51.0 — Meta lead routing (**blocking**, after §1)

Applied and verified on the local container 2026-09-26. Run as `postgres`/`root_service`, dry run first:

| # | Step | Notes |
|---|---|---|
| 1 | `one_time/apply_meta_routing_1_51_dryrun.sql` | Lists the keywords that become rules (and the excluded `hr`/`job`/`trainer`), the `ext.meta_campaigns` rows whose fallback type is cleared, the count of `initial` log rows to backfill, the ad accounts seeded, and page mappings whose tenant ≠ branch tenant (UAT: page `1158185014038324`). |
| 2 | `one_time/apply_meta_routing_1_51.sql` | Tables, columns, backfills, 1.51.0 version row. **gitignored like the rest of `one_time/`** — copy it over. |
| 3 | `apply_schema.ps1` (04–08, 10) | Functions (rule matcher, INSERT log trigger, reason-clearing trigger), indexes, grants, RLS, provisioning seed. **Before** deploying images. |
| 4 | Deploy leads-service → meta-conversion-api → api-gateway → lookup-admin | |

Then, per environment:
- **Meta Ad Accounts** → *Sync from Meta*, enable the accounts to walk (token needs `ads_read`; the system user must be assigned the accounts). Then **Fetch campaigns** per tenant.
- **Campaign Types & Rules** → review the migrated rules per tenant; add your naming prefixes (e.g. `HIR`).
- **HR roles**: give the HR-department role(s) LMS capabilities and Hiring weights per branch, or every hiring lead stays unassigned (`no_weighted_users`).
- Page `1158185014038324` (tenant Fitclass, branch in MSquare): the campaign fetch attributes by these rows — decide before enabling the fetch on UAT/PRD.
- New optional env (meta-conversion-api): `META_CATCHUP_INTERVAL_HOURS` (default **6**, `0` disables), `META_CATCHUP_WINDOW_DAYS` (default 3).
- **Python `meta-sync-scripts`**: NOT yet removed. Confirm on UAT/PRD (`crontab -l`, `docker ps`) that nothing runs them, then retire the folder — they bypass RLS and route differently (no LMS-capability check, no test-lead filter, no rules).

### Applied: real UAT database (182.77.62.176:5432, `.env-uat` credentials), 2026-09-26

- Started at **1.50.2**; the 1.50.x objects were confirmed in the catalog (apply_queued CHECK, weights trigger, `fn_campaign_type_usage`, `meta_svc` scratch USAGE), not only the version row.
- Backup: `uat_platforms_pre_1_51_20260926_184722.dump` (6.5 MB, Claude session scratchpad; `pg_restore -l` reads it).
- Dry run matched local: 10 keywords → rules per the two tenants (`hr`/`job`/`trainer` excluded), 0 campaign rows to clear, **1,928** `initial` log rows to backfill, 0 ad accounts to seed, page `1158185014038324` still the one tenant/branch mismatch.
- Chain, all exit 0: `apply_meta_routing_1_51.sql` → `04` → `05` → `06` → `07` → `08` → `10`.
- Verified: version 1.51.0; 5 rules per tenant; the 4 new triggers and 4 functions; RLS forced on all new tables (`meta_ad_accounts` with 0 policies and no `app_user` grant); `lms_svc` named on the rule policies; matcher types `Recruitment_Drive` as hiring and nothing for `Personal_Trainer_Sale`; 0 assigned leads without a log row.
- **Service images NOT yet deployed.** The running (old) images keep working on this schema; deploy leads-service → meta-conversion-api → api-gateway → lookup-admin next.

## 2. Images to rebuild and deploy

All built from `admin_new_screens`, **after DB steps 1–5**:

- **api-gateway**: new `/campaign-types*`, `/users/campaign-type-catalog`, and `/meta/*` super-admin routes (`superAdminGuard`)
- **identity-service**: users/org-mapping/weights by campaign type, with department validation; `/users/role-catalog` now returns `works_leads` per role (holds `lms.leads`). The rebuilt team-web reads this flag to hide the lead-weight and lead hand-over UI for non-lead roles. Deploy order doesn't matter: against an old identity-service the flag is missing and the UI behaves as before, showing weights for every role.
- **lookup-admin**: new screens Meta Campaigns, Meta Mappings, Lead Pull, Re-run Assignment
- **leads-service**: campaign-types API, reclassify, assignment rerun, intake typing
- **meta-conversion-api**: campaigns sync/confirm, page-org-map, pages, lead pull. **Now runs a background poller** (`workers/pull-poller.ts`).
- **lms-web**: campaign type in leads grid, history, dashboard and export
- auth-web / hr-web / todo-web / admin (team-web): only the shared `ui` / `team-web` packages changed (`OrgAssignmentsField`, Create/Edit User modals). Rebuild the images that bundle `@platform/ui` or `team-web`.
- **meta-sync-scripts** (Python, if they run on the server/cron): `lead_writer.py`, `campaign_resolution.py`, `sync_campaigns.py` changed. Redeploy them, or they will keep writing untyped leads and use the old picker.

## 3. Env vars: `.env-uat` vs the branch

All new vars are **optional, with defaults in code**. None are in `.env-uat`, `.env-prd`, or
either `.env.example`. Nothing blocks startup. Add them only to tune:

| Var | Service | Default | Present in .env-uat / .env-prd |
|---|---|---|---|
| `GATEWAY_META_ADMIN_TIMEOUT_MS` | api-gateway | 120000 | no / no |
| `META_LEADS_RECLASSIFY_TIMEOUT_MS` | meta-conversion-api | 60000 | no / no |
| `META_LEAD_PULL_POLL_INTERVAL_MS` | meta-conversion-api | 10000 | no / no |
| `META_LEAD_PULL_MAX_PAGES` | meta-conversion-api | 50 | no / no |
| `META_LEAD_PULL_STALE_MINUTES` | meta-conversion-api | 15 | no / no |

Keep `GATEWAY_META_ADMIN_TIMEOUT_MS` greater than `META_LEADS_RECLASSIFY_TIMEOUT_MS`. Also
check the docker-compose that passes env to containers: if it uses an explicit `environment:`
list rather than `env_file`, these vars won't reach the container. That's only a problem if
you set them.

`.env-uat` and `.env-prd` have the same key set, so there's no key drift between them.
No compose or Dockerfile changes on the branch.

## 4. nginx (host config, not in any image)

From `05cad31`. **UAT:**

```bash
sudo cp infra/nginx/snippets/connection-upgrade.conf /etc/nginx/conf.d/
sudo cp infra/nginx/snippets/msq-pwa.conf            /etc/nginx/snippets/
# remove the old hand-added `map $http_upgrade $connection_upgrade` from nginx.conf's http{} block,
# otherwise nginx -t fails with a duplicate map
sudo cp infra/nginx/apps-uat.conf infra/nginx/api-uat.conf /etc/nginx/sites-available/
sudo nginx -t && sudo systemctl reload nginx
```

Changes: `server_tokens off`, HSTS (apps gets `includeSubDomains`, api does not), gzip for
JS/CSS/JSON/manifest, and the PWA cache policy (`/sw.js` no-store, manifest 5 min,
`/icons` 1 day, `/offline` no-cache).

**PRD:** `apps-prd.conf` / `api-prd.conf` are **new files**. Diff them against the live prod
site config before swapping. Enable only the `-prd` pair on the prod box (both `api-*.conf`
declare `upstream api_gateway`).

⚠ HSTS `includeSubDomains` on `apps.fitclass.in` covers only its own subdomains, not
`fitclass.in` siblings. It's still irreversible for a year for those hosts, so confirm
nothing under `*.apps.fitclass.in` is plain HTTP.

## 5. Verify on each server

```sql
SELECT to_regclass('marketing.campaign_types'), to_regclass('ext.meta_campaigns'),
       to_regclass('scratch.meta_pull_runs'),   to_regclass('scratch.meta_pull_leads');   -- none NULL
SELECT key FROM iam.capabilities
 WHERE key IN ('lms.campaign_types','lms.campaign_types.view','lms.campaign_types.manage','lms.leads.view.all_types'); -- 4 rows
SELECT count(*) FROM lms.lead_assignment_weights WHERE campaign_type_id IS NULL;  -- 0
SELECT tgname FROM pg_trigger WHERE tgname = 'trg_lead_assignment_weights_tenant_match'; -- 1 row
SELECT polname FROM pg_policy WHERE polrelid = 'ext.meta_page_form_org_map'::regclass;  -- includes admin_tenant_config_policy
SELECT has_schema_privilege('lms_svc','scratch','USAGE'), has_schema_privilege('meta_svc','scratch','USAGE'); -- t, t
```

Also audit role grants with `iam.fn_role_capability_matrix`: a denied parent capability
disables its whole subtree.

```bash
H=apps-uat.fitclass.in
curl -sI https://$H/sw.js | grep -i cache-control        # exactly one: no-store
curl -sI https://$H/lms | head -1                        # 200
```

App smoke test (super_admin in lookup-admin): Meta Campaigns → Fetch, Meta Mappings list,
Lead Pull → create run → Apply (should return 202 and then complete), Re-run assignment dry run.
Tenant user: create/edit user → per-campaign-type weights shown only for the role's department.
