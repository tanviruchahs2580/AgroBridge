<!-- AgroBridge PR template — keep sections; delete what does not apply. -->

## What & why

<!-- One paragraph: the change and the problem it solves. Link the finding ID
     (AUD-###) or issue when there is one. -->

## Finding / issue

- Finding ID(s): `AUD-___` (or issue link)
- Severity / domain: <!-- e.g. S1 · Domain C (money path) -->

## Impact

<!-- Who or what is affected (farmers, money path, AI advice, CI, docs) and how. -->

## Test evidence

<!-- Exact commands run and their results (counts, not vibes). Screenshots or
     receipt paths for UI changes. A green CI run alone is not evidence that a
     user journey works. -->

- [ ] Targeted tests:
- [ ] Full suite / relevant gates:
- [ ] Manual/browser evidence (if UI):

## Migration & data risk

<!-- Schema/migration changes? Existing-data effects? Rollback path? Write
     "none" explicitly when there is none. -->

## Config / environment changes

<!-- New or changed env vars, provider settings, feature flags. -->

## Risk & rollback

<!-- What could break, blast radius, and how to revert safely. -->

## Checklist

- [ ] Behaviour change has an outcome-based regression test (or the PR says why not)
- [ ] No test was disabled/skipped/weakened without a documented reason
- [ ] No secret, credential, dump or binary added
- [ ] User-visible claims match verified behaviour (AI/weather/payments/offline)
- [ ] Docs updated where behaviour or configuration changed
