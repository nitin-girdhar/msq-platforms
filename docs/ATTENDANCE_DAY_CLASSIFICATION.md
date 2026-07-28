# Attendance day classification & split shifts

How a day becomes Present / Half Day / Absent, how split shifts work, and the
end-to-end steps to validate both after deploying migration `21`.

---

## 1. The rules

### Worked minutes

`hr.attendance_days.worked_minutes` is the **sum of paired check-in → check-out
sessions**, not the span from first check-in to last check-out.

```
in 09:00  out 13:00   →  240
in 17:00  out 21:00   →  240
                         ───
worked_minutes           480      (the 4-hour gap is NOT worked time)
```

Previously this was `last_out − first_in`, which scored the example above as
**720** and paid for the gap. The change applies to everyone, so a regular
employee who punches out for lunch is no longer credited for the break either.

Unclosed sessions contribute **zero**. If a check-in is never closed — either
because the day ended or because a later check-in superseded it — those minutes
are lost and `has_open_session` is set on the day, which surfaces in the UI as
"Missing check-out" with a pointer to regularization.

Punches **awaiting face review** also contribute zero — see §6.

### Status

| Condition | Status |
|---|---|
| `worked_minutes` is null (checked in, not out yet) | `present` (tentative) |
| `worked_minutes >= min_full_day_minutes` | `present` |
| `worked_minutes >= min_half_day_minutes` | `half_day` |
| below the half-day floor | `absent` |

A day with punches **can now be `absent`**. It keeps its `first_in`, `last_out`,
`worked_minutes` and `resolution_source = 'events'`, which distinguishes it from
a true no-show (`resolution_source = 'job'`, no times) and keeps it regularizable.

Higher-precedence outcomes are unchanged and still win over punches: holiday →
weekly off → approved leave → events → absent.

### Threshold precedence

```
hr.shifts.min_*_minutes           (the employee's assigned shift)
  ↓ falls back to
hr.attendance_rules.min_*_minutes (org default, admin-editable)   ← new
  ↓ falls back to
DEFAULT_THRESHOLDS  240 / 480     (code constant)
```

Before this change the middle tier did not exist: employees with no shift
assignment were pinned to the hardcoded 240/480 with no way to change it.

### Split shifts

A shift with `is_split = true` declares ordered slots in `hr.shift_segments`.
The shift's own `start_time`/`end_time` remain the **outer window** every segment
must nest inside; segments may not overlap.

- Multiple check-in/check-out pairs per day are allowed, capped at the number of
  segments.
- A **non-split** shift rejects a second pair with `ALREADY_COMPLETED_TODAY`.
- A punch outside every segment is **accepted and its minutes count**; the event
  is marked `is_off_segment` and the day `has_off_window_punch` for review.
- A split shift may check in again while a previous check-in is still open (the
  employee moved to the next slot without punching out). The abandoned session
  scores zero and the day is flagged. Non-split shifts still get
  `ALREADY_CHECKED_IN`.
- `is_late` / `is_early_exit` continue to judge against the **outer** window.
- Night shifts work: segment times are normalized to minutes-from-shift-start, so
  a 22:00–02:00 slot is a contiguous range rather than an inverted one.

---

## 2. Deploying

There is **no separate migration file**. The columns live in the base scripts
twice over: in the `CREATE TABLE` (for a fresh install) and again in that file's
`IN-PLACE UPGRADES` section as `ALTER ... ADD COLUMN IF NOT EXISTS` (for an
existing database, where the `CREATE TABLE IF NOT EXISTS` is a no-op). One run
brings any database current.

```bash
# From the repo root. Idempotent — safe to re-run.
./db_scripts/db_deploy.ps1
# or just the two schema files:
psql -d crm -v ON_ERROR_STOP=1 -f db_scripts/02_schema.sql
psql -d crm -v ON_ERROR_STOP=1 -f db_scripts/03_product_schema.sql

pnpm --filter @hr/validation build   # the service imports the built schemas
```

Adding a column later means editing both places in the same file — see
`db_scripts/_migrations/README.md`.

