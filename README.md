# Agendum Bot

Telegram-бот, который пошагово превращает заметку в событие Google Calendar и/или Apple iCloud — без открытия календарного приложения. Продуктовые требования и точные тексты сообщений: [`docs/01-PRD.md`](docs/01-PRD.md), [`docs/02-TECH-SPEC.md`](docs/02-TECH-SPEC.md), [`docs/03-BOT-UX.md`](docs/03-BOT-UX.md).

## Стек

Node 20 · TypeScript strict · Express 4 · grammY + `@grammyjs/conversations` · SQLite + Prisma (`@prisma/adapter-better-sqlite3`) · Luxon · googleapis · tsdav + ical-generator · Zod · Pino · Vitest

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
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | см. «Google OAuth» ниже |
| `ALLOWLIST_TELEGRAM_IDS` | свой Telegram ID (узнать у [@userinfobot](https://t.me/userinfobot)), через запятую если людей несколько |
| остальные | значения по умолчанию из `.env.example` подходят для локальной разработки |

Для локальной разработки `BOT_MODE=polling` и `BASE_URL=http://localhost:3000` — этого достаточно, публичный домен не нужен (кроме варианта ниже с ngrok для проверки Google OAuth).

### 3. База данных

```bash
npx prisma migrate dev
```

Создаст `data/app.db` и применит схему из `prisma/schema.prisma`.

### 4. Запуск

```bash
npm run dev      # polling, hot reload
```

```bash
npm run build && npm start   # прод-сборка, webhook-режим
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

Проверить OAuth-flow локально без публичного домена можно через туннель (например `ngrok http 3000`) — тогда `BASE_URL` и redirect URI в Google Console должны указывать на публичный URL туннеля.

### Apple iCloud (app-specific password)

Каждый пользователь бота делает это сам при подключении iCloud через `/start` или `/settings` — секретов проекта здесь нет:

1. [appleid.apple.com](https://appleid.apple.com) → «Вход и безопасность» → «Пароли приложений».
2. Создать новый пароль, например с названием «Telegram Bot».
3. Прислать боту одним сообщением Apple ID и этот пароль — бот проверит соединение и сразу удалит сообщение с паролем из чата.

## Деплой

Multi-stage `Dockerfile` в корне репозитория собирает `better-sqlite3` под целевую архитектуру.

```bash
docker build -t agendum-bot .
```

Обязательно:

- **Персистентный volume** под `/data` — файловая система контейнера на Railway/Fly.io эфемерна, без volume база пропадёт при передеплое. `DATABASE_URL=file:/data/app.db` в проде.
- `BOT_MODE=webhook`, `BASE_URL` — публичный HTTPS-домен, `TELEGRAM_WEBHOOK_SECRET` — случайная строка.
- `npx prisma migrate deploy` выполняется автоматически при старте контейнера (см. `CMD` в `Dockerfile`).
- **Бэкап:** ежесуточно `sqlite3 /data/app.db "VACUUM INTO '/data/backups/app-$(date +%F).db'"` (простое копирование файла при активном WAL может дать битый снимок) + ротация, например хранить последние 30 копий.
- Один инстанс — SQLite не поддерживает горизонтальное масштабирование. Переезд на Postgres при необходимости — только `provider` в `schema.prisma`, строка подключения и три типа полей (см. [`docs/01-PRD.md`](docs/01-PRD.md#8-хранилище-данных)).

## Структура проекта

```
src/
  index.ts, app.ts          точка входа, Express-приложение
  config/                    env (Zod), logger, Prisma-клиент
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
prisma/schema.prisma
tests/
```
