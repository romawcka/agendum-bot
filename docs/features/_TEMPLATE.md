# NN — [Feature name]

**Status:** Draft | Ready for development | In progress | Done | Rejected
**Created:** DD.MM.YYYY
**Updated:** DD.MM.YYYY
**Iteration:** N

---

## 1. Problem

[What hurts right now. A concrete scenario where the user has a hard time. No solution here — just the pain.]

## 2. Scope

**In:**
- [ ] [Item]
- [ ] [Item]

**Not in (deliberately deferred):**
- [Item] — *why deferred*
- [Item] — *why deferred*

## 3. Scenarios

### 3.1 [Main scenario]

1. The user [action]
2. The bot [reaction]
3. …

### 3.2 [Edge cases]

| Situation | Behavior |
|---|---|
| [Invalid input] | [What the bot does] |
| [External service unavailable] | [What the bot does] |
| [No data] | [What the bot does] |

## 4. Bot text

New and changed messages. Wording is final — the implementation takes it verbatim.

```
[Exact message text]
```
Keyboard: `Button` · `Button`

*Duplicate changes to existing text into `docs/03-BOT-UX.md`.*

## 5. Data changes

| Model | Change | Migration |
|---|---|---|
| `[Model]` | [New field / new model] | yes / no |

Backward compatibility: [what happens to existing records].

## 6. Impact on existing code

| What we touch | How |
|---|---|
| [Module / file] | [Nature of the change] |

Breaking changes: [yes / no; if yes — what, and how we migrate].

## 7. Readiness criteria

- [ ] [A checkable statement, not "works well"]
- [ ] [Tests cover the edge cases from section 3.2]
- [ ] Text matches section 4
- [ ] `npm run typecheck && npm test && npm run lint` — green
- [ ] The feature registry in `docs/01-PRD.md` is updated, status is set

## 8. Risks

| Risk | Likelihood | What we do |
|---|---|---|
| [What could go wrong] | low / medium / high | [Mitigation, or a deliberate accepted risk] |

## 9. Decisions made along the way

*Filled in during development — records why something was done this way and not another. Saves you six months from now, when the reason has been forgotten.*

- **DD.MM:** [Decision and its reason]
