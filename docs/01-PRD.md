# PRD — Telegram Calendar Bot (Iteration 1)

**Version:** 1.0
**Date:** 2026-07-23
**Status:** Ready for development

---

## 1. Summary

A Telegram bot that lets you create events in your personal Google Calendar through a step-by-step chat dialog, without opening a calendar app.

The user starts creating an event, the bot asks for fields one by one (title, description, date, time, duration), shows a preview, and on confirmation creates the event in the user's calendar.

## 2. Problem

Creating a calendar event from a phone requires: open the app → find the date → tap → fill in a form → save. That's 20-40 seconds and a context switch. When event information arrives in a messenger (a doctor's appointment, a meeting, a reminder from family), you want to capture it right where you received it.

## 3. Iteration 1 goals

| Goal | Success metric |
|---|---|
| Creating an event faster than in the native app | < 20 seconds from `/new` to a created event |
| Reliable calendar writes | 0 "lost" events: either created and confirmed, or an explicit error |
| Managing what was created | Viewing upcoming events and deleting right from the bot |

**Not goals for iteration 1:** voice input, LLM parsing, free text without the wizard, editing existing events, recurring events, inviting attendees, team/shared calendars.

## 4. Users

- **Iteration 1:** the author + close contacts (5-15 people). Access via a Telegram ID allowlist.
- **Later:** potentially open access. Architecture and data model are designed as multi-user from the start (no hardcoded constants for a single person).

## 5. User scenarios

### 5.1 First launch (onboarding)

1. The user sends `/start`.
2. The bot checks the allowlist. If the ID isn't listed — a polite refusal.
3. The bot asks for the timezone (a list of popular ones as buttons + the option to enter one manually, e.g. `Europe/Warsaw`).
4. The bot offers to connect Google Calendar: an OAuth link → the user grants access in the browser → redirect to the callback → the bot says "Google Calendar connected".
5. The bot shows a brief help message and the main menu.

### 5.2 Creating an event (main scenario)

A step-by-step wizard. Each field is a separate bot message and a separate user reply.

| Step | Bot asks | User replies | Rules |
|---|---|---|---|
| 1 | Event title | Text | **Required.** Empty/whitespace-only → ask again. Max 200 characters |
| 2 | Description | Text or a "Skip" button | Optional. If skipped — the field isn't populated in the calendar at all. Max 2000 characters |
| 3 | Date | Quick buttons "Today"/"Tomorrow", inline calendar, **or** text `dd/mm/yyyy` | Required. Past dates are allowed, but the bot warns |
| 4 | Event type | Buttons "All day" / "Specify time" | — |
| 5a | *(if "All day")* — | — | An all-day event on the chosen date |
| 5b | *(if "Specify time")* Start time | Text `HH:MM` | Validated 00:00-23:59 |
| 6b | Duration | Buttons `30 min` / `1 h` / `1.5 h` / `2 h` / "Enter custom" | With "Enter custom" — text like `45m`, `2h`, `1h30m`. Crossing midnight is allowed |
| 7 | Preview | Buttons "✅ Send" / "✏️ Edit" / "❌ Cancel" | The event is created **only** via the "Send" button |

**The preview looks like this:**

```
📋 Review the event

Title: Doctor's appointment
Description: Room 305, pick up test results
Date: 2026-08-14 (Thursday)
Time: 15:00 – 16:00 (Europe/Warsaw)
Reminder: 30 minutes before
Calendar: Google Calendar

[✅ Send]  [✏️ Edit]  [❌ Cancel]
```

The "Edit" button opens a list of fields — the user picks which field to re-answer, then returns to the preview.

After a successful creation: `✅ Event created` + a short card + a "🗑 Delete" button (acts on this specific event).

### 5.3 Viewing and deleting events

The `/events` command (and a menu item):

