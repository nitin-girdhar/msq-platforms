'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@platform/ui-kit';
import {
  ANCHOR_RANK,
  isPlatformAdminCapability,
  ownGrantsByKey,
  resolveCapabilityMatrix,
  type GrantSource,
} from '@platform/rbac';
import { capabilitiesApi, lookupAdmin, type CapabilityRow, type RoleCapabilityRow } from '@/src/lib/api/client';

interface RoleOption {
  id: string;
  name: string;
  label: string;
  // Needed to decide whether the `admin` subtree is assignable to this role at
  // all — admin-service refuses the write below super_admin, so the rows have to
  // render locked rather than offer a save that 403s.
  rank: number;
  is_active: boolean;
}

interface Props {
  selectedTenantId?: string | undefined;
}

// What each resolved state looks like on the row. The chip exists because "off"
// has several meanings and only one of them is fixed by ticking this box — an
// operator staring at an unticked page needs to know whether it is denied here,
// denied above, or simply has no row.
const SOURCE_CHIP: Record<GrantSource, { text: string; className: string } | null> = {
  'explicit-grant': null,
  'inherited-grant': { text: 'Inherited', className: 'bg-[#F1F5F9] text-[#64748B]' },
  'explicit-deny': { text: 'Denied here', className: 'bg-red-50 text-red-600' },
  'ancestor-denied': { text: 'Blocked', className: 'bg-amber-50 text-amber-700' },
  'inherited-deny': null,
  'no-grant': null,
};

// Not a GrantSource: the resolver has no opinion here. This says the row cannot
// be EDITED for the selected role, whatever it currently resolves to.
const LOCKED_CHIP = { text: 'Super admin only', className: 'bg-[#EEF2FF] text-[#4338CA]' };

/**
 * Depth-first over parent_key, siblings by sort_order then key.
 *
 * GET /capabilities returns a FLAT list ordered by sort_order — the hierarchy is
 * only in parent_key, so the tree is assembled here. The previous version
 * indented by counting dots, which mis-nests every key carrying dots below its
 * own parent: `lms.leads.interaction.log` is a direct child of `lms.leads`, not
 * a grandchild of anything.
 */
function inTreeOrder(rows: readonly CapabilityRow[]): CapabilityRow[] {
  const childrenOf = new Map<string | null, CapabilityRow[]>();
  for (const row of rows) {
    const siblings = childrenOf.get(row.parent_key);
    if (siblings) siblings.push(row);
    else childrenOf.set(row.parent_key, [row]);
  }
  for (const siblings of childrenOf.values()) {
    siblings.sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));
  }

  const ordered: CapabilityRow[] = [];
  const walk = (parentKey: string | null) => {
    for (const row of childrenOf.get(parentKey) ?? []) {
      ordered.push(row);
      walk(row.key);
    }
  };
  walk(null);
  return ordered;
}

