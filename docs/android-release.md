# Android Release Runbook (Capacitor)

AgroBridge ships as a Capacitor-wrapped PWA (`apps/web/android`). Web bundle = single source of truth;
native layer only adds installability, camera capture and Play Store distribution.

## 0. Prerequisites
- Node ≥ 20, JDK 21 (Temurin), Android Studio (SDK Platform 36 + Build-Tools)
- One-time: `cd apps/web && npm run build && npx cap sync android`
- Open in Android Studio: `npx cap open android` (or use CLI steps below)

## 1. Configure API endpoint
```bash
# apps/web/.env.production  (never commit real values)
VITE_API_BASE_URL=https://api.agro.example.com/api/v1
```
Then rebuild + resync:
```bash
npm run build --workspace @agrobridge/web
npx cap sync android          # copies dist/ into android/app/src/main/assets/public
```

## 2. Server-side CORS for the APK
The APK origin is `https://localhost`. Add it to `WEB_ORIGIN` on the API host:
```
WEB_ORIGIN=https://staging.agro.example.com,https://localhost
```
(Alternative: set `server.url` in `capacitor.config.ts` to your hosted site — then CORS is same-origin.)

## 3. Signing keys (one-time, keep offline backup)
```bash
keytool -genkeypair -v -keystore agrobridge-release.keystore \
  -alias agrobridge -keyalg RSA -keysize 2048 -validity 10000
```
Create `apps/web/android/key.properties` (git-ignored):
```
storeFile=../../agrobridge-release.keystore
storePassword=***
keyAlias=agrobridge
keyPassword=***
```
Never lose this keystore — Google Play updates are bound to the signing key.

## 4. Build artifacts
| Artifact | Command | Output |
|---|---|---|
| Debug APK (testing) | `./gradlew assembleDebug` | `android/app/build/outputs/apk/debug/app-debug.apk` |
| Signed AAB (Play Store) | `./gradlew bundleRelease` | `android/app/build/outputs/bundle/release/app-release.aab` |
| Direct-install APK | `./gradlew assembleRelease` | `.../apk/release/app-release.apk` |

CI builds a **debug APK artifact** automatically (`.github/workflows/ci.yml` job `android-build`).
Release/AAB builds require `key.properties` present on the build machine.

## 5. Version bumps (every release)
`apps/web/android/app/build.gradle` → `versionCode` (monotonic int: e.g. 13000, 13100) +
`versionName` ("1.3.0"). Also bump root `CHANGELOG.md`.

## 6. Install on device (adb or sideload)
```bash
adb devices
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```
Or copy the APK to the phone and enable "Install unknown apps" for the file manager.

## 7. Pre-launch checklist
- [ ] `/health` + `/ready` green on the target API over HTTPS
- [ ] Login/register works on-device; session survives app kill/restart
- [ ] Disease photo capture (camera) uploads ≤8MB and shows "pending expert review"
- [ ] Market loads offline from SW cache (stale-while-revalidate) after first visit
- [ ] Bengali + English toggle persists
- [ ] No cleartext HTTP calls (Android 9+ blocks them; `allowMixedContent=false`)
- [ ] Payment flow still labelled sandbox (until PAY-001 live creds)

## 8. Play Store submission (Phase D of roadmap)
1. Play Console account → create app `com.agrobridge.app`
2. Upload signed `.aab` to Internal testing
3. Complete: Privacy Policy URL, Data Safety (phone/photos/financial), content rating, bn+en listing + screenshots
4. Promote Internal → Closed (≥20 testers, 14 days for new personal accounts) → Production staged rollout

## 9. Signed AAB via CI (secrets-based)

`.github/workflows/android-release.yml` (manual `workflow_dispatch` trigger) builds a signed
`.aab` + release `.apk` in CI — no local Android Studio needed.

Required GitHub repo secrets (**Settings → Secrets and variables → Actions**):

| Secret | Contents |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | base64 of the release keystore (`base64 -w0 agrobridge-release.keystore.jks`) |
| `KEYSTORE_PASSWORD` | keystore password |
| `KEY_ALIAS` | key alias (e.g., `agrobridge`) |
| `KEY_PASSWORD` | key password |

One-time keystore generation (keep offline backup):

```bash
keytool -genkeypair -v -keystore agrobridge-release.keystore.jks \
  -alias agrobridge -keyalg RSA -keysize 2048 -validity 10000
```

Security notes:

- The keystore is **NEVER committed** — `.gitignore` already excludes `*.keystore.jks` /
  `key.properties`; CI decodes it from secrets into `apps/web/android/app/`.
- Keep exactly one backup in a password manager or HSM — Google Play updates are bound to
  this key forever (see §3). No copies in chats, drives or laptops.
- The workflow fails fast with a clear error if any secret is missing.