- Shows upcoming events for the next 30 days, **created via the bot**, sorted by date.
- Paginated, 5 events per page, "◀️ Back" / "Forward ▶️" buttons.
- Each event has a "🗑" button.
- Deletion requires confirmation: "Delete 'Doctor's appointment' on Aug 14 at 15:00?" → "Yes, delete" / "Cancel".
- The event is deleted from the calendar via the API and marked deleted in the DB.
- If the event was already deleted manually by the user in the calendar — the bot reports this and removes it from the list without an error.
- A "Delete all" button shows up whenever the full list has more than one event (not just the current page); it deletes every listed event from the calendar and requires an explicit confirmation, since it's irreversible. Partial failures are reported ("Deleted X of N").
- Opening `/events` reconciles the DB against Google Calendar (at most once a minute) so events deleted directly in the calendar — not through the bot — disappear from the list too, closing a gap where such events used to stay listed forever. Pagination and deletion themselves never trigger this check, only opening the screen does.

### 5.4 Settings

The `/settings` command:

- Timezone (change)
- Connect / disconnect calendar
- Delete all my data

## 6. Event-building rules

| Condition | Result |
|---|---|
| Has a title, no description | An event with a title, the description field **is not sent** to the API |
| "All day" selected | An all-day event on the given date (no time) |
| Start time + duration given | An event with an exact start and end |
| Duration crosses midnight | The event correctly rolls over to the next day |
| Title is empty | The wizard doesn't let you proceed |
| Timezone | Always taken from the user's settings, explicitly passed to the API |
| Reminder | Defaults to **30 minutes** before the start. For all-day events — 30 minutes before 09:00 on the event date |

## 7. Bot commands (left-side menu)

| Command | Description |
|---|---|
| `/new` | Create an event |
| `/events` | My events |
| `/settings` | Settings |
| `/cancel` | Cancel the current dialog |
| `/help` | Help |
| `/start` | Get started / onboarding |

Commands are registered via `setMyCommands` so they show up in Telegram's native menu.

## 8. Data storage

