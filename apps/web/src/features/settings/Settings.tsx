import { useLayoutEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BadgeCheck, CircleAlert, KeyRound, Loader2, Settings as SettingsIcon, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { api, clearTokens, ApiError } from "../../lib/api";
import type { Me, OtpRequestResult } from "../../lib/api-types";
import { invalidate, useResource } from "../../lib/useResource";
import { useSession } from "../../lib/session";
import { t } from "../../lib/i18n";
import { mapError } from "../../lib/errors-ui";
import { BUILD_INFO } from "../../lib/build-info";
import {
  Badge, Button, Card, ErrorBanner, Input, Label, PageHeader, SectionHeader, Select, Skeleton, useConfirm, useToast,
} from "../../components/ui";

/**
 * Account & settings — the single place a user edits their profile, verifies
 * their phone (required before any withdrawal), reads the policies, and
 * deletes their account. Google Play requires the deletion path to live inside
 * the app, so this screen is the entry point for it.
 */
export default function Settings() {
  const { session, setLang } = useSession();
  const lang = session?.lang ?? "bn";
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();

  // One concern — the signed-in account (GET /auth/me) — so one resource: the
  // profile, phone-verification and footer sections all read it, exactly as the
  // old single fetch did, and there is no second key to invent.
  const meRes = useResource<Me>("auth-me", () => api<Me>("GET", "/auth/me"));
  const me = meRes.data;

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [district, setDistrict] = useState("");
  const [upazila, setUpazila] = useState("");
  const [address, setAddress] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileErrs, setProfileErrs] = useState<{ fullName?: string; email?: string }>({});

  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpErr, setOtpErr] = useState<string | null>(null);

  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  // Prefill: every successful /auth/me result resets the form fields, so a save
  // or a phone verification re-normalises them from the server — the old
  // load() did this on the same trigger. A *layout* effect, not an effect: the
  // fields must be filled in the same commit that first paints the form, the
  // way the old load() set them before the form existed, so no frame ever shows
  // the inputs empty.
  useLayoutEffect(() => {
    if (!me) return;
    setFullName(me.fullName);
    setEmail(me.email ?? "");
    setDistrict(me.farmerProfile?.district ?? "");
    setUpazila(me.farmerProfile?.upazila ?? "");
    setAddress(me.farmerProfile?.address ?? "");
  }, [me]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof profileErrs = {};
    if (fullName.trim().length < 2) errs.fullName = t("errFieldRequired", lang);
    if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) errs.email = t("errEmailInvalid", lang);
    setProfileErrs(errs);
    if (Object.keys(errs).length) return;

    setSavingProfile(true);
    try {
      // Only send what the API accepts; empty optional strings mean "unchanged".
      await api("PATCH", "/auth/me", {
        fullName: fullName.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(district.trim() ? { district: district.trim() } : {}),
        ...(upazila.trim() ? { upazila: upazila.trim() } : {}),
        ...(address.trim() ? { address: address.trim() } : {}),
      });
      toast.success(t("profileSavedToast", lang));
      // The old code awaited load(): that refetched exactly this endpoint, and
      // the prefill effect re-syncs the fields from the fresh result.
      invalidate("auth-me");
    } catch (err) {
      toast.error(mapError(err, lang));
    } finally {
      setSavingProfile(false);
    }
  }

  async function requestOtp() {
    setOtpBusy(true);
    setOtpErr(null);
    try {
      const res = await api<OtpRequestResult>("POST", "/auth/otp/request");
      setOtpSent(true);
      setDevCode(typeof res?.devCode === "string" ? res.devCode : null);
      toast.info(t("otpSentToast", lang));
    } catch (err) {
      setOtpErr(mapError(err, lang));
    } finally {
      setOtpBusy(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(otpCode.trim())) {
      setOtpErr(t("errOtpFormat", lang));
      return;
    }
    setOtpBusy(true);
    setOtpErr(null);
    try {
      await api("POST", "/auth/otp/verify", { code: otpCode.trim() });
      toast.success(t("phoneVerifiedToast", lang));
      setOtpSent(false);
      setOtpCode("");
      setDevCode(null);
      // Same endpoint and same refetch set as the old `await load()`: the
      // verified badge reads the fresh phoneVerified flag.
      invalidate("auth-me");
    } catch (err) {
      setOtpErr(mapError(err, lang));
    } finally {
      setOtpBusy(false);
    }
  }

  async function deleteAccount() {
    const okToDelete = await confirm({
      title: t("deleteAccountTitle", lang),
      body: t("deleteAccountBody", lang),
      confirmLabel: t("deleteAccountConfirm", lang),
      cancelLabel: t("cancel", lang),
      danger: true,
    });
    if (!okToDelete) return;
    setDeleting(true);
    setDeleteErr(null);
    try {
      await api("DELETE", "/auth/me");
      clearTokens();
      toast.success(t("accountDeletedToast", lang));
      navigate("/login", { replace: true });
    } catch (err) {
      // The API refuses while money is in flight (open orders / pending
      // withdrawals); surface that reason instead of a generic failure.
      setDeleteErr(
        err instanceof ApiError && err.status === 422
          ? err.message
          : mapError(err, lang)
      );
    } finally {
      setDeleting(false);
    }
  }

  if (meRes.loading) {
    return (
      <div className="min-w-0 space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (meRes.error || !me) {
    return (
      <div className="min-w-0 space-y-3">
        {/* The old catch discarded the error and showed the generic copy; the
            copy is unchanged (the retry is now the resource's reload). */}
        <ErrorBanner message={t("errorGeneric", lang)} />
        <Button variant="outline" onClick={() => void meRes.reload()}>
          {t("retry", lang)}
        </Button>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader icon={<SettingsIcon className="h-5 w-5" aria-hidden />} title={t("settings", lang)} subtitle={t("settingsSubtitle", lang)} />

      {/* ── Profile ── */}
      <Card className="space-y-4">
        <SectionHeader title={t("profile", lang)} />
        <form onSubmit={saveProfile} className="space-y-3" noValidate>
          <div>
            <Label htmlFor="st-name">{t("fullName", lang)}</Label>
            <Input
              id="st-name"
              value={fullName}
              autoComplete="name"
              onChange={(e) => { setFullName(e.target.value); setProfileErrs((p) => ({ ...p, fullName: undefined })); }}
              aria-invalid={Boolean(profileErrs.fullName)}
              aria-describedby={profileErrs.fullName ? "st-name-err" : undefined}
            />
            {profileErrs.fullName && (
              <p id="st-name-err" role="alert" className="mt-1 text-xs text-danger-text">{profileErrs.fullName}</p>
            )}
          </div>
          <div>
            <Label htmlFor="st-email">{t("emailOptional", lang)}</Label>
            <Input
              id="st-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setProfileErrs((p) => ({ ...p, email: undefined })); }}
              aria-invalid={Boolean(profileErrs.email)}
              aria-describedby={profileErrs.email ? "st-email-err" : undefined}
            />
            {profileErrs.email && (
              <p id="st-email-err" role="alert" className="mt-1 text-xs text-danger-text">{profileErrs.email}</p>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="st-district">{t("districtLabel", lang)}</Label>
              <Input id="st-district" value={district} onChange={(e) => setDistrict(e.target.value)} autoComplete="address-level1" />
            </div>
            <div>
              <Label htmlFor="st-upazila">{t("upazilaLabel", lang)}</Label>
              <Input id="st-upazila" value={upazila} onChange={(e) => setUpazila(e.target.value)} autoComplete="address-level2" />
            </div>
          </div>
          <div>
            <Label htmlFor="st-address">{t("addressLabel", lang)}</Label>
            <Input id="st-address" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" />
          </div>
          <p className="text-xs text-stone-500">{t("districtWeatherHint", lang)}</p>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={savingProfile}>
              {savingProfile && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
              {savingProfile ? t("saving", lang) : t("save", lang)}
            </Button>
            <div>
              <Label htmlFor="st-lang">{t("language", lang)}</Label>
              <Select
                id="st-lang"
                value={lang}
                onChange={(e) => void setLang(e.target.value as "bn" | "en")}
              >
                <option value="bn">বাংলা</option>
                <option value="en">English</option>
              </Select>
            </div>
          </div>
        </form>
      </Card>

      {/* ── Phone verification ── */}
      <Card className="space-y-3">
        <SectionHeader title={t("phoneVerification", lang)} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-stone-700">{me.phone}</span>
          {me.phoneVerified ? (
            <Badge tone="success">
              <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> {t("verifiedLabel", lang)}
            </Badge>
          ) : (
            <Badge tone="warning">{t("notVerifiedLabel", lang)}</Badge>
          )}
        </div>
        <p className="text-xs text-stone-500">
          {me.phoneVerified ? t("phoneVerifiedBody", lang) : t("phoneVerifyWhy", lang)}
        </p>

        {!me.phoneVerified && (
          <div className="space-y-3">
            {otpErr && <ErrorBanner message={otpErr} />}
            {!otpSent ? (
              <Button type="button" onClick={() => void requestOtp()} disabled={otpBusy}>
                {otpBusy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
                <KeyRound className="mr-1.5 h-4 w-4" aria-hidden /> {t("sendCode", lang)}
              </Button>
            ) : (
              <form onSubmit={verifyOtp} className="space-y-2" noValidate>
                <Label htmlFor="st-otp">{t("otpCodeLabel", lang)}</Label>
                <Input
                  id="st-otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  className="max-w-[12rem] tracking-[0.3em]"
                />
                {devCode && (
                  <p className="text-xs text-stone-500">
                    {t("devCodeHint", lang)}: <span className="font-mono font-semibold">{devCode}</span>
                  </p>
                )}
                <div className="flex gap-2">
                  <Button type="submit" disabled={otpBusy}>
                    {otpBusy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
                    {t("verify", lang)}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void requestOtp()} disabled={otpBusy}>
                    {t("resendCode", lang)}
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </Card>

      {/* ── Policies ── */}
      <Card className="space-y-2">
        <SectionHeader title={t("legalTitle", lang)} />
        <ul className="divide-y divide-stone-100 text-sm">
          <li>
            <Link to="/privacy" className="flex min-h-[44px] items-center gap-2 text-stone-700 hover:text-link">
              <ShieldCheck className="h-4 w-4 text-stone-400" aria-hidden /> {t("privacyPolicy", lang)}
            </Link>
          </li>
          <li>
            <Link to="/terms" className="flex min-h-[44px] items-center gap-2 text-stone-700 hover:text-link">
              <ShieldCheck className="h-4 w-4 text-stone-400" aria-hidden /> {t("termsOfService", lang)}
            </Link>
          </li>
          <li>
            <Link to="/account-deletion" className="flex min-h-[44px] items-center gap-2 text-stone-700 hover:text-link">
              <Trash2 className="h-4 w-4 text-stone-400" aria-hidden /> {t("dataDeletionInfo", lang)}
            </Link>
          </li>
        </ul>
      </Card>

      {/* ── Danger zone ── */}
      <Card className="space-y-3">
        <SectionHeader title={t("accountTitle", lang)} />
        <p className="flex items-start gap-2 text-xs leading-relaxed text-stone-600">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning-text" aria-hidden />
          {t("deleteAccountWarning", lang)}
        </p>
        {deleteErr && <ErrorBanner message={deleteErr} />}
        <Button
          type="button"
          variant="outline"
          className="border-danger-border text-danger-text hover:bg-danger-bg"
          onClick={() => void deleteAccount()}
          disabled={deleting}
        >
          {deleting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
          <Trash2 className="mr-1.5 h-4 w-4" aria-hidden /> {deleting ? t("deletingAccount", lang) : t("deleteAccount", lang)}
        </Button>
      </Card>

      <p className="px-1 text-center text-xs text-stone-500">
        {t("appVersionLabel", lang)} {BUILD_INFO.version}
        {BUILD_INFO.commit && BUILD_INFO.commit !== "unknown" ? ` (${BUILD_INFO.commit})` : ""}
        {" · "}
        <Link to="/onboarding" className="font-semibold text-link hover:underline">
          {t("onboarding", lang)}
        </Link>
      </p>
      <p className="px-1 text-center text-xs text-stone-400">
        <UserRound className="mr-1 inline h-3 w-3" aria-hidden />
        {t("accountIdLabel", lang)}: <span className="font-mono">{me.id.slice(0, 8)}</span>
      </p>
    </div>
  );
}
