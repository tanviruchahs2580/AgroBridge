# E2E flake register

Failures that are not reproducible on a re-run, with the evidence and the
action taken. The suite runs with `retries: 0` deliberately (a retry that hides
a flake also hides the diagnosis), so every flake costs a run — this register
is where they are accounted for instead of being quietly re-run away.

| Date | Spec | Symptom | Evidence | Assessment / action |
|---|---|---|---|---|
| 2026-10-17 | several, CI | Later tests failed at sign-in after unrelated specs | CI run observations during AUD-134 | Root-caused: the global 300 req/15 min window was exhausted by a browser suite; CI sets `RATE_LIMIT_MAX=2000`/`LOGIN_RATE_LIMIT_MAX=500` for its throwaway instance. Documented in `docs/testing.md`. |
| 2026-10-19 | `splash-verify.spec.ts` (390/768/1280) | 30 s timeout on a 7-minute full run against a long-lived Vite dev server (repeated reloads; `[vite] connecting` loops in the browser log) | `.audit/evidence/E-V2-W1d-e2e-chromium.log` (run), re-run of the same spec passed | Not a product failure: the same spec passed in three earlier full runs that day. Kept as the first entry of this register; if it repeats, the candidate fix is to reload the splash complex against `vite preview` instead of the dev server (the production-build e2e pass added for AUD-147 does exactly that for the smoke subset). |
| 2026-10-19 (later) | `splash-verify.spec.ts` again, and firefox/webkit smoke on the Windows host | The splash's rAF-driven progress froze at 0 % (page snapshot shows the overlay at 0 %, the failure screenshot is a blank framebuffer) and Firefox reported `RenderCompositorSWGL failed mapping default framebuffer` with context-teardown timeouts. Two re-runs reproduced on this host; the same specs passed earlier the same day and no splash/auth-shell code changed between. | `.audit/evidence/E-V2-W1d-splash-retry*.log`, `E-V2-W1d-e2e-crossengine.log`; failure screenshots under `apps/web/test-results/` | Assessed as a host-graphics condition of this Windows box (frozen rAF + blank compositor + SWGL errors on two engines), not an app assertion. **CI on Linux is the authoritative environment** and runs both; if the cross-engine smoke fails there, that is real signal and gets fixed forward. Candidate hardening if this recurs on CI: launch chromium with `--disable-gpu` on Windows only, or run the splash spec against the production preview. |

Rules for this register: an entry needs a run log, a re-run result, and either a
root cause or a named next diagnostic step. A failure without a re-run result is
not a flake — it is an open defect.
