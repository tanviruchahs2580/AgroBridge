import type { DictKey } from "../../lib/i18n";

/**
 * Qualitative support label for an advisory answer.
 *
 * The API's `confidence` is a keyword-retrieval score, not a calibrated
 * probability — rendering it as "73%" invited readers to treat it as one, on
 * advice that can affect a harvest. The UI therefore shows only a coarse band;
 * the server's `low` flag keeps its verify-with-an-expert wording.
 */
export function confidenceSupportKey(confidence: number, low: boolean): DictKey {
  if (low || confidence < 0.45) return "lowConfidence";
  if (confidence >= 0.7) return "supportHigh";
  return "supportModerate";
}
