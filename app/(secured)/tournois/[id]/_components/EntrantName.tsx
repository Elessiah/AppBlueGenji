"use client";

import Image from "next/image";
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { avatarInitial } from "@/lib/shared/avatar";
import { entityTruncateClass, joinClasses } from "@/lib/shared/class-names";
import { withoutInvisibles } from "@/lib/shared/visible-text";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { EntrantLink, useEntrantLogo } from "../_lib/entrant-link";
import styles from "./EntrantName.module.css";

/** Côtés d'emblème en usage : 16 px dans une ligne de texte, 20 px en exergue, 40 px au tableau d'affichage de la page d'un match. */
export type EntrantLogoSize = 16 | 20 | 40;

type EntrantLogoProps = {
  /** Engagé représenté ; `null` pour une case vide (TBD, exemption). */
  teamId: number | null;
  /** Nom affiché à côté : sert à l'initiale de repli. */
  name: string | null;
  size?: EntrantLogoSize;
  /**
   * Logo connu de l'appelant, pour une équipe qui n'est **pas** (encore)
   * inscrite — la table du contexte ne porte que les inscrites (dialogue
   * d'inscription des fantômes). Absent : lu dans le contexte.
   */
  logoUrl?: string | null;
};

/**
 * Emblème d'un engagé de tournoi : son logo, sinon l'initiale de son nom.
 *
 * Le logo est lu dans le contexte de la page (`useEntrantLogo`), construit une
 * fois depuis les inscrites — aucune vue n'a donc à le faire descendre par ses
 * props. Jamais un fichier de repli : une image absente du dépôt rendrait un 404
 * pour tout engagé sans logo, comme `/vercel.svg` l'a fait pour les avatars.
 *
 * **Toujours décoratif** (`aria-hidden`, `alt` vide) : il ne fait que redire le
 * nom écrit juste à côté, et une lecture d'écran qui annoncerait « D, Dragon
 * Squad » n'apprendrait rien.
 */
export function EntrantLogo({ teamId, name, size = 16, logoUrl: knownLogoUrl }: Readonly<EntrantLogoProps>) {
  const contextLogoUrl = useEntrantLogo(teamId);
  const logoUrl = knownLogoUrl === undefined ? contextLogoUrl : knownLogoUrl;
  const style = { "--size": `${size}px` } as CSSProperties;

  if (teamId === null) {
    return <span aria-hidden="true" className={`${styles.logo} ${styles.empty}`} style={style} />;
  }

  return (
    <span aria-hidden="true" className={styles.logo} style={style}>
      {logoUrl ? (
        <Image src={logoUrl} alt="" width={size} height={size} className={styles.logoImage} />
      ) : (
        avatarInitial(name)
      )}
    </span>
  );
}

/**
 * Nom d'engagé tel qu'il s'affiche : sans invisibles ni commandes de direction
 * (`UNTRUSTED_NAMES.md`) — sans NFKC, il se lit comme sur sa fiche. Un nom
 * resté en base peut en porter encore (sosie refusé par `UNIQUE`) ; s'il ne
 * garde rien, il retombe sur « Engagé #id » : jamais un lien vide, sans nom
 * accessible. Pour un appelant qui habille le nom (`children` d'`EntrantName`).
 */
export function useShownEntrantName(teamId: number | null, name: string | null): string | null {
  const text = useTournamentPageText();
  // Mémoïsé : cinq passes d'expressions Unicode, rejouées sinon à chaque rendu
  // de chaque nom d'un grand tableau re-rendu à chaque instantané SSE.
  return useMemo(() => {
    const fallback = teamId === null ? null : text.t("match.entrantFallback", { id: String(teamId) });
    if (name === null) return fallback;
    const cleanName = withoutInvisibles(name);
    return cleanName === "" ? (fallback ?? cleanName) : cleanName;
  }, [teamId, name, text]);
}

type EntrantNameProps = {
  /** Engagé nommé ; `null` pour une case vide, rendue en texte simple. */
  teamId: number | null;
  /** Nom de l'engagé (ou libellé de la case vide : « TBD », « BYE »…). */
  name: string | null;
  /**
   * Contenu affiché à la place de `name` (mise en gras, par exemple) — le nom
   * qu'il porte vient de `useShownEntrantName`, jamais du nom brut.
   */
  children?: ReactNode;
  logoSize?: EntrantLogoSize;
  /** Tronquer le nom d'une ellipse plutôt que le laisser passer à la ligne. */
  truncate?: boolean;
  /** Classe et style du conteneur (emblème + nom) — c'est lui qui prend place dans la ligne. */
  className?: string;
  style?: CSSProperties;
  /** Classe et style du nom lui-même (lien, ou texte d'une case vide). */
  textClassName?: string;
  textStyle?: CSSProperties;
  /** Infobulle : nettoyée comme le nom (jamais un nom retourné ou vide). */
  title?: string;
  /**
   * Nom non cliquable, sans case d'emblème vide — pour un sous-titre de
   * dialogue, où un clic quitterait la saisie en cours.
   */
  plain?: boolean;
};

/**
 * Nom d'un engagé précédé de son emblème, cliquable vers sa fiche.
 *
 * Point de passage des vues de plateau, de classement et d'inscrites : poser le
 * logo dans une vue, c'est l'oublier dans les autres. Le conteneur est un
 * `inline-flex` au `min-width: 0` — l'emblème garde sa taille, c'est le nom qui
 * cède la place, et l'ellipse (`truncate`) reste possible, ce qu'un lien portant
 * lui-même l'image ne permettrait pas.
 */
export function EntrantName({
  teamId,
  name,
  children,
  logoSize = 16,
  truncate = false,
  className,
  style,
  textClassName,
  textStyle,
  title,
  plain = false,
}: Readonly<EntrantNameProps>) {
  // Troncature : `.entity-truncate` (globale), par `EntityLink` pour le lien —
  // qui rogne sur le nom peint d'une marche plutôt que sur le lien —, posée à
  // la main sur le nom non cliquable.
  const textClass = joinClasses(styles.text, textClassName);
  // Nom et initiale de repli nettoyés (`useShownEntrantName`) ; des
  // `children` passent par le même nettoyage chez leur appelant.
  const shownName = useShownEntrantName(teamId, name);
  const content = children ?? shownName;
  const shownTitle = title === undefined ? undefined : withoutInvisibles(title) || undefined;
  const linked = teamId !== null && !plain;

  return (
    <span className={joinClasses(styles.label, className)} style={style}>
      {plain && teamId === null ? null : <EntrantLogo teamId={teamId} name={shownName} size={logoSize} />}
      {linked ? (
        <EntrantLink teamId={teamId} className={textClass} style={textStyle} title={shownTitle} truncate={truncate}>
          {content}
        </EntrantLink>
      ) : (
        <span className={joinClasses(textClass, entityTruncateClass(truncate))} style={textStyle} title={shownTitle}>
          {content}
        </span>
      )}
    </span>
  );
}
