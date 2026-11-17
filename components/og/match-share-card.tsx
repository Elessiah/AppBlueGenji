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
import type { EmbedMapCell, EmbedSchedule, EmbedScoreCenter, EmbedTeamMark } from "@/lib/shared/share-embed-cards";
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
  /** Horaire d'un match à venir, en grand sous les équipes. */
  schedule?: EmbedSchedule | null;
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
  dimLoser,
}: Readonly<{ team: MatchShareCardProps["team1"]; color: string; align: "left" | "right"; dimLoser: boolean }>): ReactElement {
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
        maxWidth: 290,
        margin: align === "left" ? "0 0 0 22px" : "0 22px 0 0",
        fontSize: 34,
        lineHeight: 1.12,
        fontWeight: 700,
        textAlign: align,
        // Le vainqueur garde l'encre pleine, l'autre passe en retrait — mais
        // seulement quand il y en a un : sans vainqueur, personne n'a perdu.
        color: team.winner || !dimLoser ? SHARE_CARD_COLORS.ink : SHARE_CARD_COLORS.inkMute,
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
    // Largeur bornée (1056 − 2 × 400) et deux lignes au plus : un nom long
    // dans « Forfait : … » ne dilate pas le tableau d'affichage.
    return (
      <div
        style={{
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
          textOverflow: "ellipsis",
          overflow: "hidden",
          wordBreak: "break-word",
          width: 240,
          fontSize: 26,
          lineHeight: 1.15,
          fontWeight: 700,
          color: SHARE_CARD_COLORS.ink,
          textAlign: "center",
        }}
      >
        {center.text}
      </div>
    );
  }
  return <div style={{ display: "flex", fontSize: 40, fontWeight: 700, color: SHARE_CARD_COLORS.inkMute }}>{center.text}</div>;
}

function MapCell({ cell, noCode }: Readonly<{ cell: EmbedMapCell; noCode: string }>): ReactElement {
  const longCode = cell.code !== null && cell.code.length > 14;
  let letterSpacing = 0;
  if (cell.code !== null) letterSpacing = longCode ? 1 : 2;
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
      <div
        style={{
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 1,
          textOverflow: "ellipsis",
          overflow: "hidden",
          fontSize: 22,
          color: SHARE_CARD_COLORS.inkMute,
        }}
      >
        {cell.label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", marginTop: 2 }}>
        <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: SHARE_CARD_COLORS.ink, marginRight: 16 }}>
          {cell.score}
        </div>
        <div
          style={{
            display: "flex",
            flexShrink: 1,
            minWidth: 0,
            // Un code long (jusqu'à 32 signes) passe à la ligne plutôt que
            // d'être rogné : c'est lui qu'on vient chercher.
            wordBreak: "break-all",
            fontSize: longCode ? 20 : 24,
            fontWeight: cell.code ? 700 : 400,
            letterSpacing,
            color: cell.code ? SHARE_CARD_COLORS.blueSoft : SHARE_CARD_COLORS.inkMute,
          }}
        >
          {cell.code ?? noCode}
        </div>
      </div>
    </div>
  );
}

/**
 * L'horaire d'un match à venir : la ligne principale de la carte, sous les
 * équipes, avec son fuseau. Une ligne au plus (rognée à la largeur de la
 * carte) : un horaire n'a jamais besoin de plus.
 */
function Schedule({ schedule }: Readonly<{ schedule: EmbedSchedule }>): ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 26 }}>
      <div
        style={{
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 1,
          textOverflow: "ellipsis",
          overflow: "hidden",
          maxWidth: 1056,
          fontSize: 52,
          lineHeight: 1.15,
          fontWeight: 700,
          color: SHARE_CARD_COLORS.cyan,
        }}
      >
        {schedule.when}
      </div>
      <div style={{ display: "flex", marginTop: 6, fontSize: 24, color: SHARE_CARD_COLORS.inkMute }}>{schedule.zone}</div>
    </div>
  );
}

/** Largeur maximale du sous-titre (nom du tour, « +N maps »), qui ne rétrécit pas. */
export const MATCH_SUBTITLE_MAX_WIDTH = 640;
/** Écart entre le titre et le sous-titre. */
export const MATCH_SUBTITLE_GAP = 18;
/**
 * Place que le titre (nom du tournoi) garde au pire, à côté du sous-titre le
 * plus large : 1200 − 2 × 72 (marges) − 640 − 18 = 398 px.
 */
export const MATCH_TITLE_MIN_WIDTH = 360;

/** La carte d'un match, prête à être passée à `ImageResponse`. */
export function MatchShareCard({
  eyebrow,
  state,
  title,
  subtitle,
  schedule = null,
  team1,
  team2,
  center,
  maps,
  moreMaps,
  noCode,
  footer,
  logoSrc,
}: Readonly<MatchShareCardProps>): ReactElement {
  // Les noms ne se mettent en retrait que lorsqu'un camp a gagné.
  const dimLoser = team1.winner || team2.winner;
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
              flexShrink: 1,
              minWidth: 0,
              fontSize: 34,
              fontWeight: 700,
              paddingBottom: 6,
            }}
          >
            {title}
          </div>
          <div
            style={{
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 1,
              textOverflow: "ellipsis",
              overflow: "hidden",
              flexShrink: 0,
              // Assez large pour « Tableau perdants · Quart de finale 12 · +3 maps » :
              // c'est le titre (nom du tournoi) qui cède, pas le numéro du match.
              // Borné : le titre garde au moins `MATCH_TITLE_MIN_WIDTH` (testé).
              maxWidth: MATCH_SUBTITLE_MAX_WIDTH,
              marginLeft: MATCH_SUBTITLE_GAP,
              fontSize: 26,
              color: SHARE_CARD_COLORS.inkMute,
            }}
          >
            {/* Maps au-delà des cases : comptées ici, les trois lignes sont pleines. */}
            {moreMaps ? `${subtitle} · ${moreMaps}` : subtitle}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 18 }}>
          <Side team={team1} color={MATCH_SIDE_COLORS[0]} align="left" dimLoser={dimLoser} />
          <Center center={center} />
          <Side team={team2} color={MATCH_SIDE_COLORS[1]} align="right" dimLoser={dimLoser} />
        </div>

        {schedule ? <Schedule schedule={schedule} /> : null}

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
