"use client";

import { useState } from "react";
import { useProfileText } from "@/components/i18n/profile-text";
import { useToast } from "@/components/ui/toast";
import { isLocale, LOCALES, type Locale } from "@/lib/shared/locales";
import { profileErrorMessage } from "../profile-errors";
import s from "../profil.module.css";

/** Nom de chaque langue **dans cette langue** : on reconnaît la sienne sans lire l'autre. */
const LOCALE_AUTONYMS: Record<Locale, string> = { fr: "Français", en: "English" };

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

  const save = async (next: string) => {
    // Pendant l'envoi, le champ garde le focus (`aria-disabled`, pas `disabled`
    // qui le ferait perdre) : ce garde refuse un second choix.
    if (busy || !isLocale(next) || next === locale) return;
    const previous = locale;
    setLocale(next);
    setBusy(true);
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
      showError(profileErrorMessage((e as Error).message, text));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`field ${s.accountLocale}`}>
      <label htmlFor="profile-account-locale">{t("accountLocale.label")}</label>
      <select
        id="profile-account-locale"
        value={locale}
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
        onChange={(e) => void save(e.target.value)}
        aria-describedby="profile-account-locale-hint"
      >
        {LOCALES.map((code) => (
          <option key={code} value={code} lang={code}>
            {LOCALE_AUTONYMS[code]}
          </option>
        ))}
      </select>
      <p id="profile-account-locale-hint" className={s.hint}>
        {t("accountLocale.hint")}
      </p>
    </div>
  );
}
