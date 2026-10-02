"use client";

import { matchFormatLabel } from "@/lib/shared/match-format";
import { participantWording } from "@/lib/shared/participants";
import type { TournamentCard } from "@/lib/shared/types";
import { formatCardDate, registrationFill, upcomingCardFace } from "../_lib/card-display";
import { CardMetaItem, CardProgress, TournamentCardFrame } from "./CardParts";
import s from "../tournois.module.css";

interface UpcomingCardProps {
  t: TournamentCard;
  /** Bandeau chargé en priorité : premières cartes illustrées de la page (`priorityBannerIds`). */
  priority?: boolean;
}

/**
 * Carte d'un tournoi à venir — qui peut l'être de deux façons
 * (`upcomingCardFace`) : inscriptions **pas encore ouvertes**, ou **déjà
 * closes** en attente du coup d'envoi. La seconde recevait la carte de la
 * première, « Inscriptions bientôt » sous une date d'ouverture passée.
 *
 * `Date.now()` au rendu suffit : une carte ne change de visage qu'en changeant
 * de section, bascule que `useScheduledBuckets` fait déjà à la seconde dite.
 */
export function UpcomingCard({ t, priority }: Readonly<UpcomingCardProps>) {
  const wording = participantWording(t.participantType);
  const fill = registrationFill(t);
  const locked = upcomingCardFace(t, Date.now()) === "LOCKED";

  return (
    <TournamentCardFrame
      t={t}
      priority={priority}
      state="soon"
      ribbonClassName={s.cardRibbonSoon}
      ribbon={locked ? "Inscriptions closes" : "À venir"}
    >
      <div className={s.cardMeta}>
        <CardMetaItem label="Début">{formatCardDate(t.startAt, true)}</CardMetaItem>
        {locked ? (
          <CardMetaItem label="Inscriptions closes le">
            {formatCardDate(t.registrationCloseAt, true)}
          </CardMetaItem>
        ) : (
          <CardMetaItem label="Ouverture inscriptions">
            {formatCardDate(t.registrationOpenAt, true)}
          </CardMetaItem>
        )}
        <CardMetaItem label={wording.manyCapitalized} valueClassName={`${s.cardMetaVal} ${s.num}`}>
          {t.registeredTeams}/{t.maxTeams}
        </CardMetaItem>
        <CardMetaItem label="Matchs">{matchFormatLabel(t.matchFormat)}</CardMetaItem>
      </div>

      <CardProgress percent={fill.percent} />

      <div className={s.cardFoot}>
        <div>
          <div className={s.cardFootLbl}>Statut</div>
          <div className={`${s.cardFootVal} ${s.cardFootValSoon}`}>
            {locked ? "En attente du coup d'envoi" : "Inscriptions bientôt"}
          </div>
        </div>
        <span className={`${s.cardCta} ${s.cardCtaMuted}`}>Détails</span>
      </div>
    </TournamentCardFrame>
  );
}
