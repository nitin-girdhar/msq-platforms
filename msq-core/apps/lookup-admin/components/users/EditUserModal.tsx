'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { UserRole } from '@platform/types';
import { users as usersApi, type UserRow } from '@/src/lib/api/client';
import Modal from '../lookups/Modal';
import RoleSelector from './RoleSelector';
import ResetPasswordModal from './ResetPasswordModal';
import OrgAccessPanel from './OrgAccessPanel';

const PHONE_RE = /^(\+91[\s-]?)?[6-9]\d{9}$/;

interface OrgOption {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  user: UserRow;
  currentUserId: string;
  users: UserRow[];
  orgs: OrgOption[];
}

function displayName(u: UserRow): string {
  return [u.first_name, u.middle_name, u.last_name].filter(Boolean).join(' ').trim();
}

export default function EditUserModal({ open, onClose, user, currentUserId, users, orgs }: Props) {
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
  }, [user]);

  const isSelf = user.id === currentUserId;
  const isChangingOrg = orgId !== user.org_id;

  // Active users still in this user's CURRENT org — eligible to take over
  // their open leads, whether because the user is moving orgs (leads stay
  // behind) or being deactivated (their login goes away).
  const currentOrgActiveUsers = useMemo(
    () => users.filter((u) => u.org_id === user.org_id && u.id !== user.id && u.is_active),
    [users, user.org_id, user.id],
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
    if (deactivateReassignTo) patch.reassign_leads_to = deactivateReassignTo;
    const ok = await submitPatch(patch);
    if (ok) handleClose();
  };

  const locked = pending;

  return (
    <>
      <Modal open={open} onClose={handleClose} title={`Edit ${displayName(user) || user.email}`} locked={locked} maxWidth="max-w-xl">
        <form onSubmit={handleSave} className="flex flex-col gap-4" noValidate>
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
                  disabled={locked}
                  className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
                >
                  <option value="">— Don&apos;t reassign —</option>
                  {currentOrgActiveUsers.map((u) => (
                    <option key={u.id} value={u.id}>{displayName(u) || u.email}</option>
                  ))}
                </select>
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
                <span className="font-semibold">{user.org_name || 'this org'}</span> need a new owner.
              </p>
              <label htmlFor="eu-deactivate-reassign" className="text-xs font-semibold text-[#0F172A]">Reassign their current leads to</label>
              <select
                id="eu-deactivate-reassign"
                value={deactivateReassignTo}
                onChange={(e) => setDeactivateReassignTo(e.target.value)}
                disabled={locked}
                className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
              >
                <option value="">
                  {currentOrgActiveUsers.length === 0 ? '— No other active users in this org —' : 'Select a user…'}
                </option>
                {currentOrgActiveUsers.map((u) => (
                  <option key={u.id} value={u.id}>{displayName(u) || u.email}</option>
                ))}
              </select>
              <div className="mt-1 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setDeactivateOpen(false); setDeactivateReassignTo(''); }}
                  disabled={locked}
                  className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDeactivate}
                  disabled={locked || (currentOrgActiveUsers.length > 0 && !deactivateReassignTo)}
                  className="rounded-xl bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Confirm deactivation
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <div className="flex gap-2">
              {!isSelf && (
                <button type="button" onClick={() => setResetOpen(true)} disabled={locked}
                  className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60">
                  Reset password
                </button>
              )}
              {!isSelf && (
                user.is_active ? (
                  !deactivateOpen && (
                    <button type="button" onClick={() => setDeactivateOpen(true)} disabled={locked}
                      className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60">
                      Deactivate
                    </button>
                  )
                ) : (
                  <button type="button" onClick={handleReactivate} disabled={locked}
                    className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60">
                    Reactivate
                  </button>
                )
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={handleClose} disabled={locked}
                className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60">
                Cancel
              </button>
              <button type="submit" disabled={locked} aria-busy={pending}
                className="inline-flex items-center gap-2 rounded-xl bg-[#0b6cbf] px-3 py-2 text-xs font-semibold text-white hover:bg-[#095699] disabled:cursor-not-allowed disabled:opacity-70">
                {pending && (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
                )}
                Save changes
              </button>
            </div>
          </div>

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
        />
      )}
    </>
  );
}
