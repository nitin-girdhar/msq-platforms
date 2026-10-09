'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, PageBody, PageHeader, buildFilename, exportRows } from '@platform/ui-kit';
import {
  ANCHOR_RANK,
  isSuperAdminCapability,
  ownGrantsByKey,
  resolveCapabilityMatrix,
} from '@platform/rbac';
import {
  capabilitiesApi,
  departmentsApi,
  lookupAdmin,
  type CapabilityRow,
  type DepartmentRow,
  type RoleCapabilityRow,
} from '@/src/lib/api/client';
import { buildIndex, originText, stateView } from '@/src/lib/capability-tree';
import DrilldownColumns from './DrilldownColumns';
import PolicyRulesTable, { parentPath } from './PolicyRulesTable';
import ReviewChangesModal, { type StagedChange } from './ReviewChangesModal';
import RoleContextBar from './RoleContextBar';

interface RoleOption {
  id: string;
  name: string;
  label: string;
  // Decides whether the platform-operator (`superadmin.*`) subtree is assignable
  // to this role at all — admin-service refuses the write below super_admin.
  rank: number;
  is_active: boolean;
  department_id: string | null;
}

interface Props {
  selectedTenantId?: string | undefined;
  /** Named in the header so a login-time tenant reset is visible here, not
   *  mistaken for an edit that did not save. See getSelectedTenantName(). */
  tenantName: string | undefined;
}

const ALL_DEPARTMENTS = 'all';

