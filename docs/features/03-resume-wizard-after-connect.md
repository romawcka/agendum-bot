# 03 — Resume the wizard after connecting Google Calendar

**Status:** In progress
**Created:** 01.09.2026
**Updated:** 01.09.2026
**Iteration:** 2

---

## 1. Problem

Today `/new` refuses to start at all if the user has no active Google Calendar connection — the wizard checks this before asking for a title and simply replies "Спочатку підключи календар" (`createEvent.ts:385-390`). If a new user tries to create an event before finishing onboarding's calendar step, or a returning user's token got deactivated, they lose whatever they were about to type and have to go connect the calendar first, then re-run `/new` from scratch. The fields themselves (title, date, time, duration…) have nothing to do with whether a calendar is connected — there's no reason the bot can't collect them first and only require a connection when it's actually about to write to Google.

## 2. Scope

**In:**
- [x] The wizard no longer blocks entry when there's no connected/active Google Calendar.
- [x] The calendar-connection check moves to the moment the user taps "✅ Надіслати" — the earliest point a connection is actually required.
- [x] If not connected at that point, the bot shows a connect link and waits, in place, inside the same conversation.
- [x] After a successful connect, the bot offers a "▶️ Продовжити" button that resumes the exact same wizard — preview screen, all previously entered fields intact, no re-asking.
- [x] Tapping "Продовжити" after the wizard session has already expired (60-minute TTL) is handled gracefully, not as a crash.

**Not in (deliberately deferred):**
- Multiple Google accounts / choosing which calendar to send to — separate feature, `04-multiple-google-accounts.md`.
- Changing the 60-minute wizard TTL to accommodate a slow OAuth round-trip — out of scope; if a user takes over an hour to connect, they restart with `/new` same as any other timeout today.

## 3. Scenarios

### 3.1 Main scenario

1. The user runs `/new` with no calendar connected. The wizard proceeds exactly as usual — title, description, date, event type, time/duration, preview.
2. On the preview screen the "Calendar" line shows "не підключено" instead of a calendar name.
3. The user taps "✅ Надіслати".
4. The bot detects there's no active Google Calendar account and shows a connect link (identical wording/behavior to `/settings`'s connect flow) instead of creating the event.
5. The user taps the link, completes Google's consent screen in the browser.
6. The bot sends "✅ Google Calendar підключено. Можеш продовжити створення події." with a "▶️ Продовжити" button.
7. The user taps it. The bot re-shows the preview screen (now with the real calendar name) and creation proceeds normally from "✅ Надіслати" onward — no field was asked again.

### 3.2 Edge cases

| Situation | Behavior |
|---|---|
| User sends random text while the bot is waiting for the connection | Bot replies with a short reminder to tap the button above or cancel, keeps waiting |
| User taps "❌ Скасувати" while waiting for the connection | Standard cancel: "Скасував. Нічого не створено." |
| User taps "▶️ Продовжити" after the 60-minute wizard TTL already expired | No live conversation catches the callback; a fallback handler answers "Ця подія вже неактуальна. Почни заново: /new" |
| Account was connected, then a token refresh deactivated it (`TokenService`) before the user hits Send | Treated the same as never having connected — re-fetched fresh at submission time, not from the cached value at wizard start |
| User connects, but from `/settings` mid-wizard instead of via the wizard's own link | Fine either way — the submission-time check re-fetches the account from the DB regardless of how it got connected |

## 4. Bot text

New/changed messages (Ukrainian, matches existing tone — mirrored into `docs/03-BOT-UX.md`):

```
Щоб надіслати подію, спочатку підключи Google Calendar:
```
Keyboard: same connect-link button as the existing connect flow (`Підключити Google Calendar`, inline URL button).

```
✅ Google Calendar підключено. Можеш продовжити створення події.
```
Keyboard: `▶️ Продовжити` (only shown when this connect flow was started from inside the wizard; the `/settings` connect flow keeps today's plain "✅ Google Calendar підключено.")

```
Спочатку підключи календар, натиснувши кнопку вище, або натисни «Скасувати».
```
(shown on stray text while waiting)

```
Ця подія вже неактуальна. Почни заново: /new
```
(fallback for a stale "Продовжити" tap)

Preview screen's "Calendar:" line, when nothing is connected yet:
```
Календар: не підключено
```

## 5. Data changes

| Model | Change | Migration |
|---|---|---|
| `OAuthState` | new field `resumeWizard Boolean @default(false)` | yes |

Backward compatibility: existing `OAuthState` rows (all short-lived, 10-minute TTL) are unaffected — default `false` matches today's only behavior.

## 6. Impact on existing code

| What we touch | How |
|---|---|
| `src/bot/conversations/createEvent.ts` | Remove the early `!account \|\| !account.isActive` guard; preview renders `account?.label ?? "не підключено"`; add a connect-and-wait step right before calling `GoogleCalendarProvider.createEvent` |
| `src/bot/conversations/connectGoogle.ts` | `connectGoogleCalendar` accepts an option to set `resumeWizard: true` on the `OAuthState` it creates |
| `src/routes/oauthGoogle.ts` | `/callback` reads `oauthState.resumeWizard`; if true, sends the confirmation with a "▶️ Продовжити" button (`wizard:calendar_connected`) instead of the plain text |
| `src/bot/bot.ts` | New fallback `bot.callbackQuery("wizard:calendar_connected", …)`, registered after the conversations middleware, for stale taps |
| `prisma/schema.prisma` | `OAuthState.resumeWizard` field + migration |

Breaking changes: no. `/settings`'s connect/disconnect flow is untouched behaviorally.

## 7. Readiness criteria

- [ ] `/new` with no calendar connected lets you fill in every field and only stops you at Send
- [ ] Connecting from inside that Send-time prompt resumes the exact same wizard at the preview screen
- [ ] A stale "Продовжити" tap after TTL expiry shows a friendly message, doesn't throw
- [ ] `/settings`'s own connect/disconnect flow behaves exactly as before
- [x] Text matches section 4
- [x] `npm run typecheck && npm test` — green (no `lint` script exists in this project)
- [x] The feature registry in `docs/01-PRD.md` is updated, status is set
- [ ] Migration `20260901135904_add_oauth_state_resume_wizard` applied to the dev Turso DB (`npx prisma migrate deploy`) — pending, blocked by the sandbox from running automatically; run manually together with feature 04's migration
- [ ] Manual verification against real Google OAuth and Telegram — not runnable in this sandbox

## 8. Risks

| Risk | Likelihood | What we do |
|---|---|---|
| User abandons the connect prompt and it sits open indefinitely | low | Bounded by the existing 60-minute `WizardSession` TTL — no new cleanup needed |
| A second, unrelated conversation swallows the `wizard:calendar_connected` callback | low | Callback data is namespaced (`wizard:` prefix) and only the wizard's own wait step listens for it |

## 9. Decisions made along the way

- **01.09:** No new "draft" storage table — grammY's existing `WizardSession` persistence already keeps the in-progress fields alive across the OAuth round-trip, since the conversation just suspends on `waitForCallbackQuery` rather than exiting.
