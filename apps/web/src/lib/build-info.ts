/**
 * Build identity for the running bundle. `version.json` is written into the
 * web root by scripts/stamp-build.mjs at build time (version + git commit), so
 * a deployed bundle — web or Android — can be traced back to the exact commit
 * that produced it. When the file is absent (dev server, unit tests) the
 * values degrade to dev/unknown rather than breaking the page.
 */
export interface BuildInfo {
  version: string;
  commit: string;
  builtAt: string;
  apiBase: string;
}

export const BUILD_INFO: BuildInfo = {
  version: import.meta.env?.VITE_APP_VERSION ?? "dev",
  commit: import.meta.env?.VITE_GIT_COMMIT ?? "unknown",
  builtAt: import.meta.env?.VITE_BUILD_TIME ?? "",
  apiBase: import.meta.env?.VITE_API_BASE_URL ?? "",
};
