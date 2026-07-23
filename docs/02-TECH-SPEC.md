# Техническая спецификация — Telegram Calendar Bot

**Версия:** 1.0 | Итерация 1

---

## 1. Стек

| Слой | Технология | Обоснование |
|---|---|---|
| Runtime | Node.js 20 LTS | ESM, стабильность |
| HTTP-сервер | Express 4 | Требование заказчика; нужен для OAuth-callback и Telegram webhook |
| Telegram | grammY | Современнее Telegraf, есть плагины `conversations`, `menu`, хорошая типизация |
| БД | SQLite (`better-sqlite3`, WAL) | Нагрузка итерации 1 — десятки записей в день; ноль администрирования |
| ORM | Prisma | Миграции, типобезопасность, безболезненный переезд на Postgres позже |
| Даты/TZ | Luxon | Корректная работа с IANA-таймзонами и DST |
| Google Calendar | `googleapis` | Официальный SDK |
| iCloud (CalDAV) | `tsdav` + `ical-generator` | Рабочая связка для Apple Calendar |
| Логи | Pino | Структурированные JSON-логи |
| Валидация | Zod | Валидация env и входных данных |
| Тесты | Vitest | Быстрые unit-тесты парсеров и билдеров |
| Шифрование | Node `crypto` (AES-256-GCM) | Без внешних зависимостей |

**Язык:** TypeScript, strict mode.

## 2. Архитектура

```
Telegram ──webhook──▶ Express ──▶ grammY bot
                        │             │
                        │             ├─▶ Conversations (визард)
                        │             ├─▶ Command handlers
                        │             └─▶ Callback handlers
                        │
                        └─▶ /oauth/google/callback ──▶ TokenService

                 ┌──────────────────────────────┐
                 │      CalendarService          │  единый интерфейс
                 └───────┬───────────────┬───────┘
                         │               │
              GoogleCalendarProvider   CalDavProvider
                         │               │
                    Google API      iCloud CalDAV

                 SQLite (Prisma)
```

**Ключевой принцип:** `CalendarService` — фасад с единым интерфейсом. Оба провайдера реализуют один контракт, вызывающий код не знает, какой календарь используется.

```ts
interface CalendarProvider {
  createEvent(account: CalendarAccount, event: EventDraft): Promise<CreatedEvent>;
  deleteEvent(account: CalendarAccount, externalId: string): Promise<void>;
  testConnection(account: CalendarAccount): Promise<boolean>;
}

interface EventDraft {
  title: string;
  description?: string;          // отсутствует => не отправляем поле в API
  timezone: string;              // IANA, напр. "Europe/Warsaw"
  allDay: boolean;
  date: string;                  // YYYY-MM-DD (для all-day и как база для времени)
  startTime?: string;            // HH:mm, только если !allDay
  durationMinutes?: number;      // только если !allDay
  reminderMinutes: number;       // по умолчанию 30
}
```

## 3. Структура проекта

```
src/
  index.ts                    точка входа: Express + bot
  config/
    env.ts                    Zod-валидация переменных окружения
    logger.ts
  bot/
    bot.ts                    инициализация grammY, middleware
    commands/
      start.ts  new.ts  events.ts  settings.ts  cancel.ts  help.ts
    conversations/
      createEvent.ts          визард создания события
      onboarding.ts           таймзона + подключение календаря
    keyboards/
      calendarPicker.ts       инлайн-календарь выбора даты
      durationKeyboard.ts
      confirmKeyboard.ts
    middleware/
      allowlist.ts
      rateLimit.ts
      errorHandler.ts
      userContext.ts          загрузка/создание User в ctx.state
  calendar/
    CalendarService.ts
    providers/
      GoogleCalendarProvider.ts
      CalDavProvider.ts
    eventBuilder.ts           EventDraft -> payload провайдера
  services/
    UserService.ts
    EventService.ts
    TokenService.ts           шифрование/дешифрование, refresh Google
  routes/
    oauthGoogle.ts            /oauth/google/start, /oauth/google/callback
    health.ts                 /healthz
  utils/
    crypto.ts                 AES-256-GCM
    datetime.ts               Luxon-хелперы, сборка start/end
    parsers.ts                парсинг даты, времени, длительности
    format.ts                 рендер превью и карточек событий
prisma/
  schema.prisma
tests/
  parsers.test.ts  datetime.test.ts  eventBuilder.test.ts
```

