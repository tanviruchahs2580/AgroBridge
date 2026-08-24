import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Prepares a clean SQLite test database via migrations (never seed). */
export default function globalSetup() {
  const dbPath = fileURLToPath(new URL("../prisma/test.db", import.meta.url));
  for (const p of [dbPath, dbPath + "-journal"]) {
    if (existsSync(p)) rmSync(p);
  }

  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "file:./test.db";
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
  // Deterministic demo catalog (products/services/plans) required by journey tests
  execSync("npx prisma db seed", { stdio: "inherit" });
}
