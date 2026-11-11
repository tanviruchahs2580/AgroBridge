/**
 * Notifications screen (F-29 — 58 lines, 0% coverage).
 *
 * The screen holds two independent resources on purpose (the list and the
 * preferences), and the unread counter has one documented subtlety: only an
 * ALL-tab response may write it, because a filtered response's `unread` counts
 * within the filtered set. Both are pinned here, with the writes the user
 * triggers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";

const calls: { method: string; path: string; body?: unknown }[] = [];
/** Server-side truth for the fixture: marking all read is visible on the next read. */
let markedAllRead = false;

const mockApi = vi.fn((...args: unknown[]) => {
  const method = args[0] as string;
  const path = args[1] as string;
  calls.push({ method, path, body: args[2] });
  if (method === "GET" && path === "/notifications") {
    return Promise.resolve({
      items: [
        { id: "n1", userId: "u1", type: "PAYMENT", category: "CRITICAL", title: "অর্ডার সমস্যা", body: "পেমেন্ট যাচাই দরকার", readAt: markedAllRead ? "2026-11-10T00:00:00.000Z" : null, refType: null, refId: null, createdAt: "2026-11-09T00:00:00.000Z" },
        { id: "n2", userId: "u1", type: "SYSTEM", category: "INFO", title: "নতুন সেবা", body: "ড্রোন সেবা যোগ হয়েছে", readAt: "2026-11-08T00:00:00.000Z", refType: null, refId: null, createdAt: "2026-11-08T00:00:00.000Z" },
      ],
      unread: markedAllRead ? 0 : 1,
      counts: { critical: markedAllRead ? 0 : 1, action: 0, info: 1 },
    });
  }
  if (method === "GET" && path === "/notifications/preferences") return Promise.resolve({ critical: true, action: false, info: true });
  if (method === "POST" && path === "/notifications/read") {
    markedAllRead = true;
    return Promise.resolve({ marked: 1 });
  }
  if (method === "PATCH" && path === "/notifications/preferences") return Promise.resolve(args[2]);
  return Promise.resolve({});
});

vi.mock("../../lib/session", () => ({
  useSession: () => ({ session: { lang: "bn", fullName: "Test", role: "FARMER" }, refresh: async () => {} }),
}));
vi.mock("../../lib/api.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api.js")>("../../lib/api.js");
  return { ...actual, api: (...args: unknown[]) => mockApi(...args) };
});
vi.mock("../../lib/analytics.js", () => ({ track: () => {} }));

import Notifications from "./Notifications";
import { dict } from "../../lib/i18n";

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

function buttonWithText(needle: string): HTMLButtonElement {
  const hit = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes(needle));
  if (!hit) throw new Error(`no button containing "${needle}"`);
  return hit as HTMLButtonElement;
}

/**
 * The category tab whose own label starts with `needle`. Scoped to the tabs by
 * their `aria-pressed` (the mark-all control carries none) — and a substring
 * finder alone is not enough either: the mark-all copy contains the ALL tab's
 * word ("সব" inside "সব পড়া হয়েছে"), so a substring search returned the wrong
 * control.
 */
function tabText(needle: string): string {
  const hit = Array.from(document.querySelectorAll("button[aria-pressed]")).find((b) => (b.textContent ?? "").trim().startsWith(needle));
  return hit?.textContent ?? "";
}

beforeEach(() => {
  calls.length = 0;
  markedAllRead = false;
  document.body.innerHTML = "";
  mockApi.mockClear();
});

afterEach(() => {
  while (mountedRoots.length) mountedRoots.pop()!.unmount();
  document.body.innerHTML = "";
});

describe("features/notifications — list, unread count and writes (F-29)", () => {
  it("renders both notifications, the unread badge and the unread text equivalent", async () => {
    const { unmount } = mount(<Notifications />);
    await flush();

    expect(document.body.textContent).toContain("অর্ডার সমস্যা");
    expect(document.body.textContent).toContain("নতুন সেবা");
    // The unread state is not colour-only: it carries a text equivalent, and the
    // header badge counts the ALL response's unread.
    expect(document.body.textContent).toContain(dict.notifUnread.bn);
    expect(tabText(dict.tabAll.bn)).toContain("1");
    unmount();
  });

  it("mark-all-read posts {all:true} and zeroes the header count without a filtered reload", async () => {
    const { unmount } = mount(<Notifications />);
    await flush();

    await act(async () => {
      buttonWithText(dict.markAllRead.bn).click();
    });
    await flush();

    expect(mockApi).toHaveBeenCalledWith("POST", "/notifications/read", { all: true });
    // Marked server-side, so the header badge — which only an ALL response may
    // write — must not wait for a filtered refetch that would never recompute it.
    // The refetch then confirms it: nothing is unread any more.
    expect(tabText(dict.tabAll.bn)).not.toContain("1");
    expect(document.body.textContent).not.toContain(dict.notifUnread.bn);
    // The one subscription refetches exactly this resource: mount read + invalidate.
    expect(calls.filter((c) => c.method === "GET" && c.path === "/notifications").length).toBe(2);
    unmount();
  });

  it("toggling a preference PATCHes the whole object with the flipped field", async () => {
    const { unmount } = mount(<Notifications />);
    await flush();

    await act(async () => {
      buttonWithText(dict.prefsTitle.bn).click();
    });
    await flush();
    const switches = document.querySelectorAll<HTMLButtonElement>('button[role="switch"]');
    expect(switches.length).toBe(3);

    // The action switch is off in the fixture; turning it on must send the
    // complete preferences object, not a patch fragment.
    await act(async () => {
      switches[1].click();
    });
    await flush();

    const patch = calls.find((c) => c.method === "PATCH" && c.path === "/notifications/preferences");
    expect(patch!.body).toEqual({ critical: true, action: true, info: true });
    expect(switches[1].getAttribute("aria-checked")).toBe("true");
    unmount();
  });
});
