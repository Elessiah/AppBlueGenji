/**
 * Ordre de seeding d'un tournoi — logique pure, partagée client/serveur.
 *
 * Le seeding est l'ordre des équipes inscrites : il détermine les appariements
 * de la première manche dans **tous** les formats (haut de tableau contre bas
 * de tableau en élimination et en ronde suisse, couples adjacents en survie).
 *
 * Il reste modifiable par le staff **jusqu'au coup d'envoi** : dès la première
 * manche posée, les joueurs voient leurs matchs, et rejouer les appariements les
 * réécrirait sous leurs yeux. Une saisie de score le fige aussi — même
 * définition de « saisie » que le verrouillage des scores (`match-lock.ts`),
 * byes et matchs fantômes exclus.
 */
import { hasScoreInput, type MatchScoreState } from "./match-lock";
import { computeTournamentState, type TournamentStateInput } from "./tournament-state";
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
 * Non en `RANKING` : la colonne `seed` y garde l'ordre d'arrivée des
 * inscriptions alors que le moteur seede depuis le classement du site. Le dire
 * évite le malentendu — le staff croit lire le tirage, il ne lit que des
 * inscriptions.
 *
 * Ne dit rien de la liste de l'instantané : en `RANKING`, celui-ci la range
 * lui-même par le classement avant le coup d'envoi
 * (`registrationsFollowRanking`), puis par les rangs figés au lancement
 * (`registrationsFollowFrozenDraw`) — son `seed` est toujours le tirage.
 */
export function isSeedOrderEffective(source: SeedingSource): boolean {
  return source !== "RANKING";
}

/**
 * Le tournoi est-il encore avant son coup d'envoi ? Masqué, annoncé, aux
 * inscriptions ou inscriptions closes : aucun plateau n'existe encore, le
 * tirage est celui que produirait un lancement immédiat.
 */
export function isPreLaunchState(state: TournamentState): boolean {
  return state === "UPCOMING" || state === "REGISTRATION";
}

/**
 * La liste des inscrites est-elle rangée selon le classement du site ?
 *
 * Oui en `RANKING` tant que le tournoi n'est pas lancé : chaque engagée prend
 * alors, dès son inscription, la place que lui donne sa cote — celle que le
 * moteur lui donnera au coup d'envoi si rien ne bouge d'ici là. Une fois lancé,
 * le classement continue d'évoluer (les matchs du tournoi le font bouger) alors
 * que le tirage, lui, est fait : la liste suit les rangs figés au coup d'envoi
 * (`registrationsFollowFrozenDraw`).
 */
export function registrationsFollowRanking(
  source: SeedingSource,
  state: TournamentState,
): boolean {
  return source === "RANKING" && isPreLaunchState(state);
}

/**
 * La liste des inscrites suit-elle le tirage **figé au coup d'envoi** ?
 *
 * Oui en `RANKING` une fois lancé : le moteur a écrit, au lancement, le rang de
 * classement de chaque engagée dans sa table d'état ; l'instantané range alors
 * la liste par ce rang (`orderByFrozenSeeds`) plutôt que par la colonne `seed`,
 * qui n'est que l'ordre d'arrivée. Avec `registrationsFollowRanking` (avant le
 * lancement), un tournoi seedé par le classement montre toujours son tirage.
 */
export function registrationsFollowFrozenDraw(
  source: SeedingSource,
  state: TournamentState,
): boolean {
  return source === "RANKING" && !isPreLaunchState(state);
}

type SeededRow = { teamId: number; seed: number };

/** Ce que l'instantané a déjà chargé, et qui porte les rangs figés au lancement. */
export type FrozenSeedSources = {
  format: TournamentFormat;
  swiss: { standings: readonly SeededRow[] } | null;
  survival: { standings: readonly SeededRow[] } | null;
  endurance: { standings: readonly SeededRow[] } | null;
  phases: ReadonlyArray<{ id: number; position: number }> | null;
  phaseStandings: Readonly<Record<number, readonly SeededRow[]>> | null;
};

/**
 * `teamId → seed` figé au coup d'envoi, lu dans les classements que
 * l'instantané a déjà chargés — mêmes tables, même règle que
 * `loadFrozenRankingSeeds` (`lib/server/tournaments/frozen-seeds.ts`, pour qui
 * ne les a pas sous la main) : Suisse, Survie et BG Survie lisent leur
 * classement, le multi-phases sa première phase peuplée. Un seed nul (défaut
 * de colonne) est ignoré.
 */
