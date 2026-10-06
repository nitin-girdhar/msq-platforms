// Which URLs may be stored as a push endpoint, and later POSTed to by the sender.
//
// A push subscription's `endpoint` is a URL chosen by the CLIENT, and
// `sendToUser` makes the server POST to it from inside the network. With only
// `z.string().url()` an authenticated user could register
// `http://169.254.169.254/latest/meta-data/...`, `https://localhost:4000/...` or
// an internal service name and have the server call it (SSRF). Browsers only
// ever produce endpoints on their vendor's push service, so a host allow-list
// costs real users nothing.
//
// Used twice, on purpose: at subscribe time (reject with 422) and again at send
// time (rows stored before this policy existed, or a DNS name that later points
// somewhere else, must not be called).

const ALLOWED_HOSTS: readonly string[] = [
  'fcm.googleapis.com',                // Chrome / Edge / Android (FCM)
  'android.googleapis.com',            // legacy Chrome GCM endpoints
  'push.services.mozilla.com',         // Firefox (updates.push.services.mozilla.com, ...)
  'push.apple.com',                    // Safari / iOS Home Screen apps (web.push.apple.com)
  'notify.windows.com',                // legacy Edge / WNS (*.notify.windows.com)
];

/** True only for an https URL on a known push service: no credentials, no custom port, no IP literal. */
export function isAllowedPushEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;
  if (url.port !== '' && url.port !== '443') return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}
