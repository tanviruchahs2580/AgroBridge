# Legal & compliance checklist

What the code provably does, and which decisions remain with the operator and counsel. This file
contains **no legal conclusions** — where a question needs a lawyer's answer it is written as a
question and labelled **[COUNSEL]**. Nothing here is legal advice.

Companion documents: `docs/data-protection.md` (retention schedule), `docs/adr/0011-data-retention.md`
(the deletion decision), `docs/retention-and-logs.md` (log/data retention mechanics), the runtime
policies in `apps/web/src/features/legal/content.ts`, and the owner-action notes in the root
`PRIVACY_POLICY.md` / `TERMS_OF_SERVICE.md`.

## 1. Consent capture — status as implemented (re-verified 2026-10-28)

| Question | Answer | Evidence |
|---|---|---|
| Is there a consent field on registration in the API? | **Yes.** `registerSchema` requires `consent: z.literal(true)`; a body without it is refused, and the accepted policy version is written as an append-only `CONSENT_CAPTURED` audit row | `apps/api/src/modules/auth/routes.ts:147-161`, `:223` |
| Is there a consent checkbox in the web registration form? | **Yes.** `#consent` gates submit and shows a field error when unchecked; the form posts `consent: true` | `apps/web/src/features/auth/Register.tsx:43-54`, `:163-177` |
| Does any other screen capture consent? | The registration checkbox is the only capture point; no separate consent step exists at photo upload | search over `apps/api/src` and `apps/web/src`, 2026-10-28 |
| How is acceptance expressed beyond registration? | By continued use — the runtime terms say continuing to use the service after a change means acceptance | `apps/web/src/features/legal/content.ts:362-364` |
| Is photo upload gated by an explicit consent action? | No separate consent step exists; the privacy policy describes uploaded photos under the "Consent" lawful basis | `apps/web/src/features/legal/content.ts:143-146`; `docs/play/data-safety.md:69-76` |

**[COUNSEL]** Registration now captures consent against a published policy version. Remaining
question for counsel: whether a notice or capture is also required at the photo-upload step, where
the policy currently relies on the "Consent" lawful basis.

## 2. Data subject routes — implemented and tested

