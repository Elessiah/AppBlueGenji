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
    // Stade intermédiaire générique (gros tableau / tableau perdants découpé en paquets).
    case "Premiers tours": return "Qualifié au tour suivant";
    default: return `Qualifié en ${nextStage.toLowerCase()}`;
  }
}

/** Nombre de tours regroupés dans le volet « Phase finale » (quart, demi, finale). */
const FINAL_PHASE_ROUNDS = 3;
/** Largeur max d'un volet de premiers tours avant de le scinder en paquets. */
const MAX_CHUNK_ROUNDS = 4;

/** Découpe un tableau d'éléments en `c = ceil(n/max)` paquets de tailles ~égales (diff ≤ 1). */
function chunkEvenly<T>(items: T[], maxSize: number): T[][] {
  const n = items.length;
  if (n === 0) return [];
  const count = Math.ceil(n / maxSize);
  const base = Math.floor(n / count);
  const remainder = n % count;
  const chunks: T[][] = [];
  let i = 0;
  for (let k = 0; k < count; k += 1) {
    const size = base + (k < remainder ? 1 : 0);
    chunks.push(items.slice(i, i + size));
    i += size;
  }
  return chunks;
}

/**
 * Découpe les rounds d'un tableau en volets denses et lisibles :
 * - « Phase finale » = les 3 derniers tours (quart, demi, finale) regroupés ;
 * - les tours précédents = un ou plusieurs paquets d'au plus {@link MAX_CHUNK_ROUNDS}
 *   colonnes (important pour le tableau des perdants, bien plus long que le principal).
 *
 * Un volet d'un seul tour est nommé d'après son stade (« 8èmes de finale »…), un
 * paquet unique de premiers tours « Premiers tours », et plusieurs paquets
 * « Tours A à B ». Les tableaux à match unique (GRAND / THIRD_PLACE) restent uniques.
 */
export function buildSections(roundNums: number[], bracketType: BracketType): BracketSection[] {
  const totalRounds = roundNums.length;
  if (totalRounds === 0) return [];

  if (bracketType === "GRAND" || bracketType === "THIRD_PLACE") {
    const title = stageName(0, totalRounds, bracketType);
    return [{ key: title, title, rounds: [...roundNums], roundIdxBase: 0, qualifyLabel: null }];
  }

  const finalCount = Math.min(FINAL_PHASE_ROUNDS, totalRounds);
  const splitIdx = totalRounds - finalCount; // nb de tours avant la phase finale
  const sections: BracketSection[] = [];

  // Premiers tours, scindés en paquets si le tableau est long (cas du tableau perdants).
  const earlyChunks = chunkEvenly(roundNums.slice(0, splitIdx), MAX_CHUNK_ROUNDS);
  const singleEarly = earlyChunks.length === 1;
  let base = 0;
  earlyChunks.forEach((chunk) => {
    const title =
      chunk.length === 1
        ? stageName(base, totalRounds, bracketType)
        : singleEarly
          ? "Premiers tours"
          : `Tours ${chunk[0]} à ${chunk[chunk.length - 1]}`;
    sections.push({ key: title, title, rounds: chunk, roundIdxBase: base, qualifyLabel: null });
    base += chunk.length;
  });

  // Phase finale (les 3 derniers tours).
  const finalTitle = finalCount > 1 ? "Phase finale" : stageName(splitIdx, totalRounds, bracketType);
  sections.push({
    key: finalTitle,
    title: finalTitle,
    rounds: roundNums.slice(splitIdx),
    roundIdxBase: splitIdx,
    qualifyLabel: null,
  });

  // Chaque volet (sauf le dernier) pointe vers le 1er stade du volet suivant
  // (ex. vainqueurs des 8èmes → « Qualifié en quart de finale » ; entre deux paquets
  // de premiers tours → « Qualifié au tour suivant »).
  for (let i = 0; i < sections.length - 1; i += 1) {
    sections[i].qualifyLabel = qualifyLabelFor(stageName(sections[i + 1].roundIdxBase, totalRounds, bracketType));
  }

  return sections;
}

/**
 * Match d'arrivée d'un badge « Qualifié en X » : le vainqueur avance toujours vers
 * `nextWinnerMatchId`. C'est exactement le match dans lequel le moteur place l'équipe
 * gagnante (cf. `pushTeamToTarget` côté serveur), donc la redirection au clic mène
 * précisément là où l'équipe qualifiée jouera. `null` = pas de match suivant (finale).
 */
export function qualifyDestinationMatchId(match: BracketMatch): number | null {
  return match.nextWinnerMatchId;
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
