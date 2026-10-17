# Reviewer access — Play Console "App access" instructions

Google Play review cannot get past the login screen unless valid credentials are supplied,
and a reviewer with no Bangladeshi SIM cannot self-register (registration requires a
`01[3-9]XXXXXXXX` number). Paste the block below into **Play Console → App content → App
access → All functionality is available without special access? No → Add instructions**.

Create the account first with:

```bash
# against production (needs the API base URL of the live deployment)
node scripts/play/create-reviewer-account.mjs --api https://<api-domain>/api/v1 --phone 01700000099 --password '<strong-password>'
```

The script is idempotent: it registers the account if absent, resets the password if it
already exists, sets the role to FARMER and status ACTIVE, seeds a farm + plot + one active
crop cycle, credits a little wallet balance, and prints the credentials. Phone verification
is deliberately **not** pre-verified — verify it with the same script's `--verify-phone`
flag only if you want reviewers to test withdrawals (the code is written to the API log when
`SMS_PROVIDER=sandbox`).

---

## Paste-ready instructions for the Play Console

```
The app requires a login for its main functionality (farm records, advisory, marketplace,
wallet). Please use this reviewer account:

Phone:    <REVIEWER_PHONE>
Password: <REVIEWER_PASSWORD>

Steps:
1. Open the app. The login screen appears.
2. Enter the phone number and password above and tap "লগইন" (Login).
3. Use the bottom navigation to move between the screens:
   হোম (Home), আমার ফার্ম (My Farm), এআই কৃষি সহকারী (AI Agro Agent),
   বাজার (Market), ওয়ালেট (Wallet), আমার অর্ডার (My Orders).
4. Home shows weather advisories, today's crop-care tasks and a farm summary.
5. All screens are available in Bangla and English — the "EN / বাং" button in the header
   switches language.

Notes for testing:
- No payment is required. Checkout creates an order; whether a payment step is offered
  depends on the deployment's payment configuration, and the app states clearly when no
  payment gateway is configured.
- Withdrawing money requires a verified phone number (anti-fraud). That flow is optional
  for review; everything else works without it.
- The app requires an internet connection for its data. If the connection drops, screens
  show an offline banner and queued changes sync when the network returns.
- Account deletion is available: header gear icon → Settings → Account → "Delete account".
  Please do not delete this reviewer account; it is shared with other reviewers.
```

---

## Owner checklist before submitting

- [ ] `scripts/play/create-reviewer-account.mjs` run against the production API with a
      strong, unique password (never the seeded `Demo@1234`).
- [ ] The credentials in the Console match reality — sign in through the app once to check.
- [ ] If the review build's API has `ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION=1`, say so in the
      instructions and label the screenshot accordingly; otherwise say payment is not
      configured. Do not leave a reviewer guessing why checkout does not charge.
- [ ] Provide the demo phone number in the "App access" form only — not in the store listing.
