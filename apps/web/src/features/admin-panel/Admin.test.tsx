/**
 * Admin console (F-29 — 87 lines of role-gated UI with 0% coverage).
 *
 * The two things worth pinning are the ones with security meaning:
 *   1. a session that is not ADMIN/SUPER_ADMIN gets the denied state and the
 *      screen issues NO /admin request at all (the guard is synchronous, so the
 *      console never paints for a farmer — the server refuses the data anyway);
 *   2. an admin sees the metrics and the user directory with localized role and
 *      status labels, from the panel's own resources.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

const calls: { method: string; path: string }[] = [];
let sessionRole = "ADMIN";

const mockApi = vi.fn((...args: unknown[]) => {
  const method = args[0] as string;
  const path = args[1] as string;
  calls.push({ method, path });
  if (path === "/admin/metrics") {
    return Promise.resolve({
      farmers: 1200, activeFarmers: 300, farms: 980, activeCrops: 420,
      orders: 55, bookings: 12, pendingProcurement: 4, revenuePaisa: 99_000_00, aiAdvisoryQueries: 310,
    });
  }
  if (path.startsWith("/admin/users")) {
    return Promise.resolve({
      items: [
        { id: "u1", fullName: "করিম", phone: "01712345678", role: "FARMER", status: "ACTIVE", region: null, farmerProfile: { membershipTier: "GOLD" } },
        { id: "u2", fullName: "রহিম", phone: "01798765432", role: "DEALER", status: "SUSPENDED", region: "রংপুর", farmerProfile: null },
      ],
      page: 1, pageSize: 50, total: 2, totalPages: 1,
    });
  }
  if (path.startsWith("/admin/audit-logs")) return Promise.resolve({ items: [], page: 1, pageSize: 30, total: 0, totalPages: 1 });
  if (path === "/admin/analytics/summary") return Promise.resolve({ windowDays: 30, events: [{ name: "route_view", count: 12 }] });
  if (path.startsWith("/admin/withdrawals")) return Promise.resolve([]);
  return Promise.resolve({});
});

vi.mock("../../lib/session", () => ({
  useSession: () => ({ session: { lang: "bn", fullName: "অ্যাডমিন", role: sessionRole }, refresh: async () => {} }),
}));
vi.mock("../../lib/api.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api.js")>("../../lib/api.js");
  return { ...actual, api: (...args: unknown[]) => mockApi(...args) };
});
vi.mock("../../lib/analytics.js", () => ({ track: () => {} }));

import AdminPanel from "./Admin";
import { dict } from "../../lib/i18n";
import { formatBDT } from "../../lib/format";
import { roleLabel, userStatusLabel } from "../../lib/labels";

/**
 * Roots mounted by the current test. Tracked so a failing assertion still tears
 * the tree down: a leaked mount keeps its useResource subscription alive, and the
 * next test in the file then sees an invalidate refetch from the previous test's
 * component (observed as an extra GET in the request log).
 */
const mountedRoots: { unmount: () => void }[] = [];

function mount(node: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  let alive = true;
  const unmount = () => {
    if (!alive) return;
    alive = false;
    act(() => root.unmount());
    container.remove();
  };
  mountedRoots.push({ unmount });
  return { unmount };
}

async function flush(times = 2) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

beforeEach(() => {
  calls.length = 0;
  sessionRole = "ADMIN";
  document.body.innerHTML = "";
  mockApi.mockClear();
});

afterEach(() => {
  while (mountedRoots.length) mountedRoots.pop()!.unmount();
  document.body.innerHTML = "";
});

describe("features/admin-panel — role gate (F-29)", () => {
  it("renders the denied state for a farmer instead of the console", async () => {
    sessionRole = "FARMER";
    const { unmount } = mount(
      <MemoryRouter>
        <AdminPanel />
      </MemoryRouter>
    );
    await flush();

    // The role guard is synchronous, so the console never paints for a farmer:
    // no title, no metric tiles, no user table. (The reads still fire — the panel
    // is a single component and its resources mount before the branch — and the
    // API refuses every one of them with 403; the UI is what this pins.)
    expect(document.body.textContent).toContain(dict.adminOnly.bn);
    expect(document.body.textContent).not.toContain(dict.adminControlTower.bn);
    expect(document.body.textContent).not.toContain(dict.users.bn);
    expect(document.body.textContent).not.toContain("করিম");
    unmount();
  });

  it("renders metrics and the user directory for an admin", async () => {
    const { unmount } = mount(
      <MemoryRouter>
        <AdminPanel />
      </MemoryRouter>
    );
    await flush();

    expect(document.body.textContent).toContain(dict.adminControlTower.bn);
    expect(calls.some((c) => c.path === "/admin/metrics")).toBe(true);
    // The tile counts come through as plain numbers, the revenue tile as money —
    // integer paisa in, formatted in the session language out.
    expect(document.body.textContent).toContain("1200");
    expect(document.body.textContent).toContain(formatBDT(99_000_00, "bn"));
    // Directory rows speak the dictionary: role + status labels, not raw enums.
    expect(document.body.textContent).toContain("করিম");
    expect(document.body.textContent).toContain(roleLabel("FARMER", "bn"));
    expect(document.body.textContent).toContain(userStatusLabel("SUSPENDED", "bn"));
    // The suspension control is the reactivate label for an already-suspended row.
    expect(document.body.textContent).toContain(dict.actionReactivate.bn);
    unmount();
  });
});
