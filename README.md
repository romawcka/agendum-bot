# Agendum Bot

Telegram-бот, который пошагово превращает заметку в событие Google Calendar и/или Apple iCloud — без открытия календарного приложения. Продуктовые требования и точные тексты сообщений: [`docs/01-PRD.md`](docs/01-PRD.md), [`docs/02-TECH-SPEC.md`](docs/02-TECH-SPEC.md), [`docs/03-BOT-UX.md`](docs/03-BOT-UX.md).

## Стек

Node 20 · TypeScript strict · Express 4 · grammY + `@grammyjs/conversations` · SQLite (Turso/libSQL) + Prisma (`@prisma/adapter-libsql`) · Luxon · googleapis · tsdav + ical-generator · Zod · Pino · Vitest

## Локальный запуск

### 1. Установка

```bash
npm install
```

### 2. Переменные окружения

```bash
cp .env.example .env
```

Заполни `.env`:

| Переменная | Как получить |
|---|---|
| `TELEGRAM_BOT_TOKEN` | см. «Telegram-бот» ниже |
| `ENCRYPTION_KEY` | `openssl rand -hex 32` |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | см. «База данных (Turso)» ниже |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | см. «Google OAuth» ниже |
| `ALLOWLIST_TELEGRAM_IDS` | свой Telegram ID (узнать у [@userinfobot](https://t.me/userinfobot)), через запятую если людей несколько |
| остальные | значения по умолчанию из `.env.example` подходят для локальной разработки |

Для локальной разработки `BOT_MODE=polling` и `BASE_URL=http://localhost:3000` — этого достаточно, публичный домен не нужен (кроме варианта ниже с ngrok для проверки Google OAuth).

### 3. База данных (Turso)

БД — [Turso](https://turso.tech) (managed libSQL, SQLite-совместимый) — нужна и для прода, и для локальной разработки, локального файла больше нет.

```bash
brew install tursodatabase/tap/turso   # или см. turso.tech/#install
turso auth login

turso db create agendum-bot                              # прод-база
turso db create agendum-bot-dev --from-db agendum-bot     # дев-копия, клон прод-базы

turso db show agendum-bot-dev --url        # → TURSO_DATABASE_URL
turso db tokens create agendum-bot-dev     # → TURSO_AUTH_TOKEN
```

Прогнать существующие миграции на дев-базу:

```bash
npx prisma migrate deploy
```

Дев-копия сама обновляется из прод-базы раз в неделю при `npm run dev` (см. `scripts/ensureDevDb.ts`) — вручную пересоздавать не нужно.

#### Создание новой миграции

`npx prisma migrate dev` не работает через `@prisma/adapter-libsql` — падает на диагностике (`SQLITE_UNKNOWN: no such table: _prisma_migrations`), похоже на баг совместимости schema engine с адаптером в этой версии Prisma. `migrate deploy` (см. выше) работает штатно — им и накатываем существующие миграции. Для новой миграции (когда меняется `schema.prisma`) генерируем её локально против одноразового файла SQLite, в обход адаптера:

1. Временно отключить адаптер: переименовать `prisma.config.ts` → `prisma.config.ts.bak`.
2. В `prisma/schema.prisma` заменить `url = "file:./unused.db"` на реальный локальный файл, например `url = "file:./prisma/scratch.db"`.
3. `npx prisma migrate dev --name <краткое_описание>` — создаст файл миграции и применит его к `scratch.db` (файл не коммитится, см. `.gitignore`).
4. Откатить оба временных изменения (`prisma.config.ts.bak` → `prisma.config.ts`, `url` обратно на `"file:./unused.db"`).
5. `npx prisma migrate deploy` — применить свежесозданную миграцию к дев-Turso, позже так же (с прод-переменными) — к проду.

### 4. Запуск

```bash
npm run dev      # polling, hot reload; перед стартом проверяет свежесть дев-БД (predev)
```

```bash
npm run build && npm start   # прод-сборка, тот же процесс что и dev, но BOT_MODE=webhook и без hot reload
```

### 5. Тесты

```bash
npm test
```

Юнит- и интеграционные тесты (провайдеры календарей мокаются на уровне модуля — реальных сетевых вызовов нет).

## Получение credentials

### Telegram-бот

1. Напиши [@BotFather](https://t.me/BotFather) → `/newbot` → следуй инструкциям.
2. Скопируй токен в `TELEGRAM_BOT_TOKEN`.

### Google OAuth

Нужен OAuth-клиент для Google Calendar API.

1. [console.cloud.google.com](https://console.cloud.google.com) → создай проект (или выбери существующий).
2. **APIs & Services → Library** → найди «Google Calendar API» → Enable.
3. **APIs & Services → OAuth consent screen** → тип **External** (или Internal, если Google Workspace) → заполни минимум (название приложения, email) → добавь себя в Test users, если приложение не опубликовано.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID** → тип **Web application**.
5. **Authorized redirect URIs** → добавь `${BASE_URL}/oauth/google/callback`, например `http://localhost:3000/oauth/google/callback` для локальной разработки.
6. Скопируй **Client ID** и **Client Secret** в `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

Проверить OAuth-flow локально без деплоя можно через туннель (например `ngrok http 3000`) — тогда `BASE_URL` и redirect URI в Google Console должны указывать на публичный URL туннеля. При деплое (см. «Деплой» ниже) туннель не нужен — `BASE_URL` указывает на настоящий адрес.

### Apple iCloud (app-specific password)

Каждый пользователь бота делает это сам при подключении iCloud через `/start` или `/settings` — секретов проекта здесь нет:

1. [appleid.apple.com](https://appleid.apple.com) → «Вход и безопасность» → «Пароли приложений».
2. Создать новый пароль, например с названием «Telegram Bot».
3. Прислать боту одним сообщением Apple ID и этот пароль — бот проверит соединение и сразу удалит сообщение с паролем из чата.

## Деплой (Vercel)

БД сетевая (Turso), не локальный файл — приложение не завязано на постоянный диск, что и делает возможным serverless-деплой. `BOT_MODE=webhook` обязателен — на serverless нет процесса, который мог бы поллить.

1. Завести проект на [vercel.com](https://vercel.com), подключить репозиторий.
2. Выставить в Vercel env-переменные проекта: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `BOT_MODE=webhook`, `BASE_URL` = адрес деплоя (Vercel даёт его после первого деплоя, например `https://agendum-bot.vercel.app`), `ENCRYPTION_KEY`, `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` (прод-база `agendum-bot`, не дев-копия), `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` (redirect URI — `${BASE_URL}/oauth/google/callback`, добавить в Google Console), `ALLOWLIST_TELEGRAM_IDS`.
3. Задеплоить. `vercel.json` разворачивает все пути (`/healthz`, `/oauth/google/*`, `/telegram/webhook/...`) на один serverless-хендлер `api/index.ts` — это тот же Express-app, что и в обычном режиме, ничего вручную настраивать не нужно.
4. `npx prisma migrate deploy` — прогнать схему на прод-базу (руками, с прод-переменными в `.env`, один раз перед первым запуском и при каждой новой миграции).
5. После первого деплоя — один раз:
   ```bash
   npm run setup:webhook   # с прод-переменными; регистрирует webhook и меню команд
   ```
   Serverless не имеет «запуска процесса», поэтому это не происходит само по себе на cold start — только этим скриптом, вручную после (пере)деплоя.

## Структура проекта

```
src/
  index.ts, app.ts          точка входа для локальной разработки (npm run dev), Express-приложение
  config/                    env (Zod), logger, Prisma-клиент (Turso/libSQL)
  bot/
    commands/                /start, /new, /events, /settings, /cancel, /help
    conversations/            онбординг, визард /new, /settings, подключение календарей
    keyboards/                инлайн-календарь, клавиатуры визарда
    middleware/                allowlist, rate limit, userContext, error handler
    conversationStorage.ts    Prisma-адаптер для @grammyjs/conversations
  calendar/
    CalendarService.ts        фасад поверх Google/CalDAV
    providers/                GoogleCalendarProvider, CalDavProvider
    eventBuilder.ts           EventDraft -> payload/ICS, вся логика дат
  services/                  TokenService (шифрование, refresh Google-токена)
  routes/                     /healthz, /oauth/google/*
  utils/                      crypto, datetime, parsers, format, errors
api/index.ts                 точка входа для Vercel (serverless)
scripts/
  setup-webhook.ts            разовая регистрация webhook + меню команд (Vercel)
  ensureDevDb.ts               автообновление дев-копии Turso (запускается через predev)
prisma/schema.prisma
tests/
```
