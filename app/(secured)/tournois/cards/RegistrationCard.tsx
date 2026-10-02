"use client";

import { matchFormatLabel } from "@/lib/shared/match-format";
import { participantWording } from "@/lib/shared/participants";
import type { TournamentCard } from "@/lib/shared/types";
import { formatCardDate, registrationFill } from "../_lib/card-display";
import { CardMetaItem, CardProgress, LiveRibbon, TournamentCardFrame } from "./CardParts";
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
export function RegistrationCard({ t, priority }: Readonly<RegistrationCardProps>) {
  const wording = participantWording(t.participantType);
  const fill = registrationFill(t);

  return (
    <TournamentCardFrame
      t={t}
      priority={priority}
      state="open"
      ribbonClassName={s.cardRibbonOpen}
      ribbon={<LiveRibbon label="Inscriptions ouvertes" />}
    >
      <div className={s.cardMeta}>
        <CardMetaItem label="Début">{formatCardDate(t.startAt, true)}</CardMetaItem>
        <CardMetaItem label="Clôture" valueClassName={`${s.cardMetaVal} ${s.cardMetaValWarn}`}>
          {formatCardDate(t.registrationCloseAt, true)}
        </CardMetaItem>
        <CardMetaItem label={wording.manyCapitalized} valueClassName={`${s.cardMetaVal} ${s.num}`}>
          {t.registeredTeams}/{t.maxTeams}
        </CardMetaItem>
        <CardMetaItem label="Matchs">{matchFormatLabel(t.matchFormat)}</CardMetaItem>
      </div>

      <CardProgress percent={fill.percent} />

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
    </TournamentCardFrame>
  );
}