## 4. Схема базы данных

### 4.1 Ограничения SQLite в Prisma — соблюдать обязательно

| Ограничение | Как обходим |
|---|---|
| Нет нативных `enum` | Поле типа `String` + TS union-тип и Zod-валидация в коде |
| Нет `@db.Text` | Обычный `String` — SQLite не ограничивает длину |
| `Json`-тип ненадёжен | Состояние визарда храним как `String`, сериализуем `JSON.stringify` / `JSON.parse` в сервисном слое |
| Нет `@@unique` на выражениях | Обычных составных unique достаточно |
| Один пишущий процесс | Включить WAL: `PRAGMA journal_mode = WAL;` и `PRAGMA busy_timeout = 5000;` при инициализации |

`BigInt` для `telegramId` SQLite через Prisma поддерживает — ID Telegram укладываются в signed 64-bit.

Datasource:

```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")   // file:../data/app.db
}
```

### 4.2 Модели

```prisma
model User {
  id                Int       @id @default(autoincrement())
  telegramId        BigInt    @unique
  firstName         String?
  username          String?
  timezone          String?              // IANA; null до онбординга
  defaultAccountId  Int?                 // выбранный календарь по умолчанию
  defaultReminder   Int       @default(30)  // минуты; задел на итерацию 3
  isBlocked         Boolean   @default(false)
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  accounts          CalendarAccount[]
  events            Event[]
  session           WizardSession?
}

model CalendarAccount {
  id            Int       @id @default(autoincrement())
  userId        Int
  provider      String                    // "GOOGLE" | "CALDAV"
  label         String                    // "Google Calendar" / "iCloud"
  externalId    String                    // calendarId (Google) или URL коллекции (CalDAV)
  // Google:
  accessToken   String?                   // зашифровано
  refreshToken  String?                   // зашифровано
  expiresAt     DateTime?
  // CalDAV:
  caldavUrl     String?
  caldavUser    String?
  caldavPass    String?                   // зашифровано
  isActive      Boolean   @default(true)
  createdAt     DateTime  @default(now())

  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  events        Event[]

  @@unique([userId, provider])
}

model Event {
  id                Int       @id @default(autoincrement())
  userId            Int
  accountId         Int
  externalId        String                // ID события в календаре
  title             String
  description       String?
  allDay            Boolean
  startsAt          DateTime              // UTC
  endsAt            DateTime?             // UTC; null для all-day
  timezone          String
  reminderMinutes   Int
  status            String    @default("ACTIVE")   // "ACTIVE" | "DELETED"
  createdAt         DateTime  @default(now())

  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  account           CalendarAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([userId, startsAt])
}

model WizardSession {
  id          Int      @id @default(autoincrement())
  userId      Int      @unique
  state       String                // JSON-строка: текущий шаг + собранные поля
  expiresAt   DateTime
  updatedAt   DateTime @updatedAt

  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model OAuthState {
  state       String   @id          // случайный nonce
  telegramId  BigInt
  expiresAt   DateTime
}

// enum-ов нет: SQLite их не поддерживает.
// В коде:
//   export const PROVIDERS = ['GOOGLE', 'CALDAV'] as const;
//   export type Provider = typeof PROVIDERS[number];
//   export const EVENT_STATUSES = ['ACTIVE', 'DELETED'] as const;
//   export type EventStatus = typeof EVENT_STATUSES[number];
```

## 5. Интеграция: Google Calendar

**Scopes:** `https://www.googleapis.com/auth/calendar.events`

