# nginx in front of a UAT or production deployment

`apps-uat.conf` / `apps-prd.conf` are the nginx equivalent of `infra/Caddyfile`
— the same single-origin, path-prefix topology, which is what the PWA (one
service-worker scope, one push subscription) depends on. Keep them in step: a
prefix added in one belongs in all three, and a prefix *change* also needs that
product image rebuilt, because the Next `basePath` is compiled in, not read from
env.

| File | Host | Serves |
|---|---|---|
| `apps-uat.conf` | apps-uat.fitclass.in | the six web apps |
| `api-uat.conf`  | api-uat.fitclass.in  | api-gateway, direct |
| `apps-prd.conf` | apps.fitclass.in     | the six web apps |
| `api-prd.conf`  | api.fitclass.in      | api-gateway, direct |
| `snippets/connection-upgrade.conf` | — | the `$connection_upgrade` map, required by all four |
| `snippets/msq-pwa.conf` | — | `/sw.js`, `/manifest.webmanifest`, `/icons/*`, `/offline` cache policy |

Only ONE environment goes on a given machine: the two `api-*.conf` files both
declare `upstream api_gateway`, so enabling both fails `nginx -t` with
"duplicate upstream".

Both hostnames for an environment live on the SAME box and are split by
`server_name`, so a deployment still needs exactly two ports open: 80 and 443.

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

       # Prerequisites FIRST — nginx refuses to start without either of them.
       # $connection_upgrade is not built in, and a `map` is only legal in the
       # http { } context, so it cannot live in the server config that uses it.
       sudo cp snippets/connection-upgrade.conf /etc/nginx/conf.d/
       sudo cp snippets/msq-pwa.conf            /etc/nginx/snippets/

       # Then the site (swap uat -> prd for production).
       sudo cp apps-uat.conf api-uat.conf /etc/nginx/sites-available/
       sudo ln -s /etc/nginx/sites-available/apps-uat.conf /etc/nginx/sites-enabled/
       sudo ln -s /etc/nginx/sites-available/api-uat.conf  /etc/nginx/sites-enabled/
       sudo rm -f /etc/nginx/sites-enabled/default     # otherwise it wins on port 80

4. **Certificate.** `sudo certbot --nginx -d apps-uat.fitclass.in`
   Renewal runs from a systemd timer — confirm with
   `systemctl list-timers | grep certbot`.

5. **Validate and reload.** `sudo nginx -t && sudo systemctl reload nginx`

## The env values this pairs with

The per-environment templates live in `msq-deploy/.env-dev`, `.env-uat` and
`.env-prd`. Copy the matching one to the deployment `.env` (`/opt/msq/.env`) —
deploy.sh only seeds it from `.env.example`, which carries the local
`app.localhost` values. `.env-uat` already holds:

    AUTH_URL=https://apps-uat.fitclass.in
    LMS_URL=https://apps-uat.fitclass.in/lms      # + /hrms /todo /admin /sa
    WEB_URL=https://apps-uat.fitclass.in          # must equal AUTH_URL — gateway CORS
    AUTH_COOKIE_NAME=fc_session_uat               # distinct from prod's fc_session → prod cookie is never read here
    COOKIE_DOMAIN=apps-uat.fitclass.in
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

## What `snippets/msq-pwa.conf` is for

Everything an install depends on is served from the origin ROOT by auth-web, and
each piece needs a different cache policy than Next's default
`Cache-Control: public, max-age=0`:

| Path | Policy | Why |
|---|---|---|
| `/sw.js` | `no-store` | **The single most common quiet PWA failure.** A cached worker keeps serving the previous release out of its own caches; the page looks fine and a reload does not fix it. Browsers cap SW script caching at 24h on their own, but that does nothing about a CDN or proxy in between. |
| `/manifest.webmanifest` | 5 min | Drives the install prompt and the icon. Wrong content-type and Chrome ignores it entirely — Next sets `application/manifest+json` correctly, so do not override it. |
| `/icons/*` | 1 day | Includes `apple-touch-icon.png`. iOS never reads the manifest's `icons`, so that one `<link>` is the entire Home Screen icon story. |
| `/offline` | `no-cache` | The worker precaches this at install as its navigation fallback; a stale copy gets pinned for the life of that `SW_VERSION`. |

These are exact (`=`) and `^~` matches, which outrank the regex prefix locations,
so the snippet is correct wherever it sits in the server block.

Two nginx footguns the snippet works around, both silent:

- **`add_header` does not merge.** Declaring one inside a location DROPS every
  header inherited from the server block. That is why each location in the
  snippet repeats the HSTS line — without it, `/sw.js` would be the one response
  on the origin served without HSTS.
- **`proxy_hide_header Cache-Control` comes first.** Without it the response
  carries Next's `max-age=0` AND the new value, and which one wins is up to the
  client.

## Verifying

    H=apps-uat.fitclass.in    # or apps.fitclass.in

    # Routing: the bare prefix is what a person types by hand, and `/lms/*`
    # alone does not match it.
    curl -I https://$H/lms        # 200, NOT 404
    curl -I https://$H/lms/       # 200
    curl -I https://$H/hrms       # 200 (repeat for /todo /admin /sa)
    curl -I https://$H/lmsfoo     # must fall through to auth-web, not lms-web

    # PWA root files, and the cache policy that keeps installs updatable.
    curl -I https://$H/sw.js                  # 200 + Cache-Control: no-store
    curl -I https://$H/manifest.webmanifest   # 200 + application/manifest+json
    curl -I https://$H/icons/apple-touch-icon.png   # 200
    curl -I https://$H/offline                # 200

    # Exactly one Cache-Control header (proxy_hide_header working).
    curl -sI https://$H/sw.js | grep -ci ^cache-control    # 1

    # The five extra origins must be GONE. Run from ANOTHER machine — Docker's
    # iptables rules sit in front of ufw, so a published 0.0.0.0 port stays
    # reachable even when ufw claims it is blocked.
    nmap -Pn -p 22,80,443,3000-3005,4000,5432,8010 $H

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

