"use client";

import { CSSProperties, FormEvent, Fragment, useEffect, useRef } from "react";
import type { BracketMatch, BracketType } from "@/lib/shared/types";
import { MatchRow } from "./MatchRow";

export type MatchScoreDraft = Record<number, { myScore: string; opponentScore: string }>;

const SLOT_H = 140;
const CARD_W = 210;
const CONN_W = 40;
const BADGE_W = 190;
const BORDER = "var(--border, #444)";
// Hauteur du libellé de match (lignes 11px) + le gap de 2px qui le sépare de la
// carte : la carte est donc décalée de la moitié vers le bas dans son créneau.
// On recadre les traits/badges sur le centre réel de la carte, pas du créneau.
const LABEL_OFFSET = 6.5;

/** Requête de défilement vers un match (le nonce force le re-déclenchement à chaque clic). */
export type ScrollRequest = { matchId: number; nonce: number };

interface BracketTreeProps {
  /** Matches de la section uniquement (un ou plusieurs rounds consécutifs). */
  matches: BracketMatch[];
  allTournamentMatches: BracketMatch[];
  bracketType: BracketType;
  /** Nombre total de rounds du tableau complet (pour nommer les stades). */
  totalRoundsGlobal: number;
  /** Index global du premier round de la section (0 = round le plus précoce du tableau). */
  roundIdxBase: number;
  /** Libellé du badge terminal « Qualifié en X » (null = dernière section, pas de badge). */
  qualifyLabel: string | null;
  /** Couleur d'accent du tableau (distingue principal / perdants / finale). */
  accentColor: string;
  /** Match du joueur à mettre en évidence et vers lequel défiler à l'ouverture (null = aucun). */
  scrollTargetMatchId: number | null;
  /** Défilement à la demande (clic sur un badge de qualification) ; null = aucun. */
  scrollRequest: ScrollRequest | null;
  /** Clic sur le badge « Qualifié en X » : ouvre/défile vers le match de destination. */
  onQualifyClick?: (sourceMatch: BracketMatch) => void;
  canReport: (m: BracketMatch) => boolean;
  adminResolvable: (m: BracketMatch) => boolean;
  drafts: MatchScoreDraft;
  onScoreChange: (matchId: number, field: "myScore" | "opponentScore", value: string) => void;
  onSubmit: (match: BracketMatch, e: FormEvent) => Promise<void>;
  onOpenAdminModal: (match: BracketMatch) => void;
}

