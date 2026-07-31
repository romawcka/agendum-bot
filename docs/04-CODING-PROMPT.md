# Prompt for a coding agent (Claude Code / Cursor)

> Copy this whole thing into a coding agent. The files `01-PRD.md`, `02-TECH-SPEC.md`, `03-BOT-UX.md` must live at the repo root — the agent reads them for details.

---

## Prompt

You are a senior Node.js developer. Build a production-ready Telegram bot for creating calendar events, from scratch.

Full requirements live in the repo: `01-PRD.md` (product requirements), `02-TECH-SPEC.md` (architecture, DB schema, integrations), `03-BOT-UX.md` (exact text of every message). **Read all three before starting and follow them literally — especially the message text from the UX document.**

### Stack (do not swap for alternatives)

Node.js 20 · TypeScript strict · Express 4 · grammY (+ `@grammyjs/conversations`) · SQLite + Prisma · Luxon · googleapis · tsdav + ical-generator · Zod · Pino · Vitest

### What the bot does (brief)

A step-by-step wizard creates an event in Google Calendar or Apple iCloud: title (required) → description (optional) → date (inline calendar) → all day / specific time → start time → duration → preview → confirmation → creation. Plus viewing and deleting created events, timezone settings, and a default calendar.

### Critical implementation rules

1. **Description is optional.** If the user skipped it, the `description` field **must not end up in the API payload** at all — not an empty string, not `null`, but a missing key.
2. **Title is required.** Empty or whitespace-only — don't let it through, ask again.
3. **All-day in Google:** `end.date` is exclusive — for a one-day event that's date + 1 day. This is a classic mistake, don't make it.
4. **Timezone is always explicit.** Never rely on the server's timezone. All calculations via Luxon with the user's zone, stored in the DB in UTC, displayed in the user's zone.
5. **Crossing midnight.** Start 23:30 + 60 minutes = end 00:30 the next day. Cover it with a test.
6. **An event is created only via the "Send" button.** Buttons are disabled immediately after the first tap (by editing the message's markup) — a double tap must not create a duplicate.
7. **Wizard state lives in the DB,** not in process memory. Implement a persistent storage adapter for `@grammyjs/conversations` on the `WizardSession` model. A server restart doesn't lose an unfinished dialog. TTL 60 minutes.
8. **Secrets are encrypted.** Google refresh/access tokens and the iCloud app password — AES-256-GCM with a key from `ENCRYPTION_KEY`. Never end up in logs.
9. **The message containing the iCloud password is deleted** via `ctx.api.deleteMessage` right after processing.
10. **Multi-user model from day one.** No hardcoded constants for a single person — access is restricted by allowlist middleware on `ALLOWLIST_TELEGRAM_IDS`, but data is always tied to `userId`.
11. **Providers behind a single interface.** `GoogleCalendarProvider` and `CalDavProvider` implement one `CalendarProvider` contract (see tech spec). The bot's handlers don't know which provider is in use.
12. **Default reminder is 30 minutes** — from `DEFAULT_REMINDER_MINUTES`, stored in `User.defaultReminder`. Not editable via UI in iteration 1, but the data model and service layer should already support it, so iteration 3 only needs to add a settings screen.
13. **Errors never show a stack trace.** The user gets a human-readable message per the table in the tech spec; Pino gets the full technical picture with `userId` and `requestId`.
14. **Env validation via Zod at startup.** A missing variable — the process fails with a clear message instead of breaking at runtime.

### Workflow

Work in stages, with a working commit after each one.

1. Skeleton: TypeScript, Express, grammY, Pino, Zod config, `/healthz`, Docker, `.env.example`
2. Prisma schema and first migration (models from the tech spec; SQLite: no enums, JSON as a string, WAL + busy_timeout)
3. Middleware: allowlist, rate limit, userContext, error handler
4. Onboarding: `/start`, timezone selection, branching into calendar connection
5. Google OAuth: Express routes, `TokenService` with encryption and refresh
6. CalDAV: connection, `testConnection`, deleting the password message
7. `CalendarProvider` + both providers + `CalendarService` + `eventBuilder`
8. Inline calendar (a custom component, no external libs)
9. The full `/new` wizard, including "Edit" and the preview
10. `/events` with pagination and deletion
11. `/settings`
12. Tests: parsers, datetime, eventBuilder, providers with mocked HTTP
13. README: running locally, getting Google OAuth credentials, creating an Apple app password, deployment

### Definition of Done

- `npm run dev` brings the bot up in polling mode with no errors
- `npm run build && npm start` works in webhook mode
- `npm test` is green, covering every case from the "Date and time logic" section of the tech spec
- An event with a description and without both create correctly in Google and in iCloud
- An all-day event takes up exactly one day in both calendars
- Deleting from `/events` actually deletes the event in the calendar
- Restarting the process mid-wizard doesn't lose the entered data
- Every message's text matches `03-BOT-UX.md`
- `.env.example` has every variable with comments
- README lets someone stand the project up locally from scratch

### What NOT to do in this iteration

Voice messages, LLM parsing, free-text parsing, editing created events, recurring events, inviting attendees, reading other people's calendar events, localization. But build the architecture so these can be added without a rewrite: the input-parsing layer is isolated from the event-creation layer — in iteration 2 an LLM parser will sit next to the "strict" wizard, handing off the same `EventDraft` to the same preview screen.

---

## Extra prompt for iteration 2 (save this for later)

> Add voice-message handling to the existing bot. Flow: the user sends a voice message → download the file via the Telegram API → transcribe it (Whisper API) → send the text to an LLM with a prompt that requires returning strict JSON matching the `EventDraft` schema → validate with Zod → show **the exact same preview screen** as the wizard, with "Send" / "Edit" / "Cancel" buttons. If the LLM couldn't determine a required field (title) or the date — the bot asks for the missing piece via the existing wizard's steps. The user's current date and timezone are passed into the LLM prompt so it can correctly resolve relative dates ("on Wednesday", "tomorrow"). Nothing is created without the user's confirmation.
