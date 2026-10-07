"use client";

import { useTournamentsText } from "@/components/i18n/tournaments-text";
import { localizedMatchFormatLabel, participantLabel } from "@/lib/shared/tournaments-text";
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
  const text = useTournamentsText();
  const fill = registrationFill(t);
  const locked = upcomingCardFace(t, Date.now()) === "LOCKED";

  return (
    <TournamentCardFrame
      t={t}
      priority={priority}
      state="soon"
      ribbonClassName={s.cardRibbonSoon}
      ribbon={locked ? text.t("cards.registrationClosed") : text.t("cards.upcoming")}
    >
      <div className={s.cardMeta}>
        <CardMetaItem label={text.t("cards.start")}>{formatCardDate(t.startAt, true, text.locale)}</CardMetaItem>
        {locked ? (
          <CardMetaItem label={text.t("cards.closedOn")}>
            {formatCardDate(t.registrationCloseAt, true, text.locale)}
          </CardMetaItem>
        ) : (
          <CardMetaItem label={text.t("cards.opensOn")}>
            {formatCardDate(t.registrationOpenAt, true, text.locale)}
          </CardMetaItem>
        )}
        <CardMetaItem
          label={participantLabel(text, t.participantType, "manyCapitalized")}
          valueClassName={`${s.cardMetaVal} ${s.num}`}
        >
          {t.registeredTeams}/{t.maxTeams}
        </CardMetaItem>
        <CardMetaItem label={text.t("cards.matches")}>{localizedMatchFormatLabel(text, t.matchFormat)}</CardMetaItem>
      </div>

      <CardProgress percent={fill.percent} />

      <div className={s.cardFoot}>
        <div>
          <div className={s.cardFootLbl}>{text.t("cards.status")}</div>
          <div className={`${s.cardFootVal} ${s.cardFootValSoon}`}>
            {locked ? text.t("cards.awaitingKickoff") : text.t("cards.registrationSoon")}
          </div>
        </div>
        <span className={`${s.cardCta} ${s.cardCtaMuted}`}>{text.t("cards.details")}</span>
      </div>
    </TournamentCardFrame>
  );
}
