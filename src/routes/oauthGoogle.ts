import { Router } from "express";
import { bot } from "../bot/bot.js";
import { prisma } from "../config/db.js";
import { logger } from "../config/logger.js";
import { GOOGLE_CALENDAR_SCOPE, createGoogleOAuthClient, encryptGoogleTokens } from "../services/TokenService.js";

export const oauthGoogleRouter = Router();

function htmlPage(body: string): string {
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><body style="font-family: sans-serif; text-align: center; padding-top: 3rem;"><p>${body}</p></body></html>`;
}

const LINK_INVALID_PAGE = htmlPage("Ссылка недействительна или истекла. Вернись в Telegram и попробуй снова.");
const SUCCESS_PAGE = htmlPage("Можно вернуться в Telegram.");
const GENERIC_ERROR_PAGE = htmlPage("Не получилось подключить Google Calendar. Вернись в Telegram и попробуй снова.");

oauthGoogleRouter.get("/start", async (req, res) => {
  const state = typeof req.query.state === "string" ? req.query.state : undefined;
  if (!state) {
    res.status(400).send(LINK_INVALID_PAGE);
    return;
  }

  const oauthState = await prisma.oAuthState.findUnique({ where: { state } });
  if (!oauthState || oauthState.expiresAt.getTime() < Date.now()) {
    res.status(400).send(LINK_INVALID_PAGE);
    return;
  }

  const client = createGoogleOAuthClient();
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [GOOGLE_CALENDAR_SCOPE],
    state,
  });

  res.redirect(url);
});

oauthGoogleRouter.get("/callback", async (req, res) => {
  const state = typeof req.query.state === "string" ? req.query.state : undefined;
  const code = typeof req.query.code === "string" ? req.query.code : undefined;

  if (!state) {
    res.status(400).send(LINK_INVALID_PAGE);
    return;
  }

  const oauthState = await prisma.oAuthState.findUnique({ where: { state } });
  await prisma.oAuthState.delete({ where: { state } }).catch(() => undefined);

  if (!oauthState || oauthState.expiresAt.getTime() < Date.now()) {
    res.status(400).send(LINK_INVALID_PAGE);
    return;
  }

  if (!code) {
    res.status(400).send(GENERIC_ERROR_PAGE);
    return;
  }

  try {
    const client = createGoogleOAuthClient();
    const { tokens } = await client.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token || !tokens.expiry_date) {
      throw new Error("Google не вернул полный набор токенов (нужен refresh_token — проверь prompt=consent)");
    }

    const user = await prisma.user.findUnique({ where: { telegramId: oauthState.telegramId } });
    if (!user) {
      throw new Error(`Пользователь с telegramId=${oauthState.telegramId} не найден`);
    }

    const encrypted = encryptGoogleTokens({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    });

    await prisma.calendarAccount.upsert({
      where: { userId_provider: { userId: user.id, provider: "GOOGLE" } },
      update: {
        externalId: "primary",
        label: "Google Calendar",
        accessToken: encrypted.accessToken,
        refreshToken: encrypted.refreshToken,
        expiresAt: new Date(tokens.expiry_date),
        isActive: true,
      },
      create: {
        userId: user.id,
        provider: "GOOGLE",
        externalId: "primary",
        label: "Google Calendar",
        accessToken: encrypted.accessToken,
        refreshToken: encrypted.refreshToken,
        expiresAt: new Date(tokens.expiry_date),
      },
    });

    await bot.api.sendMessage(oauthState.telegramId.toString(), "✅ Google Calendar подключён.");
    res.send(SUCCESS_PAGE);
  } catch (err) {
    logger.error({ err }, "Ошибка при обработке Google OAuth callback");
    res.status(500).send(GENERIC_ERROR_PAGE);
  }
});
