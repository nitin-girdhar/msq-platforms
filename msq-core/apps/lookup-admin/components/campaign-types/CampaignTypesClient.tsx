'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, InfoTip, PageBody, PageHeader } from '@platform/ui-kit';
import {
  campaignTypes as campaignTypesApi,
  departmentsApi,
  type CampaignTypeRow,
  type CampaignTypeRuleRow,
  type DepartmentRow,
  type RuleMatchField,
  type RuleTestResult,
} from '@/src/lib/api/client';

const FIELD_LABELS: Record<RuleMatchField, string> = {
  campaign_name: 'Campaign name',
  form_name: 'Lead form name',
  adset_name: 'Ad set name',
  ad_name: 'Ad name',
};
const FIELDS = Object.keys(FIELD_LABELS) as RuleMatchField[];

interface Props {
  tenantId: string;
  /** Named in the header so a login-time tenant reset is visible here, not
   *  mistaken for an edit that did not save. See getSelectedTenantName(). */
  tenantName: string | undefined;
}

// Campaign types (which department a lead belongs to) and the ORDERED rules
// that decide the type of a lead whose campaign an admin has not confirmed
// (schema 1.51.0). First matching rule wins, top to bottom. The full ladder a
// lead goes through: confirmed campaign type -> these rules -> the page's
// default type (Meta Page Mapping) -> the tenant's default type.
export default function CampaignTypesClient({ tenantId, tenantName }: Props) {
  const [types, setTypes] = useState<CampaignTypeRow[]>([]);
  const [rules, setRules] = useState<CampaignTypeRuleRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [t, r, d] = await Promise.all([
        campaignTypesApi.list(tenantId),
        campaignTypesApi.rules(tenantId),
        departmentsApi.list(tenantId),
      ]);
      setTypes(t.data);
      setRules(r.data);
      setDepartments(d.data.filter((x) => x.is_active && !x.org_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load campaign types.');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  // Every mutation goes through here: one in flight at a time, the error shown
  // inline, and a reload so the screen is always the server's truth.
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The change was not saved.');
    } finally {
      setBusy(false);
    }
  };

  const activeTypes = useMemo(() => types.filter((t) => t.is_active), [types]);

  // ── rules: reorder ──
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    const ids = rules.map((r) => r.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void act(() => campaignTypesApi.reorderRules(tenantId, ids));
  };

  // ── new rule form ──
  const [newField, setNewField] = useState<RuleMatchField>('campaign_name');
  const [newPattern, setNewPattern] = useState('');
  const [newRuleType, setNewRuleType] = useState('');
  const [newPosition, setNewPosition] = useState<'end' | 'top'>('end');
  const addRule = () => {
    if (newPattern.trim().length < 2 || !newRuleType) return;
    const topOrder = rules.length > 0 ? rules[0]!.rule_order : undefined;
    void act(async () => {
      await campaignTypesApi.createRule(tenantId, {
        match_field: newField,
        pattern: newPattern.trim(),
        campaign_type_id: newRuleType,
        ...(newPosition === 'top' && topOrder !== undefined ? { rule_order: topOrder } : {}),
      });
      setNewPattern('');
    });
  };

  // ── new type form ──
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypeLabel, setNewTypeLabel] = useState('');
  const [newTypeDept, setNewTypeDept] = useState('');
  const addType = () => {
    if (!/^[a-z][a-z0-9_]{1,79}$/.test(newTypeName) || !newTypeLabel.trim() || !newTypeDept) return;
    void act(async () => {
      await campaignTypesApi.create(tenantId, { name: newTypeName, label: newTypeLabel.trim(), department_id: newTypeDept });
      setNewTypeName('');
      setNewTypeLabel('');
    });
  };

  // ── test box ──
  const [test, setTest] = useState({ campaign_name: '', form_name: '', adset_name: '', ad_name: '' });
  const [testResult, setTestResult] = useState<RuleTestResult | null>(null);
  const runTest = async () => {
    setError(null);
    try {
      const names = Object.fromEntries(Object.entries(test).filter(([, v]) => v.trim()));
      const res = await campaignTypesApi.testRules(tenantId, names);
      setTestResult(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed.');
    }
  };

  const input = 'min-h-[2.75rem] rounded-lg border border-outline bg-surface-container-lowest px-2.5 py-1.5 text-xs text-on-surface sm:min-h-0';
  const iconBtn = 'min-h-[2.75rem] min-w-[2.75rem] rounded border border-outline-variant px-1.5 py-0.5 text-xs text-on-surface-variant hover:bg-surface-container-low disabled:opacity-40 sm:min-h-0 sm:min-w-0';

  if (loading) return <PageBody><p className="text-sm text-on-surface-variant">Loading…</p></PageBody>;

  return (
    <>
      <PageHeader
        title="Campaign Types & Rules"
        scope={tenantName}
        subtitle="Which department's pool a lead is assigned from"
        info={
          <>
            <p>
              A lead&apos;s type decides which department&apos;s pool it is assigned from. Order of decision:{' '}
              <strong>confirmed campaign type</strong> (Meta Campaign Mapping), then <strong>first matching rule below</strong>, then{' '}
              <strong>page default type</strong> (Meta Page Mapping), then <strong>tenant default type</strong>.
            </p>
            <p>
              Rules match a whole word or phrase, case-insensitive: <code>HIR</code> matches <code>HIR_Gurugram_Sep</code> but not{' '}
              <code>Hiring</code>.
            </p>
          </>
        }
        actions={<Link href="/dashboard/m/lms" className="inline-flex min-h-[2.75rem] items-center text-xs font-semibold text-primary hover:underline sm:min-h-0">← Back to LMS</Link>}
      />
      <PageBody dense>
      {error && (
        <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">{error}</div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="space-y-5">
      {/* ── Rules ── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-on-surface">Rules <span className="font-normal text-on-surface-variant">— first match wins, top to bottom</span></h2>
        <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full text-xs">
            <thead className="bg-surface-container-low text-left text-on-surface-variant">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">If the…</th>
                <th className="px-3 py-2">contains</th>
                <th className="px-3 py-2">then type</th>
                <th className="px-3 py-2">Active</th>
                <th className="px-3 py-2 text-right">Order / remove</th>
              </tr>
            </thead>
            <tbody>
              {rules.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-on-surface-variant">No rules yet — every unconfirmed campaign falls through to the page or tenant default.</td></tr>
              )}
              {rules.map((r, i) => (
                <tr key={r.id} className="border-t border-surface-container">
                  <td className="px-3 py-2 text-on-surface-variant">{i + 1}</td>
                  <td className="px-3 py-2">{FIELD_LABELS[r.match_field]}</td>
                  <td className="px-3 py-2 font-mono">{r.pattern}</td>
                  <td className="px-3 py-2">
                    <select
                      value={r.campaign_type_id}
                      disabled={busy}
                      onChange={(e) => void act(() => campaignTypesApi.updateRule(tenantId, r.id, { campaign_type_id: e.target.value }))}
                      aria-label={`Type for rule ${r.pattern}`}
                      className={input}
                    >
                      {types.filter((t) => t.is_active || t.id === r.campaign_type_id).map((t) => (
                        <option key={t.id} value={t.id}>{t.label}{t.is_active ? '' : ' (inactive)'}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={r.is_active}
                      disabled={busy}
                      onChange={(e) => void act(() => campaignTypesApi.updateRule(tenantId, r.id, { is_active: e.target.checked }))}
                      aria-label={`Rule ${r.pattern} active`}
                      className="h-5 w-5 accent-primary"
                    />
                  </td>
                  <td className="space-x-1 px-3 py-2 text-right">
                    <button type="button" className={iconBtn} disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label="Move rule up">↑</button>
                    <button type="button" className={iconBtn} disabled={busy || i === rules.length - 1} onClick={() => move(i, 1)} aria-label="Move rule down">↓</button>
                    <button
                      type="button"
                      className={`${iconBtn} text-on-status-overdue-container`}
                      disabled={busy}
                      onClick={() => { if (window.confirm(`Remove the rule "${r.pattern}"?`)) void act(() => campaignTypesApi.deleteRule(tenantId, r.id)); }}
                      aria-label={`Remove rule ${r.pattern}`}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-outline-variant bg-surface-container-low p-3">
          <select value={newField} onChange={(e) => setNewField(e.target.value as RuleMatchField)} aria-label="New rule matches on" className={input}>
            {FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABELS[f]}</option>)}
          </select>
          <input value={newPattern} onChange={(e) => setNewPattern(e.target.value)} placeholder="contains word/phrase" aria-label="New rule pattern" className={input} />
          <select value={newRuleType} onChange={(e) => setNewRuleType(e.target.value)} aria-label="New rule type" className={input}>
            <option value="">— type —</option>
            {activeTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <select value={newPosition} onChange={(e) => setNewPosition(e.target.value as 'end' | 'top')} aria-label="New rule position" className={input}>
            <option value="end">at the end</option>
            <option value="top">at the top</option>
          </select>
          <Button variant="primary" className="min-h-[2.75rem] sm:min-h-0" onClick={addRule} disabled={busy || newPattern.trim().length < 2 || !newRuleType}>Add rule</Button>
        </div>
      </section>

      {/* ── Test ── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-on-surface">Test the rules</h2>
        <div className="grid gap-2 rounded-xl border border-outline-variant bg-surface-container-lowest p-3 sm:grid-cols-2 lg:grid-cols-4">
          {FIELDS.map((f) => (
            <input
              key={f}
              value={test[f]}
              onChange={(e) => setTest((prev) => ({ ...prev, [f]: e.target.value }))}
              placeholder={FIELD_LABELS[f]}
              aria-label={`Test ${FIELD_LABELS[f]}`}
              className={input}
            />
          ))}
          <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
            <Button variant="secondary" className="min-h-[2.75rem] sm:min-h-0" onClick={runTest}>Which rule matches?</Button>
            {testResult && (
              <span className="text-xs text-on-surface-variant">
                {testResult.rule_id
                  ? <>Rule <code>{testResult.pattern}</code> on {FIELD_LABELS[testResult.match_field!]} → <strong>{testResult.campaign_type_label}</strong></>
                  : 'No rule matches — the lead would fall through to the page default, then the tenant default.'}
              </span>
            )}
          </div>
        </div>
      </section>

      </div>
      {/* ── Types ── */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-on-surface">
          Campaign types
          <InfoTip label="About campaign types">
            Each type routes to one department. A lead of that type is assigned only to users whose role is in that
            department, hold LMS access, and have a weight for the type in the lead&apos;s branch (Users → Org access).
          </InfoTip>
        </h2>
        <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full text-xs">
            <thead className="bg-surface-container-low text-left text-on-surface-variant">
              <tr>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Key</th>
                <th className="px-3 py-2">Department</th>
                <th className="px-3 py-2">Active</th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id} className="border-t border-surface-container">
                  <td className="px-3 py-2 font-semibold text-on-surface">
                    {t.label} {t.is_default && <span className="ml-1 rounded bg-surface-container px-1 text-[0.625rem] font-semibold text-on-surface-variant">DEFAULT</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-on-surface-variant">{t.name}</td>
                  <td className="px-3 py-2">
                    <select
                      value={t.department_id ?? ''}
                      disabled={busy}
                      onChange={(e) => void act(() => campaignTypesApi.update(tenantId, t.id, { department_id: e.target.value || null }))}
                      aria-label={`Department for ${t.label}`}
                      className={input}
                    >
                      <option value="">— none (visible to all, routes nowhere) —</option>
                      {departments.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                    </select>
                    {!t.department_id && <span className="ml-2 text-on-status-due-container">leads of this type can never be auto-assigned</span>}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={t.is_active}
                      disabled={busy || t.is_default}
                      title={t.is_default ? 'The default type cannot be deactivated' : undefined}
                      onChange={(e) => void act(() => campaignTypesApi.update(tenantId, t.id, { is_active: e.target.checked }))}
                      aria-label={`${t.label} active`}
                      className="h-5 w-5 accent-primary"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-outline-variant bg-surface-container-low p-3">
          <input value={newTypeName} onChange={(e) => setNewTypeName(e.target.value.toLowerCase())} placeholder="key, e.g. franchise" aria-label="New type key" className={input} />
          <input value={newTypeLabel} onChange={(e) => setNewTypeLabel(e.target.value)} placeholder="Label, e.g. Franchise" aria-label="New type label" className={input} />
          <select value={newTypeDept} onChange={(e) => setNewTypeDept(e.target.value)} aria-label="New type department" className={input}>
            <option value="">— department —</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
          <Button
            variant="secondary"
            className="min-h-[2.75rem] sm:min-h-0"
            onClick={addType}
            disabled={busy || !/^[a-z][a-z0-9_]{1,79}$/.test(newTypeName) || !newTypeLabel.trim() || !newTypeDept}
          >
            Add type
          </Button>
        </div>
      </section>
      </div>
      </PageBody>
    </>
  );
}
