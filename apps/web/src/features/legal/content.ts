/**
 * Published legal documents (privacy policy, terms, account deletion) rendered
 * by the SPA at stable public routes.
 *
 * These are the canonical, published versions: they must describe what the
 * software actually does. When behaviour changes (a new provider, a new data
 * category, a new permission), change this file in the same commit — the Play
 * Console data-safety form and the Data safety answers are derived from it
 * (see docs/play/data-safety.md).
 *
 * OWNER ACTION before submission: replace every value in LEGAL_ENTITY with the
 * registered business details and a monitored contact address, and set
 * SUPPORT_URL/DATA_REQUEST_URL to pages on your own domain. Play review reads
 * these pages, so placeholders must not ship.
 */
export const LEGAL_ENTITY = {
  /** Registered company/sole-proprietorship name. */
  legalName: "AgroBridge",
  /** Postal address for legal notices. */
  address: "Bangladesh",
  /** Monitored support contact (email is required for Play review). */
  email: "privacy@agrobridge.app",
  /** Public page that accepts data-deletion requests (see /account-deletion). */
  dataRequestUrl: "https://github.com/tanviruchahs2580/AgroBridge/issues/new",
  /** Support/help channel. */
  supportUrl: "https://github.com/tanviruchahs2580/AgroBridge/security/advisories/new",
} as const;

const VERSION = "1.1";
const UPDATED = "2026-10-17";

type Bi = { bn: string; en: string };

export interface LegalSection {
  heading: Bi;
  paragraphs?: Bi[];
  bullets?: Bi[];
}

export interface LegalDoc {
  id: "privacy" | "terms" | "deletion";
  title: Bi;
  summary: Bi;
  sections: LegalSection[];
}

