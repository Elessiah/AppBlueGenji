"use client";

import { FormEvent, useState } from "react";
import type { BracketMatch, BracketType } from "@/lib/shared/types";
import { BracketTree, MatchScoreDraft } from "./BracketTree";
import { ACCENT, buildSections, defaultOpenKey, findMyNextMatch } from "../_lib/bracket-sections";

interface BracketSectionsProps {
  bracketType: BracketType;
  bracketLabel: string;
  showBracketLabel: boolean;
  matches: BracketMatch[];
  allTournamentMatches: BracketMatch[];
  myTeamId: number | null;
  canReport: (m: BracketMatch) => boolean;
  adminResolvable: (m: BracketMatch) => boolean;
  drafts: MatchScoreDraft;
  onScoreChange: (matchId: number, field: "myScore" | "opponentScore", value: string) => void;
  onSubmit: (match: BracketMatch, e: FormEvent) => Promise<void>;
  onOpenAdminModal: (match: BracketMatch) => void;
}

export function BracketSections({
  bracketType,
  bracketLabel,
  showBracketLabel,
  matches,
  allTournamentMatches,
  myTeamId,
  canReport,
  adminResolvable,
  drafts,
  onScoreChange,
  onSubmit,
  onOpenAdminModal,
}: BracketSectionsProps) {
  const roundNums = [...new Set(matches.map((m) => m.roundNumber))].sort((a, b) => a - b);
  const totalRounds = roundNums.length;
  const sections = buildSections(roundNums, bracketType);
  const accent = ACCENT[bracketType];
  const myNext = findMyNextMatch(matches, myTeamId);
  const myNextMatchId = myNext?.id ?? null;
  const regionBaseId = `bracket-${bracketType.toLowerCase()}`;

  const [openKeys, setOpenKeys] = useState<Set<string>>(() => {
    const initial = defaultOpenKey(sections, matches, myTeamId);
    return new Set(initial ? [initial] : []);
  });

  const toggle = (key: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div>
      {showBracketLabel && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ width: 3, height: 16, background: accent, borderRadius: 2 }} />
          <p
            style={{
              margin: 0,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: accent,
            }}
          >
            {bracketLabel}
          </p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {sections.map((section) => {
          const open = openKeys.has(section.key);
          const sectionMatches = matches.filter((m) => section.rounds.includes(m.roundNumber));
          const matchCount = sectionMatches.length;
          const hasMyMatch = myNext !== null && section.rounds.includes(myNext.roundNumber);
          const panelId = `${regionBaseId}-${section.key.replace(/\s+/g, "-")}`;

          return (
            <div
              key={section.key}
              style={{
                border: `1px solid ${open || hasMyMatch ? accent : "var(--border, #444)"}`,
                borderLeft: `3px solid ${accent}`,
                borderRadius: 8,
                overflow: "hidden",
                background: "var(--surface-0, rgba(255,255,255,0.02))",
              }}
            >
              <button
                type="button"
                onClick={() => toggle(section.key)}
                aria-expanded={open}
                aria-controls={panelId}
                onMouseEnter={(e) => {
                  if (!open) e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                }}
                onMouseLeave={(e) => {
                  if (!open) e.currentTarget.style.background = "transparent";
                }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  background: open ? "rgba(255,255,255,0.03)" : "transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  color: "var(--text-0)",
                  transition: "background 0.15s ease",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    display: "inline-block",
                    transition: "transform 0.18s ease",
                    transform: open ? "rotate(90deg)" : "rotate(0deg)",
                    color: accent,
                    fontSize: 12,
                  }}
                >
                  ▶
                </span>
                <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                  {section.title}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--text-2)",
                    fontWeight: 500,
                    border: "1px solid var(--border, #444)",
                    borderRadius: 999,
                    padding: "1px 8px",
                  }}
                >
                  {matchCount} match{matchCount > 1 ? "s" : ""}
                </span>
                {hasMyMatch && (
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      color: accent,
                      border: `1px solid ${accent}`,
                      borderRadius: 999,
                      padding: "1px 10px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    ★ Votre match
                  </span>
                )}
              </button>

              {open && (
                <div id={panelId} role="region" aria-label={section.title} style={{ padding: "4px 14px 0" }}>
                  <BracketTree
                    matches={sectionMatches}
                    allTournamentMatches={allTournamentMatches}
                    bracketType={bracketType}
                    totalRoundsGlobal={totalRounds}
                    roundIdxBase={section.roundIdxBase}
                    qualifyLabel={section.qualifyLabel}
                    accentColor={accent}
                    scrollTargetMatchId={myNextMatchId}
                    canReport={canReport}
                    adminResolvable={adminResolvable}
                    drafts={drafts}
                    onScoreChange={onScoreChange}
                    onSubmit={onSubmit}
                    onOpenAdminModal={onOpenAdminModal}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
