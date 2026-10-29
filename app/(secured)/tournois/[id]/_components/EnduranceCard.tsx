"use client";

import type { BracketMatch, EnduranceMeta } from "@/lib/shared/types";
import { useTournamentViewText } from "@/components/i18n/tournament-page-text";
import { useClock } from "@/lib/shared/hooks/useClock";
import { formatMatchStartAt, formatMatchStartAtFull } from "@/lib/shared/match-schedule";
import { FR_VIEWS_TEXT } from "../_lib/views-text";
import { useEntrantParticipantType } from "../_lib/entrant-link";
import {
  enduranceCurrentRound,
  enduranceLastClosedRound,
  endurancePlayoffProgress,
  hasScheduledPendingMatch,
  nextScheduledMatch,
  pendingEntrantCount,
} from "../_lib/endurance-ranking-views";
import { PLAYOFF_ROUND_OFFSET } from "../_lib/endurance-sections";
import { EntrantName } from "./EntrantName";
import styles from "./EnduranceCard.module.css";

/** Relecture de l'heure pour « Prochain match » : une minute suffit. */
const NEXT_MATCH_CLOCK_MS = 60_000;

/**
 * En-tête du plateau « BlueGenji Survie » et bandeau de la manche en cours
 * (`docs/features/ENDURANCE_RANKING_VIEWS.md`) : ce qui bouge, d'un coup d'œil
 * — la manche, son avancement, qui doit encore jouer, et la prochaine
 * rencontre programmée.
 */
export function EnduranceCard({
  endurance,
  matches,
  isFinished,
}: Readonly<{ endurance: EnduranceMeta; matches: BracketMatch[]; isFinished: boolean }>) {
  const text = useTournamentViewText(FR_VIEWS_TEXT);
  const { t } = text;
  const participantType = useEntrantParticipantType();
  const solo = participantType === "SOLO";
  const activeCount = endurance.standings.filter((s) => s.status === "ACTIVE").length;
  const current = endurance.playoffsStarted || isFinished ? null : enduranceCurrentRound(matches);
  // `null` avant le montage : l'heure du serveur n'est pas celle du lecteur.
  // L'horloge ne tourne que si un match non joué de la manche porte une date :
  // sans date, « Prochain match » reste vide et chaque battement ne servirait à rien.
  const now = useClock(NEXT_MATCH_CLOCK_MS, current !== null && hasScheduledPendingMatch(matches, current.round));
  const next = current !== null && now !== null ? nextScheduledMatch(matches, current.round, now) : null;

  // Play-offs : le bandeau dit l'avancement de l'arbre à la place.
  const playoffs = matches.filter((match) => match.roundNumber >= PLAYOFF_ROUND_OFFSET);
  const showPlayoffs = current === null && endurance.playoffsStarted && playoffs.length > 0 && !isFinished;

  const progress = current ?? (showPlayoffs ? endurancePlayoffProgress(playoffs) : null);

  // Entre deux manches, avant le lancement des play-offs : la manche vient de
  // se clore et la suivante n'est pas encore tirée. Sans mot, le bandeau
  // disparaissait et plus rien ne disait où en était le tournoi.
  const closedRound = current === null && !endurance.playoffsStarted && !isFinished ? enduranceLastClosedRound(matches) : null;
  const lastRoundPlayed = endurance.maxRounds !== null && closedRound !== null && closedRound >= endurance.maxRounds;
  return (
    <>
      <div className={styles.head}>
        {/* Le titre « Endurance et manches » est celui du bloc du plateau
            (`TournamentSheet`) : l'en-tête n'en porte pas un second. */}
        <div>
          {/*
            Le barème se compte map par map : « par victoire » laissait lire un
            point par match gagné, alors qu'un 3-0 en déplace trois — et c'est ce
            même compte qui chiffre un forfait.
          */}
          <p className={`mono ${styles.rules}`}>
            {t("endurance.summary", {
              start: String(endurance.startPoints),
              win: String(endurance.winDelta),
              loss: String(endurance.lossDelta),
              forfeit: String(endurance.forfeitMaps),
            })}
            {/* Le séparateur ne suit le barème que s'il annonce quelque chose :
                hors play-offs, la ligne finissait sur un « · » orphelin. */}
            {endurance.playoffsStarted && ` · ${t("endurance.playoffsAt", { size: String(endurance.playoffSize) })}`}
          </p>
        </div>
        {!endurance.playoffsStarted && (
          <span className={`mono ${styles.contention}`}>
            {t(solo ? "endurance.inContentionSolo" : "endurance.inContentionTeam", {
              count: activeCount,
              size: String(endurance.playoffSize),
            })}
          </span>
        )}
      </div>

      {progress !== null && (
        <section className={styles.strip} aria-label={t(current ? "endurance.stripCurrent" : "endurance.stripPlayoffs")}>
          <div className={styles.stripRound}>
            <span className={`mono ${styles.stripLabel}`}>
              {t(current ? "endurance.stripCurrent" : "endurance.stripPlayoffs")}
            </span>
            {current && (
              <span className={styles.stripNumber}>
                {current.round}
                {endurance.maxRounds !== null && <span className={styles.stripMax}> / {endurance.maxRounds}</span>}
              </span>
            )}
          </div>
          <div className={styles.stripProgress}>
            <div className={styles.stripCounts}>
              <span>{t("endurance.stripPlayed", { played: progress.played, total: String(progress.total) })}</span>
              {current && (
                <span>
                  {t(solo ? "endurance.stripPendingSolo" : "endurance.stripPendingTeam", {
                    count: pendingEntrantCount(matches, current.round),
                  })}
                </span>
              )}
            </div>
            {/* Balise native plutôt qu'un `role="progressbar"` (S6819). */}
            <progress
              className={styles.bar}
              aria-label={t(current ? "endurance.stripProgress" : "endurance.stripProgressPlayoffs")}
              max={Math.max(progress.total, 1)}
              value={progress.played}
            />
          </div>
          {next && (
            <div className={styles.stripNext}>
              <span className={`mono ${styles.stripLabel}`}>{t("endurance.stripNext")}</span>
              <time dateTime={next.startAt ?? undefined} title={formatMatchStartAtFull(next.startAt, text.locale) ?? undefined}>
                {formatMatchStartAt(next.startAt, text.locale)}
              </time>
              <span className={styles.stripVersus}>
                <EntrantName teamId={next.team1Id} name={next.team1Name} truncate />
                <span className={styles.vs}>{t("endurance.versus")}</span>
                <EntrantName teamId={next.team2Id} name={next.team2Name} truncate />
              </span>
            </div>
          )}
        </section>
      )}

      {progress === null && closedRound !== null && (
        <section className={`${styles.strip} ${styles.stripBetween}`} aria-label={t("endurance.stripDone", { round: String(closedRound) })}>
          <span className={`mono ${styles.stripLabel}`}>{t("endurance.stripDone", { round: String(closedRound) })}</span>
          <span className={styles.stripSoon}>{t(lastRoundPlayed ? "endurance.stripPlayoffsSoon" : "endurance.stripSoon")}</span>
        </section>
      )}
    </>
  );
}
