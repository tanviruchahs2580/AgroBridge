# UAT Script — Moderated Usability Test (45 min)

Persona under test: **P1 — small-farmer**, first-time smartphone user, Bengali-first,
low-end Android device. One moderator + one note-taker per session.

## Consent note (read aloud, record yes/no before starting)

"এই পরীক্ষায় আমরা আপনার স্ক্রিন ও ভয়েস রেকর্ড করব, শুধু অ্যাপ ঠিক করার জন্য।
যেকোনো সময় বললেই বন্ধ করা যাবে; টাকা-পয়সা লাগবে না, ব্যবহারের জন্য টাকা দিতে হবে না।"
(English: session is recorded for product improvement only; participant may stop anytime;
no real payments occur — payment flows run in sandbox mode.)

## Session flow (45 min)

| Min | Activity |
|---|---|
| 0–5 | Welcome, consent, device setup, language = bn |
| 5–35 | 5 tasks (below), think-aloud; moderator stays silent until stuck >60s |
| 35–40 | Debrief: "সবচেয়ে ভালো লেগেছে? / কোথায় কষ্ট হয়েছে?" |
| 40–45 | SUS-style 5-question satisfaction sheet |

Tasks are given as goals, not instructions. Never say which button to press.

### Task list

1. **Register** with phone OTP and create a farm + one plot + one crop.
   (Budget: **≤5 min** — this is the activation KPI.)
2. **Get an advisory** for the crop (weather or AI question).
3. **Buy an input** (e.g., 1 bag urea) from the marketplace — sandbox checkout.
4. **Submit a sell offer** for a harvest.
5. **Check wallet** balance and explain what it shows in their own words.

## Observation sheet (one row per task × participant)

| Col | Meaning |
|---|---|
| PID | participant id (P1-01…) |
| Task | task number |
| Done? | unassisted / assisted (hint needed) / failed |
| Time | mm:ss from prompt to success |
| Errors | wrong taps, backtracks, re-reads |
| Confusion quotes | verbatim (bn), esp. money-related confusion |
| Confidence | 1–5 self-report after task |

## Pass criteria (tied to launch KPIs)

| KPI | Threshold |
|---|---|
| Activation (register → farm/plot/crop) | median **≤5 min**, ≥80% unassisted |
| Advisory retrieval | ≥80% complete without help |
| Purchase completion (sandbox) | ≥80% complete; zero accidental double-orders |
| Wallet comprehension | zero "কোথায় টাকা?" moments — participant locates balance & explains it unprompted |
| Overall | ≥4/5 mean confidence on money flows |

Any failure on money-flow tasks (3–5) blocks release sign-off; advisory failures do not.

## Device matrix (3 low-end Androids, BD market)

| Tier | Device | RAM | Android |
|---|---|---|---|
| Low | Symphony iTel/Walton Olvio-class or Samsung Galaxy A03 core variant | 2 GB | Go edition 13+ |
| Mid-low | Xiaomi Redmi 9A / Redmi A1 | 2–3 GB | Android 11–13 |
| Entry-Samsung | Samsung Galaxy A05s / M04 | 4 GB | Android 13–14 |

Test over **real mobile data** (not Wi-Fi) at throttled 3G if possible; include one session
with Bengali system font scaling at max.
