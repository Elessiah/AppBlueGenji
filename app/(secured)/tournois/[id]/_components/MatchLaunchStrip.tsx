"use client";

import { readyCount, type MatchLaunchPhase } from "@/lib/shared/match-launch";
import { formatMatchStartAtFull } from "@/lib/shared/match-schedule";
import { LAUNCH_PHASE_LABELS } from "@/lib/shared/match-planning";
import type { BracketMatch } from "@/lib/shared/types";
import { hostTeamName } from "../_lib/launch-strip";
import styles from "./MatchLaunchStrip.module.css";

/**
 * Bandeau de **lancement** d'un match (`lib/shared/match-launch.ts`) : ce
 * qu'il dit à tous — la phase (à planifier, en attente de départ, lancement
 * avec le décompte des « Prêt », lancé), l'équipe qui héberge la partie et le
 * caster inscrit.
 *
 * Ses boutons (ouvrir le lancement, planifier, caster, hôte, forcer) vivent
 * dans le pied d'action de la carte (`MatchCardActions`, voir
 * `docs/features/MATCH_CARD_LAYOUT.md`) : rangés avec les autres, une seule
 * action principale reste visible.
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
  /** Phase de lancement, calculée par la carte (`MatchRow`). */
  phase: MatchLaunchPhase;
}>) {
  const showHost = phase !== "NONE";
  const hostName = hostTeamName(match);
  const badge = <LaunchPhaseBadge match={match} phase={phase} />;
  const hasBadge = phase === "TO_PLAN" || phase === "SCHEDULED" || phase === "LOBBY" || (phase === "LAUNCHED" && match.status === "READY");

  if (!hasBadge && !(showHost && hostName) && match.casterUserId === null) return null;

  return (
    <div className={styles.strip} data-phase={phase}>
      {badge}

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
    </div>
  );
}
