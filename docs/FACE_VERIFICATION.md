# Face verification (attendance) — setup & operations

Self-hosted **CompreFace (Exadel)** verifies attendance punch selfies against an
enrolled reference photo. It is an **internal-only** dependency of `hr-service`;
the api-gateway never proxies to it and no other service calls it. This page
covers the one-time bring-up, the required API key, and the recurring ops tasks.

## 1. Bring CompreFace up

CompreFace is defined in `docker-compose.yml` / `docker-compose-linux.yml` as
`compreface-postgres-db`, `compreface-core`, `compreface-api`, `compreface-admin`,
and `compreface-ui` (nginx). It uses its **own** postgres + volume
(`compreface-postgres-data`) — never the app cluster.

Set these in `.env` (see `.env.example`):

```
COMPREFACE_POSTGRES_USER=compreface
COMPREFACE_POSTGRES_PASSWORD=<a strong password>
COMPREFACE_POSTGRES_DB=compreface
COMPREFACE_ADMIN_UI_PORT=8010        # ops-only host port for the admin UI
FACE_DRIVER=compreface
FACE_VERIFY_TIMEOUT_MS=5000
COMPREFACE_URL=http://localhost:8010 # local dev only; compose overrides to http://compreface-api:8080
COMPREFACE_API_KEY=                  # filled in step 2
```

Then:

```
docker compose up -d compreface-postgres-db compreface-core compreface-api compreface-admin compreface-ui
```

The first start pulls several multi-GB images and the ML models take ~1–2 min to
warm up. Verify health (each returns HTTP 200 once ready):

```
# from the host, via the ops-only admin UI nginx:
curl -s http://localhost:8010/api/v1/recognition/subjects -H "x-api-key: $COMPREFACE_API_KEY"
```

## 2. One-time API-key setup (create the Recognition service key)

The `COMPREFACE_API_KEY` is a **Recognition-service** key created once via the admin
UI. It is not auto-provisioned.

1. Open the admin UI at `http://localhost:<COMPREFACE_ADMIN_UI_PORT>` (default `8010`).
2. Register the first admin account (email/password — email delivery is disabled;
   the account is created immediately).
3. **Create an application** (e.g. `crm-attendance`).
4. Inside the app, **add a service** of type **Face recognition** (e.g. `attendance`).
5. **Copy the API key** shown for that service.
6. Put it in `.env` as `COMPREFACE_API_KEY=<key>` and restart `hr-service`
   (`docker compose up -d hr-service`).

> Keep the admin UI port unpublished in production once the key exists — remove the
> `ports:` block on `compreface-ui`. hr-service reaches the API in-cluster at
> `http://compreface-api:8080` and does not need the published port.

## 3. Turn it on for an org

Face matching is **off by default**. An org admin enables it via the rules admin
endpoint:

```
PUT /hr/attendance/rules/admin
{ "require_face_match": true, "face_match_threshold": 85, "face_match_action": "flag", ... }
```

- `face_match_action: "flag"` — record the punch, but flag mismatches for review and
  notify the user's manager.
- `face_match_action: "block"` — reject a mismatch with **422 `FACE_MISMATCH`** and an
  unenrolled user with **422 `FACE_NOT_ENROLLED`**.

Enroll each employee (hr_admin/org_admin), with explicit DPDP consent:

```
POST /hr/attendance/face/enroll
{ "user_id": "<uuid>", "photo": "<base64 jpg>", "consent": true }   # consent=false → 422
```

## 4. Fail-open guarantee

If CompreFace is unavailable (timeout / 5xx / any driver error), a punch is **never
rejected** — not even in `block` mode. The event is recorded with
`face_match_passed = NULL` and `face_review_status = 'pending'`, and the error is
logged. An attendance event must never be lost to a verification-dependency outage.

## 5. Recurring ops task — unenroll on employee exit

There is **no automatic hook** from identity-service user deactivation to CompreFace
(that would couple the two services). When an employee leaves, an admin must call:

```
DELETE /hr/attendance/face/enroll/:userId
```

This drops the CompreFace subject and clears `reference_photo_url`,
`face_subject_id`, `face_enrolled_at`, `face_consent_at` on the profile. Treat this
like the nightly `resolve-attendance` / `accrue-leave` jobs: a documented operational
step, run as part of the offboarding checklist.

## 6. Threshold tuning

The default threshold is **85** (0–100 scale; CompreFace's 0–1 similarity ×100). If
genuine matches for your enrolled population consistently land **near 85** (frequent
false flags), lower it to ~80; if impostors occasionally clear it, raise it. Adjust
per-org via `face_match_threshold` and re-observe the review queue before committing.
Record observed genuine-match scores from the E2E run below when calibrating.

## 7. End-to-end verification checklist

With the full stack running and one seeded user enrolled (clear reference photo,
`consent=true`):

1. `consent=false` on enroll → **422**.
2. Punch with a matching selfie → `face_match_passed=true`, score stored.
3. Punch with a **different** person (rule = `flag`) → recorded, `passed=false`,
   a `pending` review is created, and the user's manager is notified.
4. Switch the org rule to `block` → the same mismatch now returns **422
   `FACE_MISMATCH`** (payload includes `score` + `threshold`).
5. Stop `compreface-api` → a punch still **succeeds** with `face_match_passed=NULL`
   and a `pending` review. Restart it.
6. As the manager, list `GET /hr/attendance/face-reviews?status=pending`, `clear`
   one and `reject` another — the rejected day's `attendance_days` recomputes
   (excluding the rejected event).
7. `DELETE …/face/enroll/:userId` → the profile columns and CompreFace subject are
   cleared.
