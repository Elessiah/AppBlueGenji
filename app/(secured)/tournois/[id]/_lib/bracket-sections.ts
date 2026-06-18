import type { BracketMatch, BracketType } from "@/lib/shared/types";

/** Couleur d'accent par tableau — distingue d'un coup d'œil principal / perdants / finale. */
export const ACCENT: Record<BracketType, string> = {
  UPPER: "var(--blue-500, #5ac8ff)",
  LOWER: "var(--amber, #f5a524)",
  GRAND: "var(--blue-300, #8fd5ff)",
  THIRD_PLACE: "var(--ink-mute, #93a3b2)",
};

export interface BracketSection {
  /** Clé stable (nom du stade) pour piloter l'état ouvert/fermé. */
  key: string;
  title: string;
  rounds: number[];
  roundIdxBase: number;
  /** Libellé « Qualifié en X » menant au stade suivant (null = dernière section). */
  qualifyLabel: string | null;
}

/** Nom de stade d'un round, à partir de la fin du tableau (0 = round le plus précoce). */
export function stageName(globalIdx: number, totalRounds: number, bracketType: BracketType): string {
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
export function qualifyLabelFor(nextStage: string): string {
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
export function buildSections(roundNums: number[], bracketType: BracketType): BracketSection[] {
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

/** Prochain match non terminé du joueur dans ce tableau (null s'il n'y participe pas). */
export function findMyNextMatch(matches: BracketMatch[], myTeamId: number | null): BracketMatch | null {
  if (myTeamId === null) return null;
  return (
    matches
      .filter((m) => (m.team1Id === myTeamId || m.team2Id === myTeamId) && m.winnerTeamId === null)
      .sort((a, b) => a.roundNumber - b.roundNumber)[0] ?? null
  );
}

/**
 * Détermine la section à ouvrir par défaut : celle du prochain match du joueur,
 * sinon le round actif (premier non terminé), sinon la dernière (finale).
 */
export function defaultOpenKey(
  sections: BracketSection[],
  matches: BracketMatch[],
  myTeamId: number | null,
): string | null {
  if (!sections.length) return null;

  const sectionOfRound = (roundNum: number) =>
    sections.find((s) => s.rounds.includes(roundNum))?.key ?? null;

  const mine = findMyNextMatch(matches, myTeamId);
  if (mine) return sectionOfRound(mine.roundNumber);

  const active = matches
    .filter((m) => m.status !== "COMPLETED")
    .sort((a, b) => a.roundNumber - b.roundNumber)[0];
  if (active) return sectionOfRound(active.roundNumber);

  return sections[sections.length - 1].key;
}
