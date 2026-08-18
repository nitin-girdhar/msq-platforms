'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { tenantModules, type ModuleKey, type TenantModuleRow } from '@/src/lib/api/client';
import { Button } from '@platform/ui-kit';

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
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <Link href="/dashboard/lookups/tenants" className="text-xs font-semibold text-[#0b6cbf] hover:underline">
          ← Back to Tenants
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-[#0F172A]">Modules{tenantName ? ` — ${tenantName}` : ''}</h1>
        <p className="mt-1 text-xs text-[#64748B]">Which products this tenant is entitled to use.</p>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {(Object.keys(MODULE_LABELS) as ModuleKey[]).map((module) => (
          <label
            key={module}
            className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-sm"
          >
            <input
              type="checkbox"
              checked={active.has(module)}
              onChange={() => toggle(module)}
              disabled={pending}
              className="mt-0.5 h-4 w-4 rounded border-[#E2E8F0] text-[#0b6cbf] focus:ring-[#0b6cbf]/20"
            />
            <span>
              <span className="block text-sm font-semibold text-[#0F172A]">{MODULE_LABELS[module].label}</span>
              <span className="block text-xs text-[#64748B]">{MODULE_LABELS[module].description}</span>
            </span>
          </label>
        ))}
      </div>

      {confirmDisable && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p>
            Disable <strong>{MODULE_LABELS[confirmDisable].label}</strong>? Its nav hides for this tenant; nothing is
            deleted, and re-enabling restores access to the same data.
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="danger" onClick={confirmToggleOff}>Disable</Button>
            <Button variant="secondary" onClick={() => setConfirmDisable(null)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="primary" onClick={handleSave} disabled={pending || !isDirty} aria-busy={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
