"use client";

import Link from "next/link";
import { participantWording } from "@/lib/shared/participants";
import type { TournamentCard } from "@/lib/shared/types";
import { formatLabel as sharedFormatLabel, gameLabel as sharedGameLabel, runningTournamentActionLabel } from "@/lib/shared/tournament-labels";
import { TournamentImageBanner, TournamentImageEmblem } from "@/components/tournament-image";
import { CARD_IMAGE_SIZES } from "./card-image";
import s from "../tournois.module.css";

interface RunningCardProps {
  t: TournamentCard;
  /** Bandeau chargé en priorité : premières cartes illustrées de la page (`priorityBannerIds`). */
  priority?: boolean;
}

export function RunningCard({ t, priority }: RunningCardProps) {
  const wording = participantWording(t.participantType);
  const gameLabel = sharedGameLabel(t.game).toUpperCase();
  const formatLabel = sharedFormatLabel(t.format);
  const startDate = new Date(t.startAt).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Link href={`/tournois/${t.id}`} style={{ textDecoration: "none" }}>
      <article className={s.card} data-state="running">
        <TournamentImageBanner
          image={t.image}
          sizes={CARD_IMAGE_SIZES}
          className={s.cardBanner}
          priority={priority}
        />
        {/* Bleu, jamais rouge : le rouge est réservé à ce qui est réellement à
            l'antenne (voir CLAUDE.md, « live » a trois sens distincts). */}
        <div className={`${s.cardRibbon} ${s.cardRibbonRunning}`}>
          <span className={s.dot} />
          EN COURS
        </div>

        <div className={s.cardHead}>
          <div className={s.cardGame}>{gameLabel}</div>
          <TournamentImageEmblem image={t.image} size={40} />
        </div>

        <h3 className={s.cardTitle}>{t.name}</h3>
        <div className={s.cardSub}>{t.description || "Tournoi"}</div>

        <div className={s.cardMeta}>
          <div>
            <div className={s.cardMetaLbl}>Début</div>
            <div className={s.cardMetaVal}>{startDate}</div>
          </div>
          <div>
            <div className={s.cardMetaLbl}>Format</div>
            <div className={s.cardMetaVal}>{formatLabel}</div>
          </div>
          <div>
            <div className={s.cardMetaLbl}>{wording.manyCapitalized}</div>
            <div className={`${s.cardMetaVal} ${s.num}`}>
              {t.registeredTeams}/{t.maxTeams}
            </div>
          </div>
        </div>

        <div className={`${s.cardFoot} ${s.cardFootEnd}`}>
          <span className={`${s.cardCta} ${s.cardCtaPrimary}`}>
            {runningTournamentActionLabel(t.format)}
          </span>
        </div>
      </article>
    </Link>
  );
}
