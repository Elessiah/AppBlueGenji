/**
 * La carte d'aperçu de `/classement` : le vrai podium du classement général
 * (`docs/features/SHARE_METADATA.md` § « Le podium »).
 *
 * Mêmes contraintes que `ShareCard` (Satori : tout en `display: flex`,
 * couleurs écrites en dur). Identité visuelle des marches reprise de la page
 * (`app/classement/page.module.css`, `PODIUM_TIERS.md`) : **néons froids**,
 * glacier pour la 1re, cyan pour la 2e, violet pour la 3e — jamais or ni bronze
 * (décision du 2026-10-06), jamais l'ambre (un avertissement).
 *
 * Ordre d'affichage 2-1-3, la 1re au centre et plus haute, comme sur la page.
 */
import type { ReactElement } from "react";
import type { PodiumShareEntry } from "@/lib/shared/page-share-cards";
import type { PodiumTier } from "@/lib/shared/podium-tiers";
import { SHARE_CARD_COLORS, ShareCardBadges, ShareCardFrame } from "./share-card";
import { ShareTeamMark, rgba } from "./share-team-mark";

/** Couleur de chaque marche — celles de `.podiumCard[data-place]`. */
export const PODIUM_PLACE_COLORS: Readonly<Record<PodiumTier, string>> = {
  /** `--blue-500`, le glacier de la marque. */
  1: SHARE_CARD_COLORS.blue,
  /** `--cyan-400`. */
  2: SHARE_CARD_COLORS.cyan,
  /** `--violet-300`. */
  3: SHARE_CARD_COLORS.violetSoft,
};

/** Opacité du voile de la marche sous son texte (haut du dégradé). */
export const PODIUM_CARD_FILL_ALPHA = 0.16;

/** Hauteur de chaque marche : la 1re dépasse, comme sur la page. */
const PLACE_HEIGHT: Readonly<Record<PodiumTier, number>> = { 1: 296, 2: 256, 3: 240 };

/** Ordre d'affichage : 2e à gauche, 1re au centre, 3e à droite. */
const DISPLAY_ORDER: readonly PodiumTier[] = [2, 1, 3];

/** Largeur d'une marche ; trois marches et deux gouttières font 1056 px. */
export const PODIUM_COLUMN_WIDTH = 336;

function PodiumStep({ entry }: Readonly<{ entry: PodiumShareEntry }>): ReactElement {
  const color = PODIUM_PLACE_COLORS[entry.place];
  const first = entry.place === 1;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        width: PODIUM_COLUMN_WIDTH,
        height: PLACE_HEIGHT[entry.place],
        padding: "18px 22px",
        borderRadius: 22,
        border: `${first ? 3 : 2}px solid ${rgba(color, first ? 0.9 : 0.55)}`,
        // Fond opaque puis voile de la marche qui s'éteint vers le bas : un
        // dégradé vers un noir translucide laissait une arête au rendu Satori.
        backgroundColor: SHARE_CARD_COLORS.background,
        backgroundImage: `linear-gradient(180deg, ${rgba(color, PODIUM_CARD_FILL_ALPHA)}, ${rgba(color, 0.02)})`,
        boxShadow: first ? `0 0 40px ${rgba(SHARE_CARD_COLORS.cyan, 0.35)}` : `0 0 24px ${rgba(color, 0.18)}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <ShareTeamMark logoSrc={entry.logoSrc} initial={entry.initial} color={color} size={76} />
        <div
          style={{
            display: "flex",
            fontSize: first ? 52 : 44,
            fontWeight: 700,
            color,
            textShadow: `0 0 18px ${rgba(color, 0.55)}`,
          }}
        >
          {entry.placeLabel}
        </div>
      </div>
      <div
        style={{
          marginTop: 14,
          fontSize: 30,
          lineHeight: 1.15,
          fontWeight: 700,
          color: SHARE_CARD_COLORS.ink,
          wordBreak: "break-word",
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
          // Satori n'applique la limite de lignes qu'avec l'ellipse.
          textOverflow: "ellipsis",
          overflow: "hidden",
        }}
      >
        {entry.name}
      </div>
      <div style={{ display: "flex", marginTop: 6, fontSize: 26, color: SHARE_CARD_COLORS.ink }}>{entry.points}</div>
    </div>
  );
}

export type PodiumShareCardProps = {
  eyebrow: string;
  title: string;
  footer: string;
  entries: readonly PodiumShareEntry[];
  logoSrc?: string | null;
};

/** La carte du podium, prête à être passée à `ImageResponse`. */
export function PodiumShareCard({ eyebrow, title, footer, entries, logoSrc }: Readonly<PodiumShareCardProps>): ReactElement {
  const byPlace = new Map(entries.map((entry) => [entry.place, entry]));
  return (
    <ShareCardFrame logoSrc={logoSrc} footer={footer}>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <ShareCardBadges eyebrow={eyebrow} accent={SHARE_CARD_COLORS.blueSoft} />
          <div style={{ display: "flex", fontSize: 44, fontWeight: 700 }}>{title}</div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            flexGrow: 1,
            marginBottom: 20,
          }}
        >
          {DISPLAY_ORDER.map((place) => {
            const entry = byPlace.get(place);
            return entry ? <PodiumStep key={place} entry={entry} /> : null;
          })}
        </div>
      </div>
    </ShareCardFrame>
  );
}
