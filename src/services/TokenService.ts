import type { CalendarAccount } from "@prisma/client";
import { google } from "googleapis";
import { prisma } from "../config/db.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { decrypt, encrypt } from "../utils/crypto.js";
import { AppError } from "../utils/errors.js";

export type GoogleOAuthClient = InstanceType<typeof google.auth.OAuth2>;

export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
// email scope, alongside the calendar one — lets us identify *which* Google account was
// used (see fetchGoogleIdentity), needed to support connecting more than one (feature 04).
export const GOOGLE_OAUTH_SCOPES = [GOOGLE_CALENDAR_SCOPE, "https://www.googleapis.com/auth/userinfo.email"];

const GOOGLE_TOKEN_EXPIRED_MESSAGE = "Доступ до Google Calendar втрачено. Підключи знову: /settings";

// Refresh a little before the real expiry to avoid racing a request against it.
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

export function createGoogleOAuthClient(): GoogleOAuthClient {
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
}

/** Identifies which Google account was just connected — needed to tell two connected accounts apart (feature 04). */
export async function fetchGoogleIdentity(client: GoogleOAuthClient): Promise<{ id: string; email: string }> {
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data } = await oauth2.userinfo.get();
  if (!data.id || !data.email) {
    throw new Error("Google didn't return an id/email in userinfo (check the userinfo.email scope)");
  }
  return { id: data.id, email: data.email };
}

export function encryptGoogleTokens(tokens: {
  accessToken: string;
  refreshToken: string;
}): { accessToken: string; refreshToken: string } {
  return {
    accessToken: encrypt(tokens.accessToken),
    refreshToken: encrypt(tokens.refreshToken),
  };
}

/**
 * Returns an OAuth2Client authenticated for the given Google CalendarAccount,
 * refreshing and persisting a new access token first if the stored one is
 * expired or close to it. Marks the account inactive and throws AppError if
 * the refresh token itself no longer works (invariant: never leak a raw
 * stack trace to the user — see tech spec §12).
 */
export async function getValidGoogleClient(account: CalendarAccount): Promise<GoogleOAuthClient> {
  if (!account.accessToken || !account.refreshToken) {
    throw new AppError({ code: "google_token_missing", userMessage: GOOGLE_TOKEN_EXPIRED_MESSAGE });
  }

  const client = createGoogleOAuthClient();
  client.setCredentials({
    access_token: decrypt(account.accessToken),
    refresh_token: decrypt(account.refreshToken),
    expiry_date: account.expiresAt?.getTime(),
  });

  const isExpired = !account.expiresAt || account.expiresAt.getTime() <= Date.now() + EXPIRY_SAFETY_MARGIN_MS;
  if (!isExpired) {
    return client;
  }

  try {
    const { credentials } = await client.refreshAccessToken();
    if (!credentials.access_token || !credentials.expiry_date) {
      throw new Error("Google didn't return a new access_token on refresh");
    }

    await prisma.calendarAccount.update({
      where: { id: account.id },
      data: {
        accessToken: encrypt(credentials.access_token),
        expiresAt: new Date(credentials.expiry_date),
      },
    });

    client.setCredentials(credentials);
    return client;
  } catch (err) {
    logger.error({ err, accountId: account.id }, "Failed to refresh Google token");
    await prisma.calendarAccount.update({ where: { id: account.id }, data: { isActive: false } });
    throw new AppError({ code: "google_token_expired", userMessage: GOOGLE_TOKEN_EXPIRED_MESSAGE, cause: err });
  }
}
