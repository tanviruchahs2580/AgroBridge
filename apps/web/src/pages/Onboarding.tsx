import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";
import type { DictKey } from "../lib/i18n.js";
import { mapError } from "../lib/errors-ui.js";
import { track } from "../lib/analytics.js";
import { Button, Card, ErrorBanner, Input, Label } from "../components/ui.jsx";

const CROPS = ["RICE", "WHEAT", "JUTE", "MUSTARD", "MAIZE", "POTATO"] as const;
const CROP_KEYS: Record<string, DictKey> = {
  RICE: "cropRICE", WHEAT: "cropWHEAT", JUTE: "cropJUTE",
  MUSTARD: "cropMUSTARD", MAIZE: "cropMAIZE", POTATO: "cropPOTATO",
};

export default function Onboarding() {
  const nav = useNavigate();
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const [step, setStep] = useState(0);
  const [district, setDistrict] = useState("");
  const [area, setArea] = useState("");
  const [selectedCrops, setSelectedCrops] = useState<string[]>([]);
  const [farmName, setFarmName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (import.meta.env.VITE_FEATURE_ONBOARDING === "false") {
    nav("/");
    return null;
  }

  const total = 5;
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
      }
      localStorage.setItem("ab_onboarded", "1");
      nav("/");
    } catch (e) {
      setError(mapError(e, lang));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 py-6">
      <div className="h-2 w-full rounded-full bg-stone-200">
        <div className="h-2 rounded-full bg-green-700 transition-all" style={{ width: `${progress}%` }} />
      </div>
      <p className="text-center text-xs text-stone-500">
        {t("obStepOf", lang, { step: step + 1, total })} ·{" "}
        <button
          type="button"
          onClick={() => { localStorage.setItem("ab_onboarded", "1"); nav("/"); }}
          className="font-semibold text-green-700 hover:underline"
        >
          {t("skipForNow", lang)}
        </button>
      </p>

      {step === 0 && (
        <Card className="space-y-3">
          <h2 className="text-lg font-bold text-stone-800">{t("onboarding", lang)}</h2>
          <p className="text-sm text-stone-600">
            {session?.fullName} · <span className="text-xs">{session?.role}</span>
          </p>
          <p className="text-xs text-stone-500">{t("obWhoHint", lang)}</p>
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
          <h2 className="text-lg font-bold text-stone-800">{t("obCropsTitle", lang)}</h2>
          <div className="flex flex-wrap gap-2">
            {CROPS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={selectedCrops.includes(c)}
                onClick={() => setSelectedCrops((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))}
                className={`min-h-[44px] rounded-full px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 ${
                  selectedCrops.includes(c) ? "bg-green-700 text-white" : "bg-white ring-1 ring-stone-200 hover:bg-green-50"
                }`}
              >
                {t(CROP_KEYS[c], lang)}
              </button>
            ))}
          </div>
          {selectedCrops.length > 0 && (
            <p className="text-xs text-stone-500">{t("selectedCropsLabel", lang)} {selectedCrops.map((c) => t(CROP_KEYS[c], lang)).join(", ")}</p>
          )}
        </Card>
      )}
      {step === 4 && (
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
