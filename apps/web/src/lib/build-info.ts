/**
 * Build identity for the running bundle. `version.json` is emitted into the
 * bundle root by the `agrobridge-build-stamp` plugin inlined in vite.config.ts
 * (version + git commit), so a deployed bundle — web or Android — can be traced
 * back to the exact commit that produced it. When the values are absent (dev
 * server, unit tests) they degrade to dev/unknown rather than breaking the page.
 *
 * The emitter is that inline Vite plugin, not a `scripts/stamp-build.mjs` — this
 * docblock used to name a file that does not exist anywhere in the repository.
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