const privacy: LegalDoc = {
  id: "privacy",
  title: { bn: "গোপনীয়তা নীতি", en: "Privacy Policy" },
  summary: {
    bn: "আমরা কী তথ্য রাখি, কেন রাখি, কত দিন রাখি এবং আপনি কী করতে পারেন — সহজ ভাষায়।",
    en: "What we collect, why we collect it, how long we keep it, and what you can do about it — in plain language.",
  },
  sections: [
    {
      heading: { bn: "১. আমরা কে", en: "1. Who we are" },
      paragraphs: [
        {
          bn: `${LEGAL_ENTITY.legalName} ("আমরা") বাংলাদেশের কৃষকদের জন্য AgroBridge মোবাইল অ্যাপ ও ওয়েবসাইট পরিচালনা করে। এই নীতিতে বলা হয়েছে আমরা কী তথ্য রাখি, কেন রাখি, কত দিন রাখি এবং আপনি কীভাবে তা দেখতে, শুধরাতে বা মুছতে পারেন।`,
          en: `${LEGAL_ENTITY.legalName} ("we") operates AgroBridge, a mobile app and website for farmers in Bangladesh. This policy explains what data we hold, why we hold it, how long we keep it, and how you can access, correct or delete it.`,
        },
        {
          bn: `তথ্য নিয়ন্ত্রক (Data Controller): ${LEGAL_ENTITY.legalName}, ${LEGAL_ENTITY.address}. যোগাযোগ: ${LEGAL_ENTITY.email}।`,
          en: `Data Controller: ${LEGAL_ENTITY.legalName}, ${LEGAL_ENTITY.address}. Contact: ${LEGAL_ENTITY.email}.`,
        },
      ],
    },
    {
      heading: { bn: "২. আমরা কী তথ্য রাখি", en: "2. What we collect" },
      bullets: [
        {
          bn: "মোবাইল নম্বর — অ্যাকাউন্ট তৈরি, লগইন ও ফোন যাচাইয়ের কোড পাঠাতে।",
          en: "Mobile number — to create your account, sign you in, and send a verification code when you verify your phone.",
        },
        {
          bn: "নাম ও (ঐচ্ছিক) ইমেইল — অ্যাকাউন্ট, অর্ডার ও যোগাযোগের জন্য। ইমেইল দিতে বাধ্য নন।",
          en: "Name and (optional) email — for your account, orders and receipts. Email is optional.",
        },
        {
          bn: "জেলা/উপজেলা ও ঠিকানা — খামারের তথ্য এবং আপনার এলাকার আবহাওয়া-ভিত্তিক পরামর্শের জন্য।",
          en: "District/upazila and address — for your farm records and for weather-based advice for your area.",
        },
        {
          bn: "খামার, প্লট ও ফসলের রেকর্ড — ফসলের পর্যায়, কাজের সময়সূচি ও ডিজিটাল খামার রেকর্ড।",
          en: "Farm, plot and crop records — crop stage, task calendar and your digital farm record.",
        },
        {
          bn: "আপনি যে ছবি পাঠান — ফসলের রোগ পর্যালোচনার জন্য। আমরা আপনার গ্যালারির অন্য ছবি পড়ি না।",
          en: "Photos you choose to upload — for crop-disease review. We never read the rest of your gallery.",
        },
        {
          bn: "অর্ডার, পেমেন্ট, ওয়ালেট ও উত্তোলনের হিসাব — লেনদেন সম্পন্ন করতে ও হিসাব রাখতে।",
          en: "Orders, payments, wallet and withdrawal records — to complete transactions and keep your ledger.",
        },
        {
          bn: "AI সহকারীকে আপনার পাঠানো প্রশ্ন — পরামর্শ দিতে ও সেবার মান মাপতে।",
          en: "Questions you send to the AI Agro Agent — to answer them and to measure service quality.",
        },
        {
          bn: "সেবা ব্যবহারের সাধারণ ইভেন্ট (কোন পাতা খুলেছেন) ও প্রযুক্তিগত লগ (রিকোয়েস্ট আইডি, ত্রুটির কোড) — অ্যাপ ঠিক রাখতে ও জালিয়াতি ঠেকাতে। এই ইভেন্টগুলো আমাদের নিজের সার্ভারে থাকে, বিজ্ঞাপনদাতার কাছে যায় না।",
          en: "Basic usage events (which screen was opened) and technical logs (request ids, error codes) — to keep the app working and to detect abuse. These stay on our own servers and are never sent to advertisers.",
        },
      ],
      paragraphs: [
        {
          bn: "আমরা আপনার কন্টাক্ট লিস্ট, SMS বা অন্য অ্যাপের তথ্য পড়ি না। অ্যাপ আপনার অবস্থানের অনুমতি চায় না — আবহাওয়া আপনার দেওয়া জেলা/উপজেলা অনুযায়ী দেখানো হয়।",
          en: "We do not read your contacts, SMS or other apps. The app does not request your device location — weather advice uses the district/upazila you provided.",
        },
      ],
    },
    {
      heading: { bn: "৩. কেন রাখি", en: "3. Why we use it" },
      bullets: [
        {
          bn: "অ্যাকাউন্ট তৈরি করা ও লগইন করানো (মোবাইল নম্বর ও পাসওয়ার্ড; ফোন যাচাইয়ের জন্য কোড)।",
          en: "Creating and signing you in to your account (mobile number and password; a code when you verify your phone).",
        },
        {
          bn: "আপনার ফসলের জন্য পরামর্শ দেওয়া: আবহাওয়ার সতর্কতা, AI পরামর্শ, রোগ পর্যালোচনা।",
          en: "Advising you on your crops: weather advisories, AI advisory, disease review.",
        },
        {
          bn: "বাজার ও সেবা: পণ্য কেনা, ফসল বিক্রির অফার, যন্ত্রপাতি/কৃষিবিদ বুকিং।",
          en: "Marketplace and services: buying inputs, selling your produce, booking machinery or an agronomist.",
        },
        {
          bn: "পেমেন্ট ও ওয়ালেট: লেনদেন সম্পন্ন করা এবং হিসাব রাখা।",
          en: "Payments and wallet: completing transactions and keeping your ledger.",
        },
        {
          bn: "সেবা সুরক্ষা: জালিয়াতি, অপব্যবহার ও হিসাবের ভুল ধরতে এবং আইনগত দায় পূরণ করতে।",
          en: "Keeping the service safe: detecting fraud, abuse and accounting errors, and meeting legal obligations.",
        },
      ],
    },
    {
      heading: { bn: "৪. আইনি ভিত্তি", en: "4. Legal bases" },
      bullets: [
        {
          bn: "চুক্তি — আপনার অ্যাকাউন্ট, অর্ডার, বুকিং ও পেমেন্ট পরিচালনা করা।",
          en: "Contract — operating your account, orders, bookings and payments.",
        },
        {
          bn: "সম্মতি — আপনি যে ছবি পাঠান এবং যেসব ঐচ্ছিক তথ্য দেন।",
          en: "Consent — photos you upload and optional details you choose to provide.",
        },
        {
          bn: "বৈধ স্বার্থ — জালিয়াতি ও অপব্যবহার ঠেকানো এবং সেবা নিরাপদ রাখা।",
          en: "Legitimate interests — preventing fraud and abuse, and keeping the service secure.",
        },
        {
          bn: "আইনগত বাধ্যবাধকতা — আর্থিক রেকর্ড সংরক্ষণ।",
          en: "Legal obligation — retaining financial records.",
        },
      ],
    },
    {
      heading: { bn: "৫. কত দিন রাখি", en: "5. Retention" },
      bullets: [
        {
          bn: "অ্যাকাউন্ট ও সাধারণ তথ্য — আপনার অ্যাকাউন্ট চালু থাকা পর্যন্ত।",
          en: "Account and general data — while your account is open.",
        },
        {
          bn: "অ্যাকাউন্ট মুছে ফেললে — আপনার নাম, ফোন, ইমেইল ও পাসওয়ার্ড সাথে সাথে মুছে যায়; বাকি অ্যাকাউন্ট বন্ধ হয়ে যায়। ব্যাকআপের কপি সর্বোচ্চ ৩০ দিনে স্বয়ংক্রিয়ভাবে মুছে যায়।",
          en: "After you delete your account — your name, phone, email and password are erased immediately and the account is closed. Backup copies expire automatically within 30 days.",
        },
        {
          bn: "আর্থিক রেকর্ড (অর্ডার, পেমেন্ট, ওয়ালেট, উত্তোলন) — আইন অনুযায়ী ৫ বছর, আপনার পরিচয় ছাড়াই এন্ট্রি-হিসেবে সংরক্ষিত।",
          en: "Financial records (orders, payments, wallet, withdrawals) — kept 5 years as required by law, in anonymised form, without your identifying details.",
        },
      ],
    },
    {
      heading: { bn: "৬. কারা তথ্য দেখে", en: "6. Who else processes it" },
      bullets: [
        {
          bn: "ক্লাউড হোস্টিং ও ডেটাবেস প্রোভাইডার — অ্যাপ ও ডেটা চালু রাখতে।",
          en: "Cloud hosting and database providers — to run the app and store the data.",
        },
        {
          bn: "পেমেন্ট গেটওয়ে (SSLCommerz) — আপনি অনলাইনে পেমেন্ট করলে তা প্রক্রিয়াকরণের জন্য। গেটওয়ে সেট না থাকলে অ্যাপ অনলাইন পেমেন্ট নেয় না।",
          en: "Payment gateway (SSLCommerz) — to process an online payment when you make one. If no gateway is configured for a deployment, the app does not accept online payments.",
        },
        {
          bn: "SMS প্রোভাইডার — ফোন যাচাইয়ের কোড পাঠাতে।",
          en: "SMS provider — to deliver your phone-verification code.",
        },
        {
          bn: "আবহাওয়া ও AI সেবা প্রোভাইডার — আপনি পরামর্শ চাইলে সংশ্লিষ্ট তথ্য (আপনার এলাকার অবস্থান বা প্রশ্ন) প্রক্রিয়াকরণের জন্য।",
          en: "Weather and AI service providers — when you request advice, the relevant input (your area's coordinates or your question) is processed to answer it.",
        },
        {
          bn: "প্রয়োগকারী সংস্থা বা আদালত — আইনগতভাবে বাধ্য থাকলে।",
          en: "Authorities or courts — where we are legally required to disclose.",
        },
      ],
      paragraphs: [
        {
          bn: "আমরা আপনার তথ্য কারও কাছে বিক্রি করি না এবং বিজ্ঞাপনের জন্য শেয়ার করি না।",
          en: "We never sell your data and never share it for advertising.",
        },
      ],
    },
    {
      heading: { bn: "৭. নিরাপত্তা", en: "7. Security" },
      bullets: [
        {
          bn: "সব যোগাযোগ HTTPS-এ এনক্রিপ্ট করা; পাসওয়ার্ড হ্যাশ করে রাখা হয়, সরাসরি লেখা হয় না।",
          en: "All traffic is encrypted with HTTPS, and passwords are stored hashed, never in plain text.",
        },
        {
          bn: "প্রবেশাধিকার ভূমিকা অনুযায়ী নিয়ন্ত্রিত; সংবেদনশীল কাজের অডিট রেকর্ড রাখা হয়।",
          en: "Access is role-controlled and sensitive actions are recorded in an audit log.",
        },
        {
          bn: "কোনো ব্যবস্থা শতভাগ নিরাপদ নয়। সন্দেহজনক কিছু দেখলে সাথে সাথে আমাদের জানান।",
          en: "No system is perfectly secure. If you notice anything suspicious, tell us immediately.",
        },
      ],
    },
    {
      heading: { bn: "৮. আপনার অধিকার", en: "8. Your rights" },
      bullets: [
        {
          bn: "দেখা ও শোধরানো — অ্যাপের সেটিংস → প্রোফাইল থেকে নিজের নাম, জেলা, উপজেলা, ঠিকানা ও ইমেইল শুধরাতে পারেন; তথ্যের কপি চাইতে পারেন।",
          en: "Access and correction — edit your name, district, upazila, address and email in Settings → Profile, and ask us for a copy of your data.",
        },
        {
          bn: "মুছে ফেলা — সেটিংস → অ্যাকাউন্ট → অ্যাকাউন্ট মুছে ফেলুন। অথবা ওয়েব থেকে অনুরোধ করুন: /account-deletion।",
          en: "Deletion — Settings → Account → Delete account, or request it from the web at /account-deletion.",
        },
        {
          bn: "অভিযোগ — উপরের যোগাযোগ ঠিকানায় জানাতে পারেন।",
          en: "Complaints — contact us using the details above.",
        },
      ],
    },
    {
      heading: { bn: "৯. শিশুদের বিষয়ে", en: "9. Children" },
      paragraphs: [
        {
          bn: "AgroBridge শুধু ১৮ বছর বা তার বেশি বয়সীদের জন্য। অপ্রাপ্তবয়স্ক কারো অ্যাকাউন্ট পাওয়া গেলে তা বন্ধ করা হয়।",
          en: "AgroBridge is intended for people aged 18 or older. Accounts found to belong to a minor are closed.",
        },
      ],
    },
    {
      heading: { bn: "১০. পরিবর্তন ও যোগাযোগ", en: "10. Changes and contact" },
      paragraphs: [
        {
          bn: `এই নীতি বদলালে আমরা অ্যাপে জানাব এবং উপরের \u201cসর্বশেষ হালনাগাদ\u201d তারিখ বদলে দেব। প্রশ্ন বা অনুরোধ: ${LEGAL_ENTITY.email}।`,
          en: `If this policy changes we will say so in the app and update the "last updated" date above. Questions or requests: ${LEGAL_ENTITY.email}.`,
        },
      ],
    },
  ],
};

