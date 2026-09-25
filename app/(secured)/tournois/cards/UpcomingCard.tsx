"use client";

import Link from "next/link";
import { matchFormatLabel } from "@/lib/shared/match-format";
import { participantWording } from "@/lib/shared/participants";
import { formatLabel, gameLabel } from "@/lib/shared/tournament-labels";
import type { TournamentCard } from "@/lib/shared/types";
import { TournamentImageBanner, TournamentImageEmblem } from "@/components/tournament-image";
import { formatCardDate, registrationFill, upcomingCardFace } from "../_lib/card-display";
import { CARD_IMAGE_SIZES } from "./card-image";
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
export function UpcomingCard({ t, priority }: UpcomingCardProps) {
  const wording = participantWording(t.participantType);
  const fill = registrationFill(t);
  const locked = upcomingCardFace(t, Date.now()) === "LOCKED";

  return (
    <Link href={`/tournois/${t.id}`} style={{ textDecoration: "none" }}>
      <article className={s.card} data-state="soon">
        <TournamentImageBanner
          image={t.image}
          sizes={CARD_IMAGE_SIZES}
          className={s.cardBanner}
          priority={priority}
        />
        <div className={`${s.cardRibbon} ${s.cardRibbonSoon}`}>
          {locked ? "Inscriptions closes" : "À venir"}
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
          {locked ? (
            <div>
              <div className={s.cardMetaLbl}>Inscriptions closes le</div>
              <div className={s.cardMetaVal}>{formatCardDate(t.registrationCloseAt, true)}</div>
            </div>
          ) : (
            <div>
              <div className={s.cardMetaLbl}>Ouverture inscriptions</div>
              <div className={s.cardMetaVal}>{formatCardDate(t.registrationOpenAt, true)}</div>
            </div>
          )}
          <div>
            <div className={s.cardMetaLbl}>{wording.manyCapitalized}</div>
            <div className={`${s.cardMetaVal} ${s.num}`}>
              {t.registeredTeams}/{t.maxTeams}
            </div>
          </div>
          <div>
            <div className={s.cardMetaLbl}>Matchs</div>
            <div className={s.cardMetaVal}>{matchFormatLabel(t.matchFormat)}</div>
          </div>
        </div>

        <div className={s.progress} aria-hidden="true">
          <div className={s.progressBar} style={{ width: `${fill.percent}%` }} />
        </div>

        <div className={s.cardFoot}>
          <div>
            <div className={s.cardFootLbl}>Statut</div>
            <div className={`${s.cardFootVal} ${s.cardFootValSoon}`}>
              {locked ? "En attente du coup d'envoi" : "Inscriptions bientôt"}
            </div>
          </div>
          <span className={`${s.cardCta} ${s.cardCtaMuted}`}>Détails</span>
        </div>
      </article>
    </Link>
  );
}