export function frozenSeedsOf(sources: FrozenSeedSources): Map<number, number> {
  const rowsOf = (): readonly SeededRow[] => {
    switch (sources.format) {
      case "SWISS":
        return sources.swiss?.standings ?? [];
      case "SURVIVAL":
        return sources.survival?.standings ?? [];
      case "BG_SURVIE":
        return sources.endurance?.standings ?? [];
      case "MULTI": {
        const first = [...(sources.phases ?? [])]
          .sort((a, b) => a.position - b.position)
          .find((phase) => (sources.phaseStandings?.[phase.id]?.length ?? 0) > 0);
        return first ? (sources.phaseStandings?.[first.id] ?? []) : [];
      }
      default:
        return [];
    }
  };
  const seeds = new Map<number, number>();
  for (const row of rowsOf()) {
    if (row.seed > 0) seeds.set(row.teamId, row.seed);
  }
  return seeds;
}

/**
 * Range les inscrites par leur tête de série figée (`teamId → seed`) et porte
 * ce rang dans `seed`. Une engagée sans rang figé (absente de la table d'état)
 * passe après les autres, `seed` à `null`, dans son ordre d'origine.
 */
export function orderByFrozenSeeds<T extends { teamId: number; seed: number | null }>(
  rows: readonly T[],
  frozen: ReadonlyMap<number, number>,
): T[] {
  const ranked = rows
    .filter((row) => frozen.has(row.teamId))
    .map((row) => ({ ...row, seed: frozen.get(row.teamId)! }))
    .sort((a, b) => a.seed - b.seed);
  const unranked = rows
    .filter((row) => !frozen.has(row.teamId))
    .map((row) => ({ ...row, seed: null }));
  return [...ranked, ...unranked];
}

/**
 * Le prochain réordonnancement doit-il être confirmé ?
 *
 * Seulement le **premier** d'un tournoi seedé par le classement du site : il
 * passe le tournoi en ordre manuel (`manual_seeding = 1`), sans retour — le
 * classement ne rangera plus la liste, et les inscrites suivantes s'ajouteront
 * en queue. Une fois l'ordre manuel, la source vaut `MANUAL` et les flèches
 * repartent sans question : une confirmation par séance, pas par clic.
 *
 * Aucun horaire n'est en jeu : le serveur refuse tout réordonnancement dès
 * qu'un match existe (`SEEDING_LOCKED_STARTED`), et un match ne naît qu'au
 * coup d'envoi.
 */
export function seedingReorderNeedsConfirmation(source: SeedingSource): boolean {
  return source === "RANKING";
}

export type SeedingEntry = {
  teamId: number;
  teamName: string;
  /** Rang dans l'ordre de seeding, à partir de 1. */
  seed: number;
};

export type SeedingLockReason = "FINISHED" | "SCORES_ENTERED" | "STARTED" | null;

/**
 * État qui juge la fenêtre du seeding : le stocké **ou** celui de l'horloge.
 *
 * La colonne `state` ne bascule qu'au prochain entretien : l'heure de début
 * passée, elle peut dire encore `REGISTRATION` tant que personne n'a écrit ni
 * ouvert la liste. Lue seule, elle laissait réordonner après le coup d'envoi —
 * et l'écriture déclenchait alors la synchronisation qui lance le tournoi avec
 * ce nouvel ordre. Même paire que le retrait d'un engagé
 * (`entrantRemovalBlockReason`) : le stocké rattrape un lancement anticipé, le
 * calculé une heure passée sans recalage.
 *
 * @param tournament Dates et état stocké (une `TournamentCard` convient).
 * @param now Instant de référence, en millisecondes.
 */
export function seedingWindowState(
  tournament: TournamentStateInput,
  now: number = Date.now(),
): TournamentState {
  if (tournament.state === "FINISHED" || tournament.finishedAt) return "FINISHED";
  if (tournament.state === "RUNNING") return "RUNNING";
  return computeTournamentState(tournament, now);
}

/**
 * Pourquoi le seeding est-il figé ? `null` = encore modifiable.
 *
 * `state` est l'état qui juge la fenêtre — `seedingWindowState`, pas la seule
 * colonne stockée.
 *
 * - `FINISHED` : tournoi terminé, l'ordre n'a plus aucun effet.
 * - `SCORES_ENTERED` : au moins un match porte une saisie.
 * - `STARTED` : tournoi lancé (`RUNNING`). Dès le coup d'envoi, les matchs de
 *   la première manche sont `READY` et les joueurs les voient : réordonner
 *   régénérerait sous leurs yeux un plateau déjà annoncé, même sans score.
 */
export function seedingLockReason(
  state: TournamentState,
  matches: MatchScoreState[],
): SeedingLockReason {
  if (state === "FINISHED") return "FINISHED";
  if (matches.some(hasScoreInput)) return "SCORES_ENTERED";
  if (state === "RUNNING") return "STARTED";
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
