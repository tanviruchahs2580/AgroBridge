# গোপনীয়তা নীতি / Privacy Policy

**সংস্করণ / Version:** 1.1 · **সর্বশেষ হালনাগাদ / Last updated:** 2026-11-10

> **This file is a mirror, not the source.** The app serves the privacy policy at `/privacy` on the
> deployed domain, and that page is what Google Play links to. The authoritative, single-source text
> lives in `apps/web/src/features/legal/content.ts`; this markdown file must be reconciled with it in
> the same change that edits it. The two documents had drifted apart (analytics wording, the
> weather/AI providers, the retention rows, the hosting region) — the drift and its remediation are
> recorded as F-10/F-11 in `docs/audit/2026-11-10-full-qa-audit.md`.
>
> **Operator-entity placeholders in this file are not real details:** where it says "operator entity",
> the registered legal name and address are to be completed by the owner before store submission —
> set them in `LEGAL_ENTITY` in `apps/web/src/features/legal/content.ts` (the runtime pages render
> from that file).
>
> **2026-11-10 corrections:** the hosting row now states the verified truth — API functions and the
> primary database execute in the **United States (US East, `iad1`)**, not "Bangladesh/Singapore" —
> and an explicit cross-border-transfer clause has been added (§6). The "no identifying data"
> analytics claim was removed; the weather/AI providers and the 180-day retention row were aligned
> with the shipped behaviour; the crash-monitoring purpose claim was removed (no crash-reporting sink
> exists — `AGENTS.md` §14). Earlier corrections in 1.1: login is by mobile number **and password** (a
> verification code only verifies the phone number later, e.g. before a withdrawal); the app does
> **not** use a crash-reporting SDK and does **not** read device identifiers; the app does **not**
> request device location.

---

## বাংলা

### ১. আমরা কে

[operator entity — to be completed by the owner before store submission] ("আমরা") বাংলাদেশের কৃষকদের জন্য AgroBridge মোবাইল অ্যাপ ও ওয়েবসাইট পরিচালনা করে। এই নীতিতে বলা হয়েছে আমরা কী তথ্য রাখি, কেন রাখি, কত দিন রাখি এবং আপনি কীভাবে তা দেখতে, শুধরাতে বা মুছতে পারেন।

**তথ্য নিয়ন্ত্রক (Data Controller):** [operator entity — to be completed by the owner before store submission], [নিবন্ধিত ঠিকানা — স্টোর সাবমিশনের আগে মালিক পূরণ করবেন], বাংলাদেশ। যোগাযোগ: [ইমেইল — স্টোর সাবমিশনের আগে মালিক পূরণ করবেন]।

সহজ ভাষায় লেখা হয়েছে। কোনো কথা বুঝতে সমস্যা হলে আমাদের সাপোর্টে ফোন করুন।

### ২. আমরা কী তথ্য রাখি

- মোবাইল নম্বর — অ্যাকাউন্ট তৈরি, লগইন ও ফোন যাচাইয়ের কোড পাঠাতে।
- নাম ও (ঐচ্ছিক) ইমেইল — অ্যাকাউন্ট, অর্ডার ও যোগাযোগের জন্য। ইমেইল দিতে বাধ্য নন।
- জেলা/উপজেলা ও ঠিকানা — খামারের তথ্য এবং আপনার এলাকার আবহাওয়া-ভিত্তিক পরামর্শের জন্য।
- খামার, প্লট ও ফসলের রেকর্ড — ফসলের পর্যায়, কাজের সময়সূচি ও ডিজিটাল খামার রেকর্ড।
- আপনি যে ছবি পাঠান — ফসলের রোগ পর্যালোচনার জন্য। আমরা আপনার গ্যালারির অন্য ছবি পড়ি না।
- অর্ডার, পেমেন্ট, ওয়ালেট ও উত্তোলনের হিসাব — লেনদেন সম্পন্ন করতে ও হিসাব রাখতে।
- AI সহকারীকে আপনার পাঠানো প্রশ্ন — পরামর্শ দিতে ও সেবার মান মাপতে।
- সেবা ব্যবহারের সাধারণ ইভেন্ট (কোন পাতা খুলেছেন) ও প্রযুক্তিগত লগ (রিকোয়েস্ট আইডি, ত্রুটির কোড) — অ্যাপ ঠিক রাখতে ও জালিয়াতি ঠেকাতে। এই ইভেন্টগুলো আমাদের নিজের সার্ভারে থাকে, বিজ্ঞাপনদাতার কাছে যায় না।

