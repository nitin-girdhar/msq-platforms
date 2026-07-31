# Migrations

## Adding a column? Don't add a file here.

New columns on tables that `02_schema.sql` / `03_product_schema.sql` already
create go **in place, in those files** — in the `CREATE TABLE`, and again in that
file's `IN-PLACE UPGRADES` section as `ALTER ... ADD COLUMN IF NOT EXISTS`.

The two must stay in lock-step. The `CREATE TABLE` is `IF NOT EXISTS`, so on a
database where the table already exists it is a no-op and the column would never
appear; the `ALTER` block is what upgrades an existing deployment. Together, one
re-run of `db_deploy.ps1` brings **any** database current, fresh or not, and the
folder stops accumulating a file per change.

What still belongs here: anything that **rewrites shape or data** — renames, type
changes, backfills, one-shot repairs. Those cannot be re-run on every deploy, and
that is exactly what an in-place `ALTER` block does.

The attendance day-classification, split-shift and face-review columns were
originally shipped as `21_*` and `22_*` and have been folded into
`03_product_schema.sql` under that model; the files are gone.

---

Not all of the below are "pre-existing deployments only" — read the section that
applies to the script you care about.

| Script | Pre-P1.0 upgrade only | In the fresh-install sequence |
| --- | --- | --- |
| `15_tenant-modules-lms-rename.sql` | yes | no |
| `16_rename_crm_schema_and_service_role.sql` | yes | no |
| `17_tenant_scope_lms_catalogs.sql` | no | **yes** |
| `18_platform_role_autoderive.sql` | no | no — see below |
| `19_tenant_scope_ladder_roles.sql` | no | **yes** |
| `20_user_photos_and_attendance_retention.sql` | no | no — see below |
| `21_role_nav_denies.sql` | no | no — operator-run template, see below |
| `22_prune_unused_admin_capabilities.sql` | no | no — existing DBs only, see below |
| `23_tenant_scope_admin_roles.sql` | no | **yes** |

## Tenant-scoping (17, 19 and 23) — part of every install

`db_deploy.ps1` runs these after the demo seed, because they need
`entity.tenants` to exist: `07_seed_lookup_data.sql` seeds the LMS lead catalogs
and the ladder roles as GLOBAL rows (`tenant_id IS NULL`), and these three fan
each one out into an identical per-tenant copy, repoint every reference, and drop
the global original.

- `17_tenant_scope_lms_catalogs.sql` — `lms.lead_stage`, `lead_stage_outcome`,
  `interaction_types`, `follow_up_statuses`, `lead_sources`. Without it the
  tenant-scoped RLS in `06_rls.sql` hides every row (`NULL = <tenant>` is never
  true), so Status / Outcome / Source / Follow-up render blank for everyone
  except `super_admin`.
- `19_tenant_scope_ladder_roles.sql` — `hr_admin`, `org_sr_manager`,
  `org_manager`, `senior_sales_executive`, `sales_representative` (with their
  capability grants).
- `23_tenant_scope_admin_roles.sql` — `tenant_admin`, `org_admin`, `read_only`
  (with their capability grants). After this, **`super_admin` is the only role
  that remains global**, which is what `19`'s header anticipated as the one true
  platform contract: a super_admin acts across tenants by design, so there is no
  single tenant its row could belong to. `19`'s warning that a per-tenant copy of
  the other three "would fork a platform-wide invariant" turned out not to hold —
  both `iam.set_user_platform_role()` and `withRoleTx`'s PG-role selection key on
  the role NAME, which a clone preserves.

All three are idempotent and self-guarding: with no tenants (a core-only
install) they find nothing global to clone and do nothing.

### Consequence for `21_role_nav_denies.sql`

Its **platform-default** path (`v_tenant_id = NULL`) joins
`iam.user_roles ... AND r.tenant_id IS NULL`, so after `23` it no longer matches
`org_admin` or `tenant_admin` — those roles are per-tenant now and a global deny
has nothing to attach to. Use the tenant-scoped form (`v_tenant_id = '<uuid>'`),
which was already the recommended one below because it is reversible from the
Capability Matrix screen.

## `18_platform_role_autoderive.sql` — existing databases only

The trigger it installs (`trg_02_users_platform_role`, which derives
`iam.users.platform_role` from `role_id`) is already in `02_schema.sql`, so a
fresh install is correct by construction and never needs this script. Run it on
a database created before that trigger existed, where users seeded after the
one-shot backfill in `13_backfill_per_product_roles.sql` were left with
`platform_role IS NULL` — which authenticates them as `member` and 403s every
platform-tier gate.

## `20_user_photos_and_attendance_retention.sql` — existing databases only

Adds the profile-photo columns (`iam.users.photo_*`) and the attendance
photo-change-cooldown / selfie-retention columns (`hr.attendance_rules`), then
mirrors any already-enrolled `hr.employee_profiles.reference_photo_url` onto
`iam.users.photo_key` so an existing face-enrollment doubles as the avatar.