const terms: LegalDoc = {
  id: "terms",
  title: { bn: "ব্যবহারের শর্তাবলি", en: "Terms of Service" },
  summary: {
    bn: "AgroBridge ব্যবহার করার শর্ত — সংক্ষেপে ও স্পষ্ট ভাষায়।",
    en: "The terms you accept when you use AgroBridge — short and plain.",
  },
  sections: [
    {
      heading: { bn: "১. অ্যাকাউন্ট", en: "1. Your account" },
      bullets: [
        {
          bn: "সঠিক মোবাইল নম্বর ও তথ্য দিয়ে অ্যাকাউন্ট খুলুন। আপনার পাসওয়ার্ড আপনার দায়িত্ব — অন্যকে দেবেন না।",
          en: "Register with your own mobile number and accurate details. You are responsible for keeping your password secret.",
        },
        {
          bn: "একজন ব্যক্তির একটি অ্যাকাউন্ট। ১৮ বছরের কম বয়সীরা অ্যাকাউন্ট খুলতে পারবে না।",
          en: "One account per person. People under 18 may not register.",
        },
        {
          bn: "নিয়ম ভাঙলে, প্রতারণা বা অপব্যবহার করলে আমরা অ্যাকাউন্ট বন্ধ করতে পারি।",
          en: "We may suspend or close an account that breaks these terms, commits fraud, or abuses the service.",
        },
      ],
    },
    {
      heading: { bn: "২. পরামর্শ ও তথ্যের সীমাবদ্ধতা", en: "2. Limits of advice and information" },
      bullets: [
        {
          bn: "আবহাওয়া, AI পরামর্শ ও রোগ-সংক্রান্ত ফলাফল সহায়ক তথ্য — কৃষিবিদ বা মাঠকর্মীর পেশাগত পরামর্শের বিকল্প নয়।",
          en: "Weather, AI advice and disease results are decision support — they do not replace an agronomist's or field officer's professional judgement.",
        },
        {
          bn: "আমরা নিশ্চিত করি না যে প্রতিটি পূর্বাভাস বা পরামর্শ আপনার জমির জন্য নির্ভুল। চূড়ান্ত সিদ্ধান্ত আপনার।",
          en: "We cannot guarantee that every forecast or recommendation is accurate for your land. Final decisions are yours.",
        },
        {
          bn: "রোগ শনাক্তকরণে ছবি বিশেষজ্ঞের পর্যালোচনার জন্য জমা হয়; অ্যাপ নিজে থেকে রোগ নির্ণয় বানিয়ে বলে না।",
          en: "Uploaded disease photos are queued for expert review; the app does not invent a diagnosis on its own.",
        },
      ],
    },
    {
      heading: { bn: "৩. বাজার, অর্ডার ও সেবা", en: "3. Marketplace, orders and services" },
      bullets: [
        {
          bn: "পণ্যের দাম, স্টক ও সেবার সময়সূচি প্রোভাইডার/ডিলার নির্ধারণ করে; অ্যাপ শুধু তা দেখায় ও লেনদেন সংরক্ষণ করে।",
          en: "Prices, stock and service schedules are set by the dealer or provider; the app records and displays them.",
        },
        {
          bn: "অর্ডার নিশ্চিত হলে স্টক সাথে সাথে সংরক্ষিত হয়। বাতিল বা ফেরত আমাদের নীতিমালা অনুযায়ী।",
          en: "Stock is reserved as soon as an order is confirmed. Cancellations and refunds follow our stated policy.",
        },
        {
          bn: "ডেলিভারির সময় ও গুণমান প্রোভাইডারের দায়িত্ব; সমস্যা হলে আমরা সমন্বয় করতে সহায়তা করব।",
          en: "Delivery timing and quality are the provider's responsibility; we help coordinate if something goes wrong.",
        },
      ],
    },
    {
      heading: { bn: "৪. পেমেন্ট ও ওয়ালেট", en: "4. Payments and wallet" },
      bullets: [
        {
          bn: "অনলাইন পেমেন্ট গেটওয়ে প্রোভাইডারের মাধ্যমে প্রক্রিয়া হয়; সফলতা নিশ্চিত হয় গেটওয়ের যাচাইয়ের পর।",
          en: "Online payments are processed by the payment gateway; a payment counts as successful only after the gateway verifies it.",
        },
        {
          bn: "প্রোভাইডার সেট না থাকলে অ্যাপ অনলাইন পেমেন্ট নেয় না — অর্ডার অপরিশোধিত থেকে যায়।",
          en: "If no gateway is configured, the app takes no online payment and the order remains unpaid.",
        },
        {
          bn: "ওয়ালেট ব্যালেন্স ও আনুমানিক আয় প্রকৃত হিসাব থেকে আসে; উত্তোলনের আগে ফোন নম্বর যাচাই করতে হয়।",
          en: "Wallet balance and estimates come from real ledger entries; your phone number must be verified before you can withdraw.",
        },
      ],
    },
    {
      heading: { bn: "৫. আপনার দেওয়া কনটেন্ট", en: "5. Content you provide" },
      bullets: [
        {
          bn: "আপনি যে ছবি বা তথ্য পাঠান, তা আপনার এবং তা সঠিক হওয়ার দায় আপনার।",
          en: "Photos and data you upload are yours, and you are responsible for their accuracy and for having the right to share them.",
        },
        {
          bn: "সেবা চালাতে আমাদের সেই কনটেন্ট প্রক্রিয়া ও সংরক্ষণের অনুমতি আপনি দেন (যেমন বিশেষজ্ঞের পর্যালোচনার জন্য ছবি)।",
          en: "You allow us to process and store that content to run the service (for example, showing your photo to a reviewer).",
        },
      ],
    },
    {
      heading: { bn: "৬. দায়সীমা", en: "6. Liability" },
      paragraphs: [
        {
          bn: "আমরা সেবা নিরবচ্ছিন্ন ও নির্ভুল রাখতে সর্বোচ্চ চেষ্টা করি, তবে বিদ্যুৎ/নেটওয়ার্ক/তৃতীয় পক্ষের কারণে বিঘ্ন হতে পারে। আইনে যতটা অনুমোদিত, ততটুকু সীমার মধ্যেই আমাদের দায়। ফসলের ক্ষতি, বাজারের দাম বা আবহাওয়ার কারণে হওয়া ব্যবসায়িক ক্ষতির জন্য আমরা দায়ী নই।",
          en: "We work to keep the service available and accurate, but outages can happen because of power, network or third-party failures. Our liability is limited to the extent the law allows, and we are not liable for business losses caused by crop damage, market prices or weather.",
        },
      ],
    },
    {
      heading: { bn: "৭. পরিবর্তন ও যোগাযোগ", en: "7. Changes and contact" },
      paragraphs: [
        {
          bn: `শর্ত বদলালে অ্যাপে জানানো হবে; এর পর সেবা ব্যবহার করলে নতুন শর্তে সম্মতি ধরা হবে। প্রশ্ন: ${LEGAL_ENTITY.email}।`,
          en: `If these terms change we will announce it in the app; continuing to use the service then means you accept the new terms. Questions: ${LEGAL_ENTITY.email}.`,
        },
      ],
    },
  ],
};

