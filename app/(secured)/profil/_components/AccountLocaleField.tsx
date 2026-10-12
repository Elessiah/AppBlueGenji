"use client";

import { useState } from "react";
import { useProfileText } from "@/components/i18n/profile-text";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { useToast } from "@/components/ui/toast";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { isLocale, LOCALE_NATIVE_NAME, LOCALES, type Locale } from "@/lib/shared/locales";
import { profileErrorMessage } from "../profile-errors";
import s from "../profil.module.css";

const FIELD_ID = "profile-account-locale";
const HINT_ID = "profile-account-locale-hint";
/** Le refus qui désigne ce champ (`PUT /api/profile/locale`). */
const ACCOUNT_LOCALE_FIELD_ERRORS = { INVALID_LOCALE: "locale" } as const;
const FIELD_IDS = { locale: FIELD_ID } as const;

/**
 * Langue du compte (`bg_users.locale`, lot 9-3) : celle des notifications push.
 *
 * Elle suit la langue de la page à chaque connexion ; ce choix explicite la
 * remplace jusqu'à la prochaine connexion faite dans l'autre langue
 * (`lib/server/users/account-locale.ts`). L'enregistrement part au changement,
 * sans bouton : un seul champ, un seul geste, réversible.
 */
export function AccountLocaleField({ initial }: Readonly<{ initial: Locale }>): React.ReactElement {
  const text = useProfileText();
  const { t } = text;
  const { showError, showSuccess } = useToast();
  const [locale, setLocale] = useState<Locale>(initial);
  const [busy, setBusy] = useState(false);
  const fieldErrors = useFieldErrors(ACCOUNT_LOCALE_FIELD_ERRORS, FIELD_IDS);

  const save = async (next: string) => {
    // Pendant l'envoi, le champ garde le focus (`aria-disabled`, pas `disabled`
    // qui le ferait perdre) : ce garde refuse un second choix.
    if (busy || !isLocale(next) || next === locale) return;
    const previous = locale;
    setLocale(next);
    setBusy(true);
    fieldErrors.clear();
    try {
      const response = await fetch("/api/profile/locale", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "PROFILE_UPDATE_FAILED");
      showSuccess(t("accountLocale.saved"));
    } catch (e) {
      setLocale(previous);
      const code = (e as Error).message;
      const message = profileErrorMessage(code, text);
      fieldErrors.report(code, message);
      showError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`field ${s.accountLocale}`}>
      <label htmlFor={FIELD_ID}>{t("accountLocale.label")}</label>
      <select
        id={FIELD_ID}
        value={locale}
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
        onChange={(e) => void save(e.target.value)}
        {...fieldErrors.aria("locale", HINT_ID)}
      >
        {/* Chaque langue nommée dans sa langue : on reconnaît la sienne sans lire l'autre. */}
        {LOCALES.map((code) => (
          <option key={code} value={code} lang={code}>
            {LOCALE_NATIVE_NAME[code]}
          </option>
        ))}
      </select>
      <FieldErrorText fieldId={FIELD_ID} message={fieldErrors.message("locale")} />
      <p id={HINT_ID} className={s.hint}>
        {t("accountLocale.hint")}
      </p>
    </div>
  );
}
