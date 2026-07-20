# CRM Monorepo — Database Model

> **Database:** PostgreSQL 14+  
> **Schema version:** 1.2.0  
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
| `hr`        | Employee profiles, leave, attendance, effective-dated reporting lines (`reporting_lines`) |
| `task`      | To-do lists, tasks, comments                     |

---

## Database Roles

| Role              | Type         | RLS       | Purpose                                      |
| ----------------- | ------------ | --------- | --------------------------------------------- |
| `app_user`        | NOLOGIN      | Subject   | Standard app role — DML on operational tables |
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

Role definitions with rank-based hierarchy.

> **Legacy (P1.1):** this single global ladder is being replaced by per-product ladders (`lms.roles`, `hr.roles`, `task.roles`) plus per-product grants (`<product>.member_roles`). During the migration it stays authoritative (Phases A–C); the Phase E contract deprecates it. See those sections below.

| Column      | Type | Constraints                       |
| ----------- | ---- | --------------------------------- |
| id          | UUID    | PK (UUIDv7)                       |
| name        | TEXT    | NOT NULL, UNIQUE                  |
| label       | TEXT    | NOT NULL                          |
| description | TEXT    |                                   |
| rank        | INT     | NOT NULL, DEFAULT 0 (range 0-100) |
| is_active   | BOOLEAN | NOT NULL, DEFAULT TRUE            |

**Seed values (by rank):**

| rank | name                     | label                   |
| ---- | ------------------------ | ----------------------- |
| 0    | read_only                | Read Only               |
| 20   | sales_representative     | Sales Representative    |
| 40   | senior_sales_executive   | Senior Sales Executive  |
| 60   | org_manager              | Manager                 |
| 70   | org_sr_manager           | Senior Manager          |
| 80   | org_admin                | Admin                   |
| 90   | tenant_admin             | Tenant Admin            |
| 100  | super_admin              | Super Admin             |

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
| email                 | TEXT        | NOT NULL, UNIQUE                           |
| mobile                | TEXT        |                                            |
| password_hash         | TEXT        | NOT NULL                                   |
| role_id               | UUID        | NOT NULL, FK → iam.user_roles(id)          |
| platform_role         | TEXT        | CHECK IN (`super_admin`,`tenant_admin`,`org_admin`,`member`); nullable until Phase E (P1.1). Coarse cross-product role that survives in the shrunk JWT; drives PG-role selection + platform-wide capability only. |
| manager_id            | UUID        | FK → iam.users(id), self-referential       |
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

**Checks:** `id <> manager_id`, `NOT (is_active AND is_deleted)`  
**RLS:** app_user sees users with active mapping to current org; tenant_admin sees all within tenant  
**Triggers:** `set_updated_at`, `soft_delete_row`, `set_org_id`, `set_created_by`, `check_user_hierarchy_no_cycle`, `audit_row_changes`

---

### iam.user_org_mapping

Multi-org access control. Source of truth for which orgs a user can access.

| Column     | Type        | Constraints                              |
| ---------- | ----------- | ---------------------------------------- |
| user_id    | UUID        | NOT NULL, FK → iam.users(id), PK (composite) |
| org_id     | UUID        | NOT NULL, FK → entity.organizations(id), PK (composite) |
| role_id    | UUID        | NOT NULL, FK → iam.user_roles(id)        |
| is_active  | BOOLEAN     | NOT NULL, DEFAULT TRUE                   |
| lead_assignment_weight | SMALLINT | NOT NULL, DEFAULT 0, CHECK 0-100; % share of new leads auto-routed to this user within this org. Sum across an org's rows must be 100 (or all 0 to disable), enforced at the application layer — see `PUT /users/assignment-weights` |
| granted_by | UUID        | FK → iam.users(id)                       |
| granted_at | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()      |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()      |

**PK:** `(user_id, org_id)`  
**RLS:** Users can read own rows; org admins (rank >= 80) manage within their org; any user rank >= 40 (SSE, matches `minRankToAssignLeads`) can read other rows within their own org (`assignable_read_policy`, needed for the lead "Assigned To" picker); tenant_admin manages across tenant  
**Triggers:** `set_updated_at`, `auto_grant_all_orgs_on_tenant_admin`

---

### hr.reporting_lines

