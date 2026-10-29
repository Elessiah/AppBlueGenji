"use client";

import { useEffect, useRef, useState } from "react";
import { Coche } from "@/components/Coche";
import { useProfileText } from "@/components/i18n/profile-text";
import { useToast } from "@/components/ui/toast";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { profileErrorMessage } from "../profile-errors";
import { runQueuedSaves } from "../_lib/queued-saves";
import s from "../profil.module.css";

const FIELD_ID = "profile-match-dms";
const HINT_ID = "profile-match-dms-hint";
const UNREACHABLE_ID = "profile-match-dms-unreachable";

/**
 * Messages privés Discord de match (`bg_users.match_dm_enabled`) : le droit
 * d'opposition du joueur aux messages que le bot lui envoie pour ses matchs
 * (`lib/server/users/match-dm-preference.ts`). Les notifications push gardent
 * leurs réglages par sujet, juste au-dessus.
 *
 * Absent tant que la fiche du titulaire n'est pas lue. Enregistré au clic,
 * sans bouton : un seul geste, réversible. Pendant l'envoi, la case reste
 * focalisable et utilisable (`aria-busy`) : un clic fait pendant l'envoi
 * s'affiche et part à la suite (`runQueuedSaves`), jamais perdu.
 *
 * `discordReachable` : le compte a un tag Discord **certifié** — seul un tel
 * compte reçoit ces messages (`toNotificationRecipient`, portée `certified`,
 * contre le spam). À `false`, une ligne le dit et mène à la certification
 * (section Discord, `#discord`) ; `null` (état pas encore lu) : rien.
 *
 * `onChoice` : ce que montre la case (choix du joueur, valeur retenue, fiche
 * relue) remonte à la page, qui en dépend ailleurs (la confirmation du retrait
 * du tag ne promet la fin de ces messages qu'à un joueur qui les reçoit encore
 * — y compris pendant l'envoi de son choix).
 */
/** Toast du choix enregistré : « activés » ne promet rien sans tag certifié. */
function outcomeMessage(enabled: boolean, discordReachable: boolean | null) {
  if (!enabled) return "matchDms.disabled";
  return discordReachable === false ? "matchDms.enabledNotCertified" : "matchDms.enabled";
}

export function MatchDmField({
  initial,
  discordReachable = null,
  onChoice,
}: Readonly<{
  initial: boolean | undefined;
  discordReachable?: boolean | null;
  onChoice?: (enabled: boolean) => void;
}>): React.ReactElement | null {
  const text = useProfileText();
  const { t } = text;
  const { showError, showSuccess } = useToast();
  const [enabled, setEnabledState] = useState(initial ?? true);
  /** Ce que montre la case, lu par un clic fait pendant l'envoi. */
  const enabledRef = useRef(initial ?? true);
  const setEnabled = (value: boolean) => {
    enabledRef.current = value;
    setEnabledState(value);
  };
  // Ce que montre la case remonte à la page après le rendu, jamais pendant.
  const onChoiceRef = useRef(onChoice);
  const reachableRef = useRef(discordReachable);
  useEffect(() => {
    onChoiceRef.current = onChoice;
    reachableRef.current = discordReachable;
  });
  useEffect(() => {
    if (initial !== undefined) onChoiceRef.current?.(enabled);
  }, [enabled, initial]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  /** Choix fait pendant un envoi : affiché tout de suite, envoyé juste après. */
  const queued = useRef<boolean | null>(null);
  // La fiche arrive après le premier rendu, ou est relue : la case reprend la
  // valeur lue tant qu'aucun envoi n'est en cours — et tant que le joueur n'a
  // rien enregistré ici. Après, son choix sur cette page est le plus récent :
  // une relecture commencée avant son envoi ne doit pas le recouvrir.
  const [shown, setShown] = useState(initial);
  const [chosenHere, setChosenHere] = useState(false);
  if (initial !== shown && !busy && (!chosenHere || initial === undefined)) {
    setShown(initial);
    if (initial !== undefined) setEnabled(initial);
  }

  /** Un envoi : `true` si le choix est enregistré (toast d'erreur sinon). */
  const put = async (next: boolean): Promise<boolean> => {
    try {
      const response = await fetch("/api/profile/match-dms", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "PROFILE_UPDATE_FAILED");
      return true;
    } catch (e) {
      showError(profileErrorMessage((e as Error).message, text));
      return false;
    }
  };

  const toggle = async () => {
    const next = !enabledRef.current;
    if (busyRef.current) {
      queued.current = next;
      setEnabled(next);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    const outcome = await runQueuedSaves<boolean>({
      start: enabledRef.current,
      first: next,
      put,
      takeQueued: () => {
        const choice = queued.current;
        queued.current = null;
        return choice;
      },
      show: setEnabled,
    });
    if (outcome.stored) setChosenHere(true);
    // « Activés » / « désactivés » une fois, et seulement si le dernier choix
    // est enregistré : sinon la case reprend l'état gardé en base.
    // Activés sans tag certifié : rien ne part encore, le toast le dit.
    // (Lu à la fin de l'envoi : l'état Discord a pu arriver entre-temps.)
    if (outcome.confirmed) showSuccess(t(outcomeMessage(outcome.saved, reachableRef.current)));
    busyRef.current = false;
    setBusy(false);
  };

  // Fiche pas encore lue (ou d'un autre compte) : rien à régler.
  if (initial === undefined) return null;

  const unreachable = discordReachable === false;
  return (
    <div className={`field ${s.matchDms}`}>
      <InfoHintRow separated>
        <Coche
          id={FIELD_ID}
          label={t("matchDms.label")}
          checked={enabled}
          theme="joueur"
          aria-busy={busy || undefined}
          aria-describedby={unreachable ? `${HINT_ID} ${UNREACHABLE_ID}` : HINT_ID}
          onChange={() => void toggle()}
        />
        <InfoHint id={HINT_ID} subject={t("matchDms.label")}>
          <p>{t("matchDms.hint")}</p>
        </InfoHint>
      </InfoHintRow>
      {unreachable ? (
        <p id={UNREACHABLE_ID} className={s.hint}>
          {t("matchDms.notCertified")} <a href="#discord" className={s.hintLink}>{t("matchDms.certifyLink")}</a>
        </p>
      ) : null}
    </div>
  );
}
