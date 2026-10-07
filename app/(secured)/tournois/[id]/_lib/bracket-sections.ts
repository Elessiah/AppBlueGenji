import type { BracketMatch, BracketType } from "@/lib/shared/types";
import { isMatchPlayed } from "@/lib/shared/match-outcome";
import { FR_TOURNAMENT_PAGE_TEXT, type TournamentPageText } from "@/lib/shared/tournament-page-text";

/** Couleur d'accent par tableau — distingue d'un coup d'œil principal / perdants / finale. */
export const ACCENT: Record<BracketType, string> = {
  UPPER: "var(--blue-500, #5ac8ff)",
  LOWER: "var(--violet-400, #a78bfa)",
  GRAND: "var(--blue-300, #8fd5ff)",
  THIRD_PLACE: "var(--ink-mute, #93a3b2)",
};

export interface BracketSection {
  /**
   * Clé d'identité du volet, pour piloter l'état ouvert/fermé.
   *
   * C'est le **numéro du premier tour** de la section, et non son titre : un
   * titre change quand la section grandit (« Finale » devient « Phase finale »
   * dès qu'un second tour la rejoint), et l'état ouvert, gardé par clé, ne
   * correspondait alors plus à aucune section — le volet se refermait tout
   * seul. Les tableaux à élimination naissent complets et n'ont jamais vu le
   * problème ; l'arbre de BlueGenji Survie, lui, pousse un tour à la fois.
   */
  key: string;
  title: string;
  rounds: number[];
  roundIdxBase: number;
  /** Libellé « Qualifié en X » menant au stade suivant (null = dernière section). */
  qualifyLabel: string | null;
}

/** Nom de stade d'un round, à partir de la fin du tableau (0 = round le plus précoce). */
export type StageKey =
  | "grandFinal"
  | "thirdPlace"
  | "lowerFinal"
  | "final"
  | "semis"
  | "quarters"
  | "roundOf16"
  | "early";

/** Stade d'un tour, par sa distance à la finale (lot 8a-2 : une clé, traduite à l'écran). */
export function stageKey(globalIdx: number, totalRounds: number, bracketType: BracketType): StageKey {
  if (bracketType === "GRAND") return "grandFinal";
  if (bracketType === "THIRD_PLACE") return "thirdPlace";
  const fromEnd = totalRounds - 1 - globalIdx;
  if (fromEnd === 0) return bracketType === "LOWER" ? "lowerFinal" : "final";
  if (fromEnd === 1) return "semis";
  if (fromEnd === 2) return "quarters";
  if (fromEnd === 3) return "roundOf16";
  return "early";
}

export function stageName(
  globalIdx: number,
  totalRounds: number,
  bracketType: BracketType,
  text: TournamentPageText = FR_TOURNAMENT_PAGE_TEXT,
): string {
  return text.t(`bracket.stage.${stageKey(globalIdx, totalRounds, bracketType)}`);
}

/** Libellé « Qualifié en X » dérivé du nom du stade suivant. */
export function qualifyLabelFor(nextStage: StageKey, text: TournamentPageText = FR_TOURNAMENT_PAGE_TEXT): string {
  return text.t(`bracket.qualify.${nextStage}`);
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
export function buildSections(
  roundNums: number[],
  bracketType: BracketType,
  plannedRounds?: number,
  text: TournamentPageText = FR_TOURNAMENT_PAGE_TEXT,
): BracketSection[] {
  const totalRounds = roundNums.length;
  if (totalRounds === 0) return [];

  // Le découpage porte sur les tours **posés** (on ne fait pas un volet pour ce
  // qui n'existe pas), mais les stades se nomment sur le nombre de tours
  // **prévus** : « quart de finale » n'a de sens que rapporté à la fin du
  // tableau. Les deux ne coïncident que si le plateau naît complet.
  const stageTotal = Math.max(plannedRounds ?? totalRounds, totalRounds);

  if (bracketType === "GRAND" || bracketType === "THIRD_PLACE") {
    const title = stageName(0, stageTotal, bracketType, text);
    return [
      { key: String(roundNums[0]), title, rounds: [...roundNums], roundIdxBase: 0, qualifyLabel: null },
    ];
  }

  const finalCount = Math.min(FINAL_PHASE_ROUNDS, totalRounds);
  const splitIdx = totalRounds - finalCount; // nb de tours avant la phase finale
  const sections: BracketSection[] = [];

  // Premiers tours, scindés en paquets si le tableau est long (cas du tableau perdants).
  const earlyChunks = chunkEvenly(roundNums.slice(0, splitIdx), MAX_CHUNK_ROUNDS);
  const singleEarly = earlyChunks.length === 1;
  let base = 0;
  earlyChunks.forEach((chunk) => {
    let title = text.t("bracket.roundsRange", { from: String(chunk[0]), to: String(chunk.at(-1)) });
    if (chunk.length === 1) title = stageName(base, stageTotal, bracketType, text);
    else if (singleEarly) title = text.t("bracket.stage.early");
    sections.push({
      key: String(chunk[0]),
      title,
      rounds: chunk,
      roundIdxBase: base,
      qualifyLabel: null,
    });
    base += chunk.length;
  });

  // Phase finale (les 3 derniers tours).
  const finalTitle = finalCount > 1 ? text.t("bracket.finalPhase") : stageName(splitIdx, stageTotal, bracketType, text);
  const finalRounds = roundNums.slice(splitIdx);
  sections.push({
    key: String(finalRounds[0]),
    title: finalTitle,
    rounds: finalRounds,
    roundIdxBase: splitIdx,
    qualifyLabel: null,
  });

  // Chaque volet (sauf le dernier) pointe vers le 1er stade du volet suivant
  // (ex. vainqueurs des 8èmes → « Qualifié en quart de finale » ; entre deux paquets
  // de premiers tours → « Qualifié au tour suivant »).
  for (let i = 0; i < sections.length - 1; i += 1) {
    sections[i].qualifyLabel = qualifyLabelFor(stageKey(sections[i + 1].roundIdxBase, stageTotal, bracketType), text);
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
      .filter((m) => (m.team1Id === myTeamId || m.team2Id === myTeamId) && !isMatchPlayed(m))
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

  return sections.at(-1)!.key;
}
