"use client";

import { FormEvent, useState } from "react";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { useToast } from "@/components/ui/toast";
import {
  canToggleOnAir,
  isValidStreamUrl,
  LIVE_PLATFORMS,
  MATCH_LIVE_TRIGGERS,
  MAX_STREAM_URL_LENGTH,
  requiresMatchStartAt,
  staffStream,
  type MatchLiveTrigger,
} from "@/lib/shared/live-streams";
import { viewerMayChangeLiveTrigger } from "@/lib/shared/live-trigger-owner";
import { viewerRefereesMatch } from "@/lib/shared/match-referee";
import { canEditReplay } from "@/lib/shared/match-replay";
import { useMatchLiveState } from "@/lib/shared/hooks/useMatchLiveState";
import { useActionsText } from "../_lib/actions-text";
import { useLiveControls } from "../_lib/live-context";
import { formatMatchStartAt } from "@/lib/shared/match-schedule";
import type { BracketMatch } from "@/lib/shared/types";
import { useMapError } from "../_lib/error-map";
import { useDialogsText } from "../_lib/dialogs-text";
import { TournamentDialogFrame } from "./TournamentDialogFrame";

interface MatchLiveDialogProps {
  match: BracketMatch;
  onClose: () => void;
  onSaved: () => void;
  /**
   * Le lecteur parle pour l'organisation (permission `tournaments`) : il dit si
   * le lien est celui de l'organisation ou sa propre chaîne. Sans elle, le lien
   * est toujours le sien.
   */
  canSpeakForOrganisation: boolean;
}

/**
 * Les liens de casters que l'arbitre a **touchés** et qui diffèrent du lien
 * actuel (`undefined` : aucun). Un stream arrivé, ou dont le caster a changé
 * le lien, pendant que la fenêtre est ouverte n'est jamais renvoyé : seule une
 * saisie de l'arbitre devient une modification.
 */
export function casterLinkEdits(
  streams: readonly { id: number; liveUrl: string | null }[],
  typed: Readonly<Record<number, string>>,
): { streamId: number; liveUrl: string | null }[] | undefined {
  const edits = streams
    .filter((stream) => typed[stream.id] !== undefined)
    .map((stream) => ({ streamId: stream.id, liveUrl: typed[stream.id].trim() || null, current: stream.liveUrl }))
    .filter((edit) => edit.liveUrl !== edit.current)
    .map(({ streamId, liveUrl }) => ({ streamId, liveUrl }));
  return edits.length === 0 ? undefined : edits;
}

/**
 * Le mode choisi manque-t-il de la date de début qu'il exige ? Un mode
 * inchangé ne la redemande pas : le serveur l'accepte (date retirée depuis),
 * et les liens restent réglables.
 */
export function changedTriggerNeedsDate(
  current: MatchLiveTrigger | null,
  chosen: MatchLiveTrigger,
  startAtMissing: boolean,
): boolean {
  return chosen !== current && requiresMatchStartAt(chosen) && startAtMissing;
}

/** Les streams des casters d'un match (jamais celui du staff), avec qui les tient. */
function casterStreamsOf(match: BracketMatch): { id: number; liveUrl: string | null; casters: string }[] {
  return match.streams
    .filter((stream) => !stream.staff)
    .map((stream) => ({
      id: stream.id,
      liveUrl: stream.liveUrl,
      casters: match.casters
        .filter((caster) => caster.streamId === stream.id)
        .map((caster) => caster.pseudo)
        .join(", "),
    }));
}

/**
 * Configuration de diffusion d'un match, pour le staff `tournaments` + `live`
 * et pour l'**arbitre désigné** de ce match (médiateur).
 *
 * Un match n'est jamais casté par défaut et n'hérite jamais de la chaîne
 * officielle du tournoi : le lien saisi ici est celui de la chaîne qui montre
 * **ce** match, éventuellement celle d'un streamer indépendant.
 *
 * Le mode d'antenne posé par un caster ne se change ici que par lui, l'arbitre
 * du match ou un admin (`mayChangeLiveTrigger`) : pour les autres il se lit
 * sans se modifier. L'arbitre seul corrige ou efface les liens des casters
 * (`docs/features/CAST_SETTINGS.md` § Médiation de l'arbitre).
 *
 * Voile, cadre et comportement modal : `TournamentDialogFrame`. `busy`
 * verrouille Échap pendant l'envoi : une modale en train d'écrire ne se
 * referme pas.
 */
