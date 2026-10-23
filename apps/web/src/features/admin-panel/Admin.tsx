import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Banknote, Bot, ClipboardList, Clock3, Home as HomeIcon, Package, ShieldCheck, Sprout, UserCheck, Users } from "lucide-react";
import { api } from "../../lib/api";
import type { AdminAnalyticsSummary, AdminAuditLogsData, AdminMetrics, AdminUser, AdminUsersData, AdminWithdrawalItem } from "../../lib/api-types";
import { invalidate, useResource } from "../../lib/useResource";
import { useSession } from "../../lib/session";
import { t } from "../../lib/i18n";
import type { DictKey } from "../../lib/i18n";
import { formatBDT, formatDateTime } from "../../lib/format";
import { channelLabel, roleLabel, tierLabel, userStatusLabel } from "../../lib/labels";
import { mapError } from "../../lib/errors-ui";
import {
  Badge, BlockError, Button, Card, EmptyState, Input, PageHeader, SectionHeader, Skeleton, StatTile, useConfirm, useToast,
} from "../../components/ui";

export default function AdminPanel() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const toast = useToast();
  const confirm = useConfirm();

  /**
   * Fail closed on the role, synchronously.
   *
   * `denied` below is only ever set by a 403 *response*, so a non-admin used to get
   * the whole admin panel rendered first — "Admin Control Tower", the user table,
   * withdrawals, audit log — until the first guarded read came back and replaced it.
   * Measured on production: reading `#main` right after the route painted returned
   * the admin panel's text, and the denial only appeared once the requests settled.
   * The API refuses the data (a farmer gets 403 from every /admin route), so nothing
   * leaked, but showing an admin console to a farmer is wrong in itself and leaves
   * any future non-guarded section as a real exposure.
   *
   * The authority is still the server; this only stops the UI from displaying a
   * surface the session's role cannot use, exactly as the shell already decides
   * whether to render the admin nav link (App.tsx).
   */
  const roleDenied = !session || (session.role !== "ADMIN" && session.role !== "SUPER_ADMIN");

  const [search, setSearch] = useState("");
  const [denied, setDenied] = useState(false);
  // Per-row draft regions (PATCH on save)
  const [regionDrafts, setRegionDrafts] = useState<Record<string, string>>({});
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  /**
   * A 403 is the role guard, not a section failure: a session without the admin
   * permission gets the page-level denied state (`e2e/admin-guard.spec.ts`) instead
   * of a "forbidden" banner. Returns true when it was a 403.
   */
  function guard403(err: unknown): boolean {
    if ((err as { status?: number }).status === 403) {
      setDenied(true);
      return true;
    }
    return false;
  }

  /**
   * Read that carries the guard. Metrics / users / audit-log 403s used to reject the
   * page-wide `loadAll` and flip the whole panel to denied; they still do, and only
   * they do — the analytics and withdrawals reads stay plain `api` calls, so their
   * failures remain their own section's state, exactly as before.
   */
  async function guardedGet<T>(path: string): Promise<T> {
    try {
      return await api<T>("GET", path);
    } catch (err) {
      guard403(err);
      throw err;
    }
  }

  // Debounced search (400ms) against GET /admin/users?search= — the input updates
  // on every keystroke, while the *debounced* term is what the users resource
  // depends on: typing stops → term lands → refetch, the old effect's trigger.
  const [searchTerm, setSearchTerm] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setSearchTerm(search), 400);
    return () => clearTimeout(h);
  }, [search]);

  // The console reads five independent endpoints, so it holds five independent
  // resources: each section shows its own skeleton and its own error with retry,
  // so a failed audit-log fetch no longer blanks the metrics — and vice versa.
  const metricsRes = useResource<AdminMetrics>("admin-metrics", () => guardedGet<AdminMetrics>("/admin/metrics"));
  const usersRes = useResource<AdminUsersData>(
    "admin-users",
    () => guardedGet<AdminUsersData>(`/admin/users?pageSize=50${searchTerm ? `&search=${encodeURIComponent(searchTerm)}` : ""}`),
    [searchTerm]
  );
  const auditRes = useResource<AdminAuditLogsData>("admin-audit-logs", () => guardedGet<AdminAuditLogsData>("/admin/audit-logs?pageSize=30"));
  const analyticsRes = useResource<AdminAnalyticsSummary>("admin-analytics", () => api<AdminAnalyticsSummary>("GET", "/admin/analytics/summary"));
  const withdrawalsRes = useResource<AdminWithdrawalItem[]>("admin-withdrawals", () => api<AdminWithdrawalItem[]>("GET", "/admin/withdrawals?status=PENDING"));

  const metrics = metricsRes.data;
  const users = usersRes.data?.items ?? [];
  const audit = auditRes.data?.items ?? [];
  const analytics = analyticsRes.data;
  const withdrawals = withdrawalsRes.data ?? [];

  async function toggleSuspend(u: AdminUser) {
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
      // The status shows in the directory: the old code refetched that one
      // endpoint (with the current search) and nothing else.
      invalidate("admin-users");
    } catch (err) {
      if (!guard403(err)) toast.error(mapError(err, lang));
    } finally {
      setRowBusy(null);
    }
  }

  async function saveRegion(u: AdminUser) {
    const value = (regionDrafts[u.id] ?? u.region ?? "").trim();
    if (value === (u.region ?? "")) return;
    setRowBusy(u.id);
    try {
      await api("PATCH", `/admin/users/${u.id}`, { region: value || null });
      toast.success(t("regionSavedToast", lang));
      // Show the edit immediately, then reconcile with the server.
      //
      // The optimistic write alone was not enough to be *correct*: this endpoint
      // replies with `{ id, fullName, role, status }` — it does not echo `region`
      // — so the row would keep displaying whatever the admin typed even if the
      // server had stored something else, and there was no request that could ever
      // correct it. The reload is one GET and makes the table state the server's.
      const current = usersRes.data;
      if (current) {
        usersRes.setData({
          ...current,
          items: current.items.map((x) => (x.id === u.id ? { ...x, region: value || null } : x)),
        });
      }
      invalidate("admin-users");
    } catch (err) {
      if (!guard403(err)) toast.error(mapError(err, lang));
    } finally {
      setRowBusy(null);
    }
  }

  async function decide(w: AdminWithdrawalItem, action: "APPROVE" | "REJECT") {
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
      // The decision leaves the queue: the old code awaited loadWithdrawals,
      // which refetched exactly this resource.
      invalidate("admin-withdrawals");
    } catch (err) {
      if (!guard403(err)) toast.error(mapError(err, lang));
    } finally {
      setRowBusy(null);
    }
  }

  if (denied || roleDenied) {
    return (
      <div className="mx-auto mt-10 max-w-md">
        <EmptyState icon={<ShieldCheck className="h-7 w-7 text-brand-600" />} title={t("adminOnly", lang)} />
      </div>
    );
  }

  const cards: { labelKey: DictKey; value: string; icon: React.ReactNode; tone: "brand" | "sky" | "ai" | "warning" | "success" }[] = metrics
    ? [
        { labelKey: "farmers", value: String(metrics.farmers), icon: <Users className="h-5 w-5" aria-hidden />, tone: "brand" },
        { labelKey: "metricActiveFarmers", value: String(metrics.activeFarmers), icon: <UserCheck className="h-5 w-5" aria-hidden />, tone: "success" },
        { labelKey: "farms", value: String(metrics.farms), icon: <HomeIcon className="h-5 w-5" aria-hidden />, tone: "brand" },
        { labelKey: "metricActiveCrops", value: String(metrics.activeCrops), icon: <Sprout className="h-5 w-5" aria-hidden />, tone: "success" },
        { labelKey: "orders", value: String(metrics.orders), icon: <Package className="h-5 w-5" aria-hidden />, tone: "sky" },
        { labelKey: "bookings", value: String(metrics.bookings), icon: <ClipboardList className="h-5 w-5" aria-hidden />, tone: "sky" },
        { labelKey: "metricPendingProcurement", value: String(metrics.pendingProcurement), icon: <Clock3 className="h-5 w-5" aria-hidden />, tone: "warning" },
        { labelKey: "revenue", value: formatBDT(metrics.revenuePaisa, lang), icon: <Banknote className="h-5 w-5" aria-hidden />, tone: "success" },
        { labelKey: "metricAiQueries", value: String(metrics.aiAdvisoryQueries), icon: <Bot className="h-5 w-5" aria-hidden />, tone: "ai" },
      ]
    : [];

  return (
    <div className="min-w-0 space-y-5">
      <nav aria-label={t("breadcrumbNavAria", lang)} className="text-sm text-stone-600">
        <ol className="flex items-center gap-1">
          <li><Link to="/" className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]">{t("home", lang)}</Link> / {t("admin", lang)}</li>
        </ol>
      </nav>
      <PageHeader icon={<ShieldCheck className="h-5 w-5" aria-hidden />} title={t("adminControlTower", lang)} />

      {/* Metric tiles. The banner is rendered *above* the tiles rather than instead
          of them, because the old order (tiles if present, else error) made the error
          branch unreachable once anything had loaded: a failed reload left the
          previous numbers on screen with nothing marking them as last-known. A first
          load that fails has no tiles, so the banner stands alone — which is right. */}
      <BlockError error={metricsRes.error} retryLabel={t("retry", lang)} onRetry={() => void metricsRes.reload()} />
      {metrics ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {cards.map((c) => (
            <StatTile key={c.labelKey} icon={c.icon} tone={c.tone} value={c.value} label={t(c.labelKey, lang)} />
          ))}
        </div>
      ) : metricsRes.loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Card key={i}><Skeleton className="h-10 w-full" /></Card>
          ))}
        </div>
      ) : null}

      {/* Users*/}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <SectionHeader title={t("users", lang)} className="mb-0" />
          <Input
            type="search"
            aria-label={t("searchUsersAria", lang)}
            placeholder={t("searchPh", lang)}
            className="!w-52 !py-1.5 !text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <BlockError error={usersRes.error} retryLabel={t("retry", lang)} onRetry={() => void usersRes.reload()} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-xs uppercase text-stone-500">
                  {/* scope="col" on every header cell: without it, header-to-cell
                      association in this data table rested on AT heuristics only. */}
                  <th scope="col" className="px-2 py-2">{t("thName", lang)}</th>
                  <th scope="col" className="px-2 py-2">{t("thPhone", lang)}</th>
                  <th scope="col" className="px-2 py-2">{t("thRole", lang)}</th>
                  <th scope="col" className="px-2 py-2">{t("thTier", lang)}</th>
                  <th scope="col" className="px-2 py-2">{t("thStatus", lang)}</th>
                  <th scope="col" className="px-2 py-2">{t("thRegion", lang)}</th>
                  <th scope="col" className="px-2 py-2"><span className="sr-only">{t("actionSuspend", lang)}</span></th>
                </tr>
              </thead>
              <tbody>
                {usersRes.loading &&
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
                    <td className="px-2 py-2"><Badge tone="default">{roleLabel(u.role, lang)}</Badge></td>
                    <td className="px-2 py-2">{u.farmerProfile?.membershipTier ? tierLabel(u.farmerProfile.membershipTier, lang) : "—"}</td>
                    <td className="px-2 py-2">
                      <Badge tone={u.status === "ACTIVE" ? "success" : "danger"}>
                        {userStatusLabel(u.status, lang)}
                      </Badge>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1">
                        <Input
                          aria-label={`${t("thRegion", lang)} — ${u.fullName}`}
                          defaultValue={u.region ?? ""}
                          onChange={(e) => setRegionDrafts((prev) => ({ ...prev, [u.id]: e.target.value }))}
                          className="!w-28 !py-1.5 !text-sm"
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
                {!usersRes.loading && users.length === 0 && !usersRes.error && (
                  <tr><td colSpan={7} className="py-4 text-center text-sm text-stone-500">{t("adminNoEntries", lang)}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      {/* Withdrawal approval queue*/}
      <Card>
        <SectionHeader title={t("withdrawalsQueue", lang)} className="mb-2" />
        <div className="space-y-2">
          <BlockError error={withdrawalsRes.error} retryLabel={t("retry", lang)} onRetry={() => void withdrawalsRes.reload()} />
          {withdrawalsRes.loading ? (
            [0, 1].map((i) => <Skeleton key={i} className="h-10 w-full" />)
          ) : withdrawals.length === 0 ? (
            // A failed queue must not read as "nothing pending".
            withdrawalsRes.error ? null : <p className="text-sm text-stone-500">{t("noWithdrawals", lang)}</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {withdrawals.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <div>
                    <p className="font-bold text-stone-700">
                      {formatBDT(w.amountPaisa, lang)} · {channelLabel(w.channel, lang)}
                    </p>
                    <p className="text-xs text-stone-500">
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
        </div>
      </Card>

      {/* Analytics events summary*/}
      <Card>
        <SectionHeader title={analytics ? t("analyticsSummary", lang, { days: analytics.windowDays }) : ""} className="mb-2" />
        <div className="space-y-2">
          <BlockError error={analyticsRes.error} retryLabel={t("retry", lang)} onRetry={() => void analyticsRes.reload()} />
          {analyticsRes.loading ? (
            <Skeleton className="h-16 w-full" />
          ) : analytics ? (
            analytics.events.length === 0 ? (
              <p className="text-sm text-stone-500">{t("adminNoEntries", lang)}</p>
            ) : (
              <ul className="max-h-60 space-y-1 overflow-y-auto text-sm">
                {analytics.events.map((ev) => (
                  <li key={ev.name} className="flex items-center justify-between rounded-md bg-stone-50 px-3 py-1.5">
                    <span className="min-w-0 break-words font-mono text-xs text-stone-600">{ev.name}</span>
                    <span className="shrink-0 font-bold text-accent">{ev.count}</span>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      </Card>

      {/* Audit log*/}
      <Card>
        <SectionHeader title={t("auditLogs", lang)} className="mb-2" />
        <div className="space-y-2">
          <BlockError error={auditRes.error} retryLabel={t("retry", lang)} onRetry={() => void auditRes.reload()} />
          {auditRes.loading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <div className="max-h-80 space-y-1.5 overflow-y-auto text-xs">
              {audit.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 rounded-md bg-stone-50 px-3 py-1.5">
                  <span className="min-w-0 break-words">
                    <b className="text-stone-700">{a.action}</b> · {a.entityType ?? ""}{" "}
                    {a.actor?.fullName ? `· ${a.actor.fullName} (${roleLabel(a.actor.role ?? "", lang)})` : ""}
                  </span>
                  <span className="shrink-0 text-stone-500">{formatDateTime(a.createdAt, lang)}</span>
                </div>
              ))}
              {audit.length === 0 && !auditRes.error && <p className="p-2 text-center text-stone-500">{t("adminNoEntries", lang)}</p>}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