Effective-dated HR managerial hierarchy (P2.1, `21_init-reporting-lines.sql`) — the **sole**
source of truth for the leave/attendance approval chain
(`resolveApprovers`/`buildApproverChain` in `services/hr-service/.../resolve-approvers.ts`).
Deliberately **decoupled** from the LMS assignment hierarchy: `iam.users.manager_id` /
`iam.vw_user_team_members` drive lead auto-assignment and the LMS "Assigned To" subtree
(`can_assign_to`), and are never read on the HR approval path. `manager_id` only backfills the
initial `reporting_lines` rows once, then is an optional default — re-orging HR reporting or
reassigning LMS leads cannot affect the other tree. See P2.2 tests proving this independence.

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
**RLS:** `app_user` reads (SELECT-only) rows in `app.current_org_id`; `tenant_admin` reads/writes (no delete) within `app.current_tenant_id`; `hr_svc` reads/writes under RLS; `root_service` full access.  
**Triggers:** `set_updated_at`, `soft_delete_row`, `set_org_id`, `set_created_by`, audit on UPDATE/DELETE  
**Backfill:** one open-ended row per user with a non-null `manager_id`, idempotent (`NOT EXISTS` guard). Users without a line resolve via the approver resolver's deterministic `org_admin`/`hr_admin` fallback, not an inferred manager.

---

### lms.roles / hr.roles / task.roles

Per-product role **catalogs** (P1.1, `17_init-per-product-roles.sql`). Each product owns its own ladder; **ranks are only comparable within a product**. Machine key is `name` (stable), display is `label`.

> **Tenant-scoped (`22_tenant-scope-lookups.sql`):** originally global reference data; now carries `tenant_id NOT NULL` and RLS. Every tenant starts with an identical copy of the seeded ladder below. **P3.3** added the per-tenant customization API; **N-6 (Half A)** then moved that API from admin-service to the **owning product service** (`{lms,hr,task}-roles` → leads/hr/tasks-service), each `GET/POST /lookups/{…}-roles` + `PATCH …/:id` requiring a `tenant_id` query param (super_admin JWTs carry no tenant). The write runs as the product-scoped login via `withTenantConfigTx` (pins `app.current_tenant_id` to the selected tenant); `25_lookup-admin-write-rls.sql` adds the tenant-pinned admin write policy (`FOR ALL TO app_user` keyed on `app.current_tenant_id`) + `INSERT,UPDATE` GRANTs to the product role — **no `root_service`/BYPASSRLS**. `apps/lookup-admin` gates editing behind a tenant selector. See "Lookup table administration" in Architecture.md.

| Column      | Type    | Constraints                                          |
| ----------- | ------- | ----------------------------------------------------- |
| id          | UUID    | PK (UUIDv7)                                           |
| tenant_id   | UUID    | NOT NULL, FK → entity.tenants(id) ON DELETE CASCADE   |
| name        | TEXT    | NOT NULL, UNIQUE per `(tenant_id, name)`              |
| label       | TEXT    | NOT NULL                                              |
| description | TEXT    |                                                        |
| rank        | INT     | NOT NULL, DEFAULT 0 (range 0-100)                     |
| sort_order  | INT     | NOT NULL, DEFAULT 0                                   |
| is_active   | BOOLEAN | NOT NULL, DEFAULT TRUE                                |

**Seeded ladders** (per tenant):

| `lms.roles` (rank) | `hr.roles` (rank) | `task.roles` (rank) |
| ------------------ | ----------------- | ------------------- |
| read_only (0)      | hr_viewer (0)     | task_member (20)    |
| sales_representative (20) | hr_staff (40) | task_lead (40)   |
| senior_sales_executive (40) | hr_manager (70) | task_admin (80) |
| org_manager (60)   | hr_admin (80)     |                     |
| org_sr_manager (70)|                   |                     |
| lms_admin (80)     |                   |                     |

**RLS:** app_user `SELECT`s rows for the tenant owning its current org (`org_isolation_policy`); tenant_admin `SELECT`s rows for its own tenant directly (`tenant_isolation_policy`). Matches the `hr.leave_policies`/`hr.hr_settings` read-only-tenant-data pattern.
**Grants:** `SELECT` to app_user/tenant_admin (unchanged — no write access added); `ALL` to root_service.
**Known follow-up:** tenant provisioning doesn't auto-seed these rows for a brand-new tenant yet (same gap as `hr.hr_settings`).

---

### lms.member_roles / hr.member_roles / task.member_roles

The `(user, product, role)` **grant** (P1.1, `17_init-per-product-roles.sql`). Org-grained (preserves multi-org users), tenant-isolated via RLS. Shape mirrors `iam.user_org_mapping`. Backfilled from the old ladder in `18_backfill-per-product-roles.sql`.