export function MatchLiveDialog({
  match,
  onClose,
  onSaved,
  canSpeakForOrganisation,
}: Readonly<MatchLiveDialogProps>) {
  const { showError, showSuccess } = useToast();
  const mapError = useMapError();
  const text = useDialogsText();
  const { t } = text;
  // Libellés déjà rédigés pour le pied d'action de la carte (antenne, rediff) :
  // les mêmes mots ici, dans le seul espace qui les porte.
  const actions = useActionsText();
  const { openReplay, viewerUserId, viewerIsAdmin, refereeNames, canSchedule, canManage } = useLiveControls();
  const referee = viewerRefereesMatch(match, refereeNames);
  // Même règle que le serveur (`LIVE_TRIGGER_NOT_OWNED`) : un mode verrouillé
  // se montre sans contrôle, plutôt qu'un bouton qui mène à un refus.
  const triggerLocked = !viewerMayChangeLiveTrigger(match, {
    userId: viewerUserId,
    isAdmin: viewerIsAdmin,
    manages: canSchedule,
    referees: referee,
  });
  const onAir = useMatchLiveState(match) === "LIVE";
  const [streamed, setStreamed] = useState(match.liveTrigger !== null);
  const [trigger, setTrigger] = useState<MatchLiveTrigger>(match.liveTrigger ?? "MANUAL");
  // Le lien du stream du staff, que ce réglage écrit — jamais celui qu'un
  // caster a ouvert (lecture partielle sans streams : le premier lien).
  const [liveUrl, setLiveUrl] = useState(
    (match.streams.length > 0 ? staffStream(match.streams)?.liveUrl : match.liveUrl) ?? "",
  );
  // Fausse par défaut (protection des données dès la conception) : un lien
  // n'est celui de l'organisation — gardé après la suppression du compte de qui
  // le pose — que si ce membre le coche ; rien ne se déduit de ce qu'il caste.
  const [organisationLink, setOrganisationLink] = useState(false);
  // Médiation : les liens des streams des casters, que l'arbitre seul édite.
  const casterStreams = referee ? casterStreamsOf(match) : [];
  // Seules les saisies de l'arbitre ; un champ intouché montre le lien actuel.
  const [casterLinks, setCasterLinks] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  // Mode verrouillé : le champ suit le mode du match, posé par un autre.
  const showUrl = triggerLocked ? match.liveTrigger !== null : streamed;
  const urlTouched = liveUrl.trim().length > 0;
  // Conditionné au champ affiché : décocher la case n'envoie plus l'URL
  // (`liveUrl: null`) et démonte le champ. Sans cette garde, une saisie fautive
  // laissée derrière soi bloquerait le décochage avec un champ devenu invisible.
  const urlInvalid = showUrl && urlTouched && !isValidStreamUrl(liveUrl);
  // Seuls les liens saisis : un lien de caster déjà en base ne bloque pas l'envoi.
  const invalidCasterLink = casterStreams.some((stream) => {
    const value = (casterLinks[stream.id] ?? "").trim();
    return value !== "" && !isValidStreamUrl(value);
  });
  // « À la date de début » n'a pas de frontière à franchir sans date : le
  // serveur refuse ce couple en 409, l'interface le désactive en amont plutôt
  // que de laisser le staff buter dessus. La date se fixe avec la permission
  // `tournaments`, sur le bandeau du match.
  //
  // Conditionné à `streamed` : décocher « ce match est casté » envoie
  // `trigger: null`, que le serveur accepte toujours. Sans cette garde, un match
  // passé en `START_TIME` puis privé de sa date deviendrait indécastable — les
  // radios sont masquées quand la case est décochée, donc `trigger` resterait
  // bloqué sur `START_TIME` et « Enregistrer » sur désactivé.
  const startAtLabel = formatMatchStartAt(match.startAt, text.locale);
  const startAtMissing = startAtLabel === null;
  const triggerNeedsDate = !triggerLocked && streamed && changedTriggerNeedsDate(match.liveTrigger, trigger, startAtMissing);
  const platforms = LIVE_PLATFORMS.join(", ");

  /** Ouvre ou coupe l'antenne (mode manuel), sans quitter la fenêtre. */
  const toggleAir = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/matches/${match.id}/live`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ onAir: !onAir }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "MATCH_LIVE_UPDATE_FAILED");
      showSuccess(onAir ? actions.t("cardActions.airClosed") : actions.t("cardActions.airOpened"));
      onSaved();
    } catch (error) {
      showError(mapError((error as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (urlInvalid || triggerNeedsDate || invalidCasterLink) return;

    // Mode verrouillé : renvoyé tel quel, le serveur n'y voit aucun changement.
    const chosenTrigger = streamed ? trigger : null;
    const sentTrigger = triggerLocked ? match.liveTrigger : chosenTrigger;
    const streamLinks = casterLinkEdits(casterStreams, casterLinks);
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/matches/${match.id}/live`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          trigger: sentTrigger,
          liveUrl: sentTrigger === null ? null : liveUrl.trim() || null,
          ...(canSpeakForOrganisation ? { organisationLink } : {}),
          ...(streamLinks === undefined ? {} : { streamLinks }),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "MATCH_LIVE_UPDATE_FAILED");
      showSuccess(sentTrigger === null ? t("live.removed") : t("live.saved"));
      onSaved();
      onClose();
    } catch (error) {
      showError(mapError((error as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <TournamentDialogFrame
      titleId="match-live-title"
      maxWidth={460}
      zIndex={80}
      busy={busy}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <h3 id="match-live-title" style={{ margin: 0, fontSize: 18, color: "var(--ink)" }}>
          {t("live.title")}
        </h3>
        <p style={{ marginTop: 6, fontSize: 13, color: "var(--ink-quiet, #9aa4b2)" }}>
          {match.team1Name ?? "TBD"} vs {match.team2Name ?? "TBD"}
        </p>

        {triggerLocked && match.liveTrigger !== null ? (
          <InfoHintRow inline>
            <p style={{ margin: "18px 0", fontSize: 14, color: "var(--ink, #e6ebf2)" }}>
              {t("live.triggerLocked", { mode: t(`live.triggers.${match.liveTrigger}`) })}
            </p>
            <InfoHint id="match-live-locked-hint" subject={t("live.trigger")}>
              <p>{t("live.triggerLockedHint")}</p>
            </InfoHint>
          </InfoHintRow>
        ) : (
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              margin: "18px 0",
              fontSize: 14,
              color: "var(--ink, #e6ebf2)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={streamed}
              onChange={(e) => setStreamed(e.target.checked)}
            />
            {/* NOSONAR S6772 — label en flex avec `gap` */}
            {t("live.streamed")}
          </label>
        )}

        {showUrl && (
          <>
            {!triggerLocked && (
              <fieldset style={{ border: "none", padding: 0, margin: "0 0 16px" }}>
                <legend
                  style={{
                    fontSize: 12,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--ink-quiet, #9aa4b2)",
                    padding: 0,
                    marginBottom: 8,
                  }}
                >
                  <InfoHintRow>
                    {t("live.trigger")}
                    <InfoHint id="match-live-trigger-hint" subject={t("live.trigger")}>
                      <p>{t("live.autoStop")}</p>
                      {startAtMissing && <p>{t("live.noStartAt")}</p>}
                    </InfoHint>
                  </InfoHintRow>
                </legend>
                {MATCH_LIVE_TRIGGERS.map((option) => {
                  const disabled = requiresMatchStartAt(option) && startAtMissing;
                  return (
                    <label
                      key={option}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 13,
                        color: disabled ? "var(--ink-quiet, #9aa4b2)" : "var(--ink-soft, #c3ccd8)",
                        marginBottom: 6,
                        cursor: disabled ? "not-allowed" : "pointer",
                      }}
                    >
                      <input
                        type="radio"
                        name="match-live-trigger"
                        value={option}
                        checked={trigger === option}
                        disabled={disabled}
                        onChange={() => setTrigger(option)}
                      />
                      {t(`live.triggers.${option}`)}
                      {requiresMatchStartAt(option) && startAtLabel && ` (${startAtLabel})`}
                    </label>
                  );
                })}
              </fieldset>
            )}

            <div className="field">
              <InfoHintRow>
                <label htmlFor="match-live-url">{t("live.url")}</label>
                <InfoHint id="match-live-url-hint" subject={t("live.urlSubject")}>
                  <p>{t("live.urlHint", { platforms })}</p>
                  {!canSpeakForOrganisation && <p>{t("live.urlOwnChannel")}</p>}
                </InfoHint>
              </InfoHintRow>
              <input
                id="match-live-url"
                value={liveUrl}
                onChange={(e) => setLiveUrl(e.target.value)}
                maxLength={MAX_STREAM_URL_LENGTH}
                placeholder="https://twitch.tv/…"
                aria-invalid={urlInvalid}
                aria-describedby={urlInvalid ? "match-live-url-error match-live-url-hint" : "match-live-url-hint"}
              />
              {urlInvalid && (
                <p id="match-live-url-error" style={{ margin: "6px 0 0", fontSize: 12, color: "var(--danger)" }}>
                  {t("live.urlInvalid", { platforms })}
                </p>
              )}
              {canSpeakForOrganisation && urlTouched && (
                <InfoHintRow inline>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginTop: 10,
                      fontSize: 13,
                      color: "var(--ink-soft, #c3ccd8)",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={organisationLink}
                      onChange={(e) => setOrganisationLink(e.target.checked)}
                    />
                    {t("live.organisationLink")}
                  </label>
                  <InfoHint id="match-live-org-hint" subject={t("live.organisationLinkSubject")}>
                    <p>{t("live.organisationLinkHint")}</p>
                  </InfoHint>
                </InfoHintRow>
              )}
            </div>
          </>
        )}

        {/* Médiation de l'arbitre : les liens des casters, corrigés ou effacés. */}
        {casterStreams.length > 0 && (
          <fieldset style={{ border: "none", padding: 0, margin: "0 0 16px" }}>
            <legend
              style={{
                fontSize: 12,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--ink-quiet, #9aa4b2)",
                padding: 0,
                marginBottom: 8,
              }}
            >
              <InfoHintRow>
                {t("live.casterLinks")}
                <InfoHint id="match-live-caster-links-hint" subject={t("live.casterLinksSubject")}>
                  <p>{t("live.casterLinksHint")}</p>
                </InfoHint>
              </InfoHintRow>
            </legend>
            {casterStreams.map((stream) => {
              const typed = casterLinks[stream.id];
              const value = typed ?? stream.liveUrl ?? "";
              const invalid = typed !== undefined && typed.trim() !== "" && !isValidStreamUrl(typed);
              const inputId = `match-live-caster-link-${stream.id}`;
              return (
                <div className="field" key={stream.id}>
                  <label htmlFor={inputId}>
                    {t("live.casterLink", { casters: stream.casters || t("live.casterLinkNobody") })}
                  </label>
                  <input
                    id={inputId}
                    value={value}
                    onChange={(e) => setCasterLinks((links) => ({ ...links, [stream.id]: e.target.value }))}
                    maxLength={MAX_STREAM_URL_LENGTH}
                    placeholder="https://twitch.tv/…"
                    aria-invalid={invalid}
                    aria-describedby={invalid ? `${inputId}-error` : undefined}
                  />
                  {invalid && (
                    <p id={`${inputId}-error`} style={{ margin: "6px 0 0", fontSize: 12, color: "var(--danger)" }}>
                      {t("live.urlInvalid", { platforms })}
                    </p>
                  )}
                </div>
              );
            })}
          </fieldset>
        )}

        {/* Antenne (mode manuel) et rediff : la carte ne les porte plus. */}
        {canToggleOnAir(match) && (
          <div style={{ margin: "0 0 14px" }}>
            <button
              type="button"
              className={onAir ? "btn ghost" : "btn"}
              disabled={busy}
              style={{ padding: "8px 18px", fontSize: 13 }}
              onClick={() => void toggleAir()}
            >
              {onAir ? actions.t("cardActions.stopLive") : actions.t("cardActions.startLive")}
            </button>
          </div>
        )}
        {canEditReplay(match, canManage) && (
          <div style={{ margin: "0 0 14px" }}>
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              style={{ padding: "8px 18px", fontSize: 13 }}
              onClick={() => {
                // Une autre modale : celle-ci se ferme d'abord, les deux ne se
                // disputent pas le piège de focus.
                onClose();
                openReplay(match);
              }}
            >
              {match.replayUrl === null
                ? actions.t("cardActions.addReplay")
                : actions.t("cardActions.editReplay")}
            </button>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button
            type="button"
            className="btn ghost"
            onClick={onClose}
            disabled={busy}
            style={{ padding: "8px 18px", fontSize: 13 }}
          >
            {t("score.cancel")}
          </button>
          <button
            type="submit"
            className="btn"
            disabled={busy || urlInvalid || triggerNeedsDate || invalidCasterLink}
            style={{ padding: "8px 20px", fontSize: 13 }}
          >
            {busy ? t("schedule.saving") : t("schedule.save")}
          </button>
        </div>
      </form>
    </TournamentDialogFrame>
  );
}
