"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { useMatchLaunchPhase } from "@/lib/shared/hooks/useMatchLaunchPhase";
import {
  CAST_IDENTITY_NOTICE,
  launchErrorMessage,
  MATCH_LAUNCH_OPEN_EVENT,
  MATCH_LAUNCH_REFRESH_EVENT,
  readyCount,
} from "@/lib/shared/match-launch";
import type { BracketMatch } from "@/lib/shared/types";
import { useLiveControls } from "../_lib/live-context";
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
 */
export function MatchLaunchStrip({ match }: { match: BracketMatch }) {
  const { canManage, canSchedule, viewerUserId, myTeamId, castBlock } = useLiveControls();
  const { showError, showSuccess } = useToast();
  const [busy, setBusy] = useState(false);
  const phase = useMatchLaunchPhase(match);

  const matchLabel = `${match.team1Name ?? "TBD"} contre ${match.team2Name ?? "TBD"}`;
  const isCaster = viewerUserId !== null && match.casterUserId === viewerUserId;
  const isPlayer =
    myTeamId !== null && (match.team1Id === myTeamId || match.team2Id === myTeamId);
  const isParty = isCaster || isPlayer;
  const open = match.status !== "COMPLETED";
  // Inscription comme caster : sur un match à jouer, jamais sur un bye (un
  // engagé connu en face d'une case vide), et jamais par un joueur du match.
  const isByeLike = (match.team1Id === null) !== (match.team2Id === null) && match.status !== "PENDING";
  const castable = open && !isByeLike && !isPlayer;
  const showClaim = canManage && castable && match.casterUserId === null;
  const showRelease = open && match.casterUserId !== null && (isCaster || canSchedule);
  const showForce = canSchedule && (phase === "LOBBY" || phase === "SCHEDULED");
  const showHost = phase !== "NONE";
  const showOpen = isParty && (phase === "LOBBY" || phase === "LAUNCHED");
  const showHostSwap = canSchedule && showHost;
  const hostName =
    match.hostTeamId === null
      ? null
      : match.hostTeamId === match.team1Id
        ? match.team1Name
        : match.team2Name;
  // Les « Prêt » arrivent déjà résolus dans l'instantané (une fantôme y est
  // prête d'office) : on ne fait que les compter.
  const readiness = {
    team1Ready: match.team1Ready,
    team2Ready: match.team2Ready,
    casterRequired: match.casterUserId !== null,
    casterReady: match.casterReady,
  };
  const count = readyCount(readiness);

  if (!showHost && match.casterUserId === null && !showClaim) return null;

  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    try {
      await action();
      showSuccess(success);
      window.dispatchEvent(new Event(MATCH_LAUNCH_REFRESH_EVENT));
    } catch (error) {
      showError(launchErrorMessage((error as Error).message));
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
      {phase === "LOBBY" && (
        <span className={styles.lobby}>
          <span aria-hidden="true">⏳</span> Lancement ·{" "}
          <span className="num">
            {count.ready}/{count.expected}
          </span>{" "}
          prêts
        </span>
      )}
      {phase === "LAUNCHED" && match.status === "READY" && (
        <span className={styles.launched}>
          <span aria-hidden="true">▶</span> Lancé
        </span>
      )}

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
      {(showOpen || showClaim || showRelease || showHostSwap || showForce) && (
        <span className={styles.actions}>
          {showOpen && (
            <button
              type="button"
              className={`btn ${styles.primary}`}
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
              className={`btn ghost ${styles.small}`}
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
              className={`btn ghost ${styles.small}`}
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
              className={`btn ghost ${styles.small}`}
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
              className={`btn ${styles.small} ${styles.force}`}
              disabled={busy}
              onClick={() => {
                if (!window.confirm(`Lancer ${matchLabel} sans attendre les « Prêt » manquants ?`)) return;
                void run(() => send(`/api/admin/matches/${match.id}/launch`, "POST"), "Match lancé.");
              }}
              aria-label={`Forcer le lancement de ${matchLabel}`}
            >
              ▶ Forcer
            </button>
          )}
        </span>
      )}
    </div>
  );
}