**Поток OAuth:**
1. Пользователь жмёт «Подключить Google» → бот генерирует nonce, пишет в `OAuthState` (TTL 10 мин), отдаёт ссылку на `/oauth/google/start?state=<nonce>`.
2. Express редиректит на Google consent screen с `access_type=offline`, `prompt=consent` (чтобы гарантированно получить refresh_token).
3. Callback `/oauth/google/callback` проверяет state, обменивает code на токены, шифрует и сохраняет, отправляет пользователю сообщение в Telegram об успехе, показывает в браузере простую страницу «Можно вернуться в Telegram».

**Создание события:**

```ts
// Событие со временем
{
  summary: draft.title,
  ...(draft.description ? { description: draft.description } : {}),
  start: { dateTime: startISO, timeZone: draft.timezone },
  end:   { dateTime: endISO,   timeZone: draft.timezone },
  reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: draft.reminderMinutes }] }
}

// All-day событие
{
  summary: draft.title,
  ...(draft.description ? { description: draft.description } : {}),
  start: { date: 'YYYY-MM-DD' },
  end:   { date: 'YYYY-MM-DD' },   // ВАЖНО: end = следующий день (exclusive)
  reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: reminderForAllDay }] }
}
```

- `calendarId` = `'primary'` по умолчанию.
- Ключевая деталь: у Google для all-day `end.date` **эксклюзивен** — для однодневного события это дата + 1 день.
- Refresh токена: перед каждым запросом проверяем `expiresAt`; при `invalid_grant` помечаем аккаунт неактивным и просим переподключить.

## 6. Интеграция: Apple iCloud (CalDAV)

- **Аутентификация:** Apple ID + app-specific password (обычный пароль не работает при 2FA).
- **Discovery:** `tsdav` → `createDAVClient` с `serverUrl: 'https://caldav.icloud.com'`, `authMethod: 'Basic'` → `fetchCalendars()` → выбираем первый writable календарь (или даём выбрать пользователю, если их несколько).
- **Создание события:** генерируем ICS через `ical-generator`, кладём через `createCalendarObject`. `externalId` = URL созданного объекта (нужен для удаления).
- **Напоминание:** VALARM с `trigger: -PT30M`.
- **All-day:** `allDay: true` в ical-generator, `DTSTART;VALUE=DATE`.
- **Timezone:** явно указываем `timezone` при генерации ICS.
- **Удаление:** `deleteCalendarObject` по сохранённому URL; 404 трактуем как «уже удалено» — не ошибка.

**Безопасность:** сообщение с паролем удаляется через `ctx.api.deleteMessage` сразу после чтения; пароль шифруется перед записью в БД; в логи не попадает никогда.

## 7. Логика дат и времени

Вся работа — через Luxon, в БД всё в UTC, пользователю показывается в его таймзоне.

```ts
// Сборка начала и конца
const start = DateTime.fromFormat(`${date} ${startTime}`, 'yyyy-MM-dd HH:mm', { zone: tz });
const end   = start.plus({ minutes: durationMinutes });
```

**Обязательные тест-кейсы:**
- Событие на 23:30 длительностью 60 минут → конец 00:30 следующего дня.
- Событие в день перехода на летнее/зимнее время.
- All-day событие: `end.date` = дата + 1 день (Google).
- Прошедшая дата → предупреждение, но создание разрешено.
- 29 февраля, 31-е число в месяцах с 30 днями (валидация календарного пикера).

**Парсинг длительности:** принимаем `30м`, `45 мин`, `1ч`, `2 ч`, `1ч30м`, `90` (голое число = минуты). Максимум 24 часа.

**Парсинг даты вручную:** строго `дд.мм.гггг`. Всё остальное — переспрос с подсказкой формата.

## 8. Инлайн-календарь (date picker)

Собственный компонент, без внешних библиотек:

- Заголовок: `‹ Август 2026 ›` (кнопки перелистывания месяца).
- Строка дней недели: Пн Вт Ср Чт Пт Сб Вс.
- Сетка дней; пустые клетки — `callback_data: 'noop'`.
- Callback data формат: `dp:day:2026-08-14`, `dp:prev:2026-07`, `dp:next:2026-09`.
- Кнопка «⌨️ Ввести вручную» — переключает на текстовый ввод `дд.мм.гггг`.
- Ограничение перелистывания: ±3 года от текущей даты.

