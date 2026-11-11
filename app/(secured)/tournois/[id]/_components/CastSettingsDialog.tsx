"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { useToast } from "@/components/ui/toast";
import { battletagRelevantFor } from "@/lib/shared/certification-prompt";
import { offersCastRelease } from "@/lib/shared/cast-settings";
import { canToggleOnAir, isMatchCastable, type MatchLiveTrigger } from "@/lib/shared/live-streams";
import { liveTriggerViewer, viewerMayChangeLiveTrigger } from "@/lib/shared/live-trigger-owner";
import { viewerRefereesMatch } from "@/lib/shared/match-referee";
import { canEditReplay } from "@/lib/shared/match-replay";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { useMatchLiveState } from "@/lib/shared/hooks/useMatchLiveState";
import type { BracketMatch } from "@/lib/shared/types";
import { launchErrorText, useActionsText } from "../_lib/actions-text";
import { useErrorsText } from "../_lib/error-map";
import { useLiveControls } from "../_lib/live-context";
import { useTournamentGame } from "../_lib/match-format-context";
import { useOnAirToggle } from "../_lib/use-on-air-toggle";
import {
  CastBattletagField,
  CastTriggerField,
  CastUrlField,
  castBattletagInvalid,
  castTriggerNeedsDate,
  lockedTrigger,
  castUrlInvalid,
} from "./CastSettingsFields";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { requestJson } from "../_lib/request-json";
import { TournamentDialogFrame } from "./TournamentDialogFrame";
import styles from "./CastSettingsDialog.module.css";

const CAST_FIELD_ERRORS = {
  INVALID_STREAM_URL: "url",
  STREAM_URL_REQUIRED: "url",
  CAST_STREAM_NOT_OWNED: "url",
  CAST_STREAM_LINK_HELD: "url",
  INVALID_CAST_BATTLETAG: "battletag",
} as const;

/** Ce que la fenêtre a lu du cast du lecteur (`GET /api/matches/[id]/caster`). */
type OwnCast = {
  streamId: number;
  liveUrl: string | null;
  staffStream: boolean;
  battletag: string | null;
};

/**
 * « Configurer ma diffusion » — tout ce qu'un caster règle sur **son** cast
 * (`docs/features/CAST_SETTINGS.md`), là où la carte n'a plus qu'un bouton :
 *
 * - le lien de son stream (celui du staff se lit seulement) ;
 * - le mode de passage à l'antenne du match, et l'antenne elle-même en manuel ;
 * - le BattleTag qu'il donne pour ce cast (Overwatch) ;
 * - la rediff, une fois la rencontre jouée ;
 * - « Ne plus caster », qui rend la place et fait revenir « Caster ce match ».
 *
 * Le BattleTag du cast ne voyage pas dans l'instantané du plateau (commun à
 * tous les lecteurs) : la fenêtre le lit pour le seul caster
 * (`GET /api/matches/[id]/caster`), à l'ouverture.
 *
 * Voile, cadre et comportement modal : `TournamentDialogFrame` ; `busy`
 * verrouille Échap pendant l'envoi.
 */
