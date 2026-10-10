'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SessionUser } from '@platform/types';
import { RANKS } from '@platform/authz';
import {
  Sheet,
  UserPicker,
  DepartmentSelect,
  OrgAssignmentsField,
  ManagerSelect,
  useRoleCatalog,
  useCampaignTypeCatalog,
  useUserAssignments,
  branchOptionsForActor,
  useUserAdminScope,
  type OrgAssignment,
} from '@platform/ui-kit';
import { users as usersApi, type AssignableUser } from '../../lib/api';
import ResetPasswordModal from './ResetPasswordModal';
import type { TeamExtraTab } from '../../lib/extra-tabs';

const PHONE_RE = /^(\+91[\s-]?)?[6-9]\d{9}$/;

// The submit button lives in the Modal's pinned footer, outside the <form>;
// the HTML `form` attribute is what still wires it to this form.
const FORM_ID = 'admin-edit-user-form';

// Reasons offered when deactivating from a host that also edits the HR profile. The server stores
// the text as given (max 100); these are only the common choices.
const EXIT_REASONS = ['Resignation', 'Termination', 'End of contract', 'Retirement', 'Other'] as const;

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
  /**
   * Tabs the host adds beside Account (the HR profile in admin-web). Absent or empty = the drawer is the
   * plain Account form, exactly as before. When present, deactivating also asks for a last working day.
   */
  extraTabs?: ReadonlyArray<TeamExtraTab>;
}