export function BracketTree({
  matches,
  allTournamentMatches,
  bracketType,
  totalRoundsGlobal,
  roundIdxBase,
  qualifyLabel,
  accentColor,
  scrollTargetMatchId,
  scrollRequest,
  onQualifyClick,
  canReport,
  adminResolvable,
  drafts,
  onScoreChange,
  onSubmit,
  onOpenAdminModal,
}: BracketTreeProps) {
  const matchRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const didScrollRef = useRef(false);
  const setMatchRef = (id: number) => (el: HTMLDivElement | null) => {
    if (el) matchRefs.current.set(id, el);
    else matchRefs.current.delete(id);
  };
  const scrollToMatch = (id: number) => {
    const node = matchRefs.current.get(id);
    if (!node) return undefined;
    const raf = window.requestAnimationFrame(() => {
      node.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    });
    return () => window.cancelAnimationFrame(raf);
  };

  // Au montage, centre la vue sur le match du joueur (scroll page + scroll horizontal du bracket).
  useEffect(() => {
    if (scrollTargetMatchId === null || didScrollRef.current) return;
    if (!matchRefs.current.has(scrollTargetMatchId)) return;
    didScrollRef.current = true;
    return scrollToMatch(scrollTargetMatchId);
  }, [scrollTargetMatchId]);

  // Défilement à la demande (clic sur un badge) : se déclenche à chaque nouveau nonce
  // si le match de destination est rendu dans cette section.
  useEffect(() => {
    if (!scrollRequest) return;
    return scrollToMatch(scrollRequest.matchId);
  }, [scrollRequest]);

  const roundNums = [...new Set(matches.map((m) => m.roundNumber))].sort((a, b) => a - b);
  const totalRounds = roundNums.length;

  const matchesByRound = new Map(
    roundNums.map((rn) => [
      rn,
      matches.filter((m) => m.roundNumber === rn).sort((a, b) => a.matchNumber - b.matchNumber),
    ]),
  );

  const maxMatchCount = Math.max(...[...matchesByRound.values()].map((ms) => ms.length));
  const totalH = maxMatchCount * SLOT_H;

  const slotHByRound = new Map(
    roundNums.map((rn) => [rn, totalH / matchesByRound.get(rn)!.length]),
  );

  // Stade nommé à partir de la fin du tableau complet (index global).
  const roundLabel = (globalIdx: number) => {
    if (bracketType === "GRAND") return "Grande Finale";
    if (bracketType === "THIRD_PLACE") return "Petite Finale";
    const fromEnd = totalRoundsGlobal - 1 - globalIdx;
    if (fromEnd === 0) return bracketType === "LOWER" ? "Finale perdants" : "Finale";
    if (fromEnd === 1) return "Demi-finales";
    if (fromEnd === 2) return "Quarts de finale";
    if (fromEnd === 3) return "8èmes de finale";
    return `Round ${globalIdx + 1}`;
  };

  const matchLabel = (matchNum: number, globalIdx: number) => {
    if (bracketType === "GRAND") return null;
    if (bracketType === "THIRD_PLACE") return null;
    const fromEnd = totalRoundsGlobal - 1 - globalIdx;
    if (fromEnd === 0) return bracketType === "LOWER" ? `Finale perdants ${matchNum}` : `Finale ${matchNum}`;
    if (fromEnd === 1) return `Demi finale ${matchNum}`;
    if (fromEnd === 2) return `Quart de finale ${matchNum}`;
    if (fromEnd === 3) return `8ème de finale ${matchNum}`;
    return `Match ${matchNum}`;
  };

  // Décalage vertical pour aligner traits/badges sur le centre de la carte (et non
  // du créneau) : non nul uniquement quand le round affiche un libellé au-dessus.
  const roundOffset = (globalIdx: number) => (matchLabel(1, globalIdx) !== null ? LABEL_OFFSET : 0);

  return (
    <div
      style={{
        display: "flex",
        overflowX: "auto",
        overflowY: "visible",
        paddingBottom: 16,
        marginBottom: 8,
        scrollBehavior: "smooth",
        minHeight: "fit-content",
      }}
      className="bracket-scroll"
    >
      {roundNums.map((roundNum, roundIdx) => {
        const roundMatches = matchesByRound.get(roundNum)!;
        const slotH = slotHByRound.get(roundNum)!;
        const globalIdx = roundIdxBase + roundIdx;
        const isLast = roundIdx === totalRounds - 1;
        const nextRoundNum = roundNums[roundIdx + 1];
        const nextSlotH = nextRoundNum !== undefined ? slotHByRound.get(nextRoundNum)! : 0;
        const nextRoundMatches = nextRoundNum !== undefined ? (matchesByRound.get(nextRoundNum) ?? []) : [];

        return (
          <div key={roundNum} style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
            <div
              style={{
                height: 26,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: CARD_W + (isLast ? 0 : CONN_W),
                fontSize: 11,
                color: "var(--text-2)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              {roundLabel(globalIdx)}
            </div>

            <div style={{ display: "flex" }}>
              <div style={{ width: CARD_W, flexShrink: 0 }}>
                {roundMatches.map((match) => {
                  const label = matchLabel(match.matchNumber, globalIdx);
                  const isTarget = match.id === scrollTargetMatchId;
                  return (
                    <div
                      key={match.id}
                      ref={setMatchRef(match.id)}
                      style={{ height: slotH, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: label || isTarget ? 2 : 0, scrollMargin: 80 }}
                    >
                      {(label || isTarget) && (
                        <div style={{ fontSize: 11, color: isTarget ? accentColor : "var(--text-2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", lineHeight: 1 }}>
                          {isTarget ? `★ ${label ?? "Votre match"}` : label}
                        </div>
                      )}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          borderRadius: 8,
                          ...(isTarget
                            ? { boxShadow: `0 0 0 2px ${accentColor}, 0 0 14px ${accentColor}` }
                            : {}),
                        }}
                      >
                        <MatchRow
                          match={match}
                          reportable={canReport(match)}
                          adminResolvable={adminResolvable(match)}
                          onScoreChange={onScoreChange}
                          myScore={drafts[match.id]?.myScore || ""}
                          opponentScore={drafts[match.id]?.opponentScore || ""}
                          onSubmit={onSubmit}
                          onOpenAdminModal={onOpenAdminModal}
                          allMatches={allTournamentMatches}
                          roundNumber={roundNum}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {!isLast && (
                <div style={{ width: CONN_W, height: totalH, flexShrink: 0, position: "relative" }}>
                  {roundMatches.map((match, matchIdx) => {
                    const sourceCenterY = (matchIdx + 0.5) * slotH + roundOffset(globalIdx);

                    const leftStub: CSSProperties = {
                      position: "absolute",
                      top: Math.round(sourceCenterY) - 1,
                      left: 0,
                      width: "50%",
                      height: 2,
                      background: BORDER,
                    };

                    const targetId = match.nextWinnerMatchId ?? match.nextLoserMatchId;
                    if (!targetId) {
                      return <div key={match.id} style={leftStub} />;
                    }

                    const targetMatchIdx = nextRoundMatches.findIndex((m) => m.id === targetId);
                    if (targetMatchIdx < 0) {
                      return <div key={match.id} style={leftStub} />;
                    }

                    const targetCenterY = (targetMatchIdx + 0.5) * nextSlotH + roundOffset(globalIdx + 1);

                    const vertTop = Math.round(Math.min(sourceCenterY, targetCenterY));
                    const vertBottom = Math.round(Math.max(sourceCenterY, targetCenterY));
                    const hasVertical = vertBottom > vertTop;

                    return (
                      <Fragment key={match.id}>
                        <div style={leftStub} />
                        {hasVertical && (
                          <div
                            style={{
                              position: "absolute",
                              left: "calc(50% - 1px)",
                              width: 2,
                              top: vertTop,
                              height: vertBottom - vertTop,
                              background: BORDER,
                            }}
                          />
                        )}
                        <div
                          style={{
                            position: "absolute",
                            top: Math.round(targetCenterY) - 1,
                            left: "50%",
                            right: 0,
                            height: 2,
                            background: BORDER,
                          }}
                        />
                      </Fragment>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {qualifyLabel && (
        <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <div style={{ height: 26 }} />
          <div style={{ width: CONN_W + BADGE_W, height: totalH, flexShrink: 0, position: "relative" }}>
            {(() => {
              const lastRoundNum = roundNums[roundNums.length - 1];
              const lastMatches = matchesByRound.get(lastRoundNum)!;
              const lastSlotH = slotHByRound.get(lastRoundNum)!;
              const lastGlobalIdx = roundIdxBase + roundNums.length - 1;
              return lastMatches.map((match, matchIdx) => {
                const centerY = (matchIdx + 0.5) * lastSlotH + roundOffset(lastGlobalIdx);
                const dest = match.nextWinnerMatchId ?? match.nextLoserMatchId;
                const clickable = onQualifyClick != null && dest != null;
                const badgeStyle: CSSProperties = {
                  position: "absolute",
                  top: Math.round(centerY) - 13,
                  left: CONN_W,
                  width: BADGE_W,
                  height: 26,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "0 10px",
                  margin: 0,
                  boxSizing: "border-box",
                  border: `1px solid ${accentColor}`,
                  borderRadius: 6,
                  background: "var(--surface-1)",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.03em",
                  textTransform: "uppercase",
                  color: accentColor,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  cursor: clickable ? "pointer" : "default",
                  textAlign: "left",
                  font: "inherit",
                };
                const badgeInner = (
                  <>
                    <span aria-hidden style={{ fontSize: 12 }}>↳</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{qualifyLabel}</span>
                  </>
                );
                return (
                  <Fragment key={match.id}>
                    <div
                      style={{
                        position: "absolute",
                        top: Math.round(centerY) - 1,
                        left: 0,
                        width: CONN_W,
                        height: 2,
                        background: accentColor,
                        opacity: 0.5,
                      }}
                    />
                    {clickable ? (
                      <button
                        type="button"
                        onClick={() => onQualifyClick!(match)}
                        title={`${qualifyLabel} — aller au match`}
                        style={badgeStyle}
                      >
                        {badgeInner}
                      </button>
                    ) : (
                      <div style={badgeStyle} title={qualifyLabel ?? undefined}>
                        {badgeInner}
                      </div>
                    )}
                  </Fragment>
                );
              });
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
