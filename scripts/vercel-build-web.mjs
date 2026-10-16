// Vercel build command for the web project — shell-agnostic (see
// vercel-build-api.mjs). cwd-agnostic for integration builds (repo root)
// and CLI builds (apps/web).
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

const webDir = existsSync("apps/web/package.json") ? "apps/web" : ".";
execSync("npm run build", { cwd: webDir, stdio: "inherit" });
