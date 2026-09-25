"use client";

import Link from "next/link";
import { matchFormatLabel } from "@/lib/shared/match-format";
import { participantWording } from "@/lib/shared/participants";
import { formatLabel, gameLabel } from "@/lib/shared/tournament-labels";
import type { TournamentCard } from "@/lib/shared/types";
import { TournamentImageBanner, TournamentImageEmblem } from "@/components/tournament-image";
import { formatCardDate } from "../_lib/card-display";
import { CARD_IMAGE_SIZES } from "./card-image";
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
export function FinishedCard({ t, priority }: FinishedCardProps) {
  const wording = participantWording(t.participantType);
  const finishDate = formatCardDate(t.finishedAt ?? t.startAt, false);

  return (
    <article className={s.card} data-state="done">
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
      <div className={`${s.cardRibbon} ${s.cardRibbonDone}`}>
        Terminé · {finishDate}
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
          <div className={s.cardMetaVal}>{formatCardDate(t.startAt, false)}</div>
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

      <div className={s.cardFoot}>
        <div className={s.cardFootMain}>
          <div className={s.cardFootLbl}>Vainqueur</div>
          {/* Le nom peut être coupé (ellipse) : il reste entier au survol. */}
          <div className={`${s.cardFootVal} ${s.cardChampion}`} title={t.champion?.name}>
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
        <span className={s.cardCta}>Voir les résultats</span>
      </div>
    </article>
  );
}
