# Technical Specification — Telegram Calendar Bot

**Version:** 1.0 | Iteration 1

---

## 1. Stack

| Layer | Technology | Rationale |
|---|---|---|
| Runtime | Node.js 20 LTS | ESM, stability |
| HTTP server | Express 4 | Customer requirement; needed for the OAuth callback and Telegram webhook |
| Telegram | grammY | More modern than Telegraf, has `conversations`/`menu` plugins, good typing |
| DB | SQLite-compatible, [Turso](https://turso.tech)/libSQL (`@prisma/adapter-libsql`) | Iteration-1 load — dozens of records a day; zero administration, networked — not tied to a specific host's disk (compatible with serverless) |
| ORM | Prisma | Migrations, type safety |
| Dates/TZ | Luxon | Correct handling of IANA timezones and DST |
| Google Calendar | `googleapis` | Official SDK |
| Logging | Pino | Structured JSON logs |
| Validation | Zod | Validating env and input data |
| Tests | Vitest | Fast unit tests for parsers and builders |
| Encryption | Node `crypto` (AES-256-GCM) | No external dependencies |

**Language:** TypeScript, strict mode.

## 2. Architecture

```
Telegram ──webhook──▶ Express ──▶ grammY bot
                        │             │
                        │             ├─▶ Conversations (wizard)
                        │             ├─▶ Command handlers
                        │             └─▶ Callback handlers
                        │
                        └─▶ /oauth/google/callback ──▶ TokenService
                                                            │
                                                  GoogleCalendarProvider
                                                            │
                                                        Google API

                 Turso/libSQL (Prisma)
```

**Key principle:** a single provider — `GoogleCalendarProvider` — calling code talks to it directly (no multi-provider abstraction — removed along with iCloud/CalDAV).

```ts
interface EventDraft {
  title: string;
  description?: string;          // absent => the field isn't sent to the API
  timezone: string;              // IANA, e.g. "Europe/Warsaw"
  allDay: boolean;
  date: string;                  // YYYY-MM-DD (for all-day and as a base for the time)
  startTime?: string;            // HH:mm, only if !allDay
  durationMinutes?: number;      // only if !allDay
  reminderMinutes: number;       // defaults to 30
}
```

## 3. Project structure

```
src/
  index.ts                    entry point: Express + bot
  config/
    env.ts                    Zod validation of environment variables
    logger.ts
  bot/
    bot.ts                    grammY init, middleware
    commands/
      start.ts  new.ts  events.ts  settings.ts  cancel.ts  help.ts
    conversations/
      createEvent.ts          event-creation wizard
      onboarding.ts           timezone + calendar connection
    keyboards/
      calendarPicker.ts       inline calendar for picking a date
      durationKeyboard.ts
      confirmKeyboard.ts
    middleware/
      allowlist.ts
      rateLimit.ts
      errorHandler.ts
      userContext.ts          load/create User into ctx.state
  calendar/
    providers/
      GoogleCalendarProvider.ts
    eventBuilder.ts           EventDraft -> Google Calendar payload
  services/
    UserService.ts
    EventService.ts
    TokenService.ts           encrypt/decrypt, Google token refresh
  routes/
    oauthGoogle.ts            /oauth/google/start, /oauth/google/callback
    health.ts                 /healthz
  utils/
    crypto.ts                 AES-256-GCM
    datetime.ts               Luxon helpers, building start/end
    parsers.ts                parsing date, time, duration
    format.ts                 rendering preview and event cards
prisma/
  schema.prisma
tests/
  parsers.test.ts  datetime.test.ts  eventBuilder.test.ts
```

## 4. Database schema

### 4.1 SQLite limitations in Prisma — must be respected

| Limitation | Workaround |
|---|---|
| No native `enum` | A `String` field + a TS union type and Zod validation in code |
| No `@db.Text` | Plain `String` — SQLite doesn't limit length |
| The `Json` type is unreliable | Wizard state is stored as `String`, serialized via `JSON.stringify` / `JSON.parse` in the service layer |
| No `@@unique` on expressions | Plain composite unique constraints are enough |

Prisma-over-SQLite does support `BigInt` for `telegramId` — Telegram IDs fit within signed 64-bit.

The DB is [Turso](https://turso.tech) (managed libSQL, SQLite-compatible), not a local file: the driver adapter is `@prisma/adapter-libsql` instead of `@prisma/adapter-better-sqlite3`. Concurrency/WAL is the Turso server's responsibility — the app no longer sets `PRAGMA` itself. The Prisma datasource itself doesn't change:

```prisma
datasource db {
  provider = "sqlite"
  url      = env("TURSO_DATABASE_URL")
}
```

### 4.2 Models

```prisma
model User {
  id                Int       @id @default(autoincrement())
  telegramId        BigInt    @unique
  firstName         String?
  username          String?
  timezone          String?              // IANA; null before onboarding
  defaultReminder   Int       @default(30)  // minutes; groundwork for iteration 3
  isBlocked         Boolean   @default(false)
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  account           CalendarAccount?
  events            Event[]
  session           WizardSession?
}

// Google only (iCloud/CalDAV removed) — at most one account per
// user, hence userId @unique instead of the composite [userId, provider].
model CalendarAccount {
  id            Int       @id @default(autoincrement())
  userId        Int       @unique
  label         String                    // "Google Calendar"
  externalId    String                    // calendarId
  accessToken   String?                   // encrypted
  refreshToken  String?                   // encrypted
  expiresAt     DateTime?
  isActive      Boolean   @default(true)
  createdAt     DateTime  @default(now())

  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  events        Event[]
}

model Event {
  id                Int       @id @default(autoincrement())
  userId            Int
  accountId         Int
  externalId        String                // event ID in the calendar
  title             String
  description       String?
  allDay            Boolean
  startsAt          DateTime              // UTC
  endsAt            DateTime?             // UTC; null for all-day
  timezone          String
  reminderMinutes   Int
  status            String    @default("ACTIVE")   // "ACTIVE" | "DELETED"
  createdAt         DateTime  @default(now())

  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  account           CalendarAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([userId, startsAt])
}

model WizardSession {
  id          Int      @id @default(autoincrement())
  userId      Int      @unique
  state       String                // JSON string: current step + collected fields
  expiresAt   DateTime
  updatedAt   DateTime @updatedAt

  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model OAuthState {
  state       String   @id          // random nonce
  telegramId  BigInt
  expiresAt   DateTime
}

// No enums: SQLite doesn't support them.
// In code:
//   export const EVENT_STATUSES = ['ACTIVE', 'DELETED'] as const;
//   export type EventStatus = typeof EVENT_STATUSES[number];
```

## 5. Integration: Google Calendar

**Scopes:** `https://www.googleapis.com/auth/calendar.events`

**OAuth flow:**
1. The user taps "Connect Google" → the bot generates a nonce, writes it to `OAuthState` (TTL 10 min), returns a link to `/oauth/google/start?state=<nonce>`.
2. Express redirects to the Google consent screen with `access_type=offline`, `prompt=consent` (to guarantee getting a refresh_token).
3. The `/oauth/google/callback` checks the state, exchanges the code for tokens, encrypts and saves them, sends the user a success message in Telegram, and shows a simple "You can go back to Telegram" page in the browser.

**Creating an event:**

```ts
// Timed event
{
  summary: draft.title,
  ...(draft.description ? { description: draft.description } : {}),
  start: { dateTime: startISO, timeZone: draft.timezone },
  end:   { dateTime: endISO,   timeZone: draft.timezone },
  reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: draft.reminderMinutes }] }
}

// All-day event
{
  summary: draft.title,
  ...(draft.description ? { description: draft.description } : {}),
  start: { date: 'YYYY-MM-DD' },
  end:   { date: 'YYYY-MM-DD' },   // IMPORTANT: end = the next day (exclusive)
  reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: reminderForAllDay }] }
}
```

- `calendarId` = `'primary'` by default.
- Key detail: for Google all-day events `end.date` is **exclusive** — for a one-day event that's date + 1 day.
- Token refresh: check `expiresAt` before every request; on `invalid_grant` mark the account inactive and ask the user to reconnect.

## 6. Date and time logic

All handled via Luxon; the DB stores everything in UTC, the user sees it in their own timezone.

```ts
// Building start and end
const start = DateTime.fromFormat(`${date} ${startTime}`, 'yyyy-MM-dd HH:mm', { zone: tz });
const end   = start.plus({ minutes: durationMinutes });
```

**Required test cases:**
- An event at 23:30 lasting 60 minutes → ends at 00:30 the next day.
- An event on the day of a DST transition.
- An all-day event: `end.date` = date + 1 day (Google).
- A past date → a warning, but creation is allowed.
- Feb 29, the 31st in months with 30 days (calendar-picker validation).

**Duration parsing:** accepts `30m`, `45 min`, `1h`, `2 h`, `1h30m`, `90` (a bare number = minutes). Max 24 hours.

**Manual date parsing:** strictly `dd/mm/yyyy`. Anything else — ask again with a format hint.

## 7. The "Date" step

Top-level menu: `Today` · `Tomorrow` · `Custom date` (manual entry `dd/mm/yyyy`) · `📅 Calendar` (opens the inline calendar below).

*(Note: the button labels shown to the user are in Ukrainian per `docs/03-BOT-UX.md` — `Сьогодні` / `Завтра` / `Своя дата` / `📅 Календар` — this section describes the mechanics, not the literal copy.)*

### Inline calendar (date picker)

A custom component, no external libraries:

- Header: `‹ August 2026 ›` (month-navigation buttons).
- Weekday row: Mon Tue Wed Thu Fri Sat Sun.
- Day grid; empty cells — `callback_data: 'noop'`.
- Callback data format: `dp:day:2026-08-14`, `dp:prev:2026-07`, `dp:next:2026-09`.
- A "⌨️ Enter manually" button — switches to text entry `dd/mm/yyyy`.
- Navigation range: ±3 years from the current date.

## 8. Wizard state management

- The `@grammyjs/conversations` plugin with a **Prisma-backed persistent storage adapter** (the `WizardSession` model), not in-memory.
- On `/cancel` or timeout (60 min) the session is deleted.
- Starting a new `/new` while a session is active: the bot asks "Continue the unfinished one, or start over?".

## 9. Environment variables

```
NODE_ENV=production
PORT=3000
BASE_URL=https://bot.example.com

TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=          # secret_token for validating incoming updates
BOT_MODE=webhook                  # webhook | polling

TURSO_DATABASE_URL=libsql://agendum-bot-<org>.turso.io
TURSO_AUTH_TOKEN=

ENCRYPTION_KEY=                   # 32 bytes in hex (64 characters)

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://bot.example.com/oauth/google/callback

ALLOWLIST_TELEGRAM_IDS=123456789,987654321
DEFAULT_REMINDER_MINUTES=30
WIZARD_TTL_MINUTES=60
LOG_LEVEL=info
```

All variables are validated with Zod at startup — the process fails with a clear error if something is missing.

## 10. Express endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/telegram/webhook/:secret` | Receives Telegram updates (validates `X-Telegram-Bot-Api-Secret-Token`) |
| GET | `/oauth/google/start` | Redirect to the Google consent screen |
| GET | `/oauth/google/callback` | Exchange code for tokens |
| GET | `/healthz` | Health check: process status + DB ping |

## 11. Error handling

Global `bot.catch` + Express error middleware.

| Situation | Message to the user |
|---|---|
| Google token expired and can't be refreshed | «Доступ до Google Calendar втрачено. Підключи знову: /settings» |
| Network/5xx from Google | «Календар тимчасово недоступний. Спробуй ще раз за хвилину» + a "🔄 Retry" button (the event draft is preserved) |
| Event already deleted in the calendar | «Цю подію вже видалено» + remove it from the list |
| Invalid input | A specific hint with an example of the correct format |

No stack traces to the user, ever. All technical detail goes to Pino with `userId` and `requestId`.

*(Message text quoted above is the actual Ukrainian bot copy from `docs/03-BOT-UX.md`, kept verbatim.)*

## 12. Tests (minimum for iteration 1)

- `parsers.test.ts` — date, time, duration: valid and invalid inputs.
- `datetime.test.ts` — crossing midnight, DST, all-day end-date +1.
- `eventBuilder.test.ts` — description absent ⇒ no field in the payload; all-day vs timed; reminder.
- `googleCalendarProvider.test.ts` — an integration test of the provider with mocked HTTP, no real API calls.

## 13. Deploy

The DB (Turso/libSQL) is networked, not a local file — the app isn't tied to a specific host's persistent disk, which is what makes a serverless deploy possible.

**Vercel (serverless).** `BOT_MODE=webhook` is required (there's no process that could poll). `api/index.ts` exports the same `createApp()` as the regular server — Vercel wraps the Express app directly as a request handler, `vercel.json` routes every path to this single handler. `setWebhook`/`setMyCommands` are not called on cold start (no point — not usefully idempotent on every serverless cold start) — they're registered once, manually, via the `npm run setup:webhook` script after each (re)deploy. `prisma migrate deploy` — manual, with prod env vars, before the first run and for every new migration.

**Backup** — Turso's (managed service) responsibility, not a cron job on the host as it was with the local file.

## 14. `/events` list cache and reconciliation with Google

`src/services/eventsCache.ts` — an in-memory `Map<userId, { events, fetchedAt }>`, TTL 60s. Same acceptability rationale as the rate-limit middleware (`src/bot/middleware/rateLimit.ts`, enforcing PRD §10's 30-actions-per-minute limit): lives within one warm serverless instance; a cold start or a second concurrent instance just means one extra round trip, never stale data served past the TTL.

Before this cache existed, `/events` trusted the DB's `status` column exclusively — an event deleted directly in Google Calendar (not through the bot) stayed `ACTIVE` in the DB forever, since the only place a 404 from Google was ever observed was the bot's own single-event delete flow. The cache refresh is also the fix for that gap:

- On a cache miss, **only when the user opens `/events`** (`eventsCommand` — the single entry point both `/events` and the "Мої події" menu button funnel through), the app re-reads the DB *and* calls `GoogleCalendarProvider.listEventIds` for the same 30-day window, diffs the two ID sets, and marks any DB row missing from Google's list `DELETED` via one `updateMany`. Only the reconciled list is cached.
- Internal navigation — pagination, delete confirmation screens, delete-all — never calls Google itself; it only reads whatever is in the cache (or, if the cache is empty, a plain DB read with no reconciliation).
- Any mutation triggered by the bot itself (single delete, delete-all, a newly created event) invalidates the cache immediately, rather than waiting for the TTL — so the user always sees the result of their own action right away. Only changes made directly in Google Calendar lag behind, by up to the 60s TTL, until the next `/events` open.
- If the call to Google fails (network, quota, expired token), reconciliation fails open: the DB list is used as-is and nothing is marked deleted — a transient outage must never cause data loss.
