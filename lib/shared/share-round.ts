/**
 * Nom de la manche d'un match partagé (`docs/features/SHARE_EMBEDS.md`) :
 * « Quart de finale 2 », « Finale », « Tableau perdants · Demi-finale 1 »,
 * « Ronde 3 · Match 2 » — celui que la fiche du tournoi affiche
 * (`bracket.stage` / `bracket.matchLabel` de `tournament.json`, `stageKey`),
 * et non plus « Manche n · Match m ».
 *
 * Deux temps, comme le reste des aperçus : {@link buildShareRounds} réduit les
 * matchs publics d'un tournoi à un descripteur **sans texte** (rangé dans le
 * résumé, donc dans l'empreinte de l'image), {@link shareRoundText} le rédige
 * dans la langue de l'adresse.
 */
import { endurancePlayoffGhostSlots, endurancePlayoffRoundCount } from "./bg-survie/playoff-rounds";
import { isEndurancePlayoffRound } from "./bg-survie/rounds";
import { stageKey, type StageKey } from "./bracket-stage";
import { isAmbiguousMatchStage, stageMatchLabel, stageRoundLabel } from "./bracket-stage-text";
import type { Locale } from "./locales";
import type { Messages } from "./i18n-messages";
import { fallbackRoundLabel, tournamentPageMessages, tournamentPageText, type TournamentPageText } from "./tournament-page-text-core";
import type { BracketMatch, TournamentPhase, TournamentSnapshot } from "./types";

/** Mot de manche d'un mode à classement : « Ronde » (suisse), « Manche » (Survie, qualification). */
export type ShareRoundNoun = "swiss" | "survival" | "round";

/** Ce qui nomme la manche d'un match, sans texte. */
export type ShareRound =
  /**
   * Un tableau à élimination : le stade se lit depuis la finale (`stageKey`).
   * `round` est le rang du tour dans son tableau (1 = le premier), celui que
   * la colonne d'un premier tour affiche (« Manche 2 ») — jamais le numéro
   * brut du moteur, qui commence à 1000 dans l'arbre final de BlueGenji Survie.
   */
  | { kind: "stage"; stage: StageKey; lower: boolean; round: number }
  /** Une manche numérotée (ronde suisse, Survie, qualification de BlueGenji Survie). */
  | { kind: "numbered"; noun: ShareRoundNoun; number: number };

/** Ce que la lecture des manches relit du tournoi public. */
export type ShareRoundSource = {
  card: Pick<TournamentSnapshot["card"], "format" | "state">;
  phases: readonly Pick<TournamentPhase, "id" | "format">[] | null;
  matches: readonly Pick<
    BracketMatch,
    "id" | "phaseId" | "bracket" | "roundNumber" | "matchNumber" | "status" | "doubleForfeit"
  >[];
};

type RoundMatch = ShareRoundSource["matches"][number];

/** Regroupe des éléments par clé, chaque groupe gardant l'ordre reçu. */
export function groupBy<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

/** Le format qui joue ce match : celui de sa phase (multi-mode), sinon celui du tournoi. */
function formatOf(
  card: ShareRoundSource["card"],
  phases: readonly Pick<TournamentPhase, "id" | "format">[] | null,
  match: RoundMatch,
): string {
  return phases?.find((item) => item.id === match.phaseId)?.format ?? card.format;
}

/** Index des tours (triés) d'un groupe de matchs, et leur nombre. */
function roundIndexes(group: readonly RoundMatch[]): { indexOf: Map<number, number>; total: number } {
  const rounds = [...new Set(group.map((match) => match.roundNumber))].sort((a, b) => a - b);
  return { indexOf: new Map(rounds.map((round, index) => [round, index])), total: rounds.length };
}

/**
 * Manche d'un match qui ne dépend pas de son tableau : numérotée (suisse,
 * Survie, qualification), petite finale d'un arbre final ; `"playoff"` pour un
 * tour de l'arbre final (à nommer sur le nombre de tours), `null` pour un
 * tableau à élimination ordinaire.
 */
function numberedOrFixedRound(format: string, match: RoundMatch): ShareRound | "playoff" | null {
  if (format === "SWISS") return { kind: "numbered", noun: "swiss", number: match.roundNumber };
  if (format === "SURVIVAL") return { kind: "numbered", noun: "survival", number: match.roundNumber };
  if (format !== "BG_SURVIE") return null;
  if (match.bracket === "THIRD_PLACE") return { kind: "stage", stage: "thirdPlace", lower: false, round: 1 };
  if (isEndurancePlayoffRound(match.roundNumber)) return "playoff";
  return { kind: "numbered", noun: "round", number: match.roundNumber };
}

/** Un tableau à élimination, nommé depuis son dernier tour. */
function nameEliminationBracket(group: readonly RoundMatch[], result: Map<number, ShareRound>): void {
  const { indexOf, total } = roundIndexes(group);
  for (const match of group) {
    const index = indexOf.get(match.roundNumber) ?? 0;
    const stage = stageKey(index, total, match.bracket);
    result.set(match.id, { kind: "stage", stage, lower: match.bracket === "LOWER", round: index + 1 });
  }
}

/**
 * L'arbre final de BlueGenji Survie, compté comme la fiche (`EnduranceView`) :
 * cases à pourvoir comprises tant que le tournoi vit ; sa finale est la
 * « Grande Finale » (`grandFinalLabel`).
 */
function namePlayoffTree(group: readonly RoundMatch[], finished: boolean, result: Map<number, ShareRound>): void {
  const { indexOf } = roundIndexes(group);
  const total = endurancePlayoffRoundCount(group, finished ? undefined : endurancePlayoffGhostSlots(group));
  for (const match of group) {
    const index = indexOf.get(match.roundNumber) ?? 0;
    const stage = stageKey(index, total, match.bracket);
    result.set(match.id, { kind: "stage", stage: stage === "final" ? "grandFinal" : stage, lower: false, round: index + 1 });
  }
}

