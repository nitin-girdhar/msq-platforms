.PHONY: dev dev-infra dev-services stop build install migrate seed-admin lint typecheck test clean clean-all help db-shell build-docker up down logs ship

# ── Variables ──────────────────────────────────────────────────────────────────
COMPOSE := docker compose
PNPM    := pnpm
DB_NAME ?= crm
DB_URL  ?= postgres://postgres:Passw0rd@localhost:5432/$(DB_NAME)

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-22s\033[0m %s\n", $$1, $$2}'

# ── Development ────────────────────────────────────────────────────────────────
install: ## Install all workspace dependencies
	$(PNPM) install

dev: install dev-infra ## Start the full stack locally (Postgres + all services + web)
	$(PNPM) turbo dev

dev-infra: ## Start Postgres in Docker and wait until healthy
	$(COMPOSE) up -d --wait postgres

dev-services: install ## Start all backend services and the API gateway (excludes web apps)
	$(PNPM) turbo dev --filter='!./*/apps/*'

# ── Database ───────────────────────────────────────────────────────────────────
# DB commands run psql inside the Postgres container (no local psql required).
# Works with both docker-compose and standalone docker-run containers.
DB_CONTAINER  ?= $(DB_CONTAINER_NAME)
DB_CONTAINER_NAME ?= msq-db-server
POSTGRES_USER ?= postgres

define run_sql
	docker cp $(1) $(DB_CONTAINER):/tmp/$(notdir $(1))
	docker exec $(DB_CONTAINER) psql -U $(POSTGRES_USER) -d $(DB_NAME) -f /tmp/$(notdir $(1))
endef

# For the full fresh-install sequence (schema + seeds + cleanup) use
# db_scripts/db_deploy.ps1 — the single platform-wide bootstrap.
migrate: ## Run the full schema bootstrap (db_scripts/01-06)
	$(call run_sql,db_scripts/01_extensions_and_roles.sql)
	$(call run_sql,db_scripts/02_schema.sql)
	$(call run_sql,db_scripts/03_product_schema.sql)
	$(call run_sql,db_scripts/04_roles_and_grants.sql)
	$(call run_sql,db_scripts/05_catalogs.sql)
	$(call run_sql,db_scripts/06_rls.sql)

seed-admin: ## Seed tenants, orgs, and users (db_scripts/08_seed_tenants_orgs_users.sql)
	$(call run_sql,db_scripts/07_seed_lookup_data.sql)
	$(call run_sql,db_scripts/08_seed_tenants_orgs_users.sql)

# All schema now lives in the single platform-root db_scripts/ — the four
# product repos (msq-core / msq-hrms / msq-lms / msq-todo) no longer carry
# their own db_scripts folders; everything deploys centrally to one database.

db-shell: ## Open a psql shell in the Postgres container
	docker exec -it $(DB_CONTAINER) psql -U $(POSTGRES_USER) -d $(DB_NAME)

setup-env: ## Generate per-service .env files from root .env
	node scripts/setup-env.js

# ── Build ──────────────────────────────────────────────────────────────────────
build: install ## Build all packages and services
	$(PNPM) turbo build

build-docker: ## Build all Docker images
	$(COMPOSE) build

ship: ## Build + package Docker images for offline shipping (see scripts/docker-load.md)
	scripts/docker-ship.sh $(SERVICES)

# ── Code Quality ───────────────────────────────────────────────────────────────
lint: ## Lint all workspaces
	$(PNPM) turbo lint

typecheck: ## Type-check all workspaces
	$(PNPM) turbo typecheck

test: ## Run all tests
	$(PNPM) turbo test

# ── Infra Lifecycle ────────────────────────────────────────────────────────────
up: ## Start full stack via Docker Compose (production-like)
	$(COMPOSE) up --build -d

down: ## Tear down all Docker Compose services
	$(COMPOSE) down

stop: ## Stop running Docker Compose services (keep volumes)
	$(COMPOSE) stop

logs: ## Stream Docker Compose logs
	$(COMPOSE) logs -f

# ── Cleanup ────────────────────────────────────────────────────────────────────
clean: ## Remove build artefacts (dist/.turbo/tsbuildinfo/.next in every workspace)
	node scripts/clean.js build

clean-all: ## Remove build artefacts AND all node_modules (full reset — run make install after)
	node scripts/clean.js all
