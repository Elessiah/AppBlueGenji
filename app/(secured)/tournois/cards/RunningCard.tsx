"use client";

import { useTournamentsText } from "@/components/i18n/tournaments-text";
import { localizedMatchFormatLabel, participantLabel } from "@/lib/shared/tournaments-text";
import type { TournamentCard } from "@/lib/shared/types";
import { formatCardDate, progressPercent, runningCardAction } from "../_lib/card-display";
import { CardMetaItem, CardProgress, LiveRibbon, TournamentCardFrame } from "./CardParts";
import s from "../tournois.module.css";

interface RunningCardProps {
  t: TournamentCard;
  /** Bandeau chargé en priorité : premières cartes illustrées de la page (`priorityBannerIds`). */
  priority?: boolean;
}

/**
 * Carte d'un tournoi en cours. L'état se dit **une** fois, au ruban, et en
 * bleu : le rouge est réservé à ce qui est réellement à l'antenne, et un
 * tournoi en cours n'est pas une diffusion. La place ainsi rendue sert à dire
 * où en est le tournoi (`runningProgress`).
 */
export function RunningCard({ t, priority }: Readonly<RunningCardProps>) {
  const text = useTournamentsText();
  const percent = progressPercent(t.runningProgress);

  return (
    <TournamentCardFrame
      t={t}
      priority={priority}
      state="running"
      ribbonClassName={s.cardRibbonRunning}
      ribbon={<LiveRibbon label={text.t("cards.running")} />}
    >
      <div className={s.cardMeta}>
        <CardMetaItem label={text.t("cards.start")}>{formatCardDate(t.startAt, true, text.locale)}</CardMetaItem>
        <CardMetaItem
          label={participantLabel(text, t.participantType, "manyParticipating")}
          valueClassName={`${s.cardMetaVal} ${s.num}`}
        >
          {t.registeredTeams}
        </CardMetaItem>
        <CardMetaItem label={text.t("cards.matches")}>{localizedMatchFormatLabel(text, t.matchFormat)}</CardMetaItem>
      </div>

      {percent !== null ? <CardProgress percent={percent} /> : null}

      <div className={s.cardFoot}>
        <div>
          <div className={s.cardFootLbl}>{text.t("cards.progress")}</div>
          <div className={`${s.cardFootVal} ${s.num}`}>
            {percent !== null ? text.t("cards.percent", { percent: String(percent) }) : "—"}
          </div>
        </div>
        <span className={s.cardCta}>{runningCardAction(t.format, text)}</span>
      </div>
    </TournamentCardFrame>
  );
}
