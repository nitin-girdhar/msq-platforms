'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { UserRole } from '@platform/types';
import { users as usersApi, type UserRow } from '@/src/lib/api/client';
import { Modal, Button } from '@platform/ui-kit';
import RoleSelector from './RoleSelector';
import ResetPasswordModal from './ResetPasswordModal';
import OrgAccessPanel from './OrgAccessPanel';

const PHONE_RE = /^(\+91[\s-]?)?[6-9]\d{9}$/;

// The submit button lives in the Modal's pinned footer, outside the <form>;
// the HTML `form` attribute is what still wires it to this form.
const FORM_ID = 'edit-user-form';

interface OrgOption {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  user: UserRow;
  currentUserId: string;
  orgs: OrgOption[];
}

interface AssignableUser {
  id: string;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  email: string;
}

function displayName(u: UserRow | AssignableUser): string {
  return [u.first_name, u.middle_name, u.last_name].filter(Boolean).join(' ').trim();
}

export default function EditUserModal({ open, onClose, user, currentUserId, orgs }: Props) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(user.first_name ?? '');
  const [middleName, setMiddleName] = useState(user.middle_name ?? '');
  const [lastName, setLastName] = useState(user.last_name ?? '');
  const [mobile, setMobile] = useState(user.mobile ?? '');
  const [mobileError, setMobileError] = useState<string | null>(null);
  const [role, setRole] = useState<UserRole>(user.role_name as UserRole);
  const [orgId, setOrgId] = useState(user.org_id);
  const [reassignTo, setReassignTo] = useState('');
  const [forcePasswordChange, setForcePasswordChange] = useState(Boolean(user.force_password_change));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deactivateReassignTo, setDeactivateReassignTo] = useState('');
  const [lmsUsers, setLmsUsers] = useState<AssignableUser[]>([]);
  const [lmsUsersLoading, setLmsUsersLoading] = useState(false);

  useEffect(() => {
    setFirstName(user.first_name ?? '');
    setMiddleName(user.middle_name ?? '');
    setLastName(user.last_name ?? '');
    setMobile(user.mobile ?? '');
    setMobileError(null);
    setRole(user.role_name as UserRole);
    setOrgId(user.org_id);
    setReassignTo('');
    setForcePasswordChange(Boolean(user.force_password_change));
    setDeactivateOpen(false);
    setDeactivateReassignTo('');
    setLmsUsers([]);
  }, [user]);

  // Fetched on open rather than on deactivate: both the deactivation handoff and
  // the org-move handoff need the same list — lead-capable members of the branch
  // the leads sit in. The plain roster cannot answer that, since the rank ladder
  // is shared across products and tenants add their own roles to it.
  useEffect(() => {
    if (!open) return;
    setLmsUsersLoading(true);
    usersApi.getAssignable('lms', user.org_id)
      .then((res) => setLmsUsers(res.data.filter((u) => u.id !== user.id)))
      .catch(() => setLmsUsers([]))
      .finally(() => setLmsUsersLoading(false));
  }, [open, user.id, user.org_id]);

  const isSelf = user.id === currentUserId;
  const isChangingOrg = orgId !== user.org_id;

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
    setMobileError(null);
    const patch: Record<string, unknown> = {};
    if (firstName !== (user.first_name ?? '')) patch.first_name = firstName;
    if (middleName !== (user.middle_name ?? '')) patch.middle_name = middleName || null;
    if (lastName !== (user.last_name ?? '')) patch.last_name = lastName || null;
    if (mobile !== (user.mobile ?? '')) patch.mobile = mobile || null;
    if (role !== user.role_name) patch.role_name = role;
    if (forcePasswordChange !== Boolean(user.force_password_change)) patch.force_password_change = forcePasswordChange;
    if (isChangingOrg) {
      patch.org_id = orgId;
      if (reassignTo) patch.reassign_leads_to = reassignTo;
    }
    if (Object.keys(patch).length === 0) {
      handleClose();
      return;
    }
    const ok = await submitPatch(patch);
    if (ok) handleClose();
  };

  const handleReactivate = async () => {
    const ok = await submitPatch({ is_active: true });
    if (ok) handleClose();
  };

  const handleConfirmDeactivate = async () => {
    const patch: Record<string, unknown> = { is_active: false };
    // Always include reassign_leads_to when deactivating: null means unassigned, UUID means assign to that user
    patch.reassign_leads_to = deactivateReassignTo || null;
    const ok = await submitPatch(patch);
    if (ok) handleClose();
  };

  const locked = pending;

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex gap-2">
        {!isSelf && (
          <Button variant="secondary" onClick={() => setResetOpen(true)} disabled={locked}>
            Reset password
          </Button>
        )}
        {!isSelf && (
          user.is_active ? (
            !deactivateOpen && (
              <Button variant="danger" onClick={() => setDeactivateOpen(true)} disabled={locked}>
                Deactivate
              </Button>
            )
          ) : (
            <Button
              variant="secondary"
              onClick={handleReactivate}
              disabled={locked}
              className="!border-emerald-200 !text-emerald-700 hover:!bg-emerald-50"
            >
              Reactivate
            </Button>
          )
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={handleClose} disabled={locked}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" form={FORM_ID} disabled={locked} aria-busy={pending}>
          {pending && (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
          )}
          Save changes
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <Modal open={open} onClose={handleClose} title={`Edit ${displayName(user) || user.email}`} locked={locked} maxWidth="max-w-xl" footer={footer}>
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

          <RoleSelector id="eu-role" value={role} onChange={setRole} disabled={locked || isSelf} />
          {isSelf && (
            <p className="-mt-2 text-[11px] text-[#64748B]">You can&apos;t change your own role.</p>
          )}

          <div className="flex flex-col gap-1.5 rounded-xl border border-[#E2E8F0] p-3">
            <label htmlFor="eu-org" className="text-xs font-semibold text-[#0F172A]">Org</label>
            <select
              id="eu-org"
              value={orgId}
              onChange={(e) => { setOrgId(e.target.value); setReassignTo(''); }}
              disabled={locked || isSelf}
              className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>

            {isChangingOrg && (
              <div className="mt-2 flex flex-col gap-1.5">
                <p className="text-[11px] text-[#64748B]">
                  Moving orgs leaves this user&apos;s currently assigned leads in{' '}
                  <span className="font-semibold">{user.org_name || 'their old org'}</span>.
                  Optionally hand them off to someone still there.
                </p>
                <label htmlFor="eu-reassign" className="text-xs font-semibold text-[#0F172A]">Reassign their current leads to</label>
                <select
                  id="eu-reassign"
                  value={reassignTo}
                  onChange={(e) => setReassignTo(e.target.value)}
                  disabled={locked || lmsUsersLoading}
                  className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
                >
                  <option value="">— Don&apos;t reassign —</option>
                  {lmsUsers.map((u) => (
                    <option key={u.id} value={u.id}>{displayName(u) || u.email}</option>
                  ))}
                </select>
                {!lmsUsersLoading && lmsUsers.length === 0 && (
                  <p className="text-[11px] text-[#64748B]">
                    No other LMS users available in this branch. Leads will stay with this user.
                  </p>
                )}
              </div>
            )}
          </div>

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

          {deactivateOpen && (
            <div className="flex flex-col gap-1.5 rounded-xl border border-red-200 bg-red-50 p-3">
              <p className="text-xs text-red-700">
                Deactivating removes {displayName(user) || 'this user'}&apos;s login. Their currently assigned leads in{' '}
                <span className="font-semibold">{user.org_name || 'this org'}</span> will need to be assigned.
              </p>
              <label htmlFor="eu-deactivate-reassign" className="text-xs font-semibold text-[#0F172A]">Reassign their leads to</label>
              <select
                id="eu-deactivate-reassign"
                value={deactivateReassignTo}
                onChange={(e) => setDeactivateReassignTo(e.target.value)}
                disabled={locked || lmsUsersLoading}
                className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
              >
                <option value="">— Unassigned —</option>
                {lmsUsers.map((u) => (
                  <option key={u.id} value={u.id}>{displayName(u) || u.email}</option>
                ))}
              </select>
              {!lmsUsersLoading && lmsUsers.length === 0 && (
                <p className="text-[11px] text-red-600">No other LMS users available in this branch. Leads will remain unassigned.</p>
              )}
              <div className="mt-1 flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => { setDeactivateOpen(false); setDeactivateReassignTo(''); }}
                  disabled={locked}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleConfirmDeactivate}
                  disabled={locked}
                  className="!bg-red-600 hover:!bg-red-700"
                >
                  Confirm deactivation
                </Button>
              </div>
            </div>
          )}

          <div className="border-t border-[#E2E8F0] pt-4">
            <OrgAccessPanel userId={user.id} />
          </div>
        </form>
      </Modal>

      {!isSelf && (
        <ResetPasswordModal
          open={resetOpen}
          onClose={() => setResetOpen(false)}
          userId={user.id}
          email={user.email}
          forcePasswordChange={forcePasswordChange}
        />
      )}
    </>
  );
}