## 9. Управление состоянием визарда

- Плагин `@grammyjs/conversations` с **персистентным storage-адаптером на Prisma** (модель `WizardSession`), а не in-memory.
- При `/cancel` или таймауте (60 мин) сессия удаляется.
- Запуск нового `/new` при активной сессии: бот спрашивает «Продолжить незавершённое или начать заново?».

## 10. Переменные окружения

```
NODE_ENV=production
PORT=3000
BASE_URL=https://bot.example.com

TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=          # secret_token для валидации входящих
BOT_MODE=webhook                  # webhook | polling

DATABASE_URL=file:../data/app.db
BACKUP_DIR=./backups

ENCRYPTION_KEY=                   # 32 байта в hex (64 символа)

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://bot.example.com/oauth/google/callback

ALLOWLIST_TELEGRAM_IDS=123456789,987654321
DEFAULT_REMINDER_MINUTES=30
WIZARD_TTL_MINUTES=60
LOG_LEVEL=info
```

Все переменные валидируются через Zod при старте — процесс падает с понятной ошибкой, если чего-то не хватает.

## 11. Эндпоинты Express

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/telegram/webhook/:secret` | Приём апдейтов Telegram (проверка `X-Telegram-Bot-Api-Secret-Token`) |
| GET | `/oauth/google/start` | Редирект на Google consent |
| GET | `/oauth/google/callback` | Обмен кода на токены |
| GET | `/healthz` | Health check: статус процесса + пинг БД |

## 12. Обработка ошибок

Глобальный `bot.catch` + Express error middleware.

| Ситуация | Ответ пользователю |
|---|---|
| Google токен истёк и не рефрешится | «Доступ к Google Calendar истёк. Подключи заново: /settings» |
| CalDAV 401 | «Пароль для iCloud больше не работает. Обнови его в /settings» |
| Сеть/5xx от провайдера | «Календарь временно недоступен. Попробуй ещё раз через минуту» + кнопка «🔄 Повторить» (черновик события сохранён) |
| Событие уже удалено в календаре | «Это событие уже удалено» + убрать из списка |
| Невалидный ввод | Конкретная подсказка с примером правильного формата |

Никаких stack trace пользователю. Всё техническое — в Pino с `userId` и `requestId`.

## 13. Тесты (минимум для итерации 1)

- `parsers.test.ts` — дата, время, длительность: валидные и невалидные входы.
- `datetime.test.ts` — переход через полночь, DST, all-day end-date +1.
- `eventBuilder.test.ts` — description отсутствует ⇒ поля нет в payload; all-day vs timed; напоминание.
- Интеграционные тесты провайдеров — с моками HTTP, без реальных вызовов API.

## 14. Деплой

- Docker-образ, multi-stage build. В образе должен собираться `better-sqlite3` под целевую архитектуру (нативный модуль) — ставить в builder-стадии и копировать `node_modules` целиком.
- `prisma migrate deploy` при старте.
- Хостинг: Railway / Fly.io / VPS с Caddy для TLS.
- **Файл БД лежит на персистентном volume**, смонтированном в `/data`. На Railway и Fly.io файловая система контейнера эфемерна: без volume база пропадёт при первом же передеплое. `DATABASE_URL=file:/data/app.db` в проде.
- **Бэкап:** cron-задача раз в сутки выполняет `VACUUM INTO '/data/backups/app-YYYY-MM-DD.db'`, старше 30 дней удаляется. Это корректный способ снять копию SQLite на живой базе — простое копирование файла при активном WAL может дать битый снимок.
- WAL и `busy_timeout` включаются при инициализации Prisma-клиента.
- Один инстанс приложения. Горизонтальное масштабирование потребует переезда на Postgres.
- Webhook ставится при старте приложения (`setWebhook` с secret_token), в dev — `BOT_MODE=polling`.
- Graceful shutdown: дождаться завершения обработки текущих апдейтов.
