# React / Next.js — Patterns Reference

Copy-paste templates that match `apps/web` conventions. Replace `<Domain>` / `<domain>` /
`<Resource>` with real names. Read `SKILL.md` first.

---

## 1. Server Component page

```tsx
// app/dashboard/<domain>/page.tsx
import { redirect } from 'next/navigation';
import { getServerSession } from '@/src/lib/server-session';
import <Domain>Shell from '@/components/<domain>/<Domain>Shell';

export const dynamic = 'force-dynamic';

export default async function <Domain>Page() {
  const result = await getServerSession();
  if (!result) redirect('/login?callbackUrl=%2Fdashboard%2F<domain>');
  return <<Domain>Shell actor={result.session} />;
}
```

---

## 2. api namespace (`src/lib/api/client.ts`)

```ts
// ── <Resource> ──────────────────────────────────────────────────────────────
export interface <Resource>ListParams {
  search?: string;
  org_ids?: string;
  page?: number;
  page_size?: number;
}

export const <resource> = {
  list: (params: <Resource>ListParams = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)]),
      ),
    ).toString();
    return request<{ success: true; data: import('@crm/types').<Resource>View[]; total: number; page: number; page_size: number }>(
      `/<resource>${qs ? `?${qs}` : ''}`,
    );
  },

  get: (id: string) =>
    request<{ success: true; data: import('@crm/types').<Resource>View }>(`/<resource>/${id}`),

  create: (data: Record<string, unknown>) =>
    request<{ success: true; data: { id: string } }>('/<resource>', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Record<string, unknown>) =>
    request<void>(`/<resource>/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  remove: (id: string) =>
    request<void>(`/<resource>/${id}`, { method: 'DELETE' }),
};
```

---

## 3. Hand-rolled data hook

```ts
// hooks/use<Domain>.ts
'use client';
import { useCallback, useEffect, useState } from 'react';
import type { <Domain>View } from '@crm/types';
import { <resource> as <resource>Api } from '@/src/lib/api/client';

interface Use<Domain>Return {
  items: <Domain>View[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function use<Domain>(orgIds?: string[]): Use<Domain>Return {
  const [items, setItems] = useState<<Domain>View[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await <resource>Api.list(orgIds?.length ? { org_ids: orgIds.join(',') } : {});
      setItems(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [orgIds?.join(',')]);   // stringified key, not array identity

  useEffect(() => { fetchData(false); }, [fetchData]);

  return { items, loading, error, refetch: () => fetchData(true) };
}
```

---

## 4. SWR data hook

```ts
// hooks/use<Domain>.ts
'use client';
import useSWR from 'swr';
import { <resource> as <resource>Api } from '@/src/lib/api/client';

export function use<Domain>(orgId?: string) {
  const { data, error, isLoading, mutate } = useSWR(
    orgId ? ['<resource>', orgId] : '<resource>',
    () => <resource>Api.list(orgId ? { org_ids: orgId } : {}),
    { revalidateOnFocus: false },
  );
  return {
    items: data?.data ?? [],
    total: data?.total ?? 0,
    loading: isLoading,
    error: error ? (error as Error).message : null,
    refetch: () => mutate(),
  };
}
```

---

## 5. Shell (client orchestrator)

```tsx
// components/<domain>/<Domain>Shell.tsx
'use client';
import { useState } from 'react';
import type { SessionUser } from '@crm/types';
import { <resource> } from '@/src/lib/api/client';
import { use<Domain> } from '@/hooks/use<Domain>';
import <Domain>Table from './<Domain>Table';
import <Domain>EditModal from './<Domain>EditModal';

export default function <Domain>Shell({ actor }: { actor: SessionUser }) {
  const { items, loading, error, refetch } = use<Domain>();
  const [editing, setEditing] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleDelete(id: string) {
    setActionError(null);
    try {
      await <resource>.remove(id);
      await refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Something went wrong');
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      {(error || actionError) && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error ?? actionError}</p>
      )}
      <<Domain>Table items={items} loading={loading} onEdit={setEditing} onDelete={handleDelete} />
      {editing && <<Domain>EditModal id={editing} onClose={() => setEditing(null)} onSaved={refetch} />}
    </div>
  );
}
```

---

## 6. Modal usage (from `@crm/ui`)

```tsx
import { Modal } from '@crm/ui';   // named export from the @crm/ui barrel
import { useState } from 'react';
import { <resource> } from '@/src/lib/api/client';

export default function <Domain>EditModal({ id, onClose, onSaved }: {
  id: string; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(patch: Record<string, unknown>) {
    setSaving(true); setError(null);
    try {
      await <resource>.update(id, patch);
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Edit <Domain>" locked={saving}>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {/* controlled inputs; call handleSave on submit */}
    </Modal>
  );
}
```

> Forms here are plain controlled components (no react-hook-form). Keep field state local,
> validate lightly on the client, and rely on the backend Zod schemas for authoritative
> validation — surface `ApiRequestError.message` (already flattens server `details`).

---

## 7. Optimistic update inside a hook

```ts
const updateItem = useCallback(async (id: string, patch: Partial<ItemView>) => {
  setItems(prev => prev.map(i => (i.id === id ? { ...i, ...patch } : i)));  // optimistic
  try {
    await itemApi.update(id, patch);
  } catch (err) {
    await fetchData(true);   // silent refetch = revert to server truth
    throw err;               // let the caller show the error
  }
}, [fetchData]);
```

---

## 8. Error surface

```tsx
// ApiRequestError carries .status and .body; message already flattens Zod details.
try {
  await api.<resource>.create(payload);
} catch (e) {
  const status = (e as { status?: number }).status;
  setError(status === 403 ? 'You do not have permission for this action.'
                          : e instanceof Error ? e.message : 'Unexpected error');
}
```
