"use client";

import Link from "next/link";
import { participantWording } from "@/lib/shared/participants";
import type { TournamentCard } from "@/lib/shared/types";
import { formatLabel as sharedFormatLabel, gameLabel as sharedGameLabel } from "@/lib/shared/tournament-labels";
import { TournamentImageBanner, TournamentImageEmblem } from "@/components/tournament-image";
import { CARD_IMAGE_SIZES } from "./card-image";
import s from "../tournois.module.css";

interface UpcomingCardProps {
  t: TournamentCard;
  /** Bandeau chargé en priorité : premières cartes illustrées de la page (`priorityBannerIds`). */
  priority?: boolean;
}

const DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

export function UpcomingCard({ t, priority }: UpcomingCardProps) {
  const wording = participantWording(t.participantType);
  const gameLabel = sharedGameLabel(t.game).toUpperCase();
  const formatLabel = sharedFormatLabel(t.format);

  const startDate = new Date(t.startAt).toLocaleDateString("fr-FR", DATE_TIME_FORMAT);

  // `UPCOMING` recouvre deux visages bien distincts : les inscriptions n'ont
  // pas encore ouvert, ou elles ont déjà **fermé** et le tournoi attend son
  // coup d'envoi. La carte affichait toujours « Ouverture inscriptions » avec
  // la même date passée dans les deux cas — même distinction que
  // `headerMetaItems` sur la fiche (`registrationDateItem`).
  const registrationClosed = new Date(t.registrationCloseAt).getTime() < Date.now();
  const registrationOpenDate = new Date(t.registrationOpenAt).toLocaleDateString("fr-FR", DATE_TIME_FORMAT);
  const registrationCloseDate = new Date(t.registrationCloseAt).toLocaleDateString("fr-FR", DATE_TIME_FORMAT);

  const pct = Math.round((t.registeredTeams / t.maxTeams) * 100);

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
          À venir
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
            <div className={s.cardMetaLbl}>{registrationClosed ? "Clôture inscriptions" : "Ouverture inscriptions"}</div>
            <div className={s.cardMetaVal}>{registrationClosed ? registrationCloseDate : registrationOpenDate}</div>
          </div>
          <div>
            <div className={s.cardMetaLbl}>{wording.manyCapitalized}</div>
            <div className={`${s.cardMetaVal} ${s.num}`}>
              {t.registeredTeams}/{t.maxTeams}
            </div>
          </div>
          <div>
            <div className={s.cardMetaLbl}>Format</div>
            <div className={s.cardMetaVal}>{formatLabel}</div>
          </div>
        </div>

        <div className={s.progress}>
          <div className={s.progressBar} style={{ width: `${pct}%` }} />
        </div>

        <div className={s.cardFoot}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--ink)" }}>
            <div style={{ fontSize: "9px", letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--ink-mute)", marginBottom: "2px" }}>Statut</div>
            <div style={{ fontSize: "13px", color: "var(--blue-300)" }}>
              {registrationClosed ? "Inscriptions closes" : "Inscriptions bientôt"}
            </div>
          </div>
          <span className={`${s.cardCta} ${s.cardCtaMuted}`}>
            Détails
          </span>
        </div>
      </article>
    </Link>
  );
}
