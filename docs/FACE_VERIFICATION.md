# Face Verification & Profile Photos — Ops Runbook

Operational guide for the attendance face-verification feature and the profile
photos it reuses. Architecture and API contracts live in
[`Architecture.md` → Face verification](./Architecture.md#face-verification-attendance);
this file is the "how do I run/operate it" companion.

## Data model

| Where | What |
|---|---|
| `iam.users.photo_key` (+ `photo_content_type`, `photo_uploaded_at`, `photo_uploaded_by`, `photo_consent_at`) | The profile **avatar** pointer and DPDP consent metadata. Bytes live in blob storage. Written only by identity-service. |
| `hr.employee_profiles.face_subject_id` / `face_enrolled_at` / `face_consent_at` / `reference_photo_url` | CompreFace enrolment state. `reference_photo_url` mirrors `photo_key`. |
| `hr.attendance_rules.require_face_match` / `face_match_threshold` / `face_match_action` | Per-org verification switch, threshold (0–100), and `flag`\|`block`. |
| `hr.attendance_rules.photo_change_cooldown_days` (30) | Self-service reference-photo change rate limit. Admins bypass. |
| `hr.attendance_rules.image_retention_days` (90) | How long punch selfies are kept before the cleanup job deletes them. |

## Blob storage layout (`@platform/blob-storage`)

One shared volume, mounted identically by **identity-service** and **hr-service**
(`BLOB_STORAGE_DIR`, default `/data/blobs`):

```
avatar/<userId>/<epochMs>.jpg        # enrolled reference / avatar — immutable, never auto-deleted
punch/<userId>/<YYYYMMDD>_chkin.jpg  # daily check-in selfie   — retention-managed
punch/<userId>/<YYYYMMDD>_chkout.jpg # daily check-out selfie  — retention-managed
```

> **Deployment invariant:** identity-service and hr-service **must** resolve
> `BLOB_STORAGE_DIR`/`BLOB_HOST_PATH` to the same host directory. If they diverge,
> enrollment fails with `FACE_NO_PHOTO` because hr-service can't see the avatar
> identity-service wrote. `hr_svc` has SELECT-only on `iam`, so identity-service is
> the only writer of `iam.users.photo_key`.

## Enrollment flow

1. **Upload avatar** — `POST /users/me/photo` (self) or `POST /users/:id/photo`
   (admin) → identity-service stores bytes + sets `photo_key` + `photo_consent_at`.
2. **Enroll** — `POST /hr/attendance/face/enroll { user_id, consent }` → hr-service
   reads the avatar, registers it with CompreFace (subject id = user UUID), stamps
   `face_enrolled_at`. The UI does step 2 automatically at check-in when
   `require_face_match` is on.

Error codes: `PHOTO_CONSENT_REQUIRED` / `FACE_CONSENT_REQUIRED` (422),
`FACE_NO_PHOTO` (400, no avatar), `FACE_NO_FACE` (400, CompreFace found no face),
`FACE_CHANGE_COOLDOWN` (422, self within cooldown), `FACE_SERVICE_UNAVAILABLE` (422).

## Retention job

`msq-deploy/retention/retention-cleanup.sh` deletes `punch/**` selfies older than
each org's `image_retention_days` (by the date **in the filename**, not mtime) and
never touches `avatar/**`.

```bash
# Dry run (report only):
DATABASE_URL=postgres://… BLOB_STORAGE_DIR=/data/blobs ./retention-cleanup.sh
# Apply:
… ./retention-cleanup.sh --apply
# Install the daily cron (02:30):
DATABASE_URL=… BLOB_STORAGE_DIR=/data/blobs ./setup-cron.sh
```

Run it inside a container/host that has the blob volume mounted and DB reachability.

## Unenroll on exit (manual)

There is no automatic hook from user deactivation (that would couple the services).
When an employee leaves, an admin calls `DELETE /hr/attendance/face/enroll/:userId`
to drop the CompreFace subject and clear the enrolment columns. The avatar row and
its bytes are retained unless separately removed.

## CompreFace outage behaviour

Punch verification **fails open**: a timeout / 5xx / connection error never rejects
a punch, even in `block` mode — the event is recorded with `face_match_passed=NULL`
and a `pending` review. Enrollment, by contrast, fails closed (you cannot enroll
while CompreFace is down), which is correct: a profile must never point at a subject
that does not exist.
