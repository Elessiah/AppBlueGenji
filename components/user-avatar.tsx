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
  className?: string;
  style?: CSSProperties;
  /**
   * Rendre l'image avec le halo de `LogoWithGlow` (en-tête de fiche joueur).
   * Sans effet sur le repli : une pastille à initiale n'a pas d'image à faire
   * flotter.
   */
  glow?: boolean;
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
  className,
  style,
  glow,
}: UserAvatarProps) {
  if (src) {
    if (glow) {
      return (
        <LogoWithGlow
          src={src}
          alt={pseudo}
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
        alt={pseudo}
        width={size}
        height={size}
        unoptimized
        referrerPolicy="no-referrer"
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          border: `2px solid ${borderColor}`,
          objectFit: "cover",
          ...style,
        }}
      />
    );
  }

  return (
    <span
      className={className}
      // L'initiale est décorative : le nom du compte est déjà écrit à côté sur
      // les quatre écrans, et le lire deux fois n'apprendrait rien.
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: "50%",
        border: `2px solid ${borderColor}`,
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
