import { notFound } from 'next/navigation';
import { TABLE_CONFIG } from '@/src/lib/lookupTableConfig';
import { getServerSession, GATEWAY_URL } from '@/src/lib/server-session';
import LookupTableShell from '@/components/lookups/LookupTableShell';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ table: string }>;
}

export default async function LookupTablePage({ params }: PageProps) {
  const { table } = await params;
  const config = TABLE_CONFIG[table];
  if (!config) notFound();

  // The dashboard layout has already gated this route to super_admin rank;
  // we still need the session here for the cookie header used to fetch rows,
  // and to fall back gracefully if the session expired between requests.
  const result = await getServerSession();
  if (!result) notFound();

  const { cookieHeader } = result;

  const res = await fetch(`${GATEWAY_URL}/lookups/${table}`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });

  if (!res.ok) {
    notFound();
  }

  const body = await res.json() as { success: true; data: Record<string, unknown>[] };

  return <LookupTableShell table={table} config={config} rows={body.data} />;
}
