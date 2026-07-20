import { redirect } from 'next/navigation';

// Task app landing → the tasks board. Middleware gates it, so an unauthenticated
// hit bounces to the auth origin first.
export default function TaskHome() {
  redirect('/tasks');
}
