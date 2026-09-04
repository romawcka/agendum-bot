# 05 — Event color picker

**Status:** In progress
**Created:** 03.09.2026
**Updated:** 04.09.2026 (revised again: the prompt is now a Так/Ні question, colors shown only after «Так»)
**Iteration:** 2

---

## 1. Problem

Every event created through the bot lands in Google Calendar with the calendar's default color. Users who color-code their calendar by category (work, personal, appointments) have to open Google Calendar separately after creation just to recolor each event.

## 2. Scope

**In:**
- [x] An optional "color" step in the `/new` wizard, offering a curated set of **4** distinct, plainly-named colors as buttons (revised down from Google's full 11 — see §9).
- [x] Skippable ("Ні") — leaves `colorId` unset, so the event keeps the calendar's default color (today's behavior, unchanged).
- [x] Editable from the preview screen's "Змінити" menu, same as any other field.

**Not in (deliberately deferred):**
- Custom/arbitrary hex colors — Google Calendar's API doesn't support them for individual events, only its fixed named ids.
- Offering all 11 of Google's named colors — reconsidered and reduced to 4; see §9.
- A circular color-wheel / Telegram Mini App picker — considered and rejected with the user: only a fixed handful of colors are ever possible, so a wheel would just snap to the nearest one anyway, and isn't worth the added engineering (separate hosted HTML/canvas page, `web_app` button, `web_app_data` handling).
- Changing the color of an already-created event outside the wizard — blocked on iteration 3's "editing created events."

## 3. Scenarios

### 3.1 Main scenario (pick a color)

1. User goes through `/new` as usual: title, description, date, event type, [time, duration].
2. Bot asks "Замінити колір події?" with `Так` / `Ні` / `Скасувати`.
3. User taps "Так", the bot answers "Обери колір" with the 4 plain-text color buttons.
4. User taps "Синій" (Blue).
5. Preview screen shows a `Колір: Синій` line.
6. User taps "Надіслати" — the created Google Calendar event has the Blueberry color.

### 3.2 Edge cases

| Situation | Behavior |
|---|---|
| User taps "Ні" | `colorId` stays unset; no `Колір:` line on the preview; event keeps the calendar's default color |
| User taps "Так" then ignores the color buttons | The step keeps waiting — same buttons-only loop as before; "Скасувати" is the only way out |
| User sends free text instead of tapping a button | Ignored — this step is buttons-only, same as the all-day/timed step |
| User reopens "Змінити" → "Колір" after already picking one | The whole step replays from the Так/Ні question (no "currently selected" highlight, matching how Duration/Time already work); picking a new one replaces the old choice, picking "Ні" clears it |
| All-day event | Color step still appears — it's unconditional, unlike Time/Duration |

## 4. Bot text

```
Замінити колір події?
```
Keyboard: `Так` `Ні` · `Скасувати`. Only after «Так»:
```
Обери колір
```
Keyboard (two per row): `Червоний` `Жовтий` · `Зелений` `Синій` · `Скасувати`

Preview screen gains a conditional line (omitted when skipped, same as `Опис`):
```
Колір: Синій
```

Edit menu ("«Змінити»") keyboard gains `Колір`, unconditionally (unlike `Календар`, which only shows with 2+ active Google accounts).

No emoji anywhere — plain color names only (see §9: an emoji exception was briefly approved, then revoked in favor of this simpler design). Duplicated into `docs/03-BOT-UX.md` §2.

## 5. Data changes

| Model | Change | Migration |
|---|---|---|
| `Event` | new field `colorId String?` | yes |

Backward compatibility: existing rows get `NULL` (no color was ever recorded for them) — same as "not set" going forward, no backfill needed.

## 6. Impact on existing code

| What we touch | How |
|---|---|
| `src/calendar/colors.ts` | new — a curated 4-color table (id, Ukrainian name) + `findGoogleEventColor` lookup |
| `src/bot/keyboards/colorKeyboard.ts` | new — `buildColorPromptKeyboard()` (Так/Ні) and `buildColorKeyboard()` (the 4 colors) |
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
- [x] Migration `20260903101623_add_event_color` applied to the dev Turso DB (`npx prisma migrate deploy`) — done 04.09.2026
- [x] Migration applied to the **prod** Turso DB (`agendum-bot`) — done 04.09.2026, together with the other four; the database was empty until then
- [ ] Manual verification against real Google Calendar and Telegram (picking a color actually colors the created event; skip leaves the default; edit-menu override works; all-day events still get the step) — not runnable in this sandbox

## 8. Risks

| Risk | Likelihood | What we do |
|---|---|---|
| Google's `colorId` set could change in the future, silently making a hard-coded id map stale | low | `colors.ts` is a single, isolated table — updating it is a one-file change; `findGoogleEventColor` fails closed (returns `undefined`, no crash) for an unrecognized id |

## 9. Decisions made along the way

- **03.09:** User's first idea was an Event/Reminder toggle modeled on Apple's native Calendar app — ruled out once we confirmed Google Calendar API v3 has no standalone "Reminder" object anymore (deprecated, merged into the separate Google Tasks API, which would need a new OAuth scope and re-consent from already-connected users). Pivoted to Google's own per-event `colorId` instead, which needs neither.
- **03.09:** Rejected a circular color-wheel/Mini-App picker — Google only supports 11 fixed colors regardless, so a wheel would just snap to the nearest one; not worth a new hosted web component for that.
- **03.09:** Approved a narrow, explicit exception to the bot-wide no-emoji policy for these 11 color-swatch buttons only — functional (a real color indicator), not decorative.
- **03.09:** Left `formatSuccessCard` (the post-creation confirmation card) without a color line, since it's already intentionally terse and omits other fields like description/reminder — adding color there would be the inconsistent choice, not the natural one.
- **03.09 (revision, same day):** After shipping the 11-color/emoji version, the user asked to simplify: only 4 colors, no emoji, and the prompt reworded from "pick a color" to "replace the event color?" with a "Ні" (No) option. Revoked the emoji exception entirely — 11 names with only ~8 distinct circle emoji meant some colors shared a swatch, which the simpler 4-color/plain-text design sidesteps outright (each of the 4 is unambiguous by name alone, no visual aid needed). Picked the 4 most universally recognizable, maximally distinct colors — Червоний/Жовтий/Зелений/Синій (Red/Yellow/Green/Blue) — mapped to Google's nearest real colorId (Tomato/Banana/Basil/Blueberry). `GoogleEventColor` dropped its `hex`/`emoji` fields since nothing reads them anymore.
- **04.09 (second revision):** The four colors were shown up front, so every single event creation ended with a five-button wall the user had to read past. Split into a plain Так/Ні question first — the common case («Ні») is now one tap on a two-button keyboard, and the palette only appears for someone who actually wants it. The step still can't be skipped silently, which was the point of asking at all.
