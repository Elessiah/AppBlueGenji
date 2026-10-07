"use client";

import { useTournamentsText } from "@/components/i18n/tournaments-text";
import { localizedMatchFormatLabel, participantLabel } from "@/lib/shared/tournaments-text";
import type { TournamentCard } from "@/lib/shared/types";
import { formatCardDate } from "../_lib/card-display";
import { CardMetaItem, TournamentCardFrame } from "./CardParts";
import s from "../tournois.module.css";

interface FinishedCardProps {
  t: TournamentCard;
  /** Bandeau chargé en priorité : premières cartes illustrées de la page (`priorityBannerIds`). */
  priority?: boolean;
}

/**
 * Carte d'un tournoi terminé : qui l'a gagné, et quand il s'est terminé. La
 * date de clôture manque aux tournois clos avant qu'elle soit enregistrée —
 * on retombe alors sur le coup d'envoi, seule date encore sûre.
 *
 * La carte se ternit par ses **couleurs** (`data-state="done"`), jamais par une
 * opacité : celle-ci faisait passer les textes atténués sous 4,5:1.
 */
export function FinishedCard({ t, priority }: Readonly<FinishedCardProps>) {
  const text = useTournamentsText();
  const finishDate = formatCardDate(t.finishedAt ?? t.startAt, false, text.locale);

  return (
    <TournamentCardFrame
      t={t}
      priority={priority}
      state="done"
      ribbonClassName={s.cardRibbonDone}
      ribbon={text.t("cards.finished", { date: finishDate })}
    >
      <div className={s.cardMeta}>
        <CardMetaItem label={text.t("cards.start")}>{formatCardDate(t.startAt, false, text.locale)}</CardMetaItem>
        <CardMetaItem
          label={participantLabel(text, t.participantType, "manyParticipating")}
          valueClassName={`${s.cardMetaVal} ${s.num}`}
        >
          {t.registeredTeams}
        </CardMetaItem>
        <CardMetaItem label={text.t("cards.matches")}>{localizedMatchFormatLabel(text, t.matchFormat)}</CardMetaItem>
      </div>

      <div className={s.cardFoot}>
        <div className={s.cardFootMain}>
          <div className={s.cardFootLbl}>{text.t("cards.winner")}</div>
          {/* Le nom peut être coupé (ellipse) : il se déplie au survol de la
              carte et au focus de son lien (`.card:hover`/`:focus-within`). Un
              `title` natif ne servirait à rien — la plaque `.cardOverlay` le
              recouvre, la souris ne l'atteint jamais. */}
          <div className={`${s.cardFootVal} ${s.cardChampion}`}>
            {t.champion ? (
              <>
                <span aria-hidden="true">🏆 </span>
                {t.champion.name}
              </>
            ) : (
              "—"
            )}
          </div>
        </div>
        <span className={s.cardCta}>{text.t("cards.results")}</span>
      </div>
    </TournamentCardFrame>
  );
}
