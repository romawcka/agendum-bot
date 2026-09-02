import { Router } from "express";
import { InlineKeyboard } from "grammy";
import { bot } from "../bot/bot.js";
import { prisma } from "../config/db.js";
import { logger } from "../config/logger.js";
import {
  GOOGLE_OAUTH_SCOPES,
  createGoogleOAuthClient,
  encryptGoogleTokens,
  fetchGoogleIdentity,
} from "../services/TokenService.js";

export const oauthGoogleRouter = Router();

function htmlPage(body: string): string {
  return `<!doctype html><html lang="uk"><meta charset="utf-8"><body style="font-family: sans-serif; text-align: center; padding-top: 3rem;"><p>${body}</p></body></html>`;
}

const LINK_INVALID_PAGE = htmlPage("Посилання недійсне або протермінувалося. Повернись у Telegram і спробуй знову.");
const SUCCESS_PAGE = htmlPage("Можна повернутися в Telegram.");
const GENERIC_ERROR_PAGE = htmlPage("Не вдалося підключити Google Calendar. Повернись у Telegram і спробуй знову.");

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
    scope: GOOGLE_OAUTH_SCOPES,
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
      throw new Error("Google didn't return a full set of tokens (need refresh_token — check prompt=consent)");
    }

    const user = await prisma.user.findUnique({ where: { telegramId: oauthState.telegramId } });
    if (!user) {
      throw new Error(`User with telegramId=${oauthState.telegramId} not found`);
    }

    const encrypted = encryptGoogleTokens({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    });

    const identity = await fetchGoogleIdentity(client);

    const accountData = {
      googleAccountId: identity.id,
      externalId: "primary",
      label: identity.email,
      accessToken: encrypted.accessToken,
      refreshToken: encrypted.refreshToken,
      expiresAt: new Date(tokens.expiry_date),
      isActive: true,
    };

    // A row for this exact Google login already exists (reconnect) — refresh it in place.
    // Otherwise, a pre-feature-04 row with no identity on file yet (googleAccountId: null)
    // is resolved into this login rather than left to accumulate a duplicate. Only then a
    // genuinely new account (a second, different Google login) creates a new row.
    const existing =
      (await prisma.calendarAccount.findUnique({
        where: { userId_googleAccountId: { userId: user.id, googleAccountId: identity.id } },
      })) ?? (await prisma.calendarAccount.findFirst({ where: { userId: user.id, googleAccountId: null } }));

    const account = existing
      ? await prisma.calendarAccount.update({ where: { id: existing.id }, data: accountData })
      : await prisma.calendarAccount.create({ data: { userId: user.id, ...accountData } });

    if (user.defaultAccountId === null) {
      await prisma.user.update({ where: { id: user.id }, data: { defaultAccountId: account.id } });
    }

    if (oauthState.resumeWizard) {
      await bot.api.sendMessage(
        oauthState.telegramId.toString(),
        "✅ Google Calendar підключено. Можеш продовжити створення події.",
        { reply_markup: new InlineKeyboard().text("▶️ Продовжити", "wizard:calendar_connected") },
      );
    } else {
      await bot.api.sendMessage(oauthState.telegramId.toString(), "✅ Google Calendar підключено.");
    }
    res.send(SUCCESS_PAGE);
  } catch (err) {
    logger.error({ err }, "Error handling Google OAuth callback");
    res.status(500).send(GENERIC_ERROR_PAGE);
  }
});
