'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, InfoTip, LocalDateTime, Modal, PageBody, PageHeader } from '@platform/ui-kit';
import MetaTabs from '@/components/meta-nav/MetaTabs';
import {
  metaConnection,
  type CredentialPurpose,
  type MetaAppConfig,
  type MetaCredentialRow,
} from '@/src/lib/api/client';

// What each system user must hold for the screens that depend on it to work. A missing scope is shown by
// name so "events are not flowing" can be traced to the permission to add in Meta Business Settings.
const PURPOSES: ReadonlyArray<{
  purpose: CredentialPurpose;
  title: string;
  blurb: string;
  expected: readonly string[];
}> = [
  {
    purpose: 'LEADS_READ',
    title: 'Leads system user',
    blurb: 'Reads pages, forms and leads, and lists ad accounts and campaigns. Needs access to every client page and ad account.',
    expected: ['leads_retrieval', 'pages_show_list', 'pages_read_engagement', 'ads_read'],
  },
  {
    purpose: 'CAPI_WRITE',
    title: 'Events system user',
    blurb: 'Sends conversion events to datasets (pixels). Needs Manage-dataset access to every client dataset.',
    expected: ['ads_management'],
  },
];

function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'muted'; children: React.ReactNode }) {
  const cls = {
    ok: 'bg-status-success-container text-on-status-success-container',
    warn: 'bg-status-due-container text-on-status-due-container',
    bad: 'bg-error-container text-on-error-container',
    muted: 'bg-surface-container text-on-surface-variant',
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

const field = 'min-h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-sm text-on-surface placeholder:text-outline sm:min-h-9';

export default function MetaConnectionClient() {
  const [app, setApp] = useState<MetaAppConfig | null>(null);
  const [creds, setCreds] = useState<MetaCredentialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // App form (secrets are write-only: blank = keep).
  const [appSecret, setAppSecret] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [version, setVersion] = useState('v21.0');
  const [savingApp, setSavingApp] = useState(false);

  // Rotate / add credential modal.
  const [modalFor, setModalFor] = useState<CredentialPurpose | null>(null);
  const [token, setToken] = useState('');
  const [systemUserId, setSystemUserId] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await metaConnection.get();
      setApp(res.data.app);
      setCreds(res.data.credentials);
      if (res.data.app.graph_api_version) setVersion(res.data.app.graph_api_version);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the Meta connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const saveApp = async () => {
    setSavingApp(true);
    setError(null);
    setNotice(null);
    try {
      const res = await metaConnection.saveApp({
        ...(appSecret ? { app_secret: appSecret } : {}),
        ...(verifyToken ? { verify_token: verifyToken } : {}),
        graph_api_version: version,
      });
      setApp(res.data);
      setAppSecret('');
      setVerifyToken('');
      setNotice('Meta app configuration saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the app configuration.');
    } finally {
      setSavingApp(false);
    }
  };

  const saveCredential = async () => {
    if (!modalFor) return;
    setSaving(true);
    setModalError(null);
    try {
      await metaConnection.saveCredential({
        purpose: modalFor,
        access_token: token.trim(),
        ...(systemUserId.trim() ? { system_user_id: systemUserId.trim() } : {}),
        ...(label.trim() ? { label: label.trim() } : {}),
      });
      setModalFor(null);
      setToken('');
      setSystemUserId('');
      setLabel('');
      setNotice('Credential saved and verified with Meta. The previous one (if any) is kept as rotated.');
      await load();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Could not save the credential.');
    } finally {
      setSaving(false);
    }
  };

  const verify = async (id: string) => {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      const res = await metaConnection.verifyCredential(id);
      setNotice(res.data.last_error ? `Verification failed: ${res.data.last_error}` : 'Verified with Meta.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify the credential.');
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await metaConnection.revokeCredential(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke the credential.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Meta Connection"
        subtitle="The Meta app and its two system users"
        info="The one Meta app, and the two system users that read leads and send conversion events."
        tabs={<MetaTabs />}
      />
      <PageBody dense>
        {error && <Alert tone="error">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}

        <section className="space-y-2 rounded-xl border border-outline-variant bg-surface-container-lowest p-3" aria-labelledby="app-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="app-heading" className="flex items-center gap-1.5 text-sm font-semibold text-on-surface">
              Meta app (webhook)
              <InfoTip label="About the Meta app">
                <p>
                  One app serves every tenant. Register <code className="font-mono">{app?.webhook_path ?? '/meta/webhook'}</code> as the callback URL
                  under the app&apos;s Webhooks → Page → <code className="font-mono">leadgen</code>. Every page must also be subscribed to the app
                  (Page Mapping → Subscribe).
                </p>
                <p>Secrets are write-only: leave a field blank to keep what is stored.</p>
              </InfoTip>
            </h2>
            {!loading && app && (
              <span className="flex flex-wrap gap-1.5">
                <Badge tone={app.configured && app.is_active ? 'ok' : 'bad'}>{app.configured ? (app.is_active ? 'Active' : 'Inactive') : 'Not configured'}</Badge>
                <Badge tone={app.has_app_secret ? 'ok' : 'bad'}>App secret {app.has_app_secret ? 'set' : 'missing'}</Badge>
                <Badge tone={app.has_verify_token ? 'ok' : 'bad'}>Verify token {app.has_verify_token ? 'set' : 'missing'}</Badge>
              </span>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-xs font-semibold text-on-surface-variant">
              App secret
              <input type="password" autoComplete="off" value={appSecret} onChange={(e) => setAppSecret(e.target.value)}
                placeholder={app?.has_app_secret ? '•••••••• (stored)' : 'Required'} className={field} />
            </label>
            <label className="space-y-1 text-xs font-semibold text-on-surface-variant">
              Webhook verify token
              <input type="password" autoComplete="off" value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)}
                placeholder={app?.has_verify_token ? '•••••••• (stored)' : 'Required'} className={field} />
            </label>
            <label className="space-y-1 text-xs font-semibold text-on-surface-variant">
              Graph API version
              <input value={version} onChange={(e) => setVersion(e.target.value)} className={field} />
            </label>
          </div>
          <div>
            <Button variant="primary" onClick={() => void saveApp()} disabled={savingApp || loading} aria-busy={savingApp}>
              {savingApp ? 'Saving…' : 'Save app configuration'}
            </Button>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          {PURPOSES.map((p) => {
            const active = creds.find((c) => c.purpose === p.purpose && c.status === 'ACTIVE');
            const history = creds.filter((c) => c.purpose === p.purpose && c.status !== 'ACTIVE');
            const missing = active ? p.expected.filter((s) => !active.scopes.includes(s)) : [];
            return (
              <section key={p.purpose} className="space-y-2 rounded-xl border border-outline-variant bg-surface-container-lowest p-3" aria-label={p.title}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-1.5 text-sm font-semibold text-on-surface">
                    {p.title}
                    <InfoTip label={`About ${p.title}`}>{p.blurb}</InfoTip>
                  </h2>
                  {active
                    ? <Badge tone={active.last_error ? 'bad' : 'ok'}>{active.last_error ? 'Needs attention' : 'Active'}</Badge>
                    : <Badge tone="warn">Not set</Badge>}
                </div>
                {!loading && !active && (
                  <p className="rounded-lg bg-status-due-container px-3 py-2 text-xs text-on-status-due-container">
                    {app?.has_legacy_token
                      ? 'No system user entered yet — the older per-app token is still being used. Enter it here to move off it.'
                      : 'No credential is set, so nothing can be done with this role.'}
                  </p>
                )}

                {active && (
                  <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-on-surface-variant">System user</dt>
                    <dd className="font-mono text-on-surface">{active.system_user_id ?? '—'}{active.label ? ` · ${active.label}` : ''}</dd>
                    <dt className="text-on-surface-variant">Expires</dt>
                    <dd className="text-on-surface">{active.expires_at ? <LocalDateTime value={active.expires_at} /> : 'Never (system-user token)'}</dd>
                    <dt className="text-on-surface-variant">Last verified</dt>
                    <dd className="text-on-surface">{active.last_verified_at ? <LocalDateTime value={active.last_verified_at} /> : 'Never'}</dd>
                    <dt className="text-on-surface-variant">Scopes</dt>
                    <dd className="flex flex-wrap gap-1">
                      {active.scopes.length === 0 && <span className="text-on-surface-variant">none reported</span>}
                      {active.scopes.map((s) => <Badge key={s} tone="muted">{s}</Badge>)}
                    </dd>
                  </dl>
                )}
                {missing.length > 0 && (
                  <Alert tone="error">Missing scope{missing.length === 1 ? '' : 's'}: {missing.join(', ')}. Add the permission in Meta, then Verify.</Alert>
                )}
                {active?.last_error && <Alert tone="error">{active.last_error}</Alert>}

                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => { setModalError(null); setModalFor(p.purpose); }}>
                    {active ? 'Rotate token' : 'Add credential'}
                  </Button>
                  {active && (
                    <>
                      <Button onClick={() => void verify(active.id)} disabled={busy === active.id} aria-busy={busy === active.id}>
                        {busy === active.id ? 'Verifying…' : 'Verify now'}
                      </Button>
                      <Button variant="danger" onClick={() => void revoke(active.id)} disabled={busy === active.id}>Revoke</Button>
                    </>
                  )}
                </div>

                {history.length > 0 && (
                  <details className="text-xs text-on-surface-variant">
                    <summary className="cursor-pointer font-semibold">History ({history.length})</summary>
                    <ul className="mt-1 space-y-0.5">
                      {history.map((h) => (
                        <li key={h.id}>
                          {h.status.toLowerCase()} · <LocalDateTime value={h.created_at} />{h.system_user_id ? ` · ${h.system_user_id}` : ''}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            );
          })}
        </div>
      </PageBody>

      <Modal
        open={modalFor !== null}
        onClose={() => setModalFor(null)}
        title={modalFor === 'LEADS_READ' ? 'Leads system user token' : 'Events system user token'}
        locked={saving}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalFor(null)} disabled={saving}>Cancel</Button>
            <Button variant="primary" onClick={() => void saveCredential()} disabled={saving || token.trim().length < 20} aria-busy={saving}>
              {saving ? 'Verifying with Meta…' : 'Save and verify'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-on-surface-variant">
            Generate a <strong>never-expiring</strong> token for the system user in Meta Business Settings. It is checked with Meta
            before it is stored, encrypted, and never shown again. The current token (if any) is kept as rotated.
          </p>
          {modalError && <Alert tone="error">{modalError}</Alert>}
          <label className="block space-y-1 text-xs font-semibold text-on-surface-variant">
            Access token
            <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} className={field} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-xs font-semibold text-on-surface-variant">
              System user id (optional)
              <input inputMode="numeric" value={systemUserId} onChange={(e) => setSystemUserId(e.target.value)} className={field} />
            </label>
            <label className="block space-y-1 text-xs font-semibold text-on-surface-variant">
              Label (optional)
              <input value={label} onChange={(e) => setLabel(e.target.value)} className={field} />
            </label>
          </div>
        </div>
      </Modal>
    </>
  );
}