/**
 * La manche de chaque match du tournoi, par identifiant. Les tableaux à
 * élimination se nomment depuis leur dernier tour (un tableau par phase et par
 * `bracket`, comme la fiche) ; l'arbre final de BlueGenji Survie sur le compte
 * de tours de la fiche (`EnduranceView` : cases à pourvoir comprises tant que le
 * tournoi vit, double forfait compris), et sa finale s'y appelle « Grande
 * Finale » (`grandFinalLabel`) ; les modes à classement gardent un numéro.
 */
export function buildShareRounds(source: ShareRoundSource): Map<number, ShareRound> {
  const result = new Map<number, ShareRound>();
  const elimination: RoundMatch[] = [];
  const playoffs: RoundMatch[] = [];
  for (const match of source.matches) {
    const direct = numberedOrFixedRound(formatOf(source.card, source.phases, match), match);
    if (direct === "playoff") playoffs.push(match);
    else if (direct === null) elimination.push(match);
    else result.set(match.id, direct);
  }

  for (const group of groupBy(elimination, (match) => `${match.phaseId}:${match.bracket}`).values()) {
    nameEliminationBracket(group, result);
  }
  const finished = source.card.state === "FINISHED";
  for (const group of groupBy(playoffs, (match) => String(match.phaseId)).values()) {
    namePlayoffTree(group, finished, result);
  }
  return result;
}

/** Une ligne de {@link phaseRoundShapeKey} : ce qui nomme le tour d'un match. */
type RoundShapeRow = [
  id: number,
  phaseId: RoundMatch["phaseId"],
  bracket: RoundMatch["bracket"],
  roundNumber: number,
  matchNumber: number,
  status: RoundMatch["status"],
  doubleForfeit: boolean,
];

/**
 * Les matchs d'une phase réduits, dans une clé stable, à ce que lit
 * {@link buildShareRounds} : la page d'un match ne renomme son tour que si
 * cette clé change, pas à chaque poussée du flux (nouveaux objets, même forme).
 * {@link matchesOfRoundShapeKey} en relit les matchs.
 */
export function phaseRoundShapeKey(
  matches: readonly RoundMatch[],
  phaseId: RoundMatch["phaseId"],
): string {
  const rows: RoundShapeRow[] = [];
  for (const match of matches) {
    if (match.phaseId !== phaseId) continue;
    rows.push([
      match.id,
      match.phaseId,
      match.bracket,
      match.roundNumber,
      match.matchNumber,
      match.status,
      match.doubleForfeit,
    ]);
  }
  return JSON.stringify(rows);
}

/** Les matchs d'une clé de {@link phaseRoundShapeKey}. */
export function matchesOfRoundShapeKey(key: string): RoundMatch[] {
  const rows = JSON.parse(key) as RoundShapeRow[];
  return rows.map(([id, phaseId, bracket, roundNumber, matchNumber, status, doubleForfeit]) => ({
    id,
    phaseId,
    bracket,
    roundNumber,
    matchNumber,
    status,
    doubleForfeit,
  }));
}

/** Le texte de la fiche dans `locale` (les mots de manche sont ceux de `bracket.*`). */
export function shareRoundPageText(
  locale: Locale,
  messages: Pick<Messages, "tournament">,
): TournamentPageText {
  return tournamentPageText(locale, tournamentPageMessages(messages));
}

/**
 * « Ronde 3 » (suisse), « Manche 3 » (Survie, qualification). Lu dans
 * `bracket.*` de la fiche, chargé partout — et non dans `swiss.*` /
 * `survival.*`, que seules les vues chargées à la demande apportent (la page
 * d'un match les rendrait en clé brute). Les deux textes sont tenus égaux à
 * `<vue>.roundNoun` par un test.
 */
function numberedRoundLabel(text: TournamentPageText, noun: ShareRoundNoun, value: number): string {
  const number = String(value);
  return noun === "swiss" ? text.t("bracket.swissRoundN", { number }) : text.t("bracket.roundN", { number });
}

/**
 * « Quart de finale 2 », « Finale », « Tableau perdants · Demi-finale 1 »,
 * « Manche 2 · Match 3 » (premiers tours), « Ronde 3 · Match 2 ». Le numéro du
 * match n'est écrit que quand le nom seul laisserait un doute : jamais pour
 * une finale, une grande finale ou une petite finale (un seul match).
 *
 * @param round Le descripteur ({@link buildShareRounds}) ; `null` (match
 *   inconnu du résumé) retombe sur « Manche n · Match m » ({@link fallbackRoundLabel}).
 */
export function shareRoundText(
  text: TournamentPageText,
  round: ShareRound | null,
  position: Readonly<{ roundNumber: number; matchNumber: number }>,
): string {
  const matchN = text.t("bracket.matchN", { number: String(position.matchNumber) });
  if (round === null) return `${fallbackRoundLabel(text, position.roundNumber)} · ${matchN}`;
  if (round.kind === "numbered") return `${numberedRoundLabel(text, round.noun, round.number)} · ${matchN}`;
  const lowerPrefix = round.lower && round.stage !== "lowerFinal" ? text.t("page.bracketLabels.LOWER") : null;
  let label: string;
  if (round.stage === "early") label = `${stageRoundLabel(text, "early", round.round - 1)} · ${matchN}`;
  else if (isAmbiguousMatchStage(round.stage)) label = stageMatchLabel(text, round.stage, position.matchNumber);
  else label = stageRoundLabel(text, round.stage, round.round - 1);
  return lowerPrefix ? `${lowerPrefix} · ${label}` : label;
}