export default function CapabilityMatrixShell({ selectedTenantId, tenantName }: Props) {
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [departmentId, setDepartmentId] = useState(ALL_DEPARTMENTS);
  const [roleId, setRoleId] = useState('');
  const [tree, setTree] = useState<CapabilityRow[]>([]);
  const [grants, setGrants] = useState<RoleCapabilityRow[]>([]);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [lastChange, setLastChange] = useState<{ key: string; granted: boolean } | null>(null);
  const [toolKey, setToolKey] = useState('');
  const [moduleKey, setModuleKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  // The capability CATALOG is platform-wide, so it is fetched once.
  useEffect(() => {
    capabilitiesApi.list()
      .then((res) => setTree(res.data))
      .catch(() => setTree([]));
  }, []);

  // Roles and departments both belong to a tenant. Fetching roles unscoped once
  // offered every tenant's roles at the same time, so tenant A could be paired
  // with a role owned by tenant B and save a grant nothing would ever resolve.
  useEffect(() => {
    setRoleId('');
    setDepartmentId(ALL_DEPARTMENTS);
    if (!selectedTenantId) {
      setRoles([]);
      setDepartments([]);
      return;
    }
    let cancelled = false;
    lookupAdmin.list('user-roles', selectedTenantId)
      .then((res) => {
        if (!cancelled) setRoles((res.data as unknown as RoleOption[]).filter((r) => r.is_active));
      })
      .catch(() => { if (!cancelled) setRoles([]); });
    departmentsApi.list(selectedTenantId)
      .then((res) => { if (!cancelled) setDepartments(res.data); })
      .catch(() => { if (!cancelled) setDepartments([]); });
    return () => { cancelled = true; };
  }, [selectedTenantId]);

  useEffect(() => {
    setPending({});
    setLastChange(null);
    setSavedMessage(null);
    if (!roleId || !selectedTenantId) {
      setGrants([]);
      return;
    }
    setLoading(true);
    setError(null);
    capabilitiesApi.forRole(roleId, selectedTenantId)
      .then((res) => setGrants(res.data))
      .catch(() => setError("Couldn't load this role's grants."))
      .finally(() => setLoading(false));
  }, [roleId, selectedTenantId]);

  const idByKey = useMemo(() => new Map(tree.map((c) => [c.key, c.id])), [tree]);
  const byKey = useMemo(() => new Map(tree.map((c) => [c.key, c])), [tree]);

  // The `superadmin.*` subtree is not rendered at all for a role that cannot hold
  // it. A visible row invites the click, and superadmin.roles.manage DEFINES
  // capability grants, so a mis-tick would hand out the ability to grant
  // anything. This is an affordance, not the boundary: admin-service's putGrants
  // still refuses the write, and that refusal must never be relaxed to match.
  const selectedRole = roles.find((r) => r.id === roleId);
  const subtreeLocked = !!selectedRole && selectedRole.rank < ANCHOR_RANK.SUPER_ADMIN;
  const visibleTree = useMemo(
    () => (subtreeLocked ? tree.filter((c) => !isSuperAdminCapability(c.key)) : tree),
    [tree, subtreeLocked],
  );
  const index = useMemo(() => buildIndex(visibleTree), [visibleTree]);
  const tools = useMemo(() => visibleTree.filter((c) => c.kind === 'tool').sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key)), [visibleTree]);

  // This role's own rows, tenant override beating platform default — the same
  // precedence iam.fn_role_capability_matrix applies.
  const savedOwn = useMemo(
    () => ownGrantsByKey(visibleTree, grants, selectedTenantId ?? ''),
    [visibleTree, grants, selectedTenantId],
  );
  const savedResolved = useMemo(() => resolveCapabilityMatrix(visibleTree, savedOwn), [visibleTree, savedOwn]);
  // Resolved over SAVED + STAGED, so the screen shows the state you are about to
  // save: deny a page and its whole subtree greys out immediately, exactly as the
  // database will on write.
  const resolved = useMemo(
    () => resolveCapabilityMatrix(visibleTree, new Map([...savedOwn, ...Object.entries(pending)])),
    [visibleTree, savedOwn, pending],
  );

  const activeToolKey = tools.some((t) => t.key === toolKey) ? toolKey : (tools[0]?.key ?? '');

  const ruleRows = useMemo(
    () => visibleTree.filter((c) => (c.kind === 'operation' || c.kind === 'scope') && resolved.has(c.key)),
    [visibleTree, resolved],
  );
  const effective = useMemo(() => {
    if (!roleId) return null;
    let granted = 0;
    for (const r of ruleRows) if (resolved.get(r.key)?.granted) granted += 1;
    return { granted, total: ruleRows.length };
  }, [roleId, ruleRows, resolved]);

  // Stage ONE desired state. A change that leaves nothing to write drops the
  // staged entry instead of saving a redundant row.
  //
  // "Nothing to write" is judged against the role's own SAVED ROW, or — with no
  // row — against what a row-less node resolves to right now: a page/tab follows
  // its parent as currently staged, anything else is off. It is NOT judged against
  // the saved resolution: grant a tool and deny one of its pages, and the page's
  // saved state (off, because the tool is not saved yet) already equals "denied",
  // which would silently discard the deny and bring the page back on once the
  // tool is saved.
  const stage = (next: Record<string, boolean>, key: string, granted: boolean) => {
    const node = resolved.get(key);
    if (!node || node.source === 'ancestor-denied') return;
    const saved = savedOwn.get(key);
    const cap = byKey.get(key);
    const rowless = cap && (cap.kind === 'page' || cap.kind === 'tab') && cap.parent_key
      ? !!resolved.get(cap.parent_key)?.granted
      : false;
    const noChange = saved !== undefined ? saved === granted : rowless === granted;
    if (noChange) delete next[key];
    else next[key] = granted;
  };
  const setOne = (key: string, granted: boolean) => {
    setSavedMessage(null);
    setPending((prev) => {
      const next = { ...prev };
      stage(next, key, granted);
      return next;
    });
    setLastChange({ key, granted });
  };
  const setMany = (keys: string[], granted: boolean) => {
    setSavedMessage(null);
    setPending((prev) => {
      const next = { ...prev };
      for (const k of keys) stage(next, k, granted);
      return next;
    });
    const last = keys[keys.length - 1];
    if (last) setLastChange({ key: last, granted });
  };

  const dirtyCount = Object.keys(pending).length;
  const changes: StagedChange[] = useMemo(
    () => Object.entries(pending).map(([key, to]) => ({
      key,
      label: byKey.get(key)?.label ?? key,
      from: !!savedResolved.get(key)?.granted,
      to,
    })),
    [pending, byKey, savedResolved],
  );

  const handleSave = async () => {
    if (!roleId || !selectedTenantId || dirtyCount === 0) return;
    setSaving(true);
    setError(null);
    try {
      const payload = Object.entries(pending).flatMap(([key, is_granted]) => {
        const capability_id = idByKey.get(key);
        return capability_id ? [{ capability_id, is_granted }] : [];
      });
      const res = await capabilitiesApi.putGrants(roleId, selectedTenantId, payload);
      setGrants((prev) => {
        const untouched = prev.filter((g) => !(g.tenant_id === selectedTenantId && payload.some((c) => c.capability_id === g.capability_id)));
        return [...untouched, ...res.data];
      });
      setPending({});
      setLastChange(null);
      setReviewOpen(false);
      setSavedMessage('Saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
      setReviewOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    exportRows(
      ruleRows,
      [
        { header: 'Capability', value: (r: CapabilityRow) => r.label },
        { header: 'Key', value: (r) => r.key },
        { header: 'Tool', value: (r) => parentPath(byKey, r).tool },
        { header: 'Module', value: (r) => parentPath(byKey, r).module },
        { header: 'Type', value: (r) => r.kind },
        { header: 'State', value: (r) => stateView(resolved.get(r.key)).label },
        { header: 'Origin', value: (r) => originText(resolved.get(r.key)) },
        { header: 'Staged', value: (r) => (r.key in pending ? 'yes' : '') },
      ],
      buildFilename(['capability-matrix', selectedRole?.name ?? 'role']),
      'csv',
    );
  };

  // Department chips: only departments that actually hold an active role.
  const deptChoices = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of roles) if (r.department_id) counts.set(r.department_id, (counts.get(r.department_id) ?? 0) + 1);
    return [
      { id: ALL_DEPARTMENTS, label: 'All', hint: `${roles.length} roles` },
      ...departments
        .filter((d) => counts.has(d.id))
        .map((d) => ({ id: d.id, label: d.label || d.name, hint: `${counts.get(d.id)} roles` })),
    ];
  }, [roles, departments]);
  const roleChoices = useMemo(
    () => roles
      .filter((r) => departmentId === ALL_DEPARTMENTS || r.department_id === departmentId)
      .sort((a, b) => b.rank - a.rank)
      .map((r) => ({ id: r.id, label: r.label })),
    [roles, departmentId],
  );

  const roleLabel = selectedRole?.label ?? 'role';
  const lastLabel = lastChange ? (byKey.get(lastChange.key)?.key ?? lastChange.key) : null;

  return (
    <>
      <PageHeader
        title="Capability Matrix"
        scope={tenantName}
        subtitle="Grant or deny operations and scopes. Changes stage until you save."
        info={
          <>
            <p>Pick a tool, drill into its modules, then grant or deny operations and scopes. Changes stage until you save.</p>
            <p>
              Pages and tabs are <strong>on by default</strong> when the tool above them is on. They show <em>Inherited</em> and have no
              row of their own. Denying one saves an explicit deny and switches off everything beneath it. Operations and scopes never
              inherit: they are off until granted.
            </p>
          </>
        }
        actions={
          roleId ? (
            <Button onClick={handleExport} disabled={ruleRows.length === 0}>Export Matrix</Button>
          ) : undefined
        }
      />
      <PageBody dense>
        {error && <Alert tone="error">{error}</Alert>}
        {savedMessage && <Alert tone="success">{savedMessage}</Alert>}

        {dirtyCount > 0 && (
          <div
            role="status"
            className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-status-due bg-status-due-container px-3 py-2 text-xs text-on-status-due-container shadow-sm"
          >
            <span>
              <strong>{dirtyCount} unsaved change{dirtyCount === 1 ? '' : 's'}</strong>
              {lastChange && lastLabel && (
                <>
                  {' '}· latest: <span className="font-mono">{lastLabel}</span> set to {lastChange.granted ? 'Granted' : 'Denied'}
                </>
              )}
            </span>
            <span className="flex gap-2">
              <Button size="sm" onClick={() => { setPending({}); setLastChange(null); }} disabled={saving}>Discard</Button>
              <Button size="sm" variant="primary" onClick={() => setReviewOpen(true)} disabled={saving}>
                Review &amp; Save Changes ({dirtyCount})
              </Button>
            </span>
          </div>
        )}

        {!selectedTenantId ? (
          <p className="rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">
            Pick a tenant in the top bar to manage its role grants.
          </p>
        ) : (
          <>
            <RoleContextBar
              departments={deptChoices}
              departmentId={departmentId}
              onDepartment={(id) => { setDepartmentId(id); setRoleId(''); }}
              roles={roleChoices}
              roleId={roleId}
              onRole={setRoleId}
              effective={effective}
            />
            {!roleId ? (
              <p className="rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">
                Select a role to view and edit its capability grants.
              </p>
            ) : loading ? (
              <p className="text-sm text-on-surface-variant">Loading…</p>
            ) : (
              <>
                <DrilldownColumns
                  index={index}
                  tools={tools}
                  resolved={resolved}
                  pending={pending}
                  toolKey={activeToolKey}
                  moduleKey={moduleKey}
                  onTool={(k) => { setToolKey(k); setModuleKey(''); }}
                  onModule={setModuleKey}
                  onSet={setOne}
                  onSetMany={setMany}
                />
                {/* Desktop only: the phone design is the accordion alone, and a
                    six-column table does not fit 390px. */}
                <div className="hidden lg:block">
                  <PolicyRulesTable
                    roleLabel={roleLabel}
                    rows={ruleRows}
                    byKey={byKey}
                    resolved={resolved}
                    pending={pending}
                    onSet={setOne}
                    onExport={handleExport}
                  />
                </div>
              </>
            )}
          </>
        )}
      </PageBody>
      {reviewOpen && (
        <ReviewChangesModal
          roleLabel={roleLabel}
          changes={changes}
          saving={saving}
          onConfirm={() => void handleSave()}
          onClose={() => setReviewOpen(false)}
        />
      )}
    </>
  );
}
