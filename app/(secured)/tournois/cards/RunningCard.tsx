"use client";

import { matchFormatLabel } from "@/lib/shared/match-format";
import { participantWording } from "@/lib/shared/participants";
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
  const wording = participantWording(t.participantType);
  const percent = progressPercent(t.runningProgress);

  return (
    <TournamentCardFrame
      t={t}
      priority={priority}
      state="running"
      ribbonClassName={s.cardRibbonRunning}
      ribbon={<LiveRibbon label="En cours" />}
    >
      <div className={s.cardMeta}>
        <CardMetaItem label="Début">{formatCardDate(t.startAt, true)}</CardMetaItem>
        <CardMetaItem label={wording.manyParticipating} valueClassName={`${s.cardMetaVal} ${s.num}`}>
          {t.registeredTeams}
        </CardMetaItem>
        <CardMetaItem label="Matchs">{matchFormatLabel(t.matchFormat)}</CardMetaItem>
      </div>

      {percent !== null ? <CardProgress percent={percent} /> : null}

      <div className={s.cardFoot}>
        <div>
          <div className={s.cardFootLbl}>Déroulement</div>
          <div className={`${s.cardFootVal} ${s.num}`}>
            {percent !== null ? `${percent} %` : "—"}
          </div>
        </div>
        <span className={s.cardCta}>{runningCardAction(t.format)}</span>
      </div>
    </TournamentCardFrame>
  );
}
