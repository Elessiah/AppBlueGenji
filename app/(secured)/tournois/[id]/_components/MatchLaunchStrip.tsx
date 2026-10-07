"use client";

import { readyCount, type MatchLaunchPhase } from "@/lib/shared/match-launch";
import { formatMatchStartAtFull } from "@/lib/shared/match-schedule";
import type { BracketMatch } from "@/lib/shared/types";
import { hostTeamName } from "../_lib/launch-strip";
import styles from "./MatchLaunchStrip.module.css";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";

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
  // Libellés de `LAUNCH_PHASE_LABELS` (`match-planning.ts`, français égal testé).
  const { t, locale } = useTournamentPageText();
  if (phase === "TO_PLAN") {
    return (
      <span className={styles.toPlan} title={t("launch.toPlanTitle")}>
        <span aria-hidden="true">📅</span> {t("launch.toPlan")}
        <span className="sr-only">{t("launch.toPlanSr")}</span>
      </span>
    );
  }
  if (phase === "SCHEDULED") {
    const startAtTitle = formatMatchStartAtFull(match.startAt, locale);
    return (
      <span className={styles.scheduled} title={startAtTitle ?? undefined}>
        <span aria-hidden="true">⏱</span> {t("launch.scheduled")}
        {/* L'heure est déjà dans le bandeau d'horaire juste au-dessus : on ne
            la répète que pour les lecteurs d'écran, qui lisent ce libellé
            seul. */}
        {startAtTitle && <span className="sr-only">{t("launch.scheduledSr", { date: startAtTitle })}</span>}
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
        <span aria-hidden="true">⏳</span> {t("launch.lobby")} ·{" "}
        <span className="num">
          {count.ready}/{count.expected}
        </span>{" "}
        {t("launch.ready")}
      </span>
    );
  }
  if (phase === "LAUNCHED" && match.status === "READY") {
    return (
      <span className={styles.launched}>
        <span aria-hidden="true">▶</span> {t("launch.launched")}
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
  const { t } = useTournamentPageText();
  const showHost = phase !== "NONE";
  const hostName = hostTeamName(match);
  const badge = <LaunchPhaseBadge match={match} phase={phase} />;
  const hasBadge = phase === "TO_PLAN" || phase === "SCHEDULED" || phase === "LOBBY" || (phase === "LAUNCHED" && match.status === "READY");

  if (!hasBadge && !(showHost && hostName) && match.casterUserId === null) return null;

  return (
    <div className={styles.strip} data-phase={phase}>
      {badge}

      {showHost && hostName && (
        <span className={styles.fact} title={t("launch.hostTitle")}>
          <span aria-hidden="true">🏠</span>
          <span className="sr-only">{t("launch.hostSr")}</span>
          <span className={styles.name}>{hostName}</span>
        </span>
      )}

      {match.casterUserId !== null && (
        <span className={styles.fact} title={t("launch.casterTitle")}>
          <span aria-hidden="true">🎙</span>
          <span className="sr-only">{t("launch.casterSr")}</span>
          <span className={styles.name}>{match.casterPseudo ?? t("launch.caster")}</span>
          {phase === "LOBBY" && (
            <span className={match.casterReady ? styles.ok : styles.wait}>
              {match.casterReady ? t("launch.casterReady") : t("launch.casterWaiting")}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
