import type { PullVerdict, StagedLeadRow } from '@/src/lib/api/client';

// One source for the wording and colour of a staged-lead verdict / apply outcome.
// DeltaSummary and StagedLeadsGrid used to keep their own copies, and they had
// drifted ("Already in LMS" vs "Already synced", "Test leads" vs "Test lead").

export const VERDICT_ORDER: PullVerdict[] = [
  'new',
  'phone_duplicate',
  'email_duplicate',
  'already_synced',
  'test_lead',
  'unmapped_form',
  'missing_contact',
];

export const VERDICT_LABELS: Record<PullVerdict, string> = {
  new: 'New',
  phone_duplicate: 'Phone duplicate',
  email_duplicate: 'Email duplicate',
  already_synced: 'Already in LMS',
  test_lead: 'Test lead',
  unmapped_form: 'Unmapped form',
  missing_contact: 'Missing contact',
};

export const VERDICT_CLASSES: Record<PullVerdict, string> = {
  new: 'bg-status-success-container text-on-status-success-container',
  phone_duplicate: 'bg-status-info-container text-primary',
  email_duplicate: 'bg-status-info-container text-primary',
  already_synced: 'bg-surface-container text-on-surface-variant',
  test_lead: 'bg-surface-container text-on-surface-variant',
  unmapped_form: 'bg-status-due-container text-on-status-due-container',
  missing_contact: 'bg-status-due-container text-on-status-due-container',
};

export type AppliedStatus = StagedLeadRow['applied_status'];

export const APPLIED_STATUS_LABELS: Record<AppliedStatus, string> = {
  pending: 'Pending',
  applied: 'Applied',
  skipped: 'Skipped',
  failed: 'Failed',
};

export const APPLIED_STATUS_CLASSES: Record<AppliedStatus, string> = {
  pending: 'bg-surface-container text-on-surface-variant',
  applied: 'bg-status-success-container text-on-status-success-container',
  skipped: 'bg-surface-container text-on-surface-variant',
  failed: 'bg-error-container text-on-error-container',
};
