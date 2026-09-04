# nginx in front of a UAT deployment

`apps-uat.conf` is the nginx equivalent of `infra/Caddyfile` — the same
single-origin, path-prefix topology, which is what the PWA (one service-worker
scope, one push subscription) depends on. Keep the two in step: a prefix added in
one belongs in the other, and a prefix *change* also needs that product image
rebuilt, because the Next `basePath` is compiled in, not read from env.

## Steps

1. **DNS first.** A record `apps-uat.fitclass.in` → the UAT host, ports 80 and 443
   reachable. certbot's HTTP-01 challenge fails without it, and repeated failures
   count against Let's Encrypt's per-host limit.

2. **Bind the app ports to loopback.** The deploy bundle publishes 3000–3005 on
   `0.0.0.0`, so every app stays reachable on its own port — bypassing the proxy
   and handing the browser five extra origins, which is exactly what breaks the
   single service-worker scope. In the deployed `docker-compose.yml`, give each
   web app's port entry a host IP (long syntax: `host_ip: 127.0.0.1`), then
   `docker compose up -d --force-recreate`. Leave the gateway's 4000 unpublished
   too — browsers never call it directly.

3. **Install and place the config.**

       sudo apt install nginx certbot python3-certbot-nginx
       sudo cp apps-uat.conf /etc/nginx/sites-available/apps-uat.conf
       sudo ln -s /etc/nginx/sites-available/apps-uat.conf /etc/nginx/sites-enabled/
       sudo rm -f /etc/nginx/sites-enabled/default     # otherwise it wins on port 80

   The config uses `$connection_upgrade`, which is not built in. Add the map once
   inside the `http { }` block of `/etc/nginx/nginx.conf`:

       map $http_upgrade $connection_upgrade { default upgrade; "" close; }

4. **Certificate.** `sudo certbot --nginx -d apps-uat.fitclass.in`
   Renewal runs from a systemd timer — confirm with
   `systemctl list-timers | grep certbot`.

5. **Validate and reload.** `sudo nginx -t && sudo systemctl reload nginx`

## The env values this pairs with

In the deployment `.env` (already set in `msq-deploy/artifacts/.env-uat`):

    AUTH_URL=https://apps-uat.fitclass.in
    LMS_URL=https://apps-uat.fitclass.in/lms      # + /hrms /todo /admin /sa
    WEB_URL=https://apps-uat.fitclass.in          # must equal AUTH_URL — gateway CORS
    COOKIE_DOMAIN=apps-uat.fitclass.in            # host-only, no leading dot
    COOKIE_SECURE=true
    TRUST_PROXY_HOPS=1
    VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT

`TRUST_PROXY_HOPS=1` is right for `browser → nginx → Next.js → gateway`, even
though that reads like two hops: nginx appends the client IP to X-Forwarded-For,
and Next fills XFF in only when absent, forwarding it unchanged through its
`/api/:path*` rewrite — so the gateway sees ONE entry. Too high lets a client
prepend its own XFF and evade the per-IP rate limiter; too low collapses every
client into a single bucket.

`CADDY_SITE_ADDRESS` is unused on an nginx host. Harmless to leave set — the caddy
service exists only in the dev compose file's `sso-proxy` profile and is not in
the deploy bundle at all.

## Verifying

    curl -I https://apps-uat.fitclass.in/sw.js     # 200, served by auth-web
    curl -I https://apps-uat.fitclass.in/lms       # 200, NOT 404 — the bare prefix
    curl -I https://apps-uat.fitclass.in/lms/      # 200

Then in the browser: DevTools → Application → Service Workers shows one worker at
scope `/`, and Manifest shows the install prompt. A failed registration logs
`[pwa] service worker registration failed` at debug level and is otherwise
non-fatal — the page looks fine while push silently does nothing, so check this
explicitly rather than assuming.

Push end to end: enable notifications from the user menu, confirm a row appears in
`notify.push_subscriptions`, then let a follow-up come due (or shorten
`FOLLOWUP_CHECK_INTERVAL_MS`) and watch `docker compose logs -f notifications-service`.

## The public API host (api-uat.fitclass.in)

`api-uat.conf` is the UAT equivalent of prod's `api.fitclass.in`: nginx straight to
the gateway on 4000, nothing else in the path. It is a separate concern from the
app host — the single-origin path routing exists for the PWA and fronts the six
Next.js apps; the public surface has always been gateway-direct and is unaffected
by that migration. Partner URLs change only in hostname between environments.

What it serves, and why none of it involves cookies, CORS or basePath:

| Route | Caller | Auth |
|---|---|---|
| `POST /public/v1/leads` | partner integrations | `Authorization: Bearer` / `X-Api-Key` |
| `GET /public/v1/{branches,users,leads/:id,locations/*}` | partner integrations | same |
| `POST /public/v1/communications/send` | partner integrations | same, plus `publicCommsGuard` |
| `GET /public/v1/lead-report` | a person, in a browser | `?key=<api key>` — `extractKey()` falls back to the query param because a top-level navigation cannot set a header |
| `POST /intake/webhook` | ad platforms | `X-Api-Key`, constant-time compare |
| `GET\|POST /meta/webhook[/:integrationId]` | Meta | HMAC over the raw body |

Machine callers send no `Origin`, and the report is a navigation rather than a
`fetch()`, so CORS never applies to either. Tenant/branch isolation comes from the
API key's own binding, injected downstream as `X-Tenant-Id`/`X-Org-Id` — never from
the request body, and never from a session.

Setup is the same shape as the app host: A record for `api-uat.fitclass.in`,
`certbot --nginx -d api-uat.fitclass.in`, symlink into `sites-enabled`, reload.
Bind the gateway's published port to `127.0.0.1:4000` so the only way in is nginx.

Three things worth knowing:

- **`?key=` lands in browser history and server logs.** The gateway already sends
  `Referrer-Policy: no-referrer`, so the key does not leak onward to third-party
  pages, but treat a report link as a credential and rotate the key if one escapes.
- **The report cannot be iframed.** The gateway sets `X-Frame-Options: DENY` on
  every proxied response, so embedding it in another page will not work — send the
  link instead.
- **A partner calling the public API from browser JavaScript will still fail CORS.**
  The gateway's allowlist is the single `WEB_URL` origin. That was true before this
  migration too; the public API is a server-to-server contract.

