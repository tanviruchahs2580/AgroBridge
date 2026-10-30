import { useEffect, useRef, useState } from "react";
import { uuid } from "../../lib/uuid";
import { api, apiBlob } from "../../lib/api";
import type { AdvisoryAnswer, AdvisoryFeedback, AdvisoryHistoryItem, DiseaseCase } from "../../lib/api-types";
import { invalidate, useResource } from "../../lib/useResource";
import { useSession } from "../../lib/session";
import { t } from "../../lib/i18n";
import { formatDate } from "../../lib/format";
import { mapError } from "../../lib/errors-ui";
import { track } from "../../lib/analytics";
import { Bot, Camera, Eye, Sprout } from "lucide-react";
import { Badge, BlockError, Button, Card, EmptyState, ErrorBanner, Input, Modal, PageHeader, Skeleton, Spinner, useToast } from "../../components/ui";
import { confidenceSupportKey } from "./supportLabel";
import { answerModeLabel, shortKbVersion } from "./answerMeta";

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
  const toast = useToast();
  const [question, setQuestion] = useState("");
  const [chat, setChat] = useState<{
    /** Stable key: array-index keys break if the transcript ever reorders. */
    id: string;
    role: "user" | "ai";
    text: string;
    /**
     * A failed request is carried on the turn, not painted as an answer.
     * Previously the mapped error was pushed with `role: "ai"`, so a network
     * failure rendered inside the same bubble as real advice — in a product
     * whose premise is that nothing unverified is shown as agronomic guidance.
     */
    failed?: boolean;
    confidence?: number;
    low?: boolean;
    refs?: string[];
    /** Provenance of the answer: which engine and KB version produced it.*/
    provider?: string;
    model?: string;
    kbVersion?: string;
  }[]>([]);
  const [busy, setBusy] = useState(false);
  const [showAllCases, setShowAllCases] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [reporting, setReporting] = useState<AdvisoryHistoryItem | null>(null);
  const [reason, setReason] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  /**
   * AUD-201: the case photo viewer. The bytes only exist behind an
   * authenticated endpoint, so the modal fetches a Blob and shows it from an
   * object URL; the URL is revoked on close so photos do not accumulate in
   * memory (or linger in the DOM after the session locks).
   */
  const [photoCase, setPhotoCase] = useState<DiseaseCase | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // The only fetch on this screen is the user's disease-case list; the chat is
  // component state, never refetched. Its own resource means a failed list
  // fetch no longer has to be swallowed silently.
  const casesRes = useResource<DiseaseCase[]>("advisor-cases", () => api<DiseaseCase[]>("GET", "/disease/cases"));
  const cases = casesRes.data ?? [];

  // Stored advisories. This is the only surface carrying row ids (the chat list
  // is local state and POST /ai/advisory returns no id), so the report-a-problem
  // action attaches here.
  const historyRes = useResource<AdvisoryHistoryItem[]>("advisor-history", () => api<AdvisoryHistoryItem[]>("GET", "/ai/history"));
  const history = historyRes.data ?? [];

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    chatEndRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
  }, [chat.length, busy]);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || busy) return;
    const q = question.trim();
    setChat((c) => [...c, { id: uuid(), role: "user", text: q }]);
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
          id: uuid(),
          role: "ai",
          text: res.answer,
          confidence: res.confidence,
          low: res.lowConfidenceFlag,
          refs: Array.isArray(res.groundedRefs) ? res.groundedRefs : [],
          provider: res.provider,
          model: res.model,
          kbVersion: res.kbVersion,
        },
      ]);
      // The server just stored this advisory; the collapsed history panel holds
      // an earlier fetch, so without this it shows a stale (pre-question) list
      // until a reload (found live 2026-10-19).
      invalidate("advisor-history");
    } catch (err) {
      setChat((c) => [...c, { id: uuid(), role: "ai", text: mapError(err, lang), failed: true }]);
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
      // The old code awaited loadCases: that refetched exactly this resource.
      invalidate("advisor-cases");
    } catch (err) {
      setUploadMsg(mapError(err, lang));
    } finally {
      setUploading(false);
    }
  }

  /** Fetch the stored photo of a case and show it in the modal (AUD-201). */
  async function viewCasePhoto(c: DiseaseCase) {
    setPhotoCase(c);
    setPhotoError(null);
    setPhotoBusy(true);
    setPhotoUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    try {
      const blob = await apiBlob(`/disease/cases/${c.id}/image`);
      setPhotoUrl(URL.createObjectURL(blob));
    } catch (err) {
      setPhotoError(mapError(err, lang));
    } finally {
      setPhotoBusy(false);
    }
  }

  function closePhoto() {
    setPhotoCase(null);
    setPhotoError(null);
    setPhotoUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
  }

  function openReport(item: AdvisoryHistoryItem) {    setReporting(item);
    setReason("");
    setReportError(null);
  }

  /**
   * Report-a-problem: POSTs the farmer's reason for a stored answer.
   * The API overwrites a previous report (there is one feedback slot per row),
   * so a repeat submission is simply accepted again and confirmed with the same
   * success toast. The row is updated from the response, never optimistically.
   */
  async function submitReport() {
    if (!reporting || reportBusy || reason.trim().length < 3) return;
    const id = reporting.id;
    setReportBusy(true);
    setReportError(null);
    try {
      const res = await api<AdvisoryFeedback>("POST", `/ai/history/${id}/feedback`, { reason: reason.trim() });
      historyRes.setData((historyRes.data ?? []).map((h) => (h.id === res.id ? { ...h, feedbackReason: res.feedbackReason, feedbackAt: res.feedbackAt } : h)));
      toast.success(t("feedbackThanks", lang));
      setReporting(null);
    } catch (err) {
      setReportError(mapError(err, lang));
    } finally {
      setReportBusy(false);
    }
  }

  const visibleCases = showAllCases ? cases : cases.slice(0, 5);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader icon={<Bot className="h-5 w-5" aria-hidden />} title={t("aiAgent", lang)} className="mb-1" />
      <p className="text-xs leading-relaxed text-stone-600">{t("advisoryDisclaimer", lang)}</p>

      <Card className="space-y-2">
        <label className="inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center rounded-button border border-brand-300 px-4 py-2 font-semibold text-link transition-colors hover:border-brand-400 hover:bg-brand-50 focus-within:ring-2 peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ring-color)] peer-focus-visible:ring-offset-2 ring-offset-[var(--color-surface-bg)]">
          <Camera className="mr-2 inline h-5 w-5" aria-hidden /> {t("uploadPhoto", lang)} · {t("diseaseCheck", lang)}
          {/* `sr-only`, not `hidden`: display:none removes the input from the tab
              order, so the photo upload — the only way to use the disease
              intake — could not be reached or activated by keyboard at all. */}
          <input type="file" accept="image/*" capture="environment" className="peer sr-only" onChange={uploadImage} disabled={uploading} />
        </label>
        {uploading && (
          <p role="status" className="flex items-center gap-2 text-sm text-stone-500">
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
 state stays silent, as it was: the list is an optional extra.*/}
        <BlockError error={casesRes.error} retryLabel={t("retry", lang)} onRetry={() => void casesRes.reload()} />

        {casesRes.loading ? (
          <Skeleton className="h-10 w-full" />
        ) : cases.length > 0 ? (
          <div className="pt-1">
            <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">{t("myCases", lang)}</h2>
            <ul className="space-y-1.5">
              {visibleCases.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 text-xs">
                  <span>{formatDate(c.createdAt, lang)}</span>
                  <span className="flex items-center gap-2">
                    {c.status === "REVIEWED" ? (
                      <Badge tone="success">{t("reviewed", lang)}</Badge>
                    ) : (
                      <Badge tone="default">{t("pendingReview", lang)}</Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void viewCasePhoto(c)}
                      aria-label={t("viewPhoto", lang)}
                    >
                      <Eye className="mr-1 h-4 w-4" aria-hidden /> {t("viewPhoto", lang)}
                    </Button>
                  </span>
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
          <EmptyState
            icon={<Sprout className="h-7 w-7 text-brand-600" aria-hidden />}
            title={t("aiAgent", lang)}
            description={t("exampleQuestion", lang)}
          />
        )}
        {/* `role="log"` + polite: the transcript is a live region designed for
            appended chat turns, so an answer (or its failure) is announced when it
            arrives. Without it the whole conversation landed silently. */}
        <div
          role="log"
          aria-live="polite"
          aria-label={t("advisorTranscriptLabel", lang)}
          className="space-y-3"
        >
          {chat.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-brand-700 px-4 py-2.5 text-sm text-white">
                {m.text}
              </div>
            ) : m.failed ? (
              // A request that never reached the model is an error, not an answer:
              // it must not wear the answer bubble's styling.
              <div key={m.id} className="max-w-[90%]">
                <ErrorBanner message={m.text} />
              </div>
            ) : (
              <div key={m.id} className="max-w-[90%] space-y-1">
                {/* whitespace-pre-wrap renders structured (multi-section) and plain answers alike*/}
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
                  // probability.
                  <Badge tone={confidenceSupportKey(m.confidence ?? 0, m.low ?? false) === "lowConfidence" ? "warning" : "success"}>
                    {t(confidenceSupportKey(m.confidence ?? 0, m.low ?? false), lang)}
                  </Badge>
                )}
                {/* Which engine/mode answered and the KB version it was grounded in
 — a disclosure line, not a score.*/}
                {m.kbVersion && (
                  <p className="px-1 text-xs text-stone-500">
                    {answerModeLabel(m.provider ?? "", m.model ?? "", lang)} · {t("advisorKbVersion", lang, { v: shortKbVersion(m.kbVersion) })}
                  </p>
                )}
              </div>
            )
          )}
          {busy && (
            <div role="status" className="flex items-center gap-2 text-sm text-stone-500">
              <Spinner className="h-4 w-4" /> {t("loading", lang)}
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
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

      {/* Stored advisories — the only surface with row ids, so report-a-problem
 lives on these rows. Collapsed by default; the chat stays the
 primary surface.*/}
      <section className="space-y-2">
        <Button
          variant="ghost"
          size="sm"
          className="px-1 text-xs"
          aria-expanded={showHistory}
          onClick={() => setShowHistory((v) => !v)}
        >
          {showHistory ? t("showLess", lang) : t("advisorHistory", lang)}
        </Button>
        {showHistory && (
          <Card variant="static" className="space-y-2">
            <BlockError error={historyRes.error} retryLabel={t("retry", lang)} onRetry={() => void historyRes.reload()} />
            {historyRes.loading ? (
              <Skeleton className="h-14 w-full" />
            ) : history.length === 0 && !historyRes.error ? (
              <p className="text-xs text-stone-500">{t("advisorNoHistory", lang)}</p>
            ) : (
              <ul className="space-y-2">
                {history.map((h) => (
                  <li key={h.id} className="space-y-1 rounded-xl border border-surface-border bg-surface-subdued px-3 py-2">
                    <p className="text-xs text-stone-500">{formatDate(h.createdAt, lang)}</p>
                    <p className="text-sm leading-snug text-stone-700">{h.question}</p>
                    {h.feedbackAt ? (
                      // The stored report is reflected from the server fields, not
                      // from local state: a reload shows the same "Reported" row.
                      <p className="text-xs font-medium text-success-text" title={h.feedbackReason ?? undefined}>
                        ✓ {t("feedbackReported", lang)}
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openReport(h)}
                        className="rounded-chip text-xs font-medium text-stone-500 underline decoration-stone-300 underline-offset-2 transition-colors hover:text-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]"
                      >
                        {t("reportIssue", lang)}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </section>

      {reporting && (
        <Modal
          title={t("reportIssueTitle", lang)}
          onClose={() => setReporting(null)}
          closeLabel={t("close", lang)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReporting(null)} disabled={reportBusy}>{t("cancel", lang)}</Button>
              <Button onClick={() => void submitReport()} loading={reportBusy} disabled={reason.trim().length < 3}>{t("reportSubmit", lang)}</Button>
            </div>
          }
        >
          <p className="text-sm text-stone-600">{t("reportIssueBody", lang)}</p>
          <p className="mt-2 line-clamp-2 text-xs text-stone-500">{reporting.question}</p>
          <textarea
            aria-label={t("reportReasonLabel", lang)}
            className="mt-3 w-full rounded-input border border-surface-border-strong bg-surface-card px-3 py-2.5 text-base text-stone-800 shadow-sm placeholder:text-stone-500 focus:border-brand-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] focus-visible:ring-offset-2 ring-offset-[var(--color-surface-bg)]"
            rows={4}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {reportError && <div className="mt-2"><ErrorBanner message={reportError} /></div>}
        </Modal>
      )}

      {photoCase && (
        <Modal title={t("viewPhoto", lang)} onClose={closePhoto} closeLabel={t("close", lang)}>
          {photoBusy && (
            <p role="status" className="flex items-center gap-2 text-sm text-stone-500">
              <Spinner className="h-4 w-4" /> {t("loading", lang)}
            </p>
          )}
          {photoError && <ErrorBanner message={photoError} />}
          {photoUrl && !photoError && (
            <img
              src={photoUrl}
              alt={t("casePhotoAlt", lang)}
              className="max-h-[70vh] w-full rounded-lg object-contain"
            />
          )}
        </Modal>
      )}
    </div>
  );
}
