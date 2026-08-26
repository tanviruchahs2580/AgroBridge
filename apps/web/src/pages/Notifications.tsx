import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";
import type { DictKey } from "../lib/i18n.js";
import { formatDateTime } from "../lib/format.js";
import { mapError } from "../lib/errors-ui.js";
import { notifCategoryLabel } from "../lib/labels.js";
import {
  Badge, Button, Card, EmptyState, ErrorBanner, Label, Skeleton, useToast,
} from "../components/ui.jsx";

interface Notification {
  id: string;
  type: string;
  category?: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

interface Prefs {
  critical: boolean;
  action: boolean;
  info: boolean;
}

const TYPE_ICONS: Record<string, string> = {
  ORDER: "📦", BOOKING: "🚜", PROCUREMENT: "🌾", PAYMENT: "💳",
  WEATHER: "🌦️", AI: "🤖", MEMBERSHIP: "🎖️", SYSTEM: "📢",
};

type TabKey = "ALL" | "CRITICAL" | "ACTION" | "INFO";

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

  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [metaCounts, setMetaCounts] = useState<{ critical: number; action: number }>({ critical: 0, action: 0 });
  const [tab, setTab] = useState<TabKey>("ALL");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefsFailed, setPrefsFailed] = useState(false);

  const load = useCallback(
    async (which: TabKey) => {
      setLoading(true);
      setLoadError(null);
      try {
        const q = which === "ALL" ? "" : `?category=${which}`;
        const data = await api<{ items: Notification[]; unread: number; counts?: { critical: number; action: number } }>(
          "GET",
          `/notifications${q}`
        );
        setItems(data.items);
        if (which === "ALL") {
          // Meta only carries critical/action unread counts (verified against
          // notifications routes); the INFO count is derived client-side.
          setUnread(data.unread);
          setMetaCounts({ critical: data.counts?.critical ?? 0, action: data.counts?.action ?? 0 });
        }
      } catch (err) {
        setLoadError(mapError(err, lang));
      } finally {
        setLoading(false);
      }
    },
    [lang]
  );

  useEffect(() => {
    void load(tab);
  }, [tab, load]);

  useEffect(() => {
    api<Prefs>("GET", "/notifications/preferences")
      .then((p) => {
        setPrefs(p);
        setPrefsFailed(false);
      })
      .catch(() => setPrefsFailed(true));
  }, []);

  async function markAll() {
    setMarkingAll(true);
    try {
      await api("POST", "/notifications/read", { all: true });
      await load(tab);
    } catch (err) {
      toast.error(mapError(err, lang));
    } finally {
      setMarkingAll(false);
    }
  }

  async function togglePref(key: keyof Prefs) {
    if (!prefs) return;
    const next: Prefs = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    try {
      await api("PATCH", "/notifications/preferences", next);
      toast.success(t("prefsSavedToast", lang));
    } catch (err) {
      setPrefs(prefs); // revert on failure
      toast.error(mapError(err, lang));
    }
  }

  const infoCount = items.filter((n) => n.category === "INFO" && !n.readAt).length;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-stone-800">
          <span aria-hidden>🔔</span> {t("notifications", lang)}{" "}
          {unread > 0 && <Badge className="bg-red-100 text-red-700">{unread}</Badge>}
        </h1>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" aria-expanded={prefsOpen} onClick={() => setPrefsOpen((v) => !v)}>
            ⚙ {t("prefsTitle", lang)}
          </Button>
          {unread > 0 && (
            <Button variant="outline" size="sm" loading={markingAll} onClick={() => void markAll()}>
              ✓ {t("markAllRead", lang)}
            </Button>
          )}
        </div>
      </div>

      {/* Category tabs with counts from response meta */}
      <div role="tablist" aria-label={t("notifications", lang)} className="flex flex-wrap gap-2">
        {TABS.map((tb) => {
          const active = tab === tb.id;
          const count =
            tb.id === "ALL" ? unread : tb.id === "CRITICAL" ? metaCounts.critical : tb.id === "ACTION" ? metaCounts.action : tab === "ALL" ? infoCount : null;
          return (
            <button
              key={tb.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(tb.id)}
              className={`min-h-[44px] rounded-full px-4 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 ${
                active ? "bg-green-700 text-white" : "bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-green-50"
              }`}
            >
              {t(tb.key, lang)}
              {count !== null && count > 0 && (
                <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? "bg-white/20" : "bg-red-100 text-red-700"}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Preferences panel */}
      {prefsOpen &&
        (prefs ? (
          <Card>
            <h2 className="font-semibold text-stone-700">{t("prefsTitle", lang)}</h2>
            <p className="mb-3 mt-1 text-xs text-stone-500">{t("prefsDescription", lang)}</p>            <div className="space-y-2">
              {([
                ["critical", "prefCategoryCritical"],
                ["action", "prefCategoryAction"],
                ["info", "prefCategoryInfo"],
              ] as [keyof Prefs, DictKey][]).map(([key, labelKey]) => (
                <div key={key} className="flex items-center justify-between gap-3 rounded-lg bg-stone-50 px-3 py-2">
                  <Label className="!mb-0 flex-1 cursor-pointer text-sm" htmlFor={`pref-${key}`}>
                    {t(labelKey, lang)}
                  </Label>
                  <button
                    type="button"
                    id={`pref-${key}`}
                    role="switch"
                    aria-checked={prefs[key]}
                    aria-label={t(labelKey, lang)}
                    onClick={() => void togglePref(key)}
                    className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 ${
                      prefs[key] ? "bg-green-700" : "bg-stone-300"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${prefs[key] ? "left-[22px]" : "left-0.5"}`}
                    />
                  </button>
                </div>
              ))}
            </div>
          </Card>
        ) : prefsFailed ? (
          <ErrorBanner message={t("errorGeneric", lang)} />
        ) : (
          <Card><Skeleton className="h-24 w-full" /></Card>
        ))}

      {loadError && (
        <div className="space-y-2">
          <ErrorBanner message={loadError} />
          <Button variant="outline" onClick={() => void load(tab)}>{t("retry", lang)}</Button>
        </div>
      )}

      {loading && !loadError ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="flex gap-3"><Skeleton className="h-full w-8" /><div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-full" /></div></Card>
          ))}
        </div>
      ) : items.length === 0 && !loadError ? (
        <EmptyState icon="🔕" title={t("noNotifications", lang)} />
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <Card key={n.id} className={`flex gap-3 ${!n.readAt ? "border-green-200 bg-green-50/50" : ""}`}>
              <span className="text-xl" aria-hidden>{TYPE_ICONS[n.type] ?? "📢"}</span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-stone-800">
                  {n.title}
                  {n.category && n.category !== "INFO" && (
                    <Badge className={`ml-2 align-middle ${n.category === "CRITICAL" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-900"}`}>
                      {notifCategoryLabel(n.category, lang)}
                    </Badge>
                  )}
                </p>
                <p className="text-xs text-stone-500">{n.body}</p>
                <p className="mt-1 text-[10px] text-stone-400">{formatDateTime(n.createdAt, lang)}</p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
