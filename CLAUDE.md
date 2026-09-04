# Agendum Bot

Telegram bot: step by step turns a note into a Google Calendar event.

## Where things live

- `docs/01-PRD.md` — product requirements, scenarios, roadmap, **feature registry (section 12.3)**
- `docs/02-TECH-SPEC.md` — architecture, DB schema, integrations, env
- `docs/03-BOT-UX.md` — **exact text of every bot message**
- `docs/features/` — one short PRD per feature added after iteration 1
- `docs/features/_TEMPLATE.md` — template for new feature PRDs

Read the relevant doc before working on that layer. Take message text from the UX doc verbatim, don't rephrase it.

## Feature documentation rule

Any new feature after iteration 1 starts **not with code, but with a file** `docs/features/NN-name.md`, created from the template.

- The main PRD is not rewritten — it captures iteration 1. Only a line is added to the feature registry (section 12.3).
- If a feature conflicts with the invariants below or with section 6 of the main PRD — stop and ask. Silently diverging documents are not allowed.
- Duplicate new bot text into `docs/03-BOT-UX.md` — it remains the single source of truth for wording.
- Update the registry status as you go, not at the end.

## Stack — do not replace

Node 20 · TypeScript strict · Express 4 · grammY + `@grammyjs/conversations` · SQLite-compatible DB (Turso/libSQL, `@prisma/adapter-libsql`) + Prisma · Luxon · googleapis · Zod · Pino · Vitest

The DB is networked (Turso), not a local file — a deliberate decision so the app isn't tied to a specific host's persistent disk (compatibility with serverless deploys, e.g. Vercel). The Prisma schema still has `provider = "sqlite"` — only the driver adapter changed.

## Invariants

Breaking any of these is a bug, even if the code compiles.

1. **Description is optional.** Omitted — the `description` key is absent from the API payload. Not an empty string, not `null`.
2. **Title is required.** Empty or whitespace-only — the wizard doesn't let you proceed.
3. **All-day in Google:** `end.date` is exclusive. A one-day event = date + 1 day.
4. **Timezone is always explicit.** Calculations via Luxon in the user's zone, stored in UTC, displayed in the user's zone. Never rely on the server's zone.
5. **Crossing midnight works.** 23:30 + 60 min = 00:30 the next day.
6. **An event is created only via the "Send" button.** Buttons are disabled immediately after the first tap — a double tap doesn't create a duplicate.
7. **Wizard state lives in the DB,** not in process memory. A restart doesn't lose an unfinished dialog. TTL 60 minutes.
8. **Secrets are encrypted** (AES-256-GCM, key from `ENCRYPTION_KEY`) and never end up in logs: Google tokens.
9. **Multi-user model.** No hardcoded constants for a single person; access is gated by allowlist middleware, data is always tied to `userId`.
10. **The 30-minute reminder** lives in `User.defaultReminder` and in the service layer already. Editing UI — iteration 3.
11. **Never show the user a stack trace.** A human-readable message per the table in the tech spec; technical detail goes to Pino with `userId` and `requestId`.
12. **Env is validated with Zod at startup.** A missing variable — fail with a clear error.

## Architectural rule for the future

The input-parsing layer is isolated from the event-creation layer. In iteration 2 an LLM voice parser will sit next to the wizard and hand off the same `EventDraft` to the same preview screen. Don't mix these layers.

## Out of scope for iteration 1

Voice, LLM parsing, free text, editing events, recurrence, attendees, reading other people's calendar events, localization.

## Commands

```
npm run dev            # polling, local (predev warns weekly that the Turso dev copy is stale)
npm run db:refresh     # re-clone the dev copy from prod and repoint .env at it
npm run build
npm start               # webhook, local build (prod is Vercel, see "npm run setup:webhook")
npm run setup:webhook   # one-time webhook + command menu registration after deploying to Vercel
npm test
npx prisma migrate deploy   # apply existing migrations to Turso; `migrate dev` doesn't work
                             # through @prisma/adapter-libsql (see README "New migration")
```