| Column     | Type        | Constraints                                              |
| ---------- | ----------- | ------------------------------------------------------- |
| user_id    | UUID        | NOT NULL, FK → iam.users(id) ON DELETE CASCADE, PK (composite) |
| org_id     | UUID        | NOT NULL, FK → entity.organizations(id) ON DELETE CASCADE, PK (composite) |
| tenant_id  | UUID        | NOT NULL, FK → entity.tenants(id) ON DELETE CASCADE; **set by trigger from org_id** — never written directly |
| role_id    | UUID        | NOT NULL, FK → `<product>`.roles(id) ON DELETE RESTRICT  |
| is_active  | BOOLEAN     | NOT NULL, DEFAULT TRUE                                   |
| granted_by | UUID        | FK → iam.users(id) ON DELETE SET NULL                   |
| granted_at | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()                     |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP()                     |

**PK:** `(user_id, org_id)` — one role per user per org per product.  
**RLS:** `FORCE`d. app_user: `org_id = app.current_org_id` (ALL, incl. `WITH CHECK`); tenant_admin: `tenant_id = app.current_tenant_id`; root_service bypasses.  
**Grants:** `SELECT, INSERT, UPDATE` to app_user/tenant_admin (revoke = `is_active=false`, no DELETE grant); `ALL` to root_service.  
**Triggers:** `set_member_role_tenant_id` (BEFORE INSERT/UPDATE, derives `tenant_id` from `org_id` so a client cannot spoof it), `set_updated_at`.  
**Helper:** `<product>.fn_member_rank(user, org)` — SECURITY DEFINER, returns the user's active rank in that product+org or **-1** if no grant (how "no product access" is encoded); safe to call inside other tables' RLS policies.  
**Helper (P1.3, `20_member-role-resolver-fn.sql`):** `<product>.fn_member_role(user, org)` — SECURITY DEFINER, returns `(role TEXT, rank INT)` for the active grant, or `(NULL, -1)` if none. Sibling of `fn_member_rank` that also returns the role **name** the authz packages need. Each product service resolves the acting user's product role/rank through this (via `@platform/db`'s `resolveMemberRole`) instead of trusting a JWT/header rank. `GRANT EXECUTE` to `app_user`, `tenant_admin`, and the product's `*_svc` login (+ `lead_svc` for lms).  
**View:** `<product>.vw_member_roles` (`security_invoker`) resolves `role`/`role_label`/`rank` + `org_name` + user.

---

### Tenant-scoped lookups — task.task_statuses / task.task_priorities / hr.leave_types / hr.employment_types / hr.attendance_statuses

Originally global lookups (`10_init-hr-task-schemas.sql`, `14_init-tasks.sql`), converted to tenant-scoped by `22_tenant-scope-lookups.sql`. Every tenant starts with an identical seeded catalog, but **P3.3** added the per-tenant customization API, and **N-6 (Half A)** moved it from admin-service to the **owning product service**: `GET/POST /lookups/{task-statuses,task-priorities}` (tasks-service) and `/lookups/{leave-types,employment-types,attendance-statuses}` (hr-service), plus the matching `PATCH .../:id`, each requiring a `tenant_id` query param. Instead of the old super_admin→BYPASSRLS path (which needed an explicit `WHERE tenant_id`), the write now runs as the product-scoped login via `withTenantConfigTx`, pinning `app.current_tenant_id` to the selected tenant; `25_lookup-admin-write-rls.sql` adds a tenant-pinned admin write policy (`FOR ALL TO app_user` keyed on `app.current_tenant_id`) + `INSERT,UPDATE` GRANTs to `hr_svc`/`task_svc`, so a write physically cannot touch another tenant's rows (the explicit `WHERE tenant_id` is kept as defense-in-depth). `apps/lookup-admin` gates editing behind a tenant selector. See "Lookup table administration" in Architecture.md. `hr.leave_request_statuses` was deliberately **not** converted and remains global.

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

**`entity.catalog_versions`** — one row per catalog: `current_version` (which version a NEW tenant gets) + `modules TEXT[]` (seed only if the tenant has ANY of these active `entity.tenant_modules`). Editing a catalog for future tenants = insert v N+1 rows into `catalog_defaults` and bump `current_version`. The eight registered catalogs and their gating modules: `lms.roles`→`{lms}`; `task.task_statuses`/`task.task_priorities`/`task.roles`→`{tasks}`; `hr.leave_types`→`{leave}`; `hr.attendance_statuses`→`{attendance}`; `hr.roles`/`hr.employment_types`→`{leave,attendance}` (HR-wide).

