/**
 * ServiceCard — the hero-image failure path (folded audit item).
 *
 * The old `onError` set `opacity: 0` on the broken `<img>`, so a hero that 404s
 * or is blocked left the largest area of the card as an empty tinted hole with
 * no explanation and no fallback. The card now swaps in the category mark inside
 * the same fixed-height slot; this pins that swap and the alt-text contract.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";

import { ServiceCard } from "./ServiceCard";
import { serviceCategoryLabel } from "../../lib/labels";
import { t } from "../../lib/i18n";

const mountedRoots: { unmount: () => void }[] = [];

function mount(node: ReactElement): { unmount: () => void } {
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

function renderCard() {
  return mount(
    <ServiceCard
      title="ট্রাক্টর ভাড়া"
      category="TRACTOR"
      pricePaisa={150000}
      priceUnit="PER_BIGHA"
      description={null}
      providers={[{ id: "pv1", name: "রহিম", district: "রংপুর", ratingSum: 9, ratingCount: 2 }]}
      lang="bn"
      onBook={() => {}}
    />
  );
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  while (mountedRoots.length) mountedRoots.pop()?.unmount();
  document.body.innerHTML = "";
});

describe("components/service — ServiceCard hero fallback", () => {
  it("shows the hero with an alt that names the service and its category", () => {
    const { unmount } = renderCard();

    const img = document.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.getAttribute("alt")).toBe(`ট্রাক্টর ভাড়া — ${serviceCategoryLabel("TRACTOR", "bn")}`);
    unmount();
  });

  it("replaces a failed hero with the category mark instead of an invisible hole", () => {
    const { unmount } = renderCard();
    const img = document.querySelector("img");
    expect(img).toBeTruthy();

    // The browser fires `error` on the <img> when the bytes never arrive.
    act(() => {
      img?.dispatchEvent(new Event("error"));
    });

    // The broken image is gone (the old handler only made it invisible, so the
    // slot — and the alt text — stayed in the accessibility tree as a hole)…
    expect(document.querySelector("img")).toBeNull();
    // …and the slot is occupied by a decorative stand-in, not by an error banner
    // restating what the user cannot act on.
    const hero = document.querySelector("div.relative.h-44");
    expect(hero?.querySelector("svg")).toBeTruthy();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    // The card's own content is untouched by the image failure.
    expect(document.body.textContent).toContain("ট্রাক্টর ভাড়া");
    expect(document.body.textContent).toContain(t("bookNow", "bn"));
    unmount();
  });
});
