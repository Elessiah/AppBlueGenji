"use client";

import { useEffect, useRef, useState } from "react";
import { Coche } from "@/components/Coche";
import { useProfileText } from "@/components/i18n/profile-text";
import { useToast } from "@/components/ui/toast";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import {
  RECRUITMENT_MODAL_OFF_COOKIE,
  RECRUITMENT_MODAL_OFF_EVENT,
  recruitmentModalOffInBrowser,
} from "@/lib/shared/recruitment";
import { profileErrorMessage } from "../profile-errors";
import { runQueuedSaves } from "../_lib/queued-saves";
import s from "../profil.module.css";

const FIELD_ID = "profile-recruitment-modal";
const HINT_ID = "profile-recruitment-modal-hint";
const CHOICE_URL = "/api/recruitment/modal-dismiss";

/** Le cookie « Ne plus afficher » de ce navigateur (lisible du script, `httpOnly: false`). */
export function browserOptedOut(readCookie: () => string = () => document.cookie): boolean {
  try {
    const entry = readCookie()
      .split("; ")
      .find((part) => part.startsWith(`${RECRUITMENT_MODAL_OFF_COOKIE}=`));
    return recruitmentModalOffInBrowser(entry?.slice(RECRUITMENT_MODAL_OFF_COOKIE.length + 1));
  } catch {
    return false;
  }
}

/**
 * Envoi d'un choix : cochée, `DELETE` (réafficher — le compte passe à
 * « réaffichée », le cookie de ce navigateur est effacé) ; décochée, `POST`
 * (comme « Ne plus afficher » dans la fenêtre : compte et cookie). Rend `null`
 * si le choix est enregistré **sur le compte**, sinon le code du refus.
 */
