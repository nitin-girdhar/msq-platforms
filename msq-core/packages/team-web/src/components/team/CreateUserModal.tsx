'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SessionUser } from '@platform/types';
import { RANKS } from '@platform/authz';
import {
  Sheet,
  DepartmentSelect,
  OrgAssignmentsField,
  ManagerSelect,
  useRoleCatalog,
  useCampaignTypeCatalog,
  useUserAssignments,
  branchOptionsForActor,
  useUserAdminScope,
} from '@platform/ui-kit';
import { users as usersApi } from '../../lib/api';
import TemporaryPasswordPanel from './TemporaryPasswordPanel';

const PHONE_RE = /^(\+91[\s-]?)?[6-9]\d{9}$/;

// The submit button lives in the Modal's pinned footer, outside the <form>;
// the HTML `form` attribute is what still wires it to this form.
const FORM_ID = 'admin-create-user-form';

// The admin's calendar day, not UTC's: toISOString() would hand an IST admin
// working before 05:30 yesterday's date.
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  actorRank: number;
  users: SessionUser[];
  actor: SessionUser;
  orgs: Array<{ id: string; name: string }>;
  myOrgs: Array<{ id: string; name: string }>;
  branchesFailed: boolean;
  /** Show the "Notify user by email" checkbox — the actor holds admin.team.notify.
   *  Advisory: identity-service re-checks the grant before sending. */
  canNotify: boolean;
}

interface CreateSuccess {
  email: string;
  temporaryPassword: string;
  /** false: the member exists but hr-service could not create their HR profile. */
  hrProfileSynced: boolean;
}

