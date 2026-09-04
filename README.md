# Agendum Bot

A Telegram bot that turns a note into a Google Calendar event, step by step — no need to open a calendar app. Product requirements and exact message text: [`docs/01-PRD.md`](docs/01-PRD.md), [`docs/02-TECH-SPEC.md`](docs/02-TECH-SPEC.md), [`docs/03-BOT-UX.md`](docs/03-BOT-UX.md).

## Stack

Node 20 · TypeScript strict · Express 4 · grammY + `@grammyjs/conversations` · SQLite (Turso/libSQL) + Prisma (`@prisma/adapter-libsql`) · Luxon · googleapis · Zod · Pino · Vitest

## Running locally

### 1. Install

```bash
npm install
```

### 2. Environment variables

```bash
cp .env.example .env
```

Fill in `.env`:

| Variable | How to get it |
|---|---|
| `TELEGRAM_BOT_TOKEN` | see "Telegram bot" below |
| `ENCRYPTION_KEY` | `openssl rand -hex 32` |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | see "Database (Turso)" below |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | see "Google OAuth" below |
| `ALLOWLIST_TELEGRAM_IDS` | your Telegram ID (get it from [@userinfobot](https://t.me/userinfobot)), comma-separated if more than one person |
| everything else | the defaults in `.env.example` work fine for local development |

For local development `BOT_MODE=polling` and `BASE_URL=http://localhost:3000` are enough — no public domain needed (except the ngrok option below for testing Google OAuth).

### 3. Database (Turso)

The DB is [Turso](https://turso.tech) (managed libSQL, SQLite-compatible) — used for both prod and local development, there's no local file anymore.

```bash
brew install tursodatabase/tap/turso   # or see turso.tech/#install
turso auth login

turso db create agendum-bot                              # prod DB
turso db create agendum-bot-dev --from-db agendum-bot     # dev copy, cloned from prod

turso db show agendum-bot-dev --url        # → TURSO_DATABASE_URL
turso db tokens create agendum-bot-dev     # → TURSO_AUTH_TOKEN
```

Apply existing migrations to the dev DB:

```bash
npx prisma migrate deploy
```

To throw away the dev copy and clone a fresh one from prod:

```bash
npm run db:dev:refresh
```

It destroys `agendum-bot-dev`, re-clones it from `agendum-bot`, and rewrites `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` in your `.env` — a recreated copy always gets a new token, so both have to change together. The values are written straight to the file rather than printed, since the token is a secret.

Once a week `npm run dev` notices the copy has gone stale and reminds you to run that command, but does **not** run it by itself. The refresh is a `db destroy`, and on 04.09.2026 the Vercel deployment turned out to be pointed at the dev copy — a routine `npm run dev` would have wiped the database production was live on. Set `TURSO_DEV_DB_AUTO_REFRESH=1` in `.env` to opt back into the unattended refresh, once you're sure nothing but your local dev server uses that database. Either way both scripts refuse outright if `.env` names anything other than the dev copy.

#### Creating a new migration

`npx prisma migrate dev` doesn't work through `@prisma/adapter-libsql` — it fails during diagnostics (`SQLITE_UNKNOWN: no such table: _prisma_migrations`), looks like a schema-engine/adapter compatibility bug in this Prisma version. `migrate deploy` (see above) works fine — that's what we use to apply existing migrations. For a new migration (when `schema.prisma` changes), generate it locally against a throwaway SQLite file, bypassing the adapter:

1. Temporarily disable the adapter: rename `prisma.config.ts` → `prisma.config.ts.bak`.
2. In `prisma/schema.prisma`, replace `url = "file:./unused.db"` with a real local file, e.g. `url = "file:./prisma/scratch.db"`.
3. `npx prisma migrate dev --name <short_description>` — creates the migration file and applies it to `scratch.db` (not committed, see `.gitignore`).
4. Revert both temporary changes (`prisma.config.ts.bak` → `prisma.config.ts`, `url` back to `"file:./unused.db"`).
5. `npx prisma migrate deploy` — apply the freshly created migration to the dev Turso DB, later (with prod env vars) to prod as well.

### 4. Run

```bash
npm run dev      # polling, hot reload; checks the dev DB freshness before starting (predev)
```

```bash
npm run build && npm start   # prod build, same process as dev but BOT_MODE=webhook and no hot reload
```

### 5. Tests

```bash
npm test
```

Unit and integration tests (the calendar provider is mocked at the module level — no real network calls).

## Getting credentials

### Telegram bot

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → follow the instructions.
2. Copy the token into `TELEGRAM_BOT_TOKEN`.

### Google OAuth

Needs an OAuth client for the Google Calendar API.

1. [console.cloud.google.com](https://console.cloud.google.com) → create a project (or pick an existing one).
2. **APIs & Services → Library** → find "Google Calendar API" → Enable.
3. **APIs & Services → OAuth consent screen** → type **External** (or Internal, for Google Workspace) → fill in the minimum (app name, email) → add yourself to Test users if the app isn't published.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID** → type **Web application**.
5. **Authorized redirect URIs** → add `${BASE_URL}/oauth/google/callback`, e.g. `http://localhost:3000/oauth/google/callback` for local development.
6. Copy the **Client ID** and **Client Secret** into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

You can test the OAuth flow locally without deploying via a tunnel (e.g. `ngrok http 3000`) — then `BASE_URL` and the redirect URI in Google Console should point at the tunnel's public URL. When deployed (see "Deploy" below) no tunnel is needed — `BASE_URL` points at the real address.

## Deploy (Vercel)

The DB is networked (Turso), not a local file — the app isn't tied to a persistent disk, which is what makes a serverless deploy possible. `BOT_MODE=webhook` is required — serverless has no process that could poll.

1. Create a project on [vercel.com](https://vercel.com), connect the repo.
2. Set the project's env vars in Vercel: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `BOT_MODE=webhook`, `BASE_URL` = the deploy address (Vercel gives you this after the first deploy, e.g. `https://agendum-bot.vercel.app`), `ENCRYPTION_KEY`, `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` (prod DB `agendum-bot`, not the dev copy), `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` (redirect URI — `${BASE_URL}/oauth/google/callback`, add it in Google Console), `ALLOWLIST_TELEGRAM_IDS`.
3. Deploy. `vercel.json` routes every path (`/healthz`, `/oauth/google/*`, `/telegram/webhook/...`) to a single serverless handler `api/index.ts` — the same Express app as in normal mode, nothing else to configure manually.
4. `npx prisma migrate deploy` — apply the schema to the prod DB (manually, with prod env vars in `.env`, once before the first run and again for every new migration).
5. After the first deploy — once:
   ```bash
   npm run setup:webhook   # with prod env vars; registers the webhook and command menu
   ```
   Serverless has no "process startup", so this doesn't happen automatically on cold start — only via this script, manually, after each (re)deploy.

## Project structure

```
src/
  index.ts, app.ts          entry point for local development (npm run dev), Express app
  config/                    env (Zod), logger, Prisma client (Turso/libSQL)
  bot/
    commands/                /start, /new, /events, /settings, /cancel, /help
    conversations/            onboarding, /new wizard, /settings, calendar connection
    keyboards/                inline calendar, wizard keyboards
    middleware/                allowlist, rate limit, userContext, error handler
    conversationStorage.ts    Prisma adapter for @grammyjs/conversations
  calendar/
    providers/                GoogleCalendarProvider
    eventBuilder.ts           EventDraft -> Google Calendar payload, all date logic
  services/                  TokenService (encryption, Google token refresh)
  routes/                     /healthz, /oauth/google/*
  utils/                      crypto, datetime, parsers, format, errors
api/index.ts                 entry point for Vercel (serverless)
scripts/
  setup-webhook.ts            one-time webhook + command menu registration (Vercel)
  tursoDevDb.ts                shared logic for the two scripts below, incl. the destroy guard
  ensureDevDb.ts               staleness check for the Turso dev copy (runs via predev)
  refreshDevDb.ts              npm run db:dev:refresh — re-clone the dev copy from prod
prisma/schema.prisma
tests/
```
