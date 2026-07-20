import { redirect } from 'next/navigation';

// The auth origin's root has no landing page of its own — send visitors to the
// login screen, which itself forwards already-authenticated users on to their
// product (SSO no-login hop).
export default function AuthRootPage() {
  redirect('/login');
}
