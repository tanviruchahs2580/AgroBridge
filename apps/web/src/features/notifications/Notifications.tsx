import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../../lib/api";
import type { AppNotification, NotificationPreferences, NotificationsData } from "../../lib/api-types";
import { invalidate, useResource } from "../../lib/useResource";
import { RESOURCE_KEYS } from "../../lib/resourceKeys";
import { useSession } from "../../lib/session";
import { t } from "../../lib/i18n";
import type { DictKey } from "../../lib/i18n";
import { formatDateTime } from "../../lib/format";
import { mapError } from "../../lib/errors-ui";
import { notifCategoryLabel } from "../../lib/labels";
import { Award, Bell, BellOff, Bot, Check, CloudSun, CreditCard, Megaphone, Package, Settings, Sprout, Tractor } from "lucide-react";
import {
  Badge, BlockError, Button, Card, EmptyState, Label, PageHeader, Skeleton, useToast,
} from "../../components/ui";

const TYPE_ICONS: Record<string, ReactNode> = {
  ORDER: <Package className="h-5 w-5" aria-hidden />,
  BOOKING: <Tractor className="h-5 w-5" aria-hidden />,
  PROCUREMENT: <Sprout className="h-5 w-5" aria-hidden />,
  PAYMENT: <CreditCard className="h-5 w-5" aria-hidden />,
  WEATHER: <CloudSun className="h-5 w-5" aria-hidden />,
  AI: <Bot className="h-5 w-5" aria-hidden />,
  MEMBERSHIP: <Award className="h-5 w-5" aria-hidden />,
  SYSTEM: <Megaphone className="h-5 w-5" aria-hidden />,
};

type TabKey = "ALL" | "CRITICAL" | "ACTION" | "INFO";

/**
 * The list payload travels with the tab it was fetched for: only an ALL-tab
 * response carries the *unfiltered* `unread` (a filtered response's `unread` is
 * the count within the filtered items), so the header counts may be taken from
 * an ALL payload and from nothing else.
 */
interface NotificationsFeed {
  tab: TabKey;
  payload: NotificationsData;
}