export function CastSettingsDialog({
  match,
  matchLabel,
  onClose,
  onSaved,
  onReleased,
}: Readonly<{
  match: BracketMatch;
  matchLabel: string;
  onClose: () => void;
  /** Un réglage enregistré : la page relit le match (et la modale de lancement). */
  onSaved: () => void;
  /** Retrait abouti : la carte rendra le focus à « Caster », qui revient. */
  onReleased?: () => void;
}>) {
  const actionText = useActionsText();
  const { t } = actionText;
  const errorsText = useErrorsText();
  const { showError, showSuccess } = useToast();
  const controls = useLiveControls();
  const { openReplay } = controls;
  // Le mode posé par un autre caster se lit sans se changer
  // (`LIVE_TRIGGER_NOT_OWNED`) : un co-caster ne décide pas pour celui qui l'a posé.
  const viewer = liveTriggerViewer(controls, viewerRefereesMatch(match, controls.refereeNames));
  const triggerLocked = !viewerMayChangeLiveTrigger(match, viewer);
  const game = useTournamentGame();
  const titleId = useId();
  const urlId = useId();
  const battletagId = useId();

  const [cast, setCast] = useState<OwnCast | null>(null);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [url, setUrl] = useState("");
  const [battletag, setBattletag] = useState("");
  // `null` tant que le caster n'a pas choisi : un match démarqué montre
  // « automatique » sans que l'enregistrement d'un BattleTag le marque casté.
  const [pickedTrigger, setTrigger] = useState<MatchLiveTrigger | null>(null);
  const trigger: MatchLiveTrigger = pickedTrigger ?? match.liveTrigger ?? "AUTO";
  const [busy, setBusy] = useState(false);
  const fieldErrors = useFieldErrors(CAST_FIELD_ERRORS, { url: urlId, battletag: battletagId });
  const fail = (code: string | null | undefined) => launchErrorText(actionText, errorsText, code);

  // Lecture d'ouverture : le lien de son stream et son BattleTag de cast. Un
  // échec (place reprise entre-temps, réseau) referme la fenêtre en le disant —
  // une fenêtre vide ne dirait pas ce qu'elle réglerait.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const payload = await requestJson<OwnCast>(`/api/matches/${match.id}/caster`, {}, "MATCH_CAST_SETTINGS_FAILED");
        if (!alive) return;
        setCast(payload);
        setUrl(payload.liveUrl ?? "");
        setBattletag(payload.battletag ?? "");
      } catch (error) {
        if (!alive) return;
        showError(fail((error as Error).message));
        onClose();
      }
    })();
    return () => {
      alive = false;
    };
    // Une seule lecture par ouverture : les rappels changent à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id]);

  // Le mode ne s'offre que sur un match encore castable : sur un score saisi,
  // le serveur ne prend plus que « non casté », que ce champ n'offre pas
  // (`assertCastTriggerWritable`) — chaque choix y serait refusé.
  const configurable = isMatchCastable(match);
  // Un match joué ne prend plus ni lien ni BattleTag (`MATCH_CAST_CLOSED`) :
  // la fenêtre ne garde que la rediff et le retrait.
  const played = match.status === "COMPLETED";
  // Sans la permission `live`, le serveur refuse tout réglage (`NOT_CASTER`) :
  // la fenêtre ne garde que le retrait, seule voie qui aboutisse encore.
  const settable = controls.canManage;
  const streamEditable = cast !== null && !cast.staffStream && !played;
  const urlRefused = streamEditable && castUrlInvalid(url);
  const urlChanged = cast !== null && url.trim() !== (cast.liveUrl ?? "");
  // Le lien n'est exigé que s'il est touché : un stream ouvert sans lien avant
  // qu'il soit obligatoire garde son BattleTag réglable.
  const urlMissing = streamEditable && urlChanged && url.trim() === "";
  const battletagRefused = castBattletagInvalid(battletag);
  const battletagChanged = cast !== null && !played && battletag.trim() !== (cast.battletag ?? "");
  const triggerChanged = configurable && !triggerLocked && pickedTrigger !== null && pickedTrigger !== match.liveTrigger;
  // « Enregistrer » sans rien de changé n'a rien à dire : il reste désarmé.
  const dirty = triggerChanged || (streamEditable && urlChanged) || battletagChanged;
  // Seul un mode choisi ici s'envoie : celui du match, même sans sa date, ne
  // bloque pas l'enregistrement d'un lien ou d'un BattleTag.
  const triggerRefused =
    configurable &&
    !triggerLocked &&
    pickedTrigger !== null &&
    pickedTrigger !== match.liveTrigger &&
    castTriggerNeedsDate(trigger, match.startAt);
  // La rediff garde sa fenêtre (`MatchReplayDialog`), celle du staff de
  // diffusion : une seule définition du lien YouTube et de ses refus.
  const replayable = canEditReplay(match, true);
  // L'état d'antenne se dérive, et se rafraîchit comme sur la carte.
  const onAir = useMatchLiveState(match) === "LIVE";
  const blocked = !dirty || urlRefused || urlMissing || battletagRefused || triggerRefused;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (blocked || cast === null) return;
    setBusy(true);
    try {
      // Un seul envoi pour le cast ; la rediff a sa route (celle du staff de
      // diffusion), et n'est envoyée que si elle a changé.
      const settings: Record<string, unknown> = {};
      // Le mode vu part avec le mode choisi : changé entre-temps, le serveur
      // refuse (`LIVE_TRIGGER_CHANGED`) plutôt que d'écraser ce qu'il ignore.
      if (triggerChanged) {
        settings.trigger = pickedTrigger;
        settings.expectedTrigger = match.liveTrigger;
      }
      if (streamEditable && urlChanged) {
        settings.liveUrl = url.trim() === "" ? null : url.trim();
      }
      if (battletagChanged) settings.battletag = battletag.trim() === "" ? null : battletag.trim();
      await requestJson(`/api/matches/${match.id}/caster`, { method: "PUT", body: settings }, "MATCH_CAST_SETTINGS_FAILED");
      showSuccess(t("cardActions.castSettings.saved"));
      onSaved();
      onClose();
    } catch (error) {
      const code = (error as Error).message;
      const message = fail(code);
      fieldErrors.report(code, message);
      showError(message);
    } finally {
      setBusy(false);
    }
  };

  const toggleAir = useOnAirToggle(match.id, onAir, { setBusy, onDone: onSaved });

  // Se retirer rend la place (le serveur retire aussi le stream et son lien) :
  // geste sans retour, il passe par une confirmation (`ConfirmActionDialog`).
  // Rend `true` s'il a abouti : la confirmation et la fenêtre se ferment.
  const release = async (): Promise<boolean> => {
    setBusy(true);
    try {
      await requestJson(`/api/matches/${match.id}/caster`, { method: "DELETE" }, "MATCH_CAST_RELEASE_FAILED");
      showSuccess(t("cardActions.notCasting"));
      onReleased?.();
      onSaved();
      onClose();
      return true;
    } catch (error) {
      showError(fail((error as Error).message));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <TournamentDialogFrame titleId={titleId} maxWidth={470} zIndex={80} busy={busy} onClose={onClose}>
      <form onSubmit={submit}>
        <h3 id={titleId} className={styles.title}>
          {t("cardActions.castSettings.title")}
        </h3>
        <p className={styles.subtitle}>{matchLabel}</p>

        {cast === null && (
          <output className={styles.loading} aria-busy="true">
            {t("cardActions.castSettings.loading")}
          </output>
        )}

        {cast !== null && played && (
          <InfoHintRow inline>
            <p className={styles.subtitle}>{t("cardActions.castSettings.playedTitle")}</p>
            <InfoHint id={`${titleId}-played`} subject={t("cardActions.castSettings.playedTitle")}>
              <p>{t("cardActions.castSettings.played")}</p>
            </InfoHint>
          </InfoHintRow>
        )}

        {cast !== null && !settable && (
          <InfoHintRow inline>
            <p className={styles.subtitle}>{t("cardActions.castSettings.noLiveTitle")}</p>
            <InfoHint id={`${titleId}-no-live`} subject={t("cardActions.castSettings.noLiveTitle")}>
              <p>{t("cardActions.castSettings.noLive")}</p>
            </InfoHint>
          </InfoHintRow>
        )}

        {cast !== null && settable && (
          <>
            {!played && (
              <CastUrlField
                id={urlId}
                value={url}
                onChange={(next) => {
                  setUrl(next);
                  fieldErrors.clear("url");
                }}
                required={streamEditable}
                missing={urlMissing}
                invalid={urlRefused || fieldErrors.invalidField === "url"}
                fieldError={fieldErrors.message("url")}
                readOnlyNote={cast.staffStream ? t("cardActions.castSettings.urlStaff") : undefined}
              />
            )}

            {configurable && (
              <CastTriggerField
                // Match démarqué : aucun mode coché, chaque choix se clique.
                trigger={triggerLocked ? lockedTrigger(true, match.liveTrigger, trigger) : (pickedTrigger ?? match.liveTrigger)}
                startAt={match.startAt}
                onChange={setTrigger}
                locked={triggerLocked}
              />
            )}

            {/* L'antenne d'un mode manuel suit la règle du mode (décision 2) : un
                co-caster ne l'ouvre ni ne la coupe pour le caster qui l'a posé. */}
            {canToggleOnAir(match) && !triggerLocked && (
              <div className={styles.section}>
                <InfoHintRow>
                  <p className={styles.sectionTitle}>{t("cardActions.castSettings.air")}</p>
                  <InfoHint id={`${titleId}-air`} subject={t("cardActions.castSettings.air")}>
                    <p>{t("cardActions.castSettings.airHint")}</p>
                  </InfoHint>
                </InfoHintRow>
                <button
                  type="button"
                  className={onAir ? "btn ghost" : "btn"}
                  disabled={busy}
                  onClick={() => void toggleAir()}
                >
                  {onAir ? t("cardActions.stopLive") : t("cardActions.startLive")}
                </button>
              </div>
            )}

            {!played && game !== null && battletagRelevantFor(game) && (
              <CastBattletagField
                id={battletagId}
                value={battletag}
                onChange={(next) => {
                  setBattletag(next);
                  fieldErrors.clear("battletag");
                }}
                invalid={battletagRefused || fieldErrors.invalidField === "battletag"}
                fieldError={fieldErrors.message("battletag")}
              />
            )}

            {replayable && (
              <div className={styles.section}>
                <InfoHintRow>
                  <p className={styles.sectionTitle}>{t("cardActions.castSettings.replay")}</p>
                  <InfoHint id={`${titleId}-replay`} subject={t("cardActions.castSettings.replay")}>
                    <p>{t("cardActions.castSettings.replayHint")}</p>
                  </InfoHint>
                </InfoHintRow>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => {
                    // La fenêtre de rediff est une autre modale : celle-ci se
                    // ferme d'abord, les deux ne se disputent pas le focus.
                    onClose();
                    openReplay(match);
                  }}
                >
                  {match.replayUrl === null ? t("cardActions.addReplay") : t("cardActions.editReplay")}
                </button>
              </div>
            )}
          </>
        )}

        <div className={styles.footer}>
          {cast !== null && offersCastRelease(match) && (
            <button
              type="button"
              className={`btn ghost ${styles.button}`}
              disabled={busy}
              onClick={() => setConfirmRelease(true)}
            >
              {t("cardActions.stopCasting")}
            </button>
          )}
          <div className={styles.actions}>
            <button type="button" className={`btn ghost ${styles.button}`} onClick={onClose} disabled={busy}>
              {played ? t("cardActions.castSettings.close") : t("cardActions.castSettings.cancel")}
            </button>
            {/* Un match joué ne prend plus ni lien, ni mode, ni BattleTag : rien à enregistrer. */}
            {!played && settable && (
              <button type="submit" className={`btn ${styles.button}`} disabled={busy || blocked || cast === null}>
                {busy ? t("cardActions.castSettings.saving") : t("cardActions.castSettings.save")}
              </button>
            )}
          </div>
        </div>
      </form>
      {confirmRelease && (
        <ConfirmActionDialog
          title={t("cardActions.releaseConfirm.selfTitle", { match: matchLabel })}
          confirmLabel={t("cardActions.releaseConfirm.selfConfirm")}
          pendingLabel={t("cardActions.releaseConfirm.pending")}
          onClose={() => setConfirmRelease(false)}
          onConfirm={release}
        >
          <p>{t("cardActions.releaseConfirm.selfBody")}</p>
        </ConfirmActionDialog>
      )}
    </TournamentDialogFrame>
  );
}
