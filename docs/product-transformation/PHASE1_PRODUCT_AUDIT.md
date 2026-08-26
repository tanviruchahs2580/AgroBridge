# AgroBridge — Phase 1 Product Audit (Transformation Baseline)

Per Enterprise Product Transformation Prompt v1.0 §20.1, this artifact gates all Phase 2+ coding.
Evidence base: validation cycles 08–12 (commits 4f52b70→3b7655e), CI 9/9, real-user journeys,
adversarial probes, production-image smoke, PG17 suite, backup/restore + rollback rehearsals.

## 1. Personas (validated against seeded roles)

| ID | Persona | Digital literacy | Primary jobs | Key fears |
|---|---|---|---|---|
| P1 | Small Farmer (ক্ষুদ্র কৃষক) | Low | What to do today; sell harvest safely | Losing crop/money; complexity |
| P2 | Commercial Farmer | Medium-High | Multi-plot yield/cost tracking; inputs planning | Data silos, missed risks |
| P3 | Dealer | Medium | Inventory, sales fulfilment | Stock errors, payment disputes |
| P4 | Procurement Officer | Medium | QC → PO → Collect pipeline visibility | No queue view (see GAP-P-01), fraud |
| P5 | Agronomist | High | Disease review quality, advisory trust | AI overtrust without sources |

## 2. Journey Map (Discover→Register→Onboard→First Value→Repeat→Transaction→Support→Retention)

Verified today: register(HTML5 guard)→auto-login→farm→plot→crop(auto-stage)→AI(advisory w/ 85% confidence)→market→cart→checkout→notification→sell→payout→wallet. **Break-points found:** (a) no guided onboarding after login (empty dashboard, user must discover nav); (b) SellCrop crop-codes in English (F-UX3); (c) native English validation bubbles (F-UX1); (d) manager has no offer queue (F-QA2). First-5-minute KPI: **currently ~unmet** for P1 (value exists but not surfaced decision-first).

## 3. Information Architecture — target adopted from Prompt §4

Dashboard / My Farm(Farms·Plots·Crops·Tasks·Records) / Advisory(Weather·Copilot·Disease·Alerts) / Marketplace(Products·Cart·Orders) / Services / Sell Crops(New·My Offers) / Finance(Wallet·Transactions·Membership) / Account(Profile·Notifications·Language). Mobile: bottom-nav (5 slots: Dashboard·Farm·Advisory·Market·Wallet); Desktop: sidebar. Current flat 7-item top nav migrates to this hierarchy.

## 4. Feature Gap Register (evidence-linked)

| ID | Gap | Sev | Source |
|---|---|---|---|
| GAP-P-01 | Manager procurement queue missing (list API privileged to ADMIN only) | P2 | routes.ts:87, cycle-11 |
| GAP-P-02 | Farmer Decision Dashboard absent (nav is feature-list, not job-list) | Critical | UX audit |
| GAP-P-03 | Copilot response lacks structured sections (কারণ/কেন/এখন কী করবেন/warning/source block) | High | Advisor.tsx |
| GAP-P-04 | Weather shows data, not paired action (“বৃষ্টি→spray postpone”) | High | Weather module |
| GAP-P-05 | Checkout single-step; needs Cart→Delivery→Review→Pay→Confirm with fee/discount transparency | High | Market.tsx |
| GAP-P-06 | Procurement progress stepper (✓submitted→…→wallet credited) absent | High | SellCrop.tsx |
| GAP-P-07 | Wallet lacks Pending/Month-in-out breakdown; withdraw action | Med | Wallet.tsx |
| GAP-P-08 | Notification taxonomy (Critical/Action/Info) + preferences | Med | Notifications.tsx |
| GAP-P-09 | Skeletons/sync-status/error-reference-codes (AB-XXXXX) missing | Med | global |
| GAP-P-10 | Onboarding wizard (Who→Area→Land→Crops→First farm→Dashboard) | High | post-login |
| GAP-P-11 | Product analytics events (activation/retention/funnels) not instrumented | High | none |
| GAP-P-12 | Feature-flag layer absent (FEATURE_*) | Med | config |
| GAP-P-13 | Formal org tenancy scoping on every query + RBAC matrix doc | High | v1.2 partial |
| GAP-P-14 | a11y: axe audit, focus-visible tokens, touch-target ≥44px pass needed | Med | manual-only so far |

## 5. Risk & Production Gap Registers

Technical: stale-client clobber (GAP-003 pattern) recurs between sqlite/pg profiles — mitigation: profile-aware generate script. Product: test-data leakage into demo catalog (F-QA1). Ops: soak/chaos unproven on staging HW; TLS/payment/Play Console remain external (FINAL_ENTERPRISE_VALIDATION_REPORT GO/NO-GO list). Compliance: privacy policy + data-safety required before Play launch.

## 6. KPIs

Activation = farm+plot+crop created ≤5 min post-login. Day-1 retention ≥30%. First-advisory ≤2 min. First-order ≤Day-3. Sale→wallet-credit clarity: zero support tickets on “কোথায় টাকা?”.

## 7. Prioritized Backlog (execution order, maps to Prompt §19 Top-5)

- **Sprint A (Critical):** Design-system tokens+components · Bottom-nav/sidebar shell · Decision Dashboard (GAP-P-02) · Onboarding wizard (P-10) · i18n validation layer (F-UX1) + crop label map (F-UX3)
- **Sprint B:** Copilot structured-response card (P-03) + weather-action pairing (P-04) · Checkout steps (P-05) · Procurement stepper (P-06) + manager queue API/UI (GAP-P-01)
- **Sprint C:** Wallet financial UX (P-07) · Notification taxonomy (P-08) · skeletons/errors/sync (P-09) · analytics instrumentation (P-11) + flags (P-12)
- **Sprint D (Hardening):** tenancy scoping sweep (P-13) · axe WCAG-AA pass (P-14) · perf profiles 50→10k users · staging chaos/soak · DR drill

Entry criteria met for Sprint A. Each item ships behind flags where risky; every UI change re-runs browser-E2E+a11y+mobile gates added in CI (already real since V14-002 fix).