**History is not backfilled.** Days already resolved keep their old status and
their `last_out − first_in` minutes, so days either side of the deploy will
disagree until the old ones age out. The nightly job's `dayRowExists` guard is
what preserves them. To re-resolve a range deliberately, re-run
`computeDayResolution` over it while skipping `resolution_source =
'regularization'`.

---

## 3. Automated checks

```bash
pnpm --filter @crm/hr-service test        # 153 tests
pnpm --filter @crm/hr-service typecheck
pnpm --filter @hr/web typecheck
pnpm --filter @hr/validation typecheck
pnpm --filter @platform/db typecheck
```

| Suite | Covers |
|---|---|
| `lib/attendance/__tests__/resolve.test.ts` | threshold boundaries, precedence, session summing |
| `lib/attendance/__tests__/segments.test.ts` | segment matching incl. grace + midnight wrap, segment-set validation |
| `lib/attendance/__tests__/day-resolution.e2e.test.ts` | full resolve → persist chain against a mocked tx, including the buddy-punch scenario |
| `lib/attendance/__tests__/validation.e2e.test.ts` | the exact API payloads the admin UI sends |

---

## 4. Manual end-to-end validation

Run in order. Each step states what to observe; `✗` marks a failure worth stopping for.

### 4.1 Schema

```sql
\d hr.attendance_rules   -- min_half_day_minutes / min_full_day_minutes (smallint, 240 / 480)
\d hr.shift_segments     -- exists, RLS enabled AND forced
\d hr.attendance_events  -- is_off_segment (boolean, nullable)
\d hr.attendance_days    -- has_off_window_punch / has_open_session (not null, default false)

-- Constraints must reject bad data:
UPDATE hr.attendance_rules SET min_half_day_minutes = 500, min_full_day_minutes = 480;
--   ✗ if this succeeds; expect chk_attendance_rules_day_threshold_order
```

Re-run the migration. It must complete with no error (idempotency).

### 4.2 Org thresholds (admin UI)

1. Attendance → admin rules. The **Day classification** section shows "Half day
   from" and "Full day from", pre-filled 240 / 480.
2. Set half-day **above** full-day → inline error, **Save disabled**.
3. Set 120 / 300 → save → reload → values persist.
4. `SELECT action_type, new_value FROM ... audit` — the entry records both thresholds.

### 4.3 The original bug

With an employee who has **no shift assignment** and org thresholds back at 240/480:

1. Check in, wait ~2 minutes, check out.
2. Open the day in the calendar.

| Expect | |
|---|---|
| Status | **Absent** (was *Half Day* — this is the fix) |
| Worked | `2m` |
| In / Out | both still shown |
| Request regularization | still available |

```sql
SELECT worked_minutes, first_in, last_out, resolution_source
FROM hr.attendance_days WHERE user_id = '<id>' AND work_date = CURRENT_DATE;
-- resolution_source must be 'events' with times intact — NOT a bare no-show
```

### 4.4 Regression — regular shifts

| Scenario | Expect |
|---|---|
| Work ≥ `min_full_day_minutes` | **Present** |
| Work between the two thresholds | **Half Day** |
| Check in, don't check out | **Present** (tentative), not Absent |
| Arrive past grace / leave early | Late / Early exit flags unchanged |
| Second check-in after completing a pair | `409 ALREADY_COMPLETED_TODAY` |
| Punch out for lunch and back in | `worked_minutes` **excludes** the break |

The last row is a behaviour change for non-split staff — totals drop by the
length of any break they punched. Confirm it matches your payroll intent.

### 4.5 Split shift

Create shift **Split Day**, window `09:00–21:00`, tick *Split shift*, segments
`09:00–13:00` and `17:00–21:00`. Assign it to a test employee.

Rejections to confirm in the form (Save stays disabled, message inline):

- Overlapping segments — `09:00–14:00` + `13:00–21:00`
- A segment outside the window — `17:00–23:00`
- Fewer than two segments

Then punch:

