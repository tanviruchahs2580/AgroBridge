import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";

const CROPS = ["ধান", "গম", "পাট", "সরিষা", "ভুট্টা", "আলু"];

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
        await api("POST", "/farms", { name: farmName.trim(), district: district || undefined, totalAreaBigha: area ? Number(area) : undefined });
      }
      localStorage.setItem("ab_onboarded", "1");
      nav("/");
    } catch (e) {
      setError((e as Error).message);
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
        {lang === "bn" ? `ধাপ ${step + 1} / ${total}` : `Step ${step + 1} / ${total}`} ·{" "}
        <button onClick={() => { localStorage.setItem("ab_onboarded", "1"); nav("/"); }} className="font-semibold text-green-700 hover:underline">
          {lang === "bn" ? "এখন এড়িয়ে যান" : "Skip for now"}
        </button>
      </p>

      {step === 0 && (
        <div className="card space-y-3">
          <h2 className="text-lg font-bold text-stone-800">{lang === "bn" ? "আপনি কে?" : "Who are you?"}</h2>
          <p className="text-sm text-stone-600">{session?.fullName} · {session?.role}</p>
          <p className="text-xs text-stone-500">{lang === "bn" ? "প্রোফাইল নিশ্চিত করুন এবং এগিয়ে যান।" : "Confirm your profile and continue."}</p>
        </div>
      )}
      {step === 1 && (
        <div className="card space-y-3">
          <h2 className="text-lg font-bold text-stone-800">{lang === "bn" ? "এলাকা / জেলা" : "Area / District"}</h2>
          <input className="input" placeholder={lang === "bn" ? "যেমন: রংপুর" : "e.g. Rangpur"} value={district} onChange={(e) => setDistrict(e.target.value)} />
        </div>
      )}
      {step === 2 && (
        <div className="card space-y-3">
          <h2 className="text-lg font-bold text-stone-800">{lang === "bn" ? "জমির পরিমাণ (বিঘা)" : "Land size (bigha)"}</h2>
          <input type="number" min="0.1" step="0.1" className="input" placeholder={lang === "bn" ? "যেমন: 5" : "e.g. 5"} value={area} onChange={(e) => setArea(e.target.value)} />
        </div>
      )}
      {step === 3 && (
        <div className="card space-y-3">
          <h2 className="text-lg font-bold text-stone-800">{lang === "bn" ? "প্রধান ফসল" : "Primary crops"}</h2>
          <div className="flex flex-wrap gap-2">
            {CROPS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setSelectedCrops((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ${selectedCrops.includes(c) ? "bg-green-700 text-white" : "bg-white ring-1 ring-stone-200 hover:bg-green-50"}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}
      {step === 4 && (
        <div className="card space-y-3">
          <h2 className="text-lg font-bold text-stone-800">{lang === "bn" ? "প্রথম ফার্ম তৈরি করুন" : "Create first farm"}</h2>
          <input className="input" placeholder={lang === "bn" ? "ফার্মের নাম" : "Farm name"} value={farmName} onChange={(e) => setFarmName(e.target.value)} />
          {selectedCrops.length > 0 && <p className="text-xs text-stone-500">{lang === "bn" ? "নির্বাচিত ফসল:" : "Selected:"} {selectedCrops.join(", ")}</p>}
        </div>
      )}

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex gap-2">
        {step > 0 && (
          <button type="button" onClick={() => setStep((s) => s - 1)} className="btn-outline flex-1">
            {lang === "bn" ? "পিছনে" : "Back"}
          </button>
        )}
        {step < total - 1 ? (
          <button type="button" onClick={() => setStep((s) => s + 1)} className="btn-primary flex-1">
            {lang === "bn" ? "পরবর্তী" : "Next"}
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={finish} className="btn-primary flex-1">
            {busy ? "..." : lang === "bn" ? "শুরু করুন" : "Get started"}
          </button>
        )}
      </div>
    </div>
  );
}
