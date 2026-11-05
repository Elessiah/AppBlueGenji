"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { useToast } from "@/components/ui/toast";
import { battletagRelevantFor } from "@/lib/shared/certification-prompt";
import { offersCastRelease } from "@/lib/shared/cast-settings";
import { canToggleOnAir, isMatchCastable, type MatchLiveTrigger } from "@/lib/shared/live-streams";
import { viewerMayChangeLiveTrigger } from "@/lib/shared/live-trigger-owner";
import { viewerRefereesMatch } from "@/lib/shared/match-referee";
import { canEditReplay } from "@/lib/shared/match-replay";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { useMatchLiveState } from "@/lib/shared/hooks/useMatchLiveState";
import type { BracketMatch } from "@/lib/shared/types";
import { launchErrorText, useActionsText } from "../_lib/actions-text";
import { useErrorsText } from "../_lib/error-map";
import { useLiveControls } from "../_lib/live-context";
import { useTournamentGame } from "../_lib/match-format-context";
import {
  CastBattletagField,
  CastOrganisationLinkField,
  CastTriggerField,
  CastUrlField,
  castBattletagInvalid,
  castTriggerNeedsDate,
  lockedTrigger,
  castUrlInvalid,
} from "./CastSettingsFields";
import { TournamentDialogFrame } from "./TournamentDialogFrame";
import styles from "./CastSettingsDialog.module.css";

const CAST_FIELD_ERRORS = {
  INVALID_STREAM_URL: "url",
  STREAM_URL_REQUIRED: "url",
  CAST_STREAM_NOT_OWNED: "url",
  INVALID_CAST_BATTLETAG: "battletag",
} as const;

/** Ce que la fenêtre a lu du cast du lecteur (`GET /api/matches/[id]/caster`). */
type OwnCast = { streamId: number; liveUrl: string | null; staffStream: boolean; battletag: string | null };

