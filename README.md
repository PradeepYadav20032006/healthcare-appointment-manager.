# Healthcare Appointment & Follow-up Manager

A clinic platform with separate portals for **patients**, **doctors**, and an **admin**. Patients
book appointments and describe symptoms in advance, doctors get an AI-generated pre-visit summary,
patients get a plain-language post-visit summary, and both sides stay in sync through email and
Google Calendar.

```
healthcare-appointment-manager/
├── backend/     Node.js + Express + Prisma (PostgreSQL) API
├── frontend/    React + Vite SPA (patient / doctor / admin portals)
└── docker-compose.yml   Local Postgres for development
```

---

## 1. Quick start (local development)

### Prerequisites
- Node.js 18+
- Docker (for local Postgres) — or your own Postgres instance

### 1.1 Start the database
```bash
docker compose up -d
```
This starts Postgres on `localhost:5432` with the credentials already wired into
`backend/.env.example`.

### 1.2 Backend
```bash
cd backend
cp .env.example .env      # then fill in SMTP / Anthropic / Google keys (see sections below)
npm install
npx prisma migrate dev --name init   # creates tables
npm run seed                          # creates an admin, a sample doctor, and a sample patient
npm run dev                           # http://localhost:4000
```

Seeded logins (also printed by `npm run seed`):

| Role    | Email                          | Password    |
|---------|---------------------------------|-------------|
| Admin   | admin@clinic.example.com        | Admin@123   |
| Doctor  | dr.sharma@clinic.example.com    | Doctor@123  |
| Patient | patient@example.com             | Patient@123 |

### 1.3 Frontend
```bash
cd frontend
cp .env.example .env      # defaults work with the Vite dev proxy, no edits needed
npm install
npm run dev                # http://localhost:5173
```

Open `http://localhost:5173`, log in with one of the seeded accounts above, or register a new
patient account.

> The app is fully usable without SMTP / Anthropic / Google keys configured — every integration
> degrades gracefully (see section 5). Add real keys to unlock actual emails, real AI summaries,
> and calendar sync.

---

## 2. Configuration reference

All variables live in `backend/.env` (copy from `backend/.env.example`).

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | Signs auth tokens — set to a long random string in production |
| `SMTP_HOST/PORT/USER/PASS` | Any SMTP provider: SendGrid, Mailgun, Gmail app password, or [Mailtrap](https://mailtrap.io) for safe local testing |
| `ANTHROPIC_API_KEY` | Powers the pre-visit and post-visit AI summaries |
| `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` | Google Calendar OAuth (see section 4) |
| `SLOT_HOLD_TTL_MINUTES` | How long a slot is reserved while a patient fills the symptom form (default 5) |

`frontend/.env` only needs `VITE_API_BASE_URL` if you're not using the Vite dev proxy (e.g. when
pointing the built frontend at a deployed backend).

---

## 3. Deploying

Any Node-friendly host works (Render, Railway, Fly.io, Vercel for the frontend, etc.):

1. **Database**: provision a managed Postgres instance, set `DATABASE_URL`.
2. **Backend**: deploy `backend/`, run `npx prisma migrate deploy` once, then `npm start`. Set all
   env vars from `.env.example` on the host.
3. **Frontend**: deploy `frontend/` as a static build (`npm run build` → `dist/`), set
   `VITE_API_BASE_URL` to the backend's public URL.
4. Update `GOOGLE_REDIRECT_URI` and the Google Cloud Console credential to use the deployed
   backend URL, and `FRONTEND_URL` on the backend to the deployed frontend URL (used for
   post-OAuth redirects).

---

## 4. Google Calendar setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) → create/select a project.
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** → configure it (External is fine for testing; add
   your test Google accounts as test users while the app is unverified).
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID** → type **Web
   application**.
5. Add an **Authorized redirect URI**:
   - Local: `http://localhost:4000/api/patient/google/callback`
   - Production: `https://<your-backend-domain>/api/patient/google/callback`
   (Both patients and doctors use this same callback — the `state` parameter carries the user id,
   see `backend/src/controllers/calendar.controller.js`.)
6. Copy the generated **Client ID** and **Client secret** into `GOOGLE_CLIENT_ID` /
   `GOOGLE_CLIENT_SECRET` in `backend/.env`.
7. In the app, a logged-in patient or doctor clicks **"Connect Google Calendar"** on their
   appointments page, authorizes access, and is redirected back. From then on, booking/cancelling
   an appointment automatically creates/deletes the corresponding calendar event for that user.
   Calendar sync is best-effort: if a user hasn't connected Google, or the API call fails,
   booking still succeeds normally (see `calendar.service.js`).

---

## 5. LLM prompts & failure handling

Both prompts are sent to the Anthropic Messages API (`backend/src/services/llm.service.js`),
model configurable via `ANTHROPIC_MODEL` (default `claude-sonnet-4-6`).

