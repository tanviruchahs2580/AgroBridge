# Postmortem template and status communication (bn/en)

Use for any SEV-1/SEV-2 incident (production offline, money path wrong, data
loss, auth bypass). Blameless: the question is which control failed, not who.

## Postmortem (fill within 72 hours)

| Field | Content |
|---|---|
| Incident id / date | |
| Severity (S1–S4 per the risk register) | |
| Detected by (alert name / user report / probe) | |
| Time to detect / to mitigate / to resolve | |
| Impact (users, money, data; be specific) | |
| Root cause (one paragraph; name the control that should have caught it) | |
| What went well | |
| What made it worse | |
| Action items (each: owner, date, linked finding id) | |
| Detection gap → new alert or test | |

## First response checklist

1. Make the symptom visible: capture the failing request id (`X-Request-Id`) and the
   affected surface (`/ready`, deploy-verify run, alert name).
2. Stop the bleed with the smallest reversible action: roll back the deployment
   (`docs/deployment.md` rollback note) or take the feature behind its env flag off.
3. Preserve evidence: logs by request id, the deploy's commit SHA, `/ready` output.
4. Communicate on the cadence below.

## Status communication templates

**bn (গুরুত্বপূর্ণ আপডেট)** — “আমরা একটি সমস্যা চিহ্নিত করেছি ({service})। প্রভাব: {impact}। সমাধানের জন্য কাজ চলছে; পরবর্তী আপডেট {time}। আপনার তথ্য সুরক্ষিত আছে কিনা তা যাচাই করছি।”

**en — investigating:** "We are aware of an issue affecting {service}. Impact: {impact}. We are working on it and will update by {time}."

**en — mitigated:** "The issue affecting {service} is mitigated as of {time}. Impact window: {from}–{to}. A follow-up note with what we changed will follow."

**en — resolved:** "Resolved at {time}. Root cause: {one line}. We added {control} so this class of failure alerts and fails safely next time."

Never during an incident: share customer data in the channel, promise a cause
before it is known, or edit the incident record to look better afterwards.
