// Shared harness for the acceptance drills: spawn a dedicated API instance on
// its own port and sqlite file, wait for readiness, talk JSON, stop it.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const apiDir = path.resolve(here, "../../api");

export function freshDb(name) {
  // Unique per run: a previous instance's handle on Windows can outlive the
  // kill-tree by a moment, and an EPERM on delete must not fail the drill.
  const unique = `${name}-${Date.now()}`;
  const file = path.join(apiDir, "prisma", `${unique}.db`);
  for (const s of ["", "-journal"]) if (existsSync(file + s)) rmSync(file + s, { force: true });
  return `file:./${unique}.db`;
}

export function provision(dbUrl) {
  const env = { ...process.env, DATABASE_URL: dbUrl, NODE_ENV: "test" };
  execFileSync("npx", ["prisma", "migrate", "deploy"], { cwd: apiDir, env, stdio: "pipe", shell: process.platform === "win32" });
  execFileSync("npx", ["tsx", "prisma/seed.ts"], { cwd: apiDir, env, stdio: "pipe", shell: process.platform === "win32" });
}

export async function waitHealthy(port, timeoutMs = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return (await res.json());
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`:${port} never became healthy`);
}

export function startApi(port, dbUrl, extraEnv = {}) {
  const env = {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
    DATABASE_URL: dbUrl,
    JWT_ACCESS_SECRET: "drill-access-secret-0123456789abcdefgh",
    JWT_REFRESH_SECRET: "drill-refresh-secret-0123456789abcdefgh",
    RATE_LIMIT_MAX: "2000",
    LOGIN_RATE_LIMIT_MAX: "500",
    ...extraEnv,
  };
  const child = spawn("npx", ["tsx", "src/server.ts"], { cwd: apiDir, env, stdio: "ignore", shell: process.platform === "win32" });
  return {
    child,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", () => resolve());
        try {
          if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "pipe" });
          else child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        setTimeout(resolve, 1500);
      }),
  };
}

/** Start expecting a REFUSAL: resolves { failed: true, error } when boot dies. */
export async function expectBootRefusal(port, dbUrl, extraEnv = {}, timeoutMs = 25_000) {
  const { child, stop } = startApi(port, dbUrl, extraEnv);
  let stderr = "";
  child.stderr?.on?.("data", (d) => (stderr += String(d)));
  const t0 = Date.now();
  let refused = false;
  while (Date.now() - t0 < timeoutMs) {
    if (child.exitCode !== null) {
      refused = true;
      break;
    }
    try {
      await fetch(`http://127.0.0.1:${port}/health`);
      break; // booted — not a refusal
    } catch {
      /* still starting */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  await stop();
  return refused;
}

export async function json(method, port, pathName, { token, body } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${pathName}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, data };
}

export async function loginOn(port, phone = "01700000002", password = "Demo@1234") {
  const r = await json("POST", port, "/api/v1/auth/login", { body: { phone, password } });
  if (r.status !== 200) throw new Error(`login failed on :${port}: ${r.status}`);
  return r.data.data;
}
