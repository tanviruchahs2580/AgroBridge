import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";
import type { DictKey } from "../lib/i18n.js";
import { formatBDT, formatDateTime } from "../lib/format.js";
import { channelLabel, roleLabel, userStatusLabel } from "../lib/labels.js";
import { mapError } from "../lib/errors-ui.js";
import {
  Badge, Button, Card, EmptyState, ErrorBanner, Input, Skeleton, useConfirm, useToast,
} from "../components/ui.jsx";

interface Metrics {
  farmers: number; activeFarmers: number; farms: number; activeCrops: number;
  orders: number; bookings: number; pendingProcurement: number;
  revenuePaisa: number; aiAdvisoryQueries: number;
}
interface UserRow {
  id: string; fullName: string; phone: string; role: string; status: string;
  region?: string | null;
  farmerProfile?: { membershipTier?: string };
}
interface AuditRow {
  id: string; action: string; entityType?: string; entityId?: string; createdAt: string;
  actor?: { fullName?: string; role?: string } | null;
}
interface AdminWithdrawal {
  id: string;
  refNo: string;
  amountPaisa: number;
  status: string;
  channel: string;
  destination?: string | null;
  createdAt: string;
  user?: { fullName?: string; phone?: string };
}

export default function AdminPanel() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const toast = useToast();
  const confirm = useConfirm();

  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [withdrawals, setWithdrawals] = useState<AdminWithdrawal[]>([]);
  const [analytics, setAnalytics] = useState<{ windowDays: number; events: { name: string; count: number }[] } | null>(null);
  const [analyticsFailed, setAnalyticsFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [denied, setDenied] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Per-row draft regions (PATCH on save)
  const [regionDrafts, setRegionDrafts] = useState<Record<string, string>>({});
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    setLoadError(null);
    try {
      const [mtrx, usr, adt] = await Promise.all([
        api<Metrics>("GET", "/admin/metrics"),
        api<{ items: UserRow[] }>("GET", "/admin/users?pageSize=50"),
        api<{ items: AuditRow[] }>("GET", "/admin/audit-logs?pageSize=30"),
      ]);
      setMetrics(mtrx);
      setUsers(usr.items);
      setAudit(adt.items);
    } catch (err) {
      if ((err as { status?: number }).status === 403) setDenied(true);
      else setLoadError(mapError(err, lang));
    } finally {
      setLoading(false);
    }
  }

  async function loadWithdrawals() {
    try {
      setWithdrawals(await api<AdminWithdrawal[]>("GET", "/admin/withdrawals?status=PENDING"));
    } catch {
      setWithdrawals([]); // permission-gated panel section
    }
  }

  useEffect(() => {
    void loadAll();
    void loadWithdrawals();
    api<{ windowDays: number; events: { name: string; count: number }[] }>("GET", "/admin/analytics/summary")
      .then((r) => {
        setAnalytics(r);
        setAnalyticsFailed(false);
      })
      .catch(() => setAnalyticsFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced search (400ms) against GET /admin/users?search=
  const [searchFailed, setSearchFailed] = useState(false);
  useEffect(() => {
    if (loading) return;
    const h = setTimeout(() => {
      void api<{ items: UserRow[] }>("GET", `/admin/users?pageSize=50${search ? `&search=${encodeURIComponent(search)}` : ""}`)
        .then((r) => {
          setUsers(r.items);
          setSearchFailed(false);
        })
        .catch((err: unknown) => {
          if (!guard403(err)) setSearchFailed(true);
        });
    }, 400);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function guard403(err: unknown): boolean {
    if ((err as { status?: number }).status === 403) {
      setDenied(true);
      return true;
    }
    return false;
  }

  async function toggleSuspend(u: UserRow) {
    const suspending = u.status !== "SUSPENDED";
    const okToAct = await confirm(
      suspending
        ? {
            title: t("suspendConfirmTitle", lang),
            body: t("suspendConfirmBody", lang, { name: u.fullName }),
            danger: true,
            confirmLabel: t("actionSuspend", lang),
            cancelLabel: t("cancel", lang),
          }
        : {
            title: t("reactivateConfirmTitle", lang),
            confirmLabel: t("actionReactivate", lang),
            cancelLabel: t("cancel", lang),
          }
    );
    if (!okToAct) return;
    setRowBusy(u.id);
    try {
      await api("PATCH", `/admin/users/${u.id}`, { status: suspending ? "SUSPENDED" : "ACTIVE" });
      toast.success(t("userUpdatedToast", lang));
      setUsers((await api<{ items: UserRow[] }>("GET", `/admin/users?pageSize=50${search ? `&search=${encodeURIComponent(search)}` : ""}`)).items);
    } catch (err) {
      if (!guard403(err)) toast.error(mapError(err, lang));
    } finally {
      setRowBusy(null);
    }
  }

  async function saveRegion(u: UserRow) {
    const value = (regionDrafts[u.id] ?? u.region ?? "").trim();
    if (value === (u.region ?? "")) return;
    setRowBusy(u.id);
    try {
      await api("PATCH", `/admin/users/${u.id}`, { region: value || null });
      toast.success(t("regionSavedToast", lang));
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, region: value || null } : x)));
    } catch (err) {
      if (!guard403(err)) toast.error(mapError(err, lang));
    } finally {
      setRowBusy(null);
    }
  }

  async function decide(w: AdminWithdrawal, action: "APPROVE" | "REJECT") {
    const okToAct = await confirm({
      title: `${t(action === "APPROVE" ? "actionApprove" : "actionReject", lang)} · ${w.refNo}`,
      body: action === "APPROVE" ? t("wdApproveConfirmBody", lang, { amount: formatBDT(w.amountPaisa, lang) }) : t("wdRejectConfirmBody", lang),
      danger: action === "REJECT",
      confirmLabel: t(action === "APPROVE" ? "actionApprove" : "actionReject", lang),
      cancelLabel: t("cancel", lang),
    });
    if (!okToAct) return;
    setRowBusy(w.id);
    try {
      await api("POST", `/admin/withdrawals/${w.id}/decision`, { action });
      toast.success(t(action === "APPROVE" ? "withdrawalApprovedToast" : "withdrawalRejectedToast", lang));
      await loadWithdrawals();
    } catch (err) {
      if (!guard403(err)) toast.error(mapError(err, lang));
    } finally {
      setRowBusy(null);
    }
  }

  if (denied) {
    return (
      <div className="mx-auto mt-10 max-w-md">
        <EmptyState icon="🛡️" title={t("adminOnly", lang)} />
      </div>
    );
  }

  const cards: { labelKey: DictKey; value: string }[] = metrics
    ? [
        { labelKey: "farmers", value: String(metrics.farmers) },
        { labelKey: "metricActiveFarmers", value: String(metrics.activeFarmers) },
        { labelKey: "farms", value: String(metrics.farms) },
        { labelKey: "metricActiveCrops", value: String(metrics.activeCrops) },
        { labelKey: "orders", value: String(metrics.orders) },
        { labelKey: "bookings", value: String(metrics.bookings) },
        { labelKey: "metricPendingProcurement", value: String(metrics.pendingProcurement) },
        { labelKey: "revenue", value: formatBDT(metrics.revenuePaisa, lang) },
        { labelKey: "metricAiQueries", value: String(metrics.aiAdvisoryQueries) },
      ]
    : [];

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-stone-800"><span aria-hidden>🛡️</span> {t("adminControlTower", lang)}</h1>

      {loadError && (
        <div className="space-y-2">
          <ErrorBanner message={loadError} />
          <Button variant="outline" onClick={() => void loadAll()}>{t("retry", lang)}</Button>
        </div>
      )}

      {!metrics && loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Card key={i}><Skeleton className="h-10 w-full" /></Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {cards.map((c) => (
            <Card key={c.labelKey} className="!p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">{t(c.labelKey, lang)}</p>
              <p className="mt-0.5 truncate text-lg font-bold text-green-800">{c.value}</p>
            </Card>
          ))}
        </div>
      )}

      {/* Users */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-stone-700"><span aria-hidden>👥</span> {t("users", lang)}</h2>
          <Input
            type="search"
            aria-label={t("searchUsersAria", lang)}
            placeholder={`🔍 ${t("searchPh", lang)}`}
            className="!w-52 !py-1.5 !text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {searchFailed && <ErrorBanner message={t("errorGeneric", lang)} />}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-[11px] uppercase text-stone-400">
                <th className="px-2 py-2">{t("thName", lang)}</th>
                <th className="px-2 py-2">{t("thPhone", lang)}</th>
                <th className="px-2 py-2">{t("thRole", lang)}</th>
                <th className="px-2 py-2">{t("thTier", lang)}</th>
                <th className="px-2 py-2">{t("thStatus", lang)}</th>
                <th className="px-2 py-2">{t("thRegion", lang)}</th>
                <th className="px-2 py-2"><span className="sr-only">{t("actionSuspend", lang)}</span></th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                users.length === 0 &&
                [0, 1, 2].map((i) => (
                  <tr key={i}>
                    <td colSpan={7} className="px-2 py-2"><Skeleton className="h-8 w-full" /></td>
                  </tr>
                ))}
              {users.map((u) => (
                <tr key={u.id} className="border-b border-stone-100 hover:bg-stone-50">
                  <td className="px-2 py-2 font-medium">{u.fullName}</td>
                  <td className="px-2 py-2">{u.phone}</td>
                  <td className="px-2 py-2"><Badge className="bg-stone-100 text-stone-600">{roleLabel(u.role, lang)}</Badge></td>
                  <td className="px-2 py-2">{u.farmerProfile?.membershipTier ?? "—"}</td>
                  <td className="px-2 py-2">
                    <Badge className={u.status === "ACTIVE" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"}>
                      {userStatusLabel(u.status, lang)}
                    </Badge>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1">
                      <Input
                        aria-label={`${t("thRegion", lang)} — ${u.fullName}`}
                        defaultValue={u.region ?? ""}
                        onChange={(e) => setRegionDrafts((prev) => ({ ...prev, [u.id]: e.target.value }))}
                        className="!w-28 !py-1.5 !text-xs"
                        placeholder={t("regionPlaceholder", lang)}
                        disabled={rowBusy === u.id}
                      />
                      <Button variant="ghost" size="sm" disabled={rowBusy === u.id} onClick={() => void saveRegion(u)}>
                        {t("save", lang)}
                      </Button>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Button
                      variant={u.status === "SUSPENDED" ? "outline" : "danger"}
                      size="sm"
                      loading={rowBusy === u.id}
                      onClick={() => void toggleSuspend(u)}
                    >
                      {u.status === "SUSPENDED" ? t("actionReactivate", lang) : t("actionSuspend", lang)}
                    </Button>
                  </td>
                </tr>
              ))}
              {!loading && users.length === 0 && (
                <tr><td colSpan={7} className="py-4 text-center text-stone-400">—</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Withdrawal approval queue */}
      <Card>
        <h2 className="mb-3 font-semibold text-stone-700"><span aria-hidden>🏧</span> {t("withdrawalsQueue", lang)}</h2>
        {withdrawals.length === 0 ? (
          <p className="text-sm text-stone-400">{t("noWithdrawals", lang)}</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {withdrawals.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <div>
                  <p className="font-bold text-stone-700">
                    {formatBDT(w.amountPaisa, lang)} · {channelLabel(w.channel, lang)}
                  </p>
                  <p className="text-xs text-stone-400">
                    {w.refNo} · {w.user?.fullName ?? "—"}{w.destination ? ` · ${t("destinationLabel", lang)}: ${w.destination}` : ""} ·{" "}
                    {formatDateTime(w.createdAt, lang)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" loading={rowBusy === w.id} onClick={() => void decide(w, "APPROVE")}>
                    {t("actionApprove", lang)}
                  </Button>
                  <Button variant="danger" size="sm" loading={rowBusy === w.id} onClick={() => void decide(w, "REJECT")}>
                    {t("actionReject", lang)}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Analytics events summary */}
      <Card>
        <h2 className="mb-3 font-semibold text-stone-700">
          <span aria-hidden>📊</span> {analytics ? t("analyticsSummary", lang, { days: analytics.windowDays }) : ""}
        </h2>
        {analyticsFailed ? (
          <div className="space-y-2">
            <ErrorBanner message={t("errorGeneric", lang)} />
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void api<{ windowDays: number; events: { name: string; count: number }[] }>("GET", "/admin/analytics/summary")
                  .then(setAnalytics)
                  .catch(() => setAnalyticsFailed(true))
              }
            >
              {t("retry", lang)}
            </Button>
          </div>
        ) : analytics ? (
          analytics.events.length === 0 ? (
            <p className="text-sm text-stone-400">—</p>
          ) : (
            <ul className="max-h-60 space-y-1 overflow-y-auto text-sm">
              {analytics.events.map((ev) => (
                <li key={ev.name} className="flex items-center justify-between rounded-md bg-stone-50 px-3 py-1.5">
                  <span className="font-mono text-xs text-stone-600">{ev.name}</span>
                  <span className="font-bold text-green-800">{ev.count}</span>
                </li>
              ))}
            </ul>
          )
        ) : (
          <Skeleton className="h-16 w-full" />
        )}
      </Card>

      {/* Audit log */}
      <Card>
        <h2 className="mb-3 font-semibold text-stone-700"><span aria-hidden>📜</span> {t("auditLogs", lang)}</h2>
        <div className="max-h-80 space-y-1.5 overflow-y-auto text-xs">
          {audit.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 rounded-md bg-stone-50 px-3 py-1.5">
              <span>
                <b className="text-stone-700">{a.action}</b> · {a.entityType ?? ""}{" "}
                {a.actor?.fullName ? `· ${a.actor.fullName} (${roleLabel(a.actor.role ?? "", lang)})` : ""}
              </span>
              <span className="shrink-0 text-stone-400">{formatDateTime(a.createdAt, lang)}</span>
            </div>
          ))}
          {audit.length === 0 && <p className="p-2 text-center text-stone-400">—</p>}
        </div>
      </Card>
    </div>
  );
}