**Pre-visit summary** (on symptom form submission):
```
Analyse these symptoms and return: urgency level (Low / Medium / High), chief complaint,
and three suggested questions for the doctor. Symptoms: <symptoms>
```
The model is instructed to return raw JSON (`{urgency, chiefComplaint, suggestedQuestions}`),
which is parsed and stored on the appointment.

**Post-visit summary** (on doctor's visit completion):
```
Convert these clinical notes into a patient-friendly summary with medication schedule
and follow-up steps: <notes>
```
(plus the structured prescription data appended for context)

**Failure handling**: every call is wrapped in try/catch with a 15s timeout. If the API errors,
times out, or returns unparseable output, a clearly-labelled fallback summary is generated
locally (`generatedBy: 'fallback'`) so booking or visit-completion **never** fails because of the
LLM. Errors are logged, not swallowed silently.

---

## 6. Database schema

See `backend/prisma/schema.prisma` for the full Prisma schema. Key models:

- **User** — role-based (`ADMIN` / `DOCTOR` / `PATIENT`), single table for all roles.
- **DoctorProfile** — specialisation, `slotDurationMinutes`, `workingHours` (JSON, per weekday
  time ranges), owned by a `User`.
- **LeaveDay** — one row per doctor per date on leave; `@@unique([doctorId, date])`.
- **SlotHold** — short-lived reservation while a patient fills the symptom form;
  `@@unique([doctorId, slotStart])` so two patients can't hold the same slot concurrently.
- **Appointment** — the booking itself, plus `preVisitSummary`/`urgency` (from the pre-visit LLM
  call) and `doctorNotes`/`prescription`/`postVisitSummary` (from the post-visit LLM call). See
  `SYSTEM_DESIGN.md` for how `activeSlotKey` prevents double-booking.
- **Notification** — every outbound email, with `status` (`PENDING`/`SENT`/`FAILED`) and
  `attempts`, so failed sends can be retried.
- **MedicationReminder** — one row per prescribed medicine with its daily schedule times.
- **GoogleToken** — per-user OAuth tokens for calendar sync.

---

## 7. API reference

Base URL: `/api`. Auth: `Authorization: Bearer <token>` (returned from `/auth/login` or
`/auth/register`).

### Auth
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | — | Patient self-registration |
| POST | `/auth/login` | — | Log in (any role) |
| GET | `/auth/me` | any | Current user profile |

### Patient
| Method | Path | Description |
|---|---|---|
| GET | `/patient/doctors?q=` | Search doctors by specialisation |
| GET | `/patient/doctors/:doctorId/slots?date=YYYY-MM-DD` | Available slots for a date |
| POST | `/patient/appointments/hold` | `{doctorId, slotStart}` → short-lived hold |
| POST | `/patient/appointments/confirm` | `{doctorId, slotStart, symptoms}` → books the appointment, runs the pre-visit LLM summary, syncs calendar & email |
| GET | `/patient/appointments` | List my appointments |
| POST | `/patient/appointments/:id/cancel` | Cancel a booked appointment |
| GET | `/patient/google/auth-url` | Google OAuth URL to connect calendar |
| GET | `/patient/google/callback` | OAuth redirect target (public) |

### Doctor
| Method | Path | Description |
|---|---|---|
| GET | `/doctor/profile` | My doctor profile |
| GET | `/doctor/appointments` | My appointments |
| POST | `/doctor/appointments/:id/complete` | `{notes, prescription[]}` → runs the post-visit LLM summary, creates medication reminders, notifies patient |
| GET | `/doctor/google/auth-url` | Google OAuth URL to connect calendar |

### Admin
| Method | Path | Description |
|---|---|---|
| POST | `/admin/doctors` | Create a doctor account + profile |
| GET | `/admin/doctors` | List all doctors |
| PUT | `/admin/doctors/:id` | Update specialisation / hours / slot length / bio |
| POST | `/admin/doctors/:id/leave` | `{date, reason}` → marks doctor on leave, **cancels conflicting bookings and notifies affected patients** |
| DELETE | `/admin/doctors/:id/leave/:leaveId` | Remove a leave day |
| GET | `/admin/appointments` | All appointments (clinic-wide) |

---

## 8. Background jobs

- **`emailRetryJob`** (every 5 min): retries `FAILED` notifications up to 5 attempts.
- **`reminderJob`** (every 15 min): sends a one-time appointment reminder ~24h before each visit,
  and dispatches due medication reminders based on each `MedicationReminder`'s schedule.
- **`reminderJob`** (every 1 min): releases expired slot holds so slots free up quickly.

---

## 9. System design

See [`SYSTEM_DESIGN.md`](./SYSTEM_DESIGN.md) for the write-up on double-booking prevention, doctor
leave conflict handling, the slot hold mechanism, and notification failure handling.
