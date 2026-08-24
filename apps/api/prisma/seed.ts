/**
 * Development/demo seed data ONLY (Section 38).
 * Never use real personal information. Passwords here are public demo values.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash("Demo@1234", 10);

  const admin = await prisma.user.upsert({
    where: { phone: "01700000001" },
    update: {},
    create: {
      fullName: "AgroBridge Admin",
      phone: "01700000001",
      email: "admin@agrobridge.demo",
      passwordHash: password,
      role: "ADMIN",
      langPref: "en",
      wallet: { create: {} },
    },
  });

  const superAdmin = await prisma.user.upsert({
    where: { phone: "01700000000" },
    update: {},
    create: {
      fullName: "Super Admin",
      phone: "01700000000",
      email: "super@agrobridge.demo",
      passwordHash: password,
      role: "SUPER_ADMIN",
      langPref: "en",
      wallet: { create: {} },
    },
  });

  const farmer = await prisma.user.upsert({
    where: { phone: "01700000002" },
    update: {},
    create: {
      fullName: "রহিম উদ্দিন (ডেমো)",
      phone: "01700000002",
      passwordHash: password,
      role: "FARMER",
      langPref: "bn",
      farmerProfile: {
        create: { district: "রংপুর", upazila: "পীরগাছা", membershipTier: "SILVER", address: "ডেমো ঠিকানা" },
      },
      wallet: { create: { balancePaisa: 250_000 } },
    },
  });
  await prisma.farmerProfile.update({ where: { userId: farmer.id }, data: { userId: farmer.id } }).catch(() => undefined);

  const dealer = await prisma.user.upsert({
    where: { phone: "01700000003" },
    update: {},
    create: {
      fullName: "Demo Dealer",
      phone: "01700000003",
      passwordHash: password,
      role: "DEALER",
      wallet: { create: {} },
    },
  });

  const procurementManager = await prisma.user.upsert({
    where: { phone: "01700000004" },
    update: {},
    create: {
      fullName: "Procurement Manager",
      phone: "01700000004",
      passwordHash: password,
      role: "PROCUREMENT_MANAGER",
      wallet: { create: {} },
    },
  });

  // Farm / plots / crop
  let farm = await prisma.farm.findFirst({ where: { ownerId: farmer.id, name: "ডেমো ফার্ম" } });
  if (!farm) {
    farm = await prisma.farm.create({
      data: {
        ownerId: farmer.id,
        name: "ডেমো ফার্ম",
        district: "রংপুর",
        upazila: "পীরগাছা",
        lat: 25.9,
        lng: 89.1,
        totalAreaBigha: 3.5,
      },
    });
    const plot = await prisma.plot.create({
      data: { farmId: farm.id, name: "প্লট-১", areaBigha: 2.0, soilType: "দোআঁশ", irrigationType: "সেচ পাম্প" },
    });
    const plantedAt = new Date(Date.now() - 30 * 86400000);
    await prisma.cropCycle.create({
      data: {
        plotId: plot.id,
        cropName: "ধান",
        variety: "ব্রি ধান৮৯",
        plantedAt,
        expectedHarvestAt: new Date(plantedAt.getTime() + 120 * 86400000),
        stage: "VEGETATIVE",
        farmEvents: {
          create: { farmId: farm.id, actorId: farmer.id, type: "PLANTING", title: "Planted ধান", occurredAt: plantedAt },
        },
      },
    });
  }

  // Products
  const products = [
    { sku: "SEED-RICE-BRI89", name: "ব্রি ধান৮৯ বীজ (৫কেজি)", category: "SEED", unit: "PACK", pricePaisa: 45_000, stockQty: 200, supplier: "BADC (demo)", cropRelevance: "RICE" },
    { sku: "SEED-WHEAT-BARI26", name: "বারি গম ২৬ বীজ (১০কেজি)", category: "SEED", unit: "PACK", pricePaisa: 52_000, stockQty: 150, supplier: "BADC (demo)", cropRelevance: "WHEAT" },
    { sku: "FERT-UREA-50KG", name: "ইউরিয়া সার (৫০কেজি)", category: "FERTILIZER", unit: "BAG", pricePaisa: 42_000, stockQty: 500, supplier: "BCIC (demo)", batchNo: "U-2026-A" },
    { sku: "FERT-DAP-50KG", name: "ডিএপি সার (৫০কেজি)", category: "FERTILIZER", unit: "BAG", pricePaisa: 95_000, stockQty: 300, supplier: "demo supplier", batchNo: "DAP-88" },
    { sku: "FERT-MOP-50KG", name: "এমওপি সার (৫০কেজি)", category: "FERTILIZER", unit: "BAG", pricePaisa: 110_000, stockQty: 220, batchNo: "MOP-12" },
    { sku: "CP-RICE-BLAST-100ML", name: "ট্রাইসাইক্লাজল ছত্রাকনাশক ১০০মিলি", category: "CROP_PROTECTION", unit: "BOTTLE", pricePaisa: 48_000, stockQty: 80, cropRelevance: "RICE" },
    { sku: "BIO-TRICHODERMA-1KG", name: "ট্রাইকোডার্মা জৈব ছত্রাক (১কেজি)", category: "BIO_INPUT", unit: "KG", pricePaisa: 18_000, stockQty: 120 },
    { sku: "EQ-KNAPSACK-16L", name: "ন্যাপস্যাক স্প্রেয়ার ১৬লিটার", category: "EQUIPMENT", unit: "PCS", pricePaisa: 185_000, stockQty: 40 },
  ];
  for (const p of products) {
    await prisma.product.upsert({ where: { sku: p.sku }, update: {}, create: p });
  }

  // Services + providers
  const servicesData = [
    { code: "DRONE_SPRAY", name: "ড্রোন স্প্রেয়িং", category: "DRONE", basePricePaisa: 35_000, priceUnit: "PER_BIGHA", description: "ইউএভি দিয়ে ওষুধ স্প্রে" },
    { code: "TRACTOR_PLOUGH", name: "ট্রাক্টর চাষ", category: "TRACTOR", basePricePaisa: 22_000, priceUnit: "PER_BIGHA" },
    { code: "COMBINE_HARVEST", name: "কম্বাইন হারভেস্টার", category: "COMBINE_HARVESTER", basePricePaisa: 65_000, priceUnit: "PER_BIGHA" },
    { code: "POWER_TILLER", name: "পাওয়ার টিলার", category: "POWER_TILLER", basePricePaisa: 15_000, priceUnit: "PER_BIGHA" },
    { code: "LAND_LEVELLER", name: "ল্যান্ড লেভেলার", category: "LAND_LEVELLER", basePricePaisa: 28_000, priceUnit: "PER_BIGHA" },
    { code: "THRESHER", name: "থ্রেশার", category: "THRESHER", basePricePaisa: 12_000, priceUnit: "PER_MAUND" },
    { code: "SOIL_TEST", name: "মাটি পরীক্ষা", category: "SOIL_TESTING", basePricePaisa: 50_000, priceUnit: "PER_SAMPLE" },
    { code: "AGRONOMIST_VISIT", name: "কৃষিবিদ ভিজিট", category: "AGRONOMIST", basePricePaisa: 80_000, priceUnit: "PER_VISIT" },
  ];
  for (const s of servicesData) {
    const service = await prisma.service.upsert({ where: { code: s.code }, update: {}, create: s });
    const providerCount = await prisma.serviceProvider.count({ where: { serviceId: service.id } });
    if (providerCount === 0) {
      await prisma.serviceProvider.create({
        data: {
          serviceId: service.id,
          name: `${service.name} সেবাদাতা (ডেমো)`,
          phone: "01700009999",
          district: "রংপুর",
          ratingSum: 44,
          ratingCount: 10,
        },
      });
    }
  }

  // Membership plans (admin-configurable, Section 25)
  const plans = [
    { tier: "BRONZE", pricePaisa: 0, benefitsStr: JSON.stringify(["Basic AI advisory", "Weekly weather digest"]) },
    { tier: "SILVER", pricePaisa: 50_000, benefitsStr: JSON.stringify(["Unlimited AI advisory", "3% marketplace discount", "Priority soil testing"]) },
    { tier: "GOLD", pricePaisa: 120_000, benefitsStr: JSON.stringify(["Unlimited AI advisory", "5% marketplace discount", "Free drone spraying per season", "Dedicated agronomist hotline"]) },
  ];
  for (const p of plans) {
    await prisma.membershipPlan.upsert({ where: { tier: p.tier }, update: {}, create: p });
  }

  // Welcome notification for demo farmer
  const notifCount = await prisma.notification.count({ where: { userId: farmer.id } });
  if (notifCount === 0) {
    await prisma.notification.create({
      data: {
        userId: farmer.id,
        type: "SYSTEM",
        title: "AgroBridge-এ স্বাগতম!",
        body: "আপনার ফার্ম যোগ করে AI পরামর্শ নিতে পারেন।",
      },
    });
  }

  console.log("Seed complete:");
  console.log(`  SUPER_ADMIN: ${superAdmin.phone} / Demo@1234`);
  console.log(`  ADMIN:       ${admin.phone} / Demo@1234`);
  console.log(`  FARMER:      ${farmer.phone} / Demo@1234`);
  console.log(`  DEALER:      ${dealer.phone} / Demo@1234`);
  console.log(`  PROCUREMENT: ${procurementManager.phone} / Demo@1234`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
