# Face Verification & Profile Photos — Ops Runbook

Operational guide for the attendance face-verification feature and the profile
photos it reuses. Architecture and API contracts live in
[`Architecture.md` → Face verification](./Architecture.md#face-verification-attendance);
this file is the "how do I run/operate it" companion.

Since schema **1.81.0** (2026-10-10) verification runs **in-process inside
hr-service** on ONNX models. The earlier CompreFace integration, which was never
switched on in any environment, has been removed: there is no face container,
admin UI or API key any more.

## How it works

| Step | Model (all Apache-2.0) | What it does |
|---|---|---|
| Detect | YuNet (`face_detection_yunet_2023mar.onnx`) | Finds faces and 5 landmarks (eyes, nose, mouth corners) |
| Align | — | Similarity transform of the landmarks onto the canonical 112×112 face |
| Liveness | MiniFASNet V2 + V1SE | "Real person" probability: catches a photo or screen held up to the camera |
| Embed | SFace (`face_recognition_sface_2021dec.onnx`) | 128-number embedding of the aligned face |
| Compare | — | Cosine similarity with the enrolled template, mapped to a 0–100 score |

The code is in `msq-hrms/services/hr-service/src/lib/face/`. Models, their sources,
licences and SHA-256 pins are in `msq-hrms/services/hr-service/models/MODELS.md`. The
engine refuses a model file whose hash does not match. Models load once, on the first
enrol or punch that needs them, never at startup.

## Data model

| Where | What |
|---|---|
| `iam.users.photo_key` (+ `photo_content_type`, `photo_uploaded_at`, `photo_uploaded_by`, `photo_consent_at`) | The profile **avatar** pointer and DPDP consent metadata. Bytes live in blob storage. Written only by identity-service. |
| `hr.face_templates` (1.81.0) | One row per org + user: `model_version`, `embedding_enc` (**AES-256-GCM ciphertext**), `quality` (enrolment measurements, numbers only). Root_service only, hard-deleted, no audit trigger. |
| `hr.employee_profiles.face_subject_id` / `face_enrolled_at` / `face_consent_at` / `reference_photo_url` | Enrolment state. `face_subject_id` = the active `hr.face_templates.id` (NULL = not enrolled); `reference_photo_url` mirrors `photo_key`. |
| `hr.attendance_rules.require_face_match` / `face_match_threshold` / `face_match_action` | Per-org switch, threshold (50–100, default 85), `flag`\|`block`. |
| `hr.attendance_rules.photo_change_cooldown_days` (30) | Self-service reference-photo change rate limit. Admins bypass. |
| `hr.attendance_rules.image_retention_days` (90) | How long punch selfies are kept before the cleanup job deletes them. |
| `hr.attendance_events.face_match_score` / `face_match_passed` / `face_review_status` + `device_info.face` | Per-punch result. `device_info.face` = `{ similarity, liveness, det_score, model_version }`. |

## Configuration (hr-service)

| Variable | Default | Notes |
|---|---|---|
| `FACE_TEMPLATE_KEY` | *(empty)* | **Required to enrol.** 32-byte AES key, 64 hex chars (`openssl rand -hex 32`). One per environment. **Back it up**: losing or changing it makes every stored template unreadable, verification fails open (punches go to review) and everyone must re-enrol. hr-service logs a warning at startup in production when it is missing. |
| `FACE_LIVENESS_MIN` | `0.5` | Anti-spoof floor: a punch selfie below it scores 0. |
| `FACE_MODELS_DIR` | `<service>/models` | Only to override where the models are read from. |

The image is `node:20-bookworm-slim`, not Alpine, because ONNX Runtime ships
glibc-only binaries.

## Blob storage layout (`@platform/blob-storage`)

One shared volume, mounted identically by **identity-service** and **hr-service**
(`BLOB_STORAGE_DIR`, default `/data/blobs`):

```
<tenant>/<branch>/<employee>/avatar/<epochMs>.<ext>                          # avatar = enrolment reference — never auto-deleted
<tenant>/<branch>/<employee>/punches/<YYYY>/<MM>/<YYYYMMDD>_<chkin|chkout>_<n>.<ext>   # punch selfies — retention-managed
```

> **Deployment invariant:** identity-service and hr-service **must** resolve
> `BLOB_STORAGE_DIR`/`BLOB_HOST_PATH` to the same host directory. If they diverge,
> enrollment fails with `FACE_NO_PHOTO` because hr-service can't see the avatar
> identity-service wrote. `hr_svc` has SELECT-only on `iam`, so identity-service is
> the only writer of `iam.users.photo_key`.

Templates are **not** in blob storage: only the encrypted embedding is kept (in
`hr.face_templates`), never a second copy of the photo.

## Enrollment flow

1. **Upload avatar** — `POST /users/me/photo` (self) or `POST /users/:id/photo`
   (admin) → identity-service stores bytes + sets `photo_key` + `photo_consent_at`.
2. **Enroll** — `POST /hr/attendance/face/enroll { user_id, consent }` → hr-service
   reads the avatar, runs the **quality gate**, encrypts the template and writes it
   plus the profile pointer in one transaction. The UI does this step automatically
   at check-in when `require_face_match` is on. If the stored avatar fails the gate,
   the upload modal reopens with the reason so the employee can retake it.

### Quality gate

The first failing check is reported. Limits are constants in `lib/face/quality.ts`.

| Reason | Rule |
|---|---|
| `no_face` | No face with detector confidence ≥ 0.9 |
| `multiple_faces` | A second face at least half the size of the main one |
| `face_too_small` | Eyes < 40 px apart or face box < 112 px |
| `not_frontal` | Roll > 15°, yaw > 20°, or the nose outside 30–70% of the eye-to-mouth height |
| `too_dark` / `too_bright` | Mean brightness of the face < 60 or > 200 |
| `low_contrast` | Brightness standard deviation < 25 |
| `blurry` | Sharpness (variance of the Laplacian) < 25 |

Error codes: `PHOTO_CONSENT_REQUIRED` / `FACE_CONSENT_REQUIRED` (422),
`FACE_NO_PHOTO` (400, no avatar), `FACE_NO_FACE` (400), `FACE_LOW_QUALITY`
(400, `details.reason` + a plain-language message in `error`),
`FACE_CHANGE_COOLDOWN` (422, self within cooldown), `FACE_SERVICE_UNAVAILABLE`
(422: engine failure or `FACE_TEMPLATE_KEY` not set).

## Scoring and thresholds

The threshold admins set (50–100) is compared with a score mapped from the cosine
similarity by `lib/face/scoring.ts`:

| Cosine | Score | Meaning |
|---|---|---|
| ≤ 0.10 | 0 | Unrelated faces |
| 0.363 | 75 | OpenCV's published SFace threshold (balanced accuracy on LFW) |
| 0.45 | 85 | **Default threshold.** Provisional, pending calibration on staff photos (see below) |
| ≥ 0.70 | 100 | Same person, similar conditions |

A probe whose liveness is below `FACE_LIVENESS_MIN` **scores 0**: a mismatch under
the org's existing rule (`flag` → pending review + manager notified; `block` → 422
`FACE_MISMATCH`). The real similarity and liveness stay in `device_info.face`.