**Choice: a SQLite-compatible DB** via Prisma, driver `@prisma/adapter-libsql`, hosted on [Turso](https://turso.tech) (managed libSQL). Originally (iteration 1) this was a local file via `better-sqlite3` — replaced with Turso once we needed independence from a specific host's persistent disk (see `docs/02-TECH-SPEC.md` §4, §14).

Rationale: for iteration 1's load — a dozen users, dozens of records a day — a heavyweight relational DBMS isn't needed, and Turso gives the same zero-administration profile as file-based SQLite, but without being tied to a specific host's disk — which is exactly what makes a serverless deploy (Vercel) possible.

| What we store | Volume |
|---|---|
| Users and settings | tens of rows |
| Connected calendars | any number of Google accounts per user (see `docs/features/04-multiple-google-accounts.md`) |
| Created events (history) | hundreds of rows per year |
| Wizard state | one active row per user |

**Limitations we accept deliberately:**

- Prisma under `provider = "sqlite"` doesn't support native enums and requires care with JSON fields (details in the tech spec) — unchanged by the move to Turso, the schema stayed the same.

**Migration path to PostgreSQL** (if we ever need something Turso doesn't have): change the `provider` in `schema.prisma`, the connection string, and three field types. The rest of the Prisma code is untouched. This was designed into the schema from day one — and it's the path we deliberately did NOT take when moving off the local file, because Turso stays SQLite-compatible and only required a driver-adapter swap.

**Backup:** Turso's (managed service) responsibility — not a cron job on the host, as it was with the local file.

## 9. Quality requirements

- **Idempotency:** pressing "Send" twice doesn't create a duplicate (buttons are disabled immediately after the first tap).
- **State durability:** wizard state is stored in the DB, not in process memory. A server restart doesn't lose an unfinished dialog.
- **Dialog timeout:** an unfinished wizard expires after 60 minutes, the bot reports this.
- **External API errors:** the user sees a human-readable message and an offer to retry; technical details go to the log.
- **Expired Google tokens:** automatic refresh; if that's not possible — ask to reconnect the calendar.
- **Response to any action:** no longer than 3 seconds (for long operations — "⏳ Creating event…").

## 10. Security and privacy

- All calendar tokens are encrypted in the DB (AES-256-GCM, key from an environment variable).
- Telegram ID allowlist during the closed-access period.
- Rate limiting: no more than 30 actions per minute per user.
- The bot doesn't read or store the content of other people's events — only ones it created itself.
- `/settings → Delete all my data` fully wipes the user, tokens, and event history.

## 11. Roadmap for future iterations

| Iteration | Content |
|---|---|
| **2** | Voice messages: transcription + LLM parsing into an event structure, the same preview screen before creation |
| **2** | Free-text single-line input via LLM ("doctor's appointment Wednesday at 15:00 for an hour") |
| **3** | Reminder settings in the menu: change reminder time, multiple reminders, turn off entirely |
| **3** | Editing created events |
| **4** | Recurring events (RRULE) |
| **4** | Two-way sync: show all calendar events, not just ones created by the bot |
| **5** | Open public access, billing/limits, localization (feature draft: [`docs/features/01-language-selection.md`](features/01-language-selection.md)) |

## 12. Feature documentation process

This document describes **iteration 1 and stays essentially unchanged**. Every subsequent feature isn't appended to it, but gets its own short PRD.

### 12.1 Rule

One feature — one file `docs/features/NN-short-name.md`, where `NN` is a running sequence number. The main PRD:

- **is not rewritten** — the record of iteration-1 decisions matters as-is;
- gets **one line in the registry below** (section 12.3) linking to the feature file;
- is edited in place only in two cases: an invariant from section 6 "Event-building rules" changed, or a feature closed out an item from section 11 "Roadmap" — in that case the roadmap line gets a link to the shipped feature.

If a feature conflicts with something in the main PRD — that's fixed in the main PRD explicitly, with a note in the registry. Silently diverging documents are not allowed.

### 12.2 What a feature PRD contains

The template lives at `docs/features/_TEMPLATE.md`. Required minimum — eight sections:

| Section | Purpose |
|---|---|
| Problem | Why this feature, what hurts right now |
| Scope | What's in, and, as a separate list, what's **not** in |
| Scenarios | Step by step, what it looks like for the user |
| Bot text | Exact wording of new messages (or a link to a UX-doc addition) |
| Data changes | New fields and models, whether a migration is needed |
| Impact on existing code | What needs to be touched in code that's already written |
| Readiness criteria | A checkable checklist |
| Risks | What could break, what we decided not to solve |

Target length — one to two pages. A feature PRD that grows to the size of the main one is a signal the feature should be split in two.

### 12.3 Feature registry

| # | Feature | Status | Document | Touched the main PRD |
|---|---|---|---|---|
| 00 | Iteration 1: wizard, Google + iCloud, list and delete | Done (2026-07-23) | this document | — |
| 01 | Interface language selection (uk/en) | Draft (2026-07-24) | `docs/features/01-language-selection.md` | see §11, iteration 5 |
| 02 | Removed iCloud/CalDAV — Google only remains | Done (2026-07-31) | this document | yes, §1, §3, §5, §6, §10 edited directly: dropped support for a second provider, ≤1 calendar per user |
| 03 | Resume the wizard after connecting Google Calendar mid-flow | In progress (2026-09-01) | `docs/features/03-resume-wizard-after-connect.md` | — |
| 04 | Connect multiple Google accounts, choose which one to create in | In progress (2026-09-01) | `docs/features/04-multiple-google-accounts.md` | yes, §8 edited directly: dropped the ≤1-account-per-user limit |

A row is added the moment work on a feature starts, not after — so the registry reflects the real state, not just what's finished.

### 12.4 Workflow

1. A feature idea comes up → create a file from the template, fill in the "Problem" and "Scope" sections.
2. Add a row to the registry in 12.3 with status "Draft".
3. Discuss and fill in the remaining sections → status "Ready for development".
4. Implementation → status "In progress".
5. Shipped → status "Done", record the date. Update the roadmap and tech spec if needed.

Statuses: `Draft` → `Ready for development` → `In progress` → `Done` (or `Rejected` with a one-line rationale — rejected ideas are worth keeping too, so we don't circle back to them).

## 13. Open questions

- Do we need a webhook domain with a valid TLS certificate right away, or is long polling enough at the start? *(recommendation: long polling for local development, webhook in prod)*
- Hosting: Vercel (serverless) — decided, requirements described in the tech spec §14.