আমরা আপনার কন্টাক্ট লিস্ট, SMS বা অন্য অ্যাপের তথ্য পড়ি না। অ্যাপ আপনার অবস্থানের অনুমতি চায় না — আবহাওয়া আপনার দেওয়া জেলা/উপজেলা অনুযায়ী দেখানো হয়।

### ৩. কেন রাখি

- অ্যাকাউন্ট তৈরি করা ও লগইন করানো (মোবাইল নম্বর ও পাসওয়ার্ড; ফোন যাচাইয়ের জন্য কোড)।
- আপনার ফসলের জন্য পরামর্শ দেওয়া: আবহাওয়ার সতর্কতা, AI পরামর্শ, রোগ পর্যালোচনা।
- বাজার ও সেবা: পণ্য কেনা, ফসল বিক্রির অফার, যন্ত্রপাতি/কৃষিবিদ বুকিং।
- পেমেন্ট ও ওয়ালেট: লেনদেন সম্পন্ন করা এবং হিসাব রাখা।
- সেবা সুরক্ষা: জালিয়াতি, অপব্যবহার ও হিসাবের ভুল ধরতে এবং আইনগত দায় পূরণ করতে।

### ৪. আইনি ভিত্তি

- **চুক্তি** — আপনার অ্যাকাউন্ট, অর্ডার, বুকিং ও পেমেন্ট পরিচালনা করা।
- **সম্মতি** — আপনি যে ছবি পাঠান এবং যেসব ঐচ্ছিক তথ্য দেন।
- **বৈধ স্বার্থ** — জালিয়াতি ও অপব্যবহার ঠেকানো এবং সেবা নিরাপদ রাখা।
- **আইনগত বাধ্যবাধকতা** — আর্থিক রেকর্ড সংরক্ষণ।

### ৫. কত দিন রাখি

- অ্যাকাউন্ট ও সাধারণ তথ্য — আপনার অ্যাকাউন্ট চালু থাকা পর্যন্ত।
- অ্যাকাউন্ট মুছে ফেললে — আপনার নাম, ফোন, ইমেইল ও পাসওয়ার্ড সাথে সাথে মুছে যায়; বাকি অ্যাকাউন্ট বন্ধ হয়ে যায়। ব্যাকআপে থাকা কপি আমাদের ডেটাবেস প্রদানকারীর স্ন্যাপশট সময়সূচি অনুসরণ করে (প্ল্যাটফর্ম-পরিচালিত); আমরা নিজেরা আলাদা ব্যাকআপ চালাই না।
- আর্থিক রেকর্ড (অর্ডার, পেমেন্ট, ওয়ালেট, উত্তোলন) — আইন অনুযায়ী ৫ বছর, আপনার পরিচয় ছাড়াই এন্ট্রি-হিসেবে সংরক্ষিত।
- নিরাপত্তা ও ব্যবহারের রেকর্ড (লগইন/অডিট ইভেন্ট, অ্যানালিটিক্স, নোটিফিকেশন, AI প্রশ্নের লগ) — সর্বোচ্চ ১৮০ দিন, এরপর আমাদের দৈনিক রিটেনশন কাজ স্বয়ংক্রিয়ভাবে তা মুছে ফেলে।

### ৬. কারা তথ্য দেখে

- ক্লাউড হোস্টিং ও ডেটাবেস প্রোভাইডার — অ্যাপ চালু রাখতে ও ডেটা সংরক্ষণ করতে। আমাদের সার্ভার ও প্রধান ডেটাবেস যুক্তরাষ্ট্রের (US East) একটি ডেটা সেন্টারে চলে; স্ট্যাটিক ফাইল আপনার কাছের সার্ভার থেকে আসে।
- পেমেন্ট গেটওয়ে (SSLCommerz) — আপনি অনলাইনে পেমেন্ট করলে তা প্রক্রিয়াকরণের জন্য। গেটওয়ে সেট না থাকলে অ্যাপ অনলাইন পেমেন্ট নেয় না।
- SMS প্রোভাইডার — ফোন যাচাইয়ের কোড পাঠাতে।
- আবহাওয়া ও AI সেবা প্রোভাইডার — আপনি পরামর্শ চাইলে সংশ্লিষ্ট তথ্য (আপনার এলাকার অবস্থান বা প্রশ্ন) প্রক্রিয়াকরণের জন্য।
- প্রয়োগকারী সংস্থা বা আদালত — আইনগতভাবে বাধ্য থাকলে।

