# Google Play listing copy — AgroBridge

Every field below is paste-ready. Character limits are enforced by the Play Console;
the counts in the headings were verified against the text in this file.

- **App name (max 30):** `AgroBridge — কৃষকের সঙ্গী`
- **Category:** Business (alternate: Productivity) · **Type:** App · **Price:** Free
- **Contains ads:** No · **In-app purchases:** No

> Keep the listing honest: do not claim trained disease diagnosis, guaranteed yields,
> or completed payments. The app queues disease photos for review, gives
> knowledge-base advisory, and only moves money when a gateway is configured.

---

## Short description (max 80 characters)

**Bengali (67 characters):**

```
AI ফসল পরামর্শ, আবহাওয়া সতর্কতা, বাজার ও কৃষি সেবা — সব এক অ্যাপে।
```

**English (68 characters):**

```
AI crop advice, weather alerts, market and farm services in one app.
```

---

## Full description (max 4000 characters)

### Bengali

```
এগ্রোব্রিজ (AgroBridge) — কৃষকের ডিজিটাল সঙ্গী।

আপনার জমি, ফসল আর দৈনন্দিন কৃষিকাজের সিদ্ধান্ত সহজ করতে এক জায়গায়:

• এআই কৃষি সহকারী — ফসলের নাম লিখে বা ছবি দিয়ে বাংলায় পরামর্শ নিন। প্রশ্নের উত্তর আসে কৃষি জ্ঞানের ভিত্তিতে; আত্মবিশ্বাস কম হলে অ্যাপ নিজেই সেটি জানিয়ে দেয় এবং বিশেষজ্ঞের সাথে মিলিয়ে নিতে বলে।
• আবহাওয়ার সতর্কতা — আপনার জেলা অনুযায়ী স্প্রে, বৃষ্টি, তাপ ও রোগের ঝুঁকির পরামর্শ।
• আমার ফার্ম — খামার, প্লট ও ফসলের রেকর্ড; বীজ থেকে ফসল তোলা পর্যন্ত ধাপে ধাপে কাজের সময়সূচি।
• রোগ পর্যালোচনা — আক্রান্ত গাছের ছবি পাঠান; বিশেষজ্ঞ পর্যালোচনার জন্য জমা হয়।
• বাজার — সার, বীজ, কীটনাশক ও যন্ত্রপাতি এক জায়গায়; স্টক ও দাম দেখে কার্টে যোগ করুন।
• ফসল বিক্রি — আপনার ফসলের অফার পাঠান; গ্রেড ও আর্দ্রতা অনুযায়ী দামের হিসাব দেখা যাবে।
• কৃষি সেবা — ড্রোন স্প্রে, ট্রাক্টর, হারভেস্টার বা কৃষিবিদ বুক করুন।
• ওয়ালেট — বিক্রয়ের অর্থ, খরচ ও উত্তোলনের হিসাব এক জায়গায়।
• বাংলা ও ইংরেজি — পুরো অ্যাপ দুই ভাষায়।
• ইন্টারনেট দুর্বল থাকলেও কাজ চলে — অফলাইনে জমা করা তথ্য নেট ফিরলে স্বয়ংক্রিয়ভাবে সিঙ্ক হয়।

স্বচ্ছতা: আমাদের লক্ষ্য সঠিক তথ্য দেওয়া, তাই কোনো তথ্য নিশ্চিত না হলে সেটি স্পষ্টভাবে বলা হয়। আবহাওয়া ও এআই পরামর্শ সহায়ক — চূড়ান্ত সিদ্ধান্ত কৃষকের।

অ্যাকাউন্ট মুছে ফেলার সুবিধা অ্যাপের সেটিংসে রয়েছে।

AgroBridge — Green Soil. Smart Farm. Secure Future.
```

### English

```
AgroBridge — the digital companion for farmers.

Everything you need to decide for your land, crops and daily farm work, in one app:

• AI Agro Agent — ask in Bangla, by typing a crop name or sending a photo. Answers are grounded in agricultural knowledge, and when confidence is low the app says so and tells you to confirm with an expert.
• Weather advisories for your district — spray, rain, heat-stress and fungal-risk warnings.
• My Farm — farms, plots and crop records, with a stage-by-stage task calendar from sowing to harvest.
• Disease review — send a photo of an affected plant; it is queued for expert review.
• Marketplace — fertiliser, seed, crop protection and equipment in one place; check stock and price, then add to your cart.
• Sell your harvest — submit an offer and see the price worked out from grade and moisture.
• Farm services — book drone spraying, a tractor, a harvester or an agronomist.
• Wallet — sale proceeds, spending and withdrawals with a full ledger.
• Bangla and English — the whole app in both languages.
• Works on a weak connection — anything saved offline syncs automatically when the network returns.

Straight talking: our goal is accurate information, so when something cannot be confirmed the app says so plainly. Weather and AI advice are decision support — the final call is the farmer's.

Account deletion is available in the app's settings.

AgroBridge — Green Soil. Smart Farm. Secure Future.
```

---

## Play Console: other required text fields

| Field | Value |
|---|---|
| App access (reviewer instructions) | See `docs/play/reviewer-access.md` — the build requires a login, so reviewers must be given working credentials. |
| Privacy policy URL | `https://<your-domain>/privacy` (served by the SPA; see `docs/play/release-runbook.md` step 6) |
| Data deletion URL | `https://<your-domain>/account-deletion` |
| Terms of service URL | `https://<your-domain>/terms` |
| Support email | The monitored address set in `apps/web/src/features/legal/content.ts` (`LEGAL_ENTITY.email`) |
| Support website | `https://<your-domain>` |
| Content rating questionnaire | Answers: no violence, no sexuality, no profanity, no gambling, no user-to-user content sharing (listings are platform-moderated), no location sharing. Expected outcome: 3+ / Everyone. |
| Government app declaration | No |
| Financial features | Declare **"Payments" only if a live payment gateway is configured**. With no gateway the app takes no payment, so declare none — see the caution in `docs/play/data-safety.md`. |
| Target audience | 18+ (the policy and terms state this) |
| News app | No |
| COVID-19 contact tracing | No |
| Photo/video permission declarations | Not applicable — the app declares no sensitive permission (see `docs/play/data-safety.md`) |

## Store listing assets (in `play/`)

| Asset | Requirement | File |
|---|---|---|
| App icon | 512×512, 32-bit PNG, no alpha | `play/icon-512.png` |
| Feature graphic | 1024×500 PNG/JPEG, no alpha | `play/feature-graphic-1024x500.png` |
| Phone screenshots | 2–8 images, 16:9–9:16, min 320px | `play/screenshots/phone-*.jpg` (1080×1920) |
| Tablet screenshots | Optional | not provided — the layout is responsive but untested on tablets |

Regenerate the graphics from the repository's own brand art with
`python scripts/play/generate-play-assets.py`; regenerate screenshots with
`node scripts/play/capture-screenshots.mjs` (requires the local stack running).
