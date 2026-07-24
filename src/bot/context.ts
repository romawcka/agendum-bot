import type { User } from "@prisma/client";
import type { Context as BaseContext } from "grammy";

export interface UserFlavor {
  dbUser: User;
}

export type BotContext = BaseContext & UserFlavor;