**`entity.tenant_catalog_versions`** — per-tenant record of the seeded/reset version per catalog. `UNIQUE (tenant_id, catalog_key)`; `tenant_id` FK → `entity.tenants` ON DELETE CASCADE. Drives seeder idempotency (a catalog already recorded is never re-seeded). **RLS:** SELECT-only, mirroring `entity.tenant_modules` (app_user via current org, tenant_admin own tenant); only `root_service` writes.

**Functions** (all `REVOKE`d from PUBLIC, `EXECUTE` to `root_service` only — they cross tenant boundaries and run under `withServiceTx`):

- `entity.seed_tenant_defaults(tenant_id)` → provisioning entry point; copies each licensed, not-yet-seeded catalog's current version into the tenant's private tables (`ON CONFLICT DO NOTHING`) and records the version. Idempotent; call **after** the tenant's `tenant_modules` rows exist.
- `entity.reset_tenant_catalog(tenant_id, catalog_key, version?)` → restores one catalog to a default version (defaults to current): re-adds deleted defaults and restores default label/flags/sort_order **without changing row ids** (FK-safe); leaves tenant-custom rows untouched.
- `entity._apply_catalog_rows(tenant_id, catalog_key, version, reset)` → shared per-catalog copy helper.

TS wrappers: `seedTenantDefaults()` / `resetTenantCatalog()` / `getTenantCatalogVersions()` in `@platform/db` (`packages/db/src/seed-tenant-defaults.ts`).

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

### public.schema_versions

Schema migration tracking.

| Column      | Type        | Constraints                         |
| ----------- | ----------- | ----------------------------------- |
| version     | TEXT        | PK                                  |
| description | TEXT        |                                     |
| applied_at  | TIMESTAMPTZ | NOT NULL, DEFAULT CLOCK_TIMESTAMP() |

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
| `iam.vw_user_org_chart`                      | iam       | yes              | Recursive org chart with depth + breadcrumb path           |
| `iam.vw_user_team_members`                   | iam       | yes              | Recursive subtree membership for hierarchy authority       |
| `iam.vw_user_org_access`                     | iam       | yes              | Active org-user mappings with role context                 |
| `marketing.vw_campaign_lookup`               | marketing | yes              | Campaigns with resolved platform/status                    |
| `marketing.vw_tenant_campaign_summary`       | marketing | yes              | Campaign performance by tenant                             |
| `ext.view_meta_leads_complete`               | ext       | yes              | Meta leads joined to CRM marketing_leads, address, professional, demographics |

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
| `trg_user_hierarchy_no_cycle`    | iam.users                 | INSERT/UPDATE            | Prevents circular manager chains (LMS/org tree — independent of hr.reporting_lines) |
| `excl_reporting_lines_overlap`   | hr.reporting_lines        | INSERT/UPDATE (exclusion)| Prevents overlapping active reporting lines for the same user/org  |
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
| `iam.fn_user_active_orgs(UUID)`          | iam    | Returns array of org UUIDs a user has active access to  |
| `iam.fn_org_active_users(UUID)`          | iam    | Returns array of user UUIDs with active access to org   |
| `iam.fn_user_org_rank(UUID,UUID)`        | iam    | Returns user's role rank in a specific org              |
| `iam.purge_expired_token_blocklist()`    | iam    | Cleanup: removes expired token blocklist entries        |
| `<product>.fn_member_rank(UUID,UUID)`    | lms/hr/task | Returns user's active product rank in an org, or -1 |
| `<product>.fn_member_role(UUID,UUID)`    | lms/hr/task | Returns `(role, rank)` of the user's active product grant in an org, or `(NULL,-1)` — per-service role resolver (P1.3) |

---

## Session GUCs (set per-request by API layer)

| GUC                          | Purpose                                     |
| ---------------------------- | ------------------------------------------- |
| `app.current_user_id`        | Acting user's UUID (used by triggers + RLS) |
| `app.current_org_id`         | Current org context (RLS org isolation)      |
| `app.current_tenant_id`      | Current tenant context (RLS tenant isolation)|
| `app.lead_transition_note`   | Free-text note for lead stage transitions   |

---

## RLS Policy Summary

Every operational table enforces two tiers of isolation:

1. **`org_isolation_policy`** — `app_user` sees only rows matching `app.current_org_id`
2. **`tenant_isolation_policy`** — `tenant_admin` sees rows across all orgs within `app.current_tenant_id`

`root_service` and `analytics_svc` bypass RLS entirely (`BYPASSRLS`).

Audit tables (`lead_status_log`, `lead_assignment_log`, `audit_log`, `marketing_leads_history`, `activities`) are **SELECT-only** for non-service roles — writes happen exclusively via SECURITY DEFINER trigger functions.
