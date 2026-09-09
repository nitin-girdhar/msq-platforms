# CRM Monorepo — Database Model

> **Database:** PostgreSQL 14+  
> **Schema version:** 1.45.0  
> **Primary keys:** UUIDv7 (time-ordered) for operational tables; SMALLINT/INTEGER identity for geographic lookups  
> **Multi-tenancy:** Row Level Security (RLS) on every operational table  
> **Extensions:** pgcrypto, pg_trgm, btree_gin, vector (optional)

---

## Schema Diagram (Entity-Relationship)

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    SCHEMA: geo                                              │
│                                                                                             │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐                                 │
│  │  countries    │◄────│   states     │◄────│   cities     │                                 │
│  │  (SMALLINT)   │ 1:N │  (SMALLINT)  │ 1:N │  (INTEGER)   │                                │
│  └──────────────┘     └──────────────┘     └──────────────┘                                 │
└─────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                  SCHEMA: entity                                             │
│                                                                                             │
│  ┌────────────────┐  ┌──────────────────┐  ┌───────────────┐                                │
│  │ tenant_domains │  │ tenant_plan_types│  │  org_types    │                                 │
│  └───────┬────────┘  └────────┬─────────┘  └──────┬────────┘                                │
│          │                    │                    │                                         │
│          ▼                    ▼                    ▼                                         │
│  ┌──────────────────────────────────────────────────────────┐     ┌──────────────┐           │
│  │                    tenants                               │◄────│ organizations│──┐        │
│  │  (id, name, domain_id, plan_type_id, is_active, ...)    │ 1:N │              │  │        │
└──┴──────────────────────────────────────────────────────────┴─────┴──────┬───────┴──┘        │
                                                                           │                    │
                    ┌──────────────────────────────────────────────────────┘                    │
                    │ (org_id FK on nearly all operational tables)                             │
                    ▼                                                                          │
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    SCHEMA: iam                                              │
│                                                                                             │
│  ┌──────────────┐     ┌──────────────────────────────┐     ┌──────────────────────┐         │
│  │  user_roles  │◄────│            users             │────►│  user_org_mapping    │         │
│  └──────────────┘     │  (self-ref: manager_id)      │     │  (PK: user_id+org_id)│         │
│                       └──────────────────────────────┘     └──────────────────────┘         │
│                                                                                             │
│  ┌──────────────────────┐                                                                   │
│  │  token_blocklist     │  (JWT revocation: jti, user, org, tenant scope)                   │
│  └──────────────────────┘                                                                   │
└─────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    SCHEMA: lms                                              │
│                                                                                             │
│  ┌──────────────┐  ┌───────────────────┐  ┌──────────────────┐  ┌────────────────────┐      │
│  │  lead_stage  │──│ lead_stage_outcome│  │ interaction_types│  │ follow_up_statuses │      │
│  └──────┬───────┘  └────────┬──────────┘  └────────┬─────────┘  └─────────┬──────────┘      │
│         │                   │                      │                      │                  │
│         ▼                   ▼                      │                      │                  │
│  ┌──────────────────────────────────────┐          │                      │                  │
│  │          marketing_leads            │          │                      │                  │
│  │  (core lead entity, soft-delete)    │          │                      │                  │
│  │  FK → org, stage, outcome, campaign,│          │                      │                  │
│  │       source, assigned_user         │          │                      │                  │
│  │  is_active, superseded_by (self-ref)│          │                      │                  │
│  └────┬────────────────┬───────────┬───┘          │                      │                  │
│       │                │           │               │                      │                  │
│       │ 1:N            │ 1:N       │ 1:N           │                      │                  │
│       ▼                ▼           ▼               ▼                      ▼                  │
│  ┌────────────┐ ┌─────────────┐ ┌─────────────────────┐  ┌──────────────────────┐           │
│  │lead_status │ │ lead_assign │ │ lead_interactions   │  │  lead_follow_ups    │            │
│  │  _log      │ │ ment_log    │ │                     │  │                     │            │
│  └────────────┘ └─────────────┘ └─────────────────────┘  └─────────────────────┘            │
│                                                                                             │
│  ┌──────────────┐  ┌──────────────────────────────────────────────────────────┐             │
│  │ lead_sources │  │ lead_links  (merge: same-org dedup / transfer: cross-org) │             │
│  │              │  │  source_lead_id → marketing_leads                         │             │
│  └──────────────┘  │  dest_lead_id   → marketing_leads                         │             │
│                    │  link_type: 'merge' | 'transfer'                           │             │
│                    └──────────────────────────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                  SCHEMA: marketing                                          │
│                                                                                             │
│  ┌──────────────────────┐  ┌──────────────────┐                                             │
│  │ marketing_platforms  │  │ campaign_statuses│                                             │
│  └──────────┬───────────┘  └────────┬─────────┘                                             │
│             │                       │                                                       │
│             ▼                       ▼                                                       │
│  ┌──────────────────────────────────────────────┐                                           │
│  │              ad_campaigns                    │                                           │
│  │  FK → org, platform, status                  │                                           │
│  └──────────────────────────────────────────────┘                                           │
└─────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   SCHEMA: audit                                             │
│                                                                                             │
│  ┌──────────────────────────┐  ┌──────────────────┐  ┌──────────────┐                       │
│  │ marketing_leads_history  │  │    audit_log     │  │  activities  │                       │
│  │ (field-level diff for    │  │ (generic for all │  │ (fire-and-   │                       │
│  │  lms.marketing_leads)    │  │  other tables)   │  │  forget log) │                       │
│  └──────────────────────────┘  └──────────────────┘  └──────────────┘                       │
└─────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    SCHEMA: ext                                              │
│                                                                                             │
│  ┌──────────────────┐  ┌───────────────────────┐  ┌──────────────────┐  ┌──────────────────────┐│
│  │ meta_tenant_     │  │ meta_page_form_       │  │   meta_leads     │◄─│ meta_lead_custom_    ││
│  │ config (per-     │  │ org_map (Page+Form    │  │ (raw Meta data)  │1N│ fields               ││
│  │ tenant creds +   │  │ -> org attribution)   │  └────────┬─────────┘  └──────────────────────┘│
│  │ field_mappings)  │  └───────────────────────┘           │                                    │
│  └──────────────────┘                                      │                                    │
│                    ┌────────────────┼────────────────┐                                      │
│                    ▼                ▼                ▼                                      │
│         ┌────────────────┐ ┌──────────────────┐ ┌──────────────────────┐                    │
│         │ meta_lead_      │ │ meta_lead_       │ │ meta_lead_           │                    │
│         │ addresses (1:1) │ │ professional(1:1)│ │ demographics (1:1)   │                    │
│         └────────────────┘ └──────────────────┘ └──────────────────────┘                    │
│                                    │                                                        │
│                                    ▼                                                        │
│                           ┌────────────────────────┐                                        │
│                           │ meta_capi_outbound_logs│                                        │
│                           │ (CAPI event audit)     │                                        │
│                           └────────────────────────┘                                        │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Database Schemas

| Schema      | Purpose                                         |
| ----------- | ----------------------------------------------- |
| `public`    | UUIDv7 generator, utility trigger functions      |
| `geo`       | Geographic lookup tables (countries/states/cities) |
| `entity`    | Tenant, organization, and related lookups          |
| `iam`       | Users, roles, org mappings, token blocklist       |
| `lms`       | Leads, interactions, follow-ups, stage pipeline   |
| `marketing` | Ad campaigns, platforms, statuses                |
| `audit`     | Audit logs, lead history, activity log           |
| `ext`       | External integrations (Meta Lead Ads / CAPI)     |
| `hr`        | Employee profiles, leave, attendance |
| `task`      | To-do lists, tasks, comments                     |
| `comms`     | Cross-product WhatsApp/email message templates (org > tenant > global resolution) |
| `notify`    | Cross-product Web Push subscriptions (one row per installed PWA/device) |

---

## Database Roles

| Role              | Type         | RLS       | Purpose                                      |
| ----------------- | ------------ | --------- | --------------------------------------------- |
| `app_user`        | NOLOGIN      | Subject   | Standard app role — DML on operational tables |
| `readonly_user`   | NOLOGIN, INHERIT | Subject | Selected via `withRoleTx`'s `ctx.readOnly` on the app path (`SET LOCAL ROLE readonly_user` + `transaction_read_only = on`) — makes a read path physically incapable of writing, independent of the query it runs |
| `tenant_admin`    | NOLOGIN      | Subject   | Cross-org admin within a tenant               |
| `root_service`     | LOGIN        | BYPASSRLS | Service superuser — unrestricted DML          |
| `lead_svc`        | LOGIN        | via app_user | Shared/legacy login — identity-service, notifications-service, admin-service (unrestricted; not yet re-plumbed to a per-product role) |
| `campaign_svc`    | LOGIN        | via app_user | Campaign management service               |
| `user_mgmt_svc`   | LOGIN        | via app_user | User management service                   |
| `notif_svc`       | LOGIN        | via app_user | Notifications service                     |
| `intake_svc`      | LOGIN        | via app_user | Lead intake / webhook service              |
| `meta_svc`        | LOGIN        | via app_user | Meta Conversion API service               |
| `tenant_dash_svc` | LOGIN        | via tenant_admin | Tenant dashboard service              |
| `analytics_svc`   | LOGIN        | BYPASSRLS | Read-only analytics (SELECT only)          |
| `lms_svc`         | LOGIN        | membership only (P1.2/D8) | leads-service, meta-conversion-api — direct GRANTs on `lms`/`marketing`/`ext` only + read-only `iam`/`entity`/`geo`; member of `app_user`/`tenant_admin` for RLS matching only (NOINHERIT — no cross-schema privilege) |
| `hr_svc`          | LOGIN        | membership only (P1.2/D8) | hr-service — direct GRANTs on `hr` only + read-only `iam`/`entity`/`geo`; cannot read `lms.*`/`task.*` |
| `task_svc`        | LOGIN        | membership only (P1.2/D8) | tasks-service — direct GRANTs on `task` only + read-only `iam`/`entity`/`geo`; cannot read `lms.*`/`hr.*` |

---

## Table Details

### geo.countries

Geographic country lookup. Integer identity PK.

| Column      | Type      | Constraints          |
| ----------- | --------- | -------------------- |
| id          | SMALLINT  | PK, GENERATED ALWAYS |
| name        | TEXT      | NOT NULL, UNIQUE     |
| iso_code    | CHAR(2)   | NOT NULL, UNIQUE     |
| description | TEXT      |                      |

---

### geo.states

| Column      | Type      | Constraints                            |
| ----------- | --------- | -------------------------------------- |
| id          | SMALLINT  | PK, GENERATED ALWAYS                   |
| country_id  | SMALLINT  | NOT NULL, FK → geo.countries(id)       |
| name        | TEXT      | NOT NULL                               |
| code        | TEXT      |                                        |
| description | TEXT      |                                        |

**Unique:** `(country_id, name)`

---

### geo.cities

| Column      | Type      | Constraints                       |
| ----------- | --------- | --------------------------------- |
| id          | INTEGER   | PK, GENERATED ALWAYS              |
| state_id    | SMALLINT  | NOT NULL, FK → geo.states(id)     |
| name        | TEXT      | NOT NULL                          |
| description | TEXT      |                                   |

**Unique:** `(state_id, name)`

---

### entity.tenant_domains

Classifies tenants by industry vertical.

| Column      | Type    | Constraints             |
| ----------- | ------- | ------------------------ |
| id          | UUID    | PK (UUIDv7)              |
| name        | TEXT    | NOT NULL, UNIQUE         |
| label       | TEXT    | NOT NULL                 |
| description | TEXT    |                          |
| is_active   | BOOLEAN | NOT NULL, DEFAULT TRUE   |

**Seed values:** fitness, retail, healthcare, education, hospitality, medical, real_estate, automotive, logistics

---

### entity.tenant_plan_types

Subscription tiers.

| Column      | Type    | Constraints             |
| ----------- | ------- | ------------------------ |
| id          | UUID    | PK (UUIDv7)              |
| name        | TEXT    | NOT NULL, UNIQUE         |
| label       | TEXT    | NOT NULL                 |
| description | TEXT    |                          |
| is_active   | BOOLEAN | NOT NULL, DEFAULT TRUE   |

**Seed values:** free_trial, starter, growth, enterprise

---

### entity.org_types

Classification of organization locations.

| Column      | Type    | Constraints             |
| ----------- | ------- | ------------------------ |
| id          | UUID    | PK (UUIDv7)              |
| name        | TEXT    | NOT NULL, UNIQUE         |
| label       | TEXT    | NOT NULL                 |
| description | TEXT    |                          |
| is_active   | BOOLEAN | NOT NULL, DEFAULT TRUE   |

**Seed values:** gym_location, boutique, branch, headquarters, franchise, clinic, warehouse, showroom, head_office

---

### entity.tenants

Top-level tenant entity (SaaS customer).

| Column       | Type        | Constraints                              |
| ------------ | ----------- | ---------------------------------------- |
| id           | UUID        | PK (UUIDv7)                              |
| name         | TEXT        | NOT NULL, UNIQUE                         |
| domain_id    | UUID        | FK → entity.tenant_domains(id)           |
| plan_type_id | UUID        | FK → entity.tenant_plan_types(id)        |
| is_active    | BOOLEAN     | NOT NULL, DEFAULT TRUE                   |
| is_deleted   | BOOLEAN     | NOT NULL, DEFAULT FALSE                  |
| deleted_at   | TIMESTAMPTZ |                                          |
| deleted_by   | UUID        |                                          |
| metadata     | JSONB       | NOT NULL, DEFAULT '{}'                   |
| created_at   | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()      |
| updated_at   | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()      |

**Check:** `NOT (is_active AND is_deleted)`  
**RLS:** tenant sees only own row via `app.current_tenant_id`  
**Triggers:** `set_updated_at`, `soft_delete_row`

---

### entity.organizations

Business unit / location within a tenant.

| Column            | Type        | Constraints                                |
| ----------------- | ----------- | ------------------------------------------ |
| id                | UUID        | PK (UUIDv7)                                |
| tenant_id         | UUID        | NOT NULL, FK → entity.tenants(id)          |
| name              | TEXT        | NOT NULL                                   |
| legal_entity_name | TEXT        |                                            |
| brand_name        | TEXT        |                                            |
| org_type_id       | UUID        | FK → entity.org_types(id)                  |
| address_line1     | TEXT        |                                            |
| address_line2     | TEXT        |                                            |
| landmark          | TEXT        |                                            |
| pincode           | TEXT        |                                            |
| city              | TEXT        | Free-text city                             |
| city_id           | INTEGER     | FK → geo.cities(id)                        |
| state_id          | SMALLINT    | FK → geo.states(id)                        |
| country_id        | SMALLINT    | FK → geo.countries(id)                     |
| timezone          | TEXT        | NOT NULL, DEFAULT 'Asia/Kolkata'           |
| is_active         | BOOLEAN     | NOT NULL, DEFAULT TRUE                     |
| is_deleted        | BOOLEAN     | NOT NULL, DEFAULT FALSE                    |
| deleted_at        | TIMESTAMPTZ |                                            |
| deleted_by        | UUID        |                                            |
| metadata          | JSONB       | NOT NULL, DEFAULT '{}'                     |
| created_at        | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()        |
| updated_at        | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()        |

**Unique:** `(tenant_id, name)`  
**Check:** `NOT (is_active AND is_deleted)`  
**RLS:** app_user sees orgs they are mapped to; tenant_admin sees all within tenant  
**Triggers:** `set_updated_at`, `soft_delete_row`, `auto_grant_tenant_admins_on_new_org`

---

### entity.tenant_modules

Per-tenant **product/module entitlements** (D6). Gates which products a tenant has licensed. Created in `10_init-hr-task-schemas.sql`; the `lms`→`lms` key rename + `lms` backfill land in `15_tenant-modules-lms-rename.sql`.

| Column     | Type        | Constraints                                            |
| ---------- | ----------- | ------------------------------------------------------ |
| id         | UUID        | PK (UUIDv7)                                            |
| tenant_id  | UUID        | NOT NULL, FK → entity.tenants(id) ON DELETE CASCADE    |
| module     | TEXT        | NOT NULL, CHECK IN (`lms`, `leave`, `attendance`, `tasks`) |
| is_active  | BOOLEAN     | NOT NULL, DEFAULT TRUE                                 |
| enabled_at | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()                    |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()                    |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()                    |

**Unique:** `(tenant_id, module)`  
**`module` values:** `lms` is the lead product's entitlement key (renamed from legacy `lms`; the `lms` *schema* rename is deferred to Phase 1). `leave`/`attendance` are the HR sub-modules; `tasks` is the to-do product.  
**RLS:** `FORCE`d. tenant_admin `SELECT`s its own tenant's rows (`app.current_tenant_id`); app_user `SELECT`s rows for the tenant owning its current org. **Writes are platform-only** (`root_service`/super_admin) — tenants cannot self-grant entitlements.  
**Enforcement:** the **api-gateway** is the central choke point — a route-prefix→product map (`/leads*`,`/assignments*`,`/analytics*`→`lms`; `/hr/*` except `/hr/employees*`,`/hr/modules`→`hr` = active `leave`OR`attendance`; `/tasks*`,`/task-lists*`→`task`) returns `403 PRODUCT_NOT_ENABLED` after JWT verify. Per-service `require-module` middleware (leads/hr/tasks) stays as defense-in-depth. `@platform/authz.hasProduct()` reads this table via a 60s cached read.  
**Triggers:** `set_updated_at`

