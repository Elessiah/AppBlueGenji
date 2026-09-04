"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import { avatarInitial } from "@/lib/shared/avatar";
import { LogoWithGlow } from "./logo-with-glow";

type UserAvatarProps = {
  /** URL de l'avatar, ou `null` si le compte n'en a pas. */
  src: string | null | undefined;
  /** Pseudo : sert d'alternative textuelle **et** d'initiale de repli. */
  pseudo: string;
  /** Côté du carré (px). L'avatar est toujours rond. */
  size: number;
  borderColor?: string;
  /**
   * Épaisseur du liseré, en pixels. Chaque écran avait la sienne avant ce
   * composant (1 px dans la barre de navigation, 1,5 px dans l'en-tête public,
   * 2 px sur le profil) : un défaut unique les aurait tous alignés au passage,
   * ce qui n'est pas le rôle d'une correction de repli.
   */
  borderWidth?: number;
  className?: string;
  style?: CSSProperties;
  /**
   * Rendre l'image avec le halo de `LogoWithGlow` (en-tête de fiche joueur).
   * Sans effet sur le repli : une pastille à initiale n'a pas d'image à faire
   * flotter.
   */
  glow?: boolean;
  /**
   * L'avatar ne dit rien de plus que ce qui est déjà écrit à côté : le nom du
   * compte figure dans le même lien, ou juste sous lui.
   *
   * Le réglage vaut pour les **deux** rendus — image et repli. Sans lui, la
   * pastille de navigation se lisait « Nova Nova » quand le compte avait un
   * avatar (`alt` + texte adjacent) et « Nova » quand il n'en avait pas (le
   * repli étant masqué) : le même contrôle changeait de nom accessible selon
   * qu'un fichier avait été téléversé.
   */
  decorative?: boolean;
};

/**
 * Avatar d'un compte, **repli compris**.
 *
 * Point de passage unique : les quatre écrans qui affichaient un avatar
 * pointaient chacun vers `/vercel.svg` quand le compte n'en avait pas — un
 * fichier absent de `public/`, donc un 404 et une image cassée pour tout compte
 * sans avatar. Le repli est ici la pastille à initiale des cartes d'annuaire, et
 * il n'y a plus qu'un endroit où il puisse se tromper.
 */
export function UserAvatar({
  src,
  pseudo,
  size,
  borderColor = "rgba(89,212,255,0.35)",
  borderWidth = 2,
  className,
  style,
  glow,
  decorative,
}: UserAvatarProps) {
  // Une image décorative porte un `alt` **vide** : c'est ce qui la retire de
  // l'arbre d'accessibilité, là où l'omettre la ferait annoncer par son nom de
  // fichier.
  const alt = decorative ? "" : pseudo;

  if (src) {
    if (glow) {
      return (
        <LogoWithGlow
          src={src}
          alt={alt}
          width={size}
          height={size}
          size="sm"
          borderRadius={999}
          borderColor={borderColor}
          unoptimized
        />
      );
    }

    return (
      <Image
        className={className}
        src={src}
        alt={alt}
        width={size}
        height={size}
        unoptimized
        referrerPolicy="no-referrer"
        style={{
          width: size,
          height: size,
          // Un avatar ne se laisse pas comprimer par ses voisins de ligne : les
          // en-têtes qui l'affichent sont des conteneurs flex.
          flexShrink: 0,
          borderRadius: "50%",
          border: `${borderWidth}px solid ${borderColor}`,
          objectFit: "cover",
          ...style,
        }}
      />
    );
  }

  return (
    <span
      className={className}
      // Le repli suit le même réglage que l'image : une pastille annoncée d'un
      // côté et muette de l'autre ferait changer de nom accessible le contrôle
      // qui la contient, selon qu'un avatar a été téléversé.
      aria-hidden={decorative ? "true" : undefined}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : pseudo}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: "50%",
        border: `${borderWidth}px solid ${borderColor}`,
        background: "var(--cyber-bg-2)",
        color: "var(--blue-300)",
        display: "inline-grid",
        placeItems: "center",
        fontFamily: "var(--font-display)",
        fontWeight: 700,
        // Proportionnée au cadre : une taille fixe déborderait d'une pastille de
        // 30 px et se perdrait dans une de 64.
        fontSize: Math.max(11, Math.round(size * 0.42)),
        lineHeight: 1,
        userSelect: "none",
        ...style,
      }}
    >
      {avatarInitial(pseudo)}
    </span>
  );
}
