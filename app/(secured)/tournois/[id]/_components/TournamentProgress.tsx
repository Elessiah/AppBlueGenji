"use client";

import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/cyber";
import {
  computeRunningRatio,
  computeTournamentProgress,
  formatStageCountdown,
} from "@/lib/shared/tournament-progress";
import type { TournamentDetail } from "@/lib/shared/types";
import styles from "./TournamentProgress.module.css";

interface TournamentProgressProps {
  detail: TournamentDetail;
}

/** Cadence de rafraîchissement : assez fine pour un compte à rebours en minutes. */
const TICK_MS = 30_000;

/** « 28/08 14:30 » — la frise n'a pas la place d'une date complète. */
function shortDateTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Frise du cycle de vie d'un tournoi, de « masqué » à « terminé ».
 *
 * Elle répond à une question que ni l'état ni les dates prises isolément ne
 * tranchent d'un coup d'œil : où en est-on, et qu'attend-on ensuite. Le calcul
 * est entièrement délégué à `lib/shared/tournament-progress` ; ce composant ne
 * fait que peindre, et redémarrer une horloge pour que la barre avance sans
 * qu'on recharge la page.
 */
export function TournamentProgress({ detail }: TournamentProgressProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const playedRatio = computeRunningRatio({
    format: detail.card.format,
    matches: detail.matches,
    swiss: detail.swiss,
    survivalStandings: detail.survival?.standings ?? null,
    enduranceStandings: detail.endurance?.standings ?? null,
    phases: detail.phases,
    currentPhaseId: detail.currentPhaseId,
  });

  const progress = computeTournamentProgress(detail.card, {
    now,
    playedRatio: playedRatio ?? undefined,
  });

  const currentStage = progress.stages[progress.currentIndex];
  const isFinished = progress.current === "FINISHED";
  const percent = Math.round(progress.ratio * 100);
  const countdown = progress.next?.at
    ? formatStageCountdown(now, new Date(progress.next.at).getTime())
    : null;

  const lastIndex = progress.stages.length - 1;

  // Le champion nomme mieux la fin qu'une paraphrase de l'étape courante, déjà
  // écrite en tête du bloc.
  const champion = isFinished
    ? (detail.registrations.find((reg) => reg.finalRank === 1)?.teamName ?? null)
    : null;

  return (
    <div className="ds-block">
      <div className="ds-section-title green">
        <h2>Progression du tournoi</h2>
      </div>

      <div className={styles.head}>
        <div className={styles.headStage}>
          <span className={styles.headLabel}>{currentStage.label}</span>
          <span className={styles.headHint}>{currentStage.hint}</span>
        </div>
        {/* Doublon de l'`aria-valuetext` de la barre : muet au lecteur d'écran. */}
        <span className={styles.percent} aria-hidden="true">
          {percent}%
        </span>
      </div>

      <ScrollArea
        orientation="x"
        subtle
        fade
        ariaLabel="Frise de progression du tournoi — défilement horizontal"
      >
        <div
          className={styles.rail}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={`${currentStage.label} — ${percent}%`}
        >
          <div className={styles.trackWrap}>
            <div className={styles.track} />
            <div
              className={`${styles.fill}${isFinished ? "" : ` ${styles.fillLive}`}`}
              style={{ width: `${percent}%` }}
            />

            {progress.stages.map((stage, index) => {
              const dotClass = [
                styles.dot,
                stage.status === "DONE" && styles.dotDone,
                stage.status === "CURRENT" && styles.dotCurrent,
              ]
                .filter(Boolean)
                .join(" ");

              const labelClass = [
                styles.captionLabel,
                stage.status === "DONE" && styles.captionLabelDone,
                stage.status === "CURRENT" && styles.captionLabelCurrent,
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <div
                  key={stage.key}
                  className={styles.node}
                  style={{ left: `${(index / lastIndex) * 100}%` }}
                  aria-current={stage.status === "CURRENT" ? "step" : undefined}
                  title={stage.hint}
                >
                  <span className={dotClass} />
                  <span className={styles.caption}>
                    <span className={labelClass}>{stage.label}</span>
                    {stage.at && (
                      <span className={styles.captionDate}>{shortDateTime(stage.at)}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          <div className={styles.railSpacer} />
        </div>
      </ScrollArea>

      <p className={styles.foot}>
        {isFinished ? (
          champion ? (
            <>
              <span>Vainqueur :</span>
              <span className={styles.footStrong}>{champion}</span>
            </>
          ) : (
            <span>Le tournoi est clos.</span>
          )
        ) : progress.next?.at ? (
          <>
            <span>Prochaine étape :</span>
            <span className={styles.footStrong}>{progress.next.label}</span>
            <span>· {shortDateTime(progress.next.at)}</span>
            {countdown && <span>· {countdown}</span>}
          </>
        ) : (
          // Reste le seul jalon sans horaire annoncé : la fin, qui dépend du
          // dernier match joué.
          <span>Le tournoi se clôturera une fois tous les matchs joués.</span>
        )}
      </p>
    </div>
  );
}
