"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import {
  CAST_IDENTITY_NOTICE,
  launchErrorMessage,
  MATCH_LAUNCH_OPEN_EVENT,
  MATCH_LAUNCH_REFRESH_EVENT,
  readyCount,
  type MatchLaunchPhase,
} from "@/lib/shared/match-launch";
import { formatMatchStartAtFull } from "@/lib/shared/match-schedule";
import { LAUNCH_PHASE_LABELS } from "@/lib/shared/match-planning";
import type { BracketMatch } from "@/lib/shared/types";
import { useLiveControls } from "../_lib/live-context";
import { hasLaunchStripAction, hostTeamName, launchStripControls } from "../_lib/launch-strip";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import styles from "./MatchLaunchStrip.module.css";

async function send(url: string, method: string, body?: unknown): Promise<void> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || "UNKNOWN");
  }
}

/**
 * Bandeau de **lancement** d'un match, sous celui de l'horaire et de la
 * diffusion (`lib/shared/match-launch.ts`).
 *
 * Ce qu'il dit à tous : l'équipe qui héberge la partie, le caster inscrit, et,
 * pendant le lancement, combien de parties sont prêtes. Ce qu'il offre selon le
 * lecteur : aux parties du match, d'ouvrir la modale de lancement (le « Prêt »
 * se donne là, avec sa confirmation) ; à un caster, de s'inscrire ou de se
 * retirer ; à l'arbitrage, de changer d'hôte et de forcer le lancement.
 *
 * Quand le tournoi fait planifier ses matchs par l'arbitrage
 * (`lib/shared/match-planning.ts`), le bandeau dit aussi les deux étapes qui
 * précèdent le lancement : **À planifier** (avec, pour l'arbitrage, le bouton
 * qui ouvre la date) et **En attente de départ** (avec l'heure dite).
 */
/**
 * Pastille de la phase de lancement : à planifier, en attente de départ, en
 * lancement (avec le décompte des « Prêt »), ou lancé.
 */
function LaunchPhaseBadge({ match, phase }: Readonly<{ match: BracketMatch; phase: MatchLaunchPhase }>) {
  if (phase === "TO_PLAN") {
    return (
      <span
        className={styles.toPlan}
        title="L'arbitrage doit fixer la date et l'heure de ce match avant son lancement."
      >
        <span aria-hidden="true">📅</span> {LAUNCH_PHASE_LABELS.TO_PLAN}
        <span className="sr-only"> : l&apos;arbitrage doit fixer la date de ce match.</span>
      </span>
    );
  }
  if (phase === "SCHEDULED") {
    const startAtTitle = formatMatchStartAtFull(match.startAt);
    return (
      <span className={styles.scheduled} title={startAtTitle ?? undefined}>
        <span aria-hidden="true">⏱</span> {LAUNCH_PHASE_LABELS.SCHEDULED}
        {/* L'heure est déjà dans le bandeau d'horaire juste au-dessus : on ne
            la répète que pour les lecteurs d'écran, qui lisent ce libellé
            seul. */}
        {startAtTitle && <span className="sr-only"> — début le {startAtTitle}</span>}
      </span>
    );
  }
  if (phase === "LOBBY") {
    // Les « Prêt » arrivent déjà résolus dans l'instantané (une fantôme y est
    // prête d'office) : on ne fait que les compter.
    const count = readyCount({
      team1Ready: match.team1Ready,
      team2Ready: match.team2Ready,
      casterRequired: match.casterUserId !== null,
      casterReady: match.casterReady,
    });
    return (
      <span className={styles.lobby}>
        <span aria-hidden="true">⏳</span> {LAUNCH_PHASE_LABELS.LOBBY} ·{" "}
        <span className="num">
          {count.ready}/{count.expected}
        </span>{" "}
        prêts
      </span>
    );
  }
  if (phase === "LAUNCHED" && match.status === "READY") {
    return (
      <span className={styles.launched}>
        <span aria-hidden="true">▶</span> {LAUNCH_PHASE_LABELS.LAUNCHED}
      </span>
    );
  }
  return null;
}

