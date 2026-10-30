// Production-configuration probe for AUTH-04: boots the API the way a
// production deployment is configured (NODE_ENV=production, explicit
// placeholder opt-in because this box has no real providers) against a fresh,
// unseeded SQLite database, so acceptance can prove that the public demo
// credentials and seed identities do not exist — and therefore cannot
// authenticate — on a production-configured service.
//
// Run:  node apps/web/e2e/prod-config-probe.mjs        (from repo root)
// Port: 4100
import { spawn, execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(here, "../../api");
const dbFile = path.join(apiDir, "prisma", "prod-probe.db");

for (const suffix of ["", "-journal"]) {
  const f = dbFile + suffix;
  if (existsSync(f)) rmSync(f, { force: true });
}

const env = {
  ...process.env,
  NODE_ENV: "production",
  PORT: "4100",
  DATABASE_URL: "file:./prod-probe.db",
  JWT_ACCESS_SECRET: "prod-probe-access-secret-0123456789abcdefg",
  JWT_REFRESH_SECRET: "prod-probe-refresh-secret-0123456789abcdefg",
  ALLOW_PLACEHOLDER_PROVIDERS: "1",
  WEB_ORIGIN: "http://127.0.0.1:5173",
};

const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: apiDir, env, stdio: "inherit", shell: process.platform === "win32" });

run("npx", ["prisma", "migrate", "deploy"]);
// Reference data seeds; demo identities are skipped in production by design.
run("npx", ["prisma", "db", "seed"]);

const child = spawn("npx", ["tsx", "src/server.ts"], { cwd: apiDir, env, stdio: "inherit", shell: process.platform === "win32" });

const shutdown = () => {
  try {
    child.kill();
  } catch {
    /* already gone */
  }
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Keep the process alive while the probe server runs.
setInterval(() => {}, 1 << 30);
