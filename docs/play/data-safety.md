# Play Console — Data safety answers

Derived from what the code actually does, file by file, at the commit that added this
document. Play's Data safety form is a declaration of fact; an answer that disagrees with
the app's behaviour is a policy violation, so this file is the evidence trail for each
answer. If the app starts or stops collecting something, change the code, this table, the
published policy (`apps/web/src/features/legal/content.ts`) and the Console form together.

## Where each data type is actually handled

| Data type | Where it is collected | Left unchecked because |
|---|---|---|
| Name | `POST /auth/register`, `PATCH /auth/me` (`apps/api/src/modules/auth/routes.ts`) | — |
| Phone | Registration and login; OTP verification | — |
| Email (optional) | `PATCH /auth/me` — never required | — |
| Address (district/upazila/address) | `PATCH /auth/me` → `FarmerProfile`; used to localise weather | — |
| Account/User ID | Server-generated `cuid`; shown in Settings as a partial id | — |
| Purchase history | `Order`, `Payment`, `Booking`, `ProcurementOrder` models | — |
| Other financial info | `Wallet` balance + `WalletTransaction` ledger, withdrawals | — |
| Photos | `POST /disease/cases` (multipart, ≤8 MB, image MIME allowlist) | — |
| In-app messages | `POST /ai/advisory` question text (`AdvisoryQuery`) | — |
| App interactions | `POST /analytics/events` (first-party, ≤20 events per batch) | — |
| Location (approximate/precise) | **not collected** | The app never calls `navigator.geolocation`; weather uses the district the farmer typed (`apps/web/src/lib/geo.ts`). No location permission is declared in `AndroidManifest.xml`. |
| Device or other IDs | **not collected** | No advertising ID, no device-identifier API, no crash-reporting SDK is installed (`apps/web/src/lib/analytics.ts` sends only event name + props). |
| Contacts, SMS/MMS, call logs | **not collected** | Nothing in the app reads them. |
| Calendar, audio, video, files | **not collected** | Only photos chosen through the file picker are uploaded. |
| Health and fitness | **not collected** | — |
| Web browsing history | **not collected** | — |

## Console answers

### Data collection and security

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** — the API is HTTPS-only; the Android release build refuses cleartext (`res/xml/network_security_config.xml`) |
| Do you provide a way for users to request that their data be deleted? | **Yes** — in-app (Settings → Account → Delete account) and at `https://<domain>/account-deletion` |

### Data types (Collected / Shared, purpose)

| Category → Type | Collected | Shared | Required or optional | Purposes |
|---|---|---|---|---|
| Personal info → Name | Yes | No | Required | App functionality; Account management |
| Personal info → Phone number | Yes | **Yes** | Required | App functionality; Account management. Shared with the SMS provider solely to deliver the verification code (named in the policy). |
| Personal info → Email address | Yes | No | Optional | Account management |
| Personal info → Address | Yes | No | Optional | App functionality (localising weather advice and delivery) |
| Personal info → User IDs | Yes | No | Required | App functionality; Account management |
| Financial info → Purchase history | Yes | No | Required | App functionality (orders, bookings, procurement, membership) |
| Financial info → Other financial info | Yes | No | Required | App functionality (wallet balance and ledger) |
| Photos and videos → Photos | Yes | **Yes** | Optional | App functionality. Only photos the user attaches for disease review; stored by our cloud storage provider and read by the reviewer role. |
| Messages → Other in-app messages | Yes | **Yes** (only when a third-party AI provider is configured) | Optional | App functionality. The question text is sent to the configured OpenAI-compatible provider to generate the answer; with the built-in offline engine nothing leaves our servers. |
| App activity → App interactions | Yes | No | Required | Analytics (first-party, aggregate product metrics) |

Device or other IDs: **not collected**.

### Financial features declaration

Declare financial features **only if the deployment has a live payment gateway**
(`PAYMENT_PROVIDER=sslcommerz` with merchant credentials). With the default sandbox
configuration the app collects no money, so declaring payments would be wrong — and
`POST /payments/intent` refuses to simulate a payment in production unless
`ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION=1` is explicitly set for a demo. This matters: an app
that reports "payment successful" without collecting money is a deceptive-behaviour
finding, not a configuration detail.

### Notices and consent the code enforces

- Account deletion is blocked while an order is in progress or a withdrawal is pending, and
  the API explains why (`DELETE /auth/me`); the retention of financial records is stated in
  the policy and on the deletion page.
- Phone verification is required before withdrawing money, and the settings screen
  implements it.
- The app declares **no** sensitive Android permission (only `INTERNET`), which keeps the
  form short and honest: no camera, no location, no contacts declaration is needed.