| Step | Expect |
|---|---|
| in 09:00, out 13:00, in 17:00, out 21:00 | `worked_minutes = 480` — **not 720**. Status **Present** |
| Only the first segment | 240 → **Half Day** |
| Extra pair at 15:00–16:00 | accepted, minutes counted, `is_off_segment = true` on both events, `has_off_window_punch = true` on the day, "Outside shift window" in the modal |
| Skip a check-out, then check in for segment 2 | allowed. First session scores 0, `has_open_session = true`, "Missing check-out" shown with an explanation |
| Try a pair beyond the segment count | `409 SEGMENT_LIMIT_REACHED` |

```sql
SELECT worked_minutes, has_off_window_punch, has_open_session, resolution_source
FROM hr.attendance_days WHERE user_id = '<id>' AND work_date = CURRENT_DATE;
```

The shifts list must show the slots under the window, e.g. `09:00–21:00` with
`09:00–13:00 + 17:00–21:00` beneath.

### 4.6 Selfies

With `require_photo` on, check in **twice** in one day on a split shift:

```
punch/<userId>/<YYYYMMDD>_chkin_1.jpg
punch/<userId>/<YYYYMMDD>_chkin_2.jpg
```

✗ if only one file exists. Before this change the key was a fixed
`<YYYYMMDD>_chkin.jpg` and the second check-in silently overwrote the first
employee's evidence. Then dry-run
`msq-deploy/retention/retention-cleanup.sh` and confirm both files are
recognized rather than logged as `SKIP (unrecognized name)`.

### 4.7 Regularization

Request and approve regularization on the Absent day from 4.3. The day must flip
to the requested status, and `has_off_window_punch` / `has_open_session` must
both clear — an approved override supersedes the punches that raised them.
Re-punching afterwards must **not** overwrite the row
(`resolution_source = 'regularization'` is protected).

### 4.8 Nightly job

```bash
pnpm --filter @crm/hr-service resolve-attendance -- --from=YYYY-MM-DD --to=YYYY-MM-DD
```

Against a scratch database. Confirm existing rows are **not** rewritten, and that
a day with no punches still resolves to `absent` with `resolution_source = 'job'`.

### 4.9 Face review — the buddy-punch scenario

Set `require_face_match = true`, `face_match_action = 'flag'`, assign the split
shift, and enrol employee A.

1. Check in as A for segment 1 with A's face, and out at 13:00 → counts normally.
2. Check in for segment 2 with a **different** face. The punch succeeds — then:

| Expect | |
|---|---|
| `hr.attendance_events` | the punch is stored, `face_match_passed = false`, `face_review_status = 'pending'` |
| `worked_minutes` | **240 — segment 1 only.** ✗ if it is 480; the fraud is being paid |
| Team grid | a review badge on A's row, from the **day-level** flag |
| Employee's own day | "Face review: Pending" with an explanation, not a bare short day |
| Pending face reviews | the punch is listed |

3. Open it. Reference photo and punch selfie appear **side by side**; the faces
   visibly differ.
4. **Reject** → the day recomputes without the punch. **Clear** → it recomputes
   *with* it and `worked_minutes` returns to 480. The grid behind the modal
   refreshes either way.
5. As a second reviewer, try to clear **your own** flagged punch → refused.
6. As a line manager, open a photo for someone outside your reporting subtree →
   `403`.

Also confirm the two blind spots are closed:

- **Null-score pendings.** Punch as a **not-enrolled** employee, and again with
  CompreFace stopped (`docker stop compreface-api`). Both are `pending` with a
  **null** score, and both must still show the badge and appear in the queue —
  previously they rendered as a grey dash and vanished.
- **Every punch is viewable.** On the 4-punch split-shift day, the photo modal
  must list **all four** punches with distinct selfies — including punch 3, the
  second-segment check-in, which had no addressable event id before.

### 4.10 Regression with face matching off

With `require_face_match = false`, every `face_review_status` is null: nothing is
withheld, no badge, no queue section, and worked minutes match §4.4 exactly.

---

## 5. Face review — unverified punches are not paid

Face verification exists to stop buddy-punching: person A checks in for the
morning, person B punches the second shift as them. Split shifts make that easy,
because multiple check-ins a day are now normal.

