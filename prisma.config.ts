import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { defineConfig } from "@prisma/config";
import { config as loadDotenv } from "dotenv";

loadDotenv();

export default defineConfig({
  schema: "prisma/schema.prisma",
  experimental: { adapter: true },
  engine: "js",
  adapter: async () =>
    new PrismaLibSQL({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN!,
    }),
});
