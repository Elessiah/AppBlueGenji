/**
 * Tours d'un tournoi tels que la fenêtre « Cartes et bans » les propose
 * (`docs/features/ROUND_MAPS.md`) : ceux déjà générés **et** ceux que le format
 * annonce, pour régler les cartes d'un tour avant que ses matchs existent. Un
 * réglage posé sur un tour à venir s'applique dès que ses matchs sont créés
 * (la manche est une clé, pas une ligne de match).
 *
 * Module pur : aucune dépendance base de données.
 */
import { nextPowerOfTwo } from "./bracket-seeds";
import { PLAYOFF_ROUND_OFFSET, tournamentMatchFormat } from "./bg-survie/rounds";
import { formatAllowsTiebreak, matchMaxMaps, parseMatchFormat, type MatchFormat } from "./match-format";
import { ROUND_MAP_SLOTS_MAX, roundKeysOf, type RoundKey, type RoundTiebreak } from "./round-maps";
import { computeRecommendedRounds } from "./swiss";
import { resolvePhaseQualifiers } from "./tournament-phases";
import type { PhaseFormat, TournamentFormat, TournamentPhase, TournamentState } from "./types";

/** Ce que le plan lit du tournoi (carte et métadonnées de l'instantané). */
export type RoundPlanInput = {
  format: TournamentFormat;
  state: TournamentState;
  maxTeams: number;
  registeredTeams: number;
  hasThirdPlaceMatch: boolean;
  /** Ronde suisse : rondes annoncées. */
  swissTotalRounds: number | null;
  /** BlueGenji Survie : plafond de manches qualificatives (`null` = aucun). */
  enduranceMaxRounds: number | null;
  /** BlueGenji Survie : effectif des play-offs. */
  endurancePlayoffSize: number | null;
  phases: readonly TournamentPhase[] | null;
};

/** Plafond de tours proposés par tableau : borne une saisie aberrante. */
const PLANNED_ROUNDS_MAX = 50;

function range(from: number, count: number): number[] {
  const safe = Math.max(0, Math.min(PLANNED_ROUNDS_MAX, Math.floor(count)));
  return Array.from({ length: safe }, (_, index) => from + index);
}

/** Tours d'une élimination simple ou double à `entrants` engagés. */
function eliminationRounds(
  phaseId: number,
  entrants: number,
  double: boolean,
  thirdPlace: boolean,
): RoundKey[] {
  if (entrants < 2) return [];
  const rounds = Math.round(Math.log2(nextPowerOfTwo(entrants)));
  const keys: RoundKey[] = range(1, rounds).map((roundNumber) => ({ phaseId, bracket: "UPPER", roundNumber }));
  if (double) {
    if (rounds >= 2) {
      for (const roundNumber of range(1, 2 * (rounds - 1))) keys.push({ phaseId, bracket: "LOWER", roundNumber });
    }
    keys.push({ phaseId, bracket: "GRAND", roundNumber: 1 });
  } else if (thirdPlace && rounds >= 2) {
    keys.push({ phaseId, bracket: "THIRD_PLACE", roundNumber: 1 });
  }
  return keys;
}

function upperRounds(phaseId: number, total: number | null): RoundKey[] {
  return range(1, total ?? 0).map((roundNumber) => ({ phaseId, bracket: "UPPER", roundNumber }));
}

/** Tours annoncés par le format d'une phase (ou du tournoi mono-mode, `phaseId = 0`). */
function formatRounds(
  phaseId: number,
  format: TournamentFormat,
  entrants: number,
  settings: { thirdPlace: boolean; swissTotalRounds: number | null },
): RoundKey[] {
  if (format === "SINGLE") return eliminationRounds(phaseId, entrants, false, settings.thirdPlace);
  if (format === "DOUBLE") return eliminationRounds(phaseId, entrants, true, false);
  if (format === "SWISS") {
    // Sans total fixé, le moteur retient ⌈log₂(N)⌉ + 1 au coup d'envoi (`swiss.ts`).
    const total = settings.swissTotalRounds ?? 0;
    return upperRounds(phaseId, total > 0 ? total : computeRecommendedRounds(entrants));
  }
  // Survie : le nombre de manches dépend des coupes et des forfaits — seuls les
  // tours générés et le suivant sont proposés (`nextRounds`).
  return [];
}

/** BlueGenji Survie : manches qualificatives (plafond) puis tours de play-offs. */
function enduranceRounds(input: RoundPlanInput): RoundKey[] {
  const keys = upperRounds(0, input.enduranceMaxRounds);
  const size = input.endurancePlayoffSize ?? 0;
  if (size >= 2) {
    const rounds = Math.round(Math.log2(nextPowerOfTwo(size)));
    for (const roundNumber of range(PLAYOFF_ROUND_OFFSET, rounds)) keys.push({ phaseId: 0, bracket: "UPPER", roundNumber });
    // La petite finale se joue au tour de la finale (`lib/shared/bg-survie/playoffs.ts`).
    if (rounds >= 2) keys.push({ phaseId: 0, bracket: "THIRD_PLACE", roundNumber: PLAYOFF_ROUND_OFFSET + rounds - 1 });
  }
  return keys;
}