**A punch that fails the face check does not count.** With
`face_match_action = 'flag'` (the default) the punch is still recorded, with
`face_match_passed = false` and `face_review_status = 'pending'` — but it is
excluded from `worked_minutes`, from `first_in` / `last_out`, and from the
late / early-exit checks. The day carries `has_pending_face_review` so the short
total is explained rather than mysterious. A day whose *every* punch is pending
resolves to **Absent**, keeping `resolution_source = 'events'` so it stays
auditable and distinguishable from a true no-show.

| `face_review_status` | Counts? | Set by |
|---|---|---|
| `NULL` | yes | matching passed, or the org does not require it |
| `pending` | **no** | mismatch, not enrolled, or the face service was unreachable |
| `cleared` | yes | a reviewer confirmed the person — the day is recomputed and the minutes return |
| `rejected` | no | a reviewer rejected it — the day is recomputed without it |

Both decisions recompute the day. Clearing is not a cosmetic status change: it is
what gives the employee their time back.

### Reviewing

Team Attendance → **Pending face reviews**, beside the regularizations queue.
Opening one shows the enrolled reference photo **side by side with the selfie
actually captured** — a similarity score alone is not something you can act on,
but two faces are. Both load on demand; attendance selfies are never fetched
until someone asks to see them.

Gated by `hr.attendance.regularization.approve`, and scoped to your reporting
subtree unless you hold `hr.attendance.admin`. You can never clear your own
flagged punch (`assertNotSelfApproval`) — that guard is the whole control.

Every punch of a day is viewable from the team grid's photo modal, not just the
first check-in and last check-out. That matters for split shifts: the
second-segment check-in is the buddy-punch position, and it used to have no
addressable event id at all.

### How a manager finds out

An amber count on the **Team** tab, polled from the queue itself every two
minutes (and refreshed immediately after a decision). It is deliberately
pull-based: `hr-service` does publish an `attendance:face_review_pending` event,
but nothing persists it, so a manager who was offline when the punch happened
would never learn of it. The queue is the durable record, so asking it is what
makes the badge survive a logout or a missed moment.

> **If you ever wire the SSE stream to HRMS, fix the routing first.** The
> broadcaster's `canSeeEvent` ends with
> `client.userId === event.assigned_user_id || client.userId === event.actor_id`.
> We publish with the manager as `assigned_user_id` and the **punching user** as
> `actor_id` — so a naive listener would tell the employee their punch was
> flagged, tipping off the very person a buddy-punch check is meant to catch.
> That rule was written for lead events, where notifying the actor is correct.
> It is harmless today only because no client subscribes to that event name.

### Operational warning

Withholding applies to **every** pending cause, not just genuine mismatches.
`resolvePunchFace` fails open on a face-service outage — `passed = null`,
`review = 'pending'` — so if `require_face_match` is on and CompreFace is
unreachable, **every punch org-wide stops counting until reviewed**. The same
applies to an employee who was never enrolled.

`COMPREFACE_API_KEY` defaults to an empty string, so an org that enables the rule
without setting the key hits this immediately. Watch the queue depth after
enabling face matching; if it spikes, check CompreFace before assuming fraud.

## 6. Where the logic lives

| Concern | File |
|---|---|
| Status rule, threshold precedence, session summing | `msq-hrms/services/hr-service/src/lib/attendance/resolve.ts` |
| Segment matching + segment-set validation | `msq-hrms/services/hr-service/src/lib/attendance/segments.ts` |
| Day precedence + shared field derivation | `msq-hrms/services/hr-service/src/lib/attendance/day-resolution.ts` |
| Punch flow, live rollup, shift CRUD, face-review decisions | `msq-hrms/services/hr-service/src/api/v1/attendance/attendance.repository.ts` |
| Face match decision matrix (flag vs block, fail-open) | `msq-hrms/services/hr-service/src/lib/face/punch-verification.ts` |
| API payload rules | `msq-hrms/packages/hr-validation/src/attendance.ts` |
| Admin UI | `msq-hrms/packages/hr-web/src/components/attendance/admin/` |

All three write paths — live punch, nightly job, face-review recompute — share
`deriveFromEvents`, so they agree by construction rather than by convention.
