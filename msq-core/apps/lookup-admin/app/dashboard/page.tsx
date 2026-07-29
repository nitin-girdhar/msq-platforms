import { redirect } from 'next/navigation';

// The module nav (left rail) is the real entry point now — see
// app/dashboard/m/[module]/page.tsx and src/config/navigation.ts. Bare
// /dashboard lands here and picks the first module.
export default function DashboardPage() {
  redirect('/dashboard/m/platform');
}