/** Toggle switch (3 prefs share one pattern); keeps the native role=switch semantics. */
function ToggleSwitch({
  id,
  label,
  checked,
  onToggle,
  busy = false,
}: {
  id: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
  /** The switch's own PATCH is in flight — announced, and non-interactive meanwhile. */
  busy?: boolean;
}) {
  return (
    // The button is 44px tall and the 28px track sits inside it: the switch keeps
    // its exact appearance while the hit area meets the app's own 44px target
    // (the button itself was 28px tall).
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={busy}
      onClick={onToggle}
      className="relative inline-flex h-11 shrink-0 items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] focus-visible:ring-offset-2 ring-offset-[var(--color-surface-bg)] disabled:cursor-progress"
    >
      <span
        aria-hidden
        className={`relative h-7 w-12 rounded-full transition-colors motion-reduce:transition-none ${checked ? "bg-action" : "bg-stone-300"}`}
      >
        {/* transform, not `left`: the knob animates on the compositor and the
            22px travel is derived from the 2px inset + 20px shift, not a magic
            offset. */}
        <span
          className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform motion-reduce:transition-none ${checked ? "translate-x-5" : "translate-x-0"}`}
        />
      </span>
    </button>
  );
}

const TABS: { id: TabKey; key: DictKey }[] = [
  { id: "ALL", key: "tabAll" },
  { id: "CRITICAL", key: "notifCategoryCRITICAL" },
  { id: "ACTION", key: "notifCategoryACTION" },
  { id: "INFO", key: "notifCategoryINFO" },
];

export default function Notifications() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const toast = useToast();

  const [tab, setTab] = useState<TabKey>("ALL");
  const [markingAll, setMarkingAll] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  /** Preference key whose PATCH is in flight — serializes the switches. */
  const [prefBusy, setPrefBusy] = useState<keyof NotificationPreferences | null>(null);

  // The screen reads two independent endpoints, so it holds two independent
  // resources: a failed preferences fetch never hides the list, and vice versa.
  // The category is a query parameter, so it rides `deps` — switching tabs
  // refetches this resource exactly as the old load(tab) did, and nothing else.
  const notificationsRes = useResource<NotificationsFeed>(
    RESOURCE_KEYS.notifications,
    async () => {
      const which = tab;
      const payload = await api<NotificationsData>("GET", `/notifications${which === "ALL" ? "" : `?category=${which}`}`);
      return { tab: which, payload };
    },
    [tab]
  );
  const prefsRes = useResource<NotificationPreferences>("notifications-preferences", () => api<NotificationPreferences>("GET", "/notifications/preferences"));

  const items: AppNotification[] = notificationsRes.data?.payload.items ?? [];
  const prefs = prefsRes.data;

  const [unread, setUnread] = useState(0);
  const [metaCounts, setMetaCounts] = useState<{ critical: number; action: number }>({ critical: 0, action: 0 });

  // Meta only carries critical/action unread counts (verified against
  // notifications routes); the INFO count is derived client-side. This mirror
  // keeps the old stickiness exactly: a filtered result never rewrites the
  // header counts, and a failed load leaves the last good ones in place.
  useEffect(() => {
    const feed = notificationsRes.data;
    if (!feed || feed.tab !== "ALL") return;
    setUnread(feed.payload.unread);
    setMetaCounts({ critical: feed.payload.counts?.critical ?? 0, action: feed.payload.counts?.action ?? 0 });
  }, [notificationsRes.data]);

  async function markAll() {
    setMarkingAll(true);
    try {
      await api("POST", "/notifications/read", { all: true });
      // {all:true} marks every notification read server-side, so the counters
      // are deterministically zero. The visible tab's list reloads below, but a
      // filtered tab never recomputes `unread`/`metaCounts` (only an ALL result
      // does) — zero them here or the header badge goes stale.
      setUnread(0);
      setMetaCounts({ critical: 0, action: 0 });
      // The old code awaited load(tab), which refetched exactly this resource
      // (the preferences are untouched by a read).
      invalidate(RESOURCE_KEYS.notifications);
    } catch (err) {
      toast.error(mapError(err, lang));
    } finally {
      setMarkingAll(false);
    }
  }

  async function togglePref(key: keyof NotificationPreferences) {
    if (!prefs) return;
    // One in-flight toggle per switch. Two issues lived here: there was no guard at
    // all, so rapid taps issued overlapping full-object PATCHes from the same base;
    // and the failure path restored a snapshot captured *before* its own request,
    // which could silently undo a newer successful write.
    if (prefBusy) return;
    const next: NotificationPreferences = { ...prefs, [key]: !prefs[key] };
    setPrefBusy(key);
    prefsRes.setData(next); // optimistic: the switch moves immediately
    try {
      const saved = await api<NotificationPreferences>("PATCH", "/notifications/preferences", next);
      // The server owns the stored object; take its answer rather than leaving the
      // optimistic copy in place.
      if (saved) prefsRes.setData(saved);
      toast.success(t("prefsSavedToast", lang));
    } catch (err) {
      // Reconcile with the server instead of restoring a possibly-superseded
      // snapshot, so a failed toggle cannot resurrect an older state.
      invalidate("notifications-preferences");
      toast.error(mapError(err, lang));
    } finally {
      setPrefBusy(null);
    }
  }

  const infoCount = items.filter((n) => n.category === "INFO" && !n.readAt).length;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        icon={<Bell className="h-5 w-5" aria-hidden />}
        title={t("notifications", lang)}
        action={
          <div className="flex items-center gap-2">
            {unread > 0 && (
              <Badge tone="danger" aria-live="polite" aria-atomic="true" aria-label={`${unread} ${t("notifUnreadSr", lang)}`}>
                {unread}<span className="sr-only"> {t("notifUnreadSr", lang)}</span>
              </Badge>
            )}
            <Button variant="ghost" size="sm" aria-expanded={prefsOpen} onClick={() => setPrefsOpen((v) => !v)}>
              <Settings className="mr-1 inline h-4 w-4" aria-hidden /> {t("prefsTitle", lang)}
            </Button>
            {unread > 0 && (
              <Button variant="outline" size="sm" loading={markingAll} onClick={() => void markAll()}>
                <Check className="mr-1 inline h-4 w-4" aria-hidden /> {t("markAllRead", lang)}
              </Button>
            )}
          </div>
        }
      />

      {/* Category filter chips with counts from response meta.
          Buttons + aria-pressed (not role=tab): these filter one list, there is
          no tabpanel association — the tabs pattern would mislead AT. */}
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("notifications", lang)}>
        {TABS.map((tb) => {
          const active = tab === tb.id;
          const count =
            tb.id === "ALL" ? unread : tb.id === "CRITICAL" ? metaCounts.critical : tb.id === "ACTION" ? metaCounts.action : tab === "ALL" ? infoCount : null;
          return (
            <button
              key={tb.id}
              type="button"
              aria-pressed={active}
              onClick={() => setTab(tb.id)}
              className={`min-h-[44px] rounded-full px-4 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] ${
                active ? "bg-action text-white shadow-sm" : "bg-surface-card text-stone-600 ring-1 ring-inset ring-surface-border-strong hover:bg-brand-50"
              }`}
            >
              {t(tb.key, lang)}
              {count !== null && count > 0 && (
                // On the active tab the badge used `bg-white/20` with the tab's own
                // `text-white` inherited, so a 20%-white fill over the green action
                // colour put white-on-white-ish at roughly 3.4:1 — a serious
                // colour-contrast violation axe reported on this route. A solid
                // light pill with the accent colour as text clears AA and reads as
                // a counter rather than a smudge.
                <span aria-live="polite" className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs font-bold ${active ? "bg-surface-card text-accent" : "bg-danger-bg text-danger-text"}`}>
                  {count}<span className="sr-only"> {t("notifCountSr", lang)}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Preferences panel — its own resource: a failure here shows its own
          banner with retry and never affects the list. */}
      {prefsOpen &&
        (prefs ? (
          <Card>
            <h2 className="font-semibold text-stone-700">{t("prefsTitle", lang)}</h2>
            <p className="mb-3 mt-1 text-xs text-stone-600">{t("prefsDescription", lang)}</p>
            <div className="space-y-2">
              {([
                ["critical", "prefCategoryCritical"],
                ["action", "prefCategoryAction"],
                ["info", "prefCategoryInfo"],
              ] as [keyof NotificationPreferences, DictKey][]).map(([key, labelKey]) => (
                <div key={key} className="flex items-center justify-between gap-3 rounded-lg bg-stone-50 px-3 py-2">
                  <Label className="!mb-0 flex-1 cursor-pointer text-sm" htmlFor={`pref-${key}`}>
                    {t(labelKey, lang)}
                  </Label>
                  <ToggleSwitch id={`pref-${key}`} label={t(labelKey, lang)} checked={prefs[key]} busy={prefBusy === key} onToggle={() => void togglePref(key)} />
                </div>
              ))}
            </div>
          </Card>
        ) : prefsRes.loading ? (
          <Card><Skeleton className="h-24 w-full" /></Card>
        ) : (
          // The old catch discarded the fetch error and always showed the
          // generic copy; the copy is unchanged, the retry is the resource's.
          <BlockError
            error={prefsRes.error ? t("errorGeneric", lang) : null}
            retryLabel={t("retry", lang)}
            onRetry={() => void prefsRes.reload()}
          />
        ))}

      {/* The list: its own error with retry. */}
      <BlockError error={notificationsRes.error} retryLabel={t("retry", lang)} onRetry={() => void notificationsRes.reload()} />

      {notificationsRes.loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="flex gap-3"><Skeleton className="h-full w-8" /><div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-full" /></div></Card>
          ))}
        </div>
      ) : items.length === 0 && !notificationsRes.error ? (
        <EmptyState icon={<BellOff className="h-10 w-10 text-stone-300" aria-hidden />} title={t("noNotifications", lang)} />
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <Card key={n.id} className={`flex gap-3 ${!n.readAt ? "border-brand-200 bg-brand-50" : ""}`}>
              <span className="flex items-center text-stone-500" aria-hidden>{TYPE_ICONS[n.type] ?? <Megaphone className="h-5 w-5" aria-hidden />}</span>
              {/* Unread was conveyed by the tinted card alone — a colour-only state
                  (WCAG 1.4.1). This gives it a text equivalent that assistive
                  technology announces and a low-vision reader can still detect. */}
              {!n.readAt && <span className="sr-only">{t("notifUnread", lang)}</span>}
              <div className="flex-1">
                <p className="text-sm font-semibold text-stone-800">
                  {n.title}
                  {n.category && n.category !== "INFO" && (
                    <Badge tone={n.category === "CRITICAL" ? "danger" : "warning"} className="ml-2 align-middle">
                      {notifCategoryLabel(n.category, lang)}
                    </Badge>
                  )}
                </p>
                <p className="text-xs text-stone-600">{n.body}</p>
                <p className="mt-1 text-xs text-stone-500">{formatDateTime(n.createdAt, lang)}</p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
