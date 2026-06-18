"use client";

import { FormEvent, useState } from "react";
import type { BracketMatch, BracketType } from "@/lib/shared/types";
import { BracketTree, MatchScoreDraft } from "./BracketTree";

/** Couleur d'accent par tableau — distingue d'un coup d'œil principal / perdants / finale. */
const ACCENT: Record<BracketType, string> = {
  UPPER: "var(--blue-500, #5ac8ff)",
  LOWER: "var(--amber, #f5a524)",
  GRAND: "var(--blue-300, #8fd5ff)",
  THIRD_PLACE: "var(--ink-mute, #93a3b2)",
};

interface BracketSection {
  /** Clé stable (nom du stade) pour piloter l'état ouvert/fermé. */
  key: string;
  title: string;
  rounds: number[];
  roundIdxBase: number;
  /** Libellé « Qualifié en X » menant au stade suivant (null = dernière section). */
  qualifyLabel: string | null;
}

/** Nom de stade d'un round, à partir de la fin du tableau (0 = round le plus précoce). */
function stageName(globalIdx: number, totalRounds: number, bracketType: BracketType): string {
  if (bracketType === "GRAND") return "Grande Finale";
  if (bracketType === "THIRD_PLACE") return "Petite Finale";
  const fromEnd = totalRounds - 1 - globalIdx;
  if (fromEnd === 0) return bracketType === "LOWER" ? "Finale perdants" : "Finale";
  if (fromEnd === 1) return "Demi-finales";
  if (fromEnd === 2) return "Quarts de finale";
  if (fromEnd === 3) return "8èmes de finale";
  return "Premiers tours";
}

/** Libellé « Qualifié en X » dérivé du nom du stade suivant. */
function qualifyLabelFor(nextStage: string): string {
  switch (nextStage) {
    case "8èmes de finale": return "Qualifié en 8ème de finale";
    case "Quarts de finale": return "Qualifié en quart de finale";
    case "Demi-finales": return "Qualifié en demi-finale";
    case "Finale": return "Qualifié en finale";
    case "Finale perdants": return "Qualifié en finale perdants";
    case "Grande Finale": return "Qualifié en grande finale";
    default: return `Qualifié en ${nextStage.toLowerCase()}`;
  }
}

/** Découpe les rounds d'un tableau en sections : « Premiers tours » groupé, puis un volet par stade. */
function buildSections(roundNums: number[], bracketType: BracketType): BracketSection[] {
  const totalRounds = roundNums.length;
  const sections: BracketSection[] = [];

  roundNums.forEach((roundNum, idx) => {
    const stage = stageName(idx, totalRounds, bracketType);
    const last = sections[sections.length - 1];
    if (last && last.key === stage) {
      last.rounds.push(roundNum);
    } else {
      sections.push({ key: stage, title: stage, rounds: [roundNum], roundIdxBase: idx, qualifyLabel: null });
    }
  });

  // Le badge terminal d'une section pointe vers le stade de la section suivante.
  for (let i = 0; i < sections.length - 1; i++) {
    sections[i].qualifyLabel = qualifyLabelFor(sections[i + 1].title);
  }

  return sections;
}

/**
 * Détermine la section à ouvrir par défaut : celle du prochain match du joueur,
 * sinon le round actif (premier non terminé), sinon la dernière (finale).
 */
function defaultOpenKey(
  sections: BracketSection[],
  matches: BracketMatch[],
  myTeamId: number | null,
): string | null {
  if (!sections.length) return null;

  const sectionOfRound = (roundNum: number) =>
    sections.find((s) => s.rounds.includes(roundNum))?.key ?? null;

  if (myTeamId !== null) {
    const mine = matches
      .filter((m) => (m.team1Id === myTeamId || m.team2Id === myTeamId) && m.winnerTeamId === null)
      .sort((a, b) => a.roundNumber - b.roundNumber)[0];
    if (mine) return sectionOfRound(mine.roundNumber);
  }

  const active = matches
    .filter((m) => m.status !== "COMPLETED")
    .sort((a, b) => a.roundNumber - b.roundNumber)[0];
  if (active) return sectionOfRound(active.roundNumber);

  return sections[sections.length - 1].key;
}

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

          return (
            <div
              key={section.key}
              style={{
                border: `1px solid ${open ? accent : "var(--border, #444)"}`,
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
              </button>

              {open && (
                <div style={{ padding: "4px 14px 0" }}>
                  <BracketTree
                    matches={sectionMatches}
                    allTournamentMatches={allTournamentMatches}
                    bracketType={bracketType}
                    totalRoundsGlobal={totalRounds}
                    roundIdxBase={section.roundIdxBase}
                    qualifyLabel={section.qualifyLabel}
                    accentColor={accent}
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
