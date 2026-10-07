"use client";

import { useClock } from "@/lib/shared/hooks/useClock";
import { ScrollArea } from "@/components/cyber";
import { computeTournamentProgress } from "@/lib/shared/tournament-progress";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { pageDateTime, type TournamentPageText } from "@/lib/shared/tournament-page-text";
import type { Locale } from "@/lib/shared/locales";
import { SCROLL_REVEAL_ATTRIBUTE } from "@/lib/shared/scroll-reveal";
import type { TournamentDetail } from "@/lib/shared/types";
import { EntrantName } from "./EntrantName";
import styles from "./TournamentProgress.module.css";

interface TournamentProgressProps {
  detail: TournamentDetail;
}

/** Cadence de rafraîchissement : assez fine pour un compte à rebours en minutes. */
const TICK_MS = 30_000;

/** « 28/08 14:30 » — la frise n'a pas la place d'une date complète. */
function shortDateTime(iso: string, locale: Locale): string {
  if (!Number.isFinite(new Date(iso).getTime())) return "";
  return pageDateTime(iso, locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * Délai avant l'étape suivante (`formatStageCountdown`, dans la langue de la
 * page ; le français l'égale, testé). `null` quand l'instant est passé.
 */
export function stageCountdownText(text: TournamentPageText, from: number, to: number): string | null {
  const delay = to - from;
  if (!Number.isFinite(delay) || delay <= 0) return null;
  const minutes = Math.floor(delay / 60_000);
  if (minutes < 1) return text.t("progress.countdown.underMinute");
  const days = String(Math.floor(minutes / 1440));
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days !== "0") {
    return hours > 0
      ? text.t("progress.countdown.daysHours", { days, hours: String(hours) })
      : text.t("progress.countdown.days", { days });
  }
  if (hours > 0) {
    return mins > 0
      ? text.t("progress.countdown.hoursMinutes", { hours: String(hours), minutes: String(mins) })
      : text.t("progress.countdown.hours", { hours: String(hours) });
  }
  return text.t("progress.countdown.minutes", { minutes: String(mins) });
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
export function TournamentProgress({ detail }: Readonly<TournamentProgressProps>) {
  // Un tournoi terminé ne bouge plus : ni jalon à franchir, ni compte à rebours,
  // ni matchs à rejouer. Laisser battre l'horloge y ferait re-parcourir tous les
  // matchs du plateau toutes les 30 s, indéfiniment, pour un affichage figé.
  // L'horloge s'arrête aussi onglet caché (`useClock`, régime de charge).
  const text = useTournamentPageText();
  const { t, locale } = text;
  const isFinished = detail.card.state === "FINISHED";
  const clock = useClock(TICK_MS, !isFinished);
  // Avant le montage, l'instant du rendu : la page est rendue côté client, et
  // la frise ne doit pas passer par un état vide.
  const now = clock ?? Date.now();

  // Avancement déjà mesuré par l'instantané (`computeRunningRatio`, même
  // valeur que la carte de la liste) : le recalculer ici en ferait une seconde
  // source, libre de diverger.
  const progress = computeTournamentProgress(detail.card, {
    now,
    playedRatio: detail.card.runningProgress ?? undefined,
  });

  const currentStage = progress.stages[progress.currentIndex];
  // `progress` peut conclure « terminé » là où l'état stocké dit encore autre
  // chose ; c'est lui qui décide de l'affichage, l'état ne pilote que l'horloge.
  const showsFinished = progress.current === "FINISHED";
  const percent = Math.round(progress.ratio * 100);
  const countdown = progress.next?.at
    ? stageCountdownText(text, now, new Date(progress.next.at).getTime())
    : null;
  const stageLabel = (key: string) => t(`progress.stages.${key as typeof currentStage.key}.label`);
  const stageHint = (key: string) => t(`progress.stages.${key as typeof currentStage.key}.hint`);

  const lastIndex = progress.stages.length - 1;

  // Le champion nomme mieux la fin qu'une paraphrase de l'étape courante, déjà
  // écrite en tête du bloc. Celui de la carte (`pickChampion`) : l'unique
  // premier — nommer l'un de deux ex æquo serait choisir à la place du
  // classement, et la liste des tournois ne le fait pas.
  const champion = showsFinished ? detail.card.champion : null;
  const finishedFoot = champion ? (
    <>
      <span>{t("progress.winner")}</span>
      <EntrantName teamId={champion.teamId} name={champion.name} textClassName={styles.footStrong} />
    </>
  ) : (
    <span>{t("progress.closed")}</span>
  );
  const upcomingFoot = progress.next?.at ? (
    <>
      <span>{t("progress.next")}</span>
      <span className={styles.footStrong}>{stageLabel(progress.next.key)}</span>
      <span>· {shortDateTime(progress.next.at, locale)}</span>
      {countdown && <span>· {countdown}</span>}
    </>
  ) : (
    // Reste le seul jalon sans horaire annoncé : la fin, qui dépend du
    // dernier match joué.
    <span>{t("progress.willClose")}</span>
  );

  return (
    <div className="ds-block">
      <div className="ds-section-title green">
        <h2>{t("progress.title")}</h2>
      </div>

      <div className={styles.head}>
        <div className={styles.headStage}>
          <span className={styles.headLabel}>{stageLabel(currentStage.key)}</span>
          <span className={styles.headHint}>{stageHint(currentStage.key)}</span>
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
        ariaLabel={t("progress.railLabel")}
        // La frise (780 px) s'ouvrait sur son début : sur mobile, l'étape
        // courante était hors champ. Elle défile jusqu'à elle au montage, puis
        // à chaque changement d'étape — jamais entre deux.
        revealKey={progress.current}
      >
        <div className={styles.rail}>
          <div className={styles.trackWrap}>
            {/*
              `progressbar` est un rôle à enfants présentationnels : posé sur le
              conteneur, il rendrait muets les six jalons et leurs dates. Il ne
              porte donc que la piste, qui n'a pas d'enfant.
            */}
            <div /* NOSONAR S6819 — piste stylée sans enfant ; `<progress>` ne se stylise pas pareil */
              className={styles.track}
              role="progressbar"
              aria-label={t("progress.barLabel")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-valuetext={`${stageLabel(currentStage.key)} — ${percent}%`}
            />
            <div
              className={showsFinished ? styles.fill : `${styles.fill} ${styles.fillLive}`}
              style={{ width: `${percent}%` }}
            />

            <ol className={styles.nodes} aria-label={t("progress.stepsLabel")}>
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
                  <li
                    key={stage.key}
                    className={styles.node}
                    style={{ left: `${(index / lastIndex) * 100}%` }}
                    aria-current={stage.status === "CURRENT" ? "step" : undefined}
                    {...(stage.status === "CURRENT" ? { [SCROLL_REVEAL_ATTRIBUTE]: "" } : {})}
                    title={stageHint(stage.key)}
                  >
                    <span className={dotClass} aria-hidden="true" />
                    <span className={styles.caption}>
                      <span className={labelClass}>{stageLabel(stage.key)}</span>
                      {stage.at && (
                        <span className={styles.captionDate}>{shortDateTime(stage.at, locale)}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
          <div className={styles.railSpacer} />
        </div>
      </ScrollArea>

      <p className={styles.foot}>
        {showsFinished ? finishedFoot : upcomingFoot}
      </p>
    </div>
  );
}