### Calibration (end-to-end comparison)

`msq-hrms/services/hr-service/scripts/face-calibrate.ts` runs the production
engine over a local folder of **consented** photos and reports the quality-gate
pass rate, genuine vs impostor similarity, FAR/FRR at every threshold, and liveness
for live selfies vs spoofs. It is read-only and prints numbers only (people are
`P1..Pn`). The photos stay outside the repo.

```
<root>/genuine/<person>/*.jpg   2–5 phone-front-camera selfies per person
<root>/spoof/<person>/*.jpg     that person's photo on a phone screen / printed, re-photographed
cd msq-hrms/services/hr-service && npx tsx scripts/face-calibrate.ts <root>
```

Set `SCORE_ANCHORS` so that cosine at FAR 0.1% maps to 85, and set
`FACE_LIVENESS_MIN` from the spoof/live columns. With fewer than about 20 people
the FAR 0.1% point is extrapolated, so never set the anchors looser than
0.363 → 75.

**Status (2026-10-10):** the harness was smoke-tested on two public-domain
portraits plus augmentations. Same-person cosine was 0.87–0.99 and different-person
cosine at most 0.17. That is not a calibration: the anchors above are provisional
until the run on staff photos. Digitally degraded copies do **not** test liveness,
because MiniFASNet looks for the moiré, glare and paper texture of a camera pointed
at a screen or print. Use real re-photographed spoofs.

## Retention job

`msq-deploy/retention/retention-cleanup.sh` deletes `…/punches/**` selfies older
than each org's `image_retention_days` (by the date **in the filename**, not mtime)
and never touches `…/avatar/**`.

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
When an employee leaves, an admin calls `DELETE /hr/attendance/face/enroll/:userId`,
which **hard-deletes** the template (biometric erasure) and clears the enrolment
columns in one transaction. The avatar row and its bytes are retained unless
separately removed.

## Failure behaviour

Punch verification **fails open**: a model that will not load, an inference error or
a template that cannot be decrypted never rejects a punch, even in `block` mode. The
event is recorded with `face_match_passed=NULL` and a `pending` review, and the
cause is logged with a `[face]` prefix. Enrollment, by contrast, fails **closed**:
nothing is written unless a good, encrypted template exists.

## Deploying 1.81.0 to a server

1. DB first: `db_scripts/one_time/apply_face_templates_dryrun.sql`, then
   `apply_face_templates.sql` (creates the table and clears dead CompreFace-era
   enrolments; those employees re-enrol on their next check-in).
2. Put `FACE_TEMPLATE_KEY` in that environment's `.env`, and back it up.
3. Deploy the new hr-service image (Debian base, models inside).
4. Remove the old CompreFace containers and their volume, which the compose files no
   longer define: `docker compose up -d --remove-orphans`, then
   `docker volume rm msq_compreface-postgres-data`.
