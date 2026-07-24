import type { ConversationData, VersionedStateStorage } from "@grammyjs/conversations";
import { prisma } from "../config/db.js";
import { env } from "../config/env.js";

/**
 * Persists @grammyjs/conversations state on WizardSession, keyed by our
 * internal User.id (see getStorageKey in bot.ts). Backs invariant 7: wizard
 * state survives process restarts and expires after WIZARD_TTL_MINUTES.
 */
export const wizardStorage: VersionedStateStorage<string, ConversationData> = {
  async read(key) {
    const userId = Number(key);
    const session = await prisma.wizardSession.findUnique({ where: { userId } });
    if (!session) {
      return undefined;
    }
    if (session.expiresAt.getTime() < Date.now()) {
      await prisma.wizardSession.delete({ where: { userId } }).catch(() => undefined);
      return undefined;
    }
    return JSON.parse(session.state);
  },

  async write(key, state) {
    const userId = Number(key);
    const expiresAt = new Date(Date.now() + env.WIZARD_TTL_MINUTES * 60_000);
    const serialized = JSON.stringify(state);
    await prisma.wizardSession.upsert({
      where: { userId },
      update: { state: serialized, expiresAt },
      create: { userId, state: serialized, expiresAt },
    });
  },

  async delete(key) {
    const userId = Number(key);
    await prisma.wizardSession.delete({ where: { userId } }).catch(() => undefined);
  },
};
