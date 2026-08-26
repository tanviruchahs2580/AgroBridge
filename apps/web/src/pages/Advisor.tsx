import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";
import { formatDate } from "../lib/format.js";
import { mapError } from "../lib/errors-ui.js";
import { track } from "../lib/analytics.js";
import { Badge, Button, Card, ErrorBanner, Input, Skeleton } from "../components/ui.jsx";

interface Answer {
  answer: string;
  confidence: number;
  lowConfidenceFlag: boolean;
  groundedRefs?: string[];
}

interface DiseaseCase {
  id: string;
  status: string;
  diagnosis: string | null;
  recommendation: string | null;
  createdAt: string;
}

const CROP_KEYWORDS = /rice|wheat|jute|mustard|maize|potato|ধান|গম|পাট|সরিষা|ভুট্টা|আলু/i;

/** Client-side downscale + JPEG re-encode (max dim 1280, q 0.82) before upload. */
async function compressImage(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob) throw new Error("encode failed");
    return blob;
  } catch {
    return file; // compression is best-effort; fall back to the original
  }
}

export default function Advisor() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const [question, setQuestion] = useState("");
  const [chat, setChat] = useState<{ role: "user" | "ai"; text: string; confidence?: number; low?: boolean; refs?: string[] }[]>([]);
  const [busy, setBusy] = useState(false);
  const [cases, setCases] = useState<DiseaseCase[]>([]);
  const [casesLoaded, setCasesLoaded] = useState(false);
  const [showAllCases, setShowAllCases] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  async function loadCases() {
    setCasesLoaded(false);
    try {
      setCases(await api<DiseaseCase[]>("GET", "/disease/cases"));
      setCasesLoaded(true);
    } catch {
      setCasesLoaded(true); // non-critical panel; empty state shown
    }
  }
  useEffect(() => {
    void loadCases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chat.length, busy]);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || busy) return;
    const q = question.trim();
    setChat((c) => [...c, { role: "user", text: q }]);
    setQuestion("");
    setBusy(true);
    track("advisory_asked", { hasCrop: CROP_KEYWORDS.test(q) ? 1 : 0 });
    try {
      const res = await api<Answer>("POST", "/ai/advisory", { question: q, lang });
      // Structured/plain answers both render gracefully: plain text keeps its
      // line breaks; grounded references are listed as source rows.
      setChat((c) => [
        ...c,
        {
          role: "ai",
          text: res.answer,
          confidence: res.confidence,
          low: res.lowConfidenceFlag,
          refs: Array.isArray(res.groundedRefs) ? res.groundedRefs : [],
        },
      ]);
    } catch (err) {
      setChat((c) => [...c, { role: "ai", text: mapError(err, lang) }]);
    } finally {
      setBusy(false);
    }
  }

  async function uploadImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file || uploading) return;
    if (file.size > 8 * 1024 * 1024) {
      setUploadMsg(t("imageTooLarge", lang));
      return;
    }
    setUploading(true);
    setUploadMsg("");
    track("disease_upload");
    try {
      const blob = await compressImage(file);
      const fd = new FormData();
      fd.append("image", blob, "crop.jpg");
      await api("POST", "/disease/cases", fd);
      setUploadMsg(t("pendingReview", lang));
      await loadCases();
    } catch (err) {
      setUploadMsg(mapError(err, lang));
    } finally {
      setUploading(false);
    }
  }

  const visibleCases = showAllCases ? cases : cases.slice(0, 5);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-bold text-stone-800"><span aria-hidden>🤖</span> {t("aiAgent", lang)}</h1>
      <p className="text-xs text-stone-500">{t("advisoryDisclaimer", lang)}</p>

      <Card className="space-y-2">
        <label className="inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center rounded-lg border border-green-700 px-4 py-2 font-semibold text-green-800 hover:bg-green-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600">
          <span aria-hidden>📷</span> {t("uploadPhoto", lang)} · {t("diseaseCheck", lang)}
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={uploadImage} disabled={uploading} />
        </label>
        {uploading && (
          <p className="flex items-center gap-2 text-sm text-stone-400">
            <Skeleton className="h-3 w-24" /> {t("compressingImage", lang)}
          </p>
        )}
        {uploadMsg &&
          (uploadMsg === t("pendingReview", lang) ? (
            <div role="status" className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-900">
              {uploadMsg}
            </div>
          ) : (
            <ErrorBanner message={uploadMsg} />
          ))}

        {cases.length > 0 ? (
          <div className="pt-1">
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-400">{t("myCases", lang)}</h3>
            <ul className="space-y-1.5">
              {visibleCases.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 text-xs">
                  <span>{formatDate(c.createdAt, lang)}</span>
                  {c.status === "REVIEWED" ? (
                    <Badge className="bg-green-100 text-green-900">{t("reviewed", lang)}</Badge>
                  ) : (
                    <Badge className="bg-stone-200 text-stone-700">{t("pendingReview", lang)}</Badge>
                  )}
                </li>
              ))}
            </ul>
            {cases.length > 5 && (
              <Button variant="ghost" size="sm" className="mt-1" onClick={() => setShowAllCases((v) => !v)}>
                {showAllCases ? t("showLess", lang) : `${t("viewAll", lang)} (${cases.length})`}
              </Button>
            )}
          </div>
        ) : casesLoaded ? null : (
          <Skeleton className="h-10 w-full" />
        )}
      </Card>

      <Card className="min-h-[300px] space-y-3">
        {chat.length === 0 && !busy && (
          <div className="grid h-[280px] place-items-center text-center text-sm text-stone-400">
            <div>
              <div className="mb-2 text-4xl" aria-hidden>🌾</div>
              {t("exampleQuestion", lang)}
            </div>
          </div>
        )}
        {chat.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-green-700 px-4 py-2.5 text-sm text-white">
              {m.text}
            </div>
          ) : (
            <div key={i} className="max-w-[90%] space-y-1">
              {/* whitespace-pre-wrap renders structured (multi-section) and plain answers alike */}
              <div className="whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-stone-100 px-4 py-2.5 text-sm text-stone-800">{m.text}</div>
              {m.refs && m.refs.length > 0 && (
                <ul className="space-y-0.5 px-1 text-[11px] text-stone-400">
                  <li className="font-semibold">{t("advisorSource", lang)}</li>
                  {m.refs.map((r, ri) => (
                    <li key={ri}>· {r}</li>
                  ))}
                </ul>
              )}
              {m.confidence !== undefined && (
                <Badge className={m.low ? "bg-amber-100 text-amber-900" : "bg-green-100 text-green-900"}>
                  {Math.round((m.confidence ?? 0) * 100)}% ·{" "}
                  {m.low ? t("lowConfidence", lang) : t("groundedAnswer", lang)}
                </Badge>
              )}
            </div>
          )
        )}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-stone-400">
            <Skeleton className="h-3 w-32" /> {t("loading", lang)}
          </div>
        )}
        <div ref={chatEndRef} />
      </Card>

      <form onSubmit={ask} noValidate className="flex gap-2">
        <Input
          aria-label={t("questionInputLabel", lang)}
          className="flex-1"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t("askPlaceholder", lang)}
          maxLength={1000}
        />
        <Button type="submit" className="shrink-0" disabled={busy || !question.trim()}>{t("send", lang)}</Button>
      </form>
    </div>
  );
}
