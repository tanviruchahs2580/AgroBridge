import { describe, expect, it } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { app, registerFarmer } from "./helpers.js";

/**
 * The generated route inventory crossed with the two cheapest universal
 * authorization checks: nobody unauthenticated reaches a non-public route, and
 * a FARMER (the role with no permission grants at all) is refused by every
 * permission-gated route. This is the negative-test backstop behind B-08/B-10:
 * a route added without its auth middleware fails here even if its own suite
 * forgot a negative case, and an unmapped new router fails the meta-assertion
 * instead of being silently skipped.
 */
const matrix = JSON.parse(
  readFileSync(path.resolve("../../docs/generated/route-matrix.json"), "utf8")
) as {
  total: number;
  routes: { module: string; router: string; method: string; path: string; auth: string }[];
};

/** router -> mount prefix under /api/v1 (source of truth: src/app.ts mounting). */
const MOUNT: Record<string, string> = {
  authRouter: "/auth",
  farmsRouter: "/farms",
  cropsRouter: "/farms",
  plotsRouter: "/farms/e2e-dummy-001",
  eventsRouter: "/farms/e2e-dummy-001",
  weatherRouter: "/weather",
  aiRouter: "/ai",
  diseaseRouter: "/disease",
  productsRouter: "/products",
  cartRouter: "/cart",
  ordersRouter: "/orders",
  servicesRouter: "/services",
  bookingsRouter: "/bookings",
  procurementRouter: "/procurement",
  paymentsRouter: "/payments",
  walletRouter: "/wallet",
  membershipRouter: "/membership",
  notificationsRouter: "/notifications",
  adminRouter: "/admin",
  organizationsRouter: "/organizations",
  analyticsRouter: "/analytics",
  opsRouter: "/ops",
  paymentWebhookRouter: "/payments",
};

function fullPath(route: { router: string; module: string; path: string }): string {
  const mount = MOUNT[route.router];
  if (!mount) return `UNMAPPED:${route.router}`;
  const sub = route.path.replace(/:([A-Za-z]+)/g, (_m, name) => `${name === "cropId" ? "e2e-crop-0001" : "e2e-dummy-001"}`);
  return `/api/v1${mount}${sub === "/" ? "" : sub}`;
}

describe("auth matrix over the route inventory (B-08 / B-10)", () => {
  it("covers every inventory route (no unmapped routers)", () => {
    const unmapped = [...new Set(matrix.routes.map((r) => r.router).filter((x) => !MOUNT[x]))];
    expect(unmapped, "add the new router's mount to MOUNT in this test").toEqual([]);
    expect(matrix.routes.length).toBe(matrix.total);
  });

  it("refuses every non-public route without a token (401) and every permission route for a FARMER (403)", async () => {
    const farmer = await registerFarmer();
    const failures: string[] = [];
    for (const route of matrix.routes) {
      if (route.auth === "PUBLIC") continue;
      const url = fullPath(route);
      if (url.startsWith("UNMAPPED")) {
        failures.push(`${route.method} ${url}`);
        continue;
      }
      // Unauthenticated: middleware runs before validation, so the body is irrelevant.
      const anon = await request(app)[route.method.toLowerCase() as "get"](url);
      if (anon.status !== 401) {
        failures.push(`${route.method} ${url}: anon got ${anon.status}, want 401`);
      }
      if (route.auth.startsWith("requirePermission:")) {
        const asFarmer = await request(app)
          [route.method.toLowerCase() as "get"](url)
          .set("Authorization", `Bearer ${farmer.accessToken}`);
        if (asFarmer.status !== 403) {
          failures.push(`${route.method} ${url}: farmer got ${asFarmer.status}, want 403 (${route.auth})`);
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  }, 120_000);
});
