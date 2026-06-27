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

/** Nombre de tours regroupés dans le volet « Phase finale » (quart, demi, finale). */
const FINAL_PHASE_ROUNDS = 3;

/**
 * Découpe les rounds d'un tableau en (au plus) deux volets pour garder des
 * sections denses et lisibles :
 * - « Phase finale » = les 3 derniers tours (quart, demi, finale) regroupés ;
 * - « Premiers tours » = tout ce qui précède, en un seul volet.
 *
 * Quand un volet ne contient qu'un seul tour, il est nommé d'après son stade
 * (ex. « 8èmes de finale », « Finale »). Les tableaux à match unique
 * (GRAND / THIRD_PLACE) restent un volet unique.
 */
export function buildSections(roundNums: number[], bracketType: BracketType): BracketSection[] {
  const totalRounds = roundNums.length;
  if (totalRounds === 0) return [];

  if (bracketType === "GRAND" || bracketType === "THIRD_PLACE") {
    const title = stageName(0, totalRounds, bracketType);
    return [{ key: title, title, rounds: [...roundNums], roundIdxBase: 0, qualifyLabel: null }];
  }

  const finalCount = Math.min(FINAL_PHASE_ROUNDS, totalRounds);
  const splitIdx = totalRounds - finalCount; // nb de tours dans « Premiers tours »
  const sections: BracketSection[] = [];

  if (splitIdx > 0) {
    const firstTitle = splitIdx > 1 ? "Premiers tours" : stageName(0, totalRounds, bracketType);
    sections.push({
      key: firstTitle,
      title: firstTitle,
      rounds: roundNums.slice(0, splitIdx),
      roundIdxBase: 0,
      qualifyLabel: null,
    });
  }

  const finalTitle = finalCount > 1 ? "Phase finale" : stageName(splitIdx, totalRounds, bracketType);
  sections.push({
    key: finalTitle,
    title: finalTitle,
    rounds: roundNums.slice(splitIdx),
    roundIdxBase: splitIdx,
    qualifyLabel: null,
  });

  // Le badge terminal des « Premiers tours » pointe vers le 1er stade de la phase
  // finale (ex. les vainqueurs des 8èmes sont « Qualifié en quart de finale »).
  if (sections.length === 2) {
    sections[0].qualifyLabel = qualifyLabelFor(stageName(splitIdx, totalRounds, bracketType));
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
 *
 * `myNext` est le prochain match du joueur déjà résolu par {@link findMyNextMatch}
 * (passé en paramètre pour éviter de reparcourir les matchs deux fois).
 */
export function defaultOpenKey(
  sections: BracketSection[],
  matches: BracketMatch[],
  myNext: BracketMatch | null,
): string | null {
  if (!sections.length) return null;

  const sectionOfRound = (roundNum: number) =>
    sections.find((s) => s.rounds.includes(roundNum))?.key ?? null;

  if (myNext) return sectionOfRound(myNext.roundNumber);

  const active = matches
    .filter((m) => m.status !== "COMPLETED")
    .sort((a, b) => a.roundNumber - b.roundNumber)[0];
  if (active) return sectionOfRound(active.roundNumber);

  return sections[sections.length - 1].key;
}
