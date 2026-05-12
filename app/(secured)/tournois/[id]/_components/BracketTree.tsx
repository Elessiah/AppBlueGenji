"use client";

import { CSSProperties, FormEvent, Fragment } from "react";
import type { BracketMatch, BracketType } from "@/lib/shared/types";
import { MatchRow } from "./MatchRow";

export type MatchScoreDraft = Record<number, { myScore: string; opponentScore: string }>;

const SLOT_H = 140;
const CARD_W = 210;
const CONN_W = 40;
const BORDER = "var(--border, #444)";

interface BracketTreeProps {
  matches: BracketMatch[];
  allTournamentMatches: BracketMatch[];
  bracketType: BracketType;
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
  canReport,
  adminResolvable,
  drafts,
  onScoreChange,
  onSubmit,
  onOpenAdminModal,
}: BracketTreeProps) {
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

  const roundLabel = (roundNum: number, idx: number) => {
    if (bracketType === "GRAND") return "Grande Finale";
    if (bracketType === "THIRD_PLACE") return "Petite Finale";
    if (idx === totalRounds - 1) return bracketType === "LOWER" ? "Finale perdants" : "Finale";
    return `Round ${roundNum}`;
  };

  const matchLabel = (matchNum: number, idx: number) => {
    if (bracketType === "GRAND") return null;
    if (bracketType === "THIRD_PLACE") return null;
    if (idx === totalRounds - 1) return bracketType === "LOWER" ? `Finale perdants ${matchNum}` : `Finale ${matchNum}`;
    if (idx === totalRounds - 2) return `Demi finale ${matchNum}`;
    if (idx === totalRounds - 3) return `Quart de finale ${matchNum}`;
    return `Match ${matchNum}`;
  };

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
              {roundLabel(roundNum, roundIdx)}
            </div>

            <div style={{ display: "flex" }}>
              <div style={{ width: CARD_W, flexShrink: 0 }}>
                {roundMatches.map((match) => {
                  const label = matchLabel(match.matchNumber, roundIdx);
                  return (
                    <div key={match.id} style={{ height: slotH, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: label ? 2 : 0 }}>
                      {label && (
                        <div style={{ fontSize: 11, color: "var(--text-2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", lineHeight: 1 }}>
                          {label}
                        </div>
                      )}
                      <div style={{ display: "flex", alignItems: "center" }}>
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
                    const sourceCenterY = (matchIdx + 0.5) * slotH;

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

                    const targetCenterY = (targetMatchIdx + 0.5) * nextSlotH;

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
    </div>
  );
}
