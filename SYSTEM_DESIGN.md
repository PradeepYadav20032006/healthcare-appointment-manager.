# System Design Write-up

*(Healthcare Appointment & Follow-up Manager — max 800 words)*

## 1. Double-booking prevention

Booking happens in two steps, both backed by database constraints rather than
application-level checks alone, since only the database can arbitrate races
between two concurrent requests.

**Step 1 — Slot hold.** When a patient selects a slot (before filling the
symptom form), the API inserts a row into `SlotHold` with a unique constraint
on `(doctorId, slotStart)`. If a second patient tries to hold the same slot
concurrently, the second `INSERT` violates the unique constraint and fails
immediately (Postgres error `P2002`), so the second patient is told the slot
just became unavailable. Holds expire after `SLOT_HOLD_TTL_MINUTES` (default
5 minutes) and are swept by a cron job every minute, so an abandoned form
doesn't permanently lock a slot.

**Step 2 — Confirm.** When the patient submits the symptom form, the hold is
converted into an `Appointment` inside a single Prisma `$transaction`. The
appointment has an `activeSlotKey` column set to
`` `${doctorId}|${slotStart.toISOString()}` `` **only while `status = BOOKED`**,
and this column has a **unique index**. This is the real guarantee: even if
the hold step were somehow bypassed (e.g. two requests racing inside the
transaction window), only one row with a given `activeSlotKey` can ever be
inserted — the database rejects the second one. On cancellation,
`activeSlotKey` is set back to `NULL`; Postgres and SQLite both permit
multiple `NULL`s in a unique index, so the slot becomes bookable again
without needing a "soft delete" or a partial/filtered index. This keeps the
design portable across database engines while still being safe under real
concurrency, not just "check-then-write" logic in JavaScript.

## 2. Doctor leave conflict handling

When an admin marks a doctor on leave for a date (`POST
/admin/doctors/:id/leave`), the request is handled as a single server-side
operation, not a client-driven multi-step flow:

1. Insert the `LeaveDay` row (unique on `doctorId + date`, so leave can't be
   double-recorded).
2. Query all `BOOKED` appointments for that doctor on that date.
3. For each one: set `status = CANCELLED`, clear `activeSlotKey` (freeing the
   slot), delete the associated Google Calendar events for both patient and
   doctor (best-effort), and queue a cancellation email to the patient
   explaining the doctor is on leave and inviting them to rebook.
4. The response returns how many appointments were affected and who was
   notified, so the admin gets immediate confirmation rather than having to
   guess whether patients were informed.

Because slot generation (`getAvailableSlots`) checks `LeaveDay` before
generating any candidate slots, a doctor on leave simply shows zero
availability for that date going forward — there's no separate "is this
doctor available" check to keep in sync.

## 3. Slot hold mechanism (why not just "check then insert"?)

A naive implementation might do: "query for existing appointment at this
slot; if none, create one." Under concurrency, two requests can both pass the
query before either has inserted, resulting in a double booking — this is a
classic TOCTOU (time-of-check-to-time-of-use) bug. Two mitigations close this
gap:

- The **hold** step exists specifically because the pre-visit LLM call
  (symptom analysis) takes a few seconds. Without a hold, one patient could
  start filling the form on a slot that another patient books in the
  meantime, only to see it disappear with no shared understanding of why.
  The hold reserves the slot visibly (other patients see it as unavailable)
  the moment they pick a time, not after they finish typing.
- The **unique `activeSlotKey`** at confirmation time is the final backstop
  that makes correctness independent of the hold ever being correctly
  observed — even a bug in the hold logic, or a client that skips the hold
  endpoint entirely, cannot produce two `BOOKED` appointments for the same
  doctor/slot.

## 4. Notification failure handling

Every outbound email (confirmation, reminder, cancellation, leave-conflict,
medication reminder) is first persisted as a `Notification` row with status
`PENDING`, then an immediate send is attempted via the configured SMTP
transport. On success the row becomes `SENT`. On failure — SMTP outage, DNS
blip, provider rate-limit — the row becomes `FAILED` with the error message
recorded and `attempts` incremented.

A cron job (`emailRetryJob`) runs every 5 minutes and retries any `FAILED`
notification whose `attempts < MAX_ATTEMPTS` (5). This means a transient
provider outage can never silently drop a booking confirmation: the
notification is durably queued in the database, not just held in a
process's memory, so it survives a server restart too. Google Calendar sync
follows the same "never block the core flow" philosophy: `createEvent` /
`updateEvent` / `deleteEvent` catch all errors internally and return
`null`/`false` on failure rather than throwing, so a Calendar API hiccup
never prevents a booking, cancellation, or leave update from completing.

The same graceful-degradation principle applies to the LLM calls: both
`generatePreVisitSummary` and `generatePostVisitSummary` catch failures and
return a clearly-labelled fallback summary (`generatedBy: "fallback"`)
instead of throwing, so an Anthropic API outage degrades the experience
without breaking booking or visit completion.
