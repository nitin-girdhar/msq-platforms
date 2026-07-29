'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@platform/ui-kit';
import { capabilitiesApi, lookupAdmin, type CapabilityRow, type RoleCapabilityRow } from '@/src/lib/api/client';
import TenantSelector from '@/components/lookups/TenantSelector';

interface TenantOption {
  id: string;
  name: string;
}

interface RoleOption {
  id: string;
  name: string;
  label: string;
  is_active: boolean;
}

interface Props {
  tenants: TenantOption[];
  selectedTenantId?: string | undefined;
}

const KIND_ORDER: Record<CapabilityRow['kind'], number> = {
  tool: 0,
  page: 1,
  tab: 2,
  operation: 3,
  scope: 4,
};

function depthOf(key: string): number {
  return key.split('.').length - 1;
}

export default function CapabilityMatrixClient({ tenants, selectedTenantId }: Props) {
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [roleId, setRoleId] = useState('');
  const [tree, setTree] = useState<CapabilityRow[]>([]);
  const [grants, setGrants] = useState<RoleCapabilityRow[]>([]);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  // Role catalog + capability catalog are both tenant-independent fetches.
  useEffect(() => {
    lookupAdmin.list('user-roles')
      .then((res) => {
        const rows = (res.data as unknown as RoleOption[]).filter((r) => r.is_active);
        setRoles(rows);
      })
      .catch(() => setRoles([]));
    capabilitiesApi.list()
      .then((res) => setTree(res.data))
      .catch(() => setTree([]));
  }, []);

  useEffect(() => {
    if (!roleId || !selectedTenantId) {
      setGrants([]);
      return;
    }
    setLoading(true);
    setError(null);
    setPending({});
    capabilitiesApi.forRole(roleId, selectedTenantId)
      .then((res) => setGrants(res.data))
      .catch(() => setError("Couldn't load this role's grants."))
      .finally(() => setLoading(false));
  }, [roleId, selectedTenantId]);

  // Effective grant per capability: a tenant override (tenant_id === selectedTenantId)
  // wins over the platform default (tenant_id === null) — same precedence as
  // iam.fn_role_capability_matrix.
  const effective = useMemo(() => {
    const byCapId = new Map<string, { default?: boolean; override?: boolean }>();
    for (const g of grants) {
      const entry = byCapId.get(g.capability_id) ?? {};
      if (g.tenant_id === null) entry.default = g.is_granted;
      else entry.override = g.is_granted;
      byCapId.set(g.capability_id, entry);
    }
    const result = new Map<string, boolean>();
    for (const [capId, entry] of byCapId) {
      result.set(capId, entry.override ?? entry.default ?? false);
    }
    return result;
  }, [grants]);

  const isGranted = (capId: string): boolean => pending[capId] ?? effective.get(capId) ?? false;

  const toggle = (capId: string) => {
    setSavedMessage(null);
    setPending((prev) => ({ ...prev, [capId]: !isGranted(capId) }));
  };

  const sorted = useMemo(
    () => [...tree].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.sort_order - b.sort_order || a.key.localeCompare(b.key)),
    [tree],
  );

  const dirtyCount = Object.keys(pending).length;

  const handleSave = async () => {
    if (!roleId || !selectedTenantId || dirtyCount === 0) return;
    setSaving(true);
    setError(null);
    try {
      const changes = Object.entries(pending).map(([capability_id, is_granted]) => ({ capability_id, is_granted }));
      const res = await capabilitiesApi.putGrants(roleId, selectedTenantId, changes);
      setGrants((prev) => {
        const untouched = prev.filter((g) => !(g.tenant_id === selectedTenantId && changes.some((c) => c.capability_id === g.capability_id)));
        return [...untouched, ...res.data];
      });
      setPending({});
      setSavedMessage('Saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <TenantSelector tenants={tenants} selectedTenantId={selectedTenantId} />

        <div className="flex flex-col gap-1.5 sm:w-72">
          <label htmlFor="matrix-role" className="text-xs font-semibold text-[#0F172A]">Role</label>
          <select
            id="matrix-role"
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            disabled={!selectedTenantId}
            className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
          >
            <option value="">— Select a role —</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.label} ({r.name})</option>
            ))}
          </select>
        </div>

        {roleId && selectedTenantId && (
          <Button variant="primary" onClick={handleSave} disabled={dirtyCount === 0 || saving} aria-busy={saving}>
            {saving ? 'Saving…' : dirtyCount > 0 ? `Save ${dirtyCount} change${dirtyCount === 1 ? '' : 's'}` : 'Saved'}
          </Button>
        )}
      </div>

      {savedMessage && <p className="text-xs font-medium text-emerald-600">{savedMessage}</p>}
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}

      {!selectedTenantId ? (
        <p className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm text-[#64748B]">
          Select a tenant to manage its role grants.
        </p>
      ) : !roleId ? (
        <p className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm text-[#64748B]">
          Select a role to view and edit its capability grants.
        </p>
      ) : loading ? (
        <p className="text-sm text-[#64748B]">Loading…</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white">
          <ul className="divide-y divide-[#F1F5F9]">
            {sorted.map((cap) => (
              <li
                key={cap.id}
                className="flex items-center justify-between gap-3 px-4 py-2"
                style={{ paddingLeft: `${1 + depthOf(cap.key) * 1.25}rem` }}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[#0F172A]">
                    {cap.label}
                    <span className="ml-2 rounded-full bg-[#F1F5F9] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#94A3B8]">
                      {cap.kind}
                    </span>
                  </p>
                  <p className="truncate text-[11px] text-[#94A3B8]">{cap.key}</p>
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={isGranted(cap.id)}
                    onChange={() => toggle(cap.id)}
                    className={`h-4 w-4 rounded border-[#E2E8F0] text-[#0b6cbf] focus:ring-[#0b6cbf]/20 ${
                      cap.id in pending ? 'ring-2 ring-amber-400' : ''
                    }`}
                  />
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
