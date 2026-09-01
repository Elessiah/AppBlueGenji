/**
 * Ordre de seeding d'un tournoi — logique pure, partagée client/serveur.
 *
 * Le seeding est l'ordre des équipes inscrites : il détermine les appariements
 * de la première manche dans **tous** les formats (haut de tableau contre bas
 * de tableau en élimination et en ronde suisse, couples adjacents en survie).
 *
 * Il reste modifiable par le staff tant qu'**aucun score n'a été saisi** : au
 * premier score, le tournoi est engagé et rejouer les appariements réécrirait
 * des matchs déjà joués. C'est la même définition de « saisie » que le
 * verrouillage des scores (`match-lock.ts`), byes et matchs fantômes exclus.
 */
import { hasScoreInput, type MatchScoreState } from "./match-lock";
import type { SeedingSource, TournamentFormat, TournamentState } from "./types";

export type { SeedingSource } from "./types";

/** Libellés FR de la provenance de l'ordre, pour l'interface. */
export const SEEDING_SOURCE_LABELS: Record<SeedingSource, string> = {
  MANUAL: "Ordre fixé par le staff",
  RANKING: "Classement du site",
  REGISTRATION: "Ordre d'inscription",
};

/**
 * Formats dont le seeding par défaut est l'ordre d'inscription (la colonne
 * `seed`), par opposition à ceux qui seedent depuis le classement du site.
 */
const REGISTRATION_ORDER_FORMATS: ReadonlySet<TournamentFormat> = new Set<TournamentFormat>([
  "SINGLE",
  "DOUBLE",
  "BG_SURVIE",
]);

/**
 * Quelle source l'ordre de seeding suit-il aujourd'hui ?
 *
 * Un ordre fixé à la main l'emporte sur tout ; sinon le format décide. Cette
 * fonction est l'unique définition de la règle : l'aperçu du plateau et la liste
 * des inscriptions s'en servent pour dire la même chose que le moteur.
 */
export function seedingSource(format: TournamentFormat, manualSeeding: boolean): SeedingSource {
  if (manualSeeding) return "MANUAL";
  return REGISTRATION_ORDER_FORMATS.has(format) ? "REGISTRATION" : "RANKING";
}

/**
 * L'ordre affiché (celui de la colonne `seed`) est-il bien celui qui sera joué ?
 *
 * Non en `RANKING` : la liste montre alors l'ordre d'arrivée des inscriptions
 * alors que le moteur seedera depuis le classement du site. Le dire évite le
 * malentendu — le staff croit lire le tirage, il ne lit que des inscriptions.
 */
export function isSeedOrderEffective(source: SeedingSource): boolean {
  return source !== "RANKING";
}

export type SeedingEntry = {
  teamId: number;
  teamName: string;
  /** Rang dans l'ordre de seeding, à partir de 1. */
  seed: number;
};

export type SeedingLockReason = "FINISHED" | "SCORES_ENTERED" | null;

/**
 * Pourquoi le seeding est-il figé ? `null` = encore modifiable.
 *
 * - `FINISHED` : tournoi terminé, l'ordre n'a plus aucun effet.
 * - `SCORES_ENTERED` : au moins un match porte une saisie.
 */
export function seedingLockReason(
  state: TournamentState,
  matches: MatchScoreState[],
): SeedingLockReason {
  if (state === "FINISHED") return "FINISHED";
  if (matches.some(hasScoreInput)) return "SCORES_ENTERED";
  return null;
}

/** Raccourci lisible : le seeding est-il encore réordonnable ? */
export function canReorderSeeding(state: TournamentState, matches: MatchScoreState[]): boolean {
  return seedingLockReason(state, matches) === null;
}

/**
 * Déplace une équipe d'un cran dans l'ordre (boutons ↑ / ↓).
 *
 * Renvoie le tableau inchangé si l'équipe est absente, ou déjà à l'extrémité
 * visée — le bouton correspondant est alors désactivé côté interface.
 */
export function moveInOrder(
  order: readonly number[],
  teamId: number,
  direction: "up" | "down",
): number[] {
  const index = order.indexOf(teamId);
  if (index === -1) return [...order];

  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= order.length) return [...order];

  const next = [...order];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * L'ordre proposé est-il une permutation exacte des équipes inscrites ?
 * Refuse les doublons, les manquantes et les intruses — sans quoi une équipe
 * pourrait disparaître du tournoi via un simple réordonnancement.
 */
export function isValidSeedOrder(
  registeredTeamIds: readonly number[],
  proposedOrder: readonly number[],
): boolean {
  if (proposedOrder.length !== registeredTeamIds.length) return false;

  const proposed = new Set(proposedOrder);
  if (proposed.size !== proposedOrder.length) return false;

  return registeredTeamIds.every((teamId) => proposed.has(teamId));
}

/** Applique un ordre à des entrées et renumérote les seeds de 1 à N. */
export function applySeedOrder(
  entries: readonly SeedingEntry[],
  order: readonly number[],
): SeedingEntry[] {
  const byId = new Map(entries.map((entry) => [entry.teamId, entry]));
  // Les identifiants inconnus sont écartés AVANT la renumérotation, sinon ils
  // laisseraient un trou dans la suite des seeds.
  return order
    .flatMap((teamId) => {
      const entry = byId.get(teamId);
      return entry ? [entry] : [];
    })
    .map((entry, index) => ({ ...entry, seed: index + 1 }));
}
