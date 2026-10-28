/** Bengali/English UI dictionary. Keys are English identifiers; values localized. */
export type Lang = "bn" | "en";

export const dict = {
  // ── Brand / shell ──
  appName: { bn: "এগ্রোব্রিজ", en: "AgroBridge" },
  tagline: { bn: "AI কৃষকের হাতে", en: "AI in every farmer's hand" },
  login: { bn: "লগইন", en: "Login" },
  register: { bn: "রেজিস্ট্রেশন", en: "Register" },
  logout: { bn: "লগআউট", en: "Logout" },
  fullName: { bn: "পূর্ণ নাম", en: "Full name" },
  phone: { bn: "মোবাইল নম্বর", en: "Mobile number" },
  password: { bn: "পাসওয়ার্ড", en: "Password" },
  home: { bn: "হোম", en: "Home" },
  myFarm: { bn: "আমার ফার্ম", en: "My Farm" },
  aiAgent: { bn: "এআই কৃষি সহকারী", en: "AI Agro Agent" },
  market: { bn: "বাজার", en: "Market" },
  profile: { bn: "প্রোফাইল", en: "Profile" },
  weather: { bn: "আবহাওয়া", en: "Weather" },
  services: { bn: "সেবা", en: "Services" },
  sellCrop: { bn: "ফসল বিক্রি", en: "Sell Crop" },
  wallet: { bn: "ওয়ালেট", en: "Wallet" },
  membership: { bn: "মেম্বারশিপ", en: "Membership" },
  notifications: { bn: "নোটিফিকেশন", en: "Notifications" },
  admin: { bn: "অ্যাডমিন", en: "Admin" },
  addFarm: { bn: "নতুন ফার্ম", en: "Add Farm" },
  addPlot: { bn: "নতুন প্লট", en: "Add Plot" },
  addCrop: { bn: "নতুন ফসল", en: "Add Crop" },
  cart: { bn: "কার্ট", en: "Cart" },
  checkout: { bn: "চেকআউট", en: "Checkout" },
  myOrders: { bn: "আমার অর্ডার", en: "My Orders" },
  bookNow: { bn: "বুক করুন", en: "Book now" },
  areaBigha: { bn: "জমির পরিমাণ (বিঘা)", en: "Area (bigha)" },
  date: { bn: "তারিখ", en: "Date" },
  submit: { bn: "জমা দিন", en: "Submit" },
  cropName: { bn: "ফসলের নাম", en: "Crop name" },
  quantityKg: { bn: "পরিমাণ (কেজি)", en: "Quantity (kg)" },
  qualityGrade: { bn: "মানের গ্রেড", en: "Quality grade" },
  moisturePct: { bn: "আর্দ্রতা (%)", en: "Moisture (%)" },
  netPayable: { bn: "নীট পরিশোধযোগ্য", en: "Net payable" },
  payNow: { bn: "পেমেন্ট করুন", en: "Pay now" },
  askPlaceholder: { bn: "আপনার প্রশ্ন লিখুন...", en: "Ask your question..." },
  send: { bn: "পাঠান", en: "Send" },
  lowConfidence: { bn: "নিশ্চিত উত্তর নয় — বিশেষজ্ঞের পরামর্শ নিন", en: "Low confidence — verify with an expert" },
  uploadPhoto: { bn: "ছবি আপলোড করুন", en: "Upload photo" },
  // Photos are queued for a human agronomist (status PENDING_REVIEW, no
  // classifier is wired) — the label must not promise a diagnosis.
  diseaseCheck: { bn: "রোগের ছবি জমা দিন", en: "Submit disease photo" },
  pendingReview: { bn: "বিশেষজ্ঞ পর্যালোচনাধীন", en: "Pending expert review" },
  reviewed: { bn: "পর্যালোচিত", en: "Reviewed" },
  farmers: { bn: "কৃষক", en: "Farmers" },
  farms: { bn: "ফার্ম", en: "Farms" },
  orders: { bn: "অর্ডার", en: "Orders" },
  bookings: { bn: "বুকিং", en: "Bookings" },
  revenue: { bn: "রাজস্ব", en: "Revenue" },
  users: { bn: "ব্যবহারকারী", en: "Users" },
  auditLogs: { bn: "অডিট লগ", en: "Audit Logs" },
  loading: { bn: "লোড হচ্ছে...", en: "Loading..." },
  errorGeneric: { bn: "এই মুহূর্তে সেবাটি পাওয়া যাচ্ছে না। কিছুক্ষণ পরে আবার চেষ্টা করুন।", en: "Service unavailable right now. Please try again shortly." },

  // ── Auth pages ──
  loginTitle: { bn: "লগইন করুন", en: "Log in" },
  registerTitle: { bn: "অ্যাকাউন্ট খুলুন", en: "Create your account" },
  welcomeBack: { bn: "আবার স্বাগতম!", en: "Welcome back!" },
  welcomeName: { bn: "স্বাগতম, {name}!", en: "Welcome, {name}!" },
  phonePlaceholder: { bn: "01XXXXXXXXX", en: "01XXXXXXXXX" },
  passwordPlaceholder: { bn: "আপনার পাসওয়ার্ড", en: "Your password" },
  fullNamePlaceholder: { bn: "যেমনঃ করিম উদ্দিন", en: "e.g. Karim Uddin" },
  confirmPassword: { bn: "পাসওয়ার্ড নিশ্চিত করুন", en: "Confirm password" },
  confirmPasswordPlaceholder: { bn: "আবার পাসওয়ার্ড লিখুন", en: "Re-enter password" },
  signIn: { bn: "প্রবেশ করুন", en: "Sign in" },
  signUp: { bn: "অ্যাকাউন্ট তৈরি করুন", en: "Create account" },
  haveAccount: { bn: "অ্যাকাউন্ট আছে? লগইন করুন", en: "Have an account? Log in" },
  noAccount: { bn: "অ্যাকাউন্ট নেই? রেজিস্ট্রেশন করুন", en: "No account yet? Register" },
  // Auth footers render the sentence split around a <Link>, so the lead-in and
  // the link text are separate keys (the combined noAccount/haveAccount keys
  // above stay for callers that render the whole sentence as one string).
  authNoAccountPrefix: { bn: "অ্যাকাউন্ট নেই?", en: "No account yet?" },
  authRegisterLink: { bn: "রেজিস্ট্রেশন করুন", en: "Register" },
  authHaveAccountPrefix: { bn: "অ্যাকাউন্ট আছে?", en: "Have an account?" },
  authLoginLink: { bn: "লগইন করুন", en: "Log in" },
  // ── Auth surfaces (v2 unified premium auth) ──
  authWelcome: { bn: "স্বাগতম", en: "Welcome" },
  authWelcomeSub: { bn: "আপনার অ্যাকাউন্টে লগইন করুন", en: "Sign in to your account" },
  authRegisterSub: { bn: "মিনিটেই আপনার ফার্ম অ্যাকাউন্ট খুলুন", en: "Create your farm account in minutes" },
  authHeroHeadline: { bn: "বাংলাদেশের কৃষকের বিশ্বস্ত ডিজিটাল সঙ্গী", en: "The trusted digital companion for Bangladeshi farmers" },
  authHeroValue1: { bn: "ফসলের রোগের ছবি — কৃষি বিশেষজ্ঞের পর্যালোচনায়", en: "Crop disease photos — reviewed by agronomists" },
  authHeroValue2: { bn: "সরাসরি বাজার — ন্যায্য দাম, মধ্যস্বত্বভোগী নেই", en: "Direct marketplace — fair prices, no middlemen" },
  authHeroValue3: { bn: "যন্ত্রপাতি ও কৃষি সেবা এক অ্যাপেই", en: "Machinery and agri services in one app" },
  authTagline: { bn: "AI কৃষকের হাতে", en: "AI in every farmer's hand" },
  showPassword: { bn: "পাসওয়ার্ড দেখান", en: "Show password" },
  hidePassword: { bn: "পাসওয়ার্ড লুকান", en: "Hide password" },
  // ── Consent capture (registration, PRD-05/AUD-150) ──
  consentLabel: { bn: "আমি ব্যবহারের শর্তাবলি ও গোপনীয়তা নীতিতে সম্মত আছি", en: "I agree to the Terms of Service and Privacy Policy" },
  consentLead: { bn: "আমি সম্মত আছি", en: "I agree to the" },
  consentJoin: { bn: "এবং", en: "and" },
  errConsentRequired: { bn: "চালিয়ে যেতে ব্যবহারের শর্তাবলি ও গোপনীয়তা নীতিতে সম্মতি দিন।", en: "Please accept the Terms of Service and Privacy Policy to continue." },
  // ── Password reset (features/auth/Reset.tsx) ──
  forgotPasswordLink: { bn: "পাসওয়ার্ড ভুলে গেছেন?", en: "Forgot password?" },
  resetTitle: { bn: "পাসওয়ার্ড রিসেট", en: "Reset password" },
  resetSubtitle: { bn: "নম্বর দিন, কোড নিন, নতুন পাসওয়ার্ড ঠিক করুন।", en: "Enter your number, take the code, set a new password." },
  newPassword: { bn: "নতুন পাসওয়ার্ড", en: "New password" },
  resetSubmit: { bn: "নতুন পাসওয়ার্ড দিন", en: "Set new password" },
  resetCodeSent: { bn: "কোড পাঠানো হয়েছে — এসএমএস দেখুন।", en: "Code sent — check your SMS." },
  resetSuccess: { bn: "পাসওয়ার্ড পরিবর্তন হয়েছে — নতুন পাসওয়ার্ড দিয়ে লগইন করুন।", en: "Password changed — sign in with your new password." },
  resetChangeNumber: { bn: "অন্য নম্বর দিন", en: "Use a different number" },
  errOtpInvalid: { bn: "কোডটি সঠিক নয়।", en: "That code is not correct." },
  errOtpExpired: { bn: "কোডের মেয়াদ শেষ — নতুন কোড নিন।", en: "The code has expired — request a new one." },
  // Language toggle labels name the *target* language, so the bn value is the
  // English label and the en value is the Bengali one.
  langToggleButton: { bn: "EN", en: "বাং" },
  langSwitchAria: { bn: "Switch to English", en: "বাংলায় ফিরুন" },
  // ── Home dashboard (v2) ──
  aiFarmAttention: { bn: "মাঠে মনোযোগ দরকার", en: "Your field needs attention" },
  aiFarmAttentionSub: { bn: "আবহাওয়ার ঝুঁকি শনাক্ত হয়েছে — আগাম ব্যবস্থা নিন।", en: "Weather risks detected — take precautionary action." },
  aiFarmHealthySub: { bn: "আপনার জমি, ফসল ও আবহাওয়া অনুকূল পর্যায়ে আছে।", en: "Your land, crops and weather are in favorable condition." },
  farmCareTitle: { bn: "খেতের পরামর্শ", en: "Farm care" },
  noActiveCrops: { bn: "কোনো সক্রিয় ফসল নেই", en: "No active crops" },
  addFirstCropHint: { bn: "প্রথম ফসল যোগ করুন — পর্যায় অনুযায়ী পরামর্শ এখানে দেখা যাবে।", en: "Add your first crop — stage-based care suggestions will appear here." },
  askNow: { bn: "প্রশ্ন করুন", en: "Ask now" },
  careUrgent: { bn: "জরুরি", en: "Urgent" },
  careDueToday: { bn: "আজ করতে হবে", en: "Due today" },
  careRoutine: { bn: "রুটিন", en: "Routine" },
  totalLand: { bn: "মোট জমি (বিঘা)", en: "Total land (bigha)" },
  themeToggleAria: { bn: "ডার্ক / লাইট মোড বদলান", en: "Toggle dark mode" },
  langToggleAria: { bn: "ভাষা বদলান", en: "Switch language" },
  activeLabel: { bn: "সক্রিয়", en: "Active" },
  errInvalidCredentials: { bn: "মোবাইল নম্বর বা পাসওয়ার্ড সঠিক নয়।", en: "Wrong mobile number or password." },
  errPhoneTaken: { bn: "এই নম্বরে একটি অ্যাকাউন্ট আছে — লগইন করুন।", en: "An account with this number already exists — log in." },
  errWeakPassword: { bn: "পাসওয়ার্ড দুর্বল — কমপক্ষে ৮ অক্ষরের শক্তিশালী পাসওয়ার্ড দিন।", en: "Weak password — use at least 8 strong characters." },
  // bcrypt only uses the first 72 bytes; the server refuses longer, so say it here.
  errPasswordTooLong: { bn: "পাসওয়ার্ড খুব দীর্ঘ — সর্বোচ্চ ৭২ অক্ষর।", en: "Password too long — 72 characters maximum." },
  errPhoneInvalid: { bn: "সঠিক বাংলাদেশি মোবাইল নম্বর দিন (11 সংখ্যা)।", en: "Enter a valid Bangladeshi mobile number (11 digits)." },
  errNetwork: { bn: "নেটওয়ার্ক সমস্যা — ইন্টারনেট সংযোগ দেখে নিন।", en: "Network problem — check your internet connection." },
  errValidation: { bn: "দেওয়া তথ্য সঠিক নয় — আবার দেখে নিন।", en: "The information given is invalid — please review it." },

  // ── Common actions ──
  save: { bn: "সংরক্ষণ", en: "Save" },
  cancel: { bn: "বাতিল", en: "Cancel" },
  delete: { bn: "মুছুন", en: "Delete" },
  edit: { bn: "সম্পাদনা", en: "Edit" },
  retry: { bn: "আবার চেষ্টা করুন", en: "Retry" },
  close: { bn: "বন্ধ করুন", en: "Close" },
  back: { bn: "পেছনে", en: "Back" },
  next: { bn: "পরবর্তী", en: "Next" },
  previous: { bn: "আগের", en: "Previous" },
  confirmAction: { bn: "নিশ্চিত করুন", en: "Confirm" },
  done: { bn: "সম্পন্ন", en: "Done" },
  yes: { bn: "হ্যাঁ", en: "Yes" },
  no: { bn: "না", en: "No" },
  refresh: { bn: "রিফ্রেশ", en: "Refresh" },
  search: { bn: "খুঁজুন", en: "Search" },
  optionalField: { bn: "ঐচ্ছিক", en: "Optional" },
  viewAll: { bn: "সব দেখুন", en: "View all" },

  // ── Toasts / system messages ──
  saved: { bn: "সংরক্ষিত হয়েছে ✓", en: "Saved ✓" },
  toastError: { bn: "সমস্যা হয়েছে — আবার চেষ্টা করুন।", en: "Something went wrong — please try again." },
  networkOffline: { bn: "আপনি অফলাইনে আছেন", en: "You are offline" },
  networkBackOnline: { bn: "ইন্টারনেট ফিরে এসেছে ✓", en: "Back online ✓" },
  sessionExpired: { bn: "সেশনের মেয়াদ শেষ — আবার লগইন করুন।", en: "Session expired — please log in again." },
  confirmTitle: { bn: "আপনি কি নিশ্চিত?", en: "Are you sure?" },
  // Honest about what the queue actually covers (ADR-0009): only cart writes
  // are queueable today — farm/sell/booking screens refuse while offline.
  offlineBanner: { bn: "অফলাইন — কার্টের পরিবর্তনগুলো সংরক্ষিত হবে", en: "Offline — cart changes will queue" },
  // A queued write the server refuses permanently (4xx) is discarded — say so
  // instead of only console.warn. {item} is one of queuedItem*.
  queuedChangeDropped: { bn: "অফলাইনে করা {item} পরিবর্তনটি সংরক্ষণ করা যায়নি — বাদ দেওয়া হয়েছে।", en: "Your offline {item} change could not be saved — it was discarded." },
  queuedItemFarmEvent: { bn: "খামার রেকর্ড", en: "farm record" },
  notFoundTitle: { bn: "পাতাটি পাওয়া যায়নি", en: "Page not found" },
  notFoundBody: { bn: "আপনি যে ঠিকানাটি খুঁজছেন সেটি নেই বা সরানো হয়েছে।", en: "The address you are looking for doesn't exist or was moved." },
  backHome: { bn: "হোমে ফিরে যান", en: "Go back home" },
  skipToContent: { bn: "স্কিপ করুন", en: "Skip to content" },
  // Screen-reader name for the shell's primary nav (components/ui.tsx BottomNav).
  primaryNavAria: { bn: "প্রধান নেভিগেশন", en: "Primary navigation" },
  // The two nav landmarks (sidebar at md+, bottom bar below md) have to be
  // nameable apart; without this key the sidebar rendered as a bare `nav`.
  sidebarNavAria: { bn: "সাইডবার নেভিগেশন", en: "Sidebar navigation" },
  // Accessible name for the dot on the wallet tab: it counts offline writes still
  // waiting to sync, which is not what the old hardcoded "new notifications" said.
  queuePendingBadge: {
    bn: "ওয়ালেটে {n}টি অফলাইন পরিবর্তন সিঙ্ক হওয়ার অপেক্ষায়",
    en: "{n} offline change(s) on your wallet are waiting to sync",
  },

  // ── Procurement status enums ──
  statusPENDING: { bn: "অপেক্ষমাণ", en: "Pending" },
  statusAPPROVED: { bn: "অনুমোদিত", en: "Approved" },
  statusREJECTED: { bn: "প্রত্যাখ্যাত", en: "Rejected" },
  statusQC_HOLD: { bn: "গুণগত যাচাইয়ে আটকে আছে", en: "On QC hold" },
  statusSETTLED: { bn: "নিষ্পত্তি হয়েছে", en: "Settled" },
  statusPAID: { bn: "পরিশোধিত", en: "Paid" },
  statusCANCELLED: { bn: "বাতিল", en: "Cancelled" },
  statusCONFIRMED: { bn: "নিশ্চিত হয়েছে", en: "Confirmed" },
  statusSHIPPED: { bn: "পাঠানো হয়েছে", en: "Shipped" },
  statusDELIVERED: { bn: "ডেলিভারি হয়েছে", en: "Delivered" },
  statusUNPAID: { bn: "অপরিশোধিত", en: "Unpaid" },
  statusREFUNDED: { bn: "ফেরত দেওয়া হয়েছে", en: "Refunded" },

  // ── Wallet transaction reason enums ──
  walletTOPUP: { bn: "টাকা যোগ", en: "Top-up" },
  walletWITHDRAWAL: { bn: "টাকা তোলা", en: "Withdrawal" },
  walletPAYMENT: { bn: "পেমেন্ট", en: "Payment" },
  walletSALE_PROCEEDS: { bn: "বিক্রয়ের অর্থ", en: "Sale proceeds" },
  walletMEMBERSHIP_FEE: { bn: "মেম্বারশিপ ফি", en: "Membership fee" },
  walletREFUND: { bn: "ফেরত", en: "Refund" },
  walletADJUSTMENT: { bn: "সমন্বয়", en: "Adjustment" },

  // ── User roles ──
  // One label per role in contracts/roles.json. Nine of these roles are issued by
  // the server but had no label, so an operator table or an audit row showing one
  // rendered the raw enum ("REGIONAL_MANAGER"). The vocabulary guard test keeps
  // this list in step with the contract.
  roleFARMER: { bn: "কৃষক", en: "Farmer" },
  roleQC_OFFICER: { bn: "গুণগত পরিদর্শক", en: "QC Officer" },
  roleADMIN: { bn: "অ্যাডমিন", en: "Admin" },
  roleSUPER_ADMIN: { bn: "সুপার অ্যাডমিন", en: "Super Admin" },
  roleREGIONAL_MANAGER: { bn: "আঞ্চলিক ব্যবস্থাপক", en: "Regional Manager" },
  roleAREA_MANAGER: { bn: "এলাকা ব্যবস্থাপক", en: "Area Manager" },
  rolePROCUREMENT_MANAGER: { bn: "ক্রয় ব্যবস্থাপক", en: "Procurement Manager" },
  roleWAREHOUSE_MANAGER: { bn: "গুদাম ব্যবস্থাপক", en: "Warehouse Manager" },
  roleCOLLECTION_MANAGER: { bn: "সংগ্রহ ব্যবস্থাপক", en: "Collection Manager" },
  roleFIELD_AGENT: { bn: "মাঠকর্মী", en: "Field Agent" },
  roleDEALER: { bn: "ডিলার", en: "Dealer" },
  roleCORPORATE: { bn: "কর্পোরেট", en: "Corporate" },
  roleCOOPERATIVE: { bn: "সমবায়", en: "Cooperative" },

  // ── Notification categories ──
  notifCategoryCRITICAL: { bn: "অত্যন্ত গুরুত্বপূর্ণ", en: "Critical" },
  notifCategoryACTION: { bn: "পদক্ষেপ প্রয়োজন", en: "Action needed" },
  notifCategoryINFO: { bn: "তথ্য", en: "Info" },

  // ── Weather advisory types → action lines ──
  weatherSPRAY_RAIN: { bn: "বৃষ্টির কারণে স্প্রে পিছিয়ে দিন", en: "Postpone spraying due to rain" },
  weatherIRRIGATION_RAIN: { bn: "আসন্ন বৃষ্টির কারণে সেচ বন্ধ রাখুন", en: "Hold off irrigation — rain is coming" },
  weatherHAIL: { bn: "শিলাবৃষ্টির সতর্কতা — ফসল ঢেকে রাখুন ও জরুরি সংবাদ রাখুন", en: "Hail alert — cover crops and stay tuned for updates" },
  weatherDRAINAGE: { bn: "জমা পানি সরান — জমির আড়া পরিষ্কার রাখুন", en: "Drain standing water — clear field channels" },
  weatherHEAT_STRESS: { bn: "তীব্র গরম — সকাল-বিকেলে হালকা সেচ দিন", en: "Heat stress — apply light irrigation in morning/late afternoon" },
  weatherSTRONG_WIND: { bn: "দমকা হাওয়া — ঝুঁকিপূর্ণ ফসলে বেষ্টনী দিন", en: "Strong wind — stake or shelter vulnerable crops" },
  weatherFOG: { bn: "কুয়াশা — ছত্রাকনাশক স্প্রেয়ের উপযুক্ত সময় নয়", en: "Foggy conditions — avoid fungicide spraying now" },
  weatherDROUGHT: { bn: "খরার ঝুঁকি — মালচিং করুন ও পানি সংরক্ষণ করুন", en: "Drought risk — mulch and conserve soil moisture" },
  weatherCOLD_WAVE: { bn: "শৈত্যপ্রবাহ — বীজতলা পলি দিয়ে ঢেকে রাখুন", en: "Cold wave — cover seedbeds with polythene" },
  weatherGENERAL: { bn: "আবহাওয়া অনুযায়ী ফার্ম পরিদর্শন করুন", en: "Inspect your farm as conditions change" },

  // ── Structured advisor sections ──
  advisorCause: { bn: "কারণ", en: "Cause" },
  advisorWhy: { bn: "কেন", en: "Why" },
  advisorDoNow: { bn: "এখন যা করবেন", en: "What to do now" },
  advisorCaution: { bn: "সতর্কতা", en: "Caution" },
  advisorSource: { bn: "তথ্যসূত্র", en: "Source" },

  // ── Checkout wizard steps ──
  checkoutStepCart: { bn: "কার্ট", en: "Cart" },
  checkoutStepDelivery: { bn: "ডেলিভারি", en: "Delivery" },
  checkoutStepPayment: { bn: "পেমেন্ট", en: "Payment" },
  checkoutStepReview: { bn: "পুনরায় দেখুন", en: "Review" },
  checkoutPlaceOrder: { bn: "অর্ডার নিশ্চিত করুন", en: "Place order" },
  checkoutOrderPlaced: { bn: "অর্ডার সফলভাবে জমা হয়েছে ✓", en: "Order placed successfully ✓" },

  // ── Sell-crop pipeline (stepper) ──
  sellStepOffer: { bn: "অফার জমা", en: "Offer submitted" },
  sellStepQc: { bn: "গুণগত যাচাই", en: "Quality check" },
  sellStepPrice: { bn: "দর নির্ধারণ", en: "Pricing" },
  sellStepPayment: { bn: "পেমেন্ট", en: "Payment" },
  sellStepSettled: { bn: "নিষ্পত্তি", en: "Settled" },

  // ── Withdrawal ──
  withdrawTitle: { bn: "টাকা তুলুন", en: "Withdraw money" },
  withdrawAmountLabel: { bn: "টাকার পরিমাণ (৳)", en: "Amount (৳)" },
  withdrawMethodLabel: { bn: "তোলার মাধ্যম", en: "Withdrawal method" },
  withdrawMethodBKASH: { bn: "বিকাশ", en: "bKash" },
  withdrawMethodNAGAD: { bn: "নগদ", en: "Nagad" },
  withdrawMethodBANK: { bn: "ব্যাংক অ্যাকাউন্ট", en: "Bank account" },
  withdrawMinNote: { bn: "সর্বনিম্ন উত্তোলন ৳১০০", en: "Minimum withdrawal ৳100" },
  withdrawFeeLabel: { bn: "উত্তোলন চার্জ", en: "Withdrawal fee" },
  withdrawAvailable: { bn: "উত্তোলনযোগ্য ব্যালেন্স", en: "Available balance" },
  withdrawRequestBtn: { bn: "উত্তোলনের অনুরোধ", en: "Request withdrawal" },
  withdrawRequestedToast: { bn: "উত্তোলনের অনুরোধ জমা হয়েছে — ১-৩ কার্যদিবসে প্রক্রিয়া হবে।", en: "Withdrawal request submitted — processed within 1–3 business days." },
  withdrawHistory: { bn: "উত্তোলনের ইতিহাস", en: "Withdrawal history" },

  // ── Notification preferences ──
  prefsTitle: { bn: "নোটিফিকেশন সেটিংস", en: "Notification preferences" },
  prefsDescription: { bn: "কোন ধরনের খবর কীভাবে পাবেন তা ঠিক করুন।", en: "Choose which updates you receive and how." },
  prefCategoryCritical: { bn: "অত্যন্ত গুরুত্বপূর্ণ সতর্কতা", en: "Critical alerts" },
  prefCategoryAction: { bn: "পদক্ষেপ প্রয়োজন এমন বার্তা", en: "Action-needed messages" },
  prefCategoryInfo: { bn: "সাধারণ তথ্য", en: "General info" },
  prefChannelPush: { bn: "অ্যাপ নোটিফিকেশন", en: "App push" },
  prefChannelSms: { bn: "এসএমএস", en: "SMS" },
  prefChannelEmail: { bn: "ইমেইল", en: "Email" },
  prefsSavedToast: { bn: "নোটিফিকেশন সেটিংস সংরক্ষিত ✓", en: "Notification preferences saved ✓" },

  // ── Admin regions ──
  adminRegionsTitle: { bn: "অঞ্চল ব্যবস্থাপনা", en: "Region management" },
  adminAddRegion: { bn: "নতুন অঞ্চল যোগ করুন", en: "Add region" },
  adminEditRegion: { bn: "অঞ্চল সম্পাদনা", en: "Edit region" },
  adminRegionNameBn: { bn: "অঞ্চলের নাম (বাংলা)", en: "Region name (Bengali)" },
  adminRegionNameEn: { bn: "অঞ্চলের নাম (ইংরেজি)", en: "Region name (English)" },
  adminDistrictsLabel: { bn: "জেলাসমূহ (কমা দিয়ে আলাদা করুন)", en: "Districts (comma-separated)" },
  regionSavedToast: { bn: "অঞ্চল সংরক্ষিত হয়েছে ✓", en: "Region saved ✓" },
  regionDeletedToast: { bn: "অঞ্চল মুছে ফেলা হয়েছে", en: "Region deleted" },
  deleteRegionConfirmBody: { bn: "এই অঞ্চলটি মুছে ফেললে এর সাথে যুক্ত কভারেজও সরে যাবে।", en: "Deleting this region also removes its coverage mapping." },

  // ── Misc pages ──
  onboarding: { bn: "প্রোফাইল সেটআপ", en: "Profile setup" },

  // ── Error code mapping (lib/errors-ui.ts) ──
  errForbidden: { bn: "এই কাজের অনুমতি নেই।", en: "You don't have permission for this action." },
  errPhoneNotVerified: { bn: "এই কাজের আগে মোবাইল নম্বর যাচাই করাতে হবে।", en: "Your phone number must be verified before this action." },
  errNotFoundGeneric: { bn: "তথ্যটি পাওয়া যায়নি।", en: "The requested item was not found." },
  errRateLimited: { bn: "অনেকবার চেষ্টা হয়েছে — কিছুক্ষণ পরে আবার চেষ্টা করুন।", en: "Too many attempts — please try again later." },
  errInsufficientStock: { bn: "দুঃখিত — পর্যাপ্ত স্টক নেই।", en: "Sorry — insufficient stock." },
  errInsufficientBalance: { bn: "উত্তোলনযোগ্য ব্যালেন্স পর্যাপ্ত নয় (অপেক্ষমাণ উত্তোলন বাদে)।", en: "Insufficient available balance (excluding pending withdrawals)." },
  errActiveCrop: { bn: "এই প্লটের একটি সক্রিয় ফসল আছে।", en: "This plot already has an active crop." },
  errBookingConflict: { bn: "এই সেবার একটা বুকিং আগেই আছে।", en: "A booking for this service already exists." },
  errCartConflict: { bn: "কোনো কারণে কার্টে যোগ করা যাচ্ছে না।", en: "Unable to add to cart — please try again." },
  errOfferConflict: { bn: "এই অফারের আগেই একটি প্রক্রিয়াধীন অবস্থা আছে।", en: "There is already a pending process for this offer." },
  referenceLabel: { bn: "রেফারেন্স", en: "Reference" },

  // ── Form validation ──
  errFieldRequired: { bn: "এই ঘরটি পূরণ করুন।", en: "This field is required." },
  errNameTooShort: { bn: "নাম কমপক্ষে ২ অক্ষরের হতে হবে।", en: "Name must be at least 2 characters." },
  errAmountInvalid: { bn: "সঠিক পরিমাণ (টাকা) লিখুন।", en: "Enter a valid amount in taka." },
  // Not the same as errAmountInvalid: the sell-crop field asks for kilos, and
  // telling a farmer the invalid value is "in taka" names the wrong unit.
  errQuantityInvalid: { bn: "সঠিক পরিমাণ (কেজি) লিখুন।", en: "Enter a valid quantity in kg." },
  errAreaInvalid: { bn: "সঠিক জমির পরিমাণ দিন।", en: "Enter a valid land area." },
  errDateFuture: { bn: "সময় অবশ্যই ভবিষ্যতে হতে হবে।", en: "Time must be in the future." },
  fixErrorsNote: { bn: "চিহ্নিত ভুলগুলো ঠিক করে আবার চেষ্টা করুন।", en: "Fix the highlighted errors and try again." },
  // Server field-message patterns → localized sentence ({label} = field label).
  errValidationRequired: { bn: "{label} প্রয়োজন", en: "{label} is required" },
  errValidationInvalid: { bn: "{label} সঠিক নয়", en: "{label} is invalid" },
  errValidationTooShort: { bn: "{label} খুব ছোট", en: "{label} is too short" },
  errValidationTooLong: { bn: "{label} খুব বড়", en: "{label} is too long" },
  errValidationNumber: { bn: "{label} সংখ্যা হতে হবে", en: "{label} must be a number" },
  errValidationPositive: { bn: "{label} শূন্যের বেশি হতে হবে", en: "{label} must be greater than 0" },
  errValidationEmailUrl: { bn: "{label} বৈধ নয়", en: "{label} is not valid" },
  errValidationDuplicate: { bn: "{label} ইতিমধ্যে বিদ্যমান", en: "{label} already exists" },
  errValidationPassword: { bn: "পাসওয়ার্ড সঠিক নয়", en: "Incorrect password" },
  // ErrorBanner copy affordance (Login/Register pass these explicitly).
  errCopy: { bn: "কপি", en: "Copy" },
  errCopied: { bn: "কপি হয়েছে!", en: "Copied!" },

  // ── Home ──
  // No 👋. It was the last emoji in the UI and it sat in an <h1>, so the page's
  // most prominent line carried a decorative glyph while every icon in the app is
  // a lucide component; it also rendered inconsistently across the self-hosted
  // Bengali font faces. The greeting itself is warm enough.
  greeting: { bn: "আসসালামু আলাইকুম, {name}", en: "Hello, {name}" },
  todayTasks: { bn: "আজকের কাজ", en: "Today's tasks" },
  taskWaterCheck: { bn: "জমিতে পানি পরীক্ষা করুন", en: "Check field water level" },
  taskPestScout: { bn: "পোকা/রোগ পর্যবেক্ষণ", en: "Scout for pests/disease" },
  weatherFavorable: { bn: "আবহাওয়া অনুকূল", en: "Weather favorable" },
  // A failed weather read is its own state, not an empty one: the dashboard used
  // to print a bare "—", which is indistinguishable from "no reading available".
  weatherUnavailable: { bn: "আবহাওয়ার তথ্য পাওয়া যায়নি", en: "Weather data is unavailable" },
  // The same rule for the other reads a screen can fail to complete. Each of these
  // exists because its absence let the UI assert something the app did not know:
  // "add your first farm" when the farm list had merely failed to load, a readiness
  // basis claiming weather when weather was missing, "weather favourable" with no
  // advisory payload at all, and an unread badge reading "0" after a failed read.
  farmDataUnavailable: { bn: "খামারের তথ্য পাওয়া যায়নি", en: "Farm data is unavailable" },
  farmDataUnavailableSub: {
    bn: "আপনার খামারের তথ্য আনা যায়নি, তাই প্রস্তুতি দেখানো হচ্ছে না। উপরে আবার চেষ্টা করুন।",
    en: "Your farm records could not be loaded, so readiness is not shown. Retry above.",
  },
  farmReadinessBasisNoWeather: {
    bn: "শুধু আপনার খামারের রেকর্ডের ভিত্তিতে",
    en: "From your farm records only",
  },
  alertsUnavailable: {
    bn: "আবহাওয়ার সতর্কতা পাওয়া যায়নি — আবহাওয়ার তথ্য আনা যায়নি।",
    en: "Weather advisories are unavailable — the reading could not be loaded.",
  },
  unreadCountUnavailable: { bn: "আনপড়া সংখ্যা জানা যায়নি", en: "Unread count unavailable" },
  // Accessible name for the AI chat transcript live region (role="log").
  advisorTranscriptLabel: { bn: "এআই কথোপকথন", en: "AI conversation" },
  // Screen-reader-only heading for the marketplace product grid (its cards are
  // h3 under the page h1, so the grid needs an h2 of its own).
  marketCatalogSr: { bn: "পণ্যের তালিকা", en: "Product catalogue" },
  // Text equivalent for the unread-notification tint, which was colour-only.
  notifUnread: { bn: "না পড়া", en: "Unread" },
  regularFarmVisit: { bn: "নিয়মিত ফার্ম পরিদর্শন করুন", en: "Regular farm visit" },
  viewDetails: { bn: "বিস্তারিত দেখুন", en: "View details" },
  viewTransactions: { bn: "লেনদেন দেখুন", en: "View transactions" },
  growthStage: { bn: "বৃদ্ধি পর্যায়ে", en: "Growth stage" },
  quickAiSub: { bn: "প্রশ্ন করুন, সমাধান পান", en: "Ask, get solutions" },
  quickServiceSub: { bn: "ড্রোন, ট্র্যাক্টর, হারভেস্টার", en: "Drone, Tractor, Harvester" },
  quickSellSub: { bn: "আপনার ফসল বিক্রি করুন", en: "Sell your crops" },
  quickNotifSub: { bn: "গুরুত্বপূর্ণ আপডেট", en: "Important updates" },
  aiFarmHealthy: { bn: "আপনার ফার্ম সুস্থ আছে", en: "Your farm is healthy" },
  farmReadiness: { bn: "খামার প্রস্তুতি", en: "Farm readiness" },
  farmReadinessBasis: { bn: "আপনার তথ্য ও আজকের আবহাওয়ার ভিত্তিতে", en: "From your records and today's weather" },
  aiFarmEmptyTitle: { bn: "শুরু করতে খামার যোগ করুন", en: "Add a farm to get started" },
  aiFarmEmptySub: { bn: "খামার যোগ করলে ফসলের ধাপ, কাজের সময়সূচি ও পরামর্শ দেখতে পাবেন।", en: "Add a farm to see crop stages, a task calendar and advice." },
  aiFarmEmptyMeter: { bn: "খামার যোগ করলে প্রস্তুতি দেখা যাবে", en: "Readiness appears once a farm exists" },
  aiAskTitle: { bn: "এগ্রোব্রিজ AI-কে জিজ্ঞাসা করুন", en: "Ask AgroBridge AI" },
  aiAskSubtitle: { bn: "আজ আপনার ফার্মের জন্য কীভাবে সাহায্য করতে পারি?", en: "How can I help your farm today?" },
  aiActionDiagnose: { bn: "রোগের ছবি পাঠান", en: "Send disease photo" },
  aiActionPlant: { bn: "কী রোপণ করব?", en: "What to plant?" },
  aiActionFertilizer: { bn: "সার পরামর্শ", en: "Fertilizer advice" },
  aiActionWeather: { bn: "আবহাওয়া পরামর্শ", en: "Weather advice" },
  alertsTitle: { bn: "স্মার্ট সতর্কতা", en: "Smart Alerts" },
  viewAllTasks: { bn: "সব কাজ দেখুন", en: "View all tasks" },
  deleteOrder: { bn: "অর্ডার মুছুন", en: "Delete order" },
  deleteOrderConfirm: { bn: "এই অর্ডারটি আপনার তালিকা থেকে মুছে ফেলা হবে।", en: "This order will be removed from your list." },
  orderDeletedToast: { bn: "অর্ডার মুছে ফেলা হয়েছে", en: "Order deleted" },
  alertRain: { bn: "আগামীকাল ভারী বৃষ্টির সম্ভাবনা — কীটনাশক আজ এড়িয়ে চলুন", en: "Heavy rain tomorrow — avoid pesticide today" },
  alertPest: { bn: "পোকা ঝুঁকি বাড়ছে — প্রতিরোধমূলক ব্যবস্থা নিন", en: "Pest risk rising — take preventive action" },
  setupBanner: { bn: "শুরু করতে ১ মিনিটের সেটআপ করুন", en: "Get set up in 1 minute" },
  getStarted: { bn: "শুরু করুন", en: "Get started" },
  activeCropsTitle: { bn: "চলমান ফসল", en: "Active crops" },
  noCropsYet: { bn: "কোনো ফসল নেই।", en: "No crops yet." },
  availableBalance: { bn: "উপলব্ধ ব্যালেন্স", en: "Available balance" },
  humidityLabel: { bn: "আর্দ্রতা", en: "Humidity" },
  windLabel: { bn: "বাতাস", en: "Wind" },
  quickActions: { bn: "দ্রুত সেবা", en: "Quick services" },
  farmOverview: { bn: "ফার্ম সারসংক্ষেপ", en: "Farm overview" },
  kpiActiveCrops: { bn: "চলমান ফসল", en: "Active crops" },
  kpiUnreadNotif: { bn: "অপঠিত বার্তা", en: "Unread alerts" },
  kpiFarms: { bn: "ফার্ম", en: "Farms" },
  weatherSpotlight: { bn: "আজকের আবহাওয়া ও সতর্কতা", en: "Today's weather & advisories" },
  noAdvisory: { bn: "কোনো গুরুত্বপূর্ণ সতর্কতা নেই।", en: "No active advisories." },
  stageSEED: { bn: "বীজ", en: "Seed" },
  stageGERMINATION: { bn: "অঙ্কুরোদগম", en: "Germination" },
  stageVEGETATIVE: { bn: "বৃদ্ধি", en: "Vegetative" },
  stageFLOWERING: { bn: "ফুল ফোটা", en: "Flowering" },
  stageGRAIN_FRUIT_DEVELOPMENT: { bn: "দানা/ফল গঠন", en: "Grain/fruit development" },
  stageHARVEST: { bn: "ফসল তোলা", en: "Harvest" },
  weatherRiskSPRAY_WARNING: { bn: "→ আজ স্প্রে স্থগিত রাখুন", en: "→ postpone spraying today" },
  weatherRiskRAIN_WARNING: { bn: "→ সেচ বন্ধ রাখুন, নিষ্কাশন পরিষ্কার রাখুন", en: "→ hold irrigation, clear drainage" },
  weatherRiskHEAT_WARNING: { bn: "→ সকাল-বিকেলে হালকা সেচ দিন", en: "→ light irrigation morning/evening" },
  weatherRiskIRRIGATION_ADVICE: { bn: "→ ফসলের পানির চাহিদা অনুযায়ী সেচ দিন", en: "→ irrigate per crop water demand" },
  weatherRiskDISEASE_RISK: { bn: "→ প্রতিরোধমূলক ছত্রাকনাশক বিবেচনা করুন", en: "→ consider preventive fungicide" },
  weatherRiskINFO: { bn: "→ নিয়মিত ফার্ম পরিদর্শন করুন", en: "→ keep up regular farm visits" },
  // ── Weather provenance) — when the data was fetched, from
  // which source, and whether it is a cached copy. The time shown is the
  // ORIGINAL fetch time even on a cache hit; the cached copy is labelled.
  weatherAsOf: { bn: "আবহাওয়া তথ্য: {time}", en: "Weather as of {time}" },
  weatherCachedCopy: { bn: "সংরক্ষিত কপি", en: "cached copy" },

  // ── Market / checkout wizard ──
  catAll: { bn: "সব", en: "All" },
  catSEED: { bn: "বীজ", en: "Seeds" },
  catFERTILIZER: { bn: "সার", en: "Fertilizer" },
  catBIO_INPUT: { bn: "জৈব উপকরণ", en: "Bio-inputs" },
  catCROP_PROTECTION: { bn: "কীটনাশক", en: "Crop protection" },
  catEQUIPMENT: { bn: "যন্ত্রপাতি", en: "Equipment" },
  stockLeft: { bn: "স্টক: {n}", en: "Stock: {n}" },
  outOfStock: { bn: "স্টক নেই", en: "Out of stock" },
  addToCart: { bn: "কার্টে যোগ করুন", en: "Add to cart" },
  addedToCart: { bn: "কার্টে যোগ হয়েছে", en: "Added to cart" },
  incrQty: { bn: "পরিমাণ বাড়ান", en: "Increase quantity" },
  decrQty: { bn: "পরিমাণ কমান", en: "Decrease quantity" },
  removeItem: { bn: "কার্ট থেকে অপসারণ", en: "Remove from cart" },
  emptyCart: { bn: "কার্ট খালি — পণ্য যোগ করুন।", en: "Your cart is empty — add products first." },
  noProducts: { bn: "এই ক্যাটাগরিতে পণ্য নেই।", en: "No products in this category yet." },
  marketNoProductsDesc: { bn: "অন্য ক্যাটাগরিতে দেখতে ফিল্টার বদলান।", en: "Try a different category to see more products." },
  notifUnreadSr: { bn: "টি অপঠিত নোটিফিকেশন", en: "unread notifications" },
  notifCountSr: { bn: "টি নোটিফিকেশন", en: "notifications" },
  adminNoEntries: { bn: "কোনো এন্ট্রি নেই।", en: "No entries yet." },
  total: { bn: "মোট", en: "Total" },
  orderSubtotal: { bn: "সাব-টোটাল", en: "Subtotal" },
  orderDiscount: { bn: "ছাড় (মেম্বারশিপ)", en: "Discount (membership)" },
  orderDeliveryFee: { bn: "ডেলিভারি চার্জ", en: "Delivery fee" },
  freeLabel: { bn: "ফ্রি", en: "Free" },
  cartItemsCount: { bn: "কার্ট ({n})", en: "Cart ({n})" },
  qtyShort: { bn: "পরিমাণ", en: "Qty" },
  checkoutOrderNo: { bn: "অর্ডার নং: {no}", en: "Order no.: {no}" },
  deliveryAddressLabel: { bn: "ডেলিভারি ঠিকানা", en: "Delivery address" },
  addressLabel: { bn: "ঠিকানা", en: "Address" },
  sandboxPaymentNote: { bn: "স্যান্ডবক্স মোড — কোনো প্রকৃত অর্থ লেনদেন হবে না।", en: "Sandbox mode — no real money will move." },
  paymentSuccessTitle: { bn: "পেমেন্ট সম্পন্ন হয়েছে ✓", en: "Payment complete ✓" },
  paymentPendingNote: { bn: "অর্ডার তৈরি হয়েছে — অনলাইন পেমেন্ট শীঘ্রই চালু হবে; এর আগে নোটিফিকেশন দেখুন।", en: "Order created — online payment is coming soon; watch your notifications meanwhile." },
  checkoutStepSuccess: { bn: "সম্পন্ন", en: "Success" },

  // Payment records shown in the wallet (payments module, read-only merge)
  paymentPurposeORDER: { bn: "অর্ডার পেমেন্ট", en: "Order payment" },
  paymentPurposeBOOKING: { bn: "সেবা বুকিং পেমেন্ট", en: "Service booking payment" },
  paymentPurposePROCUREMENT: { bn: "ফসল বিক্রির পেমেন্ট", en: "Crop sale payment" },

  // ── Wallet page ──
  balance: { bn: "ব্যালেন্স", en: "Balance" },
  monthIn: { bn: "এই মাসে আয়", en: "In this month" },
  monthOut: { bn: "এই মাসে খরচ", en: "Out this month" },
  pendingWithdrawals: { bn: "অপেক্ষমাণ উত্তোলন", en: "Pending withdrawals" },
  transactionsTitle: { bn: "লেনদেন", en: "Transactions" },
  noTransactions: { bn: "কোনো লেনদেন নেই।", en: "No transactions yet." },
  membershipConfirmTitle: { bn: "মেম্বারশিপ কিনবেন?", en: "Buy this membership?" },
  // No sandbox wording here: the provider mode is only known after the intent
  // response (server-reported `providerMode`), not before the confirm dialog.
  // Tier labels live here (not labels.ts) so the tier axis sits with the copy it
  // belongs to; Wallet's plan heading, the confirm body and the admin table all
  // used to print the raw enum ("BASIC"/"GOLD") — the one axis without a map.
  membershipTierBasic: { bn: "বেসিক", en: "Basic" },
  membershipTierSilver: { bn: "সিলভার", en: "Silver" },
  membershipTierGold: { bn: "গোল্ড", en: "Gold" },
  membershipConfirmBody: { bn: "{tier} প্ল্যানের জন্য {price} পরিশোধ করতে হবে।", en: "{price} will be charged for the {tier} plan." },
  membershipActiveToast: { bn: "{tier} মেম্বারশিপ সক্রিয় (স্যান্ডবক্স)।", en: "{tier} membership activated (sandbox)." },
  membershipExpired: { bn: "মেম্বারশিপ মেয়াদ শেষ", en: "Membership expired" },
  noWithdrawalsYet: { bn: "কোনো উত্তোলনের ইতিহাস নেই।", en: "No withdrawal history yet." },
  channelLabel: { bn: "মাধ্যম", en: "Channel" },
  destinationLabel: { bn: "গন্তব্য", en: "Destination" },

  // ── Advisor page ──
  advisoryDisclaimer: { bn: "এআই উত্তর পরামর্শমূলক — ওষুধ/সার প্রয়োগের আগে কৃষি কর্মকর্তার সাথে যাচাই করুন।", en: "AI answers are advisory — verify treatments with an agronomist before applying." },
  imageTooLarge: { bn: "ছবি ৮MB-এর কম হতে হবে।", en: "Image must be under 8MB." },
  exampleQuestion: { bn: "যেমনঃ “ধানের পাতায় blast রোগ দেখছে, কী করব?”", en: 'Try: "Rice leaves show blast lesions, what should I do?"' },
  groundedAnswer: { bn: "গ্রাউন্ডেড উত্তর", en: "Grounded answer" },
  supportHigh: { bn: "উৎস মিল: ভালো", en: "Source match: good" },
  supportModerate: { bn: "উৎস মিল: মাঝারি", en: "Source match: moderate" },
  myCases: { bn: "আমার রোগের ছবি", en: "My disease photos" },
  showLess: { bn: "কম দেখুন", en: "Show less" },
  expandDetails: { bn: "বিস্তারিত দেখুন", en: "Expand details" },
  collapseDetails: { bn: "বিস্তারিত লুকান", en: "Collapse details" },
  compressingImage: { bn: "ছবি প্রস্তুত করা হচ্ছে...", en: "Preparing image..." },
  questionInputLabel: { bn: "আপনার প্রশ্ন", en: "Your question" },
  // Which provider/mode answered and the KB content version it
  // was grounded in. Never a score/percentage — see supportLabel.ts.
  advisorModeKb: { bn: "নলেজ বেস (KB)", en: "Knowledge base (KB)" },
  advisorModeAi: { bn: "AI মডেল", en: "AI model" },
  advisorKbVersion: { bn: "KB সংস্করণ {v}", en: "KB version {v}" },
  // Advisory history + report-a-problem. Feedback rows come from
  // GET /ai/history (the only surface that carries row ids).
  advisorHistory: { bn: "আগের পরামর্শের ইতিহাস", en: "Past advisory history" },
  advisorNoHistory: { bn: "কোনো আগের পরামর্শ নেই।", en: "No previous advisories yet." },
  reportIssue: { bn: "এই উত্তরের সমস্যা জানান", en: "Report an issue about this answer" },
  reportIssueTitle: { bn: "সমস্যা জানান", en: "Report an issue" },
  reportIssueBody: { bn: "এই উত্তরটি কোথায় ভুল বা অস্পষ্ট ছিল সংক্ষেপে লিখুন।", en: "Briefly say what was wrong or unclear about this answer." },
  reportReasonLabel: { bn: "সমস্যার বিবরণ", en: "What was wrong" },
  reportSubmit: { bn: "রিপোর্ট পাঠান", en: "Send report" },
  feedbackThanks: { bn: "ধন্যবাদ — আপনার রিপোর্ট সংরক্ষিত হয়েছে।", en: "Thanks — the report was recorded." },
  feedbackReported: { bn: "রিপোর্ট করা হয়েছে", en: "Reported" },

  // ── Notifications page ──
  markAllRead: { bn: "সব পড়া হয়েছে", en: "Mark all read" },
  noNotifications: { bn: "কোনো নোটিফিকেশন নেই।", en: "No notifications." },
  tabAll: { bn: "সব", en: "All" },

  // ── Services page ──
  needFarmFirst: { bn: "বুকিং দিতে আগে “আমার ফার্ম”-এ ফার্ম যোগ করুন।", en: 'Add a farm under "My Farm" before booking.' },
  bookingReceivedToast: { bn: "বুকিং গৃহীত হয়েছে!", en: "Booking received!" },
  farmLabel: { bn: "ফার্ম", en: "Farm" },
  scheduleLabel: { bn: "সময় নির্বাচন", en: "Schedule" },
  providerDefaultOption: { bn: "সেবাদাতা (পরে নিয়োগ)", en: "Provider (assign later)" },
  providerLabel: { bn: "সেবাদাতা", en: "Provider" },
  estimatedPrice: { bn: "আনুমানিক মূল্য", en: "Estimated price" },
  myBookings: { bn: "আমার বুকিং", en: "My bookings" },
  noBookings: { bn: "কোনো বুকিং নেই।", en: "No bookings yet." },
  cancelBooking: { bn: "বুকিং বাতিল করুন", en: "Cancel booking" },
  cancelBookingBody: { bn: "বাতিল করলে এই সেবার সময়সূচি বাতিল হয়ে যাবে।", en: "Cancelling will void this service schedule." },
  bookingCancelledToast: { bn: "বুকিং বাতিল হয়েছে।", en: "Booking cancelled." },
  svcDRONE: { bn: "ড্রোন সেবা", en: "Drone service" },
  svcTRACTOR: { bn: "ট্রাক্টর", en: "Tractor" },
  svcCOMBINE_HARVESTER: { bn: "কম্বাইন হারভেস্টার", en: "Combine harvester" },
  svcRICE_TRANSPLANTER: { bn: "ধান রোপণ যন্ত্র", en: "Rice transplanter" },
  svcPOWER_TILLER: { bn: "পাওয়ার টিলার", en: "Power tiller" },
  svcLAND_LEVELLER: { bn: "জমি সমকরণ যন্ত্র", en: "Land leveller" },
  svcTHRESHER: { bn: "মাড়াই যন্ত্র", en: "Thresher" },
  svcSOIL_TESTING: { bn: "মাটি পরীক্ষা", en: "Soil testing" },
  svcAGRONOMIST: { bn: "কৃষি বিশেষজ্ঞ", en: "Agronomist" },
  svcOTHER: { bn: "অন্যান্য", en: "Other" },
  unitPER_BIGHA: { bn: "/ বিঘা", en: "/ bigha" },
  unitPER_ACRE: { bn: "/ একর", en: "/ acre" },
  unitPER_HOUR: { bn: "/ ঘণ্টা", en: "/ hour" },
  unitPER_DAY: { bn: "/ দিন", en: "/ day" },
  unitPER_VISIT: { bn: "/ ভিজিট", en: "/ visit" },
  unitPER_SAMPLE: { bn: "/ নমুনা", en: "/ sample" },
  unitPER_MAUND: { bn: "/ মণ", en: "/ maund" },
  unitPER_KG: { bn: "/ কেজি", en: "/ kg" },
  bsREQUESTED: { bn: "অনুরোধকৃত", en: "Requested" },
  bsASSIGNED: { bn: "নিয়োজিত", en: "Assigned" },
  bsIN_PROGRESS: { bn: "চলমান", en: "In progress" },
  bsCOMPLETED: { bn: "সম্পন্ন", en: "Completed" },

  // ── SellCrop pipeline ──
  myOffers: { bn: "আমার ফসলের অফার", en: "My crop offers" },
  noOffers: { bn: "এখনো কোনো অফার নেই।", en: "No offers yet." },
  offerSubmittedToast: { bn: "অফার জমা হয়েছে — গুণগত যাচাইয়ের অপেক্ষায়।", en: "Offer submitted — pending QC." },
  kgUnit: { bn: "কেজি", en: "kg" },
  gradeA: { bn: "গ্রেড A", en: "Grade A" },
  gradeB: { bn: "গ্রেড B", en: "Grade B" },
  gradeC: { bn: "গ্রেড C", en: "Grade C" },
  pipeSUBMITTED: { bn: "অফার জমা", en: "Offer" },
  pipeQC: { bn: "গুণগত যাচাই", en: "QC" },
  pipePO: { bn: "ক্রয়াদেশ", en: "Purchase order" },
  pipeCOLLECTED: { bn: "সংগ্রহ", en: "Collected" },
  pipePAID: { bn: "পরিশোধিত", en: "Paid" },
  submitOfferTitle: { bn: "অফার জমা করবেন?", en: "Submit this offer?" },
  submitOfferBody: { bn: "জমা দিলে {crop} · {qty} {unit} গুণগত যাচাইয়ের সারিতে যাবে।", en: "{crop} · {qty} {unit} will enter the quality-check queue." },
  cropRICE: { bn: "ধান", en: "Rice" },
  cropWHEAT: { bn: "গম", en: "Wheat" },
  cropJUTE: { bn: "পাট", en: "Jute" },
  cropMUSTARD: { bn: "সরিষা", en: "Mustard" },
  cropMAIZE: { bn: "ভুট্টা", en: "Maize" },
  cropPOTATO: { bn: "আলু", en: "Potato" },

  // ── MyFarm ──
  farmNamePh: { bn: "ফার্মের নাম", en: "Farm name" },
  districtPh: { bn: "জেলা", en: "District" },
  bighaShort: { bn: "বিঘা", en: "bigha" },
  plotNamePh: { bn: "প্লটের নাম", en: "Plot name" },
  soilTypePh: { bn: "মাটির ধরন", en: "Soil type" },
  noPlotsYet: { bn: "এখনো কোনো ফসল নাই।", en: "No crops on this plot yet." },
  noFarmsYet: { bn: "কোনো ফার্ম নেই — উপরের বোতাম থেকে যোগ করুন।", en: "No farms yet — use the button above to add one." },
  farmCreatedToast: { bn: "ফার্ম যোগ হয়েছে ✓", en: "Farm created ✓" },
  plotCreatedToast: { bn: "প্লট যোগ হয়েছে ✓", en: "Plot created ✓" },
  cropCreatedToast: { bn: "ফসল যোগ হয়েছে ✓", en: "Crop created ✓" },
  plantedAtLabel: { bn: "রোপণের তারিখ", en: "Planted on" },
  myFarmViewHarvester: { bn: "হারভেস্টার দেখুন", en: "View harvester" },
  myFarmViewInputs: { bn: "ইনপুট দেখুন", en: "View inputs" },
  myFarmAddFarmHint: { bn: "আপনার খামার যোগ করে ফসল ও কাজ এক জায়গায় পরিচালনা করুন।", en: "Add your farm to manage crops and tasks in one place." },
  myFarmCareOne: { bn: "আজ আপনার খামারে {n}টি ফসলের পরামর্শ আছে", en: "You have {n} farm care suggestion today" },
  myFarmCareMany: { bn: "আজ আপনার খামারে {n}টি ফসলের পরামর্শ আছে", en: "You have {n} farm care suggestions today" },
  myFarmTomorrowTitle: { bn: "আগামীকাল ও আসন্ন", en: "Tomorrow & upcoming" },
  myFarmTomorrowBody: { bn: "আগামীকালের কাজ ও পরবর্তী মাইলস্টোন দেখুন।", en: "See tomorrow's work and next milestones." },
  myFarmNoUpcoming: { bn: "কোনো আসন্ন কাজ নেই।", en: "No upcoming tasks." },
  myFarmAiTitle: { bn: "আমার ফার্ম AI", en: "My Farm AI" },
  myFarmAiLine: { bn: "আজ আপনার {n}টি সক্রিয় ফসলের পর্যায়ে অনুযায়ী পরামর্শ নিচে দেওয়া হলো।", en: "{n} active crops — stage-based suggestions below." },
  myFarmAiDisclaimer: { bn: "পর্যায়-ভিত্তিক পরামর্শ (সাজেস্টশন — বিশেষজ্ঞের পরামর্শ নয়)।", en: "Stage-based suggestion — guidance, not an expert diagnosis." },
  myFarmActiveCropsStat: { bn: "সক্রিয় ফসল", en: "Active crops" },
  myFarmActiveCropsChip: { bn: "সক্রিয় ফসল", en: "active crops" },
  myFarmPlotCount: { bn: "প্লট", en: "plots" },
  myFarmPlotsStat: { bn: "প্লট", en: "Plots" },
  myFarmListTitle: { bn: "আমার খামার তালিকা", en: "My farms" },
  myFarmStatusActive: { bn: "সচল", en: "Active" },
  myFarmNeedsAttention: { bn: "নজর দিন", en: "Needs attention" },
  myFarmDetails: { bn: "বিস্তারিত", en: "Details" },
  myFarmViewPlots: { bn: "প্লট দেখুন", en: "View plots" },

  // ── Farm-care suggestion tasks (lib/labels.ts) ──
  careTaskSeedbedCheck: { bn: "বীজতলার আর্দ্রতা পরীক্ষা করুন", en: "Check seedbed moisture" },
  careTaskUreaTopDressing: { bn: "ইউরিয়া সেচ দিন", en: "Apply urea top dressing" },
  careTaskSeedbedMoisture: { bn: "বীজতলার আর্দ্রতা নিশ্চিত করুন", en: "Ensure seedbed moisture" },
  careTaskGapFilling: { bn: "অনুপস্থিত চারায় গ্যাপ পূরণ", en: "Gap filling for missing plants" },
  careTaskUreaSplit: { bn: "কিস্তিতে ইউরিয়া সেচ", en: "Apply urea top dressing (split)" },
  careTaskConsistentMoisture: { bn: "আর্দ্রতা বজায় রাখুন", en: "Maintain consistent moisture" },
  careTaskPotashTopUp: { bn: "পাতা হলদে হলে পটাশ দিন", en: "Potash top-up if leaves yellowing" },

  // ── Admin ──
  adminOnly: { bn: "এই পাতায় প্রবেশের অনুমতি নেই।", en: "You don't have permission to view this page." },
  adminControlTower: { bn: "অ্যাডমিন কন্ট্রোল টাওয়ার", en: "Admin Control Tower" },
  metricActiveFarmers: { bn: "সক্রিয় কৃষক", en: "Active farmers" },
  metricActiveCrops: { bn: "চলমান ফসল", en: "Active crops" },
  metricPendingProcurement: { bn: "অপেক্ষমাণ ক্রয়", en: "Pending procurement" },
  metricAiQueries: { bn: "এআই পরামর্শ", en: "AI queries" },
  searchPh: { bn: "নাম/ফোন", en: "name/phone" },
  searchUsersAria: { bn: "ব্যবহারকারী খুঁজুন", en: "Search users" },
  breadcrumbNavAria: { bn: "ব্রেডক্রাম্ব", en: "Breadcrumb" },
  thName: { bn: "নাম", en: "Name" },
  thPhone: { bn: "ফোন", en: "Phone" },
  thRole: { bn: "ভূমিকা", en: "Role" },
  thTier: { bn: "টিয়ার", en: "Tier" },
  thStatus: { bn: "স্ট্যাটাস", en: "Status" },
  thRegion: { bn: "অঞ্চল", en: "Region" },
  regionPlaceholder: { bn: "অঞ্চল নির্ধারণ করুন", en: "Set region" },
  actionSuspend: { bn: "সাময়িক বরখাস্ত", en: "Suspend" },
  actionReactivate: { bn: "পুনরায় চালু", en: "Reactivate" },
  suspendConfirmTitle: { bn: "ব্যবহারকারীকে বরখাস্ত করবেন?", en: "Suspend this user?" },
  suspendConfirmBody: { bn: "{name} সাথে সাথে লগআউট হয়ে যাবেন এবং প্রবেশ করতে পারবেন না।", en: "{name} will be logged out immediately and blocked from signing in." },
  reactivateConfirmTitle: { bn: "অ্যাকাউন্ট পুনরায় চালু করবেন?", en: "Reactivate this account?" },
  userUpdatedToast: { bn: "ব্যবহারকারী হালনাগাদ হয়েছে ✓", en: "User updated ✓" },
  withdrawalsQueue: { bn: "উত্তোলন অনুমোদন", en: "Withdrawal approvals" },
  noWithdrawals: { bn: "অপেক্ষমাণ উত্তোলনের অনুরোধ নেই।", en: "No pending withdrawal requests." },
  actionApprove: { bn: "অনুমোদন", en: "Approve" },
  actionReject: { bn: "প্রত্যাখ্যান", en: "Reject" },
  wdApproveConfirmBody: { bn: "অনুমোদন করলে ব্যবহারকারীর ওয়ালেট থেকে {amount} ডেবিট হবে।", en: "Approving debits {amount} from the user's wallet." },
  wdRejectConfirmBody: { bn: "এই উত্তোলনের অনুরোধ প্রত্যাখ্যান করা হবে।", en: "This withdrawal request will be rejected." },
  withdrawalApprovedToast: { bn: "উত্তোলন অনুমোদিত ✓", en: "Withdrawal approved ✓" },
  withdrawalRejectedToast: { bn: "উত্তোলন প্রত্যাখ্যাত।", en: "Withdrawal rejected." },
  analyticsSummary: { bn: "অ্যানালিটিকস সারসংক্ষেপ ({days} দিন)", en: "Analytics summary ({days} days)" },
  statusACTIVE: { bn: "সক্রিয়", en: "Active" },
  statusSUSPENDED: { bn: "বরখাস্ত", en: "Suspended" },
  statusDISABLED: { bn: "নিষ্ক্রিয়", en: "Disabled" },
  roleSERVICE_PROVIDER: { bn: "সেবা প্রদানকারী", en: "Service Provider" },

  // ── Auth extras ──
  demoCredentialsTitle: { bn: "ডেমো অ্যাকাউন্ট", en: "Demo accounts" },
  demoCredentialsBody: { bn: "কৃষক: 01700000002 · অ্যাডমিন: 01700000001 · পাসওয়ার্ড: Demo@1234", en: "Farmer: 01700000002 · Admin: 01700000001 · Password: Demo@1234" },
  passwordHint: { bn: "(কমপক্ষে ৮ অক্ষর)", en: "(min. 8 characters)" },
  langSelectLabel: { bn: "ভাষা", en: "Language" },

  // ── Onboarding ──
  obStepOf: { bn: "ধাপ {step} / {total}", en: "Step {step} / {total}" },
  skipForNow: { bn: "এখন এড়িয়ে যান", en: "Skip for now" },
  obWhoHint: { bn: "প্রোফাইল নিশ্চিত করুন এবং এগিয়ে যান।", en: "Confirm your profile and continue." },
  districtExample: { bn: "যেমনঃ রংপুর", en: "e.g. Rangpur" },
  areaExample: { bn: "যেমনঃ ৫", en: "e.g. 5" },
  obDistrictTitle: { bn: "এলাকা / জেলা", en: "Area / District" },
  obAreaTitle: { bn: "জমির পরিমাণ (বিঘা)", en: "Land size (bigha)" },
  obFarmTitle: { bn: "প্রথম ফার্ম তৈরি করুন", en: "Create first farm" },

  // ── Splash (v2: bilingual, respects pre-login language choice) ──
  splashStatusConnect: { bn: "ফার্ম ডেটা সংযুক্ত হচ্ছে...", en: "Connecting farm data..." },
  splashStatusAi: { bn: "আপনার তথ্য প্রস্তুত হচ্ছে...", en: "Preparing your data..." },
  splashStatusReady: { bn: "আপনার ফার্ম প্রস্তুত", en: "Your farm is ready" },
  splashTagline: { bn: "কৃষি তথ্য ও পরামর্শ", en: "Farm information and advice" },
  splashLoadingLabel: { bn: "এগ্রোব্রিজ লোড হচ্ছে", en: "AgroBridge loading" },
  // The splash's screen-reader progress announcement. `{status}` is already
  // localized by statusFor(); the sentence around it used to be a hardcoded
  // English literal inside an aria-live region, so Bengali users heard English.
  splashLoadingProgress: { bn: "লোড হচ্ছে {percent} শতাংশ — {status}", en: "Loading {percent} percent — {status}" },

  // ── Services discovery (v2: chips/search/sort/count/empty via dictionary) ──
  svcFilterAll: { bn: "সব", en: "All" },
  svcFilterMech: { bn: "যন্ত্রপাতি", en: "Machinery" },
  svcFilterAdvisory: { bn: "পরামর্শ", en: "Advisory" },
  svcFilterTest: { bn: "পরীক্ষা", en: "Testing" },
  svcSearchPh: { bn: "সেবা খুঁজুন… (ড্রোন, ট্রাক্টর, মাটি)", en: "Search services… (drone, tractor, soil)" },
  svcSearchLabel: { bn: "সেবা খুঁজুন", en: "Search services" },
  svcSortLabel: { bn: "সাজান", en: "Sort" },
  svcSortAsc: { bn: "দাম: কম থেকে বেশি", en: "Price: Low to High" },
  svcSortDesc: { bn: "দাম: বেশি থেকে কম", en: "Price: High to Low" },
  svcCount: { bn: "{n} টি সেবা", en: "{n} services" },
  svcFoundWord: { bn: "পাওয়া গেছে", en: "found" },
  svcEmptyTitle: { bn: "কোন সেবা পাওয়া যায়নি", en: "No services found" },
  svcEmptyHint: { bn: "অন্য ক্যাটাগরি বা সার্চ শব্দ চেষ্টা করুন।", en: "Try another search or filter." },
  svcBookingEmptyHint: { bn: "উপরে যেকোনো সেবা থেকে বুক করুন — ফিল্ডে কাজ দ্রুত শুরু হবে।", en: "Book any service above — field work starts fast." },

  // ── Services page (hero / mini-cards / how-it-works / trust / CTA) ──
  // "Platform-listed", not "Verified": the platform onboards service providers
  // (providers:manage is an operator permission) and lists only active rows, but
  // ServiceProvider carries no verification field, so "Verified" was a trust signal
  // the product could not evidence. The body below says what is actually true.
  svcBadgeVerified: { bn: "মাঠের সেবা • প্ল্যাটফর্মে তালিকাভুক্ত", en: "Field services • Platform-listed" },
  svcHeroTitle: { bn: "আপনার জমির জন্য সঠিক সেবা, এক ক্লিকে", en: "The right service for your field, in one tap" },
  svcHeroSub: { bn: "যন্ত্রপাতি, স্মার্ট ফার্মিং ও মাটি পরীক্ষা — স্বচ্ছ মূল্য, স্থানীয় প্রদানকারী, দ্রুত বুকিং।", en: "Machinery, smart farming and soil testing — transparent pricing, local providers, fast booking." },
  svcFindService: { bn: "সেবা খুঁজুন", en: "Find a service" },
  svcFindServices: { bn: "সেবা খুঁজুন", en: "Find services" },
  svcTypesPlural: { bn: "প্রকার", en: "types" },
  svcTypeSingular: { bn: "প্রকার", en: "type" },
  svcClearLabel: { bn: "স্বচ্ছ", en: "Clear" },
  svcDiscoverSr: { bn: "সেবা খুঁজুন", en: "Discover services" },
  svcHowTitle: { bn: "কিভাবে কাজ করে", en: "How it works" },
  svcHowSub: { bn: "৩টি সহজ ধাপে বুকিং সম্পন্ন করুন।", en: "Book in 3 simple steps." },
  svcHowStep1Title: { bn: "১. সেবা নির্বাচন", en: "1. Choose a service" },
  svcHowStep1Body: { bn: "প্রয়োজন অনুযায়ী সেবা খুঁজুন ও নির্বাচন করুন।", en: "Find and select the service you need." },
  svcHowStep2Title: { bn: "২. জমি ও সময়", en: "2. Field & schedule" },
  svcHowStep2Body: { bn: "আপনার ফার্ম, তারিখ ও জমির পরিমাণ দিন।", en: "Pick your farm, date and area." },
  svcHowStep3Title: { bn: "৩. নিশ্চিত করুন", en: "3. Confirm" },
  svcHowStep3Body: { bn: "বুক করুন — প্রদানকারী নির্ধারিত হবে।", en: "Book — a provider will be assigned." },
  svcWhyTitle: { bn: "কেন এগ্রোব্রিজ", en: "Why AgroBridge" },
  svcTrustVerifiedTitle: { bn: "তালিকাভুক্ত সেবা ও প্রদানকারী", en: "Listed services and providers" },
  svcTrustVerifiedBody: { bn: "সক্রিয় সেবা ও প্রদানকারী তালিকা।", en: "Active services and providers." },
  svcTrustPriceTitle: { bn: "স্বচ্ছ মূল্য", en: "Transparent pricing" },
  svcTrustPriceBody: { bn: "প্রতি বিঘা/ঘণ্টা/দিন হিসাব।", en: "Per bigha/hour/day." },
  svcTrustSupportTitle: { bn: "সহায়তা", en: "Support" },
  svcTrustSupportBody: { bn: "প্রয়োজনে যোগাযোগ করুন।", en: "Get help when you need it." },
  svcHelpTitle: { bn: "সহায়তা প্রয়োজন?", en: "Need help?" },
  svcHelpBody: { bn: "আপনার ফার্ম যোগ করুন — সেবা বুকিং দ্রুত হবে।", en: "Add your farm — booking will be faster." },

  // ── Service card fallbacks (components/service/ServiceCard.tsx) ──
  svcNewNoRatings: { bn: "নতুন — এখনো রেটিং নেই", en: "New — no ratings yet" },
  svcProviderOne: { bn: "প্রদানকারী", en: "provider" },
  svcProviderMany: { bn: "প্রদানকারী", en: "providers" },
  svcDescFallback: { bn: "মাঠের সেবা — স্বচ্ছ মূল্য", en: "Field service — transparent pricing" },
  svcDescDRONE: { bn: "জমি না মাড়িয়ে দ্রুত স্প্রে — সমান কভারেজ", en: "Fast spray without trampling — even coverage" },
  svcDescTRACTOR: { bn: "ট্রাক্টর ও চালকসহ জমি প্রস্তুত — বিঘা প্রতি", en: "Tractor with operator — per bigha" },
  svcDescCOMBINE_HARVESTER: { bn: "কাটা ও মাড়াই একসাথে — সময় ও শ্রম সাশ্রয়", en: "Harvest and thresh together — saves time and labour" },
  svcDescPOWER_TILLER: { bn: "ছোট-মাঝারি জমিতে নিখুঁত চাষ", en: "Precise tillage for small–medium plots" },
  svcDescLAND_LEVELLER: { bn: "লেজার সমতলকরণ — সেচে পানি সাশ্রয়", en: "Laser levelling — saves irrigation water" },
  svcDescTHRESHER: { bn: "পরিষ্কার দানা, কম অপচয় — মণ প্রতি", en: "Clean grain, low waste — per maund" },
  svcDescSOIL_TESTING: { bn: "ল্যাব রিপোর্ট + সার সুপারিশ — নমুনা প্রতি", en: "Lab report + fertilizer advice — per sample" },
  svcDescAGRONOMIST: { bn: "মাঠ পরিদর্শন ও ব্যবস্থাপত্র — ভিজিট প্রতি", en: "Field visit and prescription — per visit" },

  // ── MyOrders (v2: tabs/empty/states via dictionary) ──
  ordTabActive: { bn: "সক্রিয়", en: "Active" },
  ordTabDelivered: { bn: "ডেলিভার্ড", en: "Delivered" },
  ordEmptyTitle: { bn: "কোনো অর্ডার নাই", en: "No orders yet" },
  ordEmptyAllHint: { bn: "আপনার এখনো কোনো অর্ডার নাই। বাজার থেকে পণ্য কিনে শুরু করুন।", en: "You don't have any orders yet. Start shopping from the market." },
  ordEmptyFilteredHint: { bn: "এই ক্যাটাগরিতে কোনো অর্ডার নাই।", en: "No orders in this category yet." },
  ordItemsTitle: { bn: "পণ্যসমূহ", en: "Items" },
  ordLastUpdated: { bn: "সর্বশেষ হালনাগাদ", en: "Last updated" },
  ordNoAddress: { bn: "এই অর্ডারে ডেলিভারি ঠিকানা লেখা হয়নি।", en: "No delivery address was recorded for this order." },
  ordPaymentLabel: { bn: "পেমেন্ট", en: "Payment" },
  ordReceiverLabel: { bn: "গ্রহণকারী", en: "Recipient" },

  // ── Settings / account ──
  settings: { bn: "সেটিংস", en: "Settings" },
  settingsSubtitle: { bn: "প্রোফাইল, ফোন যাচাই ও অ্যাকাউন্ট।", en: "Profile, phone verification and account." },
  emailOptional: { bn: "ইমেইল (ঐচ্ছিক)", en: "Email (optional)" },
  districtLabel: { bn: "জেলা", en: "District" },
  upazilaLabel: { bn: "উপজেলা", en: "Upazila" },
  districtWeatherHint: {
    bn: "আপনার জেলা ও উপজেলা দিলে আবহাওয়ার পরামর্শ আপনার এলাকার জন্য দেখানো হবে।",
    en: "Your district and upazila are used to show weather advice for your area.",
  },
  districtWeatherHintShort: { bn: "জেলা অনুযায়ী আবহাওয়া", en: "Weather by district" },
  saving: { bn: "সংরক্ষণ হচ্ছে…", en: "Saving…" },
  language: { bn: "ভাষা", en: "Language" },
  profileSavedToast: { bn: "প্রোফাইল সংরক্ষণ হয়েছে", en: "Profile saved" },
  phoneVerification: { bn: "ফোন যাচাই", en: "Phone verification" },
  verifiedLabel: { bn: "যাচাইকৃত", en: "Verified" },
  notVerifiedLabel: { bn: "যাচাই হয়নি", en: "Not verified" },
  phoneVerifiedBody: { bn: "আপনার নম্বর যাচাই করা হয়েছে — ওয়ালেট থেকে টাকা তোলা যাবে।", en: "Your number is verified — you can withdraw from your wallet." },
  phoneVerifyWhy: {
    bn: "টাকা তোলার আগে নম্বর যাচাই করা বাধ্যতামূলক। কোড পাঠিয়ে যাচাই করুন।",
    en: "Verifying your number is required before a withdrawal. Send a code and confirm it.",
  },
  sendCode: { bn: "কোড পাঠান", en: "Send code" },
  resendCode: { bn: "আবার পাঠান", en: "Resend" },
  otpCodeLabel: { bn: "৬ সংখ্যার কোড", en: "6-digit code" },
  devCodeHint: { bn: "ডেভেলপমেন্ট কোড", en: "Development code" },
  verify: { bn: "যাচাই করুন", en: "Verify" },
  otpSentToast: { bn: "কোড পাঠানো হয়েছে", en: "Code sent" },
  phoneVerifiedToast: { bn: "ফোন যাচাই সম্পন্ন", en: "Phone verified" },
  errOtpFormat: { bn: "৬ সংখ্যার কোড দিন।", en: "Enter the 6-digit code." },
  errEmailInvalid: { bn: "সঠিক ইমেইল দিন।", en: "Enter a valid email." },
  legalTitle: { bn: "নীতিমালা", en: "Policies" },
  privacyPolicy: { bn: "গোপনীয়তা নীতি", en: "Privacy Policy" },
  termsOfService: { bn: "ব্যবহারের শর্তাবলি", en: "Terms of Service" },
  dataDeletionInfo: { bn: "অ্যাকাউন্ট ও তথ্য মুছে ফেলা", en: "Delete account & data" },
  accountTitle: { bn: "অ্যাকাউন্ট", en: "Account" },
  deleteAccountWarning: {
    bn: "অ্যাকাউন্ট মুছে ফেললে আপনার নাম, ফোন, ইমেইল ও পাসওয়ার্ড সাথে সাথে মুছে যাবে এবং আর লগইন করা যাবে না। আর্থিক রেকর্ড আইন অনুযায়ী ৫ বছর আপনার পরিচয় ছাড়া সংরক্ষিত থাকে।",
    en: "Deleting your account erases your name, phone, email and password immediately and you will not be able to sign in again. Financial records are kept 5 years without your identifying details, as required by law.",
  },
  deleteAccount: { bn: "অ্যাকাউন্ট মুছে ফেলুন", en: "Delete account" },
  deletingAccount: { bn: "মুছে ফেলা হচ্ছে…", en: "Deleting…" },
  deleteAccountTitle: { bn: "অ্যাকাউন্ট মুছে ফেলবেন?", en: "Delete your account?" },
  deleteAccountBody: {
    bn: "এই কাজটি ফেরানো যাবে না। চলমান অর্ডার বা নিষ্পত্তির অপেক্ষায় থাকা উত্তোলন থাকলে আগে সেগুলো শেষ করতে হবে।",
    en: "This cannot be undone. If an order is still in progress or a withdrawal is awaiting settlement, resolve it first.",
  },
  deleteAccountConfirm: { bn: "হ্যাঁ, মুছে ফেলুন", en: "Yes, delete" },
  accountDeletedToast: { bn: "অ্যাকাউন্ট মুছে ফেলা হয়েছে", en: "Account deleted" },
  // ── Personal data export ──
  dataExportTitle: { bn: "আমার ডেটা", en: "My data" },
  dataExportHint: {
    bn: "আপনার অ্যাকাউন্টের সব তথ্য (প্রোফাইল, ফার্ম, অর্ডার, ওয়ালেট — পাসওয়ার্ড ছাড়া) JSON ফাইল হিসেবে ডাউনলোড করুন।",
    en: "Download everything AgroBridge stores about your account (profile, farms, orders, wallet — never your password) as a JSON file.",
  },
  downloadMyData: { bn: "আমার ডেটা ডাউনলোড করুন", en: "Download my data" },
  dataExportReadyToast: { bn: "ডাউনলোড শুরু হয়েছে", en: "Download started" },
  dataExportFailedToast: {
    bn: "ডেটা ডাউনলোড করা যায়নি — একটু পরে আবার চেষ্টা করুন",
    en: "Could not download your data — please try again",
  },
  appVersionLabel: { bn: "সংস্করণ", en: "Version" },
  accountIdLabel: { bn: "অ্যাকাউন্ট আইডি", en: "Account ID" },

  // ── Legal pages / wallet meta ──
  legalLastUpdated: { bn: "সর্বশেষ হালনাগাদ", en: "Last updated" },
  legalNavAria: { bn: "আইনি নথি", en: "Legal documents" },
  walletExpiresIn: { bn: "মেয়াদ শেষ {days} দিনে", en: "Expires in {days}d" },

  // ── Offline queue outcomes (lib/offlineQueue.ts → App.tsx toasts) ──
  // A flush that saved at least one queued change reports the count.
  // No ✅ prefix in these two: ToastProvider already renders the success tick as
  // an icon (components/ui.tsx), so the emoji drew a second one and was the only
  // emoji in an otherwise lucide-only icon language.
  queueSyncedToastOne: { bn: "অফলাইনে করা {n}টি পরিবর্তন সিঙ্ক হয়েছে।", en: "{n} queued change saved." },
  queueSyncedToastMany: { bn: "অফলাইনে করা {n}টি পরিবর্তন সিঙ্ক হয়েছে।", en: "{n} queued changes saved." },
  // 409/422 conflicts are the user's to resolve — distinct from a plain discard.
  queuedChangeConflict: { bn: "অফলাইনে করা {item} পরিবর্তনটি সার্ভারের তথ্যের সাথে মিলছে না — আপনার পর্যালোচনা দরকার।", en: "Your offline {item} change conflicts with server data — it needs your review." },
  // A queued change is only replayed for 72 h (offlineQueue.ts): past that it is
  // dropped, and the copy says why instead of the change vanishing without word.
  queuedChangeExpired: { bn: "অফলাইনে করা {item} পরিবর্তনটি ৩ দিনের মধ্যে পাঠানো যায়নি — বাদ দেওয়া হয়েছে।", en: "Your offline {item} change could not be sent within 3 days — it was discarded." },
  // Persisting the queue failed (quota/private mode): the change is held in
  // memory for this tab only and is gone at the next reload — say so at once.
  queueStorageFailed: { bn: "অফলাইনে করা পরিবর্তন ডিভাইসে সংরক্ষণ করা যায়নি — অ্যাপ বন্ধ হলে হারিয়ে যেতে পারে।", en: "Offline changes could not be saved on this device — they may be lost if the app closes." },
} as const;

export type DictKey = keyof typeof dict;

export type TVars = Record<string, string | number>;

/** Translate a key; interpolates {name}-style tokens from `vars`. */
export function t(key: DictKey, lang: Lang, vars?: TVars): string {
  const template: string = dict[key][lang];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  );
}

/** The other UI language — one source for every bn/en toggle in the app. */
const OTHER_LANG: Record<Lang, Lang> = { bn: "en", en: "bn" };
export function otherLang(lang: Lang): Lang {
  return OTHER_LANG[lang];
}