| Capability | Endpoint / surface | Evidence |
|---|---|---|
| Data export (JSON attachment of the caller's rows only) | `GET /api/v1/auth/me/export`; rate-limited; audit event `USER_DATA_EXPORTED`; `Cache-Control: no-store` | `apps/api/src/modules/auth/routes.ts:67-76`, `:304-323`; scoping/redaction in `apps/api/src/modules/auth/dataExport.ts` |
| Account deletion (in-app) | `DELETE /api/v1/auth/me` — blocks while an order is in progress or a withdrawal is PENDING/APPROVED; checks run inside the same transaction as the mutation | `apps/api/src/modules/auth/routes.ts:520-542` |
| What deletion does | revokes refresh tokens; deletes OTP challenges; clears address-like profile fields (`address`, `district`, `upazila`, `nidLast4`); anonymizes the user row (`Deleted User`, `DEL-<id>`, random hash, DISABLED) | `apps/api/src/modules/auth/routes.ts:544-565` |
| Photo purge on deletion | best-effort per file after commit; failures are logged, counted, and returned honestly as `pendingPurge`, then retried by script | `apps/api/src/modules/auth/routes.ts:567-585`; `apps/api/scripts/purge-uploads.ts` |
| Audit trail for deletion | `ACCOUNT_DELETED` audit event | `apps/api/src/modules/auth/routes.ts:581` |
| Public deletion page (for users who cannot sign in) | `/account-deletion` served by the SPA; Play requires an in-app path and an external web resource | `apps/web/src/App.tsx` legal routes; `docs/play/store-readiness-checklist.md:57-79` |
| Play data-deletion requirements | both paths exist and are recorded with the official source | `docs/play/store-readiness-checklist.md` §3 |

Note for accuracy: `docs/adr/0011-data-retention.md` §5 lists "does not clear profile
address/location fields" and "offers no data-export endpoint" as known gaps — the code has since
implemented both (see the table above). The ADR text is older than the code; treat this table and
the code as current. (ADR edits are owned elsewhere.)

## 3. Retention and lawful basis — facts, then questions

Retention facts (detail and mechanisms in `docs/retention-and-logs.md`; source table in
`docs/data-protection.md:14-26`):

- Account/profile data: account lifetime; anonymized at deletion.
- Refresh tokens: 7-day TTL by default (`apps/api/src/config/env.ts:25`), rotated and revoked.
- OTP challenges: 5-minute TTL or consumed (`apps/api/src/modules/auth/routes.ts:354`); deleted at
  account deletion.
- Crop/disease photos: purged at deletion (best-effort + retry queue).
- Disease-case metadata rows: retained without file bytes after deletion.
- Financial/ledger rows: **5 years**, retained, never edited (compensating entries only —
  `docs/adr/0011-data-retention.md:43-45`).
- Logs: operator-configured (suggest 30 days in the source table); backups: 30 days.
- Runtime policy statements: privacy policy §5 (retention) and the deletion page
  (`apps/web/src/features/legal/content.ts:158-172`, `:419-434`); terms state the wallet is not a
  bank account (`content.ts:320-334`).

**[COUNSEL] Questions — no answers are asserted here:**

1. **Lawful basis.** Are "contract + legitimate interests + legal obligation" sufficient for
   phone/name/address processing under applicable Bangladeshi law, or does anything require
   explicit consent (and if so, what capture mechanism)?
2. **Financial retention period.** The policies state **5 years** for financial records. Verify
   the period and its source (tax/bookkeeping/company law as applicable to the operator's
   registration type) before submission; if the correct period differs, the policy, the deletion
   page and this file must change together.
3. **Consent wording** for photos and optional details, given no capture step exists today (see §1).
4. **Controller identity and registration.** Does the operator (as registered) need to be named a
   data controller in a specific form, and does any registration/notification obligation apply?
5. **Cross-border processing.** Hosting, database and optional AI/weather/SMS providers may
   process data outside Bangladesh. What must the policy and contracts say, and is any safeguard
   or notice required?
6. **Deletion semantics.** Deletion anonymizes identity but retains financial rows and backup
   copies up to 30 days. Is that an acceptable "deletion" as described to users and for Play's
   account-deletion requirement?
7. **Age gate.** The terms and policy say 18+ and rely on self-declaration. Is a stronger gate
   required for this product/category?
8. **Grievance/complaint handling.** Is a named grievance contact/channel or a response-time
   obligation required, and does the current support address satisfy it?
9. **Wallet characterisation.** The terms say the wallet is "platform store credit, not a bank
   account". Does issuing/operating the wallet and payouts require any payment-system
   authorization or partner arrangement?
10. **App-store declarations vs law.** The data-safety answers are derived from code
    (`docs/play/data-safety.md`); confirm nothing in the local-law analysis contradicts the
    published policy wording before submission.

## 4. Applicable Bangladeshi law — verify from official sources

**Verification status on 2026-10-19:** the official laws portal
(`https://bdlaws.minlaw.gov.bd/`, Ministry of Law, Justice and Parliamentary Affairs — Laws of
Bangladesh) was queried on 2026-10-19: its search returned no result for the cyber-security act,
and a direct act fetch timed out. **No statute was verifiable from an official source today**, so
titles are recorded as *to be confirmed by counsel* rather than guessed:

| Area this product touches | What to verify from official sources | Status |
|---|---|---|
| Cybercrime / platform liability (the Digital Security Act 2018 and its reported successor, commonly referred to as the Cyber Security Act 2023) | exact title, act number, current status and duties for a platform operator | **title to be confirmed by counsel** |
| Consumer protection (marketplace, refunds, misleading claims) | the operative consumer-protection act and any e-commerce specific rules | **title to be confirmed by counsel** |
| Digital commerce (marketplace/listing obligations for a platform intermediary) | the operative digital-commerce guidelines/policy and any registration duty | **title to be confirmed by counsel** |
| Tax / bookkeeping record retention (basis for the 5-year financial retention claim) | the retention period and its statutory source | **title to be confirmed by counsel**; the policy's 5-year figure is not independently verified |
| Telecommunications / SMS sender obligations (OTP delivery, sender IDs) | obligations on senders and on contracting with a licensed gateway | **title to be confirmed by counsel** |
| Payment systems / wallet and payouts (if live payments or payouts operate) | licensing or partner requirements for wallet credit and payouts | **title to be confirmed by counsel** |
| Data protection / privacy (if any act or rules apply to this operator) | whether a data-protection statute or rules are in force, and its duties | **title to be confirmed by counsel** |

Counsel should work from the official portal above; when the citations are confirmed, replace the
"to be confirmed" cells here and update the runtime policy text in
`apps/web/src/features/legal/content.ts` in the same change.

## 5. Current compliance posture at a glance

| Play/legal requirement | State | Evidence |
|---|---|---|
| Privacy policy URL | Runtime page exists at `/privacy`; root copies carry owner-action entity placeholders | `apps/web/src/features/legal/content.ts`; `PRIVACY_POLICY.md`; `TERMS_OF_SERVICE.md` |
| Account deletion (in-app + web) | Implemented | `apps/api/src/modules/auth/routes.ts:520`; `apps/web/src/App.tsx` legal routes |
| Data export | Implemented | `apps/api/src/modules/auth/routes.ts:304-323` |
| Data safety form answers traced to code | Maintained | `docs/play/data-safety.md` |
| Content rating | Not completed (Console-side) | `docs/play/store-readiness-checklist.md` §4 |
| Entity details (legal name, address) | **Placeholder — owner action before store submission** | `apps/web/src/features/legal/content.ts:16-27` (`LEGAL_ENTITY`); root policy files |
| Consent capture | Absent — see §1 | `apps/api/src/modules/auth/routes.ts:124-130`; `apps/web/src/features/auth/Register.tsx` |
| Counsel review of policies and lawful basis | Pending — the questions above | this file, §3 |