/** Tours du multi-phases : chaque phase selon son format, effectif déduit de la précédente. */
function phaseRounds(input: RoundPlanInput, entrants: number): RoundKey[] {
  const phases = [...(input.phases ?? [])].sort((a, b) => a.position - b.position);
  const keys: RoundKey[] = [];
  let current = entrants;
  phases.forEach((phase, index) => {
    const phaseEntrants = phase.entrants ?? current;
    keys.push(
      ...formatRounds(phase.id, phase.format, phaseEntrants, {
        thirdPlace: phase.hasThirdPlaceMatch,
        swissTotalRounds: phase.swissTotalRounds,
      }),
    );
    current = phase.qualifiers ?? resolvePhaseQualifiers(phaseEntrants, phase, index === phases.length - 1);
  });
  return keys;
}

/**
 * Tour suivant le dernier généré, par phase et tableau principal, quand le
 * format ne dit pas d'avance combien il en jouera (survie, endurance sans
 * plafond) : régler le prochain tour reste possible.
 */
function nextRounds(input: RoundPlanInput, generated: readonly RoundKey[]): RoundKey[] {
  if (input.state === "FINISHED") return [];
  const open: RoundKey[] = [];
  const openEnded = (phaseId: number) => {
    if (phaseId === 0) {
      if (input.format === "SURVIVAL") return true;
      return input.format === "BG_SURVIE" && input.enduranceMaxRounds === null;
    }
    return input.phases?.find((phase) => phase.id === phaseId)?.format === "SURVIVAL";
  };
  const phaseIds = new Set<number>([0, ...(input.phases ?? []).map((phase) => phase.id)]);
  for (const phaseId of phaseIds) {
    if (!openEnded(phaseId)) continue;
    const last = generated
      .filter((key) => key.phaseId === phaseId && key.bracket === "UPPER" && key.roundNumber < PLAYOFF_ROUND_OFFSET)
      .reduce((max, key) => Math.max(max, key.roundNumber), 0);
    open.push({ phaseId, bracket: "UPPER", roundNumber: last + 1 });
  }
  return open;
}

/**
 * Tous les tours à proposer, dans l'ordre de jeu : générés, annoncés par le
 * format, le suivant d'un format sans fin connue, et ceux déjà réglés (un
 * réglage reste visible même hors du plan). Avant le coup d'envoi, l'effectif
 * retenu est la capacité du tournoi (au moins les inscrites) ; ensuite, les
 * inscrites.
 */
export function plannedRoundKeys(
  input: RoundPlanInput,
  generated: readonly RoundKey[],
  configured: readonly RoundKey[],
): RoundKey[] {
  const started = input.state === "RUNNING" || input.state === "FINISHED";
  const entrants = started ? input.registeredTeams : Math.max(input.registeredTeams, input.maxTeams);
  let planned: RoundKey[];
  if (input.format === "MULTI") planned = phaseRounds(input, entrants);
  else if (input.format === "BG_SURVIE") planned = enduranceRounds(input);
  else {
    planned = formatRounds(0, input.format, entrants, {
      thirdPlace: input.hasThirdPlaceMatch,
      swissTotalRounds: input.swissTotalRounds,
    });
  }
  const known = roundKeysOf([...generated, ...planned]);
  return roundKeysOf([...known, ...nextRounds(input, known), ...configured]);
}

/**
 * Maps au plus d'un match de ce tour selon le format de match du tournoi
 * (FT3 → 5, plafond abaissé compris ; arbre final de BlueGenji Survie selon le
 * sien), `null` en score libre. Sert l'indication « 5 cartes max » et borne
 * l'ajout de cartes, sans dépasser {@link ROUND_MAP_SLOTS_MAX}.
 */
export function roundMaxMaps(
  tournament: { format: TournamentFormat; matchFormat: MatchFormat | null; endurancePlayoffFormat: MatchFormat | null },
  roundNumber: number,
): number | null {
  const format = tournamentMatchFormat(
    tournament.format,
    tournament.matchFormat,
    tournament.endurancePlayoffFormat,
    roundNumber,
  );
  return format ? Math.min(ROUND_MAP_SLOTS_MAX, matchMaxMaps(format)) : null;
}

/** Ce que l'éligibilité d'une map de départage lit du tournoi (carte de l'instantané). */
export type TiebreakTournament = {
  format: TournamentFormat;
  matchFormat: MatchFormat | null;
  endurancePlayoffFormat: MatchFormat | null;
  phases: ReadonlyArray<Pick<TournamentPhase, "id" | "format">> | null;
};

/** Colonnes de `bg_tournaments` d'où se lit un {@link TiebreakTournament}. */
export type TiebreakTournamentColumns = {
  format: TournamentFormat;
  match_format_type?: unknown;
  match_format_value?: unknown;
  match_format_max_maps?: unknown;
  match_format_draws?: unknown;
  endurance_playoff_format_type?: unknown;
  endurance_playoff_format_value?: unknown;
};

