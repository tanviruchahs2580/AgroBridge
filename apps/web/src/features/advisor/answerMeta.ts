// Provider/mode disclosure for an advisory answer.
//
// The gateway returns one of two engines:
//   - offline deterministic KB engine: provider "offline-agro-engine", model "kb-retrieval-v1"
//   - hosted adapter:                  provider "openai-compatible", model = configured model id
// The UI says which mode answered; it never shows a score or percentage.
import { t } from "../../lib/i18n";
import type { Lang } from "../../lib/i18n";

const KB_PROVIDER = "offline-agro-engine";
const KB_MODEL_PREFIX = "kb-";

/**
 * True when a `provider`/`model` pair names the offline deterministic KB engine.
 * Anything else is treated as model-backed (the honest assumption for a provider
 * the UI does not recognise — never the reverse).
 */
export function isOfflineKbAnswer(provider: string, model: string): boolean {
  return provider === KB_PROVIDER || model.startsWith(KB_MODEL_PREFIX);
}

/** Localized coarse mode for the answer meta line ("Knowledge base (KB)" / "AI model"). */
export function answerModeLabel(provider: string, model: string, lang: Lang): string {
  return isOfflineKbAnswer(provider, model) ? t("advisorModeKb", lang) : t("advisorModeAi", lang);
}

/** Short form of the KB content version (the API sends sha256[:12]). */
export function shortKbVersion(kbVersion: string): string {
  return kbVersion.slice(0, 8);
}
