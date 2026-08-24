import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";

interface Metrics {
  farmers: number; activeFarmers: number; farms: number; activeCrops: number;
  orders: number; bookings: number; pendingProcurement: number;
  revenuePaisa: number; aiAdvisoryQueries: number;
}
interface UserRow {
  id: string; fullName: string; phone: string; role: string; status: string;
  farmerProfile?: { membershipTier?: string };
}
interface AuditRow {
  id: string; action: string; entityType?: string; entityId?: string; createdAt: string;
  actor?: { fullName?: string; role?: string } | null;
}

export default function AdminPanel() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [search, setSearch] = useState("");
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setMetrics(await api<Metrics>("GET", "/admin/metrics"));
        setUsers((await api<{ items: UserRow[] }>("GET", "/admin/users?pageSize=50")).items);
        setAudit((await api<{ items: AuditRow[] }>("GET", "/admin/audit-logs?pageSize=30")).items);
      } catch (e) {
        if ((e as { status?: number }).status === 403) setDenied(true);
      }
    })();
  }, []);

  async function suspend(u: UserRow) {
    const nextStatus = u.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED";
    await api("PATCH", `/admin/users/${u.id}`, { status: nextStatus });
    setUsers((await api<{ items: UserRow[] }>("GET", "/admin/users?pageSize=50")).items);
  }

  async function searchUsers(e: React.FormEvent) {
    e.preventDefault();
    setUsers((await api<{ items: UserRow[] }>("GET", `/admin/users?pageSize=50&search=${encodeURIComponent(search)}`)).items);
  }

  if (denied) return <p className="card mx-auto mt-10 max-w-md text-center text-sm text-red-700">এই পাতায় প্রবেশের অনুমতি নেই। / Admins only.</p>;

  const cards: { label: string; value: string }[] = metrics ? [
    { label: lang === "bn" ? "কৃষক" : "Farmers", value: String(metrics.farmers) },
    { label: lang === "bn" ? "সক্রিয় কৃষক" : "Active farmers", value: String(metrics.activeFarmers) },
    { label: lang === "bn" ? "ফার্ম" : "Farms", value: String(metrics.farms) },
    { label: lang === "bn" ? "চলমান ফসল" : "Active crops", value: String(metrics.activeCrops) },
    { label: lang === "bn" ? "অর্ডার" : "Orders", value: String(metrics.orders) },
    { label: lang === "bn" ? "বুকিং" : "Bookings", value: String(metrics.bookings) },
    { label: lang === "bn" ? "অপেক্ষমাণ ক্রয়" : "Pending procurement", value: String(metrics.pendingProcurement) },
    { label: lang === "bn" ? "রাজস্ব" : "Revenue", value: `৳${(metrics.revenuePaisa / 100).toLocaleString("bn-BD")}` },
    { label: lang === "bn" ? "এআই পরামর্শ" : "AI queries", value: String(metrics.aiAdvisoryQueries) },
  ] : [];

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-stone-800">🛡️ Admin Control Tower</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="card !p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">{c.label}</p>
            <p className="mt-0.5 truncate text-lg font-bold text-green-800">{c.value}</p>
          </div>
        ))}
      </div>

      <section className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-stone-700">👥 {lang === "bn" ? "ব্যবহারকারী" : "Users"}</h2>
          <form onSubmit={searchUsers} className="flex gap-2">
            <input className="input !w-44 !py-1.5 !text-xs" placeholder={lang === "bn" ? "নাম/ফোন" : "name/phone"} value={search} onChange={(e) => setSearch(e.target.value)} />
            <button className="btn-outline !py-1.5 !text-xs">🔍</button>
          </form>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-[11px] uppercase text-stone-400">
                <th className="px-2 py-2">নাম</th><th>ফোন</th><th>ভূমিকা</th><th>টিয়ার</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-stone-100 hover:bg-stone-50">
                  <td className="px-2 py-2 font-medium">{u.fullName}</td>
                  <td>{u.phone}</td>
                  <td><span className="badge bg-stone-100 text-stone-600">{u.role}</span></td>
                  <td>{u.farmerProfile?.membershipTier ?? "—"}</td>
                  <td>
                    <span className={`badge ${u.status === "ACTIVE" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"}`}>{u.status}</span>
                  </td>
                  <td className="text-right">
                    <button className="text-xs font-semibold text-red-600 hover:underline" onClick={() => suspend(u)}>
                      {u.status === "SUSPENDED" ? "reactivate" : "suspend"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 className="mb-3 font-semibold text-stone-700">📜 {lang === "bn" ? "অডিট লগ" : "Audit log"}</h2>
        <div className="max-h-80 space-y-1.5 overflow-y-auto text-xs">
          {audit.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-md bg-stone-50 px-3 py-1.5">
              <span><b className="text-stone-700">{a.action}</b> · {a.entityType ?? ""} {a.actor?.fullName ? `· ${a.actor.fullName} (${a.actor.role})` : ""}</span>
              <span className="text-stone-400">{new Date(a.createdAt).toLocaleString()}</span>
            </div>
          ))}
          {audit.length === 0 && <p className="p-2 text-center text-stone-400">—</p>}
        </div>
      </section>
    </div>
  );
}
