import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const MARKER_PATH = path.join(PROJECT_ROOT, ".turso-dev-marker.json");
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const PROD_DB = "agendum-bot";
const DEV_DB = "agendum-bot-dev";

interface Marker {
  clonedAt: string;
}

function readMarker(): Marker | undefined {
  if (!existsSync(MARKER_PATH)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(MARKER_PATH, "utf-8")) as Marker;
  } catch {
    return undefined;
  }
}

function isStale(marker: Marker): boolean {
  const age = Date.now() - new Date(marker.clonedAt).getTime();
  return !Number.isFinite(age) || age > MAX_AGE_MS;
}

function writeMarker(): void {
  const marker: Marker = { clonedAt: new Date().toISOString() };
  writeFileSync(MARKER_PATH, JSON.stringify(marker, null, 2));
}

function refreshDevDb(): void {
  console.log(`[ensureDevDb] Дев-копии ${DEV_DB} больше недели — пересоздаю из ${PROD_DB}...`);
  execFileSync("turso", ["db", "destroy", DEV_DB, "--yes"], { stdio: "inherit" });
  execFileSync("turso", ["db", "create", DEV_DB, "--from-db", PROD_DB], { stdio: "inherit" });
  console.log(
    "[ensureDevDb] Готово. Если dev-сервер не сможет подключиться — Turso мог инвалидировать " +
      `старый токен при пересоздании; перевыпусти его командой "turso db tokens create ${DEV_DB}" ` +
      "и обнови TURSO_AUTH_TOKEN в .env.",
  );
}

function main(): void {
  const marker = readMarker();

  if (marker === undefined) {
    // Первый запуск: дев-БД предполагается только что созданной вручную по
    // README (turso db create agendum-bot-dev --from-db agendum-bot) — просто
    // начинаем отсчёт свежести отсюда, не пересоздаём то, что и так новое.
    writeMarker();
    return;
  }

  if (!isStale(marker)) {
    return;
  }

  try {
    refreshDevDb();
    writeMarker();
  } catch (err) {
    console.warn(
      "[ensureDevDb] Не удалось обновить дев-копию БД (нет turso CLI, не залогинен, или нет сети) " +
        "— продолжаю со старой копией.",
      err instanceof Error ? err.message : err,
    );
  }
}

main();
