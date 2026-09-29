'use client';

import { useEffect, useState } from 'react';
import { Modal, Button, SearchableSelect, type SearchableOption } from '@platform/ui-kit';
import {
  metaMappings,
  type MetaPageForm,
  type MetaPageOption,
  type MetaPageOrgMapRow,
  type MetaPlatform,
} from '@/src/lib/api/client';

// The submit button lives in the Modal's pinned footer, outside the <form>;
// the HTML `form` attribute is what still wires it to this form.
const FORM_ID = 'meta-mapping-form';

const PLATFORMS: Array<{ value: MetaPlatform; label: string }> = [
  { value: 'fb', label: 'Facebook' },
  { value: 'ig', label: 'Instagram' },
  { value: 'wa', label: 'WhatsApp' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  // null = create. A row = edit: branch, platform, default type and status are
  // mutable (1.51.0); (page_id, form_id) IS the row's routing identity, so
  // changing it is a deactivate plus a new row, not an edit.
  row: MetaPageOrgMapRow | null;
  pages: MetaPageOption[];
  pagesUnavailable: boolean;
  orgOptions: SearchableOption[];
  // 1.51.0: the tenant's live campaign types, for the page/form default type.
  campaignTypeOptions: SearchableOption[];
  // Prefill for a CREATE opened from elsewhere (the lead-pull screen's "map this
  // page" action). Ignored on edit.
  initialPageId?: string | undefined;
  initialFormId?: string | undefined;
  onSaved: () => void;
}

export default function MappingFormModal({
  open,
  onClose,
  tenantId,
  row,
  pages,
  pagesUnavailable,
  orgOptions,
  campaignTypeOptions,
  initialPageId,
  initialFormId,
  onSaved,
}: Props) {
  const isEdit = row !== null;

  const [pageId, setPageId] = useState('');
  const [pageLevel, setPageLevel] = useState(true);
  const [formId, setFormId] = useState('');
  const [orgId, setOrgId] = useState('');
  const [platform, setPlatform] = useState<MetaPlatform>('fb');
  const [isActive, setIsActive] = useState(true);
  const [defaultTypeId, setDefaultTypeId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The live forms on the chosen page (1.51.0 form picker). null = not loaded /
  // not loadable, in which case the form id is typed instead.
  const [forms, setForms] = useState<MetaPageForm[] | null>(null);
  const [formsLoading, setFormsLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPageId(row?.page_id ?? initialPageId ?? '');
    setPageLevel(row ? row.form_id === null : !initialFormId);
    setFormId(row?.form_id ?? initialFormId ?? '');
    setOrgId(row?.org_id ?? '');
    setPlatform(row?.platform ?? 'fb');
    setIsActive(row?.is_active ?? true);
    setDefaultTypeId(row?.default_campaign_type_id ?? '');
    setError(null);
  }, [open, row, initialPageId, initialFormId]);

  // Load the page's live forms when a form-level row is being created.
  useEffect(() => {
    if (!open || isEdit || pageLevel || !/^\d+$/.test(pageId)) {
      setForms(null);
      return;
    }
    let cancelled = false;
    setFormsLoading(true);
    metaMappings
      .pageForms(tenantId, pageId)
      .then((res) => { if (!cancelled) setForms(res.data); })
      .catch(() => { if (!cancelled) setForms(null); })
      .finally(() => { if (!cancelled) setFormsLoading(false); });
    return () => { cancelled = true; };
  }, [open, isEdit, pageLevel, pageId, tenantId]);

  const handleClose = () => {
    if (pending) return;
    setError(null);
    onClose();
  };

  // Pages another tenant already maps are left out (1.51.0): the shared Meta
  // token manages every tenant's pages, and mapping one here would route that
  // tenant's leads into this one. The service refuses their forms regardless.
  const ownPages = pages.filter((p) => p.owner !== 'other');
  const foreignCount = pages.length - ownPages.length;
  const pageOptions: SearchableOption[] = ownPages.map((p) => ({
    id: p.page_id,
    label: p.name ?? p.page_id,
    hint: p.owner === 'this' ? `${p.page_id} · already mapped here` : p.page_id,
  }));
  const typeOptions: SearchableOption[] = [{ id: '', label: 'No default (use the tenant default)' }, ...campaignTypeOptions];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!orgId) {
      setError('Branch is required.');
      return;
    }

    setPending(true);
    try {
      if (row) {
        await metaMappings.update(tenantId, row.id, {
          org_id: orgId,
          is_active: isActive,
          platform,
          default_campaign_type_id: defaultTypeId || null,
        });
      } else {
        if (!pageId) {
          setError('Page is required.');
          setPending(false);
          return;
        }
        if (!pageLevel && !formId.trim()) {
          setError('Form ID is required unless this is a page-level mapping.');
          setPending(false);
          return;
        }
        await metaMappings.create(tenantId, {
          org_id: orgId,
          page_id: pageId.trim(),
          platform,
          // Page-level: form_id is OMITTED, not sent as null or as an empty
          // string. That is what produces the form_id IS NULL catch-all row
          // covering every form on the page.
          ...(pageLevel ? {} : { form_id: formId.trim() }),
          ...(defaultTypeId ? { default_campaign_type_id: defaultTypeId } : {}),
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      const { status, body } = err as { status?: number; body?: { error?: unknown } };
      if (status === 409) {
        // The service's ConflictError text names the branch already holding the
        // page/form pair and says which of the two unique rules was hit. Read
        // from body.error, NOT err.message: ApiRequestError builds its message
        // from the response's `details`, which here are machine fields
        // (constraint, org_id) and rendered as "uq_meta_page_form_org_map <uuid>".
        const serverMessage = typeof body?.error === 'string' ? body.error : null;
        setError(serverMessage ?? 'That page/form pair is already mapped.');
      } else if (status === 404) {
        // The row was deleted (or moved out of this tenant) under us. The grid
        // is refreshed so it stops offering an edit that cannot succeed.
        setError('This mapping no longer exists. The list has been refreshed.');
        onSaved();
      } else {
        setError(err instanceof Error ? err.message : 'Network error.');
      }
    } finally {
      setPending(false);
    }
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onClick={handleClose} disabled={pending}>
        Cancel
      </Button>
      <Button variant="primary" type="submit" form={FORM_ID} disabled={pending} aria-busy={pending}>
        {pending && (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
        )}
        {pending ? 'Saving…' : isEdit ? 'Save' : 'Create'}
      </Button>
    </div>
  );

  const labelClass = 'block text-xs font-semibold text-[#334155]';
  const inputClass = 'mt-1 w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-sm text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:bg-[#F8FAFC] disabled:opacity-60';

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={isEdit ? 'Edit Meta Page Mapping' : 'New Meta Page Mapping'}
      locked={pending}
      footer={footer}
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="mm-page" className={labelClass}>Page</label>
          {isEdit ? (
            <input
              id="mm-page"
              value={pageId}
              disabled
              readOnly
              className={`${inputClass} font-mono`}
            />
          ) : pagesUnavailable || pageOptions.length === 0 ? (
            <input
              id="mm-page"
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
              disabled={pending}
              inputMode="numeric"
              placeholder="Numeric Meta Page ID"
              className={`${inputClass} font-mono`}
            />
          ) : (
            <div className="mt-1">
              <SearchableSelect
                value={pageId}
                onChange={setPageId}
                options={pageOptions}
                ariaLabel="Meta Page"
                placeholder="Select a page…"
                disabled={pending}
                className="w-full"
              />
            </div>
          )}
          {isEdit ? (
            <p className="mt-1 text-[11px] text-[#94A3B8]">
              Page and form identify the mapping and cannot be changed. Deactivate this row and create a new one instead.
            </p>
          ) : pagesUnavailable || pageOptions.length === 0 ? (
            <p className="mt-1 text-[11px] text-[#94A3B8]">
              Pages could not be listed for this tenant — it may have no active Meta integration. Paste the numeric Page ID instead.
            </p>
          ) : foreignCount > 0 ? (
            <p className="mt-1 text-[11px] text-[#94A3B8]">
              {foreignCount} page{foreignCount === 1 ? ' is' : 's are'} hidden because another tenant already maps{' '}
              {foreignCount === 1 ? 'it' : 'them'}.
            </p>
          ) : null}
        </div>

        {!isEdit && (
          <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2.5">
            <label className="flex items-start gap-2 text-xs font-semibold text-[#334155]">
              <input
                type="checkbox"
                checked={pageLevel}
                onChange={(e) => setPageLevel(e.target.checked)}
                disabled={pending}
                className="mt-0.5 h-3.5 w-3.5"
              />
              <span>
                Page-level (all forms)
                <span className="mt-0.5 block font-normal text-[11px] text-[#64748B]">
                  Routes every form on this page to the branch below. A page can have at most one
                  active page-level mapping, and a form-level row for the same page still wins over it.
                </span>
              </span>
            </label>
          </div>
        )}

        {!isEdit && !pageLevel && (
          <div>
            <label htmlFor="mm-form" className={labelClass}>Lead form</label>
            {forms && forms.length > 0 ? (
              <select
                id="mm-form"
                value={formId}
                onChange={(e) => setFormId(e.target.value)}
                disabled={pending}
                className={inputClass}
              >
                <option value="">— Select a form —</option>
                {forms.map((f) => (
                  <option key={f.form_id} value={f.form_id} disabled={Boolean(f.mapped_org_id)}>
                    {f.name ?? f.form_id} · {f.form_id}
                    {f.status && f.status !== 'ACTIVE' ? ` (${f.status.toLowerCase()})` : ''}
                    {f.mapped_org_id ? ' — already mapped' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="mm-form"
                value={formId}
                onChange={(e) => setFormId(e.target.value)}
                disabled={pending}
                inputMode="numeric"
                placeholder={formsLoading ? 'Loading forms…' : 'Numeric Meta Form ID'}
                className={`${inputClass} font-mono`}
              />
            )}
            <p className="mt-1 text-[11px] text-[#94A3B8]">
              A form-level row overrides the page-level row for this one form — use it when one page serves several
              branches.
            </p>
          </div>
        )}

        {isEdit && (
          <div>
            <label htmlFor="mm-form-ro" className={labelClass}>Form</label>
            <input
              id="mm-form-ro"
              value={row.form_id ?? 'All forms (page-level)'}
              disabled
              readOnly
              className={inputClass}
            />
          </div>
        )}

        <div>
          <span className={labelClass}>Branch</span>
          <div className="mt-1">
            <SearchableSelect
              value={orgId}
              onChange={setOrgId}
              options={orgOptions}
              ariaLabel="Branch"
              placeholder="Select a branch…"
              disabled={pending}
              className="w-full"
            />
          </div>
          {orgOptions.length === 0 && (
            <p className="mt-1 text-[11px] text-[#94A3B8]">
              No active branches found for the selected tenant.
            </p>
          )}
        </div>

        <div>
          <span className={labelClass}>Default campaign type</span>
          <div className="mt-1">
            <SearchableSelect
              value={defaultTypeId}
              onChange={setDefaultTypeId}
              options={typeOptions}
              ariaLabel="Default campaign type"
              placeholder="No default"
              disabled={pending}
              className="w-full"
            />
          </div>
          <p className="mt-1 text-[11px] text-[#94A3B8]">
            Used when the lead&apos;s campaign is not confirmed and no rule matches — and for organic leads with no
            campaign. E.g. set a hiring-only form to Hiring.
          </p>
        </div>

        <div>
          <label htmlFor="mm-platform" className={labelClass}>Platform</label>
          <select
            id="mm-platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as MetaPlatform)}
            disabled={pending}
            className={inputClass}
          >
            {PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        {isEdit && (
          <label className="flex items-center gap-2 text-xs font-semibold text-[#334155]">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              disabled={pending}
              className="h-3.5 w-3.5"
            />
            Active
          </label>
        )}
      </form>
    </Modal>
  );
}