export function MatchLaunchStrip({
  match,
  phase,
}: Readonly<{
  match: BracketMatch;
  /**
   * Phase de lancement, calculée **par la carte** (`MatchRow`) et partagée avec
   * le bandeau d'horaire : une seule minuterie par match programmé.
   */
  phase: MatchLaunchPhase;
}>) {
  const { canManage, canSchedule, openSchedule, viewerUserId, myTeamId, castBlock } =
    useLiveControls();
  const { showError, showSuccess } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmForce, setConfirmForce] = useState(false);

  const matchLabel = `${match.team1Name ?? "TBD"} contre ${match.team2Name ?? "TBD"}`;
  const controls = launchStripControls(match, phase, { canManage, canSchedule, viewerUserId, myTeamId });
  const { isCaster, showOpen, showClaim, showRelease, showPlan, showForce, showHost, showHostSwap } =
    controls;
  const hostName = hostTeamName(match);

  if (!showHost && match.casterUserId === null && !showClaim) return null;

  /** Rend `true` si le geste a abouti (la confirmation se ferme alors). */
  const run = async (action: () => Promise<void>, success: string): Promise<boolean> => {
    setBusy(true);
    try {
      await action();
      showSuccess(success);
      window.dispatchEvent(new Event(MATCH_LAUNCH_REFRESH_EVENT));
      return true;
    } catch (error) {
      showError(launchErrorMessage((error as Error).message));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const claim = () => {
    if (castBlock) {
      showError(castBlock === "CASTER_IDENTITY_REQUIRED" ? CAST_IDENTITY_NOTICE : launchErrorMessage(castBlock));
      return;
    }
    void run(() => send(`/api/matches/${match.id}/caster`, "POST"), "Tu castes ce match.");
  };

  const swapHost = () => {
    const next = match.hostTeamId === match.team1Id ? match.team2Id : match.team1Id;
    void run(
      () => send(`/api/admin/matches/${match.id}/host`, "PUT", { teamId: next }),
      "Équipe hôte modifiée.",
    );
  };

  return (
    <div className={styles.strip} data-phase={phase}>
      <LaunchPhaseBadge match={match} phase={phase} />

      {showHost && hostName && (
        <span className={styles.fact} title="Équipe qui crée le salon en jeu">
          <span aria-hidden="true">🏠</span>
          <span className="sr-only">Équipe hôte : </span>
          <span className={styles.name}>{hostName}</span>
        </span>
      )}

      {match.casterUserId !== null && (
        <span className={styles.fact} title="Caster du match">
          <span aria-hidden="true">🎙</span>
          <span className="sr-only">Caster : </span>
          <span className={styles.name}>{match.casterPseudo ?? "Caster"}</span>
          {phase === "LOBBY" && (
            <span className={match.casterReady ? styles.ok : styles.wait}>
              {match.casterReady ? "prêt" : "attendu"}
            </span>
          )}
        </span>
      )}

      {/* Pas de conteneur vide : il porterait seul le `margin-left: auto` et
          une ligne de hauteur nulle sur les cartes sans aucun bouton. */}
      {hasLaunchStripAction(controls) && (
        <span className={styles.actions}>
          {showPlan && (
            <button
              type="button"
              className={`btn tap-target ${styles.small} ${styles.plan}`}
              onClick={() => openSchedule(match)}
              aria-label={`Planifier ${matchLabel}`}
            >
              🗓 Planifier
            </button>
          )}
          {showOpen && (
            <button
              type="button"
              className={`btn tap-target ${styles.primary}`}
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent(MATCH_LAUNCH_OPEN_EVENT, { detail: { matchId: match.id } }),
                )
              }
              aria-label={`Ouvrir le lancement de ${matchLabel}`}
            >
              {phase === "LOBBY" ? "Lancement" : "Infos"}
            </button>
          )}
          {showClaim && (
            <button
              type="button"
              className={`btn tap-target ghost ${styles.small}`}
              disabled={busy}
              aria-disabled={castBlock !== null}
              title={castBlock === "CASTER_IDENTITY_REQUIRED" ? CAST_IDENTITY_NOTICE : undefined}
              onClick={claim}
              aria-label={`Caster ${matchLabel}`}
            >
              🎙 Caster
            </button>
          )}
          {showRelease && (
            <button
              type="button"
              className={`btn tap-target ghost ${styles.small}`}
              disabled={busy}
              onClick={() =>
                void run(
                  () => send(`/api/matches/${match.id}/caster`, "DELETE"),
                  isCaster ? "Tu ne castes plus ce match." : "Caster retiré.",
                )
              }
              aria-label={
                isCaster ? `Ne plus caster ${matchLabel}` : `Retirer le caster de ${matchLabel}`
              }
            >
              {isCaster ? "Ne plus caster" : "Retirer caster"}
            </button>
          )}
          {showHostSwap && (
            <button
              type="button"
              className={`btn tap-target ghost ${styles.small}`}
              disabled={busy}
              onClick={swapHost}
              aria-label={`Changer l'équipe hôte de ${matchLabel}`}
              title="Changer l'équipe hôte"
            >
              ⇄ Hôte
            </button>
          )}
          {showForce && (
            <button
              type="button"
              className={`btn tap-target ${styles.small} ${styles.force}`}
              disabled={busy}
              onClick={() => setConfirmForce(true)}
              aria-label={`Forcer le lancement de ${matchLabel}`}
            >
              ▶ Forcer
            </button>
          )}
        </span>
      )}
      {/* Une modale et non `window.confirm`, comme les autres gestes sans retour
          de la fiche (`ConfirmActionDialog`). Refermée d'elle-même si le
          bouton disparaît (match lancé entre-temps par un autre arbitre). */}
      {confirmForce && showForce && (
        <ConfirmActionDialog
          title={`Forcer le lancement de ${matchLabel} ?`}
          confirmLabel="Lancer le match"
          pendingLabel="Lancement…"
          onClose={() => setConfirmForce(false)}
          onConfirm={() => run(() => send(`/api/admin/matches/${match.id}/launch`, "POST"), "Match lancé.")}
        >
          <p>
            Le match démarre sans attendre les « Prêt » manquants : les engagés peuvent
            reporter leur score dès maintenant.
          </p>
          {phase === "TO_PLAN" && (
            <p>
              Ce match n&apos;est pas encore planifié : il démarre maintenant, sans heure
              annoncée aux engagés.
            </p>
          )}
        </ConfirmActionDialog>
      )}
    </div>
  );
}
