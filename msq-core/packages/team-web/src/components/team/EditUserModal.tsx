'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SessionUser } from '@platform/types';
import { RANKS } from '@platform/authz';
import {
  Modal,
  UserPicker,
  DepartmentSelect,
  OrgAssignmentsField,
  ManagerSelect,
  useRoleCatalog,
  useUserAssignments,
  branchOptionsForActor,
  type OrgAssignment,
} from '@platform/ui-kit';
import { users as usersApi, type AssignableUser } from '../../lib/api';
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
  orgs: Array<{ id: string; name: string }>;
  myOrgs: Array<{ id: string; name: string }>;
  branchesFailed: boolean;
  actor: SessionUser;
  /**
   * Which product's work this user might be holding, for the "reassign their
   * leads to" pickers. `null` means the host serves no such product, so there is
   * nothing to hand over: the fetch is skipped and both panels stand down along
   * with the validation that would otherwise block on them.
   */
  leadProduct: 'lms' | 'tasks' | null;
  /** Show the "Notify user by email" checkboxes (branch change here, password
   *  reset in the nested modal) — the actor holds admin.team.notify. Advisory:
   *  identity-service re-checks the grant before sending. */
  canNotify: boolean;
}

export default function EditUserModal({
  open, onClose, user, currentUserId, actorRank, actorRole, orgs, myOrgs, branchesFailed, actor, leadProduct, canNotify,
}: Props) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(user.first_name ?? '');
  const [middleName, setMiddleName] = useState(user.middle_name ?? '');
  const [lastName, setLastName] = useState(user.last_name ?? '');
  const [mobile, setMobile] = useState(user.mobile ?? '');
  const [mobileError, setMobileError] = useState<string | null>(null);
  const [forcePasswordChange, setForcePasswordChange] = useState(user.force_password_change);
  // Opt-out notification for a branch/home-branch change made by this edit.
  // Ignored server-side for a plain profile edit (no branch change).
  const [sendEmailNotification, setSendEmailNotification] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  // Branches this user currently holds, loaded per-open. The roster row carries
  // only their home org, so the full set has to be asked for.
  const [existing, setExisting] = useState<OrgAssignment[] | null>(null);
  const [mappingsError, setMappingsError] = useState<string | null>(null);

  // Lead-capable members of this user's current branch, for the two "Reassign
  // their leads to" pickers. Fetched once per open and shared by both.
  const [lmsUsers, setLmsUsers] = useState<AssignableUser[]>([]);
  const [lmsUsersLoading, setLmsUsersLoading] = useState(false);

  useEffect(() => {
    setFirstName(user.first_name ?? '');
    setMiddleName(user.middle_name ?? '');
    setLastName(user.last_name ?? '');
    setMobile(user.mobile ?? '');
    setMobileError(null);
    setForcePasswordChange(user.force_password_change);
    setSendEmailNotification(true);
    setDeactivating(false);
    setDeactivateReassignTo('');
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

  useEffect(() => {
    if (!open) return;
    // No product, nothing to hand over — and importantly no in-flight load, so
    // the "still loading" guard in handleSave cannot deadlock the form.
    if (!leadProduct) { setLmsUsers([]); setLmsUsersLoading(false); return; }
    let cancelled = false;
    setLmsUsersLoading(true);

    usersApi.assignable({ product: leadProduct, orgId: user.org_id })
      .then((res) => {
        if (cancelled) return;
        setLmsUsers(res.data.filter((u) => u.id !== user.id));
      })
      .catch(() => { if (!cancelled) setLmsUsers([]); })
      .finally(() => { if (!cancelled) setLmsUsersLoading(false); });

    return () => { cancelled = true; };
  }, [open, user.id, user.org_id, leadProduct]);

  const isSelf = user.id === currentUserId;
  // `>=`, not `>`, to match the server: @platform/authz's canManageUser (which
  // assertCanManageTarget applies to POST /users/:id/reset-password) allows an
  // actor to manage a PEER at their own rank. The stricter `>` hid the button
  // for targets the endpoint would have accepted — visible only once the reports
  // scope started surfacing same-rank direct reports on this screen.
  const canSetPassword = actorRank >= user.rank && !isSelf;
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

  // The branch that must always resolve to a name here is the EDITED USER's
  // home branch, not the actor's — this form is about them. Below tenant-wide
  // authority the assignable set is the actor's own branches, so a multi-branch
  // admin can add this person to any branch they administer.
  const branchOptions = useMemo(
    () => branchOptionsForActor(
      orgs,
      myOrgs,
      { org_id: user.org_id, org_name: user.org_name },
      canPickBranches,
    ),
    [canPickBranches, orgs, myOrgs, user.org_id, user.org_name],
  );

  const homeMoved = a.homeOrgId !== user.org_id;
  // Leaving the branch only MATTERS if there is product work that would be
  // stranded there. With no product the move is just a mapping change.
  const leavingHomeBranch =
    Boolean(leadProduct) && homeMoved && !a.assignments.some((x) => x.org_id === user.org_id);
  const originalHomeRoleId = existing?.find((x) => x.org_id === user.org_id)?.role_id;
  const currentHomeRoleId = a.assignments.find((x) => x.org_id === a.homeOrgId)?.role_id;
  const roleChanged = Boolean(currentHomeRoleId) && currentHomeRoleId !== originalHomeRoleId;
  const [reassignLeadsTo, setReassignLeadsTo] = useState('');
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateReassignTo, setDeactivateReassignTo] = useState('');

  // The confirmation panel sits at the BOTTOM of the form (it is the last thing
  // you do, not the first), but the button that opens it lives in the footer —
  // so on a long form it would otherwise appear off-screen and the click would
  // look like it did nothing. Pull it into view when it opens.
  const deactivatePanelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!deactivating) return;
    deactivatePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [deactivating]);

  // Who can inherit this user's open leads. Deliberately NOT a filter of the
  // roster: the rank ladder is shared across products and tenants add their own
  // roles to it, so a same-rank "Fitness Manager" would otherwise be offered as
  // the new owner of a sales pipeline. /users/assignable gates on the LMS
  // capability and on real membership of the branch (the roster row only carries
  // each user's home branch). The leads sit in the branch they are leaving —
  // user.org_id — for both the move and the deactivation case.
  const leadCandidates = useMemo(
    () => lmsUsers.map((u) => ({ id: u.id, name: u.full_name, email: u.email, role_label: u.role_label })),
    [lmsUsers],
  );

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
    // A user leaving their branch strands their open leads there. Someone in that
    // branch must inherit them; only when nobody eligible remains is unassigning
    // them the right answer. Checked here rather than on a disabled Save because
    // this panel shares the form's single submit button.
    if (leavingHomeBranch && !reassignLeadsTo) {
      // An empty candidate list means "unassign" only once it is genuinely known
      // to be empty. While the fetch is in flight it is empty for the wrong
      // reason, and treating that as unassign would strand a pipeline that had a
      // perfectly good successor.
      if (lmsUsersLoading) {
        setError('Still loading who can take over their leads — try again in a moment.');
        return;
      }
      if (leadCandidates.length > 0) {
        setError('Choose who inherits their open leads in the branch they are leaving.');
        return;
      }
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
      // Only meaningful when a branch actually changes; the server ignores it
      // otherwise. Sent alongside the full assignment set.
      if (canNotify) patch.send_email_notification = sendEmailNotification;
      // `|| null` rather than omitting the key: null is an explicit "unassign
      // these leads", which is what the empty-branch case needs. Leaving the key
      // out reads as "say nothing", and the server then skips the reassign
      // entirely and leaves the leads on a user no longer in that branch.
      if (leavingHomeBranch) patch.reassign_leads_to = reassignLeadsTo || null;
    }

    if (Object.keys(patch).length === 0) {
      handleClose();
      return;
    }
    const ok = await submitPatch(patch);
    if (ok) handleClose();
  };

  const handleToggleActive = async () => {
    if (user.is_active) {
      // Deactivating: give the admin a chance to move this user's open leads
      // before the account goes dark, rather than submitting immediately.
      //
      // Unless there is no product to hold leads at all, in which case the
      // confirmation panel does not render and opening it would leave the click
      // doing nothing visible. Submit straight through instead.
      if (!leadProduct) {
        const ok = await submitPatch({ is_active: false });
        if (ok) handleClose();
        return;
      }
      setDeactivating(true);
      return;
    }
    const ok = await submitPatch({ is_active: true });
    if (ok) handleClose();
  };

  const confirmDeactivate = async () => {
    // Always sent, null included — see the note on the same key in handleSave.
    const patch: Record<string, unknown> = {
      is_active: false,
      reassign_leads_to: deactivateReassignTo || null,
    };
    const ok = await submitPatch(patch);
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
            disabled={locked || deactivating}
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

          {branchesFailed && (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Branches could not be loaded — only this user&apos;s current branch is available.
            </div>
          )}

          <hr className="border-0 border-t border-[#F1F5F9]" />

          <DepartmentSelect
            departmentId={a.departmentId}
            onDepartmentChange={a.setDepartmentId}
            roles={roles}
            departments={departments}
            loading={rolesLoading}
            disabled={locked || isSelf}
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
                users={leadCandidates}
                disabled={locked || lmsUsersLoading}
                allowEmpty={leadCandidates.length === 0}
                emptyLabel="— No one left in this branch: unassign them —"
                placeholder={lmsUsersLoading ? 'Loading…' : 'Select a user…'}
              />
              {!lmsUsersLoading && leadCandidates.length === 0 && (
                <p className="text-[11px] text-[#1E40AF]">
                  No one else in this branch works on leads, so these leads will be left unassigned
                  and can be picked up later.
                </p>
              )}
            </div>
          )}

          <ManagerSelect
            value={a.managerId}
            onChange={a.setManagerId}
            homeOrgId={a.homeOrgId}
            excludeUserId={user.id}
            disabled={locked}
          />

          {(homeMoved || roleChanged) && (
            <p className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-2.5 py-1.5 text-[11.5px] leading-snug text-[#92400E]">
              Changing role or home branch signs this user out of all devices.
            </p>
          )}

          {canNotify && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-[#0F172A]">
              <input
                type="checkbox"
                checked={sendEmailNotification}
                onChange={(e) => setSendEmailNotification(e.target.checked)}
                disabled={locked}
                className="h-4 w-4 rounded border-[#E2E8F0] text-[#0b6cbf] focus:ring-[#0b6cbf]/20"
              />
              <span>Email the user if their branch access changes</span>
            </label>
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

          {deactivating && leadProduct && (
            <div ref={deactivatePanelRef} className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
              <p className="text-[12.5px] leading-snug text-red-800">
                Deactivating removes their access immediately. Their open leads in {user.org_name || 'their branch'}{' '}
                need a new owner.
              </p>
              <label className="text-xs font-semibold text-[#0F172A]">Reassign their leads to</label>
              <UserPicker
                value={deactivateReassignTo}
                onChange={setDeactivateReassignTo}
                users={leadCandidates}
                disabled={locked || lmsUsersLoading}
                allowEmpty={leadCandidates.length === 0}
                emptyLabel="— No one left in this branch: unassign them —"
                placeholder={lmsUsersLoading ? 'Loading…' : 'Select a user…'}
              />
              {!lmsUsersLoading && leadCandidates.length === 0 && (
                <p className="text-[11px] text-[#64748B]">
                  No one else in this branch works on leads, so these leads will be left unassigned
                  and can be picked up later.
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setDeactivating(false); setDeactivateReassignTo(''); }}
                  disabled={locked}
                  className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDeactivate}
                  disabled={locked || lmsUsersLoading || (leadCandidates.length > 0 && !deactivateReassignTo)}
                  className="rounded-lg border border-red-300 bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:border-[#E2E8F0] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8]"
                >
                  Confirm deactivation
                </button>
              </div>
            </div>
          )}
        </form>
      </Modal>

      {canSetPassword && (
        <ResetPasswordModal
          open={resetOpen}
          onClose={() => setResetOpen(false)}
          userId={user.id}
          email={user.email}
          actorRole={actorRole}
          forcePasswordChange={forcePasswordChange}
          canNotify={canNotify}
        />
      )}
    </>
  );
}
