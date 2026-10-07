"use client";

import { useTournamentsText } from "@/components/i18n/tournaments-text";
import { localizedMatchFormatLabel, participantLabel } from "@/lib/shared/tournaments-text";
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
  const text = useTournamentsText();
  const fill = registrationFill(t);

  return (
    <TournamentCardFrame
      t={t}
      priority={priority}
      state="open"
      ribbonClassName={s.cardRibbonOpen}
      ribbon={<LiveRibbon label={text.t("cards.registrationOpen")} />}
    >
      <div className={s.cardMeta}>
        <CardMetaItem label={text.t("cards.start")}>{formatCardDate(t.startAt, true, text.locale)}</CardMetaItem>
        <CardMetaItem label={text.t("cards.closing")} valueClassName={`${s.cardMetaVal} ${s.cardMetaValWarn}`}>
          {formatCardDate(t.registrationCloseAt, true, text.locale)}
        </CardMetaItem>
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
          <div className={s.cardFootLbl}>{text.t("cards.fill")}</div>
          {fill.full ? (
            <div className={`${s.cardFootVal} ${s.cardFootValWarn}`}>{text.t("cards.full")}</div>
          ) : (
            <div className={`${s.cardFootVal} ${s.num}`}>{text.t("cards.percent", { percent: String(fill.percent) })}</div>
          )}
        </div>
        <span className={fill.full ? `${s.cardCta} ${s.cardCtaMuted}` : `${s.cardCta} ${s.cardCtaPrimary}`}>
          {text.t("cards.actions.tournament")}
        </span>
      </div>
    </TournamentCardFrame>
  );
}