export default function CapabilityMatrixClient({ selectedTenantId }: Props) {
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [roleId, setRoleId] = useState('');
  const [tree, setTree] = useState<CapabilityRow[]>([]);
  const [grants, setGrants] = useState<RoleCapabilityRow[]>([]);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  // The capability CATALOG is platform-wide, so it is fetched once.
  useEffect(() => {
    capabilitiesApi.list()
      .then((res) => setTree(res.data))
      .catch(() => setTree([]));
  }, []);

  // Roles are NOT tenant-independent — every role belongs to a tenant since
  // _migrations/23. Fetching them unscoped offered every tenant's roles at once,
  // so you could pair tenant A with a role owned by tenant B and save a grant
  // that fn_role_capability_matrix would never resolve for either of them.
  useEffect(() => {
    if (!selectedTenantId) {
      setRoles([]);
      setRoleId('');
      return;
    }
    let cancelled = false;
    lookupAdmin.list('user-roles', selectedTenantId)
      .then((res) => {
        if (cancelled) return;
        setRoles((res.data as unknown as RoleOption[]).filter((r) => r.is_active));
      })
      .catch(() => {
        if (!cancelled) setRoles([]);
      });
    // Roles do not carry across a tenant switch — the previous selection names a
    // row the new tenant does not own.
    setRoleId('');
    return () => {
      cancelled = true;
    };
  }, [selectedTenantId]);

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

  // Rows are keyed by capability KEY throughout the screen, because that is what
  // the tree walk speaks; the id is only needed again when saving.
  const idByKey = useMemo(() => new Map(tree.map((c) => [c.key, c.id])), [tree]);

  // This role's own rows, tenant override beating platform default — the same
  // precedence iam.fn_role_capability_matrix applies.
  const savedOwn = useMemo(
    () => ownGrantsByKey(tree, grants, selectedTenantId ?? ''),
    [tree, grants, selectedTenantId],
  );

  // Resolved over SAVED + PENDING so the screen shows the state you are about to
  // save, not the one you started from: deny a page and its whole subtree greys
  // out immediately, which is exactly what the database will do on write.
  const resolved = useMemo(
    () => resolveCapabilityMatrix(tree, new Map([...savedOwn, ...Object.entries(pending)])),
    [tree, savedOwn, pending],
  );

  // The checkbox reflects the RESOLVED answer, which for a page/tab with no row
  // of its own is "on, inherited from its parent". Toggling therefore writes the
  // desired state — for an inherited-on node, an explicit FALSE row.
  //
  // The old code flipped `isGranted(id)`, which rendered a rowless page as
  // UNCHECKED even though the resolver said granted. Unticking it wrote TRUE and
  // hiding a page took check, save, untick, save. That is the whole "I removed
  // the grant but the tab still shows" report.
  // Whether the PLATFORM ADMINISTRATION subtree can be written to this role.
  // admin-service's putGrants refuses it below super_admin, so this mirrors that
  // rule rather than inventing a second one — both sides call
  // isPlatformAdminCapability(), which is why it lives in @platform/rbac.
  //
  // Not a permission question about the person using this screen: reaching it at
  // all already requires super_admin. It is about the role being EDITED.
  const selectedRole = roles.find((r) => r.id === roleId);
  const adminSubtreeLocked = !!selectedRole && selectedRole.rank < ANCHOR_RANK.SUPER_ADMIN;
  const isLocked = (key: string) => adminSubtreeLocked && isPlatformAdminCapability(key);

  const toggle = (key: string) => {
    const node = resolved.get(key);
    if (!node || node.source === 'ancestor-denied' || isLocked(key)) return;
    setSavedMessage(null);
    setPending((prev) => ({ ...prev, [key]: !node.granted }));
  };

  const sorted = useMemo(() => inTreeOrder(tree), [tree]);

  const dirtyCount = Object.keys(pending).length;

  const handleSave = async () => {
    if (!roleId || !selectedTenantId || dirtyCount === 0) return;
    setSaving(true);
    setError(null);
    try {
      const changes = Object.entries(pending).flatMap(([key, is_granted]) => {
        const capability_id = idByKey.get(key);
        return capability_id ? [{ capability_id, is_granted }] : [];
      });
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
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="matrix-role" className="text-xs font-semibold text-[#0F172A]">Role</label>
          {/* Button `sm` scale (px-3 py-1.5 text-xs) so the control lines up
              with the Save button beside it. */}
          <select
            id="matrix-role"
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            disabled={!selectedTenantId}
            className="w-56 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
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
          Pick a tenant in the top bar to manage its role grants.
        </p>
      ) : !roleId ? (
        <p className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm text-[#64748B]">
          Select a role to view and edit its capability grants.
        </p>
      ) : loading ? (
        <p className="text-sm text-[#64748B]">Loading…</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white">
          {/* Nav grants cascade, so a ticked box does not always mean a row
              exists — and unticking one WRITES a deny rather than deleting
              anything. Say so, because that is the part people get wrong. */}
          <p className="border-b border-[#F1F5F9] bg-[#F8FAFC] px-4 py-2 text-[11px] leading-relaxed text-[#64748B]">
            Pages and tabs are <strong>on by default</strong> when the tool above them is on —
            those show <em>Inherited</em> and have no row of their own. Unticking one saves an
            explicit deny, which also switches off everything beneath it. Operations and scopes
            never inherit: they are off until granted.
          </p>
          <ul className="divide-y divide-[#F1F5F9]">
            {sorted.map((cap) => {
              // A node the walk never reached (orphaned parent_key, or an
              // inactive ancestor) cannot be granted at all — the resolver omits
              // it and so do we, rather than drawing a box that does nothing.
              const node = resolved.get(cap.key);
              if (!node) return null;

              const locked = isLocked(cap.key);
              // The lock chip wins over the resolved-state chip: "you cannot set
              // this here" is more useful than "it is currently off", and both in
              // one row reads as a contradiction.
              const chip = locked ? LOCKED_CHIP : SOURCE_CHIP[node.source];
              const blocked = node.source === 'ancestor-denied';
              const inert = blocked || locked;

              return (
                <li
                  key={cap.id}
                  className={`flex items-center justify-between gap-3 px-4 py-2 ${inert ? 'opacity-50' : ''}`}
                  style={{ paddingLeft: `${1 + node.depth * 1.25}rem` }}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[#0F172A]">
                      {cap.label}
                      <span className="ml-2 rounded-full bg-[#F1F5F9] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#94A3B8]">
                        {cap.kind}
                      </span>
                      {chip && (
                        <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${chip.className}`}>
                          {chip.text}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-[11px] text-[#94A3B8]">
                      {cap.key}
                      {node.source === 'inherited-grant' && node.parentKey && (
                        <> · on because {node.parentKey} is on — no row of its own</>
                      )}
                      {blocked && <> · blocked by {node.deniedBy}</>}
                      {locked && <> · platform administration — super_admin only, not assignable to a tenant role</>}
                    </p>
                  </div>
                  <label className={`flex shrink-0 items-center gap-2 ${inert ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      checked={node.granted}
                      // Two reasons a box is not yours to tick, both ending in a
                      // row that means nothing:
                      //   blocked — granting under a denied ancestor resolves to
                      //     nothing; the seed's own self-check
                      //     (07_seed_lookup_data.sql) treats such a row as an error.
                      //   locked  — admin-service refuses to write the `admin`
                      //     subtree to a role below super_admin, so offering the
                      //     tick would only produce a 403 on save.
                      disabled={inert}
                      onChange={() => toggle(cap.key)}
                      className={`h-4 w-4 rounded border-[#E2E8F0] text-[#0b6cbf] focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed ${
                        cap.key in pending ? 'ring-2 ring-amber-400' : ''
                      }`}
                    />
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
