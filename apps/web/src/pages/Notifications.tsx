import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

const TYPE_ICONS: Record<string, string> = {
  ORDER: "📦", BOOKING: "🚜", PROCUREMENT: "🌾", PAYMENT: "💳",
  WEATHER: "🌦️", AI: "🤖", MEMBERSHIP: "🎖️", SYSTEM: "📢",
};

export default function Notifications() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);

  async function load() {
    const data = await api<{ items: Notification[]; unread: number }>("GET", "/notifications");
    setItems(data.items);
    setUnread(data.unread);
  }

  useEffect(() => {
    void load().catch(() => undefined);
  }, []);

  async function markAll() {
    await api("POST", "/notifications/read", { all: true });
    await load();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-stone-800">🔔 {t("notifications", lang)} {unread > 0 && <span className="badge bg-red-100 text-red-700">{unread}</span>}</h1>
        {unread > 0 && <button className="btn-outline !py-1.5 !text-xs" onClick={markAll}>✓ সব পড়া হয়েছে</button>}
      </div>

      <div className="space-y-2">
        {items.length === 0 && <p className="card text-center text-sm text-stone-400">কোনো নোটিফিকেশন নেই।</p>}
        {items.map((n) => (
          <div key={n.id} className={`card flex gap-3 ${!n.readAt ? "border-green-200 bg-green-50/50" : ""}`}>
            <span className="text-xl">{TYPE_ICONS[n.type] ?? "📢"}</span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-stone-800">{n.title}</p>
              <p className="text-xs text-stone-500">{n.body}</p>
              <p className="mt-1 text-[10px] text-stone-400">{new Date(n.createdAt).toLocaleString(lang === "bn" ? "bn-BD" : "en-US")}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
