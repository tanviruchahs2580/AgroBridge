# Domain glossary — বাংলা ↔ English

Terms as they are actually rendered by the UI dictionary `apps/web/src/lib/i18n.ts`. The Bangla
column quotes the dictionary verbatim and the `key` column names the exact dictionary key, so any
row can be located with `rg '"<key>:" apps/web/src/lib/i18n.ts`. Where the dictionary uses more
than one Bangla word for the same concept, both are listed and that fact is noted rather than
smoothed over. Line anchors are given only where they are stable blocks (state enums at
`i18n.ts:156-176`, service copy at `:456-486`, procurement at `:493-504`, stages at `:346-351`,
product categories at `:366-370`).

Native-speaker sign-off status: none of the farmer-facing copy has been reviewed by a native
speaker yet — the review is an open task in `docs/agronomy-review-sheet.md` §3 ("Native-Bangla copy
review"). Terms marked **[review]** are the ones this glossary considers most likely to need a
decision (inconsistent pairs or register questions); all rows are in scope of that review.

## Farm records

| English | Bangla (as used) | key | Note |
|---|---|---|---|
| Farm | ফার্ম | `myFarm` ("আমার ফার্ম") | |
| Farm | খামার | `aiFarmEmptyTitle` ("শুরু করতে খামার যোগ করুন"), `myFarmAddFarmHint` ("আপনার খামার যোগ করে…") | **[review]** both ফার্ম and খামার are used for "farm"; a native reviewer should pick one register or define when each applies |
| Plot | প্লট | `addPlot` ("নতুন প্লট"), `plotNamePh` ("প্লটের নাম") | |
| Crop | ফসল | `addCrop` ("নতুন ফসল"), `cropName` ("ফসলের নাম") | |
| Crop cycle / active crop | চলমান ফসল | `activeCropsTitle`, `kpiActiveCrops` | the UI surface for the `CropCycle` record |
| Crop stage — seed | বীজ | `stageSEED` | `i18n.ts:346` |
| Crop stage — germination | অঙ্কুরোদগম | `stageGERMINATION` | `:347` |
| Crop stage — vegetative | বৃদ্ধি | `stageVEGETATIVE` | `:348`; `growthStage` renders "বৃদ্ধি পর্যায়ে" |
| Crop stage — flowering | ফুল ফোটা | `stageFLOWERING` | `:349` |
| Crop stage — grain/fruit development | দানা/ফল গঠন | `stageGRAIN_FRUIT_DEVELOPMENT` | `:350` |
| Crop stage — harvest | ফসল তোলা | `stageHARVEST` | `:351` |
| Bigha (area unit) | বিঘা | `areaBigha` ("জমির পরিমাণ (বিঘা)"), `bighaShort` | used in both languages; no conversion is displayed anywhere |
| District | জেলা | `districtLabel`, `districtPh` | |
| Upazila | উপজেলা | `upazilaLabel` | kept as the administrative term, not translated |

## Weather and advice

| English | Bangla (as used) | key | Note |
|---|---|---|---|
| Weather | আবহাওয়া | `weather` | |
| Weather as of (provenance line) | আবহাওয়া তথ্য: {time} | `weatherAsOf` | cache hits keep the original fetch time and are labelled "সংরক্ষিত কপি" (`weatherCachedCopy`); `i18n.ts:361-362` |
| Humidity | আর্দ্রতা | `humidityLabel`; `moisturePct` | the same Bangla word covers air humidity and grain/soil moisture; context disambiguates |
| Wind | বাতাস | `windLabel` | |
| Spraying | স্প্রে | `weatherSPRAY_RAIN` ("বৃষ্টির কারণে স্প্রে পিছিয়ে দিন") | |
| Irrigation | সেচ | `weatherIRRIGATION_RAIN`, `weatherHEAT_STRESS` ("হালকা সেচ দিন") | |
| Advisory / advice | পরামর্শ | `advisoryDisclaimer`, `aiActionFertilizer` ("সার পরামর্শ") | |
| Low confidence | নিশ্চিত উত্তর নয় — বিশেষজ্ঞের পরামর্শ নিন | `lowConfidence` | |
| Agronomist / extension officer | কৃষি বিশেষজ্ঞ | `svcAGRONOMIST` | |
| Extension officer (disclaimer wording) | কৃষি কর্মকর্তা | `advisoryDisclaimer` ("…কৃষি কর্মকর্তার সাথে যাচাই করুন") | **[review]** two Bangla terms for the human expert; agronomist and government extension officer are not strictly the same role |
| Expert review (disease photo) | বিশেষজ্ঞ পর্যালোচনাধীন | `pendingReview` | reviewed = পর্যালোচিত (`reviewed`) |
| Disease | রোগ | `diseaseCheck` ("রোগের ছবি জমা দিন") | |
| AI Agro Agent | এআই কৃষি সহকারী | `aiAgent` | |

## Marketplace

| English | Bangla (as used) | key | Note |
|---|---|---|---|
| Market | বাজার | `market` | |
| Cart | কার্ট | `cart` | transliteration is the established usage |
| Checkout | চেকআউট | `checkout` | |
| Order | অর্ডার | `orders`, `myOrders` ("আমার অর্ডার") | |
| Subtotal | সাব-টোটাল | `orderSubtotal` | |
| Delivery fee | ডেলিভারি চার্জ | `orderDeliveryFee` | free = ফ্রি (`freeLabel`) |
| Discount (membership) | ছাড় (মেম্বারশিপ) | `orderDiscount` | |
| Stock | স্টক | `stockLeft` ("স্টক: {n}") | out of stock = স্টক নেই (`outOfStock`) |
| Sandbox payment | স্যান্ডবক্স মোড — কোনো প্রকৃত অর্থ লেনদেন হবে না। | `sandboxPaymentNote` | shown for simulated payments |
| Payment | পেমেন্ট | `walletPAYMENT`, `payNow` ("পেমেন্ট করুন") | |
| Product categories | বীজ (seeds) · সার (fertilizer) · জৈব উপকরণ (bio-inputs) · কীটনাশক (crop protection) · যন্ত্রপাতি (equipment) | `catSEED` … `catEQUIPMENT` | `i18n.ts:366-370` |

## Procurement and quality

| English | Bangla (as used) | key | Note |
|---|---|---|---|
| Procurement / crop sale | ফসল বিক্রি | `sellCrop` ("ফসল বিক্রি"), `walletSALE_PROCEEDS` ("বিক্রয়ের অর্থ") | |
| Offer (crop offer) | অফার | `myOffers` ("আমার ফসলের অফার") | |
| Quality check (QC) | গুণগত যাচাই | `pipeQC`, `sellStepQc` | |
| Purchase order (PO) | ক্রয়াদেশ | `pipePO` | |
| Collected | সংগ্রহ | `pipeCOLLECTED` | |
| Settled / paid | পরিশোধিত | `pipePAID`, `statusPAID` | |
| Rejected | প্রত্যাখ্যাত | `statusREJECTED` | |
| Quality grade | মানের গ্রেড; Grade A/B/C = গ্রেড A/B/C | `qualityGrade`; `gradeA` … `gradeC` | |
| Moisture | আর্দ্রতা (%) | `moisturePct` | pricing deducts above 14% — `docs/business-rules.md` BR-26 |
| Net payable | নীট পরিশোধযোগ্য | `netPayable` | |
| Quantity | পরিমাণ (কেজি) | `quantityKg` | kg = কেজি (`kgUnit`); maund = মণ (`unitPER_MAUND`) |
| Wallet | ওয়ালেট | `wallet` | |
| Balance | ব্যালেন্স | `balance`, `availableBalance` | |
| Withdrawal | টাকা তোলা / টাকা তুলুন | `walletWITHDRAWAL`, `withdrawTitle` | pending withdrawals = অপেক্ষমাণ উত্তোলন (`pendingWithdrawals`) |
| Top-up | টাকা যোগ | `walletTOPUP` | |
| Refund | ফেরত দেওয়া হয়েছে / ফেরত | `statusREFUNDED`, `walletREFUND` | |

## Services and membership

| English | Bangla (as used) | key | Note |
|---|---|---|---|
| Service | সেবা | `services` | |
| Booking | বুকিং / বুক করুন | `bookings`, `bookNow` | requested/assigned/in-progress = অনুরোধকৃত / নিয়োজিত / চলমান (`bsREQUESTED` … `bsIN_PROGRESS`) |
| Service provider | সেবাদাতা | `providerLabel` | role label = সেবা প্রদানকারী (`roleSERVICE_PROVIDER`) |
| Machinery | যন্ত্রপাতি | `catEQUIPMENT`, `svcFilterMech` | |
| Drone | ড্রোন | `svcDRONE` | |
| Tractor | ট্রাক্টর | `svcTRACTOR` | |
| Combine harvester | কম্বাইন হারভেস্টার | `svcCOMBINE_HARVESTER` | |
| Power tiller | পাওয়ার টিলার | `svcPOWER_TILLER` | **[review]** transliteration choice vs. local usage |
| Land leveller | জমি সমকরণ যন্ত্র | `svcLAND_LEVELLER` | **[review]** literal rendering of "laser land leveller" |
| Thresher | মাড়াই যন্ত্র | `svcTHRESHER` | |
| Soil testing | মাটি পরীক্ষা | `svcSOIL_TESTING` | |
| Membership | মেম্বারশিপ | `membership` | tier names BRONZE/SILVER/GOLD have **no Bangla rendering** in the dictionary — **[review]** whether they should |
| Acre | একর | `unitPER_ACRE` | |

## Account, roles and system

| English | Bangla (as used) | key | Note |
|---|---|---|---|
| Farmer | কৃষক | `roleFARMER`, `farmers` | |
| Admin | অ্যাডমিন; সুপার অ্যাডমিন | `admin`, `roleADMIN`, `roleSUPER_ADMIN` | |
| QC officer | গুণগত পরিদর্শক | `roleQC_OFFICER` | |
| Region | অঞ্চল | `adminRegionsTitle` ("অঞ্চল ব্যবস্থাপনা"), `thRegion` | |
| Notification | নোটিফিকেশন | `notifications` | alert = সতর্কতা (`alertsTitle` "স্মার্ট সতর্কতা") |
| Phone verification | ফোন যাচাই | `phoneVerification` | OTP code = ৬ সংখ্যার কোড (`otpCodeLabel`) |
| Log in / log out | লগইন / লগআউট | `login`, `logout` | |
| Session expired | সেশনের মেয়াদ শেষ — আবার লগইন করুন। | `sessionExpired` | |
| Offline | অফলাইন — পরিবর্তনগুলো সংরক্ষিত হবে | `offlineBanner` | queue wording (`queuedChangeDropped`, `queuedChangeConflict`) is **[review]** for tone |
| Delete account | অ্যাকাউন্ট মুছে ফেলুন | `deleteAccount` | retention sentence names 5 years (`deleteAccountWarning`) |
| Policies | নীতিমালা; গোপনীয়তা নীতি (privacy), ব্যবহারের শর্তাবলি (terms) | `legalTitle`, `privacyPolicy`, `termsOfService` | long-form Bangla lives in `apps/web/src/features/legal/content.ts` |

## Method

Extraction: every key in `apps/web/src/lib/i18n.ts` whose English value is a domain noun or state
label was reviewed; the table keeps the terms that appear on farmer-facing surfaces. Keys not
listed (tasks, toasts, validation strings) carry no new domain vocabulary. The dictionary is the
primary source; three companions reference it and carry no independent Bangla domain terms —
`apps/web/src/lib/labels.ts` (raw enum → dictionary key maps), `apps/web/src/lib/errors-ui.ts`
(API error code → dictionary key), `apps/web/src/lib/format.ts` (bn-BD number/date locales) — while
`apps/web/src/features/legal/content.ts` holds the long-form privacy/terms/deletion Bangla text
(already noted in `docs/play/data-safety.md` as the policy copy source). Native review is recorded
in `docs/agronomy-review-sheet.md` §3; this file is updated when that review lands, not before.