আমাদের সার্ভার ও প্রধান ডেটাবেস যুক্তরাষ্ট্রে চলে, তাই ধারা ২-এর তথ্য (মোবাইল নম্বর, নাম, খামার ও প্লটের তথ্য, অর্ডার, পেমেন্ট, ওয়ালেটের হিসাব, ছবি, অ্যাপ ব্যবহারের ইভেন্ট এবং — হোস্টেড AI প্রোভাইডার চালু থাকলে — আপনি পাঠানো প্রশ্ন) বাংলাদেশের বাইরে স্থানান্তর ও প্রক্রিয়াকরণ করা হয়। ধারা ৪-এর ভিত্তিগুলোই এখানে প্রযোজ্য: আপনার চাওয়া সেবা চালানো ও তা নিরাপদ রাখার জন্য এই প্রক্রিয়াকরণ প্রয়োজন। সেবার প্রয়োজনের বেশি তথ্য আমরা স্থানান্তর করি না; সব যোগাযোগ এনক্রিপ্ট করা, পাসওয়ার্ড হ্যাশ করে রাখা হয়, প্রবেশাধিকার ভূমিকা অনুযায়ী নিয়ন্ত্রিত, আর ধারা ৫-এর সময়সূচি অনুযায়ী তথ্য মুছে ফেলা বা নাম-পরিচয়হীন করা হয়।

আমরা আপনার তথ্য কারও কাছে বিক্রি করি না এবং বিজ্ঞাপনের জন্য শেয়ার করি না।

### ৭. নিরাপত্তা

- সব যোগাযোগ HTTPS-এ এনক্রিপ্ট করা; পাসওয়ার্ড হ্যাশ করে রাখা হয়, সরাসরি লেখা হয় না।
- প্রবেশাধিকার ভূমিকা অনুযায়ী নিয়ন্ত্রিত; সংবেদনশীল কাজের অডিট রেকর্ড রাখা হয়।
- কোনো ব্যবস্থা শতভাগ নিরাপদ নয়। সন্দেহজনক কিছু দেখলে সাথে সাথে আমাদের জানান।

### ৮. আপনার অধিকার

- **দেখা ও শোধরানো** — অ্যাপের সেটিংস → প্রোফাইল থেকে নিজের নাম, জেলা, উপজেলা, ঠিকানা ও ইমেইল শুধরাতে পারেন; তথ্যের কপি চাইতে পারেন।
- **মুছে ফেলা** — সেটিংস → অ্যাকাউন্ট → অ্যাকাউন্ট মুছে ফেলুন। অথবা ওয়েব থেকে অনুরোধ করুন: `/account-deletion`।
- **অভিযোগ** — উপরের যোগাযোগ ঠিকানায় জানাতে পারেন।

### ৯. শিশুদের বিষয়ে

AgroBridge শুধু ১৮ বছর বা তার বেশি বয়সীদের জন্য। অপ্রাপ্তবয়স্ক কারো অ্যাকাউন্ট পাওয়া গেলে তা বন্ধ করা হয়।

### ১০. পরিবর্তন ও যোগাযোগ

এই নীতি বদলালে আমরা অ্যাপে জানাব এবং উপরের “সর্বশেষ হালনাগাদ” তারিখ বদলে দেব। প্রশ্ন বা অনুরোধ: [ইমেইল — স্টোর সাবমিশনের আগে মালিক পূরণ করবেন]।

---

## English

### 1. Who we are

[operator entity — to be completed by the owner before store submission] ("we") operates AgroBridge, a mobile app and website for farmers in Bangladesh. This policy explains what data we hold, why we hold it, how long we keep it, and how you can access, correct or delete it.

**Data Controller:** [operator entity — to be completed by the owner before store submission], [registered address — to be completed by the owner before store submission], Bangladesh. Contact: [email — to be completed by the owner before store submission].

