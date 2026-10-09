# db_scripts

The complete definition of the MSquare platform database: one schema, one
deploy, all four products (core/LMS, HR, tasks, Meta integration).

```powershell
.\db_deploy.ps1                     # production shape: schema + reference data
.\db_deploy.ps1 -IncludeDummyData   # + demo tenants, users and leads
```

## Layout

| | |
|---|---|
| `00_extensions_schemas_roles.sql` | Extensions, schemas, every database role |
| `01_functions_shared.sql` | Functions used in column `DEFAULT`s |
| `02_tables_core.sql` | `geo` `entity` `iam` `lms` `marketing` `audit` `ext` `comms` `notify` |
| `03_tables_product.sql` | `hr` `task`, per-product RBAC, catalog engine |
| `04_functions_triggers.sql` | Business logic, resolvers, every trigger |
| `05_views.sql` | All views |
| `06_indexes.sql` | All indexes |
| `07_grants.sql` | All privileges |
| `08_rls.sql` | Row-level security |
| `09_schema_version.sql` | Version history |
| `10_tenant_provisioning.sql` | `entity.provision_tenant()` and friends |
| `reference_data/` | Required by every deployment |
| `dummy_data/` | Demo data for local development only |
| `tools/` | Operator scripts, run on demand |

### Why the split is by object type

The order is not cosmetic; each file sits where a dependency pins it.

- **`01_functions_shared` before the tables.** Nearly every `CREATE TABLE` has
  `DEFAULT public.gen_uuidv7()`. A column default is early-bound, so the
  function must already exist. This is the only reason "functions" is split in
  two.
- **`05_views` after `04_functions_triggers`.** Views are early-bound on the
  functions they call.
- **`06_indexes` before any data.** The seed scripts' `ON CONFLICT` targets
  need the partial unique indexes.
- **`08_rls` after `04`.** Policies are early-bound on `iam.fn_user_org_rank`,
  `hr.can_approve` and friends.

## Changing the schema

Edit the `CREATE` statement and redeploy. That is the whole workflow, and the
`CREATE` is always the single source of truth.

There is no `_migrations/` folder and no numbered migration files. Previously
each file ended with an `IN-PLACE UPGRADES` section of
`ALTER ... ADD COLUMN IF NOT EXISTS` that had to be kept in lock-step by hand
with the `CREATE TABLE` above it, and the two drifted: `hr.attendance_rules`
ended up with four CHECK constraints declared twice under different names on
every fresh install. A later `migrations/` folder was tried and retired for the
same reason — the files are archived under `db_backups/`.

Record every change in `09_schema_version.sql`. The scripts show only the
current shape; the version description is the only record of *why*.

Then update the column tables in `docs/DB_model.md` and run
`python docs/tools/gen_db_diagram.py`, which regenerates the ER diagrams in
that doc and the interactive `docs/db-schema-atlas.html` from the `CREATE`
statements.

### Getting a change onto a server that has data

`db_deploy.ps1` DROPs and recreates, so it is for local development only.
For UAT and production:

```powershell
.\apply_schema.ps1 -DbHost <server> -Backup
```

That re-runs `04`–`08` and `10` in place — functions, views, indexes, grants
and policies are all idempotent, so the live objects end up matching this
folder exactly.

It deliberately does **not** re-run `02`/`03`: they are `CREATE TABLE IF NOT
EXISTS` and would be silent no-ops on a populated database. A new column or a
changed type therefore needs a hand-written `ALTER` against the server, run
once. Do that first, edit the `CREATE TABLE` to match, then run
`apply_schema.ps1` so everything referencing the new shape is rebuilt.

## Reference data vs dummy data

**`reference_data/`** is required by every deployment, demo or production. Some
of it is genuinely global (countries, the capability tree, plan types). The rest
is stored as **templates** — rows with `tenant_id IS NULL` that are never used
directly. Tenant-scoped RLS hides them from ordinary users.

**`dummy_data/`** is demo tenants, users and leads for local development.
Nothing in it is required, and `99_cleanup_dummy_data.sql` removes all of it.

## Adding a tenant

```sql
SELECT entity.provision_tenant('<tenant-uuid>');
-- or, for a tenant licensed for only some products:
SELECT entity.provision_tenant('<tenant-uuid>', ARRAY['lms','tasks']);
```

One call gives the tenant module entitlements, the eight registry catalogs, the
LMS lead catalogs, departments, the role ladder with its capability grants, and
message templates. It is idempotent, and it is the same call the application
makes when a tenant is created through the API — so a demo tenant and a real one
are provisioned by identical code. `dummy_data/01` calls exactly this.

`super_admin` is the only role that stays global: it acts across tenants by
design, so there is no single tenant its row could belong to.

### What this replaced

