import { useState } from "react";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";

interface Answer {
  answer: string;
  confidence: number;
  lowConfidenceFlag: boolean;
  groundedRefs: string[];
}

export default function Advisor() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const [question, setQuestion] = useState("");
  const [chat, setChat] = useState<{ role: "user" | "ai"; text: string; confidence?: number; low?: boolean }[]>([]);
  const [busy, setBusy] = useState(false);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || busy) return;
    const q = question.trim();
    setChat((c) => [...c, { role: "user", text: q }]);
    setQuestion("");
    setBusy(true);
    try {
      const res = await api<Answer>("POST", "/ai/advisory", { question: q, lang });
      setChat((c) => [...c, { role: "ai", text: res.answer, confidence: res.confidence, low: res.lowConfidenceFlag }]);
    } catch (err) {
      setChat((c) => [...c, { role: "ai", text: (err as Error).message || t("errorGeneric", lang) }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-bold text-stone-800">🤖 {t("aiAgent", lang)}</h1>
      <p className="text-xs text-stone-500">
        {lang === "bn"
          ? "এআই উত্তর পরামর্শমূলক — ওষুধ/সার প্রয়োগের আগে কৃষি কর্মকর্তার সাথে যাচাই করুন।"
          : "AI answers are advisory — verify treatments with an agronomist before applying."}
      </p>

      <div className="card min-h-[300px] space-y-3">
        {chat.length === 0 && (
          <div className="grid h-[280px] place-items-center text-center text-sm text-stone-400">
            <div>
              <div className="mb-2 text-4xl">🌾</div>
              {lang === "bn" ? "যেমন: “ধানের পাতায় blast রোগ দেখছে, কী করব?”" : 'Try: "Rice leaves show blast lesions, what should I do?"'}
            </div>
          </div>
        )}
        {chat.map((m, i) => (
          m.role === "user" ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-green-700 px-4 py-2.5 text-sm text-white">
              {m.text}
            </div>
          ) : (
            <div key={i} className="max-w-[90%] space-y-1">
              <div className="whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-stone-100 px-4 py-2.5 text-sm text-stone-800">{m.text}</div>
              {m.confidence !== undefined && (
                <div className={`badge ${m.low ? "bg-amber-100 text-amber-900" : "bg-green-100 text-green-900"}`}>
                  {Math.round((m.confidence ?? 0) * 100)}% · {m.low ? t("lowConfidence", lang) : lang === "bn" ? "গ্রাউন্ডেড উত্তর" : "grounded"}
                </div>
              )}
            </div>
          )
        ))}
        {busy && <div className="animate-pulse text-sm text-stone-400">…{t("loading", lang)}</div>}
      </div>

      <form onSubmit={ask} className="flex gap-2">
        <input
          className="input flex-1"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t("askPlaceholder", lang)}
          maxLength={1000}
        />
        <button className="btn-primary shrink-0" disabled={busy || !question.trim()}>{t("send", lang)}</button>
      </form>
    </div>
  );
}
