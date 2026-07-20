-- ===================================================================
-- 01_extensions_and_roles.sql
-- Consolidated DDL (1/6): schema-version tracking, Postgres extensions,
-- schema-namespace declarations, the gen_uuidv7() generator, and the
-- platform-wide DB login roles (app_user / tenant_admin / root_service).
-- Idempotent: safe to re-run.
-- ===================================================================

--rollback
--drop database crm (force)
--create database crm_v2
-- ===================================================================
-- CRM Monorepo — Merged Production Schema
-- Combines: monorepo UUID-based design + EXISTING_WORKING_CODE features
-- UUID PKs for all operational/lookup tables
-- SMALLINT/INTEGER PKs for geographic tables (geo.countries/states/cities)
-- Idempotent: safe to re-run (IF NOT EXISTS, ON CONFLICT DO NOTHING)
-- ===================================================================


-- ── Schema version tracking ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.schema_versions (
  version     TEXT        PRIMARY KEY,
  description TEXT,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP()
);

-- ── Extensions ─────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_bytes() used by public.gen_uuidv7()
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

DO $$
BEGIN
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS "vector"';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pgvector not available (%). AI embedding features disabled.', SQLERRM;
END;
$$;

-- ── Schemas ────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS geo;
CREATE SCHEMA IF NOT EXISTS entity;
CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS lms;
CREATE SCHEMA IF NOT EXISTS marketing;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS ext;

-- ── UUIDv7 generator (RFC 9562 §5.7) ──────────────────────────────
-- Time-ordered UUIDs: 48-bit ms timestamp prefix eliminates the
-- random-insert B-tree fragmentation caused by public.gen_uuidv7() (v4).
-- Works on PostgreSQL 14+ with no extensions required.
CREATE OR REPLACE FUNCTION public.gen_uuidv7() RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_millis BIGINT;
  v_bytes  BYTEA;
  v_hex    TEXT;
BEGIN
  v_millis := (EXTRACT(EPOCH FROM CLOCK_TIMESTAMP()) * 1000)::BIGINT;
  v_bytes  := gen_random_bytes(10);
  v_hex :=
    -- 48-bit unix_ts_ms: high 32 bits (8 hex) + low 16 bits (4 hex)
    lpad(to_hex(v_millis >> 16), 8, '0') ||
    lpad(to_hex(v_millis & 65535), 4, '0') ||
    -- version nibble (7) + 12-bit rand_a
    '7' ||
    lpad(to_hex(((get_byte(v_bytes, 0) & 15) << 8) | get_byte(v_bytes, 1)), 3, '0') ||
    -- variant bits (10xxxxxx) + rand_b
    lpad(to_hex((get_byte(v_bytes, 2) & 63) | 128), 2, '0') ||
    lpad(to_hex(get_byte(v_bytes, 3)), 2, '0') ||
    encode(substring(v_bytes from 5 for 6), 'hex');
  RETURN (
    substring(v_hex, 1, 8)  || '-' ||
    substring(v_hex, 9, 4)  || '-' ||
    substring(v_hex, 13, 4) || '-' ||
    substring(v_hex, 17, 4) || '-' ||
    substring(v_hex, 21, 12)
  )::UUID;
END; $$;

-- ── Roles (idempotent) ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN NOINHERIT;
  ELSE
    ALTER ROLE app_user NOLOGIN NOINHERIT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenant_admin') THEN
    CREATE ROLE tenant_admin NOLOGIN NOINHERIT;
  ELSE
    ALTER ROLE tenant_admin NOLOGIN NOINHERIT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'root_service') THEN
    CREATE ROLE root_service WITH LOGIN PASSWORD 'CrmSvc_Dev2025' BYPASSRLS;
  ELSE
    ALTER ROLE root_service WITH LOGIN PASSWORD 'CrmSvc_Dev2025' BYPASSRLS;
  END IF;
END $$;
