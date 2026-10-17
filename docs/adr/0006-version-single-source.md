# ADR-0006 — `version.json` is the single version register; RELEASE_MANIFEST.md is historical

- Status: accepted
- Date: 2026-10-18
- Deciders: engineering; arrangement already in force, recorded by the Phase 4 quality review

## Context

The repository ships three artifacts that must never disagree about "what version is this":
the web bundle (Vercel), the Android app (Capacitor, versionName/versionCode), and the deployed
API (which serves alongside the web bundle). Before consolidation, release identity lived in
prose (a release manifest, per-round reports), and the reports drifted: `RELEASE_MANIFEST.md`
announced a "v1.5.0 (candidate)" that was never cut and numbered "v1.1.1" over a v1.1.0
baseline, while the actual shipped version was 1.4.0.

The single register is the repo-root `version.json`:

```json
{ "version": "1.4.0", "versionCode": 14000, "notes": "…" }
```

Its consumers, all reading the same file:

- **Web build** — `apps/web/vite.config.ts` reads `version` and bakes it in as
  `VITE_APP_VERSION` (surfaced by `src/lib/build-info.ts` as `BUILD_INFO`), and emits a
  `version.json` asset next to the bundle containing version + git commit + build time. A
  deployed bundle or a bundled APK asset set can therefore be traced back to the exact commit.
- **Android build** — `apps/web/android/app/build.gradle` reads `../../../version.json` for
  `versionName` and `versionCode` (CLI `-PversionCode=… -PversionName=…` still override, used by
  CI release builds).
- **Release workflow** — `.github/workflows/android-release.yml` reads both values, builds the
  signed AAB/APK, then verifies the synced Capacitor assets carry the same version (a missing
  `cap sync` would otherwise silently publish an older web bundle).
- **Deploy verification** — `.github/workflows/deploy-verify.yml` polls the deployed
  `…/version.json` for the commit hash to prove the live bundle matches the merged commit.

Rule: **bump `version` and `versionCode` together in `version.json`, then build/sync** — see
`docs/play/release-runbook.md`. `versionCode` must strictly increase on every Play upload;
`version` is the user-facing name (web bundle + Android).

`RELEASE_MANIFEST.md` (now archived at `docs/archive/2026-08-09/RELEASE_MANIFEST.md`) is
explicitly historical: it described candidates that were never released
and predates the Play Store path. Its own header says so and points at the three current sources
of release facts: `version.json` (version + versionCode), `CHANGELOG.md` (what changed per
released version), and `docs/play/release-runbook.md` (how a release is produced and verified).

## Decision

Keep `version.json` as the only place a version number is authored. Do not resurrect release
numbers in prose reports; reports may cite a version but must not define one. Keep
`docs/archive/2026-08-09/RELEASE_MANIFEST.md` only as provenance for what was believed on
2026-08-26, with its "historical" banner intact.

## Consequences

- Web bundle, Android artifacts and CI verification cannot disagree about the version without a
  failing check — the Android release workflow fails if the synced bundle version differs.
- A version bump is one file edit plus the normal release runbook; there is no manifest to
  update and no second numbering scheme.
- Anyone reading old reports must read the banner first; the ADR (this file) is the pointer that
  explains why those documents may contradict each other.