A fresh install never needs it: `02_schema.sql` and `03_product_schema.sql`
create all of these columns directly. The script is `ADD COLUMN IF NOT EXISTS`
plus a guarded backfill, so it's a harmless no-op on a fresh DB and safe to
re-run. Run it on any database created before this increment.

## `21_role_nav_denies.sql` — a template, run on demand

Not a migration in the usual sense and not part of `db_deploy.ps1`: it is the
supported way to take a page or tab away from a role. Edit the three
declarations at the top (role, tenant, capability keys) and run it.

It exists because "hide this tab" is not "delete its grant row". For a `page` or
`tab`, `iam.fn_role_capability_matrix` treats a missing row as **inherit from
the parent**, so deleting one *reveals* the page. `org_admin` and `tenant_admin`
hold no explicit page/tab rows at all — every CRM page they see is inherited off
the `lms` tool — so there is nothing there to delete. An explicit
`is_granted = FALSE` row is the mechanism, and this script writes it.

Prefer a tenant-scoped deny (`v_tenant_id = '<uuid>'`): that is the same row the
Capability Matrix screen writes, so it can be reversed from the admin UI. A
platform-default deny (`v_tenant_id = NULL`) applies to every tenant and is
invisible to that screen.

Idempotent (upserts), and it refuses to run with an empty or misspelled key
list rather than silently matching nothing.

## `22_prune_unused_admin_capabilities.sql` — existing databases only

Deletes eleven `admin.*` capability nodes that no app or service ever read —
`admin.orgs*`, `admin.users*`, `admin.lookups.view`, `admin.config.lms.manage`,
`admin.meta.manage`, `admin.comms.send` — plus any now-pointless bare `admin`
tool grant. They rendered on the Capability Matrix screen as boxes that changed
nothing, because the surfaces they name live in admin-service /
identity-service / communication-service, none of which gates on a capability
(rank only). Surviving: `admin`, `admin.lookups`, `admin.lookups.manage`,
`admin.roles.manage` — the real gates on the super_admin lookup-admin console.

A fresh install never needs it: `07_seed_lookup_data.sql` no longer seeds the
removed keys. Re-running `07` on an existing database will **not** clear them —
its `ON CONFLICT` clause only upserts and re-sets `is_active = TRUE` — which is
why this is a file here rather than an edit to the seed alone. Idempotent and a
no-op once run.

Note this prunes the *keys*, not the enforcement gap they exposed: admin-service
and identity-service still authorize by rank alone. If either grows a real
`requireCapability` gate, re-add the key **with** the gate in the same change.

# One-time migrations (pre-P1.0 deployments only)

These two scripts rewrite the database's *shape* from what it looked like before the
P1.0 crm-naming cleanup (`docs/Platform_Implementation_Plan.md` Phase 1) to what
`db_scripts/01_init-db.sql` / `10_init-hr-task-schemas.sql` now create directly:

- `15_tenant-modules-lms-rename.sql` — renames the `entity.tenant_modules`
  entitlement key `'crm'` → `'lms'` (CHECK constraint + existing rows + backfill).
- `16_rename_crm_schema_and_service_role.sql` — `ALTER SCHEMA crm RENAME TO lms` +
  `ALTER ROLE crm_service RENAME TO root_service` + re-authors the 9 trigger/function
  bodies that hardcode `crm.` as literal text (schema-qualification inside a plpgsql
  body isn't an OID reference, so `ALTER SCHEMA … RENAME` doesn't touch it).

**Both are guarded no-ops on a fresh install.** `01_init-db.sql` and
`10_init-hr-task-schemas.sql` already create schema `lms` and role `root_service`
directly (confirmed: `grep -c crm_service db_scripts/01_init-db.sql` → 0), and
`10_init-hr-task-schemas.sql`'s `tenant_modules.module` CHECK already lists
`'lms'` (not `'crm'`) as the valid key. So a brand-new database never needs these
two scripts — the fresh-install sequence in `db_deploy.ps1` skips straight from
`14_init-tasks.sql` to `17_init-per-product-roles.sql`.

**Run these two only when migrating a database that was deployed *before* P1.0**
(schema still literally named `crm`, role still `crm_service`) — run them first,
in order (`15` then `16`), before continuing the normal numbered sequence at `17`.

## Why 17–20 are *not* here

`17_init-per-product-roles.sql`, `18_backfill-per-product-roles.sql`,
`19_init-per-product-db-grants.sql`, and `20_member-role-resolver-fn.sql` were
initially archived into this folder too, then moved back to `db_scripts/` root:
unlike 15/16, none of them assume a legacy pre-refactor shape. They're purely
additive (`IF NOT EXISTS` / `CREATE OR REPLACE` / idempotent `GRANT`/`REVOKE`) and
run correctly on a completely empty, freshly-created database — `18`'s backfill
does real work only when there's already seed/demo data carrying old-ladder
(`iam.user_org_mapping`) roles (e.g. after running `02`–`06` demo seeds), and is a
harmless no-op otherwise. They belong in the normal sequential fresh-install run,
not in a "pre-existing deployment only" bucket.
