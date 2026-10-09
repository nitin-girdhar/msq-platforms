'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Modal, SearchableSelect, type SearchableOption } from '@platform/ui-kit';
import { metaPortfolios, type MetaPortfolioRow, type PartnerStatus, type PortfolioKind } from '@/src/lib/api/client';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** null = create. */
  row: MetaPortfolioRow | null;
  tenantOptions: SearchableOption[];
  /** Pre-selected tenant when the page is filtered to one. */
  defaultTenantId?: string | undefined;
}

const field = 'min-h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-sm text-on-surface placeholder:text-outline sm:min-h-9';

// A business portfolio (Business Manager) we are a partner of. It belongs to exactly one tenant -- the brand is a
// tenant like any other -- and every dataset under it inherits that owner, which is what stops one tenant's lead
// being sent into another tenant's pixel.
export default function PortfolioModal({ open, onClose, onSaved, row, tenantOptions, defaultTenantId }: Props) {
  const isEdit = row !== null;
  const [tenantId, setTenantId] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PortfolioKind>('FRANCHISE');
  const [partner, setPartner] = useState<PartnerStatus>('PENDING');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTenantId(row?.tenant_id ?? defaultTenantId ?? '');
    setBusinessId(row?.meta_business_id ?? '');
    setName(row?.name ?? '');
    setKind(row?.kind ?? 'FRANCHISE');
    setPartner(row?.partner_status ?? 'PENDING');
    setError(null);
  }, [open, row, defaultTenantId]);

  const valid = isEdit || (tenantId && /^\d{5,32}$/.test(businessId.trim()));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        await metaPortfolios.update(row.id, { ...(name.trim() ? { name: name.trim() } : {}), kind, partner_status: partner });
      } else {
        await metaPortfolios.create({
          tenant_id: tenantId,
          meta_business_id: businessId.trim(),
          ...(name.trim() ? { name: name.trim() } : {}),
          kind,
          partner_status: partner,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the portfolio.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit business portfolio' : 'Add business portfolio'}
      locked={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving || !valid} aria-busy={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="space-y-1">
          <span className="block text-xs font-semibold text-on-surface-variant">Owning tenant</span>
          <SearchableSelect
            value={tenantId}
            onChange={setTenantId}
            options={tenantOptions}
            ariaLabel="Owning tenant"
            placeholder="Select the tenant that owns this portfolio…"
            disabled={isEdit || saving}
            className="w-full"
          />
          {isEdit && <p className="text-[0.6875rem] text-on-surface-variant">The owner cannot be changed — create a new portfolio instead.</p>}
        </div>
        <label className="block space-y-1 text-xs font-semibold text-on-surface-variant">
          Meta business id
          <input inputMode="numeric" value={businessId} onChange={(e) => setBusinessId(e.target.value)} disabled={isEdit || saving}
            placeholder="Business Settings → Business info" className={field} />
        </label>
        <label className="block space-y-1 text-xs font-semibold text-on-surface-variant">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={saving} className={field} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-xs font-semibold text-on-surface-variant">
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value as PortfolioKind)} disabled={saving} className={field}>
              <option value="BRAND">Brand</option>
              <option value="FRANCHISE">Franchise</option>
            </select>
          </label>
          <label className="block space-y-1 text-xs font-semibold text-on-surface-variant">
            Partner access
            <select value={partner} onChange={(e) => setPartner(e.target.value as PartnerStatus)} disabled={saving} className={field}>
              <option value="PENDING">Pending</option>
              <option value="ACTIVE">Active</option>
              <option value="REVOKED">Revoked</option>
            </select>
          </label>
        </div>
      </div>
    </Modal>
  );
}
