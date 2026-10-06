/**
 * La marque d'une équipe sur une carte d'aperçu : son logo (URL `data:` PNG,
 * fichier du site seulement), sinon son initiale dans un carré teinté. Partagée
 * par les marches du podium et la carte d'une équipe.
 */
import type { ReactElement } from "react";
import { SHARE_CARD_COLORS } from "./share-card";

/** `#rrggbb` → `rgba(r, g, b, alpha)` : Satori ne lit pas `color-mix`. */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export type ShareTeamMarkProps = {
  logoSrc: string | null;
  initial: string;
  /** Teinte du cadre de l'initiale. */
  color: string;
  /** Côté, en pixels ; coins et initiale suivent. */
  size: number;
};

export function ShareTeamMark({ logoSrc, initial, color, size }: Readonly<ShareTeamMarkProps>): ReactElement {
  const radius = Math.round(size * 0.21);
  if (logoSrc) {
    return (
      // Satori exige une balise <img> : `next/image` n'existe pas ici.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logoSrc} width={size} height={size} alt="" style={{ borderRadius: radius }} />
    );
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: radius,
        border: `${size > 100 ? 3 : 2}px solid ${rgba(color, 0.6)}`,
        backgroundColor: rgba(color, 0.12),
        color: SHARE_CARD_COLORS.ink,
        fontSize: Math.round(size / 2),
        fontWeight: 700,
      }}
    >
      {initial}
    </div>
  );
}
