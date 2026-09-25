"use client";

import Link from "next/link";
import { matchFormatLabel } from "@/lib/shared/match-format";
import { participantWording } from "@/lib/shared/participants";
import { formatLabel, gameLabel } from "@/lib/shared/tournament-labels";
import type { TournamentCard } from "@/lib/shared/types";
import { TournamentImageBanner, TournamentImageEmblem } from "@/components/tournament-image";
import { formatCardDate, progressPercent, runningCardAction } from "../_lib/card-display";
import { CARD_IMAGE_SIZES } from "./card-image";
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
export function RunningCard({ t, priority }: RunningCardProps) {
  const wording = participantWording(t.participantType);
  const percent = progressPercent(t.runningProgress);

  return (
    <Link href={`/tournois/${t.id}`} style={{ textDecoration: "none" }}>
      <article className={s.card} data-state="running">
        <TournamentImageBanner
          image={t.image}
          sizes={CARD_IMAGE_SIZES}
          className={s.cardBanner}
          priority={priority}
        />
        <div className={`${s.cardRibbon} ${s.cardRibbonRunning}`}>
          <span className={s.dot} />
          En cours
        </div>

        <div className={s.cardHead}>
          <div className={s.cardGame}>
            {gameLabel(t.game)}
            <span className={s.dot}>◆</span>
            {formatLabel(t.format)}
          </div>
          <TournamentImageEmblem image={t.image} size={40} />
        </div>

        <h3 className={s.cardTitle}>{t.name}</h3>
        {t.description ? <div className={s.cardSub}>{t.description}</div> : null}

        <div className={s.cardMeta}>
          <div>
            <div className={s.cardMetaLbl}>Début</div>
            <div className={s.cardMetaVal}>{formatCardDate(t.startAt, true)}</div>
          </div>
          <div>
            <div className={s.cardMetaLbl}>{wording.manyParticipating}</div>
            <div className={`${s.cardMetaVal} ${s.num}`}>{t.registeredTeams}</div>
          </div>
          <div>
            <div className={s.cardMetaLbl}>Matchs</div>
            <div className={s.cardMetaVal}>{matchFormatLabel(t.matchFormat)}</div>
          </div>
        </div>

        {percent !== null ? (
          <div className={s.progress}>
            <div className={s.progressBar} style={{ width: `${percent}%` }} />
          </div>
        ) : null}

        <div className={s.cardFoot}>
          <div>
            <div className={s.cardFootLbl}>Déroulement</div>
            <div className={`${s.cardFootVal} ${s.num}`}>
              {percent !== null ? `${percent} %` : "—"}
            </div>
          </div>
          <span className={s.cardCta}>{runningCardAction(t.format)}</span>
        </div>
      </article>
    </Link>
  );
}
