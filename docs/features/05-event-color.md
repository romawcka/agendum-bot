# 05 — Event color picker

**Status:** In progress
**Created:** 03.09.2026
**Updated:** 03.09.2026
**Iteration:** 2

---

## 1. Problem

Every event created through the bot lands in Google Calendar with the calendar's default color. Users who color-code their calendar by category (work, personal, appointments) have to open Google Calendar separately after creation just to recolor each event.

## 2. Scope

**In:**
- [x] An optional "color" step in the `/new` wizard, offering Google Calendar's 11 fixed named event colors as buttons.
- [x] Skippable — skipping leaves `colorId` unset, so the event keeps the calendar's default color (today's behavior, unchanged).
- [x] Editable from the preview screen's "Змінити" menu, same as any other field.

**Not in (deliberately deferred):**
- Custom/arbitrary hex colors — Google Calendar's API doesn't support them for individual events, only these 11 fixed ids.
- A circular color-wheel / Telegram Mini App picker — considered and rejected with the user: since only 11 discrete colors are ever possible, a wheel would just snap to the nearest one anyway, and isn't worth the added engineering (separate hosted HTML/canvas page, `web_app` button, `web_app_data` handling).
- Changing the color of an already-created event outside the wizard — blocked on iteration 3's "editing created events."

## 3. Scenarios

### 3.1 Main scenario (pick a color)

1. User goes through `/new` as usual: title, description, date, event type, [time, duration].
2. Bot asks "Обрати колір події?" with one button per Google color (name + colored-circle emoji) plus "Пропустити" and "Скасувати".
3. User taps e.g. "🔵 Павич" (Peacock).
4. Preview screen shows a `Колір: 🔵 Павич` line.
5. User taps "Надіслати" — the created Google Calendar event has the Peacock color.

### 3.2 Edge cases

| Situation | Behavior |
|---|---|
| User taps "Пропустити" | `colorId` stays unset; no `Колір:` line on the preview; event keeps the calendar's default color |
| User sends free text instead of tapping a button | Ignored — this step is buttons-only, same as the all-day/timed step |
| User reopens "Змінити" → "Колір" after already picking one | Same 11 buttons shown again (no "currently selected" highlight, matching how Duration/Time already work); picking a new one replaces the old choice, picking "Пропустити" clears it |
| All-day event | Color step still appears — it's unconditional, unlike Time/Duration |

## 4. Bot text

```
Обрати колір події?
```
Keyboard (two per row): `🟣 Лаванда` `🟢 Шавлія` · `🟣 Виноград` `🔴 Фламінго` · `🟡 Банан` `🟠 Мандарин` · `🔵 Павич` `⚫ Графіт` · `🔵 Чорниця` `🟢 Базилік` · `🔴 Помідор` · `Пропустити` · `Скасувати`

Preview screen gains a conditional line (omitted when skipped, same as `Опис`):
```
Колір: 🔵 Павич
```

Edit menu ("«Змінити»") keyboard gains `Колір`, unconditionally (unlike `Календар`, which only shows with 2+ active Google accounts).

The emoji on these 11 buttons and the preview line are the **only** approved exception to the bot-wide no-emoji cleanup (see `docs/03-BOT-UX.md` intro) — here they're a real color swatch (Telegram buttons are plain text, no styling), not decoration. Duplicated into `docs/03-BOT-UX.md` §2.

## 5. Data changes

| Model | Change | Migration |
|---|---|---|
| `Event` | new field `colorId String?` | yes |

Backward compatibility: existing rows get `NULL` (no color was ever recorded for them) — same as "not set" going forward, no backfill needed.

## 6. Impact on existing code

| What we touch | How |
|---|---|
| `src/calendar/colors.ts` | new — the 11-color table (id, Ukrainian name, hex, emoji) + `findGoogleEventColor` lookup |
| `src/bot/keyboards/colorKeyboard.ts` | new — `buildColorKeyboard()` |
| `src/calendar/types.ts` | `EventDraft` gains `colorId?: string` |
| `src/calendar/eventBuilder.ts` | `buildGoogleEventPayload` sets `colorId` on the API payload when present, omitted otherwise (same convention as `description`) |
| `src/bot/conversations/createEvent.ts` | `WizardDraft` gains `colorId`; new `collectColor` collector wired into the main flow (after duration) and into the Edit menu (`EditField` gains `"color"`); `toEventDraft`/`toPreviewDraft` pass it through; `prisma.event.create` persists it |
| `src/utils/format.ts` | `PreviewDraft` gains `colorId`; `formatPreview` shows the conditional `Колір:` line. `formatSuccessCard` is intentionally left untouched — it's already a terse card that omits `Опис`/`Нагадування` too, so adding color there would be inconsistent with its existing minimalism |
| `prisma/schema.prisma` | `Event.colorId` + migration |
| `docs/03-BOT-UX.md` | new "Крок 7. Колір" (renumbering the old step 7 "Перегляд" to 8), updated "«Змінити»" keyboard line, updated preview example |

Breaking changes: no.

## 7. Readiness criteria

- [x] `npm run typecheck && npm test` — green (no `lint` script exists in this project; includes 2 new `eventBuilder.test.ts` cases + a new `colors.test.ts`)
- [x] Text matches section 4
- [x] The feature registry in `docs/01-PRD.md` is updated, status is set
- [ ] Migration `20260903101623_add_event_color` applied to the dev Turso DB (`npx prisma migrate deploy`) — pending, blocked by the sandbox from running automatically; run manually
- [ ] Manual verification against real Google Calendar and Telegram (picking a color actually colors the created event; skip leaves the default; edit-menu override works; all-day events still get the step) — not runnable in this sandbox

## 8. Risks

| Risk | Likelihood | What we do |
|---|---|---|
| Only ~8 distinct circle emoji exist for 11 colors, so a few buttons share one (Lavender/Grape both 🟣, Peacock/Blueberry both 🔵) — a user might tap the wrong one going by emoji alone | low | The Ukrainian name is always shown alongside and is the authoritative label; emoji is a secondary visual aid only |
| Google's `colorId` set could change in the future, silently making a hard-coded id map stale | low | `colors.ts` is a single, isolated table — updating it is a one-file change; `findGoogleEventColor` fails closed (returns `undefined`, no crash) for an unrecognized id |

## 9. Decisions made along the way

- **03.09:** User's first idea was an Event/Reminder toggle modeled on Apple's native Calendar app — ruled out once we confirmed Google Calendar API v3 has no standalone "Reminder" object anymore (deprecated, merged into the separate Google Tasks API, which would need a new OAuth scope and re-consent from already-connected users). Pivoted to Google's own per-event `colorId` instead, which needs neither.
- **03.09:** Rejected a circular color-wheel/Mini-App picker — Google only supports 11 fixed colors regardless, so a wheel would just snap to the nearest one; not worth a new hosted web component for that.
- **03.09:** Approved a narrow, explicit exception to the bot-wide no-emoji policy for these 11 color-swatch buttons only — functional (a real color indicator), not decorative.
- **03.09:** Left `formatSuccessCard` (the post-creation confirmation card) without a color line, since it's already intentionally terse and omits other fields like description/reminder — adding color there would be the inconsistent choice, not the natural one.
