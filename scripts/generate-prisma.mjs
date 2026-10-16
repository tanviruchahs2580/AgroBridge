// Root postinstall hook: generate the Prisma client that matches the runtime target.
// - Inside Vercel builds (VERCEL=1): PostgreSQL schema with rhel engine target —
//   the serverless runtime runs Amazon Linux and talks to the dashboard DATABASE_URL.
// - Everywhere else (local dev, CI, docker-less checks): the SQLite schema used by
//   dev/test/db files.
// This replaces the previous sqlite-only postinstall, which made every Vercel build
// bundle an sqlite client and fail all DB routes with "URL must start with the
// protocol `file:`".
// NOTE: npx prisma is executed from apps/api — at the repo root the `prisma` bin
// resolves to an unrelated CLI shim that has no generate command.
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isVercel = process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
const schema = isVercel ? "prisma/postgres/schema.prisma" : "prisma/schema.prisma";

execSync(`npx prisma generate --schema ${schema}`, {
  cwd: path.join(repoRoot, "apps/api"),
  stdio: "inherit",
});