---

### iam.user_roles

Role definitions with rank-based hierarchy. **Current shape (schema 1.45.0):** this single ladder is now authoritative platform-wide. The per-product ladders it was once slated to be replaced by (`lms.roles`, `hr.roles`, `task.roles`) plus their grant tables (`<product>.member_roles`) were **dropped at schema 1.40.0** (`db_scripts/one_time/drop_per_product_role_tables.sql`) — the rollback direction won, not the migration described below. Role/rank resolution now runs solely through `iam.fn_user_org_role`/`iam.fn_role_capability_matrix` against this table. See "Retired: per-product role tables" further down for what existed in between and why it was rolled back.

| Column         | Type    | Constraints                                              |
| -------------- | ------- | --------------------------------------------------------- |
| id             | UUID    | PK (UUIDv7)                                                |
| tenant_id      | UUID    | FK → entity.tenants(id) ON DELETE CASCADE; NULL = global platform-anchor role, non-NULL = a tenant's own copy/custom role |
| department_id  | UUID    | FK → iam.departments(id) ON DELETE RESTRICT                |
| name           | TEXT    | NOT NULL, UNIQUE                                           |
| label          | TEXT    | NOT NULL                                                   |
| description    | TEXT    |                                                             |
| rank           | INT     | NOT NULL, DEFAULT 0 (range **0-1000**, widened from 0-100 to leave headroom for tenant-custom roles between the anchors) |
| is_active      | BOOLEAN | NOT NULL, DEFAULT TRUE                                     |

**Seed values (anchor roles, by rank):**

| rank | name         | label        | tenant_id             |
| ---- | ------------ | ------------ | ---------------------- |
| 0    | read_only    | Read Only    | NULL (global anchor)   |
| 980  | org_admin    | Admin        | NULL (global anchor)   |
| 990  | tenant_admin | Tenant Admin | NULL (global anchor)   |
| 1000 | super_admin  | Super Admin  | NULL (global anchor)   |

Tenant-defined and tenant-copied roles (e.g. `sales_representative`, `senior_sales_executive`, `org_manager`, `org_sr_manager`, `pre_sales_captain`) sit at ranks between the anchors and carry a non-NULL `tenant_id`. `iam.fn_role_capability_matrix` resolves one row per role `name` per tenant, with the per-tenant copy winning over the global template.

---

### iam.capabilities

The global, platform-shipped capability catalog (Tier C3) — a self-referential tree: `tool → page → tab → operation → scope`. Generated into `@platform/rbac`'s `CAPABILITY` map (keys only, no label/kind/parent — a UI reads this table directly for that metadata, see `admin-service`'s `GET /capabilities`). A tenant cannot invent a capability; what a tenant *can* change is the grant (see `iam.role_capabilities` below). Read-only from the app — writes are seed/migration only.

| Column      | Type        | Constraints                                       |
| ----------- | ----------- | -------------------------------------------------- |
| id          | UUID        | PK (UUIDv7)                                        |
| key         | TEXT        | NOT NULL, UNIQUE                                   |
| kind        | TEXT        | NOT NULL, CHECK IN (`tool`,`page`,`tab`,`operation`,`scope`) |
| parent_key  | TEXT        | FK → iam.capabilities(key) ON DELETE CASCADE, self-referential |
| label       | TEXT        | NOT NULL                                           |
| description | TEXT        |                                                     |
| sort_order  | INT         | NOT NULL, DEFAULT 0 (also breadth ordering for `kind='scope'`) |
| is_active   | BOOLEAN     | NOT NULL, DEFAULT TRUE                             |
| created_at  | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()                |
| updated_at  | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()                |

**Check:** `(kind = 'tool') = (parent_key IS NULL)` — only a tool may be a root.
**RLS:** SELECT for `app_user`/`tenant_admin`; nobody may write from the app.
**Drizzle:** `capabilitiesTable` in `@platform/db/schema` (`tables/capabilities.table.ts`).

---

### iam.role_capabilities

Role → capability grants (Tier C3), resolved per tenant by `iam.fn_role_capability_matrix(tenant_id)`. `tenant_id NULL` = the platform default grant, shared by every tenant; `tenant_id` set = that tenant's override of the same `(role, capability)` pair, which wins. `is_granted = FALSE` is how a tenant revokes a default without deleting the platform row. Resolution order: tenant override → platform default → deny (default-deny: a key present in code but never seeded a grant denies everyone).

| Column        | Type        | Constraints                                        |
| ------------- | ----------- | --------------------------------------------------- |
| id            | UUID        | PK (UUIDv7)                                         |
| tenant_id     | UUID        | FK → entity.tenants(id) ON DELETE CASCADE, nullable  |
| role_id       | UUID        | NOT NULL, FK → iam.user_roles(id) ON DELETE CASCADE  |
| capability_id | UUID        | NOT NULL, FK → iam.capabilities(id) ON DELETE CASCADE |
| is_granted    | BOOLEAN     | NOT NULL, DEFAULT TRUE                              |
| created_by    | UUID        |                                                      |
| created_at    | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()                 |
| updated_at    | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()                 |

