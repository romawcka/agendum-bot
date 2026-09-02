# 04 — Connect multiple Google accounts

**Status:** In progress
**Created:** 01.09.2026
**Updated:** 01.09.2026
**Iteration:** 2

---

## 1. Problem

Today a user can connect exactly one Google account (`CalendarAccount.userId` is `@unique` — enforced at the schema level after `f55c9a6` removed iCloud/CalDAV). Someone with a personal and a work Google account has to pick one; there's no way to create some events in one and some in the other without disconnecting and reconnecting every time.

## 2. Scope

**In:**
- [x] A user can connect more than one Google account (different logins) — reconnecting with a *different* Google login adds an account rather than overwriting the existing one.
- [x] `/settings` lists every connected account (by email), lets the user mark one as default, disconnect any individual one, and connect another.
- [x] The wizard creates events in the user's default account by default, with a per-event "Calendar" override in the Edit menu when more than one account is active.

**Not in (deliberately deferred):**
- Multiple *calendars* inside a single Google account (e.g. a secondary "Work" calendar under one login) — confirmed out of scope with the user; every connected account still always uses its own `primary` calendar.
- Renaming/labeling accounts with a custom name — the connected Google email is the label.

## 3. Scenarios

### 3.1 Main scenario

1. User has one Google account connected (`romawcka@gmail.com`), it's the default.
2. `/settings` → "🔗 Google-акаунти" → "➕ Підключити ще один акаунт" → same OAuth link flow; Google's own account chooser lets them pick a different login (`work@company.com`).
3. Both now show in the account list; `romawcka@gmail.com` still marked as default (⭐).
4. User taps `work@company.com` → "⭐ Зробити основним" → it becomes the new default.
5. In `/new`, the preview's "Calendar" line shows the default account's email. The user taps "✏️ Змінити" → "📅 Календар" (only offered when 2+ active accounts exist) → picks `romawcka@gmail.com` for this one event only — the default itself is unchanged.

### 3.2 Edge cases

| Situation | Behavior |
|---|---|
| User reconnects the *same* Google login again | Refreshes tokens on the existing row, doesn't create a duplicate |
| User disconnects the current default account | Default silently falls back to "none"; next `/new` submission that needs a calendar goes through the existing feature-03 connect prompt if no accounts are left active, or the wizard falls back to whichever single account remains active if exactly one is left |
| User has 0 accounts and opens the account list | Shows just "➕ Підключити акаунт", no list |
| Legacy account connected before this feature shipped (no identity on file yet) | First reconnect after the migration resolves it in place (same row gets identified, not duplicated) — see §9 |

## 4. Bot text

```
⚙️ Налаштування

Часовий пояс: Europe/Warsaw
Google-акаунти: 2 підключено, основний romawcka@gmail.com
Нагадування: за 30 хвилин
```
Keyboard: `🌍 Часовий пояс` · `🔗 Google-акаунти` · `🗑 Видалити всі мої дані`

Account list screen:
```
🔗 Google-акаунти
```
Keyboard, one row per connected account (⭐ marks the default): `⭐ romawcka@gmail.com` · `work@company.com` · `➕ Підключити ще один акаунт` · `⬅️ Назад`
When there are no accounts: keyboard is just `➕ Підключити акаунт` · `⬅️ Назад`.

Per-account actions (after tapping an account in the list):
```
work@company.com
```
Keyboard: `⭐ Зробити основним` (hidden if already default) · `🔌 Відключити` · `⬅️ Назад`

