"use client";

import Link from "next/link";
import { matchFormatLabel } from "@/lib/shared/match-format";
import { participantWording } from "@/lib/shared/participants";
import { formatLabel, gameLabel } from "@/lib/shared/tournament-labels";
import type { TournamentCard } from "@/lib/shared/types";
import { TournamentImageBanner, TournamentImageEmblem } from "@/components/tournament-image";
import { formatCardDate, registrationFill } from "../_lib/card-display";
import { CARD_IMAGE_SIZES } from "./card-image";
import s from "../tournois.module.css";

interface RegistrationCardProps {
  t: TournamentCard;
  /** Bandeau chargé en priorité : premières cartes illustrées de la page (`priorityBannerIds`). */
  priority?: boolean;
}

/**
 * Carte d'un tournoi aux inscriptions. L'action dit ce que fait le clic —
 * ouvrir la fiche —, jamais « S'inscrire » : la liste ne connaît pas le
 * lecteur (déjà inscrit, sans équipe, sans rôle de gestion…), et c'est la fiche
 * qui tranche (`registerBlockedNotice`). Un plateau plein, lui, se lit sur la
 * carte : c'est le seul refus qui ne dépend de personne.
 */
export function RegistrationCard({ t, priority }: RegistrationCardProps) {
  const wording = participantWording(t.participantType);
  const fill = registrationFill(t);

  return (
    <article className={s.card} data-state="open">
      <Link
        href={`/tournois/${t.id}`}
        className={s.cardOverlay}
        aria-label={`Voir le tournoi ${t.name}`}
      />
      <TournamentImageBanner
        image={t.image}
        sizes={CARD_IMAGE_SIZES}
        className={s.cardBanner}
        priority={priority}
      />
      <div className={`${s.cardRibbon} ${s.cardRibbonOpen}`}>
        <span className={s.dot} />
        Inscriptions ouvertes
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
          <div className={s.cardMetaLbl}>Clôture</div>
          <div className={`${s.cardMetaVal} ${s.cardMetaValWarn}`}>
            {formatCardDate(t.registrationCloseAt, true)}
          </div>
        </div>
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
          <div className={s.cardFootLbl}>Remplissage</div>
          {fill.full ? (
            <div className={`${s.cardFootVal} ${s.cardFootValWarn}`}>Complet</div>
          ) : (
            <div className={`${s.cardFootVal} ${s.num}`}>{fill.percent} %</div>
          )}
        </div>
        <span className={fill.full ? `${s.cardCta} ${s.cardCtaMuted}` : `${s.cardCta} ${s.cardCtaPrimary}`}>
          Voir le tournoi
        </span>
      </div>
    </article>
  );
}