const deletion: LegalDoc = {
  id: "deletion",
  title: { bn: "অ্যাকাউন্ট ও তথ্য মুছে ফেলা", en: "Delete your account and data" },
  summary: {
    bn: "AgroBridge অ্যাকাউন্ট ও ব্যক্তিগত তথ্য মুছে ফেলার উপায় এবং কী সংরক্ষিত থাকে।",
    en: "How to delete your AgroBridge account and personal data, and what is retained.",
  },
  sections: [
    {
      heading: { bn: "অ্যাপ থেকে মুছে ফেলা (দ্রুততম)", en: "Delete from the app (fastest)" },
      bullets: [
        {
          bn: "অ্যাপ খুলে সেটিংসে যান, তারপর অ্যাকাউন্ট অংশে।",
          en: "Open the app and go to Settings, then the Account section.",
        },
        {
          bn: "\u201cঅ্যাকাউন্ট মুছে ফেলুন\u201d চেপে নিশ্চিত করুন।",
          en: 'Choose "Delete account" and confirm.',
        },
        {
          bn: "আপনার নাম, ফোন, ইমেইল ও পাসওয়ার্ড সাথে সাথে মুছে যায় এবং অ্যাকাউন্ট বন্ধ হয়ে যায়। লগইন করা আর যাবে না।",
          en: "Your name, phone, email and password are erased immediately and the account is closed. You will no longer be able to sign in.",
        },
      ],
      paragraphs: [
        {
          bn: "শর্ত: কোনো অর্ডার চলমান (বাতিল/ডেলিভারি হয়নি) বা উত্তোলনের অনুরোধ নিষ্পত্তির অপেক্ষায় থাকলে মুছে ফেলা যাবে না — আগে সেগুলো নিষ্পত্তি করুন।",
          en: "Prerequisite: you cannot delete while an order is still in progress or a withdrawal request is awaiting settlement. Resolve those first.",
        },
      ],
    },
    {
      heading: { bn: "অ্যাপে ঢুকতে না পারলে", en: "If you cannot access the app" },
      bullets: [
        {
          bn: `অনুরোধ পাঠান: ${LEGAL_ENTITY.dataRequestUrl}`,
          en: `Send a request to: ${LEGAL_ENTITY.dataRequestUrl}`,
        },
        {
          bn: `অথবা ইমেইল করুন: ${LEGAL_ENTITY.email}`,
          en: `Or email: ${LEGAL_ENTITY.email}`,
        },
        {
          bn: "আপনার অ্যাকাউন্টের মোবাইল নম্বর লিখুন। যাচাইয়ের পর ৭ কর্মদিবসের মধ্যে মুছে ফেলা হবে।",
          en: "Include the mobile number registered on your account. After we verify ownership, deletion is completed within 7 working days.",
        },
      ],
    },
    {
      heading: { bn: "কী মুছে যায়, কী থাকে", en: "What is deleted, what is kept" },
      bullets: [
        {
          bn: "মুছে যায়: নাম, মোবাইল নম্বর, ইমেইল, পাসওয়ার্ড, প্রোফাইল ও খামারের ব্যক্তিগত তথ্য, নোটিফিকেশন পছন্দ, লগইন সেশন।",
          en: "Deleted: your name, mobile number, email, password, personal profile and farm details, notification preferences and login sessions.",
        },
        {
          bn: "সংরক্ষিত থাকে (আপনার পরিচয় ছাড়া): অর্থনৈতিক রেকর্ড — অর্ডার, পেমেন্ট, ওয়ালেট ও উত্তোলনের হিসাব — আইন অনুযায়ী ৫ বছর।",
          en: "Retained (without your identifying details): financial records — orders, payments, wallet and withdrawal entries — for 5 years as required by law.",
        },
        {
          bn: "ব্যাকআপে থাকা কপি সর্বোচ্চ ৩০ দিনে স্বয়ংক্রিয়ভাবে মুছে যায়।",
          en: "Copies held in backups expire automatically within 30 days.",
        },
      ],
    },
  ],
};

export const LEGAL_DOCS: Record<LegalDoc["id"], LegalDoc> = { privacy, terms, deletion };
export const LEGAL_META = { version: VERSION, updated: UPDATED };