Preview screen's "Calendar" line now shows the resolved account's email instead of the fixed "Google Calendar" string (already just `formatPreview`'s existing `calendarLabel` parameter — no new line, same slot). Edit menu gets one more button, shown only when 2+ accounts are active:
```
Що поміняти?
```
Keyboard adds: `📅 Календар` → then a picker listing active accounts by email.

## 5. Data changes

| Model | Change | Migration |
|---|---|---|
| `CalendarAccount` | drop `userId @unique`; add `googleAccountId String?` (Google's `sub`, nullable for legacy rows); add `@@unique([userId, googleAccountId])`; `label` now holds the account's Google email instead of the fixed string `"Google Calendar"` | yes |
| `User` | add `defaultAccountId Int?` FK → `CalendarAccount`, `onDelete: SetNull` | yes |

Backward compatibility: existing rows keep `googleAccountId: null` until their user reconnects (Google wasn't asked for identity before this feature). The migration's data step sets every existing single-account user's `defaultAccountId` to their one existing account (unambiguous today). The OAuth callback resolves a legacy null-identity row in place on first reconnect rather than creating a duplicate (§6).

## 6. Impact on existing code

| What we touch | How |
|---|---|
| `prisma/schema.prisma` | Schema changes above + migration |
| `src/services/TokenService.ts` | Request `.../auth/userinfo.email` alongside the existing calendar scope; add a small `fetchGoogleIdentity(client)` helper using `google.oauth2("v2").userinfo.get()` |
| `src/routes/oauthGoogle.ts` | `/callback` fetches identity after token exchange; resolves an existing null-identity row for this user if one exists, otherwise upserts by `(userId, googleAccountId)`; sets `User.defaultAccountId` if the user had none |
| `src/bot/conversations/settingsMenu.ts` | Replace the single connect/disconnect toggle with an account-list screen (set default / disconnect / connect another), modeled on the pre-removal `handleDefaultCalendarChange` picker (see `git show f55c9a6`) |
| `src/bot/conversations/createEvent.ts` | Resolve the account to use as `defaultAccountId` (falling back to the single active account if no default is set, and to feature 03's connect-prompt if none exist); add `"calendar"` to `collectEditField`'s field list when 2+ active accounts exist |
| `docs/01-PRD.md` | §8 "Connected calendars \| ≤ 1 per user (Google only)" edited directly to reflect multiple accounts; registry row added |
| `docs/02-TECH-SPEC.md` | §4.2 schema, §5 scopes, §9 (no new env vars) updated to match |
| `docs/03-BOT-UX.md` | Settings section rewritten per §4 above |

Breaking changes: no — a user with exactly one account today sees no behavior change (still their one account, now also their default).

## 7. Readiness criteria

- [ ] Connecting a second, different Google login adds an account instead of overwriting the first
- [ ] Reconnecting the same login refreshes tokens on the same row, no duplicate
- [ ] `/settings` account list shows every connected account, set-default and disconnect both work
- [ ] Wizard preview/creation uses the default account; the "calendar" edit override works and only appears with 2+ active accounts
- [ ] A legacy pre-migration account resolves in place on reconnect rather than duplicating
- [x] Text matches section 4
- [x] `npm run typecheck && npm test` — green (no `lint` script exists in this project)
- [x] The feature registry in `docs/01-PRD.md` is updated, status is set
- [ ] Migration `20260901140500_multiple_google_accounts` applied to the dev Turso DB (`npx prisma migrate deploy`) — pending, blocked by the sandbox from running automatically; run manually together with feature 03's migration
- [ ] Manual verification against real Google accounts and Telegram — not runnable in this sandbox

## 8. Risks

| Risk | Likelihood | What we do |
|---|---|---|
| Legacy row with `googleAccountId: null` never gets resolved because the user never reconnects | low | Harmless — it keeps working via its existing tokens exactly as before; only blocks it from showing an email label until reconnected |
| User expects "multiple calendars" (plural, one Google login) rather than "multiple accounts" | resolved | Explicitly confirmed the account-based interpretation with the user before implementing |

## 9. Decisions made along the way

- **01.09:** Confirmed with the user: "multiple calendars" means multiple separate Google accounts (different logins), not multiple calendars inside one account's `calendarList`.
- **01.09:** Reused the `label` field for the Google email instead of adding a separate `email` column — every existing read site (`formatPreview`, `formatSuccessCard`, settings text) already takes a label string; no need to widen the type everywhere.
- **01.09:** A legacy account with no `googleAccountId` on file is resolved in place on the user's next reconnect (matched by `userId` + null identity) rather than left to accumulate a duplicate — avoids two active rows silently pointing at the same physical Google login.
