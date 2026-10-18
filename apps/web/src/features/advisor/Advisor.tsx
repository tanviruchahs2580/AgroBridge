import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { AdvisoryAnswer, DiseaseCase } from "../../lib/api-types";
import { invalidate, useResource } from "../../lib/useResource";
import { useSession } from "../../lib/session";
import { t } from "../../lib/i18n";
import { formatDate } from "../../lib/format";
import { mapError } from "../../lib/errors-ui";
import { track } from "../../lib/analytics";
import { Bot, Camera, Sprout } from "lucide-react";
import { Badge, Button, Card, ErrorBanner, Input, PageHeader, Skeleton, Spinner } from "../../components/ui";
import { confidenceSupportKey } from "./supportLabel";

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

/**
 * Failure UI for one resource: its own mapped error text plus a retry, shown
 * where that resource's data would be. Only the block that owns the failed
 * resource shows it — every block whose data arrived keeps rendering.
 */
function BlockError({ error, retryLabel, onRetry }: { error: string | null; retryLabel: string; onRetry: () => void }) {
  if (!error) return null;
  return (
    <div className="space-y-2">
      <ErrorBanner message={error} />
      <Button variant="outline" onClick={onRetry}>{retryLabel}</Button>
    </div>
  );
}

export default function Advisor() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const [question, setQuestion] = useState("");
  const [chat, setChat] = useState<{ role: "user" | "ai"; text: string; confidence?: number; low?: boolean; refs?: string[] }[]>([]);
  const [busy, setBusy] = useState(false);
  const [showAllCases, setShowAllCases] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // The only fetch on this screen is the user's disease-case list; the chat is
  // component state, never refetched. Its own resource means a failed list
  // fetch no longer has to be swallowed silently.
  const casesRes = useResource<DiseaseCase[]>("advisor-cases", () => api<DiseaseCase[]>("GET", "/disease/cases"));
  const cases = casesRes.data ?? [];

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    chatEndRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
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
      const res = await api<AdvisoryAnswer>("POST", "/ai/advisory", { question: q, lang });
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
      // The old code awaited loadCases(): that refetched exactly this resource.
      invalidate("advisor-cases");
    } catch (err) {
      setUploadMsg(mapError(err, lang));
    } finally {
      setUploading(false);
    }
  }

  const visibleCases = showAllCases ? cases : cases.slice(0, 5);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader icon={<Bot className="h-5 w-5" aria-hidden />} title={t("aiAgent", lang)} className="mb-1" />
      <p className="text-xs leading-relaxed text-stone-600">{t("advisoryDisclaimer", lang)}</p>

      <Card className="space-y-2">
        <label className="inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center rounded-button border border-brand-300 px-4 py-2 font-semibold text-link transition-colors hover:border-brand-400 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] focus-visible:ring-offset-2 ring-offset-[var(--color-surface-bg)]">
          <Camera className="mr-2 inline h-5 w-5" aria-hidden /> {t("uploadPhoto", lang)} · {t("diseaseCheck", lang)}
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={uploadImage} disabled={uploading} />
        </label>
        {uploading && (
          <p className="flex items-center gap-2 text-sm text-stone-500">
            <Spinner className="h-4 w-4" /> {t("compressingImage", lang)}
          </p>
        )}
        {uploadMsg &&
          (uploadMsg === t("pendingReview", lang) ? (
            <div role="status" className="rounded-lg bg-success-bg px-3 py-2 text-xs text-success-text">
              {uploadMsg}
            </div>
          ) : (
            <ErrorBanner message={uploadMsg} />
          ))}

        {/* Cases: their own block — its skeleton while loading, and its own
            error with retry (previously the failure was silent). The empty
            state stays silent, as it was: the list is an optional extra. */}
        <BlockError error={casesRes.error} retryLabel={t("retry", lang)} onRetry={() => void casesRes.reload()} />

        {casesRes.loading ? (
          <Skeleton className="h-10 w-full" />
        ) : cases.length > 0 ? (
          <div className="pt-1">
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">{t("myCases", lang)}</h3>
            <ul className="space-y-1.5">
              {visibleCases.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 text-xs">
                  <span>{formatDate(c.createdAt, lang)}</span>
                  {c.status === "REVIEWED" ? (
                    <Badge tone="success">{t("reviewed", lang)}</Badge>
                  ) : (
                    <Badge tone="default">{t("pendingReview", lang)}</Badge>
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
        ) : null}
      </Card>

      <Card className="space-y-3">
        {chat.length === 0 && !busy && (
          <div className="space-y-1 rounded-xl bg-surface-subdued py-8 text-center text-sm text-stone-500">
            <Sprout className="mx-auto mb-1 h-8 w-8 text-brand-600" aria-hidden />
            {t("exampleQuestion", lang)}
          </div>
        )}
        {chat.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-brand-700 px-4 py-2.5 text-sm text-white">
              {m.text}
            </div>
          ) : (
            <div key={i} className="max-w-[90%] space-y-1">
              {/* whitespace-pre-wrap renders structured (multi-section) and plain answers alike */}
              <div className="whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-surface-subdued px-4 py-2.5 text-sm text-stone-800">{m.text}</div>
              {m.refs && m.refs.length > 0 && (
                <ul className="space-y-0.5 px-1 text-xs text-stone-500">
                  <li className="font-semibold">{t("advisorSource", lang)}</li>
                  {m.refs.map((r, ri) => (
                    <li key={ri}>· {r}</li>
                  ))}
                </ul>
              )}
              {m.confidence !== undefined && (
                // Coarse support band, never a percentage: the score behind it
                // is a keyword-retrieval heuristic, not a calibrated
                // probability (AUD-108).
                <Badge tone={confidenceSupportKey(m.confidence ?? 0, m.low ?? false) === "lowConfidence" ? "warning" : "success"}>
                  {t(confidenceSupportKey(m.confidence ?? 0, m.low ?? false), lang)}
                </Badge>
              )}
            </div>
          )
        )}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-stone-500">
            <Spinner className="h-4 w-4" /> {t("loading", lang)}
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
