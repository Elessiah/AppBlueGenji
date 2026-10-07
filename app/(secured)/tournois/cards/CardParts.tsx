"use client";

import type { ReactNode } from "react";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { useTournamentsText } from "@/components/i18n/tournaments-text";
import { tournamentLabel } from "@/lib/shared/tournaments-text";
import type { TournamentCard } from "@/lib/shared/types";
import { TournamentImageBanner, TournamentImageEmblem } from "@/components/tournament-image";
import { CARD_IMAGE_SIZES } from "./card-image";
import s from "../tournois.module.css";

interface TournamentCardFrameProps {
  t: TournamentCard;
  /** Bandeau chargé en priorité : premières cartes illustrées de la page (`priorityBannerIds`). */
  priority?: boolean;
  /** Visage de la carte (`data-state`), qui en règle les couleurs. */
  state: "running" | "open" | "soon" | "done";
  /** Classe de couleur du ruban (`s.cardRibbonRunning`…). */
  ribbonClassName: string;
  /** Ce que dit le ruban : l'état du tournoi, une seule fois sur la carte. */
  ribbon: ReactNode;
  /** Cases d'informations, jauge et pied de carte. */
  children: ReactNode;
}

/**
 * Cadre commun des cartes de `/tournois` (`docs/features/TOURNAMENT_LIST_CARDS.md`) :
 * plaque de lien (`.cardOverlay`, limitée à « Voir le tournoi *nom* »),
 * bandeau, ruban d'état, jeu et format, emblème, titre et description. Le
 * reste — ce que la carte dit de son état — appartient à chaque carte.
 */
export function TournamentCardFrame({
  t,
  priority,
  state,
  ribbonClassName,
  ribbon,
  children,
}: Readonly<TournamentCardFrameProps>) {
  const text = useTournamentsText();
  return (
    <article className={s.card} data-state={state}>
      <LocaleLink
        href={`/tournois/${t.id}`}
        className={s.cardOverlay}
        aria-label={text.t("cards.open", { name: t.name })}
        // La fiche n'est pas encore traduite (lot 8a-2) : depuis `/en`, le lien
        // mène à la page française et le dit aux technologies d'assistance.
        hrefLang={text.locale === "en" ? "fr" : undefined}
      />
      <TournamentImageBanner
        image={t.image}
        sizes={CARD_IMAGE_SIZES}
        className={s.cardBanner}
        priority={priority}
      />
      <div className={`${s.cardRibbon} ${ribbonClassName}`}>{ribbon}</div>

      <div className={s.cardHead}>
        <div className={s.cardGame}>
          {tournamentLabel(text, "game", t.game)}
          <span className={s.dot}>◆</span>
          {tournamentLabel(text, "format", t.format)}
        </div>
        <TournamentImageEmblem image={t.image} size={40} />
      </div>

      <h3 className={s.cardTitle}>{t.name}</h3>
      {t.description ? <div className={s.cardSub}>{t.description}</div> : null}

      {children}
    </article>
  );
}

/** Ruban d'un état vivant : la pastille, puis le libellé. */
export function LiveRibbon({ label }: Readonly<{ label: string }>) {
  return (
    <>
      <span className={s.dot} />
      {/* NOSONAR S6772 — ruban en flex avec `gap` */}
      {label}
    </>
  );
}

/** Une case d'informations de la carte : libellé, puis valeur. */
export function CardMetaItem({
  label,
  valueClassName = s.cardMetaVal,
  children,
}: Readonly<{ label: ReactNode; valueClassName?: string; children: ReactNode }>) {
  return (
    <div>
      <div className={s.cardMetaLbl}>{label}</div>
      <div className={valueClassName}>{children}</div>
    </div>
  );
}

/** Jauge décorative (le pourcentage est dit en clair au pied de la carte). */
export function CardProgress({ percent }: Readonly<{ percent: number }>) {
  return (
    <div className={s.progress} aria-hidden="true">
      <div className={s.progressBar} style={{ width: `${percent}%` }} />
    </div>
  );
}
