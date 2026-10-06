'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { tenantModules, type ModuleKey, type TenantModuleRow } from '@/src/lib/api/client';
import { Button, PageBody, PageHeader } from '@platform/ui-kit';

interface Props {
  tenantId: string;
  tenantName?: string | undefined;
  initialModules: TenantModuleRow[];
}

const MODULE_LABELS: Record<ModuleKey, { label: string; description: string }> = {
  lms: { label: 'LMS', description: 'Leads, marketing campaigns, and the CRM pipeline.' },
  leave: { label: 'Leave', description: 'Leave requests, approvals, and balances.' },
  attendance: { label: 'Attendance', description: 'Check-in/out, shifts, and regularization.' },
  tasks: { label: 'Tasks', description: 'Task lists and assignment.' },
};

export default function TenantModulesClient({ tenantId, tenantName, initialModules }: Props) {
  const router = useRouter();
  const [active, setActive] = useState<Set<ModuleKey>>(
    () => new Set(initialModules.filter((m) => m.is_active).map((m) => m.module)),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisable, setConfirmDisable] = useState<ModuleKey | null>(null);

  const initialActive = new Set(initialModules.filter((m) => m.is_active).map((m) => m.module));
  const isDirty = initialModules.some((m) => active.has(m.module) !== initialActive.has(m.module));

  const toggle = (module: ModuleKey) => {
    // Disabling only hides the module's nav — every row it ever wrote stays
    // exactly as it is, and re-enabling picks it back up. Still worth a beat
    // of friction since it is not obviously reversible from the checkbox alone.
    if (active.has(module)) {
      setConfirmDisable(module);
      return;
    }
    setActive((prev) => new Set(prev).add(module));
  };

  const confirmToggleOff = () => {
    if (!confirmDisable) return;
    setActive((prev) => {
      const next = new Set(prev);
      next.delete(confirmDisable);
      return next;
    });
    setConfirmDisable(null);
  };

  const handleSave = async () => {
    setPending(true);
    setError(null);
    try {
      await tenantModules.put(tenantId, Array.from(active));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <PageHeader
        title={`Modules${tenantName ? ` — ${tenantName}` : ''}`}
        subtitle={`Which products this tenant is entitled to use · ${active.size} / ${Object.keys(MODULE_LABELS).length} active`}
        actions={
          <>
            <Link href="/dashboard/lookups/tenants" className="inline-flex min-h-[2.75rem] items-center px-1 text-xs font-semibold text-primary hover:underline sm:min-h-0">
              ← Back to Tenants
            </Link>
            <Button variant="primary" className="min-h-[2.75rem] sm:min-h-0" onClick={handleSave} disabled={pending || !isDirty} aria-busy={pending}>
              {pending ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        }
      />
      <PageBody>
      {error && (
        <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {(Object.keys(MODULE_LABELS) as ModuleKey[]).map((module) => (
          <label
            key={module}
            className="flex min-h-[2.75rem] cursor-pointer items-start gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm"
          >
            <input
              type="checkbox"
              checked={active.has(module)}
              onChange={() => toggle(module)}
              disabled={pending}
              className="mt-0.5 h-5 w-5 shrink-0 rounded border-outline-variant accent-primary focus:ring-primary/20"
            />
            <span>
              <span className="block text-sm font-semibold text-on-surface">{MODULE_LABELS[module].label}</span>
              <span className="block text-xs text-on-surface-variant">{MODULE_LABELS[module].description}</span>
            </span>
          </label>
        ))}
      </div>

      {confirmDisable && (
        <div className="rounded-xl border border-status-due/30 bg-status-due-container px-4 py-3 text-sm text-on-status-due-container">
          <p>
            Disable <strong>{MODULE_LABELS[confirmDisable].label}</strong>? Its nav hides for this tenant; nothing is
            deleted, and re-enabling restores access to the same data.
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="danger" className="min-h-[2.75rem] sm:min-h-0" onClick={confirmToggleOff}>Disable</Button>
            <Button variant="secondary" className="min-h-[2.75rem] sm:min-h-0" onClick={() => setConfirmDisable(null)}>Cancel</Button>
          </div>
        </div>
      )}

      </PageBody>
    </>
  );
}
