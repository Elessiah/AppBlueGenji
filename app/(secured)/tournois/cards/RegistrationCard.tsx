"use client";

import Link from "next/link";
import { participantWording } from "@/lib/shared/participants";
import type { TournamentCard } from "@/lib/shared/types";
import { formatLabel as sharedFormatLabel, gameLabel as sharedGameLabel } from "@/lib/shared/tournament-labels";
import { TournamentImageBanner, TournamentImageEmblem } from "@/components/tournament-image";
import { CARD_IMAGE_SIZES } from "./card-image";
import s from "../tournois.module.css";

interface RegistrationCardProps {
  t: TournamentCard;
  /** Bandeau chargé en priorité : premières cartes illustrées de la page (`priorityBannerIds`). */
  priority?: boolean;
}

export function RegistrationCard({ t, priority }: RegistrationCardProps) {
  const wording = participantWording(t.participantType);
  const gameLabel = sharedGameLabel(t.game).toUpperCase();
  const formatLabel = sharedFormatLabel(t.format);
  // Sans le contexte du lecteur (déjà inscrit ? staff ? sans équipe ?), la
  // liste ne peut affirmer qu'un seul fait sûr : le plateau est plein ou non.
  // « S'inscrire » est donc remplacé par un défaut neutre — voir la fiche pour
  // ce que le lecteur peut réellement y faire (`registerBlockedNotice`).
  const isFull = t.maxTeams > 0 && t.registeredTeams >= t.maxTeams;

  const startDate = new Date(t.startAt).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const closeDate = new Date(t.registrationCloseAt).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const pct = Math.round((t.registeredTeams / t.maxTeams) * 100);

  return (
    <Link href={`/tournois/${t.id}`} style={{ textDecoration: "none" }}>
      <article className={s.card} data-state="open">
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
            <div className={s.cardMetaLbl}>Clôture</div>
            <div className={s.cardMetaVal} style={{ color: "var(--amber)" }}>
              {closeDate}
            </div>
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
            <div style={{ fontSize: "9px", letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--ink-mute)", marginBottom: "2px" }}>Remplissage</div>
            <div style={{ fontSize: "13px", color: "var(--ink)" }}>{pct}%</div>
          </div>
          {isFull ? (
            <span className={`${s.cardCta} ${s.cardCtaMuted}`}>Complet</span>
          ) : (
            <span className={`${s.cardCta} ${s.cardCtaPrimary}`}>Voir le tournoi →</span>
          )}
        </div>
      </article>
    </Link>
  );
}