export default function CreateUserModal({ open, onClose, actorRank, actor, orgs, myOrgs, branchesFailed, canNotify }: Props) {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [mobileError, setMobileError] = useState<string | null>(null);
  const [dateOfJoining, setDateOfJoining] = useState(todayLocal);
  const [forcePasswordChange, setForcePasswordChange] = useState(true);
  const [sendEmailNotification, setSendEmailNotification] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<CreateSuccess | null>(null);

  // Only fetch the catalog while the modal is actually open — the Team page
  // mounts this component up-front so the dialog can animate in.
  const { roles, departments, loading: rolesLoading, error: rolesError } = useRoleCatalog(open);
  const { campaignTypes, error: campaignTypesError } = useCampaignTypeCatalog(open);

  // Mounted by lookup-admin, a super_admin creates inside the tenant its navbar
  // selected. Its own branch then sits in ANOTHER tenant, so the new user starts
  // in the selected branch (or the tenant's first) rather than the actor's.
  const adminScope = useUserAdminScope();
  const scopedHome = adminScope.tenant_id
    ? (orgs.find((o) => o.id === adminScope.org_id) ?? orgs[0] ?? null)
    : null;
  const seedBranch = scopedHome
    ? { org_id: scopedHome.id, org_name: scopedHome.name }
    : { org_id: actor.org_id, org_name: actor.org_name };

  const a = useUserAssignments({
    fallbackOrgId: seedBranch.org_id,
    roles,
    rolesLoaded: !rolesLoading,
  });

  // A tenant-wide actor assigns into any branch of the tenant; everyone else
  // into the branches they hold a mapping row for. This used to narrow to
  // `o.id === actor.org_id` behind a rank >= TENANT_ADMIN gate, which hid every
  // branch but the current one from an admin who worked in several.
  const branchOptions = branchOptionsForActor(orgs, myOrgs, seedBranch, actorRank >= RANKS.TENANT_ADMIN);

  // Open the picker whenever there is a real choice; the option list has
  // already answered the authority question.
  const canPickBranches = branchOptions.length > 1;

  const reset = () => {
    setFirstName('');
    setMiddleName('');
    setLastName('');
    setEmail('');
    setMobile('');
    setMobileError(null);
    setDateOfJoining(todayLocal());
    setForcePasswordChange(true);
    setSendEmailNotification(true);
    setError(null);
    setSuccess(null);
    a.reset();
  };

  const handleClose = () => {
    if (pending) return;
    reset();
    onClose();
    if (success) router.refresh();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!firstName.trim()) {
      setError('First name is required.');
      return;
    }
    if (!email.trim()) {
      setError('Email is required.');
      return;
    }
    if (mobile && !PHONE_RE.test(mobile)) {
      setMobileError('Enter a valid 10-digit Indian mobile number.');
      return;
    }
    if (!dateOfJoining) {
      setError('Date of joining is required.');
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
    setPending(true);
    try {
      const body: Record<string, unknown> = {
        first_name: firstName.trim(),
        email: email.trim(),
        force_password_change: forcePasswordChange,
        // Seeds the member's HR profile (Leave Administration → Employees).
        date_of_joining: dateOfJoining,
        ...(canNotify ? { send_email_notification: sendEmailNotification } : {}),
        ...a.payload(),
      };
      if (middleName.trim()) body.middle_name = middleName.trim();
      if (lastName.trim()) body.last_name = lastName.trim();
      if (mobile) body.mobile = mobile;
      if (a.managerId) body.manager_id = a.managerId;

      const data = await usersApi.create(body, adminScope);
      if (!data.temporary_password || !data.data?.email) {
        setError('Unexpected response from server.');
        return;
      }
      setSuccess({
        email: data.data.email,
        temporaryPassword: data.temporary_password,
        hrProfileSynced: data.data.hr_profile_synced !== false,
      });
    } catch (err: unknown) {
      const body = (err as { body?: { details?: Array<{ path: string[]; message: string }> } }).body;
      const detail = body?.details?.map((d) => `${d.path.join('.')}: ${d.message}`).join('; ');
      setError(detail || (err instanceof Error ? err.message : 'Network error.'));
    } finally {
      setPending(false);
    }
  };

  const footer = success ? (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={handleClose}
        className="rounded-xl bg-primary px-4 py-2 min-h-[2.75rem] sm:min-h-0 text-sm font-semibold text-on-primary hover:bg-primary-container"
      >
        Done
      </button>
    </div>
  ) : (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={handleClose} disabled={pending}
        className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 min-h-[2.75rem] sm:min-h-0 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-60">
        Cancel
      </button>
      <button type="submit" form={FORM_ID} disabled={pending} aria-busy={pending}
        className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 min-h-[2.75rem] sm:min-h-0 text-sm font-semibold text-on-primary hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-70">
        {pending && (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-surface-container-lowest/40 border-t-white" aria-hidden />
        )}
        {pending ? 'Creating…' : 'Create user'}
      </button>
    </div>
  );

  return (
    <Sheet open={open} onClose={handleClose} title={success ? 'User created' : 'New user'} locked={pending} maxWidth="sm:max-w-2xl" footer={footer}>
      {success ? (
        <div className="space-y-4">
          <p className="text-sm text-on-surface">
            <span className="font-semibold">{success.email}</span> can now sign in.
          </p>
          <TemporaryPasswordPanel password={success.temporaryPassword} email={success.email} />
          {!success.hrProfileSynced && (
            <p role="alert" className="rounded-lg border border-status-due/30 bg-status-due-container px-2.5 py-1.5 text-[0.71875rem] leading-snug text-on-status-due-container">
              Their HR profile could not be created, so they won&apos;t appear in HRMS attendance or leave yet.
              Open and save this member again to retry.
            </p>
          )}
        </div>
      ) : (
        <form id={FORM_ID} onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          {error && (
            <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id="cu-first-name" label="First name *" value={firstName} onChange={setFirstName} disabled={pending} required autoComplete="given-name" />
            <Field id="cu-last-name" label="Last name" value={lastName} onChange={setLastName} disabled={pending} autoComplete="family-name" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id="cu-middle-name" label="Middle name" value={middleName} onChange={setMiddleName} disabled={pending} autoComplete="additional-name" />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cu-joining" className="text-xs font-semibold text-on-surface">Date of joining *</label>
              <input
                id="cu-joining"
                type="date"
                value={dateOfJoining}
                onChange={(e) => setDateOfJoining(e.target.value)}
                disabled={pending}
                required
                className="rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-surface-container-low"
              />
              <p className="text-[0.6875rem] text-on-surface-variant">Used for leave accrual. HR can change it later.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id="cu-email" label="Email *" type="email" value={email} onChange={setEmail} disabled={pending} required autoComplete="off" />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cu-mobile" className="text-xs font-semibold text-on-surface">Mobile</label>
              <input
                id="cu-mobile"
                type="tel"
                value={mobile}
                onChange={(e) => { setMobile(e.target.value); setMobileError(null); }}
                disabled={pending}
                placeholder="+91 98XXXXXXXX"
                autoComplete="tel"
                className="rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-surface-container-low"
              />
              {mobileError && <p className="text-[0.6875rem] text-on-status-overdue-container">{mobileError}</p>}
            </div>
          </div>

          {rolesError && (
            <div role="alert" className="rounded-xl border border-status-due/30 bg-status-due-container px-3 py-2 text-xs text-on-status-due-container">
              {rolesError}
            </div>
          )}

          {branchesFailed && (
            <div role="alert" className="rounded-xl border border-status-due/30 bg-status-due-container px-3 py-2 text-xs text-on-status-due-container">
              Branches could not be loaded — only your own branch is available.
            </div>
          )}

          <hr className="border-0 border-t border-surface-container" />

          <DepartmentSelect
            departmentId={a.departmentId}
            onDepartmentChange={a.setDepartmentId}
            roles={roles}
            departments={departments}
            loading={rolesLoading}
            disabled={pending}
          />

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
            canPickBranches={canPickBranches}
            disabled={pending}
          />

          <ManagerSelect
            value={a.managerId}
            onChange={a.setManagerId}
            homeOrgId={a.homeOrgId}
            disabled={pending}
          />

          <label className="flex cursor-pointer items-center gap-2 text-xs text-on-surface">
            <input
              type="checkbox"
              checked={forcePasswordChange}
              onChange={(e) => setForcePasswordChange(e.target.checked)}
              disabled={pending}
              className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary/20"
            />
            <span>Require password change on first login</span>
          </label>

          {canNotify && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-on-surface">
              <input
                type="checkbox"
                checked={sendEmailNotification}
                onChange={(e) => setSendEmailNotification(e.target.checked)}
                disabled={pending}
                className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary/20"
              />
              <span>Email the new user their login details and temporary password</span>
            </label>
          )}

        </form>
      )}
    </Sheet>
  );
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'email';
  disabled?: boolean;
  required?: boolean;
  autoComplete?: string;
}

function Field({ id, label, value, onChange, type = 'text', disabled, required, autoComplete }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-on-surface">{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        required={required}
        disabled={disabled}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-surface-container-low"
      />
    </div>
  );
}
