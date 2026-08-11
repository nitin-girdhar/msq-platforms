'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SessionUser } from '@platform/types';
import { RANKS } from '@platform/authz';
import {
  Modal,
  UserPicker,
  DepartmentRoleSelect,
  OrgAssignmentsField,
  ManagerSelect,
  useRoleCatalog,
  useUserAssignments,
  type OrgAssignment,
} from '@platform/ui-kit';
import { users as usersApi } from '@/src/lib/api/client';
import ResetPasswordModal from './ResetPasswordModal';

const PHONE_RE = /^(\+91[\s-]?)?[6-9]\d{9}$/;

// The submit button lives in the Modal's pinned footer, outside the <form>;
// the HTML `form` attribute is what still wires it to this form.
const FORM_ID = 'admin-edit-user-form';

interface Props {
  open: boolean;
  onClose: () => void;
  user: SessionUser;
  currentUserId: string;
  actorRank: number;
  actorRole: string;
  users: SessionUser[];
  orgs: Array<{ id: string; name: string }>;
  actor: SessionUser;
}

export default function EditUserModal({
  open, onClose, user, currentUserId, actorRank, actorRole, users, orgs, actor,
}: Props) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(user.first_name ?? '');
  const [middleName, setMiddleName] = useState(user.middle_name ?? '');
  const [lastName, setLastName] = useState(user.last_name ?? '');
  const [mobile, setMobile] = useState(user.mobile ?? '');
  const [mobileError, setMobileError] = useState<string | null>(null);
  const [forcePasswordChange, setForcePasswordChange] = useState(user.force_password_change);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  // Branches this user currently holds, loaded per-open. The roster row carries
  // only their home org, so the full set has to be asked for.
  const [existing, setExisting] = useState<OrgAssignment[] | null>(null);
  const [mappingsError, setMappingsError] = useState<string | null>(null);

  useEffect(() => {
    setFirstName(user.first_name ?? '');
    setMiddleName(user.middle_name ?? '');
    setLastName(user.last_name ?? '');
    setMobile(user.mobile ?? '');
    setMobileError(null);
    setForcePasswordChange(user.force_password_change);
  }, [user]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setExisting(null);
    setMappingsError(null);

    usersApi.orgMappings(user.id)
      .then((res) => {
        if (cancelled) return;
        setExisting(
          res.data
            .filter((m) => m.is_active)
            .map((m) => ({
              org_id: m.org_id,
              role_id: m.role_id,
              lead_assignment_weight: Number(m.lead_assignment_weight ?? 0),
            })),
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Falling back to the home branch alone would silently drop the user's
        // other branches on the next save, so the form reports and stops instead.
        setMappingsError(err instanceof Error ? err.message : 'Could not load this user’s branches.');
        setExisting([]);
      });

    return () => { cancelled = true; };
  }, [open, user.id]);

  const isSelf = user.id === currentUserId;
  const canSetPassword = actorRank > user.rank && !isSelf;
  const canPickBranches = actorRank >= RANKS.TENANT_ADMIN;

  const { roles, departments, loading: rolesLoading, error: rolesError } = useRoleCatalog(open);

  const a = useUserAssignments({
    ...(existing ? { assignments: existing } : {}),
    homeOrgId: user.org_id,
    managerId: user.manager_id ?? '',
    fallbackOrgId: user.org_id || actor.org_id,
    roles,
    rolesLoaded: !rolesLoading,
  });

  const branchOptions = useMemo(
    () => (canPickBranches ? orgs : orgs.filter((o) => o.id === user.org_id)),
    [canPickBranches, orgs, user.org_id],
  );

  const homeMoved = a.homeOrgId !== user.org_id;
  const leavingHomeBranch = homeMoved && !a.assignments.some((x) => x.org_id === user.org_id);
  const [reassignLeadsTo, setReassignLeadsTo] = useState('');

  const managerCandidates = users.filter((u) => u.is_active && u.id !== user.id);

  const handleClose = () => {
    if (pending) return;
    setError(null);
    onClose();
    router.refresh();
  };

  const submitPatch = async (patch: Record<string, unknown>) => {
    setError(null);
    setPending(true);
    try {
      await usersApi.update(user.id, patch);
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
      return false;
    } finally {
      setPending(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mobile && !PHONE_RE.test(mobile)) {
      setMobileError('Enter a valid 10-digit Indian mobile number.');
      return;
    }
    if (!a.isComplete) {
      setError(
        a.assignments.length === 0
          ? 'Select at least one branch.'
          : 'Every branch needs a role.',
      );
      return;
    }
    setMobileError(null);
    const patch: Record<string, unknown> = {};
    if (firstName !== (user.first_name ?? '')) patch.first_name = firstName;
    if (middleName !== (user.middle_name ?? '')) patch.middle_name = middleName || null;
    if (lastName !== (user.last_name ?? '')) patch.last_name = lastName || null;
    if (mobile !== (user.mobile ?? '')) patch.mobile = mobile || null;
    if (forcePasswordChange !== user.force_password_change) patch.force_password_change = forcePasswordChange;

    // Branch memberships are sent as the complete set, not a diff — the server
    // reconciles against what it currently holds, so a branch the admin removed
    // is expressed by its absence. Only sent once the current set has loaded;
    // sending before that would read as "remove everything".
    if (existing !== null) {
      Object.assign(patch, a.payload());
      patch.manager_id = a.managerId || null;
      if (leavingHomeBranch && reassignLeadsTo) patch.reassign_leads_to = reassignLeadsTo;
    }

    if (Object.keys(patch).length === 0) {
      handleClose();
      return;
    }
    const ok = await submitPatch(patch);
    if (ok) handleClose();
  };

  const handleToggleActive = async () => {
    const ok = await submitPatch({ is_active: !user.is_active });
    if (ok) handleClose();
  };

  const locked = pending;

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex gap-2">
        {canSetPassword && (
          <button type="button" onClick={() => setResetOpen(true)} disabled={locked}
            className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60">
            Set password
          </button>
        )}
        {!isSelf && (
          <button
            type="button"
            onClick={handleToggleActive}
            disabled={locked}
            className={
              user.is_active
                ? 'rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60'
                : 'rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60'
            }
          >
            {user.is_active ? 'Deactivate' : 'Reactivate'}
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={handleClose} disabled={locked}
          className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60">
          Cancel
        </button>
        <button type="submit" form={FORM_ID} disabled={locked} aria-busy={pending}
          className="inline-flex items-center gap-2 rounded-xl bg-[#0b6cbf] px-3 py-2 text-xs font-semibold text-white hover:bg-[#095699] disabled:cursor-not-allowed disabled:opacity-70">
          {pending && (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
          )}
          Save changes
        </button>
      </div>
    </div>
  );

  return (
    <>
      <Modal open={open} onClose={handleClose} title={`Edit ${user.name || user.email}`} locked={locked} maxWidth="max-w-2xl" footer={footer}>
        <form id={FORM_ID} onSubmit={handleSave} className="flex flex-col gap-4" noValidate>
          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="eu-first-name" className="text-xs font-semibold text-[#0F172A]">First name</label>
              <input
                id="eu-first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={locked}
                className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="eu-last-name" className="text-xs font-semibold text-[#0F172A]">Last name</label>
              <input
                id="eu-last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={locked}
                className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="eu-middle-name" className="text-xs font-semibold text-[#0F172A]">Middle name</label>
              <input
                id="eu-middle-name"
                value={middleName}
                onChange={(e) => setMiddleName(e.target.value)}
                disabled={locked}
                className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="eu-mobile" className="text-xs font-semibold text-[#0F172A]">Mobile</label>
              <input
                id="eu-mobile"
                type="tel"
                value={mobile}
                onChange={(e) => { setMobile(e.target.value); setMobileError(null); }}
                disabled={locked}
                placeholder="+91 98XXXXXXXX"
                className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
              />
              {mobileError && <p className="text-[11px] text-red-600">{mobileError}</p>}
            </div>
          </div>

          {(rolesError || mappingsError) && (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {rolesError ?? mappingsError}
            </div>
          )}

          <hr className="border-0 border-t border-[#F1F5F9]" />

          <DepartmentRoleSelect
            departmentId={a.departmentId}
            onDepartmentChange={a.setDepartmentId}
            roleId={a.roleId}
            onRoleChange={a.setRoleId}
            roles={roles}
            departments={departments}
            loading={rolesLoading}
            disabled={locked || isSelf}
            roleLabel="Default role"
          />
          {isSelf && (
            <p className="-mt-2 text-[11px] text-[#64748B]">You can&apos;t change your own role.</p>
          )}

          {existing === null && !mappingsError ? (
            <p className="text-[11px] text-[#64748B]">Loading branches…</p>
          ) : (
            <OrgAssignmentsField
              branches={branchOptions}
              assignments={a.assignments}
              onChange={a.setAssignments}
              homeOrgId={a.homeOrgId}
              onHomeChange={a.setHomeOrgId}
              roles={roles}
              departmentId={a.departmentId}
              defaultRoleId={a.roleId}
              canPickBranches={canPickBranches && !isSelf}
              disabled={locked}
              excludeUserId={user.id}
            />
          )}

          {leavingHomeBranch && (
            <div className="flex flex-col gap-2 rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2.5">
              <p className="text-[12.5px] leading-snug text-[#1E40AF]">
                Home branch is moving and they are leaving their current one. Their open leads there need a
                new owner.
              </p>
              <label className="text-xs font-semibold text-[#0F172A]">Reassign their leads to</label>
              <UserPicker
                value={reassignLeadsTo}
                onChange={setReassignLeadsTo}
                users={managerCandidates.filter((u) => u.org_id === user.org_id)}
                disabled={locked}
                allowEmpty
                emptyLabel="— Leave them assigned —"
                placeholder="— Leave them assigned —"
              />
            </div>
          )}

          <ManagerSelect
            value={a.managerId}
            onChange={a.setManagerId}
            homeOrgId={a.homeOrgId}
            excludeUserId={user.id}
            disabled={locked}
          />

          {(homeMoved || a.roleId) && (
            <p className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-2.5 py-1.5 text-[11.5px] leading-snug text-[#92400E]">
              Changing role or home branch signs this user out of all devices.
            </p>
          )}

          <label className="flex cursor-pointer items-center gap-2 text-xs text-[#0F172A]">
            <input
              type="checkbox"
              checked={forcePasswordChange}
              onChange={(e) => setForcePasswordChange(e.target.checked)}
              disabled={locked}
              className="h-4 w-4 rounded border-[#E2E8F0] text-[#0b6cbf] focus:ring-[#0b6cbf]/20"
            />
            <span>Require password change on next login</span>
          </label>
        </form>
      </Modal>

      {canSetPassword && (
        <ResetPasswordModal
          open={resetOpen}
          onClose={() => setResetOpen(false)}
          userId={user.id}
          email={user.email}
          actorRole={actorRole}
        />
      )}
    </>
  );
}