`_migrations/17`, `19` and `23` used to run at the end of every deploy. They
cloned the global rows per tenant, repointed every reference, and then **deleted
the global originals**. With no tenants to clone to — a production-shape deploy
— they cloned nothing and deleted everything, leaving a database with a single
`super_admin` role and zero lead stages. Their header claimed they were
"idempotent and self-guarding" with no tenants; the `DELETE` was unconditional.

Keeping the templates and provisioning per tenant removes that failure mode, and
makes adding a tenant a function call rather than a redeploy.

## Removing the demo data

```
psql -U postgres -d <db> -v ON_ERROR_STOP=1 -f dummy_data/99_cleanup_dummy_data.sql
```

Not part of any deploy. It used to be: the teardown was listed in the same
sequence as the seed, so a default deploy created two tenants and 5000 leads and
then immediately deleted them, and the tenant-scoping scripts that ran afterwards
found no tenants and silently did nothing.

Two details in that script are load-bearing and are commented in place:

- `public.soft_delete_row()` turns `DELETE` into `UPDATE is_deleted = TRUE` for
  every role except `root_service`, so the script sets that role itself. The
  `ALTER TABLE` statements around it must run as the *owner*, before and after —
  which is why the old teardown was three separate files.
- The audit sweep is the **last** delete. Every other `DELETE` fires audit
  triggers that write to `audit.audit_log`, so clearing it early leaves behind
  the ~17k rows the cleanup itself generated.

Verified: after cleanup, all 85 tables hold exactly the row counts of a fresh
`reference_data`-only deploy.

## tools/

`role_nav_denies.sql` — take a page or tab away from a role. Not a migration:
edit the three declarations at the top and run it.

It exists because "hide this tab" is not "delete its grant row". For a `page` or
`tab`, `iam.fn_role_capability_matrix` treats a missing row as *inherit from the
parent*, so deleting one **reveals** the page. An explicit `is_granted = FALSE`
row is the mechanism. Prefer a tenant-scoped deny (`v_tenant_id = '<uuid>'`) —
that is the same row the Capability Matrix screen writes, so it can be reversed
from the admin UI.

`build_prod_rollout.ps1` — assembles `msq-deploy/DB_ROLLOUT_<from>_to_<to>.sql`, the
single-transaction file that takes a production database from one schema version to the
next (the `one_time/apply_*.sql` parts in version order, then `04`–`08` and `10`, then the
`09` rows). Append a line to its `$Order` list for each new schema version, rebuild, and
rehearse on a fresh prod clone (`one_time/refresh_from_prod.ps1`) before shipping. See
`msq-deploy/DB_ROLLOUT_1.56.0_to_1.79.0.md`.

`one_time/apply_capability_walls.sql` (schema 1.76.0, registered in `build_prod_rollout.ps1`) is the capability
cleanup: new/merged/removed keys plus the grants that keep the rank-to-capability cutover
behaviour-neutral. Run it as a dry run first (`sed 's/^COMMIT;/ROLLBACK;/' ... | psql`: it rolls back and prints every changed
grant), take the `*_bak_20261008` copies it names, then run it for real. It is included in `msq-deploy/DB_ROLLOUT_1.56.0_to_1.79.0.sql` (the builder's default target).

### Default branch per tenant

A session must sit in a real branch, so a tenant with no branch can't be switched into from the
navbar. admin-service now creates `<Tenant> - Head Office` (org type `head_office`) in the same
transaction as every new tenant. For tenants that already exist without one, run
`one_time/backfill_default_branch_dryrun.sql` and then `one_time/backfill_default_branch.sql`
(idempotent, no schema change, so no version bump). Applied to local only; UAT/prod pending.

`one_time/apply_departments_tenant_admin_write.sql` (schema 1.78.0) grants `tenant_admin` INSERT/UPDATE on `iam.departments`, widens its policy to `FOR ALL ... WITH CHECK`, and enables deny-all RLS on the `iam.*_bak_*` capability backups. Run the `_dryrun.sql` twin first; it is idempotent and has no column changes.

## Meta Conversions API v2 rollout (1.79.0)

`one_time/apply_meta_capi_v2_1_79.sql` (+ `_dryrun`) — new platform tables, the outbox, three `SECURITY DEFINER` functions, view column additions, the funnel event vocabulary and a per-tenant re-wire of the stage → event map (only stages still on the retired `Other` move). Idempotent and transactional. Run it **before** deploying the new `meta-conversion-api`, `leads-service` and `lookup-admin` images; it is safe for the old ones. `one_time/apply_meta_capi_v2_drop_dead_columns_1_80.sql` drops `ext.meta_tenant_config.capi_trigger_stages` / `ad_account_ids` and is run only **after** every image has been replaced (an older meta-conversion-api still reads them). Afterwards, in the console: Meta Connection (enter both system-user tokens), Meta Datasets (register each client's portfolio and dataset, link its ad accounts, Verify), then *CAPI Outbox → Re-queue parked*. The scripts in `one_time/` are gitignored by design — copy them to the server.
