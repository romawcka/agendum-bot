import { Router } from "express";
import { prisma } from "../config/db.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", uptime: process.uptime() });
  } catch {
    res.status(503).json({ status: "db_unavailable" });
  }
});