export default function EditUserModal({
  open, onClose, user, currentUserId, actorRank, actorRole, orgs, myOrgs, branchesFailed, actor, leadProduct, canNotify, extraTabs,
}: Props) {
  const router = useRouter();
  // lookup-admin's selected tenant — every call below names it (see lib/api).
  const adminScope = useUserAdminScope();
  const [firstName, setFirstName] = useState(user.first_name ?? '');
  const [middleName, setMiddleName] = useState(user.middle_name ?? '');
  const [lastName, setLastName] = useState(user.last_name ?? '');
  const [mobile, setMobile] = useState(user.mobile ?? '');
  const [mobileError, setMobileError] = useState<string | null>(null);
  const [forcePasswordChange, setForcePasswordChange] = useState(user.force_password_change);
  // 'account' (the form below) or an extra tab's id. Extra tabs mount on first visit and then stay
  // mounted, so switching tabs never discards what was typed in another one.
  const [tab, setTab] = useState<string>('account');
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set());
  const hasExtraTabs = (extraTabs?.length ?? 0) > 0;
  // Opt-in notification for a branch/home-branch change made by this edit: off
  // until the admin ticks it. Ignored server-side for a plain profile edit.
  const [sendEmailNotification, setSendEmailNotification] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Saved, but hr-service could not keep the member's HR profile in step.
  const [hrNotice, setHrNotice] = useState<string | null>(null);
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
    setSendEmailNotification(false);
    setTab('account');
    setVisited(new Set());
    setLastWorkingDay(todayLocal());
    setExitReason('');
    setDeactivating(false);
    setDeactivateReassignTo('');
    setOtherBranchReassign({});
    setOtherBranchCandidates({});
  }, [user]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setExisting(null);
    setMappingsError(null);

    usersApi.orgMappings(user.id, adminScope)
      .then((res) => {
        if (cancelled) return;
        setExisting(
          res.data
            .filter((m) => m.is_active)
            .map((m) => ({
              org_id: m.org_id,
              role_id: m.role_id,
              weights: m.weights.map((w) => ({ campaign_type_id: w.campaign_type_id, weight: Number(w.weight ?? 0) })),
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
  }, [open, user.id, adminScope]);

  const isSelf = user.id === currentUserId;
  // `>=`, not `>`, to match the server: @platform/authz's canManageUser (which
  // assertCanManageTarget applies to POST /users/:id/reset-password) allows an
  // actor to manage a PEER at their own rank. The stricter `>` hid the button
  // for targets the endpoint would have accepted — visible only once the reports
  // scope started surfacing same-rank direct reports on this screen.
  const canSetPassword = actorRank >= user.rank && !isSelf;
  const canPickBranches = actorRank >= RANKS.TENANT_ADMIN;

  const { roles, departments, loading: rolesLoading, error: rolesError } = useRoleCatalog(open);
  const { campaignTypes, error: campaignTypesError } = useCampaignTypeCatalog(open);

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
  const originalHomeRoleId = existing?.find((x) => x.org_id === user.org_id)?.role_id;
  // Whether the role they hold in the branch whose leads are at stake works
  // leads (lms.leads). A Fitness Trainer never holds any, so the hand-over
  // panels have nothing to ask. Stays true until the role is actually known —
  // guessing "no leads" early would skip a hand-over that was needed. The
  // 'tasks' product has no such flag, so it keeps the panels as before.
  const originalHomeRole = originalHomeRoleId ? roles.find((r) => r.id === originalHomeRoleId) : undefined;
  const holdsLeads = Boolean(leadProduct) && !(leadProduct === 'lms' && originalHomeRole?.works_leads === false);
  // Leaving the branch only MATTERS if there is product work that would be
  // stranded there. With no product the move is just a mapping change.
  const leavingBranch = homeMoved && !a.assignments.some((x) => x.org_id === user.org_id);
  const leavingHomeBranch = holdsLeads && leavingBranch;

  useEffect(() => {
    if (!open) return;
    // Nothing to hand over — and importantly no in-flight load, so the "still
    // loading" guard in handleSave cannot deadlock the form.
    if (!leadProduct || !holdsLeads) { setLmsUsers([]); setLmsUsersLoading(false); return; }
    let cancelled = false;
    setLmsUsersLoading(true);

    usersApi.assignable({ product: leadProduct, orgId: user.org_id }, adminScope)
      .then((res) => {
        if (cancelled) return;
        setLmsUsers(res.data.filter((u) => u.id !== user.id));
      })
      .catch(() => { if (!cancelled) setLmsUsers([]); })
      .finally(() => { if (!cancelled) setLmsUsersLoading(false); });

    return () => { cancelled = true; };
  }, [open, user.id, user.org_id, leadProduct, holdsLeads, adminScope]);

  const currentHomeRoleId = a.assignments.find((x) => x.org_id === a.homeOrgId)?.role_id;
  const roleChanged = Boolean(currentHomeRoleId) && currentHomeRoleId !== originalHomeRoleId;
  const [reassignLeadsTo, setReassignLeadsTo] = useState('');
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateReassignTo, setDeactivateReassignTo] = useState('');
  // HR's last working day for this deactivation (only asked when the host also edits the HR profile).
  const [lastWorkingDay, setLastWorkingDay] = useState(todayLocal());
  const [exitReason, setExitReason] = useState('');

  // Deactivation takes the login away everywhere, but leads belong to a branch:
  // every OTHER branch they work leads in needs its own new owner. Picked per
  // branch (key = branch id, '' = leave unassigned); the server unassigns any
  // branch not named, so a skipped picker never strands leads.
  const [otherBranchReassign, setOtherBranchReassign] = useState<Record<string, string>>({});
  const [otherBranchCandidates, setOtherBranchCandidates] = useState<Record<string, AssignableUser[]>>({});
  const [otherBranchesLoading, setOtherBranchesLoading] = useState(false);

  const otherLeadBranches = useMemo(() => {
    // Only the LMS owns leads the server can reassign; the tasks product has no
    // per-branch lead hand-over.
    if (leadProduct !== 'lms' || !existing) return [];
    return existing
      .filter((m) => m.org_id !== user.org_id)
      // Roles are tenant-owned; a role not in the catalog yet is kept (guessing
      // "no leads" would skip a hand-over that was needed).
      .filter((m) => roles.find((r) => r.id === m.role_id)?.works_leads !== false)
      .map((m) => ({
        id: m.org_id,
        name: [...orgs, ...myOrgs].find((o) => o.id === m.org_id)?.name ?? 'Another branch',
      }));
  }, [leadProduct, existing, roles, orgs, myOrgs, user.org_id]);

  // Branches the admin has just un-ticked, other than the home branch being left
  // (that one has its own panel above). The user stays active and keeps their
  // other branches, so the leads they hold in each removed branch need an owner
  // before the access is dropped.
  const removedLeadBranches = useMemo(() => {
    if (leadProduct !== 'lms' || !existing) return [];
    const kept = new Set(a.assignments.map((x) => x.org_id));
    return existing
      .filter((m) => m.org_id !== user.org_id && !kept.has(m.org_id))
      .filter((m) => roles.find((r) => r.id === m.role_id)?.works_leads !== false)
      .map((m) => ({
        id: m.org_id,
        name: [...orgs, ...myOrgs].find((o) => o.id === m.org_id)?.name ?? 'Another branch',
      }));
  }, [leadProduct, existing, a.assignments, roles, orgs, myOrgs, user.org_id]);

  // Everything whose candidates must be loaded: the other branches while the
  // deactivate panel is open, plus every branch being removed.
  const candidateBranches = useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>();
    if (deactivating) otherLeadBranches.forEach((b) => byId.set(b.id, b));
    removedLeadBranches.forEach((b) => byId.set(b.id, b));
    return [...byId.values()];
  }, [deactivating, otherLeadBranches, removedLeadBranches]);
  const otherBranchKey = candidateBranches.map((b) => b.id).join(',');

  useEffect(() => {
    if (!open || candidateBranches.length === 0) {
      setOtherBranchesLoading(false);
      return;
    }
    let cancelled = false;
    setOtherBranchesLoading(true);
    Promise.all(
      candidateBranches.map((b) =>
        usersApi.assignable({ product: 'lms', orgId: b.id }, adminScope)
          .then((res) => [b.id, res.data.filter((u) => u.id !== user.id)] as const)
          // A branch the actor cannot list candidates for simply offers none:
          // its leads are unassigned, which the panel says.
          .catch(() => [b.id, [] as AssignableUser[]] as const),
      ),
    ).then((pairs) => {
      if (cancelled) return;
      setOtherBranchCandidates(Object.fromEntries(pairs));
    }).finally(() => { if (!cancelled) setOtherBranchesLoading(false); });
    return () => { cancelled = true; };
    // otherBranchKey stands in for candidateBranches' identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, otherBranchKey, user.id, adminScope]);

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
    setHrNotice(null);
    onClose();
    router.refresh();
  };

  const submitPatch = async (patch: Record<string, unknown>) => {
    setError(null);
    setHrNotice(null);
    setPending(true);
    try {
      const res = await usersApi.update(user.id, patch, adminScope);
      router.refresh();
      // The change itself is saved; stay open so the admin sees why HRMS will
      // not reflect it yet. Saving again retries (the sync is idempotent).
      if (res?.data?.hr_profile_synced === false) {
        setHrNotice(
          'Saved, but their HR profile could not be updated, so HRMS attendance and leave may not reflect this yet. Save again to retry.',
        );
        return false;
      }
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
    // Same rule for every other branch being dropped: someone there inherits the
    // leads when anyone eligible remains; unassigning is only for an empty branch.
    if (removedLeadBranches.length > 0) {
      if (otherBranchesLoading) {
        setError('Still loading who can take over their leads — try again in a moment.');
        return;
      }
      const unchosen = removedLeadBranches.find(
        (b) => (otherBranchCandidates[b.id]?.length ?? 0) > 0 && !otherBranchReassign[b.id],
      );
      if (unchosen) {
        setError(`Choose who inherits their open leads in ${unchosen.name}.`);
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
      // Only when it actually changed, or the home branch moved (the reporting
      // line lives on the home branch, so it has to be rewritten there). An
      // unconditional send superseded the line on every save — and re-validated
      // a manager who may no longer qualify, failing an unrelated edit.
      if (homeMoved || a.managerId !== (user.manager_id ?? '')) {
        patch.manager_id = a.managerId || null;
      }
      // Only meaningful when a branch actually changes; the server ignores it
      // otherwise. Sent alongside the full assignment set.
      if (canNotify) patch.send_email_notification = sendEmailNotification;
      // `|| null` rather than omitting the key: null is an explicit "unassign
      // these leads", which is what the empty-branch case needs. Leaving the key
      // out reads as "say nothing", and the server then skips the reassign
      // entirely and leaves the leads on a user no longer in that branch.
      if (leavingHomeBranch) patch.reassign_leads_to = reassignLeadsTo || null;
      // A role without lms.leads gets no picker, but any stray leads (say from an
      // earlier sales role) are still unassigned rather than left behind.
      else if (leadProduct && leavingBranch) patch.reassign_leads_to = null;
      // One owner per branch being dropped ('' = nobody left there, unassign). The
      // server unassigns any branch it is not told about, so this only ever adds
      // a choice; it can never be the reason leads are left on the user.
      if (removedLeadBranches.length > 0) {
        patch.reassign_leads_by_org = Object.fromEntries(
          removedLeadBranches.map((b) => [b.id, otherBranchReassign[b.id] || null]),
        );
      }
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
      // Always confirm first: the panel carries the last working day HR will record, and, where they
      // hold leads, who inherits them. Panels for leads only render when there is something to hand over.
      setDeactivating(true);
      return;
    }
    const ok = await submitPatch({ is_active: true });
    if (ok) handleClose();
  };

  const confirmDeactivate = async () => {
    // Always sent, null included — see the note on the same key in handleSave.
    const patch: Record<string, unknown> = { is_active: false };
    if (leadProduct) {
      // Nothing was asked for the home branch when their role there holds no leads.
      patch.reassign_leads_to = holdsLeads ? (deactivateReassignTo || null) : null;
      if (otherLeadBranches.length > 0) {
        patch['reassign_leads_by_org'] = Object.fromEntries(
          otherLeadBranches.map((b) => [b.id, otherBranchReassign[b.id] || null]),
        );
      }
    }
    // HR records the exit from this: the day they leave (may be in the future for a notice period).
    if (hasExtraTabs) {
      patch.last_working_day = lastWorkingDay;
      if (exitReason) patch.exit_reason = exitReason;
    }
    const ok = await submitPatch(patch);
    if (ok) handleClose();
  };

  const locked = pending;

  const onAccount = tab === 'account';
  const footer = !onAccount ? (
    <div className="flex justify-end">
      <button type="button" onClick={handleClose} disabled={locked}
        className="rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 min-h-[2.75rem] sm:min-h-0 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-60">
        Close
      </button>
    </div>
  ) : (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex gap-2">
        {canSetPassword && (
          <button type="button" onClick={() => setResetOpen(true)} disabled={locked}
            className="rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 min-h-[2.75rem] sm:min-h-0 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-60">
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
                ? 'rounded-xl border border-status-overdue/30 bg-surface-container-lowest px-3 py-2 min-h-[2.75rem] sm:min-h-0 text-xs font-semibold text-on-status-overdue-container hover:bg-status-overdue-container disabled:cursor-not-allowed disabled:opacity-60'
                : 'rounded-xl border border-status-success/30 bg-surface-container-lowest px-3 py-2 min-h-[2.75rem] sm:min-h-0 text-xs font-semibold text-on-status-success-container hover:bg-status-success-container disabled:cursor-not-allowed disabled:opacity-60'
            }
          >
            {user.is_active ? 'Deactivate' : 'Reactivate'}
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={handleClose} disabled={locked}
          className="rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 min-h-[2.75rem] sm:min-h-0 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-60">
          Cancel
        </button>
        <button type="submit" form={FORM_ID} disabled={locked} aria-busy={pending}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 min-h-[2.75rem] sm:min-h-0 text-xs font-semibold text-on-primary hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-70">
          {pending && (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-surface-container-lowest/40 border-t-white" aria-hidden />
          )}
          Save changes
        </button>
      </div>
    </div>
  );

  return (
    <>
      <Sheet open={open} onClose={handleClose} title={`Edit ${user.name || user.email}`} locked={locked} maxWidth="sm:max-w-2xl" footer={footer}>
        {hasExtraTabs && (
          <div role="tablist" aria-label="Member details" className="-mt-1 mb-4 flex gap-1 overflow-x-auto border-b border-outline-variant">
            {[{ id: 'account', label: 'Account' }, ...(extraTabs ?? []).map((t) => ({ id: t.id, label: t.label }))].map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                disabled={locked}
                onClick={() => { setTab(t.id); setVisited((prev) => new Set(prev).add(t.id)); }}
                className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${tab === t.id ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        {(extraTabs ?? []).map((t) =>
          visited.has(t.id) ? (
            <div key={t.id} role="tabpanel" hidden={tab !== t.id}>
              {t.render({ userId: user.id, name: user.name || user.email, isSelf })}
            </div>
          ) : null,
        )}
        <form id={FORM_ID} onSubmit={handleSave} className={`${onAccount ? 'flex' : 'hidden'} flex-col gap-4`} noValidate>
          {error && (
            <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">
              {error}
            </div>
          )}
          {hrNotice && (
            <div role="alert" className="rounded-xl border border-status-due/30 bg-status-due-container px-3 py-2 text-xs text-on-status-due-container">
              {hrNotice}
            </div>
          )}

          {/* Shown for reference only — the login identity is not editable here,
              and the PATCH below never carries it. */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="eu-email" className="text-xs font-semibold text-on-surface">Email</label>
            <input
              id="eu-email"
              type="email"
              value={user.email}
              readOnly
              disabled
              className="rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2.5 text-sm text-on-surface-variant shadow-sm disabled:cursor-not-allowed"
            />
            <p className="text-[0.6875rem] text-on-surface-variant">Email can&apos;t be changed.</p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="eu-first-name" className="text-xs font-semibold text-on-surface">First name</label>
              <input
                id="eu-first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={locked}
                className="rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-surface-container-low"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="eu-last-name" className="text-xs font-semibold text-on-surface">Last name</label>
              <input
                id="eu-last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={locked}
                className="rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-surface-container-low"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="eu-middle-name" className="text-xs font-semibold text-on-surface">Middle name</label>
              <input
                id="eu-middle-name"
                value={middleName}
                onChange={(e) => setMiddleName(e.target.value)}
                disabled={locked}
                className="rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-surface-container-low"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="eu-mobile" className="text-xs font-semibold text-on-surface">Mobile</label>
              <input
                id="eu-mobile"
                type="tel"
                value={mobile}
                onChange={(e) => { setMobile(e.target.value); setMobileError(null); }}
                disabled={locked}
                placeholder="+91 98XXXXXXXX"
                className="rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-surface-container-low"
              />
              {mobileError && <p className="text-[0.6875rem] text-on-status-overdue-container">{mobileError}</p>}
            </div>
          </div>

          {(rolesError || mappingsError) && (
            <div role="alert" className="rounded-xl border border-status-due/30 bg-status-due-container px-3 py-2 text-xs text-on-status-due-container">
              {rolesError ?? mappingsError}
            </div>
          )}

          {branchesFailed && (
            <div role="alert" className="rounded-xl border border-status-due/30 bg-status-due-container px-3 py-2 text-xs text-on-status-due-container">
              Branches could not be loaded — only this user&apos;s current branch is available.
            </div>
          )}

          <hr className="border-0 border-t border-surface-container" />

          <DepartmentSelect
            departmentId={a.departmentId}
            onDepartmentChange={a.setDepartmentId}
            roles={roles}
            departments={departments}
            loading={rolesLoading}
            disabled={locked || isSelf}
          />
          {isSelf && (
            <p className="-mt-2 text-[0.6875rem] text-on-surface-variant">You can&apos;t change your own role.</p>
          )}

          {existing === null && !mappingsError ? (
            <p className="text-[0.6875rem] text-on-surface-variant">Loading branches…</p>
          ) : (
            <OrgAssignmentsField
              branches={branchOptions}
              assignments={a.assignments}
              onChange={a.setAssignments}
              homeOrgId={a.homeOrgId}
              onHomeChange={a.setHomeOrgId}
              roles={roles}
              departmentId={a.departmentId}
              campaignTypes={campaignTypes}
              campaignTypesUnavailable={Boolean(campaignTypesError)}
              canPickBranches={canPickBranches && !isSelf}
              disabled={locked}
              excludeUserId={user.id}
            />
          )}

          {leavingHomeBranch && (
            <div className="flex flex-col gap-2 rounded-xl border border-l-4 border-primary-fixed-dim border-l-primary bg-primary-fixed px-3 py-2.5">
              <p className="text-[0.78125rem] font-medium leading-snug text-primary">
                Home branch is moving and they are leaving their current one. Their open leads there need a
                new owner.
              </p>
              <label className="text-xs font-bold text-on-surface">Reassign their leads to</label>
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
                <p className="text-[0.6875rem] text-primary">
                  No one else in this branch works on leads, so these leads will be left unassigned
                  and can be picked up later.
                </p>
              )}
            </div>
          )}

          {removedLeadBranches.length > 0 && (
            <div className="flex flex-col gap-2 rounded-xl border border-l-4 border-primary-fixed-dim border-l-primary bg-primary-fixed px-3 py-2.5">
              <p className="text-[0.78125rem] font-medium leading-snug text-primary">
                {removedLeadBranches.length === 1 ? 'A branch is' : 'Branches are'} being removed from this
                user. Their open leads there need a new owner.
              </p>
              {removedLeadBranches.map((b) => {
                const candidates = (otherBranchCandidates[b.id] ?? []).map((u) => ({
                  id: u.id, name: u.full_name, email: u.email, role_label: u.role_label,
                }));
                const nobody = !otherBranchesLoading && candidates.length === 0;
                return (
                  <div key={b.id} className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-on-surface">
                      Reassign their leads in {b.name} to
                    </label>
                    <UserPicker
                      value={otherBranchReassign[b.id] ?? ''}
                      onChange={(id: string) => setOtherBranchReassign((prev) => ({ ...prev, [b.id]: id }))}
                      users={candidates}
                      disabled={locked || otherBranchesLoading}
                      allowEmpty={candidates.length === 0}
                      emptyLabel="— No one left in this branch: unassign them —"
                      placeholder={otherBranchesLoading ? 'Loading…' : 'Select a user…'}
                    />
                    {nobody && (
                      <p className="text-[0.6875rem] text-primary">
                        No one else in {b.name} works on leads, so these leads will be left unassigned
                        and can be picked up later.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <ManagerSelect
            value={a.managerId}
            onChange={a.setManagerId}
            homeOrgId={a.homeOrgId}
            excludeUserId={user.id}
            currentManagerName={user.manager_name}
            disabled={locked}
          />

          {(homeMoved || roleChanged) && (
            <p className="rounded-lg border border-status-due/30 bg-status-due-container px-2.5 py-1.5 text-[0.71875rem] leading-snug text-on-status-due-container">
              Changing role or home branch signs this user out of all devices.
            </p>
          )}

          {canNotify && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-on-surface">
              <input
                type="checkbox"
                checked={sendEmailNotification}
                onChange={(e) => setSendEmailNotification(e.target.checked)}
                disabled={locked}
                className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary/20"
              />
              <span>Email the user if their branch access changes</span>
            </label>
          )}

          <label className="flex cursor-pointer items-center gap-2 text-xs text-on-surface">
            <input
              type="checkbox"
              checked={forcePasswordChange}
              onChange={(e) => setForcePasswordChange(e.target.checked)}
              disabled={locked}
              className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary/20"
            />
            <span>Require password change on next login</span>
          </label>

          {deactivating && (
            <div ref={deactivatePanelRef} className="flex flex-col gap-2 rounded-xl border border-l-4 border-status-overdue/30 border-l-status-overdue bg-status-overdue-container px-3 py-2.5">
              <p className="text-[0.78125rem] font-medium leading-snug text-on-status-overdue-container">
                Deactivating removes their access in every branch, immediately.
                {leadProduct && (holdsLeads || otherLeadBranches.length > 0) && (
                  <>
                    {' '}Their open leads
                    {holdsLeads ? <> in {user.org_name || 'their branch'}{otherLeadBranches.length > 0 ? ' and their other branches' : ''}</> : ' in their other branches'}{' '}
                    need a new owner.
                  </>
                )}
              </p>
              {hasExtraTabs && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="eu-lwd" className="text-xs font-bold text-on-surface">Last working day *</label>
                    <input
                      id="eu-lwd"
                      type="date"
                      value={lastWorkingDay}
                      onChange={(e) => setLastWorkingDay(e.target.value)}
                      disabled={locked}
                      className="rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-surface-container-low"
                    />
                    <p className="text-[0.6875rem] text-on-surface-variant">HR lists them as Exited from this day.</p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="eu-exit-reason" className="text-xs font-bold text-on-surface">Reason</label>
                    <select
                      id="eu-exit-reason"
                      value={exitReason}
                      onChange={(e) => setExitReason(e.target.value)}
                      disabled={locked}
                      className="rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-surface-container-low"
                    >
                      <option value="">— not recorded —</option>
                      {EXIT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </div>
              )}
              {holdsLeads && (
                <>
                  <label className="text-xs font-bold text-on-surface">
                    Reassign their leads in {user.org_name || 'their branch'} to
                  </label>
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
                    <p className="text-[0.6875rem] text-on-surface-variant">
                      No one else in this branch works on leads, so these leads will be left unassigned
                      and can be picked up later.
                    </p>
                  )}
                </>
              )}
              {otherLeadBranches.map((b) => {
                const candidates = (otherBranchCandidates[b.id] ?? []).map((u) => ({
                  id: u.id, name: u.full_name, email: u.email, role_label: u.role_label,
                }));
                return (
                  <div key={b.id} className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-on-surface">
                      Reassign their leads in {b.name} to
                    </label>
                    <UserPicker
                      value={otherBranchReassign[b.id] ?? ''}
                      onChange={(id: string) => setOtherBranchReassign((prev) => ({ ...prev, [b.id]: id }))}
                      users={candidates}
                      disabled={locked || otherBranchesLoading}
                      allowEmpty={candidates.length === 0}
                      emptyLabel="— No one left in this branch: unassign them —"
                      placeholder={otherBranchesLoading ? 'Loading…' : 'Select a user…'}
                    />
                    {!otherBranchesLoading && candidates.length === 0 && (
                      <p className="text-[0.6875rem] text-on-surface-variant">
                        No one else in {b.name} works on leads, so these leads will be left unassigned
                        and can be picked up later.
                      </p>
                    )}
                  </div>
                );
              })}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setDeactivating(false); setDeactivateReassignTo(''); setOtherBranchReassign({}); setExitReason(''); }}
                  disabled={locked}
                  className="rounded-lg border border-outline bg-surface-container-lowest px-3 py-1.5 text-xs font-semibold text-on-surface hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDeactivate}
                  disabled={
                    locked || lmsUsersLoading || otherBranchesLoading
                    || (hasExtraTabs && !lastWorkingDay)
                    || (holdsLeads && leadCandidates.length > 0 && !deactivateReassignTo)
                    // Every other branch with someone eligible must name an owner too;
                    // only a branch with nobody left may be unassigned.
                    || otherLeadBranches.some(
                      (b) => (otherBranchCandidates[b.id]?.length ?? 0) > 0 && !otherBranchReassign[b.id],
                    )
                  }
                  className="rounded-lg border border-status-overdue/30 bg-status-overdue px-3 py-1.5 text-xs font-semibold text-on-primary hover:bg-status-overdue disabled:cursor-not-allowed disabled:border-status-overdue/30 disabled:bg-status-overdue disabled:text-on-primary"
                >
                  Confirm deactivation
                </button>
              </div>
            </div>
          )}
        </form>
      </Sheet>

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