/**
 * Ligne SQL → {@link TiebreakTournament} : **une** conversion, partagée par le
 * serveur (pose, sous verrou) et le brief, pour qu'aucun des deux n'annonce
 * un départage que l'autre refuse.
 */
export function tiebreakTournamentFromRow(
  row: TiebreakTournamentColumns,
  phases: TiebreakTournament["phases"],
): TiebreakTournament {
  return {
    format: row.format,
    matchFormat: parseMatchFormat(
      row.match_format_type ?? null,
      row.match_format_value ?? null,
      row.match_format_max_maps ?? null,
      row.match_format_draws ?? null,
    ),
    endurancePlayoffFormat: parseMatchFormat(
      row.endurance_playoff_format_type ?? null,
      row.endurance_playoff_format_value ?? null,
    ),
    phases,
  };
}

const ELIMINATION_FORMATS: ReadonlySet<TournamentFormat | PhaseFormat> = new Set(["SINGLE", "DOUBLE"]);

/**
 * Tour de **play-offs** : un tour d'élimination (simple ou double, petite
 * finale comprise), l'arbre final de BlueGenji Survie (`PLAYOFF_ROUND_OFFSET`),
 * ou une phase à élimination d'un multi-phases. Jamais une ronde suisse, une
 * manche de survie ni une manche qualificative.
 */
export function isPlayoffRound(
  tournament: Pick<TiebreakTournament, "format" | "phases">,
  round: RoundKey,
): boolean {
  if (tournament.format === "MULTI") {
    const phase = tournament.phases?.find((item) => item.id === round.phaseId);
    return phase !== undefined && ELIMINATION_FORMATS.has(phase.format);
  }
  if (round.phaseId !== 0) return false;
  if (tournament.format === "BG_SURVIE") return round.roundNumber >= PLAYOFF_ROUND_OFFSET;
  return ELIMINATION_FORMATS.has(tournament.format);
}

/**
 * Une map de départage se règle-t-elle sur ce tour ? Tour de play-offs **et**
 * format de match défini, quelle que soit sa taille (BO 1 à BO 15, FT) —
 * décision du 2026-11-09, `docs/features/ROUND_MAPS.md`. Ni score libre (aucune
 * map régulière à compter), ni égalités ouvertes (un play-off les ferme
 * toujours, `tournamentMatchFormat` ; le test reste un filet pour une ligne
 * écrite à la main). Le serveur et l'écran lisent cette règle.
 */
export function roundAllowsTiebreak(tournament: TiebreakTournament, round: RoundKey): boolean {
  if (!isPlayoffRound(tournament, round)) return false;
  return formatAllowsTiebreak(
    tournamentMatchFormat(tournament.format, tournament.matchFormat, tournament.endurancePlayoffFormat, round.roundNumber),
  );
}

/**
 * Les maps de départage qui s'appliquent : celles des tours éligibles. Un
 * réglage resté d'un format changé depuis (FT 3, phase devenue suisse) est
 * gardé en base mais n'est ni montré ni joué.
 */
export function applicableTiebreaks(
  tiebreaks: readonly RoundTiebreak[],
  tournament: TiebreakTournament,
): RoundTiebreak[] {
  return tiebreaks.filter((round) => roundAllowsTiebreak(tournament, round));
}


/**
 * Réglages par tour (cartes, maps de départage, points) d'un tournoi **lancé**,
 * sans ceux des tours qu'il ne jouera jamais : en élimination (simple ou
 * double, tournoi ou phase), une fois l'arbre créé, un tour sans match n'en
 * aura plus — le plan, dimensionné avant le départ sur la capacité, a pu en
 * régler au-delà des inscrites. Ces réglages restent en base mais ne
 * grossissent plus chaque instantané. Avant le lancement, en ronde suisse,
 * survie, BlueGenji Survie, ou pour une phase pas encore ouverte, tout est
 * gardé (tours créés au fil de l'eau).
 */
export function withoutUnbuiltRounds<T extends RoundKey>(
  items: readonly T[],
  tournament: {
    format: TournamentFormat;
    state: TournamentState;
    phases: ReadonlyArray<Pick<TournamentPhase, "id" | "format">> | null;
  },
  built: readonly RoundKey[],
): T[] {
  if (tournament.state !== "RUNNING" && tournament.state !== "FINISHED") return [...items];
  const builtPhases = new Set(built.map((round) => round.phaseId));
  const builtKeys = new Set(built.map((round) => `${round.phaseId}:${round.bracket}:${round.roundNumber}`));
  const formatOf = (phaseId: number) =>
    tournament.format === "MULTI" ? tournament.phases?.find((phase) => phase.id === phaseId)?.format : tournament.format;
  return items.filter((item) => {
    const format = formatOf(item.phaseId);
    if (format === undefined || !ELIMINATION_FORMATS.has(format) || !builtPhases.has(item.phaseId)) return true;
    return builtKeys.has(`${item.phaseId}:${item.bracket}:${item.roundNumber}`);
  });
}
