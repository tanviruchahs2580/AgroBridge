import request from "supertest";
import bcrypt from "bcryptjs";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

export const app = createApp();

let phoneCounter = 0;
export function uniquePhone(): string {
  return `017${String(Date.now()).slice(-6)}${String(phoneCounter++).padStart(2, "0")}`.slice(0, 11);
}

export async function registerFarmer(overrides: Partial<{ fullName: string; password: string; langPref: string }> = {}) {
  const body = {
    fullName: overrides.fullName ?? "Test Farmer",
    phone: uniquePhone(),
    password: overrides.password ?? "Test@1234",
    langPref: overrides.langPref ?? "bn",
  };
  const res = await request(app).post("/api/v1/auth/register").send(body);
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
  return {
    ...res.body.data,
    plainPassword: body.password,
    phone: body.phone,
  } as {
    accessToken: string; refreshToken: string; user: { id: string }; plainPassword: string; phone: string;
  };
}

let adminCtx: { accessToken: string; userId: string } | null = null;
/** Ensures an ADMIN exists (seed provides one) and returns an auth context. */
export async function getAdmin() {
  if (adminCtx) return adminCtx;
  const phone = "01700000001";
  await prisma.user.upsert({
    where: { phone },
    update: {},
    create: {
      fullName: "Test Admin",
      phone,
      passwordHash: await bcrypt.hash("Demo@1234", 4),
      role: "ADMIN",
      wallet: { create: {} },
    },
  });
  const login = await request(app).post("/api/v1/auth/login").send({ phone, password: "Demo@1234" });
  if (login.status !== 200) throw new Error("admin login failed");
  adminCtx = { accessToken: login.body.data.accessToken, userId: login.body.data.user.id };
  return adminCtx;
}

/** Registers a fresh user then elevates their role directly in the DB. */
export async function createUserWithRole(role: string): Promise<{ accessToken: string; userId: string; phone: string }> {
  const f = await registerFarmer();
  await prisma.user.update({ where: { id: f.user.id }, data: { role } });
  const login = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: f.plainPassword });
  if (login.status !== 200) throw new Error(`login after role change failed for ${role}`);
  return { accessToken: login.body.data.accessToken, userId: f.user.id, phone: f.phone };
}

export async function createFarmWithCrop(token: string, cropName = "ধান", plantedDaysAgo = 30) {
  const farmRes = await request(app)
    .post("/api/v1/farms")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "টেস্ট ফার্ম", district: "রংপুর", lat: 25.9, lng: 89.1, totalAreaBigha: 5 });
  const farmId = farmRes.body.data.id as string;

  const plotRes = await request(app)
    .post(`/api/v1/farms/${farmId}/plots`)
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "প্লট-১", areaBigha: 2 });
  const plotId = plotRes.body.data.id as string;

  const cropRes = await request(app)
    .post("/api/v1/farms/crops")
    .set("Authorization", `Bearer ${token}`)
    .send({
      plotId,
      cropName,
      plantedAt: new Date(Date.now() - plantedDaysAgo * 86400000).toISOString(),
    });
  const cropId = cropRes.body.data.id as string;

  return { farmId, plotId, cropId };
}
