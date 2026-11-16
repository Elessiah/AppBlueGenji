/**
 * L'image d'aperçu d'un match partagé (`docs/features/SHARE_EMBEDS.md`) : un
 * tableau d'affichage compact, « façon Spotify » — tournoi et place du match,
 * les deux engagés (logo, nom) autour du score, puis une case par map jouée
 * avec son score et son code de replay (D74).
 *
 * Rendue par Satori comme les autres cartes (`share-card.tsx`, dont l'en-tête
 * dit les contraintes : `display: flex` partout, couleurs en dur, pixels).
 * Le texte arrive **déjà rédigé** (`matchEmbedCard`) : aucun pseudo n'y entre,
 * un engagé solo s'y appelle « Joueur 1 » / « Joueur 2 ».
 */
import type { ReactElement } from "react";
import type { EmbedMapCell, EmbedScoreCenter, EmbedTeamMark } from "@/lib/shared/share-embed-cards";
import { SHARE_CARD_COLORS, ShareCardBadges, ShareCardFrame, type ShareCardTone } from "./share-card";
import { rgba, ShareTeamMark } from "./share-team-mark";

/** Côté du logo d'un engagé sur le tableau d'affichage. */
export const MATCH_SHARE_LOGO_SIZE = 84;

/** Teinte de chaque camp : cyan à gauche, violet à droite, comme les cases gagnées. */
export const MATCH_SIDE_COLORS = [SHARE_CARD_COLORS.cyan, SHARE_CARD_COLORS.violetSoft] as const;

/** Cases de maps par ligne. */
const MAPS_PER_ROW = 3;

export type MatchShareCardProps = {
  eyebrow: string;
  state: { label: string; tone: ShareCardTone };
  title: string;
  subtitle: string;
  team1: EmbedTeamMark & { logoSrc: string | null };
  team2: EmbedTeamMark & { logoSrc: string | null };
  center: EmbedScoreCenter;
  maps: EmbedMapCell[];
  moreMaps: string | null;
  /** Mention d'une map jouée sans code (« Sans code »). */
  noCode: string;
  footer: string;
  logoSrc?: string | null;
};

function Side({
  team,
  color,
  align,
}: Readonly<{ team: MatchShareCardProps["team1"]; color: string; align: "left" | "right" }>): ReactElement {
  const mark = <ShareTeamMark logoSrc={team.logoSrc} initial={team.initial} color={color} size={MATCH_SHARE_LOGO_SIZE} />;
  const name = (
    <div
      style={{
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: 2,
        textOverflow: "ellipsis",
        overflow: "hidden",
        wordBreak: "break-word",
        maxWidth: 300,
        margin: align === "left" ? "0 0 0 22px" : "0 22px 0 0",
        fontSize: 34,
        lineHeight: 1.12,
        fontWeight: 700,
        textAlign: align,
        // Le vainqueur garde l'encre pleine, l'autre passe en retrait.
        color: team.winner ? SHARE_CARD_COLORS.ink : SHARE_CARD_COLORS.inkMute,
      }}
    >
      {team.name}
    </div>
  );
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: align === "left" ? "flex-start" : "flex-end",
        width: 400,
      }}
    >
      {align === "left" ? mark : name}
      {align === "left" ? name : mark}
    </div>
  );
}

function Center({ center }: Readonly<{ center: EmbedScoreCenter }>): ReactElement {
  if (center.kind === "score") {
    return (
      <div style={{ display: "flex", alignItems: "center", fontSize: 76, fontWeight: 700, letterSpacing: 2 }}>
        <div style={{ display: "flex", color: MATCH_SIDE_COLORS[0] }}>{center.team1}</div>
        <div style={{ display: "flex", margin: "0 18px", color: SHARE_CARD_COLORS.inkMute }}>–</div>
        <div style={{ display: "flex", color: MATCH_SIDE_COLORS[1] }}>{center.team2}</div>
      </div>
    );
  }
  if (center.kind === "label") {
    return (
      <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: SHARE_CARD_COLORS.ink, textAlign: "center" }}>
        {center.text}
      </div>
    );
  }
  return <div style={{ display: "flex", fontSize: 40, fontWeight: 700, color: SHARE_CARD_COLORS.inkMute }}>{center.text}</div>;
}

function MapCell({ cell, noCode }: Readonly<{ cell: EmbedMapCell; noCode: string }>): ReactElement {
  const color = cell.winnerSide === null ? SHARE_CARD_COLORS.inkMute : MATCH_SIDE_COLORS[cell.winnerSide - 1];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: 328,
        marginRight: 16,
        marginTop: 14,
        padding: "8px 16px",
        borderLeft: `4px solid ${color}`,
        borderRadius: 6,
        backgroundColor: rgba(color, 0.08),
      }}
    >
      <div style={{ display: "flex", fontSize: 22, color: SHARE_CARD_COLORS.inkMute, overflow: "hidden", whiteSpace: "nowrap" }}>
        {cell.label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", marginTop: 2 }}>
        <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: SHARE_CARD_COLORS.ink, marginRight: 16 }}>
          {cell.score}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 24,
            fontWeight: cell.code ? 700 : 400,
            letterSpacing: cell.code ? 2 : 0,
            color: cell.code ? SHARE_CARD_COLORS.blueSoft : SHARE_CARD_COLORS.inkMute,
          }}
        >
          {cell.code ?? noCode}
        </div>
      </div>
    </div>
  );
}

/** La carte d'un match, prête à être passée à `ImageResponse`. */
export function MatchShareCard({
  eyebrow,
  state,
  title,
  subtitle,
  team1,
  team2,
  center,
  maps,
  moreMaps,
  noCode,
  footer,
  logoSrc,
}: Readonly<MatchShareCardProps>): ReactElement {
  const rows: EmbedMapCell[][] = [];
  for (let index = 0; index < maps.length; index += MAPS_PER_ROW) rows.push(maps.slice(index, index + MAPS_PER_ROW));
  return (
    <ShareCardFrame logoSrc={logoSrc} footer={footer}>
      <div style={{ display: "flex", flexDirection: "column", flexShrink: 1, minHeight: 0, overflow: "hidden" }}>
        <ShareCardBadges eyebrow={eyebrow} state={state} />
        <div style={{ display: "flex", alignItems: "baseline", marginTop: 18 }}>
          <div
            style={{
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 1,
              textOverflow: "ellipsis",
              overflow: "hidden",
              maxWidth: 680,
              fontSize: 34,
              fontWeight: 700,
              paddingBottom: 6,
            }}
          >
            {title}
          </div>
          <div style={{ display: "flex", marginLeft: 18, fontSize: 26, color: SHARE_CARD_COLORS.inkMute }}>
            {/* Maps au-delà des cases : comptées ici, les trois lignes sont pleines. */}
            {moreMaps ? `${subtitle} · ${moreMaps}` : subtitle}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 18 }}>
          <Side team={team1} color={MATCH_SIDE_COLORS[0]} align="left" />
          <Center center={center} />
          <Side team={team2} color={MATCH_SIDE_COLORS[1]} align="right" />
        </div>

        {rows.map((row, rowIndex) => (
          <div key={rowIndex} style={{ display: "flex" }}>
            {row.map((cell) => (
              <MapCell key={cell.label} cell={cell} noCode={noCode} />
            ))}
          </div>
        ))}
      </div>
    </ShareCardFrame>
  );
}
