"use client";

import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import { avatarInitial } from "@/lib/shared/avatar";
import { EntrantLink, useEntrantLogo } from "../_lib/entrant-link";
import styles from "./EntrantName.module.css";

/** Côtés d'emblème en usage : 16 px dans une ligne de texte, plus grand en exergue. */
export type EntrantLogoSize = 16 | 20 | 24;

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
export function EntrantLogo({ teamId, name, size = 16, logoUrl: knownLogoUrl }: EntrantLogoProps) {
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

type EntrantNameProps = {
  /** Engagé nommé ; `null` pour une case vide, rendue en texte simple. */
  teamId: number | null;
  /** Nom de l'engagé (ou libellé de la case vide : « TBD », « BYE »…). */
  name: string | null;
  /** Contenu affiché à la place de `name` (mise en gras, par exemple). */
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
  title?: string;
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
}: EntrantNameProps) {
  const textClass = [styles.text, truncate ? styles.truncate : "", textClassName ?? ""]
    .filter(Boolean)
    .join(" ");
  const content = children ?? name;

  return (
    <span className={className ? `${styles.label} ${className}` : styles.label} style={style}>
      <EntrantLogo teamId={teamId} name={name} size={logoSize} />
      {teamId !== null ? (
        <EntrantLink teamId={teamId} className={textClass} style={textStyle} title={title}>
          {content}
        </EntrantLink>
      ) : (
        <span className={textClass} style={textStyle} title={title}>
          {content}
        </span>
      )}
    </span>
  );
}