/** Envoi d'un corps JSON ; le refus porte le code du serveur. */
async function send(url: string, method: "PUT" | "POST", body: unknown, fallback: string): Promise<void> {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error || fallback);
}

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
}: Readonly<{
  match: BracketMatch;
  matchLabel: string;
  onClose: () => void;
  /** Un réglage enregistré : la page relit le match (et la modale de lancement). */
  onSaved: () => void;
}>) {
  const actionText = useActionsText();
  const { t } = actionText;
  const errorsText = useErrorsText();
  const { showError, showSuccess } = useToast();
  const { canSchedule, openReplay, viewerUserId, viewerIsAdmin, refereeNames } = useLiveControls();
  // Le mode posé par un autre caster (ou par le staff) se lit sans se changer
  // (`LIVE_TRIGGER_NOT_OWNED`) : un co-caster ne décide pas pour celui qui l'a posé.
  const triggerLocked = !viewerMayChangeLiveTrigger(match, {
    userId: viewerUserId,
    isAdmin: viewerIsAdmin,
    manages: canSchedule,
    referees: viewerRefereesMatch(match, refereeNames),
  });
  const game = useTournamentGame();
  const titleId = useId();
  const urlId = useId();
  const battletagId = useId();

  const [cast, setCast] = useState<OwnCast | null>(null);
  const [url, setUrl] = useState("");
  const [battletag, setBattletag] = useState("");
  // `null` tant que le caster n'a pas choisi : un match démarqué montre
  // « automatique » sans que l'enregistrement d'un BattleTag le marque casté.
  const [pickedTrigger, setTrigger] = useState<MatchLiveTrigger | null>(null);
  const trigger: MatchLiveTrigger = pickedTrigger ?? match.liveTrigger ?? "AUTO";
  const [organisationLink, setOrganisationLink] = useState(false);
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
        const response = await fetch(`/api/matches/${match.id}/caster`);
        const payload = (await response.json()) as OwnCast & { error?: string };
        if (!response.ok) throw new Error(payload.error || "MATCH_CAST_SETTINGS_FAILED");
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
  const streamEditable = cast !== null && !cast.staffStream;
  const urlRefused = streamEditable && castUrlInvalid(url);
  // L’origine du lien ne s’envoie qu’avec un lien modifié (`submit`) : la case n’est offerte que lui.
  const urlChanged = cast !== null && url.trim() !== (cast.liveUrl ?? "");
  const urlMissing = streamEditable && url.trim() === "";
  const battletagRefused = castBattletagInvalid(battletag);
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
  const blocked = urlRefused || urlMissing || battletagRefused || triggerRefused;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (blocked || cast === null) return;
    setBusy(true);
    try {
      // Un seul envoi pour le cast ; la rediff a sa route (celle du staff de
      // diffusion), et n'est envoyée que si elle a changé.
      const settings: Record<string, unknown> = {};
      if (configurable && !triggerLocked && pickedTrigger !== null && pickedTrigger !== match.liveTrigger) {
        settings.trigger = pickedTrigger;
      }
      if (streamEditable && url.trim() !== (cast.liveUrl ?? "")) {
        settings.liveUrl = url.trim() === "" ? null : url.trim();
        if (canSchedule && organisationLink) settings.organisationLink = true;
      }
      if (battletag.trim() !== (cast.battletag ?? "")) {
        settings.battletag = battletag.trim() === "" ? null : battletag.trim();
      }
      if (Object.keys(settings).length > 0) {
        await send(`/api/matches/${match.id}/caster`, "PUT", settings, "MATCH_CAST_SETTINGS_FAILED");
      }
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

  const toggleAir = async () => {
    setBusy(true);
    try {
      await send(`/api/admin/matches/${match.id}/live`, "POST", { onAir: !onAir }, "MATCH_LIVE_UPDATE_FAILED");
      showSuccess(onAir ? t("cardActions.airClosed") : t("cardActions.airOpened"));
      onSaved();
    } catch (error) {
      showError(fail((error as Error).message));
    } finally {
      setBusy(false);
    }
  };

  // Le caster qui se retire lui-même n'est prévenu de rien (`CAST_NOTICES.md`) :
  // pas de confirmation — ouvrir cette fenêtre puis cliquer est déjà en deux temps.
  const release = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/matches/${match.id}/caster`, { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "MATCH_CAST_RELEASE_FAILED");
      showSuccess(t("cardActions.notCasting"));
      onSaved();
      onClose();
    } catch (error) {
      showError(fail((error as Error).message));
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

        {cast !== null && (
          <>
            <CastUrlField
              id={urlId}
              value={url}
              onChange={(next) => {
                setUrl(next);
                fieldErrors.clear("url");
              }}
              invalid={urlRefused || fieldErrors.invalidField === "url"}
              fieldError={fieldErrors.message("url")}
              readOnlyNote={cast.staffStream ? t("cardActions.castSettings.urlStaff") : undefined}
            />

            {configurable && (
              <>
                <CastTriggerField
                  trigger={lockedTrigger(triggerLocked, match.liveTrigger, trigger)}
                  startAt={match.startAt}
                  onChange={setTrigger}
                  locked={triggerLocked}
                />
                {canSchedule && streamEditable && urlChanged && url.trim() !== "" && (
                  <CastOrganisationLinkField checked={organisationLink} onChange={setOrganisationLink} />
                )}
              </>
            )}

            {canToggleOnAir(match) && (
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

            {game !== null && battletagRelevantFor(game) && (
              <CastBattletagField
                id={battletagId}
                value={battletag}
                onChange={(next) => {
                  setBattletag(next);
                  fieldErrors.clear("battletag");
                }}
                invalid={battletagRefused || fieldErrors.invalidField === "battletag"}
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
              onClick={() => void release()}
            >
              {t("cardActions.stopCasting")}
            </button>
          )}
          <div className={styles.actions}>
            <button type="button" className={`btn ghost ${styles.button}`} onClick={onClose} disabled={busy}>
              {t("cardActions.castSettings.cancel")}
            </button>
            <button type="submit" className={`btn ${styles.button}`} disabled={busy || blocked || cast === null}>
              {busy ? t("cardActions.castSettings.saving") : t("cardActions.castSettings.save")}
            </button>
          </div>
        </div>
      </form>
    </TournamentDialogFrame>
  );
}
