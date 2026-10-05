/**
 * Sections d'état des matchs d'une manche : chaque liste de matchs par manche
 * (BlueGenji Survie, Survie, ronde suisse) se découpe en cinq sections fixes,
 * séparées par un simple filet titré — jamais un volet repliable.
 *
 * La section se **dérive** de la phase de lancement (`matchLaunchPhase`,
 * `lib/shared/match-launch.ts`), seule définition du site de « À planifier »,
 * « En attente » et « Lancement » :
 *
 * | Match                                        | Section                    |
 * | -------------------------------------------- | -------------------------- |
 * | `COMPLETED`                                  | Terminé                    |
 * | phase `LAUNCHED` (lancé, ou score à confirmer) | En cours                 |
 * | phase `LOBBY` (heure venue, ou sans date hors planification) | Lancement  |
 * | phase `SCHEDULED` (date à venir)             | En attente de lancement    |
 * | phase `TO_PLAN` (planification, sans date)   | À planifier                |
 * | engagé inconnu (`PENDING`…), sans date, planification | À planifier       |
 * | engagé inconnu, autrement                    | En attente de lancement    |
 *
 * Un match dont une engagée manque ne peut pas se lancer, même à son heure :
 * il attend, daté ou non, jamais « Lancement ».
 *
 * Tri dans une section : date de début croissante (sans date en dernier),
 * puis meilleure tête de série des deux engagées (1 d'abord), puis l'autre
 * engagée, puis l'identifiant du match pour un ordre stable. La tête de série
 * est le `seed` de l'instantané : rang figé au coup d'envoi quand le tournoi
 * seede depuis le classement du site (`registrationsFollowFrozenDraw`).
 *
 * Voir `docs/features/ROUND_MATCH_SECTIONS.md`.
 */
import { matchLaunchPhase, nextLaunchPhaseChangeAt } from "./match-launch";
import type { BracketMatch } from "./types";

export type MatchSectionKey = "TO_PLAN" | "WAITING" | "LOBBY" | "PLAYING" | "DONE";

/** Ordre d'affichage, figé. */
export const MATCH_SECTION_ORDER: readonly MatchSectionKey[] = [
  "TO_PLAN",
  "WAITING",
  "LOBBY",
  "PLAYING",
  "DONE",
];

export const MATCH_SECTION_LABELS: Readonly<Record<MatchSectionKey, string>> = {
  TO_PLAN: "À planifier",
  WAITING: "En attente de lancement",
  LOBBY: "Lancement",
  PLAYING: "En cours",
  DONE: "Terminé",
};

/** Ce que le découpage lit d'un match. */
export type SectionMatch = Pick<
  BracketMatch,
  "id" | "status" | "team1Id" | "team2Id" | "startAt" | "launchedAt"
>;

/** Tête de série par engagé (`teamId` → seed). */
export type SeedMap = Readonly<Record<number, number>>;

export function buildSeedMap(
  registrations: ReadonlyArray<{ teamId: number; seed: number | null }>,
): SeedMap {
  const seeds: Record<number, number> = {};
  for (const registration of registrations) {
    if (registration.seed !== null) seeds[registration.teamId] = registration.seed;
  }
  return seeds;
}

function isoTime(iso: string | null): number | null {
  if (iso === null) return null;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : time;
}

/**
 * Section d'un match à l'instant `now` (ms). `now` vaut `null` avant le
 * montage (`RoundMatchSections`) : un match daté est alors tenu « en attente », l'heure
 * du lecteur n'étant pas encore connue.
 */
export function matchSectionOf(
  match: SectionMatch,
  refereeScheduling: boolean,
  now: number | null,
): MatchSectionKey {
  if (match.status === "COMPLETED") return "DONE";
  const phase = matchLaunchPhase({ ...match, refereeScheduling }, now ?? Number.NEGATIVE_INFINITY);
  if (phase === "LAUNCHED") return "PLAYING";
  if (phase === "LOBBY") return "LOBBY";
  if (phase === "SCHEDULED") return "WAITING";
  if (phase === "TO_PLAN") return "TO_PLAN";
  // `NONE` hors terminé : une engagée manque, le match ne peut pas se lancer.
  // Sans date, il n'est « à planifier » que si l'arbitrage pose les dates ;
  // sinon il attend simplement ses adversaires.
  return refereeScheduling && isoTime(match.startAt) === null ? "TO_PLAN" : "WAITING";
}

function seedOf(seeds: SeedMap, teamId: number | null): number {
  if (teamId === null || !Object.hasOwn(seeds, teamId)) return Number.POSITIVE_INFINITY;
  return seeds[teamId];
}

/** Comparateur du tri dans une section (voir l'en-tête du module). */
export function compareSectionMatches(a: SectionMatch, b: SectionMatch, seeds: SeedMap): number {
  const ta = isoTime(a.startAt) ?? Number.POSITIVE_INFINITY;
  const tb = isoTime(b.startAt) ?? Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta < tb ? -1 : 1;
  const [a1, a2] = [seedOf(seeds, a.team1Id), seedOf(seeds, a.team2Id)].sort((x, y) => x - y);
  const [b1, b2] = [seedOf(seeds, b.team1Id), seedOf(seeds, b.team2Id)].sort((x, y) => x - y);
  if (a1 !== b1) return a1 < b1 ? -1 : 1;
  if (a2 !== b2) return a2 < b2 ? -1 : 1;
  return a.id - b.id;
}

export type MatchSection<T> = { key: MatchSectionKey; label: string; matches: T[] };

/** Sections non vides, dans l'ordre fixe, chacune triée. */
export function sectionRoundMatches<T extends SectionMatch>(
  matches: readonly T[],
  options: { refereeScheduling: boolean; now: number | null; seeds: SeedMap },
): MatchSection<T>[] {
  const buckets = new Map<MatchSectionKey, T[]>();
  for (const match of matches) {
    const key = matchSectionOf(match, options.refereeScheduling, options.now);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(match);
    else buckets.set(key, [match]);
  }
  return MATCH_SECTION_ORDER.flatMap((key) => {
    const bucket = buckets.get(key);
    if (!bucket) return [];
    bucket.sort((a, b) => compareSectionMatches(a, b, options.seeds));
    return [{ key, label: MATCH_SECTION_LABELS[key], matches: bucket }];
  });
}

/**
 * Prochain instant (ms) où une section changera **par le seul temps** : la plus
 * proche heure de début d'un match « En attente de lancement » dont les deux
 * engagées sont connues (`nextLaunchPhaseChangeAt`, la règle de la carte de
 * match). `null` : aucune bascule horaire à attendre.
 */
export function nextSectionChangeAt(
  matches: readonly SectionMatch[],
  refereeScheduling: boolean,
  now: number,
): number | null {
  let next: number | null = null;
  for (const match of matches) {
    const at = nextLaunchPhaseChangeAt({ ...match, refereeScheduling }, now);
    if (at !== null && (next === null || at < next)) next = at;
  }
  return next;
}

/** « 3 matchs » — accord sur le nombre, pour le filet. */
export function sectionCountLabel(count: number): string {
  return count === 1 ? "1 match" : `${count} matchs`;
}
