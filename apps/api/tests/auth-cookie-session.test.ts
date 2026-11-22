import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";

/**
 * SEC-02 — session cookies: the refresh token rides an HttpOnly cookie
 * (SameSite=None; Partitioned; Secure — cross-site by deployment) with a
 * readable CSRF pair, while the body transport stays accepted for the Android
 * migration window. Cookie-transport callers must pass the CSRF double-submit;
 * body-transport callers authenticate by possession of the secret itself.
 *
 * The cookie transport is driven with explicit Cookie headers: supertest's jar
 * refuses to SEND Secure cookies over plain http (real browsers treat
 * localhost as a trustworthy context and do send them), so a jar-based test
 * would pin the harness, not the server. The ab_rt value comes from the login
 * body copy — the exact value the API put into the HttpOnly cookie.
 */
function cookieValue(setCookie: string | string[] | undefined, name: string): string | null {
  if (!setCookie) return null;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const c of arr) {
    const m = c.match(new RegExp(`${name}=([^;]+)`));
    if (m) return m[1];
  }
  return null;
}

describe("SEC-02 — session cookies", () => {
  it("login sets HttpOnly ab_rt + readable ab_csrf and keeps the body copy (migration window)", async () => {
    const f = await registerFarmer();
    const res = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: f.plainPassword });
    expect(res.status).toBe(200);
    const setCookie = res.headers["set-cookie"] as unknown as string[];
    const rtCookie = setCookie.find((c) => c.startsWith("ab_rt=")) ?? "";
    const csrfCookie = setCookie.find((c) => c.startsWith("ab_csrf=")) ?? "";
    // This suite runs the dev/test profile: web and API are same-origin through
    // the local proxy, so the cookie is SameSite=Lax without Secure (the
    // cross-site production profile emits SameSite=None; Partitioned; Secure —
    // see lib/sessionCookies.ts). HttpOnly + narrow path hold in BOTH profiles.
    expect(rtCookie).toContain("HttpOnly");
    expect(rtCookie).toContain("SameSite=Lax");
    expect(rtCookie).not.toContain("Partitioned");
    expect(rtCookie).toContain("Path=/api/v1/auth");
    expect(csrfCookie).not.toContain("HttpOnly");
    expect(cookieValue(setCookie, "ab_csrf")).toMatch(/^[0-9a-f]{32}$/);
    // Body copy stays for clients that cannot carry cookies.
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.accessToken).toBeTruthy();
  });

  it("cookie-transport refresh works with the CSRF pair and rotates both cookies", async () => {
    const f = await registerFarmer();
    const login = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: f.plainPassword });
    const rt = login.body.data.refreshToken as string;
    const csrf1 = cookieValue(login.headers["set-cookie"] as unknown as string[], "ab_csrf");
    expect(csrf1).toBeTruthy();

    const refresh = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", `ab_rt=${rt}; ab_csrf=${csrf1}`)
      .set("X-CSRF-Token", csrf1!)
      .send({});
    expect(refresh.status).toBe(200);
    expect(refresh.body.data.accessToken).toBeTruthy();
    expect(refresh.body.data.refreshToken).toBeTruthy();

    // Rotation: a fresh CSRF pair rides the new refresh token.
    const csrf2 = cookieValue(refresh.headers["set-cookie"] as unknown as string[], "ab_csrf");
    expect(csrf2).toBeTruthy();
    expect(csrf2).not.toBe(csrf1);

    // The rotated pair is live: another cookie-transport refresh with the NEW
    // token and csrf succeeds, and the old body token is now revoked.
    const refresh2 = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", `ab_rt=${refresh.body.data.refreshToken}; ab_csrf=${csrf2}`)
      .set("X-CSRF-Token", csrf2!)
      .send({});
    expect(refresh2.status).toBe(200);
    const stale = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: rt });
    expect(stale.status).toBe(401);
  });

  it("cookie-transport refresh without or with a wrong CSRF token is refused", async () => {
    const f = await registerFarmer();
    const login = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: f.plainPassword });
    const rt = login.body.data.refreshToken as string;
    const csrf = cookieValue(login.headers["set-cookie"] as unknown as string[], "ab_csrf");

    const noHeader = await request(app).post("/api/v1/auth/refresh").set("Cookie", `ab_rt=${rt}`).send({});
    expect(noHeader.status).toBe(401);
    expect(noHeader.body.error.code).toBe("UNAUTHORIZED");

    const wrongHeader = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", `ab_rt=${rt}; ab_csrf=${csrf}`)
      .set("X-CSRF-Token", "deadbeef".repeat(4))
      .send({});
    expect(wrongHeader.status).toBe(401);
    // Neither attempt may consume the token: the rotation claim is untouched.
    const stillValid = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", `ab_rt=${rt}; ab_csrf=${csrf}`)
      .set("X-CSRF-Token", csrf!)
      .send({});
    expect(stillValid.status).toBe(200);
  });

  it("body-transport refresh needs no CSRF (Android migration window, e2e fixture)", async () => {
    const f = await registerFarmer();
    const login = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: f.plainPassword });
    const rt = login.body.data.refreshToken as string;
    const res = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: rt });
    expect(res.status).toBe(200);
    // The body path still refreshes the cookies alongside.
    expect(cookieValue(res.headers["set-cookie"] as unknown as string[], "ab_rt")).toBeTruthy();
  });

  it("an empty body with no cookies and no CSRF is refused", async () => {
    const res = await request(app).post("/api/v1/auth/refresh").send({});
    expect(res.status).toBe(401);
  });

  it("logout with cookie transport revokes the cookie token and clears the cookies", async () => {
    const f = await registerFarmer();
    const login = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: f.plainPassword });
    const at = login.body.data.accessToken as string;
    const rt = login.body.data.refreshToken as string;
    const csrf = cookieValue(login.headers["set-cookie"] as unknown as string[], "ab_csrf");

    const out = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${at}`)
      .set("Cookie", `ab_rt=${rt}; ab_csrf=${csrf}`)
      .send({});
    expect(out.status).toBe(200);
    const cleared = (out.headers["set-cookie"] as unknown as string[]).join("\n");
    expect(cleared).toMatch(/ab_rt=;/);
    expect(cleared).toMatch(/ab_csrf=;/);

    // The cookie's token is revoked: replaying it through the body transport
    // (the way a stale client would) is dead — and family revocation means the
    // whole session is gone.
    const replay = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: rt });
    expect(replay.status).toBe(401);
  });
});
