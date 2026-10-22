"use client";

import { useRef, useState } from "react";
import { useProfileText } from "@/components/i18n/profile-text";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { useToast } from "@/components/ui/toast";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { isLocale, LOCALE_NATIVE_NAME, LOCALES, type Locale } from "@/lib/shared/locales";
import { profileErrorMessage } from "../profile-errors";
import { runQueuedSaves } from "../_lib/queued-saves";
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
  const busyRef = useRef(false);
  /** Choix fait pendant un envoi : affiché tout de suite, envoyé juste après. */
  const queued = useRef<Locale | null>(null);
  const fieldErrors = useFieldErrors(ACCOUNT_LOCALE_FIELD_ERRORS, FIELD_IDS);

  // Langue relue ailleurs (connexion dans un autre onglet, puis rechargement
  // des données de la page) : le champ la reprend sans être remonté (ce qui
  // perdrait un envoi et le focus) — tant que le joueur n'a rien enregistré
  // ici. Après, son choix sur cette page est le plus récent : une relecture
  // commencée avant son envoi ne doit pas le recouvrir à l'écran.
  const [shown, setShown] = useState<Locale>(initial);
  const [chosenHere, setChosenHere] = useState(false);
  if (initial !== shown && !busy && !chosenHere) {
    setShown(initial);
    setLocale(initial);
  }

  /** Un envoi : `true` si la langue est enregistrée (toast d'erreur sinon). */
  const put = async (next: Locale): Promise<boolean> => {
    try {
      const response = await fetch("/api/profile/locale", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "PROFILE_UPDATE_FAILED");
      fieldErrors.clear();
      return true;
    } catch (e) {
      const code = (e as Error).message;
      const message = profileErrorMessage(code, text);
      // Rattaché au champ s'il a encore le focus : un envoi mis de côté peut
      // échouer après que le joueur est passé à un autre champ, qu'on ne lui
      // reprend pas.
      if (document.activeElement?.id === FIELD_ID) fieldErrors.report(code, message);
      showError(message);
      return false;
    }
  };

  const save = async (value: string) => {
    if (!isLocale(value)) return;
    // Pendant l'envoi, le champ reste utilisable (`aria-busy`, ni `disabled`
    // qui ferait perdre le focus, ni `aria-disabled` qui le dirait inerte) :
    // un second choix s'affiche et part à la suite.
    if (busyRef.current) {
      queued.current = value;
      setLocale(value);
      return;
    }
    if (value === locale) return;
    busyRef.current = true;
    setBusy(true);
    fieldErrors.clear();
    const outcome = await runQueuedSaves<Locale>({
      start: locale,
      first: value,
      put,
      takeQueued: () => {
        const choice = queued.current;
        queued.current = null;
        return choice;
      },
      show: setLocale,
    });
    if (outcome.stored) setChosenHere(true);
    if (outcome.upToDate) fieldErrors.clear();
    // « Enregistré » une fois, et seulement si le dernier choix l'est : après
    // l'échec de ce dernier, le toast d'erreur reste le dernier mot.
    if (outcome.confirmed) showSuccess(t("accountLocale.saved"));
    busyRef.current = false;
    setBusy(false);
  };

  return (
    <div className={`field ${s.accountLocale}`}>
      <InfoHintRow>
        <label htmlFor={FIELD_ID}>{t("accountLocale.label")}</label>
        <InfoHint id={HINT_ID} subject={t("accountLocale.label")}>
          <p>{t("accountLocale.hint")}</p>
        </InfoHint>
      </InfoHintRow>
      <select
        id={FIELD_ID}
        value={locale}
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
    </div>
  );
}
