// Vercel build command for the API project — shell-agnostic (vercel runs
// buildCommand through cmd.exe on Windows agents and sh on Linux; chaining
// with ; breaks on Windows). cwd-agnostic so CLI-local builds (cwd apps/api)
// and integration builds (cwd repo root) behave identically.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

const apiDir = existsSync("apps/api/package.json") ? "apps/api" : ".";
const run = (cmd) => execSync(cmd, { cwd: apiDir, stdio: "inherit" });

run("npx tsc -p tsconfig.build.json");
// VERCEL env → scripts/generate-prisma.mjs already produced the postgres
// client during install; regenerating here keeps the client correct even
// when the postinstall hook is skipped (--ignore-scripts flows).
run("npx prisma generate --schema prisma/postgres/schema.prisma");