Written in plain language. If anything is unclear, call our support line.

### 2. What we collect

- Mobile number — to create your account, sign you in, and send a verification code when you verify your phone.
- Name and (optional) email — for your account, orders and receipts. Email is optional.
- District/upazila and address — for your farm records and for weather-based advice for your area.
- Farm, plot and crop records — crop stage, task calendar and your digital farm record.
- Photos you choose to upload — for crop-disease review. We never read the rest of your gallery.
- Orders, payments, wallet and withdrawal records — to complete transactions and keep your ledger.
- Questions you send to the AI Agro Agent — to answer them and to measure service quality.
- Basic usage events (which screen was opened) and technical logs (request ids, error codes) — to keep the app working and to detect abuse. These stay on our own servers and are never sent to advertisers.

We do not read your contacts, SMS or other apps. The app does not request your device location — weather advice uses the district/upazila you provided.

### 3. Why we use it

- Creating and signing you in to your account (mobile number and password; a code when you verify your phone).
- Advising you on your crops: weather advisories, AI advisory, disease review.
- Marketplace and services: buying inputs, selling your produce, booking machinery or an agronomist.
- Payments and wallet: completing transactions and keeping your ledger.
- Keeping the service safe: detecting fraud, abuse and accounting errors, and meeting legal obligations.

### 4. Legal bases

- **Contract** — operating your account, orders, bookings and payments.
- **Consent** — photos you upload and optional details you choose to provide.
- **Legitimate interests** — preventing fraud and abuse, and keeping the service secure.
- **Legal obligation** — retaining financial records.

### 5. Retention

- Account and general data — while your account is open.
- After you delete your account — your name, phone, email and password are erased immediately and the account is closed. Copies that remain in backups follow our database provider's snapshot schedule (platform-managed); we do not operate our own backup jobs.
- Financial records (orders, payments, wallet, withdrawals) — kept 5 years as required by law, in anonymised form, without your identifying details.
- Security and usage records (login/audit events, analytics, notifications, AI query logs) — up to 180 days, then deleted automatically by our daily retention job.

### 6. Who else processes it

- Cloud hosting and database providers — to run the app and store the data. Our servers and primary database are in a data centre region in the United States (US East); static files are served from a location closer to you.
- Payment gateway (SSLCommerz) — to process an online payment when you make one. If no gateway is configured for a deployment, the app does not accept online payments.
- SMS provider — to deliver your phone-verification code.
- Weather and AI service providers — when you request advice, the relevant input (your area's coordinates or your question) is processed to answer it.
- Authorities or courts — where we are legally required to disclose.

Because our servers and primary database run in the United States, the data described in section 2 (phone number, name, farm and plot details, orders, payments, wallet records, photos, app-usage events and — when a hosted AI provider is configured — the questions you send) is transferred to and processed outside Bangladesh. We rely on the same legal bases as in section 4: this processing is part of running the service you asked for, and of keeping it secure. We transfer no more than the service needs, encrypt traffic in transit, store passwords hashed, restrict access by role, and delete or anonymise data on the schedule in section 5.

We never sell your data and never share it for advertising.

### 7. Security

- All traffic is encrypted with HTTPS, and passwords are stored hashed, never in plain text.
- Access is role-controlled and sensitive actions are recorded in an audit log.
- No system is perfectly secure. If you notice anything suspicious, tell us immediately.

### 8. Your rights

- **Access and correction** — edit your name, district, upazila, address and email in Settings → Profile, and ask us for a copy of your data.
- **Deletion** — Settings → Account → Delete account, or request it from the web at `/account-deletion`.
- **Complaints** — contact us using the details above.

### 9. Children

AgroBridge is intended for people aged 18 or older. Accounts found to belong to a minor are closed.

### 10. Changes and contact

If this policy changes we will say so in the app and update the "last updated" date above. Questions or requests: [email — to be completed by the owner before store submission].

---

### Contact / যোগাযোগ

AgroBridge · Privacy & data requests / গোপনীয়তা ও ডেটা অনুরোধ: https://github.com/tanviruchahs2580/AgroBridge/issues/new · Security reports / নিরাপত্তা রিপোর্ট: https://github.com/tanviruchahs2580/AgroBridge/security/advisories/new