**Unique:** `(role_id, capability_id) WHERE tenant_id IS NULL`; `(tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL` (partial indexes — a plain UNIQUE would let NULL `tenant_id` duplicate freely).
**RLS:** SELECT sees platform defaults + the actor's own-tenant overrides (`app_user` via current org's tenant, `tenant_admin` via `app.current_tenant_id`). Writes (`admin_tenant_config_policy`, `FOR ALL TO app_user`) are override-only: `WITH CHECK` pins `tenant_id` to the row derived from **`app.current_org_id`** (via `entity.organizations.tenant_id`) — **not** `app.current_tenant_id` directly, unlike the newer N-6 tenant-scoped-lookup policies. A write on behalf of a super_admin managing an arbitrary tenant must first resolve an org under that tenant and pin `app.current_org_id` to it (see `admin-service`'s `capabilities.repository.ts`).
**Trigger:** `set_updated_at`, `set_created_by`.
**Drizzle:** `roleCapabilitiesTable` in `@platform/db/schema` (`tables/role-capabilities.table.ts`).
**Admin API:** `GET /roles/:id/capabilities?tenant_id=`, `PUT /roles/:id/capabilities` (admin-service, via gateway — see Architecture.md → "Capability administration").

> **Seeding trap — a grant on the global template does not reach a tenant that owns a copy of the role.** `iam.fn_role_capability_matrix` resolves **one role row per name** and the per-tenant copy **wins** (`DISTINCT ON (r.name) … ORDER BY (r.tenant_id IS NOT NULL) DESC`), and grants are keyed on `role_id`. Since `_migrations/19` the ladder roles — and, in practice, tenant copies of `tenant_admin`/`org_admin` too — exist per tenant, so a capability added to a template list in `reference_data/03_roles_and_grants.sql` lands on the template's `role_id` only and is invisible to every tenant that has its own copy. This is why that file ends with **back-fill blocks** that pin each new capability to an existing one with the same audience (`lms.leads.view.tenant` ← `lms.history.view.tenant`; `lms.leads.assign.bulk` ← `lms.leads.assign.any`), run once for `tenant_id IS NULL` and once for `tenant_id IS NOT NULL`. Add a matching pair of blocks for any new capability, or the roles the feature was built for silently will not have it.

> **`lms.leads.view.tenant` is what makes the branch picker work.** It is granted to `tenant_admin` only (plus `super_admin` via `'*'`). identity-service's `GET /orgs` widens the branch list to the whole tenant exactly when `resolveScope(actor, 'lms.leads.view')` is `tenant`/`all`, and leads-service reads the picked branch under the tenant Postgres role on the same condition (`RoleTxContext.tenantWide`). It was defined in `iam.capabilities` but granted to **no role at all**, which left every user with a single-option branch picker and the LMS Bulk Assign screen unusable.

> **Capability namespace split (schema 1.45.0, `db_scripts/one_time/apply_capability_namespace_split.sql`).** Introduced a dedicated `admin.*` capability namespace for cross-product administrative concerns, splitting them out of the product namespaces they used to live under — e.g. `lms.users.manage` → `admin.team.manage`, `platform.api_tokens` → `admin.api_tokens`. If a role/capability key you're looking for isn't where an older note in this doc says, check the `admin.*` namespace first — the rename is key-only (same `iam.capabilities` row, `key` updated in place), so `iam.role_capabilities` grants carried over automatically and did not need a back-fill pass.

> **`admin.team.notify` (schema 1.46.0, `db_scripts/one_time/apply_admin_team_notify_capability.sql`).** Operation node under `admin.team`, default-granted to `org_admin`/`tenant_admin` and back-filled per-tenant pinned to `admin.team.manage`. Gates the "Notify user by email" checkbox on the Team create / reset-password / branch-change forms: `identity-service`'s `users.controller` checks it (`hasCapability` alone — authoritative for every role, no `rank ≥ org_admin` short-circuit, since the back-fill already grants it wherever `admin.team.manage` is held) before `users.service` fires a fire-and-forget email through `communication-service` for `user_created` / `password_reset_by_admin` / branch changes. **Authorization for an outbound notification only** — no `iam.fn_user_can_manage_users` or `08_rls.sql` coupling like `admin.team.manage`, and no schema change.

---

### iam.users

User accounts. `full_name` is a GENERATED STORED column.

| Column                | Type        | Constraints                                |
| --------------------- | ----------- | ------------------------------------------ |
| id                    | UUID        | PK (UUIDv7)                                |
| org_id                | UUID        | NOT NULL, FK → entity.organizations(id)    |
| first_name            | TEXT        | NOT NULL                                   |
| middle_name           | TEXT        |                                            |
| last_name             | TEXT        | NOT NULL, DEFAULT ''                       |
| full_name             | TEXT        | GENERATED ALWAYS AS STORED (computed)      |
| email                 | TEXT        | NOT NULL, UNIQUE, CHECK `email = lower(email)`. The login credential. Always stored **trimmed + lowercase** — see *Canonical email* below |
| mobile                | TEXT        |                                            |
| password_hash         | TEXT        | NOT NULL                                   |
| role_id               | UUID        | NOT NULL, FK → iam.user_roles(id)          |
| platform_role         | TEXT        | CHECK IN (`super_admin`,`tenant_admin`,`org_admin`,`member`); nullable until Phase E (P1.1). Coarse cross-product role that survives in the shrunk JWT; drives PG-role selection + platform-wide capability only. |
| manager_id            | UUID        | DEPRECATED display mirror of iam.reporting_lines — never an authority source |
| is_active             | BOOLEAN     | NOT NULL, DEFAULT TRUE                     |
| is_deleted            | BOOLEAN     | NOT NULL, DEFAULT FALSE                    |
| deleted_at            | TIMESTAMPTZ |                                            |
| deleted_by            | UUID        |                                            |
| created_by            | UUID        |                                            |
| force_password_change | BOOLEAN     | NOT NULL, DEFAULT TRUE                     |
| password_changed_at   | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()        |
| last_login_at         | TIMESTAMPTZ |                                            |
| created_at            | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()        |
| updated_at            | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()        |

**Checks:** `id <> manager_id`, `NOT (is_active AND is_deleted)`, `email = lower(email)` (`chk_users_email_lowercase`)  
**RLS:** app_user sees users with active mapping to current org; tenant_admin sees all within tenant  
**Triggers:** `set_updated_at`, `soft_delete_row`, `set_org_id`, `set_created_by`, `check_user_hierarchy_no_cycle`, `audit_row_changes`

> **Canonical email (schema 1.48.0, `db_scripts/one_time/apply_email_lowercase.sql`).**
> `email` is the primary login credential and the `UNIQUE` above is
> case-**sensitive**, so the column is only meaningful if every writer stores the
> same spelling. Two defects came from it not doing so: a user created as
> `John.Doe@x.com` could not sign in as `john.doe@x.com` (`getUserByEmail` is an
> equality test, `u.email = $1`, so a different casing matched no row), and both
> spellings could be created as **separate accounts** — the `UNIQUE` did not
> collide, so no 409 fired and one person got two identities.
>
> `normalizeEmail()` / `emailInputSchema` in `@platform/validation`
> (`packages/platform-validation/src/email.ts`) is the single normalizer, applied
> by `createUserSchema`/`updateUserSchema` on the write path and by
> `resolveLoginUser` before the login lookup — the same shape `mobile` has via
> `normalizeMobile()`. One transform covers every writer because there is only
> one: api-gateway proxies all `/users` writes to identity-service,
> `/api/v1/public/users` is GET-only, and there is no self-service signup,
> invite-accept, forgot-password or email-verification flow.
>
> `chk_users_email_lowercase` is the database half — a CHECK rather than `citext`
> (not enabled in this database) or a `UNIQUE INDEX ON lower(email)` (redundant
> once every value is lowercase, and it would break the `ON CONFLICT (email)`
> upserts in `dummy_data/`). It makes an un-normalized writer — an operator
> script, a psql session — fail loudly instead of silently forking an identity.
> `idx_users_org_email` therefore stays a plain-value index and is directly
> usable by the login lookup.
>
> Normalization is case + whitespace **only**: no dot-stripping or plus-tag
> removal, which are Gmail-specific and would merge genuinely distinct addresses.
> The identifier recorded in `audit.audit_log` on a failed login stays **raw** —
> it is the record of what was actually typed, and
> `audit.fn_detect_password_spray` groups on it.
>
> **Still open:** `lms.marketing_leads.email` and `ext.meta_leads.email` carry the
> identical case-sensitive dedup bug and were deliberately left out of this change.

---

### iam.user_org_mapping

Multi-org access control. Source of truth for which orgs a user can access.

> `iam.users.org_id` is **not** that source — it is only the user's *home*
> branch, the one they were created in. A user working several branches holds one
> row here per branch, so any read that answers "which branches is this user in"
> must come from this table. `listUsers` aggregates it per user into the
> `org_memberships` array on each roster row (see Architecture.md, *Multi-branch
> users on the roster*); reading `org_id` instead is what made multi-branch users
> disappear from the Admin → Team branch filter.

| Column     | Type        | Constraints                              |
| ---------- | ----------- | ---------------------------------------- |
| id         | UUID        | NOT NULL, DEFAULT gen_uuidv7(), UNIQUE (`uq_user_org_mapping_id`). Surrogate identity for the membership, for product extension tables to key off — **not** the PK |
| user_id    | UUID        | NOT NULL, FK → iam.users(id), PK (composite) |
| org_id     | UUID        | NOT NULL, FK → entity.organizations(id), PK (composite) |
| role_id    | UUID        | NOT NULL, FK → iam.user_roles(id)        |
| is_active  | BOOLEAN     | NOT NULL, DEFAULT TRUE                   |
| granted_by | UUID        | FK → iam.users(id)                       |
| granted_at | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()      |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()      |

**PK:** `(user_id, org_id)`  
**RLS:** Users can read own rows; org admins (rank >= 80) manage within their org; any user rank >= 40 (SSE, matches `minRankToAssignLeads`) can read other rows within their own org (`assignable_read_policy`, needed for the lead "Assigned To" picker); tenant_admin manages across tenant  
**Triggers:** `set_updated_at`, `auto_grant_all_orgs_on_tenant_admin`

#### Per-product settings on a membership — the extension pattern

`lead_assignment_weight` used to be a column on this table. It was pure LMS: only
leads-service's `resolveAutoAssignedUser` and its Python port in
`meta-sync-scripts` read it, no SQL object touched it, and `iam.vw_user_org_access`
did not expose it. Meanwhile this table is what `iam.fn_user_active_orgs`, the
reporting-line membership check and most RLS policies are built on — so every
product that wanted a per-branch, per-user setting would have added its own
column to the one table the whole platform depends on.

Schema 1.44.0 replaced that with a pattern. **Do not add another product column
here.** Instead:

1. The setting lives in a table in the **owning product's schema**
   (`lms.*`, `hr.*`, `task.*`) — never in `iam`.
2. It is keyed by `user_org_mapping_id UUID PRIMARY KEY REFERENCES
   iam.user_org_mapping(id) ON DELETE CASCADE`. That is what `id` exists for.
3. Its RLS resolves the branch through `iam.fn_mapping_org(user_org_mapping_id)`
   — the extension table has no `org_id`, and an inline subquery into
   `iam.user_org_mapping` would be re-filtered by that table's own `FORCE`d
   policies and return NULL, turning the policy silently FALSE. Copy the four
   policies from `lms.lead_assignment_weights` (`08_rls.sql`); they are this
   table's own policies with `org_id` replaced by that call, so the extension row
   is reachable exactly when the membership row is.
4. **No row means the default.** Do not write rows that only say "nothing set" —
   read with `COALESCE`.

`lms.lead_assignment_weights` below is the reference implementation.

---

### lms.lead_assignment_weights

% share of new leads a user auto-receives within one branch. The first table
built on the extension pattern above.

| Column              | Type        | Constraints                              |
| ------------------- | ----------- | ---------------------------------------- |
| user_org_mapping_id | UUID        | PK, FK → iam.user_org_mapping(id) ON DELETE CASCADE |
| weight              | SMALLINT    | NOT NULL, DEFAULT 0, CHECK 0-100         |
| updated_by          | UUID        | FK → iam.users(id) ON DELETE SET NULL    |
| created_at          | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()      |
| updated_at          | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()      |

**No row means weight 0** — the picker filters `weight > 0`, so absence and an
explicit zero mean the same thing and only non-zero weights are stored. An
existing row *can* hold 0: deactivating a user zeroes it rather than deleting it
(DELETE is revoked from `app_user`/`tenant_admin`, mirroring
`iam.user_org_mapping`).

The sum across a branch must be 100 (or all 0 to disable auto-assignment), and
that is enforced **only** in identity-service's `PUT /users/assignment-weights`.
`createUser`, `addOrgMapping`, `reconcileOrgAssignments` and every `one_time/`
onboarding script bypass it — a pre-existing gap the move preserved rather than
changed.

**Written by** identity-service (the user create/edit payload carries weights
alongside branch/role assignments, so the API field name is still
`lead_assignment_weight`). **Read by** leads-service's `resolveAutoAssignedUser`.
**RLS:** `org_admin_read/insert/update_policy` + `tenant_isolation_policy`, all
via `iam.fn_mapping_org`.  
**Triggers:** `set_updated_at`  
**View:** `lms.vw_lead_assignment_weights` restores the flat
`(user_id, org_id, weight)` shape for reporting and operator SQL.

---

### iam.reporting_lines

Effective-dated managerial hierarchy — the **single** source of truth for the whole platform
(P4, `1.27.0`). LMS lead assignment (`iam.can_assign_to`), HR leave/attendance approval
(`hr.can_approve_leave`, `resolveApprovers`/`buildApproverChain`) and Tasks team scope
(`isManagerOf`) all resolve from this one table, so "who is on my team" has one answer in every
product.

Was `hr.reporting_lines` until `1.27.0`, and only HR could read it — `07_grants.sql` REVOKEs each
product schema from the other products' logins, so a hierarchy owned by `hr` is unreadable by LMS
and Tasks by construction. It moved to `iam` (the shared tier) and absorbed the second tree,
`iam.users.manager_id`, which is now only a display mirror of this table.

Query it through the three functions rather than directly — each takes an **as-of date**, so any
authority question is answerable for any past date:
`iam.fn_is_in_subtree(manager, member, as_of)` (the authority primitive),
`iam.fn_subtree_members(manager, as_of)`, `iam.fn_manager_chain(user, as_of)`.
`iam.vw_user_team_members` / `iam.vw_user_org_chart` are `as_of = CURRENT_DATE` wrappers over them.

| Column         | Type        | Constraints                                                    |
| -------------- | ----------- | --------------------------------------------------------------- |
| id             | UUID        | PK (UUIDv7)                                                     |
| tenant_id      | UUID        | NOT NULL, FK → entity.tenants(id) ON DELETE CASCADE              |
| org_id         | UUID        | NOT NULL, FK → entity.organizations(id) ON DELETE CASCADE        |
| user_id        | UUID        | NOT NULL, FK → iam.users(id) ON DELETE CASCADE                   |
| manager_id     | UUID        | NOT NULL, FK → iam.users(id) ON DELETE RESTRICT                  |
| effective_from | DATE        | NOT NULL, DEFAULT CURRENT_DATE                                   |
| effective_to   | DATE        | NULL = currently-open line; CHECK effective_to > effective_from  |
| is_active      | BOOLEAN     | NOT NULL, DEFAULT TRUE                                           |
| is_deleted     | BOOLEAN     | NOT NULL, DEFAULT FALSE                                          |

**Constraints:** `user_id <> manager_id`; `EXCLUDE USING gist (org_id WITH =, user_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&) WHERE (NOT is_deleted)` — at most one active line per user per org at any instant.  
**RLS:** `app_user` reads (SELECT-only) rows in `app.current_org_id` and writes at rank ≥ 980 (mirrors `org_admin_manage_policy` on `iam.user_org_mapping`); `tenant_admin` reads/writes (no delete) within `app.current_tenant_id`; `hr_svc` reads/writes under RLS; `root_service` full access.  
**Triggers:** `set_org_id`, `set_created_by`, `check_reporting_line_membership`, `check_reporting_line_no_cycle`, `set_updated_at`, `soft_delete_row`, `sync_user_manager_mirror`, audit on UPDATE/DELETE. Plus `trg_user_org_mapping_close_lines` on `iam.user_org_mapping`.

**Cross-org managers** are granted through `iam.user_org_mapping` and nothing else.
`iam.check_reporting_line_membership()` requires **both** parties to hold an active mapping in the
line's `org_id`, so a manager shared across branches has one mapping and one line *per branch* and
no chain ever crosses an org boundary — which is what keeps the org-scoped RLS policy from
truncating a chain halfway. The guard skips closed and soft-deleted rows so that history stays
writable and revoking a mapping cannot deadlock against it.

**Revoking a mapping** closes every open line in that org where the departing user is manager or
report (`iam.close_reporting_lines_on_mapping_revoke()`). Orphaned reports are left line-less —
falling back to the deterministic `org_admin`/`hr_admin` approver — rather than silently
reparented onto the departing manager's own manager.

**`iam.users.manager_id`** is a deprecated single-valued display mirror of this table, maintained
by `sync_user_manager_mirror` (home-org line first, then most recently effective). Never read it
for authority.

---

### Retired: per-product role tables (`lms.roles`/`hr.roles`/`task.roles`, `<product>.member_roles`)

**These tables no longer exist.** They were introduced at P1.1 (`17_init-per-product-roles.sql`) as per-product role catalogs + `(user, product, role)` grant tables, each with its own ladder (`lms.roles` rank 0-100: read_only/sales_representative/senior_sales_executive/org_manager/org_sr_manager/lms_admin; similarly for `hr.roles`/`task.roles`), tenant-scoped by `22_tenant-scope-lookups.sql`, with resolver functions `<product>.fn_member_rank`/`<product>.fn_member_role` and a `<product>.vw_member_roles` view.

**Dropped at schema 1.40.0** (`db_scripts/one_time/drop_per_product_role_tables.sql`, with a `_dryrun` companion): `lms/hr/task.roles`, `lms/hr/task.member_roles`, the `fn_member_rank`/`fn_member_role` functions, `vw_member_roles`, and `public.set_member_role_tenant_id()`. The migration's own direction reversed — rather than each product owning an independent ladder, the platform consolidated back onto the single `iam.user_roles` table (see above) resolved per-org via `iam.fn_user_org_role`/`iam.fn_role_capability_matrix`. If you find code or Drizzle definitions still referencing `<product>.member_roles` or `fn_member_rank`, it is stale and should be removed — the current Drizzle schema (`msq-core/packages/db/src/schema/tables/*.ts`) already carries no `*-roles.table.ts` / `*-member-roles.table.ts` files, confirming the drop was carried through the ORM layer.

Architecture.md's "Permissions" section (`LMS_RANKS`/`HR_RANKS`/`TASK_RANKS` from `lms.member_roles`/`hr.member_roles`/`task.member_roles`) predates this drop and needs the same correction — those ladders now resolve from `iam.user_roles`/`iam.fn_user_org_role`, not a product-specific grant table.

---

### Tenant-scoped lookups — task.task_statuses / task.task_priorities / hr.leave_types / hr.employment_types / hr.attendance_statuses

Originally global lookups (`10_init-hr-task-schemas.sql`, `14_init-tasks.sql`), converted to tenant-scoped by `22_tenant-scope-lookups.sql`. Every tenant starts with an identical seeded catalog, but **P3.3** added the per-tenant customization API, and **N-6 (Half A)** moved it from admin-service to the **owning product service**: `GET/POST /lookups/{task-statuses,task-priorities}` (tasks-service) and `/lookups/{leave-types,employment-types,attendance-statuses}` (hr-service), plus the matching `PATCH .../:id`, each requiring a `tenant_id` query param. Instead of the old super_admin→BYPASSRLS path (which needed an explicit `WHERE tenant_id`), the write now runs as the product-scoped login via `withTenantConfigTx`, pinning `app.current_tenant_id` to the selected tenant; `25_lookup-admin-write-rls.sql` adds a tenant-pinned admin write policy (`FOR ALL TO app_user` keyed on `app.current_tenant_id`) + `INSERT,UPDATE` GRANTs to `hr_svc`/`task_svc`, so a write physically cannot touch another tenant's rows (the explicit `WHERE tenant_id` is kept as defense-in-depth). `apps/lookup-admin` gates editing behind a tenant selector. See "Lookup table administration" in Architecture.md. `hr.leave_request_statuses` was deliberately held back at that pass, but was itself converted to tenant-scoped at schema **1.26.0** — it now carries `tenant_id NOT NULL` and follows the same shape/RLS as its siblings; it is no longer global.

| Column      | Type    | Constraints                                          |
| ----------- | ------- | ----------------------------------------------------- |
| id          | UUID    | PK (UUIDv7)                                           |
| tenant_id   | UUID    | NOT NULL, FK → entity.tenants(id) ON DELETE CASCADE   |
| name        | TEXT    | NOT NULL, UNIQUE per `(tenant_id, name)`              |
| label       | TEXT    | NOT NULL                                              |
| description | TEXT    |                                                        |
| is_active   | BOOLEAN | NOT NULL, DEFAULT TRUE                                |

Plus per table: `task.task_statuses.is_terminal` (BOOLEAN), `task.task_statuses`/`task.task_priorities`/`hr.leave_types`.`sort_order` (INT), `hr.leave_types.is_paid` (BOOLEAN).

**RLS:** app_user `SELECT`s rows for the tenant owning its current org (`org_isolation_policy`); tenant_admin `SELECT`s rows for its own tenant directly (`tenant_isolation_policy`).
**Grants:** `SELECT` to app_user/tenant_admin (unchanged); `ALL` to root_service.
**Dependents repointed by the migration:** `task.tasks.status_id`/`priority_id`, `task.task_status_log.old_status_id`/`new_status_id`, `hr.employee_profiles.employment_type_id`, `hr.leave_policies.leave_type_id`, `hr.leave_requests.leave_type_id`, `hr.leave_ledger.leave_type_id`, `hr.attendance_days.status_id`, `hr.attendance_regularizations.requested_status_id`.
**Provisioning:** a brand-new tenant is seeded from the versioned default catalogs below via `entity.seed_tenant_defaults()` (Phase 3B, `23_tenant-default-catalogs.sql`). `hr.hr_settings`/`hr.leave_policies` remain a separate follow-up.

---

### Tenant default catalogs (P3B, `23_tenant-default-catalogs.sql`)

Versioned default-catalog registry + provisioning seeder that gives a brand-new tenant a **private copy** of each licensed product's lookup catalog, and an explicit opt-in "reset to defaults" path. Editing a default never retroactively changes an existing tenant — their copy was made from the version current at provisioning time.

**`entity.catalog_defaults`** — immutable, versioned default rows for every catalog (append-only: a new default = a new `version`, never an UPDATE of a shipped version).

| Column                        | Type    | Notes                                                    |
| ----------------------------- | ------- | -------------------------------------------------------- |
| id                            | UUID    | PK (UUIDv7)                                              |
| catalog_key                   | TEXT    | schema-qualified target, e.g. `task.task_statuses`       |
| product                       | TEXT    | owning product (`lms`/`leave`/`attendance`/`tasks`)      |
| version                       | INT     | catalog version this row belongs to                      |
| name / label / description    | TEXT    | copied verbatim into the tenant's row                    |
| sort_order                    | INT     | NOT NULL DEFAULT 0                                        |
| is_active                     | BOOLEAN | NOT NULL DEFAULT TRUE                                     |
| is_terminal / is_paid / rank  |         | NULLABLE per-catalog extras (task statuses / leave types / roles) |

`UNIQUE (catalog_key, version, name)`.

**`entity.catalog_versions`** — one row per catalog: `current_version` (which version a NEW tenant gets) + `modules TEXT[]` (seed only if the tenant has ANY of these active `entity.tenant_modules`). Editing a catalog for future tenants = insert v N+1 rows into `catalog_defaults` and bump `current_version`. The **six** registered catalogs and their gating modules: `task.task_statuses`/`task.task_priorities`→`{tasks}`; `hr.leave_types`/`hr.leave_request_statuses`→`{leave}`; `hr.attendance_statuses`→`{attendance}`; `hr.employment_types`→`{leave,attendance}` (HR-wide). The former `lms.roles`/`hr.roles`/`task.roles` catalogs were removed at schema_version 1.19.0 along with the tables they seeded — role/rank resolution runs on the single `iam.user_roles` ladder now (see `reference_data/07_catalog_registry.sql:86-90`).

**`entity.tenant_catalog_versions`** — per-tenant record of the seeded/reset version per catalog. `UNIQUE (tenant_id, catalog_key)`; `tenant_id` FK → `entity.tenants` ON DELETE CASCADE. Drives seeder idempotency (a catalog already recorded is never re-seeded). **RLS:** SELECT-only, mirroring `entity.tenant_modules` (app_user via current org, tenant_admin own tenant); only `root_service` writes.

**Functions** (all `REVOKE`d from PUBLIC, `EXECUTE` to `root_service` only — they cross tenant boundaries and run under `withServiceTx`):

- `entity.seed_tenant_defaults(tenant_id)` → provisioning entry point; copies each licensed, not-yet-seeded catalog's current version into the tenant's private tables (`ON CONFLICT DO NOTHING`) and records the version. Idempotent; call **after** the tenant's `tenant_modules` rows exist.
- `entity.reset_tenant_catalog(tenant_id, catalog_key, version?)` → restores one catalog to a default version (defaults to current): re-adds deleted defaults and restores default label/flags/sort_order **without changing row ids** (FK-safe); leaves tenant-custom rows untouched.
- `entity._apply_catalog_rows(tenant_id, catalog_key, version, reset)` → shared per-catalog copy helper.

TS wrappers: `seedTenantDefaults()` / `resetTenantCatalog()` / `getTenantCatalogVersions()` in `@platform/db` (`packages/db/src/seed-tenant-defaults.ts`).

#### Two provisioning mechanisms — and what the Catalog Versions screen can see

Per-tenant catalog provisioning happens through **two unrelated mechanisms**. Only the first is version-tracked, and the lookup-admin **Catalog Versions** screen (`/dashboard/catalogs`) can only ever report on that one.

| | Mechanism 1 — versioned registry | Mechanism 2 — template-row cloning |
| --- | --- | --- |
| Entry point | `entity.seed_tenant_defaults()` (`04_functions_triggers.sql`) | `entity.seed_tenant_lms_catalogs()` + `seed_tenant_rbac` / `seed_tenant_comms` / `seed_tenant_geo` (`10_tenant_provisioning.sql`) |
| Source of defaults | `entity.catalog_defaults` rows, keyed by `(catalog_key, version)` | rows with `tenant_id IS NULL` living in the target table itself |
| Version tracking | `entity.tenant_catalog_versions` | **none** |
| Covers | the six catalogs above | `lms.lead_stage`, `lms.lead_stage_outcome`, `lms.interaction_types`, `lms.follow_up_statuses`, `lms.lead_sources`, `marketing.marketing_platforms`, `marketing.campaign_statuses`, `ext.lead_stage_capi_event_map`, plus RBAC / comms / geo |
| Visible on Catalog Versions? | yes | **no** — the report cross-joins `entity.catalog_versions`, which has no rows for these |

Both mechanisms insert `ON CONFLICT DO NOTHING` and neither back-fills retroactively, so a default added after a tenant was provisioned silently never reaches it. For mechanism 1 that at least surfaces as a red cell; for mechanism 2 there is **no visibility at all**. This has already caused two production defects — see `02_tables_core.sql` (marketing platforms / campaign statuses were RLS'd but never cloned, so every tenant saw empty dropdowns) and the `KNOWN FOLLOW-UP` note it references.

**Mechanism 2 depends on the template rows still existing.** `seed_tenant_lms_catalogs()` clones `WHERE tenant_id IS NULL`; if those rows are absent, it silently clones nothing and a newly provisioned tenant gets an empty LMS. The templates are (re)created by `reference_data/04_lms_catalog_templates.sql`, which is idempotent and touches only `tenant_id IS NULL` rows. Verify with:

```sql
SELECT count(*) FILTER (WHERE tenant_id IS NULL) AS templates, count(*) AS total FROM lms.lead_stage;
```

#### Meta / CAPI tables — which are catalogs and which are not

Only one Meta table is catalog-shaped, which is why the rest correctly never appear on the Catalog Versions screen:

- `ext.lead_stage_capi_event_map` — **tenant-scoped catalog**, cloned per tenant by mechanism 2. Untracked and unversioned.
- `ext.meta_capi_event_types` — deliberately **global** vocabulary, no `tenant_id`. Not per-tenant, so nothing to drift.
- `ext.meta_tenant_config`, `ext.meta_page_form_org_map`, `ext.meta_forms` — per-tenant **credentials and page→org routing config**, not defaults cloned from a platform template. Each tenant's values are unique by nature; there is no version to compare against.

---

### Per-product DB role GRANTs (P1.2, D8, `19_init-per-product-db-grants.sql`)

`lms_svc` / `hr_svc` / `task_svc` are the three product-operational logins (leads-service + meta-conversion-api / hr-service / tasks-service). Each is `NOINHERIT` and:

- Has **direct** `SELECT`/`INSERT`/`UPDATE` grants on its own product schema's tables only (`lms`/`marketing`/`ext` for `lms_svc`, `hr` for `hr_svc`, `task` for `task_svc`) — mirrors exactly what `app_user` already granted per table.
- Has **`SELECT`-only** on the shared `iam`/`entity`/`geo` schemas (D8: "read shared"), except `iam.users`/`iam.user_org_mapping` which stay `SELECT, INSERT, UPDATE` because every product's "manage team" UI still writes org-role assignment through these tables under `app_user`'s existing RLS policies.
- Has **zero** privilege on the other two products' schemas (explicitly `REVOKE`d as a defense-in-depth statement, not just an absence).
- Is a **member** of `app_user`/`tenant_admin` for RLS-policy matching only — Postgres checks `TO app_user` policies by role membership, independent of `INHERIT`, so this membership satisfies every existing RLS policy without granting any of `app_user`'s (cross-schema) table privileges.

`@platform/db`'s `withRoleTx` (`packages/db/src/transaction.ts`) skips `SET LOCAL ROLE app_user` when `DB_PRODUCT_SCOPED_LOGIN=true` (set in these three services' env) — running `SET ROLE app_user` would otherwise hand the connection every schema `app_user` can touch, undoing the isolation. `identity-service`/`notifications-service`/`admin-service` still connect as the shared `lead_svc` (unrestricted, `SET ROLE app_user` unchanged) — they are shared-repo/platform services that legitimately manage `iam`/`entity` directly; not in scope for this pass.

`tenant_dash_svc` (tenant_admin pool) and `root_service` (BYPASSRLS) are unchanged — both are intentionally shared, cross-product roles.

---

### iam.token_blocklist

DB-backed JWT revocation supporting multiple scope levels.

| Column     | Type        | Constraints                                  |
| ---------- | ----------- | -------------------------------------------- |
| id         | UUID        | PK (UUIDv7)                                  |
| jti        | TEXT        | Unique (partial, WHERE NOT NULL)             |
| user_id    | UUID        | FK → iam.users(id)                           |
| org_id     | UUID        | FK → entity.organizations(id)               |
| tenant_id  | UUID        |                                              |
| revoked_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                      |
| revoked_by | UUID        | FK → iam.users(id)                           |
| reason     | TEXT        |                                              |
| expires_at | TIMESTAMPTZ | NOT NULL                                     |

**Check:** At least one of jti, user_id, org_id, tenant_id must be non-null

---

### iam.departments

Org-level department catalog. Required parent of `iam.user_roles.department_id`, and referenced by `hr.employee_profiles.department_id`.

| Column      | Type        | Constraints                                     |
| ----------- | ----------- | ------------------------------------------------ |
| id          | UUID        | PK (UUIDv7)                                       |
| tenant_id   | UUID        | NOT NULL, FK → entity.tenants(id) ON DELETE CASCADE |
| org_id      | UUID        | FK → entity.organizations(id) ON DELETE RESTRICT  |
| name        | TEXT        | NOT NULL                                          |
| label       | TEXT        | NOT NULL                                          |
| description | TEXT        |                                                    |
| is_active   | BOOLEAN     | NOT NULL, DEFAULT TRUE                            |
| is_deleted  | BOOLEAN     | NOT NULL, DEFAULT FALSE                           |
| deleted_at  | TIMESTAMPTZ |                                                    |
| deleted_by  | UUID        |                                                    |
| created_by  | UUID        |                                                    |
| created_at  | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()               |
| updated_at  | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()               |

**Check:** `NOT (is_active AND is_deleted)`. Writable from the app since schema **1.39.0** (was list-only before). Read via `GET /departments?tenant_id=` (admin-service, super_admin only); written by hr-service.

---

### iam.api_clients

Machine-to-machine API credentials for the Public API (tenant-issued keys, not user sessions).

| Column              | Type        | Constraints                                              |
| ------------------- | ----------- | ---------------------------------------------------------- |
| id                  | UUID        | PK, DEFAULT gen_uuidv7()                                    |
| tenant_id           | UUID        | NOT NULL, FK → entity.tenants(id) ON DELETE CASCADE          |
| name                | VARCHAR(120)| NOT NULL                                                     |
| key_prefix          | TEXT        | NOT NULL — display-only, e.g. `crmk_live_Ab12Cd`             |
| key_hash            | TEXT        | NOT NULL, UNIQUE — HMAC-SHA256(pepper, raw key); the raw key is never stored |
| scopes              | TEXT[]      | NOT NULL, DEFAULT '{}'                                       |
| rate_limit_per_min  | INTEGER     | NOT NULL, DEFAULT 60                                         |
| scope_all_orgs      | BOOLEAN     | NOT NULL, DEFAULT FALSE — TRUE = tenant-wide, ignores `iam.api_client_orgs` |
| is_active           | BOOLEAN     | NOT NULL, DEFAULT TRUE                                       |
| expires_at          | TIMESTAMPTZ |                                                               |
| last_used_at        | TIMESTAMPTZ |                                                               |
| revoked_at          | TIMESTAMPTZ |                                                               |
| created_by          | UUID        | FK → iam.users(id) ON DELETE SET NULL                        |
| created_at          | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                                       |
| updated_at          | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                                       |

Managed from `admin-web`'s API tokens screen (`app/dashboard/api-tokens`).

---

### iam.api_client_orgs

Per-org scoping for an API client that is not tenant-wide.

| Column        | Type | Constraints                                                          |
| ------------- | ---- | ---------------------------------------------------------------------- |
| api_client_id | UUID | NOT NULL, FK → iam.api_clients(id) ON DELETE CASCADE, PK (composite)   |
| org_id        | UUID | NOT NULL, FK → entity.organizations(id) ON DELETE CASCADE, PK (composite) |

Zero rows for a client means tenant-wide — but that shape is only valid when the client's `scope_all_orgs = TRUE`; a non-tenant-wide client with zero rows here has access to nothing.

---

### lms.lead_stage

Pipeline stages for leads.

> **Tenant-scoped (`26_tenant-scope-lms-lookups.sql`, N-6 Half B):** this and the other 6 LMS marketing lookups (`lead_stage_outcome`, `interaction_types`, `follow_up_statuses`, `lead_sources`, `marketing.marketing_platforms`, `marketing.campaign_statuses`) were originally **global** reference data. Script 26 added `tenant_id NOT NULL` + RLS, replaced the global `UNIQUE(name)` with `UNIQUE(tenant_id, name)`, migrated each global row into one copy per tenant, and repointed every dependent FK (`marketing_leads`, `lead_follow_ups`, `lead_status_log`, `lead_interactions`, `ad_campaigns`, `ext.lead_stage_capi_event_map`, self-ref `lead_stage_outcome.stage_id`) at the correct tenant's copy. The follow-up-status default/sync triggers, which resolved statuses by name globally, were rewritten to scope by the follow-up's own tenant. Runtime RLS is SELECT-only for `app_user`/`tenant_admin`; super_admin management CRUD moved to **leads-service** under the tenant-pinned admin write policy (see `lms.roles` note and Architecture.md → "Tenant-scoped lookup tables"). Seed values below are the per-tenant defaults each existing tenant was backfilled with.

| Column            | Type    | Constraints      |
| ----------------- | ------- | ---------------- |
| id                | UUID    | PK (UUIDv7)      |
| tenant_id         | UUID    | NOT NULL, FK → entity.tenants(id) |
| name              | TEXT    | NOT NULL; UNIQUE per (tenant_id, name) |
| label             | TEXT    | NOT NULL         |
| description       | TEXT    |                  |
| sort_order        | INT     | NOT NULL, DEFAULT 0 |
| followup_required | BOOLEAN | NOT NULL, DEFAULT FALSE |
| is_rejected       | BOOLEAN | NOT NULL, DEFAULT FALSE |
| is_terminated     | BOOLEAN | NOT NULL, DEFAULT FALSE |
| is_active         | BOOLEAN | NOT NULL, DEFAULT TRUE  |

**Seed values:**

| sort | name             | followup_required | is_rejected | is_terminated |
| ---- | ---------------- | ----------------- | ----------- | ------------- |
| 1    | new              | false             | false       | false         |
| 2    | contacting       | true              | false       | false         |
| 3    | on_hold          | true              | false       | false         |
| 4    | qualified        | true              | false       | false         |
| 5    | converted        | false             | false       | true          |
| 6    | unqualified      | false             | true        | true          |
| 7    | transferred_out  | false             | false       | true          |

`is_terminated = false` is what the weighted auto-assignment deficit calculation uses to count a user's "open workload" (`new`/`contacting`/`on_hold`/`qualified`) — it never hardcodes stage names, so any future non-terminal stage is picked up automatically.

---

### lms.lead_stage_outcome

Outcome options per stage.

| Column           | Type    | Constraints                               |
| ---------------- | ------- | ----------------------------------------- |
| id               | UUID    | PK (UUIDv7)                               |
| stage_id         | UUID    | NOT NULL, FK → lms.lead_stage(id)         |
| name             | TEXT    | NOT NULL                                  |
| label            | TEXT    | NOT NULL                                  |
| description      | TEXT    |                                           |
| requires_comment | BOOLEAN | NOT NULL, DEFAULT FALSE                   |
| sort_order       | INT     | NOT NULL, DEFAULT 0                       |
| is_active        | BOOLEAN | NOT NULL, DEFAULT TRUE                    |

**Unique:** `(stage_id, name)`

**Seed values by stage:**
- **contacting:** not_connected, switch_off, not_answered, call_back_later
- **qualified:** visit_scheduled, visited
- **converted:** membership_sold
- **unqualified:** no_response_after_multiple_attempts, wrong_number, job_applicant, budget_issue, not_interested, location_issue, duplicate_lead, other (requires_comment)
- **transferred_out:** transferred_to_other_branch

---

### lms.interaction_types

| Column      | Type    | Constraints             |
| ----------- | ------- | ------------------------ |
| id          | UUID    | PK (UUIDv7)              |
| name        | TEXT    | NOT NULL, UNIQUE         |
| label       | TEXT    | NOT NULL                 |
| description | TEXT    |                          |
| is_active   | BOOLEAN | NOT NULL, DEFAULT TRUE   |

**Seed values:** call, whatsapp, email, sms, in_person, video_call, chat, internal_note

---

### lms.follow_up_statuses

| Column      | Type    | Constraints             |
| ----------- | ------- | ------------------------ |
| id          | UUID    | PK (UUIDv7)              |
| name        | TEXT    | NOT NULL, UNIQUE         |
| label       | TEXT    | NOT NULL                 |
| description | TEXT    |                          |
| is_active   | BOOLEAN | NOT NULL, DEFAULT TRUE   |

**Seed values:** pending, completed, missed, rescheduled

---

### lms.lead_sources

| Column      | Type    | Constraints             |
| ----------- | ------- | ------------------------ |
| id          | UUID    | PK (UUIDv7)              |
| name        | TEXT    | NOT NULL, UNIQUE         |
| label       | TEXT    | NOT NULL                 |
| is_active   | BOOLEAN | NOT NULL, DEFAULT TRUE   |

**Seed values:** facebook, google, instagram, whatsapp, website_form, referral, walk_in, cold_call, other

---

### lms.marketing_leads

Core lead entity. `full_name` is GENERATED STORED.

| Column            | Type        | Constraints                                  |
| ----------------- | ----------- | -------------------------------------------- |
| id                | UUID        | PK (UUIDv7)                                  |
| org_id            | UUID        | NOT NULL, FK → entity.organizations(id)      |
| first_name        | TEXT        | NOT NULL                                     |
| middle_name       | TEXT        |                                              |
| last_name         | TEXT        | NOT NULL, DEFAULT ''                         |
| full_name         | TEXT        | GENERATED ALWAYS AS STORED                   |
| phone             | TEXT        |                                              |
| email             | TEXT        |                                              |
| address_line1     | TEXT        |                                              |
| address_line2     | TEXT        |                                              |
| landmark          | TEXT        |                                              |
| pincode           | TEXT        |                                              |
| city              | TEXT        | Free-text city                               |
| city_id           | INTEGER     | FK → geo.cities(id)                          |
| state_id          | SMALLINT    | FK → geo.states(id)                          |
| country_id        | SMALLINT    | FK → geo.countries(id)                       |
| stage_id          | UUID        | FK → lms.lead_stage(id)                      |
| outcome_id        | UUID        | FK → lms.lead_stage_outcome(id)              |
| outcome_comment   | TEXT        |                                              |
| campaign_id       | UUID        | FK → marketing.ad_campaigns(id)              |
| source_id         | UUID        | FK → lms.lead_sources(id)                    |
| assigned_user_id  | UUID        | FK → iam.users(id)                           |
| is_active         | BOOLEAN     | NOT NULL, DEFAULT TRUE; FALSE when superseded or transferred out |
| superseded_by     | UUID        | FK → lms.marketing_leads(id) self-ref; old row → newer active row |
| raw_webhook_data  | JSONB       | NOT NULL, DEFAULT '{}'                       |
| metadata          | JSONB       | NOT NULL, DEFAULT '{}'                       |
| tags              | TEXT[]      | NOT NULL, DEFAULT '{}'                       |
| is_deleted        | BOOLEAN     | NOT NULL, DEFAULT FALSE                      |
| deleted_at        | TIMESTAMPTZ |                                              |
| deleted_by        | UUID        |                                              |
| created_by        | UUID        |                                              |
| created_at        | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()          |
| updated_at        | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()          |

**Unique indexes (partial):** `(org_id, phone) WHERE phone IS NOT NULL AND NOT is_deleted AND is_active = true`, `(org_id, email) WHERE email IS NOT NULL AND NOT is_deleted AND is_active = true` — uniqueness enforced only among active leads; superseded rows may share the same phone/email  
**RLS:** org-scoped for app_user; tenant-scoped for tenant_admin  
**Triggers:** `set_updated_at`, `soft_delete_row`, `set_org_id`, `set_created_by`, `check_lead_stage_outcome`, `check_lead_fk_org_scope`, `log_lead_assignment`, `log_lead_stage_change`, `audit_marketing_leads_changes`

---

### lms.lead_links

Audit trail for all lead-to-lead relationships. `link_type = 'merge'` covers same-org re-submission dedup and walk-in dedup (replaces the old `duplicate_lead_id`). `link_type = 'transfer'` covers executive cross-org transfers. Both orgs involved in a record can read it via RLS.

| Column         | Type        | Notes                                                  |
|----------------|-------------|--------------------------------------------------------|
| id             | UUID        | PK, gen_uuidv7()                                       |
| source_lead_id | UUID        | NOT NULL, FK → lms.marketing_leads(id)                 |
| source_org_id  | UUID        | NOT NULL, FK → entity.organizations(id)                |
| dest_lead_id   | UUID        | FK → lms.marketing_leads(id); nullable until dest created |
| dest_org_id    | UUID        | NOT NULL, FK → entity.organizations(id)                |
| link_type      | TEXT        | NOT NULL; `'merge'` or `'transfer'`                    |
| created_by     | UUID        | FK → iam.users(id)                                     |
| reason         | TEXT        |                                                        |
| notes          | TEXT        |                                                        |
| status         | TEXT        | NOT NULL, DEFAULT `'completed'`; `'pending'`, `'completed'`, `'rejected'` |
| created_at     | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()                    |
| updated_at     | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()                    |

**RLS:** both `source_org_id` and `dest_org_id` can SELECT — allows cross-org transfer visibility without exposing the other org's lead data.

---

### lms.lead_interactions

Append-only interaction log (no updated_at).

| Column              | Type        | Constraints                                  |
| ------------------- | ----------- | -------------------------------------------- |
| id                  | UUID        | PK (UUIDv7)                                  |
| org_id              | UUID        | NOT NULL, FK → entity.organizations(id)      |
| lead_id             | UUID        | NOT NULL, FK → lms.marketing_leads(id)       |
| user_id             | UUID        | NOT NULL, FK → iam.users(id)                 |
| interaction_type_id | UUID        | FK → lms.interaction_types(id)               |
| notes               | TEXT        |                                              |
| duration_seconds    | INT         |                                              |
| occurred_at         | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()          |
| is_deleted          | BOOLEAN     | NOT NULL, DEFAULT FALSE                      |
| deleted_at          | TIMESTAMPTZ |                                              |
| deleted_by          | UUID        |                                              |
| created_by          | UUID        |                                              |
| created_at          | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()          |

**RLS:** org + tenant isolation  
**Triggers:** `soft_delete_row`, `set_org_id`, `set_created_by`, `check_interaction_fk_org_scope`, `audit_row_changes`

---

### lms.lead_follow_ups

Scheduled follow-up tasks.

| Column           | Type        | Constraints                                  |
| ---------------- | ----------- | -------------------------------------------- |
| id               | UUID        | PK (UUIDv7)                                  |
| org_id           | UUID        | NOT NULL, FK → entity.organizations(id)      |
| lead_id          | UUID        | NOT NULL, FK → lms.marketing_leads(id)       |
| assigned_user_id | UUID        | NOT NULL, FK → iam.users(id)                 |
| status_id        | UUID        | NOT NULL, FK → lms.follow_up_statuses(id)    |
| scheduled_at     | TIMESTAMPTZ | NOT NULL                                     |
| completed_at     | TIMESTAMPTZ |                                              |
| notes            | TEXT        |                                              |
| is_deleted       | BOOLEAN     | NOT NULL, DEFAULT FALSE                      |
| deleted_at       | TIMESTAMPTZ |                                              |
| deleted_by       | UUID        |                                              |
| created_by       | UUID        |                                              |
| created_at       | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()          |
| updated_at       | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()          |

**RLS:** org + tenant isolation  
**Triggers:** `set_updated_at`, `soft_delete_row`, `set_org_id`, `set_created_by`, `check_follow_up_completion`, `check_follow_up_fk_org_scope`, `set_default_follow_up_status`, `sync_follow_up_status`, `audit_row_changes`

**On `notes` — intentional duplication.** When one Edit Lead save both changes the lead and
schedules a follow-up, the operator's single note is stored twice: here, and on
`lead_status_log.transition_note` / `lead_assignment_log.note` (both fed from the
`app.lead_transition_note` GUC). This is deliberate, not drift — `lead_follow_ups.notes` is
what `vw_followup_pipeline_enriched` surfaces as the NOTES column on the Missed/Overdue
follow-up screen, while the log copy is the audit record of *why* the change happened.
Neither may be dropped. The duplicate is resolved **on read** in `LeadHistoryModal.tsx`
(`suppressDuplicateFollowUpNotes`), where the log copy wins so Lead History shows the note
once; a follow-up note with no matching log entry is always shown.

---

### lms.lead_assignment_log

Immutable log of lead assignment changes. Auto-populated by trigger.

| Column               | Type        | Constraints                                 |
| -------------------- | ----------- | ------------------------------------------- |
| id                   | UUID        | PK (UUIDv7)                                 |
| org_id               | UUID        | NOT NULL, FK → entity.organizations(id)     |
| lead_id              | UUID        | NOT NULL, FK → lms.marketing_leads(id)      |
| assigned_by_id       | UUID        | FK → iam.users(id)                          |
| assigned_to_id       | UUID        | FK → iam.users(id)                          |
| previous_assignee_id | UUID        | FK → iam.users(id)                          |
| action               | TEXT        | NOT NULL, DEFAULT 'reassigned'              |
| note                 | TEXT        |                                             |
| assigned_at          | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()         |

**Action values:** initial, reassigned, unassigned, self_assigned, bulk_assigned  
**RLS:** org + tenant isolation (SELECT only for non-service roles)

**Bulk moves are labelled.** The branch-transfer and deactivation flows both reach this table
through `POST /internal/leads/reassign-org`, which sets `app.lead_transition_note` before the
UPDATE so every row it produces carries a stamped `note` — `Leads bulk transferred: previous
owner moved to another branch`, or `… was deactivated`, and `Leads bulk unassigned: …` when no
successor was named. `vw_lead_history` appends it to its generated sentence, so the row reads
`Reassigned from X to Y — Leads bulk transferred: …`. Without it Lead History could not tell a bulk move apart from a manual
reassign. The cause comes from identity-service as the request's `reason` field; it is optional,
so an older caller degrades to a cause-neutral note rather than failing.

---

### lms.lead_status_log

Immutable stage/outcome transition log. Written by trigger.

| Column           | Type        | Constraints                                  |
| ---------------- | ----------- | -------------------------------------------- |
| id               | UUID        | PK (UUIDv7)                                  |
| org_id           | UUID        | NOT NULL, FK → entity.organizations(id)      |
| lead_id          | UUID        | NOT NULL, FK → lms.marketing_leads(id)       |
| changed_by_id    | UUID        | FK → iam.users(id)                           |
| old_stage_id     | UUID        | FK → lms.lead_stage(id)                      |
| new_stage_id     | UUID        | NOT NULL, FK → lms.lead_stage(id)            |
| old_outcome_id   | UUID        | FK → lms.lead_stage_outcome(id)              |
| new_outcome_id   | UUID        | FK → lms.lead_stage_outcome(id)              |
| assigned_user_id | UUID        | FK → iam.users(id)                           |
| transition_note  | TEXT        |                                              |
| changed_at       | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()          |

**RLS:** SELECT-only for app_user + tenant_admin

---

### lms.lead_report_snapshot

Day-over-day comparison history for the daily lead report. One row per
(branch × assignee × source × report_date), written once a day by the
leads-service report job (`upsertReportSnapshot`, idempotent via `ON CONFLICT`)
and read back by the report page's `?compare=YYYY-MM-DD` mode.

| Column               | Type        | Constraints                                                      |
| -------------------- | ----------- | ---------------------------------------------------------------- |
| tenant_id            | UUID        | NOT NULL, FK → entity.tenants(id) ON DELETE CASCADE               |
| org_id               | UUID        | NOT NULL, FK → entity.organizations(id) ON DELETE CASCADE         |
| org_name             | TEXT        | NOT NULL                                                          |
| assigned_user_id     | UUID        | FK → iam.users(id) ON DELETE SET NULL; NULL = Unassigned bucket    |
| assignee             | TEXT        | NOT NULL                                                          |
| is_unassigned        | BOOLEAN     | NOT NULL, DEFAULT FALSE                                           |
| source_id            | UUID        | FK → lms.lead_sources(id) ON DELETE SET NULL; NULL = "Unknown"     |
| source_label         | TEXT        | NOT NULL, DEFAULT 'Unknown' — kept even if the source is renamed  |
| report_date          | DATE        | NOT NULL — branch-local calendar date                             |
| *(29 metric columns)* | INT        | NOT NULL DEFAULT 0 — see below                                    |
| captured_at          | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()                               |

UNIQUE NULLS NOT DISTINCT (tenant_id, org_id, assigned_user_id, source_id, report_date)

**The 29 metric columns** are the same set, in the same order, as
`lms.vw_lead_report_branch` / `lms.vw_lead_report_user` and as `METRIC_KEYS` in
the leads-service (`lib/reports/lead-report.types.ts`), which generates its SUM /
INSERT / ON CONFLICT column lists from that array. All four must stay in
lock-step. The set is:

- **core (6):** `total_leads`, `unassigned_count`, `followup_scheduled`,
  `followup_overdue`, `new_leads_today`, `new_leads_this_month`
- **per stage (7):** one per `lms.lead_stage.name` in `sort_order` —
  `new_count`, `contacting_count`, `on_hold_count`, `qualified_count`,
  `converted_count`, `unqualified_count`, `transferred_out_count`
- **per stage outcome (16):** one per non-`other` `lms.lead_stage_outcome.name`,
  prefixed `oc_` so the `on_hold` *stage* and the `on_hold` *outcome* do not
  collide on a column name — e.g. `oc_visit_scheduled_count`, `oc_visited_count`,
  `oc_membership_sold_count`

Every stage and outcome is captured even though any given screen renders a
handful. A live counter can be added at any time and is instantly correct for all
history (it is computed from `lms.marketing_leads` on read), but this table is
the half that can never be backfilled — a metric not captured today has no
comparison history tomorrow. So adding a KPI card or a report column is a
UI-only change.

Counters are **current state**, not "ever reached": `stage_id`/`outcome_id` hold
what the lead reads as right now, and `outcome_id` is overwritten when the lead
moves on, so a lead that visited and then converted leaves `oc_visited_count` and
joins `converted_count`.

`DEFAULT 0` on the metric columns is load-bearing, not decoration: it keeps the
table writable by an older build of leads-service whose snapshot INSERT names only
the original 8 metric columns, so the service can be rolled back without a
database rollback. Do not replace it with a bare `NOT NULL`.

Adding metrics to an existing server is `db_scripts/one_time/apply_lead_report_metrics.sql`
(`ALTER TABLE ... ADD COLUMN`, O(1) on PG 11+, no rewrite, rows preserved) —
`apply_schema.ps1` deliberately does not re-run `02_tables_core.sql` on a populated
database. Rows written before a metric existed read 0 for it and are not
backfillable, since stage/outcome are current state and have since moved.

**RLS:** SELECT-only for app_user (by org_id) + tenant_admin (by tenant_id)

---

### marketing.marketing_platforms

| Column      | Type    | Constraints             |
| ----------- | ------- | ------------------------ |
| id          | UUID    | PK (UUIDv7)              |
| name        | TEXT    | NOT NULL, UNIQUE         |
| label       | TEXT    | NOT NULL                 |
| description | TEXT    |                          |
| is_active   | BOOLEAN | NOT NULL, DEFAULT TRUE   |

**Seed values:** facebook, google, instagram, youtube, whatsapp, linkedin, tiktok, organic, referral, whatsapp_ads

---

### marketing.campaign_statuses

| Column      | Type    | Constraints             |
| ----------- | ------- | ------------------------ |
| id          | UUID    | PK (UUIDv7)              |
| name        | TEXT    | NOT NULL, UNIQUE         |
| label       | TEXT    | NOT NULL                 |
| description | TEXT    |                          |
| is_active   | BOOLEAN | NOT NULL, DEFAULT TRUE   |

**Seed values:** draft, active, paused, completed, archived

---

### marketing.ad_campaigns

| Column     | Type         | Constraints                                     |
| ---------- | ------------ | ----------------------------------------------- |
| id         | UUID         | PK (UUIDv7)                                     |
| org_id     | UUID         | NOT NULL, FK → entity.organizations(id)         |
| name       | TEXT         | NOT NULL                                        |
| platform_id| UUID         | NOT NULL, FK → marketing.marketing_platforms(id) |
| status_id  | UUID         | NOT NULL, FK → marketing.campaign_statuses(id)   |
| budget     | NUMERIC(12,2)|                                                  |
| started_at | TIMESTAMPTZ  |                                                  |
| ended_at   | TIMESTAMPTZ  |                                                  |
| is_deleted | BOOLEAN      | NOT NULL, DEFAULT FALSE                          |
| deleted_at | TIMESTAMPTZ  |                                                  |
| deleted_by | UUID         |                                                  |
| created_by | UUID         |                                                  |
| created_at | TIMESTAMPTZ  | NOT NULL, DEFAULT CLOCK_TIMESTAMP()              |
| updated_at | TIMESTAMPTZ  | NOT NULL, DEFAULT CLOCK_TIMESTAMP()              |

**Check:** `ended_at IS NULL OR started_at IS NULL OR started_at < ended_at`  
**RLS:** org + tenant isolation  
**Triggers:** `set_updated_at`, `soft_delete_row`, `set_org_id`, `set_created_by`, `audit_row_changes`

---

### audit.marketing_leads_history

Field-level diff audit for `lms.marketing_leads`. Written by trigger.

| Column             | Type        | Constraints                               |
| ------------------ | ----------- | ----------------------------------------- |
| id                 | UUID        | PK (UUIDv7)                               |
| lead_id            | UUID        | NOT NULL, FK → lms.marketing_leads(id)    |
| changed_by_user_id | UUID        | FK → iam.users(id)                        |
| operation          | CHAR(1)     | NOT NULL, CHECK IN ('I','U','D')          |
| changed_fields     | JSONB       | diff format: `{"field": {"old": v, "new": v}}` |
| changed_at         | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()       |

**RLS:** SELECT-only, org + tenant isolation via join to `lms.marketing_leads`

---

### audit.audit_log

Generic audit for all operational tables except `lms.marketing_leads`.

| Column         | Type        | Constraints                               |
| -------------- | ----------- | ----------------------------------------- |
| id             | UUID        | PK (UUIDv7)                               |
| table_name     | TEXT        | NOT NULL                                  |
| operation      | CHAR(1)     | NOT NULL, CHECK IN ('U','D')              |
| record_id      | UUID        |                                           |
| changed_by     | UUID        |                                           |
| changed_fields | JSONB       |                                           |
| old_data       | JSONB       |                                           |
| new_data       | JSONB       |                                           |
| org_id         | UUID        |                                           |
| changed_at     | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()       |

**RLS:** SELECT-only, org + tenant isolation

---

### audit.activities

Fire-and-forget activity log.

| Column       | Type        | Constraints                            |
| ------------ | ----------- | -------------------------------------- |
| id           | UUID        | PK (UUIDv7)                            |
| action_type  | TEXT        | NOT NULL                               |
| performed_by | UUID        | FK → iam.users(id)                     |
| target_id    | UUID        |                                        |
| target_type  | TEXT        |                                        |
| org_id       | UUID        | FK → entity.organizations(id)          |
| meta         | JSONB       |                                        |
| created_at   | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()    |

**RLS:** SELECT-only, org + tenant isolation

---

### ext.meta_tenant_config

Per-tenant Meta App/Business Manager credentials and CAPI configuration. One
Meta App is registered per tenant (not per org) — individual orgs/branches
are attributed via `ext.meta_page_form_org_map` below, since many orgs' Pages
and Forms can sit behind a single tenant-level app.

| Column              | Type        | Constraints                               |
| ------------------- | ----------- | ----------------------------------------- |
| id                  | UUID        | PK (UUIDv7)                               |
| tenant_id           | UUID        | NOT NULL, FK → entity.tenants(id)         |
| app_secret          | TEXT        | NOT NULL                                  |
| verify_token        | TEXT        | NOT NULL                                  |
| pixel_id            | TEXT        | NOT NULL                                  |
| access_token        | TEXT        | NOT NULL                                  |
| graph_api_version   | TEXT        | NOT NULL, DEFAULT 'v21.0'                 |
| is_active           | BOOLEAN     | NOT NULL, DEFAULT TRUE                    |
| capi_trigger_stages | UUID[]      | NOT NULL, DEFAULT '{}'                    |
| field_mappings      | JSONB       | nullable — per-tenant override of Meta form field keys; falls back to `DEFAULT_FIELD_MAPPINGS` in `meta.config.ts` when NULL |
| created_at          | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                   |
| updated_at          | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                   |

**Unique:** `(tenant_id)`  
**RLS:** tenant_admin only (no app_user policy — an individual org never owns the shared app config)

---

### ext.meta_page_form_org_map

Routes an incoming Meta lead (identified by Page + Form) to the owning org.
`form_id` is the authoritative routing key — a Meta lead form always belongs
to exactly one Page and `form_id` is globally unique in Meta's system, so it
safely disambiguates even a shared/corporate Page running forms for several
orgs. `page_id` is retained for reference/validation and as a fallback
default so a brand-new form created on an already-mapped Page can be
auto-attributed without requiring a manual mapping entry first. An org can
own many rows here (multiple Pages and/or multiple Forms across campaigns).

| Column     | Type        | Constraints                              |
| ---------- | ----------- | ----------------------------------------- |
| id         | UUID        | PK (UUIDv7)                              |
| tenant_id  | UUID        | NOT NULL, FK → entity.tenants(id)        |
| org_id     | UUID        | NOT NULL, FK → entity.organizations(id)  |
| page_id    | BIGINT      | NOT NULL                                 |
| form_id    | BIGINT      | NOT NULL                                 |
| platform   | TEXT        | NOT NULL, CHECK IN ('fb', 'ig')          |
| is_active  | BOOLEAN     | NOT NULL, DEFAULT TRUE                   |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                  |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                  |

**Unique:** `(page_id, form_id)`  
**RLS:** org + tenant isolation

---

### ext.meta_forms

Synced catalog of a tenant's Meta lead forms (from the Graph API), independent of the org-attribution mapping above — this is what the form lives *on*, not who it's routed *to*.

| Column            | Type        | Constraints                          |
| ----------------- | ----------- | -------------------------------------- |
| id                | UUID        | PK (UUIDv7)                            |
| tenant_id         | UUID        | NOT NULL, FK → entity.tenants(id)      |
| page_id           | BIGINT      | NOT NULL                               |
| form_id           | BIGINT      | NOT NULL, UNIQUE                       |
| name              | TEXT        |                                        |
| status            | TEXT        |                                        |
| leads_count       | INT         |                                        |
| meta_created_time | TIMESTAMPTZ |                                        |
| last_synced_at    | TIMESTAMPTZ |                                        |
| created_at        | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                |
| updated_at        | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                |

**View:** `ext.vw_meta_forms`

---

### ext.meta_leads

Raw Meta lead data linked to CRM marketing leads.

| Column            | Type        | Constraints                                |
| ----------------- | ----------- | ------------------------------------------ |
| id                | UUID        | PK (UUIDv7)                                |
| org_id            | UUID        | NOT NULL, FK → entity.organizations(id)    |
| marketing_lead_id | UUID        | FK → lms.marketing_leads(id)               |
| meta_lead_id      | BIGINT      | NOT NULL, UNIQUE                           |
| page_id           | BIGINT      |                                             |
| form_id           | BIGINT      | NOT NULL                                   |
| campaign_id       | BIGINT      |                                            |
| adset_id          | BIGINT      |                                            |
| ad_id             | BIGINT      |                                            |
| platform          | TEXT        | CHECK IN ('fb', 'ig')                      |
| lead_created_at   | TIMESTAMPTZ | NOT NULL                                   |
| full_name         | TEXT        |                                            |
| first_name        | TEXT        |                                            |
| last_name         | TEXT        |                                            |
| email             | TEXT        |                                            |
| phone             | TEXT        |                                            |
| whatsapp_number   | TEXT        |                                            |
| raw_field_data    | JSONB       |                                            |
| created_at        | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                    |

**RLS:** org + tenant isolation

---

### ext.meta_lead_custom_fields

Unmapped form fields from Meta lead forms (1:many from `ext.meta_leads`).

| Column         | Type | Constraints                              |
| -------------- | ---- | ---------------------------------------- |
| id             | UUID | PK (UUIDv7)                              |
| meta_lead_id   | UUID | NOT NULL, FK → ext.meta_leads(id)        |
| org_id         | UUID | NOT NULL, FK → entity.organizations(id)  |
| question_key   | TEXT | NOT NULL                                 |
| question_value | TEXT |                                          |

**Unique:** `(meta_lead_id, question_key)`  
**RLS:** org + tenant isolation

---

### ext.meta_lead_addresses

Address fields from Meta lead forms (1:1 from `ext.meta_leads`).

| Column         | Type        | Constraints                                  |
| -------------- | ----------- | --------------------------------------------- |
| meta_lead_id   | UUID        | PK, FK → ext.meta_leads(id) ON DELETE CASCADE |
| org_id         | UUID        | NOT NULL, FK → entity.organizations(id)       |
| street_address | TEXT        |                                                |
| city           | TEXT        |                                                |
| state          | TEXT        |                                                |
| province       | TEXT        |                                                |
| country        | TEXT        |                                                |
| postal_code    | TEXT        |                                                |
| zip_code       | TEXT        |                                                |
| created_at     | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                       |

**RLS:** org + tenant isolation

---

### ext.meta_lead_professional

Job/company fields from Meta lead forms (1:1 from `ext.meta_leads`).

| Column            | Type        | Constraints                                  |
| ----------------- | ----------- | --------------------------------------------- |
| meta_lead_id      | UUID        | PK, FK → ext.meta_leads(id) ON DELETE CASCADE |
| org_id            | UUID        | NOT NULL, FK → entity.organizations(id)       |
| job_title         | TEXT        |                                                |
| company_name      | TEXT        |                                                |
| work_email        | TEXT        |                                                |
| work_phone_number | TEXT        |                                                |
| created_at        | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                       |

**RLS:** org + tenant isolation

---

### ext.meta_lead_demographics

Demographic fields from Meta lead forms (1:1 from `ext.meta_leads`).

| Column              | Type        | Constraints                                  |
| ------------------- | ----------- | --------------------------------------------- |
| meta_lead_id        | UUID        | PK, FK → ext.meta_leads(id) ON DELETE CASCADE |
| org_id              | UUID        | NOT NULL, FK → entity.organizations(id)       |
| date_of_birth       | DATE        |                                                |
| gender              | TEXT        |                                                |
| marital_status      | TEXT        |                                                |
| relationship_status | TEXT        |                                                |
| military_status     | TEXT        |                                                |
| created_at          | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                       |

**RLS:** org + tenant isolation

---

### ext.meta_capi_outbound_logs

Outbound Meta Conversion API event audit trail.

| Column               | Type        | Constraints                                   |
| -------------------- | ----------- | --------------------------------------------- |
| id                   | UUID        | PK (UUIDv7)                                   |
| org_id               | UUID        | NOT NULL, FK → entity.organizations(id)       |
| marketing_lead_id    | UUID        | NOT NULL, FK → lms.marketing_leads(id)        |
| meta_lead_id         | UUID        | FK → ext.meta_leads(id)                       |
| event_name           | TEXT        | NOT NULL                                      |
| event_id             | TEXT        | NOT NULL                                      |
| delivery_status      | TEXT        | NOT NULL, CHECK IN ('SUCCESS','FAILED','PENDING') |
| fb_trace_id          | TEXT        |                                               |
| request_payload      | JSONB       | NOT NULL                                      |
| response_payload     | JSONB       |                                               |
| triggered_by         | TEXT        | NOT NULL, CHECK IN ('auto_stage_change','manual') |
| triggered_by_user_id | UUID        |                                               |
| sent_at              | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                       |

**Unique (partial):** `(marketing_lead_id, event_name) WHERE delivery_status = 'SUCCESS'`  
**RLS:** org + tenant isolation

---

### ext.meta_capi_event_types

Lookup of supported Meta CAPI event names.

| Column      | Type         | Constraints              |
| ----------- | ------------ | ------------------------- |
| id          | SMALLINT     | PK (identity)              |
| code        | VARCHAR(50)  | NOT NULL, UNIQUE           |
| label       | VARCHAR(100) | NOT NULL                   |
| description | TEXT         |                            |
| is_active   | BOOLEAN      | NOT NULL, DEFAULT TRUE     |
| sort_order  | SMALLINT     | NOT NULL, DEFAULT 0        |
| created_at  | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()    |
| updated_at  | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()    |

**View:** `ext.vw_meta_capi_event_types` (active rows only)
**RLS:** none (global lookup, like lms.lead_stage)

---

### ext.lead_stage_capi_event_map

Maps a CRM lead stage (`lms.lead_stage`) to the Meta CAPI event fired when a lead transitions into it. Global mapping — no `org_id` — mirroring `lms.lead_stage` itself being a shared lookup table. Resolved by `stage_id` (UUID), never by stage name text. A stage with no row here does not fire a CAPI event.

| Column             | Type        | Constraints                                        |
| ------------------ | ----------- | --------------------------------------------------- |
| id                 | UUID        | PK (UUIDv7)                                          |
| stage_id           | UUID        | NOT NULL, UNIQUE, FK → lms.lead_stage(id) ON DELETE CASCADE |
| capi_event_type_id | SMALLINT    | NOT NULL, FK → ext.meta_capi_event_types(id) ON DELETE RESTRICT |
| created_at         | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                              |
| updated_at         | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                              |

**View:** `ext.vw_lead_stage_capi_event_map` (resolves `stage_code`/`stage_label` and `capi_event_code`/`capi_event_label`)
**RLS:** none (global lookup)

Seeded mapping (`db_scripts/01_init-lookup-data.sql`):

| Stage (`lms.lead_stage.name`) | Meta CAPI Event |
| ------------------------------ | ---------------- |
| contacting                     | Other             |
| on_hold                        | Other             |
| qualified                      | QualifiedLead     |
| converted                      | ConvertedLead     |
| transferred_out                | Other             |
| new, unqualified                | *(no mapping — no CAPI event fired)* |

---

### comms.message_templates

Cross-product WhatsApp/email message templates, shared by every product service that sends notifications. Resolved by `(module, channel, name)` with most-specific audience winning: **org > tenant > global**.

| Column                  | Type        | Constraints                                              |
| ----------------------- | ----------- | ----------------------------------------------------------- |
| id                      | UUID        | PK (UUIDv7)                                                  |
| tenant_id               | UUID        | FK → entity.tenants(id) ON DELETE CASCADE; NULL = global template |
| org_id                  | UUID        | FK → entity.organizations(id) ON DELETE CASCADE; NULL = tenant-wide |
| module                  | TEXT        | NOT NULL — owning product (`lms`/`hr`/`task`/...)            |
| channel                 | TEXT        | NOT NULL, CHECK IN (`whatsapp`,`email`)                       |
| name                    | TEXT        | NOT NULL                                                      |
| label                   | TEXT        | NOT NULL                                                      |
| description             | TEXT        |                                                                |
| provider_template_name  | TEXT        | WhatsApp only — the name registered with the messaging provider |
| language_code           | TEXT        | NOT NULL, DEFAULT 'en'                                        |
| subject                 | TEXT        | Email only                                                    |
| body_template           | TEXT        | Email only                                                    |
| preview_text            | TEXT        |                                                                |
| header_fields           | TEXT[]      | NOT NULL, DEFAULT '{}'                                        |
| body_fields             | TEXT[]      | NOT NULL, DEFAULT '{}'                                        |
| sort_order              | INT         | NOT NULL, DEFAULT 0                                           |
| is_active               | BOOLEAN     | NOT NULL, DEFAULT TRUE                                        |
| is_deleted              | BOOLEAN     | NOT NULL, DEFAULT FALSE                                       |
| deleted_at              | TIMESTAMPTZ |                                                                |
| deleted_by              | UUID        |                                                                |
| created_by              | UUID        |                                                                |
| created_at              | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()                           |
| updated_at              | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()                           |

**Checks:** `org_id IS NULL OR tenant_id IS NOT NULL` (an org-scoped row must also be tenant-scoped); per-channel shape checks — a `whatsapp` row requires `provider_template_name` and forbids `subject`/`body_template`; an `email` row requires `subject`+`body_template` and forbids `provider_template_name`.
**Read by:** communication-service, the stateless send relay described in Architecture.md's "Meta Conversion API"/permissions notes — it resolves the most specific matching row for a given `(module, channel, name)` and the caller's org/tenant.
**Seed data:** `reference_data/05_comms_templates.sql`.

---

### notify.push_subscriptions

Web Push subscriptions — one row per installed PWA + browser + device that has granted the Notification permission. Platform-wide, not LMS-owned: notifications-service is the first consumer (follow-up due), with hr-service (leave approved/rejected) and tasks-service (task assigned) expected to follow.

| Column       | Type        | Constraints                                                  |
| ------------ | ----------- | ------------------------------------------------------------ |
| id           | UUID        | PK (UUIDv7)                                                   |
| user_id      | UUID        | NOT NULL, FK → iam.users(id) ON DELETE CASCADE                |
| org_id       | UUID        | NOT NULL, FK → entity.organizations(id) ON DELETE CASCADE     |
| tenant_id    | UUID        | NOT NULL — no FK, denormalized at subscribe time for the tenant_admin RLS predicate (same shape as `iam.token_blocklist`) |
| endpoint     | TEXT        | NOT NULL, **UNIQUE** — push service URL, the natural key      |
| p256dh       | TEXT        | NOT NULL — client public key (`PushSubscription.keys.p256dh`) |
| auth         | TEXT        | NOT NULL — client auth secret (`PushSubscription.keys.auth`)  |
| user_agent   | TEXT        | Debugging aid for "why did my phone stop getting these"       |
| created_at   | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()                           |
| last_used_at | TIMESTAMPTZ | Stamped on each successful send                               |

**Index:** `idx_push_subscriptions_user_org (user_id, org_id)` — the sender's lookup on every notification. `endpoint`'s own UNIQUE index backs the upsert.

**Upsert, never accumulate.** The client re-registers on every launch (deleting the Home Screen icon destroys the subscription and a fresh install issues a new endpoint), so the subscribe path must be `INSERT ... ON CONFLICT (endpoint) DO UPDATE`.

**Hard delete, not soft.** Rows are removed on unsubscribe and when the push service answers 404/410 Gone. A dead device registration has nothing to audit, so the `is_deleted`/`soft_delete_row` recipe used by the domain tables is deliberately not applied.

**RLS.** ENABLE + FORCE, with a deliberate departure from the org-only pattern used elsewhere: the `app_user` policy constrains **`user_id` as well as `org_id`**. A push subscription is personal, not org-shared — with org isolation alone any colleague in the branch could read the endpoint/p256dh/auth triple (everything needed to push to that person's locked phone) or delete the row and silently stop their alerts. `tenant_admin` stays tenant-scoped so admins can prune dead registrations across branches.

**Written by:** notifications-service via `root_service` (`DATABASE_URL_SERVICE` / `withServiceTx`), which bypasses RLS — a send fans out to every device of the target user with no app session to scope it. The policies guard incidental access from authenticated app sessions, the same reasoning as `lms.lead_report_snapshot`.

**Existing databases:** `db_scripts/one_time/apply_notify_push_subscriptions.sql` (preview with the `_dryrun`). Schema 1.47.0 originally shipped without one, so every server seeded before it had no table at all and every `POST /notifications/push/subscribe` answered 500 with `42P01 relation "notify.push_subscriptions" does not exist` — no device could register and no notification was ever delivered. Run the dryrun on any environment whose push has never worked.

---

### public.schema_versions

Schema migration tracking.

| Column      | Type        | Constraints                         |
| ----------- | ----------- | ----------------------------------- |
| version     | TEXT        | PK                                  |
| description | TEXT        |                                     |
| applied_at  | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP() |

---

## HR Schema (`hr.*`)

Employee lifecycle, leave, attendance, shifts, and face verification. All tables follow the standard soft-delete recipe (`is_active`/`is_deleted`/`deleted_at`/`deleted_by`/`created_by`/`created_at`/`updated_at`, check `NOT (is_active AND is_deleted)`) unless noted otherwise. `org_id` FKs are `ON DELETE RESTRICT` throughout hr — a branch cannot be deleted while it still owns HR records.

### hr.employment_types / hr.leave_types / hr.leave_request_statuses / hr.attendance_statuses

Tenant-scoped lookups (see "Tenant-scoped lookups" above for the admin-CRUD/RLS pattern shared with `task.*`).

| Column      | Type    | Constraints                                            |
| ----------- | ------- | -------------------------------------------------------- |
| id          | UUID    | PK (UUIDv7)                                                |
| tenant_id   | UUID    | NOT NULL, FK → entity.tenants(id) ON DELETE CASCADE        |
| name        | TEXT    | NOT NULL, UNIQUE per `(tenant_id, name)`                    |
| label       | TEXT    | NOT NULL                                                    |
| description | TEXT    |                                                              |
| is_active   | BOOLEAN | NOT NULL, DEFAULT TRUE                                      |

Extra columns: `hr.leave_types.is_paid` (BOOLEAN, NOT NULL DEFAULT TRUE), `hr.leave_types.sort_order` (INT).

---

### hr.designations

Job-title catalog, org-scoped (not tenant-scoped — a designation is defined per branch).

| Column | Type | Constraints |
| --- | --- | --- |
| id | UUID | PK |
| org_id | UUID | NOT NULL, FK → entity.organizations(id) ON DELETE RESTRICT |
| name | TEXT | NOT NULL |
| *(+ standard soft-delete columns)* | | |

---

### hr.employee_profiles

1:1 HR extension of `iam.users` — everything HR needs that identity doesn't carry.

| Column               | Type         | Constraints                                                        |
| -------------------- | ------------ | --------------------------------------------------------------------- |
| user_id               | UUID         | PK, FK → iam.users(id) ON DELETE RESTRICT                             |
| org_id                | UUID         | NOT NULL, FK → entity.organizations(id) ON DELETE RESTRICT             |
| tenant_id             | UUID         | NOT NULL, FK → entity.tenants(id) ON DELETE RESTRICT — **set by trigger** from `org_id`; used to enforce `employee_code` uniqueness per tenant |
| employee_code         | TEXT         |                                                                        |
| date_of_joining       | DATE         | NOT NULL                                                               |
| date_of_exit          | DATE         | CHECK `date_of_exit >= date_of_joining`                                |
| employment_type_id    | UUID         | FK → hr.employment_types(id) ON DELETE RESTRICT                        |
| department_id         | UUID         | FK → iam.departments(id) ON DELETE RESTRICT                            |
| designation_id        | UUID         | FK → hr.designations(id) ON DELETE RESTRICT                            |
| probation_end_date    | DATE         |                                                                        |
| weekly_off_pattern    | SMALLINT[]   | NOT NULL, DEFAULT '{0,6}' — 0=Sunday..6=Saturday                       |
| metadata              | JSONB        | NOT NULL, DEFAULT '{}'                                                 |
| reference_photo_url   | TEXT         | Face verification — **dormant**, superseded by the shared avatar (`iam.users.photo_key`); see Architecture.md → "Face verification" |
| face_subject_id       | TEXT         | dormant, same note                                                     |
| face_enrolled_at      | TIMESTAMPTZ  | dormant, same note                                                     |
| face_consent_at       | TIMESTAMPTZ  | dormant, same note                                                     |
| *(+ standard soft-delete columns)* |  |                                                                        |

**Triggers:** `hr.set_employee_profile_tenant_id()` (derives `tenant_id` from `org_id`), `hr.soft_delete_employee_profile()`.

---

### hr.holiday_calendars

| Column | Type | Constraints |
| --- | --- | --- |
| id | UUID | PK |
| org_id | UUID | NOT NULL, FK → entity.organizations(id) ON DELETE RESTRICT |
| name | TEXT | NOT NULL |
| year | INT | NOT NULL |
| *(+ standard soft-delete columns)* | | |

---

### hr.holidays

| Column | Type | Constraints |
| --- | --- | --- |
| id | UUID | PK |
| calendar_id | UUID | FK → hr.holiday_calendars(id) ON DELETE CASCADE |
| org_id | UUID | NOT NULL, FK → entity.organizations(id) ON DELETE RESTRICT |
| holiday_date | DATE | NOT NULL |
| name | TEXT | NOT NULL |
| is_optional | BOOLEAN | NOT NULL, DEFAULT FALSE |
| *(+ standard soft-delete columns)* | | |

**Unique:** `(calendar_id, holiday_date)`

---

### hr.leave_policies

Accrual/entitlement rules per leave type, tenant-wide or org-specific.

| Column | Type | Constraints |
| --- | --- | --- |
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK → entity.tenants(id) ON DELETE CASCADE |
| org_id | UUID | FK → entity.organizations(id) ON DELETE CASCADE; NULL = tenant-wide default |
| leave_type_id | UUID | FK → hr.leave_types(id) ON DELETE RESTRICT |
| accrual_frequency | TEXT | CHECK IN (`monthly`,`quarterly`,`yearly`,`none`), DEFAULT `none` |
| accrual_amount | NUMERIC(5,2) | DEFAULT 0 |
| max_balance | NUMERIC(5,2) | |
| carry_forward | BOOLEAN | NOT NULL, DEFAULT FALSE |
| max_carry_forward | NUMERIC(5,2) | |
| max_consecutive_days | SMALLINT | |
| min_notice_days | SMALLINT | DEFAULT 0 |
| allow_half_day | BOOLEAN | NOT NULL, DEFAULT TRUE |
| requires_document_after_days | SMALLINT | |
| approval_levels | SMALLINT | NOT NULL, DEFAULT 1, CHECK >= 1 |
| applicable_from | DATE | NOT NULL |
| *(+ standard soft-delete columns)* | | |

**Known follow-up (shared with `hr.hr_settings` and the per-product role catalogs before they were dropped):** tenant provisioning does not auto-seed these rows for a brand-new tenant yet.

---

### hr.hr_settings

Per-tenant/org HR configuration (currently just the leave-cycle anchor month).

| Column | Type | Constraints |
| --- | --- | --- |
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK → entity.tenants(id) ON DELETE CASCADE |
| org_id | UUID | FK → entity.organizations(id) ON DELETE CASCADE; NULL = tenant-wide |
| leave_cycle_start_month | SMALLINT | NOT NULL, DEFAULT 4, CHECK 1-12 |
| created_at / updated_at | TIMESTAMPTZ | |

---

### hr.leave_requests

Core leave-request entity.

| Column | Type | Constraints |
| --- | --- | --- |
| id | UUID | PK |
| user_id | UUID | FK → iam.users(id) ON DELETE RESTRICT |
| org_id | UUID | FK → entity.organizations(id) ON DELETE RESTRICT |
| leave_type_id | UUID | FK → hr.leave_types(id) ON DELETE RESTRICT |
| start_date / end_date | DATE | NOT NULL, CHECK `end_date >= start_date` |
| start_half / end_half | TEXT | CHECK IN (`full`,`first_half`,`second_half`), DEFAULT `full` |
| days_count | NUMERIC(5,2) | CHECK > 0 |
| reason | TEXT | |
| status_id | UUID | FK → hr.leave_request_statuses(id) ON DELETE RESTRICT |
| document_url | TEXT | |
| is_open | BOOLEAN | NOT NULL, DEFAULT TRUE — **trigger-maintained** from `status_id` |
| *(+ standard soft-delete columns)* | | |

**Constraint (exclusion):** no two open, non-deleted requests for the same user with overlapping `[start_date, end_date]` ranges (GiST).
**Trigger:** `hr.set_leave_request_is_open()`.

---

### hr.leave_request_status_log

Append-only transition log, mirrors `lms.lead_status_log`.

| Column | Type | Constraints |
| --- | --- | --- |
| id | UUID | PK |
| org_id | UUID | FK → entity.organizations(id) ON DELETE RESTRICT |
| request_id | UUID | FK → hr.leave_requests(id) ON DELETE CASCADE |
| changed_by_id | UUID | FK → iam.users(id) ON DELETE SET NULL |
| old_status_id | UUID | FK → hr.leave_request_statuses(id) |
| new_status_id | UUID | NOT NULL, FK → hr.leave_request_statuses(id) |
| note | TEXT | |
| changed_at | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP() |

**Trigger:** `hr.log_leave_status_change()`.

---

### hr.leave_ledger

Append-only source of truth for leave balances — the only way a balance changes.

| Column | Type | Constraints |
| --- | --- | --- |
| id | UUID | PK |
| user_id | UUID | FK → iam.users(id) ON DELETE RESTRICT |
| org_id | UUID | FK → entity.organizations(id) ON DELETE RESTRICT |
| leave_type_id | UUID | FK → hr.leave_types(id) ON DELETE RESTRICT |
| entry_type | TEXT | CHECK IN (`accrual`,`consumption`,`adjustment`,`carry_forward`,`encashment`,`lapse`) |
| amount | NUMERIC(6,2) | CHECK <> 0 |
| leave_request_id | UUID | FK → hr.leave_requests(id) ON DELETE SET NULL |
| period | TEXT | |
| effective_date | DATE | NOT NULL |
| note | TEXT | |
| created_by / created_at | | |

**View:** `hr.vw_leave_balances` sums this table per user/leave-type into a current balance.

---

### hr.leave_request_approvals

One row per approval level in a request's chain, materialized at apply time from `iam.reporting_lines` (see Architecture.md → "The single reporting hierarchy" — this is what keeps an in-flight request stable across a re-org).

| Column | Type | Constraints |
| --- | --- | --- |
| id | UUID | PK |
| leave_request_id | UUID | FK → hr.leave_requests(id) ON DELETE CASCADE |
| org_id | UUID | FK → entity.organizations(id) ON DELETE RESTRICT |
| level | SMALLINT | NOT NULL |
| approver_id | UUID | FK → iam.users(id) ON DELETE RESTRICT |
| action | TEXT | CHECK IN (`pending`,`approved`,`rejected`), DEFAULT `pending` |
| acted_at | TIMESTAMPTZ | |
| comment | TEXT | |
| created_at | TIMESTAMPTZ | |

**Unique:** `(leave_request_id, level)`
**Function:** `hr.can_approve_leave(...)` resolves whether an actor may act on a given level; `resolveApprovers`/`buildApproverChain` (hr-service) build the chain from `iam.fn_manager_chain`.

---

### hr.attendance_rules

Per-org (or tenant-default) attendance policy — geofencing, photo requirements, face-match config, half/full-day thresholds. This is the table Architecture.md's "Face verification" section documents behaviorally; it had no Table Details entry until now.

| Column | Type | Constraints |
| --- | --- | --- |
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK → entity.tenants(id) ON DELETE CASCADE |
| org_id | UUID | FK → entity.organizations(id) ON DELETE RESTRICT; NULL = tenant default |
| geofence_enabled | BOOLEAN | NOT NULL, DEFAULT TRUE |
| geofence_radius_meters | INT | DEFAULT 200, CHECK > 0 |
| require_photo | BOOLEAN | NOT NULL, DEFAULT TRUE |
| require_geo | BOOLEAN | NOT NULL, DEFAULT TRUE |
| allow_wfh_checkin | BOOLEAN | NOT NULL, DEFAULT FALSE |
| require_face_match | BOOLEAN | NOT NULL, DEFAULT FALSE — off by default |
| face_match_threshold | NUMERIC(5,2) | DEFAULT 85, CHECK 50-100 |
| face_match_action | TEXT | CHECK IN (`flag`,`block`), DEFAULT `flag` |
| photo_change_cooldown_days | INT | DEFAULT 30, CHECK >= 0 |
| image_retention_days | INT | DEFAULT 90, CHECK >= 1 |
| min_half_day_minutes | SMALLINT | DEFAULT 240, CHECK 0-1440 |
| min_full_day_minutes | SMALLINT | DEFAULT 480, CHECK 0-1440; CHECK `min_half_day_minutes <= min_full_day_minutes` |
| regularization_approval_levels | SMALLINT | DEFAULT 1, CHECK >= 1 |
| regularization_max_backdate_days | SMALLINT | DEFAULT 30, CHECK 0-365 |
| *(+ standard soft-delete columns)* | | |

**Trigger:** `hr.set_attendance_rules_tenant_id()`.

---

### hr.shifts / hr.shift_segments / hr.shift_assignments

**hr.shifts** — one row per named shift definition, org-scoped.

| Column | Type | Constraints |
| --- | --- | --- |
| id | UUID | PK |
| org_id | UUID | NOT NULL, FK → entity.organizations(id) ON DELETE RESTRICT |
| name | TEXT | NOT NULL |
| start_time / end_time | TIME | NOT NULL |
| grace_minutes | SMALLINT | DEFAULT 10 |
| min_half_day_minutes / min_full_day_minutes | SMALLINT | DEFAULT 240 / 480 |
| is_night_shift | BOOLEAN | NOT NULL, DEFAULT FALSE |
| is_split | BOOLEAN | NOT NULL, DEFAULT FALSE |
| *(+ standard soft-delete columns)* | | |

**hr.shift_segments** — for split shifts, the individual on/off windows within one shift.

| Column | Type | Constraints |
| --- | --- | --- |
| id | UUID | PK |
| shift_id | UUID | FK → hr.shifts(id) ON DELETE CASCADE |
| org_id | UUID | NOT NULL, FK → entity.organizations(id) ON DELETE RESTRICT |
| seq | SMALLINT | NOT NULL, CHECK >= 1 |
| start_time / end_time | TIME | NOT NULL |
| *(+ standard soft-delete columns)* | | |

**hr.shift_assignments** — which user works which shift, effective-dated.

| Column | Type | Constraints |
| --- | --- | --- |
| id | UUID | PK |
| user_id | UUID | FK → iam.users(id) ON DELETE RESTRICT |
| org_id | UUID | FK → entity.organizations(id) ON DELETE RESTRICT |
| shift_id | UUID | FK → hr.shifts(id) ON DELETE RESTRICT |
| effective_from | DATE | NOT NULL |
| effective_to | DATE | CHECK >= effective_from |
| *(+ standard soft-delete columns)* | | |

**Constraint (exclusion):** no overlapping non-deleted assignments per user (GiST) — mirrors `iam.reporting_lines`' one-open-line pattern.

---

### hr.attendance_geo_exceptions

Per-user carve-out from geofencing (remote role or approved WFH), effective-dated.

| Column | Type | Constraints |
| --- | --- | --- |
| id | UUID | PK |
| user_id | UUID | FK → iam.users(id) ON DELETE RESTRICT |
| org_id | UUID | FK → entity.organizations(id) ON DELETE RESTRICT |
| exception_type | TEXT | CHECK IN (`remote_role`,`wfh`) |
| effective_from | DATE | NOT NULL |
| effective_to | DATE | |
| reason | TEXT | NOT NULL, CHECK length >= 3 |
| *(+ standard soft-delete columns)* | | |

**Constraint (exclusion):** no overlap per `(user_id, org_id, exception_type)` (GiST).

---

### hr.attendance_events

Append-only raw punch log — the source `hr.attendance_days` resolves from. See Architecture.md → "Punch integration" for the face-verification write path.

| Column | Type | Constraints |
| --- | --- | --- |
| id | UUID | PK |
| user_id | UUID | FK → iam.users(id) ON DELETE RESTRICT |
| org_id | UUID | FK → entity.organizations(id) ON DELETE RESTRICT |
| event_type | TEXT | CHECK IN (`check_in`,`check_out`) |
| occurred_at | TIMESTAMPTZ | DEFAULT CLOCK_TIMESTAMP() |
| source | TEXT | CHECK IN (`web`,`mobile`,`biometric`,`api`) |
| geo_lat / geo_lng | NUMERIC(9,6) | |
| distance_from_org_m | NUMERIC(10,2) | |
| is_within_geofence | BOOLEAN | |
| is_wfh | BOOLEAN | DEFAULT FALSE |
| geo_exception_type | TEXT | CHECK IN (`remote_role`,`wfh`) |
| photo_url | TEXT | |
| face_match_score | NUMERIC(5,2) | dormant — see Face verification |
| face_match_passed | BOOLEAN | dormant |
| face_review_status | TEXT | CHECK IN (`pending`,`cleared`,`rejected`), dormant |
| is_off_segment | BOOLEAN | |
| ip | TEXT | |
| device_info | JSONB | |
| created_at | TIMESTAMPTZ | |

---

### hr.attendance_days

One resolved row per `(user, work_date)` — the daily rollup screens read from.

| Column | Type | Constraints |
| --- | --- | --- |
| id | UUID | PK |
| user_id | UUID | FK → iam.users(id) ON DELETE RESTRICT |
| org_id | UUID | FK → entity.organizations(id) ON DELETE RESTRICT |
| work_date | DATE | NOT NULL |
| first_in / last_out | TIMESTAMPTZ | |
| worked_minutes | INT | |
| status_id | UUID | FK → hr.attendance_statuses(id) ON DELETE RESTRICT |
| is_late / is_early_exit | BOOLEAN | DEFAULT FALSE |
| has_off_window_punch / has_open_session / has_pending_face_review | BOOLEAN | DEFAULT FALSE |
| leave_request_id | UUID | FK → hr.leave_requests(id) ON DELETE SET NULL |
| resolved_at | TIMESTAMPTZ | |
| resolution_source | TEXT | CHECK IN (`events`,`leave`,`holiday`,`weekly_off`,`regularization`,`job`) |
| created_at / updated_at | TIMESTAMPTZ | |

**Unique:** `(user_id, work_date)`
**Computed by:** the shared `computeDayResolution` (`lib/attendance/day-resolution.ts`), called both from the nightly job and from the face-review clear/reject actions — see Architecture.md → "Review queue".

---

### hr.attendance_regularizations / hr.attendance_regularization_approvals

**hr.attendance_regularizations** — a user's request to correct a resolved day.

| Column | Type | Constraints |
| --- | --- | --- |
| id | UUID | PK |
| user_id | UUID | FK → iam.users(id) ON DELETE RESTRICT |
| org_id | UUID | FK → entity.organizations(id) ON DELETE RESTRICT |
| work_date | DATE | NOT NULL |
| requested_status_id | UUID | FK → hr.attendance_statuses(id) ON DELETE RESTRICT |
| requested_in / requested_out | TIMESTAMPTZ | |
| reason | TEXT | NOT NULL |
| status | TEXT | CHECK IN (`pending`,`approved`,`rejected`,`cancelled`), DEFAULT `pending` |
| approver_id | UUID | FK → iam.users(id) ON DELETE SET NULL |
| acted_at | TIMESTAMPTZ | |
| approver_comment | TEXT | |
| *(+ standard soft-delete columns)* | | |

**hr.attendance_regularization_approvals** — per-level approval chain, same shape as `hr.leave_request_approvals`. **Not yet reflected in Drizzle** (`msq-core/packages/db/src/schema/tables/*.ts` has an `attendance-regularizations.table.ts` but no corresponding `-approvals` file — a follow-up for the ORM layer, not just this doc).

| Column | Type | Constraints |
| --- | --- | --- |
| id | UUID | PK |
| regularization_id | UUID | FK → hr.attendance_regularizations(id) ON DELETE CASCADE |
| org_id | UUID | FK → entity.organizations(id) ON DELETE RESTRICT |
| level | SMALLINT | NOT NULL |
| approver_id | UUID | FK → iam.users(id) ON DELETE RESTRICT |
| action | TEXT | CHECK IN (`pending`,`approved`,`rejected`), DEFAULT `pending` |
| acted_at | TIMESTAMPTZ | |
| comment | TEXT | |
| created_at | TIMESTAMPTZ | |

**Unique:** `(regularization_id, level)`
**Function:** `hr.can_approve(...)` — approver-scope check shared with the review queue (same authority as leave: manager subtree, `hr_admin`, `org_admin`).

---

## Task Schema (`task.*`)

### task.task_statuses / task.task_priorities

Tenant-scoped lookups (same shape/RLS/admin-CRUD pattern as `hr.*`'s tenant-scoped lookups above).

| Column      | Type    | Constraints                                            |
| ----------- | ------- | -------------------------------------------------------- |
| id          | UUID    | PK (UUIDv7)                                                |
| tenant_id   | UUID    | NOT NULL, FK → entity.tenants(id) ON DELETE CASCADE        |
| name        | TEXT    | NOT NULL, UNIQUE per `(tenant_id, name)`                    |
| label       | TEXT    | NOT NULL                                                    |
| description | TEXT    |                                                              |
| sort_order  | INT     | NOT NULL, DEFAULT 0                                          |
| is_active   | BOOLEAN | NOT NULL, DEFAULT TRUE                                       |

`task.task_statuses` additionally has `is_terminal` (BOOLEAN, NOT NULL DEFAULT FALSE) — mirrors `lms.lead_stage.is_terminated`'s role in the weighted-assignment deficit calc, but for task screens that need to distinguish "done" from "open" statuses generically.

---

### task.task_lists

| Column | Type | Constraints |
| --- | --- | --- |
| id | UUID | PK |
| org_id | UUID | NOT NULL, FK → entity.organizations(id) ON DELETE RESTRICT |
| name | TEXT | NOT NULL |
| description | TEXT | |
| owner_id | UUID | FK → iam.users(id) ON DELETE RESTRICT |
| visibility | TEXT | CHECK IN (`private`,`team`,`org`), DEFAULT `private` |
| *(+ standard soft-delete columns)* | | |

---

### task.tasks

Core task entity. Supports subtasks (self-FK) and a polymorphic soft link to another product's record (e.g. a task tied to a lead or a leave request).

| Column | Type | Constraints |
| --- | --- | --- |
| id | UUID | PK |
| org_id | UUID | NOT NULL, FK → entity.organizations(id) ON DELETE RESTRICT |
| list_id | UUID | FK → task.task_lists(id) ON DELETE SET NULL |
| title | TEXT | NOT NULL |
| description | TEXT | |
| assignee_id | UUID | FK → iam.users(id) ON DELETE SET NULL |
| due_at | TIMESTAMPTZ | |
| priority_id | UUID | FK → task.task_priorities(id) ON DELETE RESTRICT |
| status_id | UUID | NOT NULL, FK → task.task_statuses(id) ON DELETE RESTRICT |
| parent_task_id | UUID | self-FK ON DELETE SET NULL, CHECK <> id |
| related_entity_type / related_entity_id | TEXT / UUID | polymorphic soft link — CHECK both-or-neither present |
| tags | TEXT[] | NOT NULL, DEFAULT '{}' |
| completed_at | TIMESTAMPTZ | |
| recurrence_rule | TEXT | RFC 5545 recurrence string — **stored but not yet expanded**; no job materializes recurring instances today |
| *(+ standard soft-delete columns)* | | |

**Trigger:** `task.set_task_completion()` (syncs `completed_at` ↔ a terminal `status_id`, mirroring `lms.lead_follow_ups`' completion sync).

---

### task.task_status_log

Append-only transition log.

| Column | Type | Constraints |
| --- | --- | --- |
| id | UUID | PK |
| org_id | UUID | FK → entity.organizations(id) ON DELETE RESTRICT |
| task_id | UUID | FK → task.tasks(id) ON DELETE CASCADE |
| changed_by_id | UUID | FK → iam.users(id) ON DELETE SET NULL |
| old_status_id | UUID | FK → task.task_statuses(id) |
| new_status_id | UUID | NOT NULL, FK → task.task_statuses(id) |
| note | TEXT | |
| changed_at | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP() |

**Trigger:** `task.log_task_status_change()`.

---

### task.task_comments

Append-only.

| Column | Type | Constraints |
| --- | --- | --- |
| id | UUID | PK |
| org_id | UUID | FK → entity.organizations(id) ON DELETE RESTRICT |
| task_id | UUID | FK → task.tasks(id) ON DELETE CASCADE |
| user_id | UUID | FK → iam.users(id) ON DELETE RESTRICT |
| body | TEXT | NOT NULL |
| created_at | TIMESTAMPTZ | |

---

## Views

| View                                         | Schema    | security_invoker | Purpose                                                    |
| -------------------------------------------- | --------- | ---------------- | ---------------------------------------------------------- |
| `lms.vw_dashboard_leads`                     | lms       | yes              | Primary lead listing with resolved FKs                     |
| `lms.vw_lead_followup_timeline`              | lms       | yes              | Unified timeline: status + follow-ups + interactions + assignments |
| `lms.vw_lead_assignment_timeline`            | lms       | yes              | Assignment history with held-for duration                  |
| `lms.vw_sales_follow_up_pipeline`            | lms       | yes              | Follow-up queue (pending + missed only)                    |
| `lms.vw_followup_pipeline_enriched`          | lms       | yes              | Enriched pipeline with overdue flag + last interaction     |
| `lms.vw_org_performance_snapshot`            | lms       | yes              | Per-org KPIs for analytics                                 |
| `lms.vw_tenant_full_dashboard`               | lms       | yes              | Cross-org tenant KPIs by stage                             |
| `lms.vw_rep_performance`                     | lms       | yes              | Per-rep lead counts by stage (leaderboard)                 |
| `lms.vw_lead_report_branch`                  | lms       | yes              | Daily lead report, per branch — the 29-metric set          |
| `lms.vw_lead_report_user`                    | lms       | yes              | Daily lead report, per branch × assignee — same 29 metrics |
| `iam.vw_user_org_chart`                      | iam       | yes              | Recursive org chart with depth + breadcrumb path, as of today (over iam.reporting_lines) |
| `iam.vw_user_team_members`                   | iam       | yes              | Recursive subtree membership as of today; wraps iam.fn_subtree_members |
| `iam.vw_user_org_access`                     | iam       | yes              | Active org-user mappings with role context                 |
| `marketing.vw_campaign_lookup`               | marketing | yes              | Campaigns with resolved platform/status                    |
| `marketing.vw_tenant_campaign_summary`       | marketing | yes              | Campaign performance by tenant                             |
| `ext.view_meta_leads_complete`               | ext       | yes              | Meta leads joined to CRM marketing_leads, address, professional, demographics |
| `lms.vw_lead_assignment_weights`             | lms       | yes              | Flat `(user_id, org_id, weight)` shape over `lms.lead_assignment_weights` — see that table's entry above |
| `audit.vw_password_spray_alerts`             | audit     | yes              | Surfaces suspected password-spray patterns for the security dashboard |
| `ext.vw_meta_forms`                          | ext       | yes              | Resolved view over `ext.meta_forms`                         |
| `ext.vw_meta_capi_event_types`               | ext       | yes              | Active-rows-only view over `ext.meta_capi_event_types`      |
| `ext.vw_lead_stage_capi_event_map`           | ext       | yes              | Resolves `stage_code`/`stage_label` + `capi_event_code`/`capi_event_label` over `ext.lead_stage_capi_event_map` |
| `hr.vw_leave_balances`                       | hr        | yes              | Current leave balance per (user, leave_type), summed from `hr.leave_ledger` |
| `hr.vw_leave_requests_enriched`              | hr        | yes              | Leave requests with resolved user/leave-type/status display fields |
| `hr.vw_team_leave_calendar`                  | hr        | yes              | Team leave calendar for a manager's subtree                 |
| `hr.vw_attendance_monthly_summary`           | hr        | yes              | Per-user monthly attendance rollup                          |
| `hr.vw_org_attendance_today`                 | hr        | yes              | Today's resolved attendance for an org                      |
| `task.vw_tasks_enriched`                     | task      | yes              | Tasks with resolved assignee/status/priority/list display fields |

> `<product>.vw_member_roles` (previously listed here) was **dropped at schema 1.40.0** along with the per-product role/grant tables — see "Retired: per-product role tables" above.

---

## Key Business-Rule Triggers

| Trigger                          | Table                     | Event                    | Behavior                                                          |
| -------------------------------- | ------------------------- | ------------------------ | ----------------------------------------------------------------- |
| `trg_lead_stage_outcome_check`   | lms.marketing_leads       | INSERT/UPDATE            | Enforces outcome ↔ stage consistency; validates requires_comment   |
| `trg_follow_up_completion_check` | lms.lead_follow_ups       | INSERT/UPDATE            | Enforces completed_at ↔ status='completed' invariant              |
| `trg_marketing_leads_fk_scope`   | lms.marketing_leads       | INSERT/UPDATE            | Validates campaign + assigned_user belong to same org              |
| `trg_lead_interactions_fk_scope` | lms.lead_interactions     | INSERT/UPDATE            | Validates lead + user belong to same org                           |
| `trg_lead_follow_ups_fk_scope`   | lms.lead_follow_ups       | INSERT/UPDATE            | Validates lead + assigned_user belong to same org                  |
| `trg_lead_assignment_log`        | lms.marketing_leads       | AFTER UPDATE             | Logs assignment changes to lms.lead_assignment_log                 |
| `trg_lead_stage_log`             | lms.marketing_leads       | AFTER INSERT/UPDATE      | Logs stage transitions to lms.lead_status_log                      |
| `trg_marketing_leads_audit`      | lms.marketing_leads       | AFTER UPDATE/DELETE      | Field-level diff → audit.marketing_leads_history                   |
| `trg_user_hierarchy_no_cycle`    | iam.users                 | INSERT/UPDATE            | Prevents circular chains in the deprecated manager_id mirror |
| `excl_reporting_lines_overlap`   | iam.reporting_lines       | INSERT/UPDATE (exclusion)| Prevents overlapping active reporting lines for the same user/org  |
| `trg_02_reporting_lines_membership` | iam.reporting_lines    | INSERT/UPDATE            | Both parties must hold an active iam.user_org_mapping row in the line's org |
| `trg_03_reporting_lines_no_cycle`   | iam.reporting_lines    | INSERT/UPDATE            | Rejects a cycle at write time rather than truncating every read |
| `trg_reporting_lines_mirror`        | iam.reporting_lines    | INSERT/UPDATE            | Syncs the deprecated iam.users.manager_id display mirror |
| `trg_user_org_mapping_close_lines`  | iam.user_org_mapping   | UPDATE OF is_active / DELETE | Closes that org's open reporting lines when a mapping is revoked |
| `trg_follow_ups_default_status`  | lms.lead_follow_ups       | BEFORE INSERT            | Sets status to 'pending' when not supplied                         |
| `trg_follow_ups_sync_status`     | lms.lead_follow_ups       | BEFORE UPDATE            | Auto-transitions status when completed_at is set/cleared           |
| `trg_auto_grant_*`              | entity.organizations / iam.user_org_mapping | AFTER INSERT | Auto-grants tenant_admin access to all orgs in tenant |

---

## Utility Functions

| Function                                 | Schema | Purpose                                                |
| ---------------------------------------- | ------ | ------------------------------------------------------ |
| `public.gen_uuidv7()`                    | public | RFC 9562 UUIDv7 generator (time-ordered)               |
| `public.set_updated_at()`                | public | Trigger: auto-update `updated_at`                      |
| `public.soft_delete_row()`               | public | Trigger: converts DELETE to soft-delete                |
| `public.set_created_by()`                | public | Trigger: auto-populates `created_by` from session GUC  |
| `public.set_org_id()`                    | public | Trigger: auto-populates `org_id` from session GUC      |
| `iam.can_assign_to(UUID,UUID,UUID)`      | iam    | Checks if acting user has authority to assign to target |
| `iam.fn_is_in_subtree(UUID,UUID,DATE)`   | iam    | THE authority primitive — is member under manager, as of a date |
| `iam.fn_subtree_members(UUID,DATE)`      | iam    | Everyone below a manager at any depth, as of a date     |
| `iam.fn_manager_chain(UUID,DATE)`        | iam    | Everyone above a user, nearest first, as of a date      |
| `iam.fn_user_active_orgs(UUID)`          | iam    | Returns array of org UUIDs a user has active access to  |
| `iam.fn_org_active_users(UUID)`          | iam    | Returns array of user UUIDs with active access to org   |
| `iam.fn_user_org_rank(UUID,UUID)`        | iam    | Returns user's role rank in a specific org              |
| `iam.purge_expired_token_blocklist()`    | iam    | Cleanup: removes expired token blocklist entries        |
| `iam.fn_mapping_org(UUID)`               | iam    | Resolves a `user_org_mapping_id` to its `org_id` — the required indirection for RLS on per-product membership-extension tables (see "Per-product settings on a membership" above); a direct subquery into `iam.user_org_mapping` is re-filtered by that table's own FORCE'd policies and silently returns NULL |
| `iam.fn_user_can_manage_users(UUID,UUID)`| iam    | SECURITY DEFINER — may this actor create/manage users in *that* org; added 1.43.0, drives the 5 write policies under "User management is a capability, per branch" |
| `iam.fn_user_org_role(UUID,UUID)`        | iam    | Resolves a user's effective `iam.user_roles` row for a given org (tenant-copy-wins resolution) |
| `iam.fn_role_capability_matrix(UUID)`    | iam    | Resolves the full effective (tenant override → platform default → deny) capability grant matrix for a tenant, walking `iam.capabilities`' tree with ancestor-denial cascade — see "A denied parent silently kills its whole subtree" in Architecture.md |
| `iam.fn_actor_can_act_in_org(UUID,UUID)` | iam    | The user-row eligibility check mirrored by `lms.check_lead_fk_org_scope()` on insert — see "Weighted auto-assignment" in Architecture.md |
| `iam.fn_notify_capability_change()`      | iam    | Trigger support for capability-change notifications |
| `iam.set_user_platform_role()`           | iam    | Trigger: maintains `iam.users.platform_role` |
| `audit.fn_detect_password_spray(...)`    | audit  | Backs `audit.vw_password_spray_alerts` |
| `hr.set_employee_profile_tenant_id()`    | hr     | Trigger: derives `hr.employee_profiles.tenant_id` from `org_id` |
| `hr.soft_delete_employee_profile()`      | hr     | Trigger: soft-delete for `hr.employee_profiles` |
| `hr.set_leave_request_is_open()`         | hr     | Trigger: maintains `hr.leave_requests.is_open` from `status_id` |
| `hr.log_leave_status_change()`           | hr     | Trigger: writes `hr.leave_request_status_log` |
| `hr.can_approve_leave(...)`              | hr     | Approver-scope check for `hr.leave_request_approvals` — manager subtree, hr_admin, org_admin |
| `hr.set_attendance_rules_tenant_id()`    | hr     | Trigger: derives `hr.attendance_rules.tenant_id` from `org_id` |
| `hr.can_approve(...)`                    | hr     | Approver-scope check shared by regularizations and the face-review queue |
| `task.set_task_completion()`             | task   | Trigger: syncs `task.tasks.completed_at` with a terminal `status_id` |
| `task.log_task_status_change()`          | task   | Trigger: writes `task.task_status_log` |
| `entity.seed_tenant_defaults(UUID)`      | entity | Provisioning entry point — copies each licensed catalog's current version into a new tenant (see "Tenant default catalogs") |
| `entity.reset_tenant_catalog(UUID,TEXT,INT?)` | entity | Restores one catalog to a default version, FK-safe (preserves row ids) |
| `entity._apply_catalog_rows(...)`        | entity | Shared per-catalog copy helper behind the two functions above |
| `entity.provision_tenant(...)`           | entity | Documented end-to-end tenant-provisioning entry point (`10_tenant_provisioning.sql`) — calls the `seed_tenant_*` family below |
| `entity.seed_tenant_lms_catalogs(...)`   | entity | Mechanism-2 template-row cloning for the 7 LMS/marketing lookups — see "Two provisioning mechanisms" above |
| `entity.seed_tenant_rbac(...)`           | entity | Mechanism-2 cloning for RBAC template rows |
| `entity.seed_tenant_comms(...)`          | entity | Mechanism-2 cloning for `comms.message_templates` |
| `entity.seed_tenant_geo(...)`            | entity | Mechanism-2 cloning for geo defaults |

> `<product>.fn_member_rank(UUID,UUID)` / `<product>.fn_member_role(UUID,UUID)` (previously listed here) were **dropped at schema 1.40.0** along with the per-product role/grant tables — see "Retired: per-product role tables" above. Role/rank resolution now goes through `iam.fn_user_org_role` instead.

---

## Session GUCs (set per-request by API layer)

| GUC                          | Purpose                                     |
| ---------------------------- | ------------------------------------------- |
| `app.current_user_id`        | Acting user's UUID (used by triggers + RLS) |
| `app.current_org_id`         | Current org context (RLS org isolation)      |
| `app.current_tenant_id`      | Current tenant context (RLS tenant isolation)|
| `app.lead_transition_note`   | Free-text note for lead stage transitions, and the stamped reason on bulk assignment moves |

---

## RLS Policy Summary

Every operational table enforces two tiers of isolation:

1. **`org_isolation_policy`** — `app_user` sees only rows matching `app.current_org_id`
2. **`tenant_isolation_policy`** — `tenant_admin` sees rows across all orgs within `app.current_tenant_id`

`root_service` and `analytics_svc` bypass RLS entirely (`BYPASSRLS`).

Audit tables (`lead_status_log`, `lead_assignment_log`, `audit_log`, `marketing_leads_history`, `activities`) are **SELECT-only** for non-service roles — writes happen exclusively via SECURITY DEFINER trigger functions.
