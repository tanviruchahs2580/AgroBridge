import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { invalidate } from "../../lib/useResource";
import { RESOURCE_KEYS } from "../../lib/resourceKeys";
import { useSession } from "../../lib/session";
import { t } from "../../lib/i18n";
import { mapError } from "../../lib/errors-ui";
import { track } from "../../lib/analytics";
import { roleLabel } from "../../lib/labels";
import { Button, Card, ErrorBanner, Input, Label } from "../../components/ui";

export default function Onboarding() {
  const nav = useNavigate();
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const [step, setStep] = useState(0);
  const [district, setDistrict] = useState("");
  const [area, setArea] = useState("");
  const [farmName, setFarmName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const disabled = import.meta.env.VITE_FEATURE_ONBOARDING === "false";
  useEffect(() => {
    if (disabled) nav("/");
  }, [disabled, nav]);

  const total = 4;
  const progress = ((step + 1) / total) * 100;

  async function finish() {
    setBusy(true);
    setError("");
    try {
      if (farmName.trim()) {
        await api("POST", "/farms", {
          name: farmName.trim(),
          district: district || undefined,
          totalAreaBigha: area ? Number(area) : undefined,
        });
        track("farm_created");
        // The first farm changes what every farm consumer should show (Home, My Farm,
        // the booking dialog, the sell form) — they all read RESOURCE_KEYS.farms.
        invalidate(RESOURCE_KEYS.farms);
      }
      nav("/");
    } catch (e) {
      setError(mapError(e, lang));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 py-6">
      {/* The flow had no level-1 heading at all — every step started at h2, so
          the document outline had no root (axe: page-has-heading-one). The h1
          names the flow rather than the current step; each step keeps its own
          h2 below it. */}
      <h1 className="sr-only">{t("onboarding", lang)}</h1>
      <div className="h-2 w-full rounded-full bg-stone-200">
        <div className="h-2 rounded-full bg-action transition-all" style={{ width: `${progress}%` }} />
      </div>
      <p className="text-center text-xs text-stone-600">
        {t("obStepOf", lang, { step: step + 1, total })} ·{" "}
        <button
          type="button"
          onClick={() => nav("/")}
          className="inline-flex min-h-[44px] items-center px-1 font-semibold text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]"
        >
          {t("skipForNow", lang)}
        </button>
      </p>

      {step === 0 && (
        <Card className="space-y-3">
          <h2 className="text-lg font-bold text-stone-800">{t("onboarding", lang)}</h2>
          <p className="text-sm text-stone-600">
            {/* `roleLabel`, not the raw enum: this rendered "FARMER" on a Bengali screen. */}
            {session?.fullName} · <span className="text-xs">{session ? roleLabel(session.role, lang) : ""}</span>
          </p>
          <p className="text-xs text-stone-600">{t("obWhoHint", lang)}</p>
        </Card>
      )}
      {step === 1 && (
        <Card className="space-y-3">
          <h2 className="text-lg font-bold text-stone-800">{t("obDistrictTitle", lang)}</h2>
          <div>
            <Label htmlFor="ob-district">{t("districtPh", lang)}</Label>
            <Input id="ob-district" placeholder={t("districtExample", lang)} value={district} onChange={(e) => setDistrict(e.target.value)} />
          </div>
        </Card>
      )}
      {step === 2 && (
        <Card className="space-y-3">
          <h2 className="text-lg font-bold text-stone-800">{t("obAreaTitle", lang)}</h2>
          <div>
            <Label htmlFor="ob-area">{t("areaBigha", lang)}</Label>
            <Input id="ob-area" type="number" min="0.1" step="0.1" placeholder={t("areaExample", lang)} value={area} onChange={(e) => setArea(e.target.value)} />
          </div>
        </Card>
      )}
      {step === 3 && (
        <Card className="space-y-3">
          <h2 className="text-lg font-bold text-stone-800">{t("obFarmTitle", lang)}</h2>
          <div>
            <Label htmlFor="ob-farm">{t("farmNamePh", lang)}</Label>
            <Input id="ob-farm" placeholder={t("farmNamePh", lang)} value={farmName} onChange={(e) => setFarmName(e.target.value)} />
          </div>
        </Card>
      )}

      {error && <ErrorBanner message={error} />}

      <div className="flex gap-2">
        {step > 0 && (
          <Button type="button" variant="outline" className="flex-1" onClick={() => setStep((s) => s - 1)}>
            ← {t("back", lang)}
          </Button>
        )}
        {step < total - 1 ? (
          <Button type="button" className="flex-1" onClick={() => setStep((s) => s + 1)}>
            {t("next", lang)} →
          </Button>
        ) : (
          <Button type="button" className="flex-1" loading={busy} onClick={() => void finish()}>
            {t("getStarted", lang)}
          </Button>
        )}
      </div>
    </div>
  );
}