export async function sendRecruitmentModalChoice(
  shown: boolean,
  request: (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "json">> = fetch,
): Promise<string | null> {
  try {
    const response = await request(CHOICE_URL, { method: shown ? "DELETE" : "POST" });
    const payload = (await response.json().catch(() => ({}))) as { error?: unknown; account?: unknown };
    if (response.ok && payload.account === true) return null;
    // `{ account: false }` : la session a pris fin depuis le chargement.
    if (response.ok) return "UNAUTHORIZED";
    return typeof payload.error === "string" ? payload.error : "PROFILE_UPDATE_FAILED";
  } catch {
    return "PROFILE_UPDATE_FAILED";
  }
}

/**
 * Issue d'un envoi : `ACCOUNT` enregistré sur le compte ; `BROWSER` décochée
 * refusée par le serveur mais le cookie de ce navigateur posé quand même (la
 * réponse le repose quelle que soit l'issue) — le choix tient ici, il ne faut
 * pas dire « échec » ; `FAILED` sinon.
 */
export function recruitmentModalSaveOutcome(
  error: string | null,
  shown: boolean,
  cookieOff: boolean,
): "ACCOUNT" | "BROWSER" | "FAILED" {
  if (error === null) return "ACCOUNT";
  return !shown && cookieOff ? "BROWSER" : "FAILED";
}

/** Ce que montre la case : la fenêtre s'ouvre-t-elle **sur ce navigateur** ? */
export function recruitmentModalShownHere(accountOff: boolean | undefined, cookieOff: boolean): boolean {
  return accountOff !== true && !cookieOff;
}

/**
 * Fenêtre d'arrivée des annonces de recrutement urgentes, depuis « Mon
 * profil » (`docs/features/RECRUITMENT.md` § Réafficher) : cochée, elle
 * s'ouvre ; décochée, plus d'elle-même. L'état montré est celui **de ce
 * navigateur** : refusée sur le compte ou par le cookie d'ici.
 *
 * Même conduite que `MatchDmField` : enregistré au clic, un clic fait pendant
 * l'envoi s'affiche et part à la suite (`runQueuedSaves`), la case reste
 * focalisable (`aria-busy`). `initialOff` absent (fiche pas encore lue) : rien
 * — la fiche n'arrive qu'après le montage, le cookie se lit donc sans écart
 * d'hydratation.
 */
export function RecruitmentModalField({
  initialOff,
  onSaved,
}: Readonly<{
  initialOff: boolean | undefined;
  /**
   * Choix enregistré : la page relit la mise en page racine (`router.refresh()`),
   * seule à décider de la modale — sans quoi rien ne change avant un rechargement.
   */
  onSaved?: () => void;
}>): React.ReactElement | null {
  const text = useProfileText();
  const { t } = text;
  const { showError, showSuccess } = useToast();
  const readShown = (off: boolean | undefined) =>
    off === undefined ? true : recruitmentModalShownHere(off, browserOptedOut());
  const [shown, setShownState] = useState(() => readShown(initialOff));
  const shownRef = useRef(shown);
  const setShown = (value: boolean) => {
    shownRef.current = value;
    setShownState(value);
  };
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const queued = useRef<boolean | null>(null);
  const keptHereOnly = useRef(false);
  // La fiche arrive après le premier rendu, ou est relue : la case reprend
  // l'état lu tant que rien n'a été enregistré ici (comme `MatchDmField`).
  const [seen, setSeen] = useState(initialOff);
  const [chosenHere, setChosenHere] = useState(false);
  if (initialOff !== seen && !busy && (!chosenHere || initialOff === undefined)) {
    setSeen(initialOff);
    if (initialOff !== undefined) setShown(readShown(initialOff));
  }

  // « Ne plus afficher » cliqué dans la modale ouverte par-dessus cette page :
  // la case se décoche (pendant un envoi, le cookie est relu à sa fin).
  useEffect(() => {
    const onOptOut = () => {
      if (!busyRef.current) setShown(false);
    };
    window.addEventListener(RECRUITMENT_MODAL_OFF_EVENT, onOptOut);
    return () => window.removeEventListener(RECRUITMENT_MODAL_OFF_EVENT, onOptOut);
  }, []);

  const put = async (next: boolean): Promise<boolean> => {
    const error = await sendRecruitmentModalChoice(next);
    const result = recruitmentModalSaveOutcome(error, next, browserOptedOut());
    keptHereOnly.current = result === "BROWSER";
    if (result !== "FAILED") return true;
    showError(profileErrorMessage(error ?? "PROFILE_UPDATE_FAILED", text));
    return false;
  };

  const toggle = async () => {
    const next = !shownRef.current;
    if (busyRef.current) {
      queued.current = next;
      setShown(next);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    const outcome = await runQueuedSaves<boolean>({
      start: shownRef.current,
      first: next,
      put,
      takeQueued: () => {
        const choice = queued.current;
        queued.current = null;
        return choice;
      },
      show: setShown,
    });
    if (outcome.stored) setChosenHere(true);
    if (outcome.confirmed) {
      const hidden = keptHereOnly.current ? "recruitmentModal.hiddenBrowser" : "recruitmentModal.hidden";
      showSuccess(t(outcome.saved ? "recruitmentModal.shown" : hidden));
    }
    // Ce navigateur a le dernier mot sur la case : un `POST` refusé repose
    // quand même le cookie, et un « Ne plus afficher » de la modale arrivé
    // pendant l'envoi a pu le poser — cochée, elle mentirait.
    if (shownRef.current && browserOptedOut()) setShown(false);
    busyRef.current = false;
    setBusy(false);
    if (outcome.stored) onSaved?.();
  };

  if (initialOff === undefined) return null;

  return (
    <div className={`field ${s.matchDms}`}>
      <InfoHintRow separated>
        <Coche
          id={FIELD_ID}
          label={t("recruitmentModal.label")}
          checked={shown}
          theme="joueur"
          aria-busy={busy || undefined}
          aria-describedby={HINT_ID}
          onChange={() => void toggle()}
        />
        <InfoHint id={HINT_ID} subject={t("recruitmentModal.label")}>
          <p>{t("recruitmentModal.hint")}</p>
          <p>{t("recruitmentModal.hintBrowser")}</p>
        </InfoHint>
      </InfoHintRow>
    </div>
  );
}
