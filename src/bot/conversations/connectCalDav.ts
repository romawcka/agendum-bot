import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { ICLOUD_SERVER_URL, testCalDavConnection } from "../../calendar/providers/CalDavProvider.js";
import { prisma } from "../../config/db.js";
import { encrypt } from "../../utils/crypto.js";
import type { BotContext } from "../context.js";

const LOGIN_FAILED_MESSAGE = "❌ Не вдалося увійти. Перевір Apple ID і пароль застосунку та надішли ще раз.";

function parseCredentials(text: string): { appleId: string; password: string } | undefined {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length !== 2) {
    return undefined;
  }
  const [appleId, password] = lines;
  if (!appleId || !password || !appleId.includes("@")) {
    return undefined;
  }
  return { appleId, password };
}

export async function connectCalDavCalendar(
  conversation: Conversation<BotContext, Context>,
  ctx: Context,
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId === undefined) {
    return;
  }

  await ctx.reply(
    "🍎 Для iCloud потрібен пароль застосунку — звичайний пароль від Apple ID не підійде.\n\n" +
      "1. Зайди на appleid.apple.com → «Вхід і безпека» → «Паролі застосунків»\n" +
      "2. Створи новий пароль, назви його, наприклад, «Telegram Bot»\n" +
      "3. Надішли мені одним повідомленням:\n\n" +
      "твій@apple.id\nxxxx-xxxx-xxxx-xxxx\n\n" +
      "Повідомлення з паролем я видалю одразу після перевірки.",
  );

  for (;;) {
    const update = await conversation.waitFor("message:text");
    const parsed = parseCredentials(update.message.text);

    // Invariant 9: the password message is deleted immediately after processing,
    // regardless of whether the credentials turned out to be valid.
    await update.deleteMessage().catch(() => undefined);

    if (!parsed) {
      await ctx.reply(LOGIN_FAILED_MESSAGE);
      continue;
    }
    const { appleId, password } = parsed;

    const result = await conversation.external(() => testCalDavConnection(appleId, password));

    if (!result.ok || !result.calendarUrl) {
      await ctx.reply(LOGIN_FAILED_MESSAGE);
      continue;
    }
    const calendarUrl = result.calendarUrl;

    await conversation.external(async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { telegramId: BigInt(telegramId) } });
      const encryptedPassword = encrypt(password);
      await prisma.calendarAccount.upsert({
        where: { userId_provider: { userId: user.id, provider: "CALDAV" } },
        update: {
          label: "iCloud",
          externalId: calendarUrl,
          caldavUrl: ICLOUD_SERVER_URL,
          caldavUser: appleId,
          caldavPass: encryptedPassword,
          isActive: true,
        },
        create: {
          userId: user.id,
          provider: "CALDAV",
          label: "iCloud",
          externalId: calendarUrl,
          caldavUrl: ICLOUD_SERVER_URL,
          caldavUser: appleId,
          caldavPass: encryptedPassword,
        },
      });
    });

    await ctx.reply("✅ iCloud підключено. Повідомлення з паролем видалено.");
    return;
  }
}
