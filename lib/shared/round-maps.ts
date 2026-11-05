/**
 * Cartes d'une manche et règles de ban (`docs/features/ROUND_MAPS.md`) — règles
 * pures, lues par le serveur et par l'écran.
 *
 * - Une **manche** (phase, tableau, numéro) peut porter une liste ordonnée de
 *   **créneaux** (carte 1, carte 2, …). Un créneau à **une** carte l'impose à
 *   tous les matchs de la manche ; à **plusieurs**, c'est un **pool** où
 *   l'arbitrage — ou, en autogestion, une équipe du match — choisit.
 * - Sans réglage pour la manche, rien ne change : première carte libre, posée
 *   par le staff (`bg_matches.first_map`).
 * - Le choix de la carte 1 est `first_map` lui-même ; les suivants vivent dans
 *   `bg_matches.map_picks` (`{"2":"Ilios"}`).
 * - **Échelle** : dès qu'une manche porte un réglage, la carte ne se saisit plus
 *   match par match (`ROUND_MAPS_SET`) ; seul le choix dans un pool reste
 *   ouvert. Réinitialiser la manche (liste vide) rend la saisie par match.
 * - **Préséance** : une carte imposée l'emporte toujours à l'affichage ; un
 *   pool montre le choix explicite du match s'il existe (même sorti du pool
 *   depuis : un choix n'est jamais perdu en silence), sinon « à choisir ».
 */
import { FIRST_MAP_MAX_LENGTH } from "./match-referee";
import { visibleText } from "./visible-text";

/** Créneaux au plus par manche. */
export const ROUND_MAP_SLOTS_MAX = 9;
/** Cartes candidates au plus par créneau. */
export const ROUND_MAP_CANDIDATES_MAX = 20;

/** Tours qu'une seule écriture « copier / appliquer à tous » peut viser ; l'écran découpe au-delà. */
export const ROUND_MAPS_BULK_MAX = 128;

/**
 * Tours qu'un écran des cartes peut déclarer écrits au signal de fermeture
 * (`POST …/round-maps/flush`) : au-delà, il n'envoie rien et le balayage de la
 * fenêtre de silence annonce. Borne le corps (`keepalive` : 64 Ko) et la route.
 */
export const ROUND_MAPS_FLUSH_ROUNDS_MAX = 1024;

/** Silence (secondes) après la dernière modification avant l'annonce Discord unique des cartes de manche. */
export const ROUND_MAPS_NOTICE_WINDOW_SECONDS = 60;
/** Manches nommées au plus dans cette annonce ; les suivantes sont comptées. */
export const ROUND_MAPS_NOTICE_LISTED = 8;
/**
 * Numéro de tour au plus qu'un réglage peut viser : au-delà des play-offs de
 * BlueGenji Survie (numérotés à partir de 1000, `PLAYOFF_ROUND_OFFSET`), aucun
 * format n'en crée.
 */
export const ROUND_NUMBER_MAX = 2000;
/** Tableaux d'une manche (ceux de `bg_matches.bracket`). */
export const ROUND_BRACKETS: readonly string[] = ["UPPER", "LOWER", "GRAND", "THIRD_PLACE"];

/** Réglage des cartes d'une manche, tel que l'instantané le porte. */
export type RoundMapConfig = {
  phaseId: number;
  bracket: string;
  roundNumber: number;
  /** Créneaux dans l'ordre ; chacun ses cartes candidates (1 = imposée). */
  slots: string[][];
};

/** Qui bannit sur la carte 1 : l'équipe qui n'héberge pas (défaut) ou l'hôte. */
export type FirstBanRule = "NON_HOST" | "HOST";
/** Qui bannit sur les cartes suivantes : le perdant de la carte précédente (défaut) ou son gagnant. */
export type NextBanRule = "LOSER" | "WINNER";

/**
 * Qui choisit une carte de pool à partir de la carte 2 : le perdant de la carte
 * précédente (« loserpick », défaut de la colonne) ou personne en particulier
 * (arbitrage ou équipes en autogestion).
 *
 * **`LOSER` n'est ni proposé ni affiché** tant que les scores par carte
 * n'existent pas (seul le résultat retenu est stocké) : rien ne sait qui a
 * perdu la carte précédente, la règle ne serait pas appliquée. La valeur
 * stockée reste lue et renvoyée telle quelle (décision du 2026-10-28,
 * `ROUND_MAPS.md`).
 */
export type NextPickRule = "LOSER" | "FREE";

export const FIRST_BAN_RULES: readonly FirstBanRule[] = ["NON_HOST", "HOST"];
export const NEXT_PICK_RULES: readonly NextPickRule[] = ["LOSER", "FREE"];
export const DEFAULT_NEXT_PICK_RULE: NextPickRule = "LOSER";
export const NEXT_BAN_RULES: readonly NextBanRule[] = ["LOSER", "WINNER"];
export const DEFAULT_FIRST_BAN_RULE: FirstBanRule = "NON_HOST";
export const DEFAULT_NEXT_BAN_RULE: NextBanRule = "LOSER";

/** Cartes et bans d'un tournoi, dans l'instantané commun (flux et REST de secours). */
export type TournamentMapRules = {
  firstBan: FirstBanRule;
  /** En cas d'égalité sur une carte, l'ordre des bans reste celui de la carte précédente (toujours). */
  nextBan: NextBanRule;
  nextPick: NextPickRule;
  rounds: RoundMapConfig[];
  /**
   * Map de départage des tours de play-offs en vrai best of 3 (une par tour au
   * plus, imposée) : jouée seulement si la série est à égalité après les trois
   * maps régulières. L'instantané ne porte que celles de tours **éligibles**
   * (`applicableTiebreaks`, `round-plan.ts`).
   */
  tiebreaks: RoundTiebreak[];
  /**
   * Maps de départage **gardées en base mais inactives** : celles de tours que
   * le format n'autorise plus (FT 3, phase devenue suisse). Ni montrées ni
   * jouées ; portées pour que le staff puisse les retirer
   * (`RoundMapsDialog`). Absent : aucune.
   */
  staleTiebreaks?: RoundTiebreak[];
};

/** Map de départage d'un tour du tournoi (`bg_tournament_round_maps.tiebreak_map`). */
export type RoundTiebreak = RoundKey & { map: string };

export const EMPTY_MAP_RULES: TournamentMapRules = {
  firstBan: DEFAULT_FIRST_BAN_RULE,
  nextBan: DEFAULT_NEXT_BAN_RULE,
  nextPick: DEFAULT_NEXT_PICK_RULE,
  rounds: [],
  tiebreaks: [],
};

export function parseFirstBanRule(raw: unknown): FirstBanRule {
  return raw === "HOST" ? "HOST" : DEFAULT_FIRST_BAN_RULE;
}

export function parseNextBanRule(raw: unknown): NextBanRule {
  return raw === "WINNER" ? "WINNER" : DEFAULT_NEXT_BAN_RULE;
}

export function parseNextPickRule(raw: unknown): NextPickRule {
  return raw === "FREE" ? "FREE" : DEFAULT_NEXT_PICK_RULE;
}

/** Une carte saisie, sous forme affichable (vide = aucune). @throws `code` */
function normalizeMapName(raw: unknown, code: string): string {
  if (typeof raw !== "string") throw new Error(code);
  const value = visibleText(raw);
  if ([...value].length > FIRST_MAP_MAX_LENGTH) throw new Error(code);
  return value;
}

/**
 * Créneaux saisis par le staff, nettoyés : cartes affichables (`visibleText`,
 * 64 caractères au plus), vides écartées, doublons retirés (sans casse), puis
 * créneaux vides écartés. Une liste vide retire le réglage de la manche.
 *
 * @throws `INVALID_ROUND_MAPS` — forme invalide, carte trop longue, plus de
 * {@link ROUND_MAP_SLOTS_MAX} créneaux ou de {@link ROUND_MAP_CANDIDATES_MAX} cartes.
 */
export function normalizeRoundMapSlots(raw: unknown): string[][] {
  if (!Array.isArray(raw)) throw new Error("INVALID_ROUND_MAPS");
  const slots: string[][] = [];
  for (const slot of raw) {
    if (!Array.isArray(slot)) throw new Error("INVALID_ROUND_MAPS");
    const seen = new Set<string>();
    const candidates: string[] = [];
    for (const entry of slot) {
      const name = normalizeMapName(entry, "INVALID_ROUND_MAPS");
      const key = name.toLocaleLowerCase("fr");
      if (name === "" || seen.has(key)) continue;
      seen.add(key);
      candidates.push(name);
    }
    if (candidates.length > ROUND_MAP_CANDIDATES_MAX) throw new Error("INVALID_ROUND_MAPS");
    if (candidates.length > 0) slots.push(candidates);
  }
  if (slots.length > ROUND_MAP_SLOTS_MAX) throw new Error("INVALID_ROUND_MAPS");
  return slots;
}

/**
 * Map de départage saisie par le staff : nom affichable (`visibleText`, 64
 * caractères au plus) ; vide ou `null` la retire.
 *
 * @throws `INVALID_TIEBREAK_MAP` — forme invalide ou nom trop long.
 */
export function normalizeTiebreakMap(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const name = normalizeMapName(raw, "INVALID_TIEBREAK_MAP");
  return name === "" ? null : name;
}

/** Map de départage relue en base ; tolérant : illisible vaut « aucune ». */
export function parseStoredTiebreak(raw: string | null | undefined): string | null {
  try {
    return normalizeTiebreakMap(raw ?? null);
  } catch {
    return null;
  }
}

/** La map de départage du tour d'un match, `null` sans réglage. */
export function roundTiebreakOf(
  tiebreaks: readonly RoundTiebreak[] | undefined,
  match: { phaseId: number; bracket: string; roundNumber: number },
): string | null {
  const map = tiebreaks?.find(
    (round) =>
      round.phaseId === match.phaseId && round.bracket === match.bracket && round.roundNumber === match.roundNumber,
  )?.map;
  // Rendu sous forme affichable, comme les cartes du tour : un nom stocké ne passe jamais brut à l'écran.
  return map === undefined ? null : visibleText(map) || null;
}

/** Créneaux relus en base ; tolérant : une valeur illisible vaut « aucun réglage ». */
export function parseStoredSlots(json: string | null | undefined): string[][] {
  if (!json) return [];
  try {
    return normalizeRoundMapSlots(JSON.parse(json));
  } catch {
    return [];
  }
}

/** Choix d'un match au-delà de la carte 1 (`map_picks`), tolérant. */
export function parseMapPicks(json: string | null | undefined): Record<string, string> {
  if (!json) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const picks: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const slot = Number(key);
    if (!Number.isInteger(slot) || slot < 2 || slot > ROUND_MAP_SLOTS_MAX || typeof value !== "string") continue;
    const name = visibleText(value);
    if (name !== "") picks[String(slot)] = name;
  }
  return picks;
}

/** Le réglage de la manche d'un match, `null` sans réglage. */
export function roundMapsOf(
  rounds: readonly RoundMapConfig[],
  match: { phaseId: number; bracket: string; roundNumber: number },
): RoundMapConfig | null {
  return (
    rounds.find(
      (round) =>
        round.phaseId === match.phaseId && round.bracket === match.bracket && round.roundNumber === match.roundNumber,
    ) ?? null
  );
}

/** Une carte du match, résolue : imposée, ou pool (choisie ou à choisir). */
export type ResolvedMapSlot = {
  /** Numéro de la carte (1, 2, …). */
  number: number;
  kind: "IMPOSED" | "POOL";
  /** Carte jouée : l'imposée, le choix du match, ou `null` (à choisir). */
  map: string | null;
  /** Cartes du pool (la seule carte, si imposée). */
  candidates: string[];
};

/**
 * Cartes d'un match selon le réglage de sa manche — vide sans réglage.
 * `firstMap` : la carte 1 stockée sur le match ; `picks` : les suivantes.
 */
export function resolveMatchMaps(
  slots: readonly string[][],
  firstMap: string | null,
  picks: Readonly<Record<string, string>>,
): ResolvedMapSlot[] {
  return slots.map((candidates, index) => {
    const number = index + 1;
    if (candidates.length === 1) return { number, kind: "IMPOSED", map: candidates[0], candidates: [...candidates] };
    const pick = number === 1 ? firstMap : (picks[String(number)] ?? null);
    return { number, kind: "POOL", map: pick, candidates: [...candidates] };
  });
}

/**
 * Nom de map **affiché** : saisie libre (première map, choix dans un pool)
 * réduite à son texte visible (`visibleText`, `UNTRUSTED_NAMES.md`) ; `null`
 * quand il n'en reste rien. Seul nettoyage des noms de maps à l'affichage.
 */
export function shownMapName(name: string | null): string | null {
  const text = name === null ? "" : visibleText(name).trim();
  return text === "" ? null : text;
}

/**
 * Nom de chaque carte d'un match, dans l'ordre (index 0 = carte 1), pour la
 * saisie du score (« Map 1 : Ilios ») : celles de sa manche (`resolveMatchMaps`,
 * imposée ou choisie dans le pool, `null` tant qu'un pool attend son choix),
 * sinon la première carte posée sur le match. Vide quand rien n'est fixé.
 */
export function matchMapNames(
  rounds: readonly RoundMapConfig[],
  match: {
    phaseId: number;
    bracket: string;
    roundNumber: number;
    firstMap: string | null;
    mapPicks: Readonly<Record<string, string>>;
  },
): (string | null)[] {
  const round = roundMapsOf(rounds, match);
  const names =
    round && round.slots.length > 0
      ? resolveMatchMaps(round.slots, match.firstMap, match.mapPicks).map((slot) => slot.map)
      : [match.firstMap];
  const shown = names.map(shownMapName);
  return shown.some((name) => name !== null) ? shown : [];
}

/** Première carte **affichée** : l'imposée de la manche l'emporte sur la saisie du match. */
export function effectiveFirstMap(slots: readonly string[][], firstMap: string | null): string | null {
  const first = slots[0];
  if (first?.length === 1) return first[0];
  return firstMap;
}

/**
 * Valide un choix dans un pool : le créneau existe, c'est un pool, et la carte
 * en fait partie (comparée sans casse ; la forme du pool est retenue).
 * `null` / vide retire le choix, sur tout créneau existant.
 *
 * @throws `INVALID_MAP_PICK`
 */
export function validateMapPick(slots: readonly string[][], slot: unknown, raw: unknown): string | null {
  if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 1 || slot > slots.length) {
    throw new Error("INVALID_MAP_PICK");
  }
  // Effacer est toujours permis, même sur un créneau devenu imposé : un ancien
  // choix ne doit pas rester coincé et revenir quand le réglage est retiré.
  if (raw === null || raw === undefined || raw === "") return null;
  const candidates = slots[slot - 1];
  if (candidates.length < 2) throw new Error("INVALID_MAP_PICK");
  const name = normalizeMapName(raw, "INVALID_MAP_PICK").toLocaleLowerCase("fr");
  const found = candidates.find((candidate) => candidate.toLocaleLowerCase("fr") === name);
  if (found === undefined) throw new Error("INVALID_MAP_PICK");
  return found;
}

/** L'équipe qui bannit sur la carte 1, selon la règle du tournoi. `null` tant qu'un adversaire manque. */
export function firstBanTeamFor(
  rule: FirstBanRule,
  hostTeamId: number | null,
  team1Id: number | null,
  team2Id: number | null,
): number | null {
  if (hostTeamId === null || team1Id === null || team2Id === null) return null;
  if (rule === "HOST") return hostTeamId;
  return hostTeamId === team1Id ? team2Id : team1Id;
}

/**
 * Ordre des bans de la carte 1 : `[premier, second]`, `null` tant qu'un
 * adversaire manque. Les deux équipes bannissent.
 */
export function firstBanOrder(
  rule: FirstBanRule,
  hostTeamId: number | null,
  team1Id: number | null,
  team2Id: number | null,
): [number, number] | null {
  const first = firstBanTeamFor(rule, hostTeamId, team1Id, team2Id);
  if (first === null || team1Id === null || team2Id === null) return null;
  return [first, first === team1Id ? team2Id : team1Id];
}

/**
 * Applique les règles du tournoi au plateau de l'instantané : première carte
 * affichée (l'imposée l'emporte) et équipe du premier ban selon la règle.
 * Un match sans réglage garde sa carte ; la règle par défaut ne change rien.
 * Un match dont l'arbitre désigné crée la partie (`refereeAssigned`) garde son
 * premier ban (`refereeHostedFirstBanTeamId`) : aucune équipe n'y héberge.
 */
export function applyMapRules<
  M extends {
    phaseId: number;
    bracket: string;
    roundNumber: number;
    hostTeamId: number | null;
    team1Id: number | null;
    team2Id: number | null;
    firstMap: string | null;
    firstBanTeamId: number | null;
    refereeAssigned?: boolean;
  },
>(matches: readonly M[], rules: TournamentMapRules): M[] {
  if (rules.rounds.length === 0 && rules.firstBan === DEFAULT_FIRST_BAN_RULE) return [...matches];
  // Un index par tour : une recherche par match, pas un parcours des tours.
  const byRound = new Map(rules.rounds.map((round) => [roundKeyId(round), round]));
  return matches.map((match) => {
    const round = byRound.get(roundKeyId(match)) ?? null;
    const firstMap = round ? effectiveFirstMap(round.slots, match.firstMap) : match.firstMap;
    const firstBanTeamId = match.refereeAssigned
      ? match.firstBanTeamId
      : firstBanTeamFor(rules.firstBan, match.hostTeamId, match.team1Id, match.team2Id);
    if (firstMap === match.firstMap && firstBanTeamId === match.firstBanTeamId) return match;
    return { ...match, firstMap, firstBanTeamId };
  });
}

/** Décompte d'un réglage, pour le résumé d'un tour (« 5 cartes · 2 pools »). */
export function roundMapsSummary(slots: readonly string[][]): { maps: number; imposed: number; pools: number } {
  const imposed = slots.filter((slot) => slot.length === 1).length;
  return { maps: slots.length, imposed, pools: slots.length - imposed };
}

/** Une manche du plateau, telle que l'écran de réglage la propose. */
export type RoundKey = { phaseId: number; bracket: string; roundNumber: number };

/** Clé texte d'une manche (`"0:UPPER:2"`), pour un `<select>`. */
export function roundKeyId(round: RoundKey): string {
  return `${round.phaseId}:${round.bracket}:${round.roundNumber}`;
}

/**
 * Manches distinctes d'un plateau, dans l'ordre de jeu : phase, puis tableau
 * (haut, bas, grande finale, petite finale), puis numéro.
 */
export function roundKeysOf(matches: readonly RoundKey[]): RoundKey[] {
  const seen = new Map<string, RoundKey>();
  for (const match of matches) {
    const key = { phaseId: match.phaseId, bracket: match.bracket, roundNumber: match.roundNumber };
    if (!seen.has(roundKeyId(key))) seen.set(roundKeyId(key), key);
  }
  const bracketRank = (bracket: string) => {
    const rank = ROUND_BRACKETS.indexOf(bracket);
    return rank === -1 ? ROUND_BRACKETS.length : rank;
  };
  return [...seen.values()].sort(
    (a, b) => a.phaseId - b.phaseId || bracketRank(a.bracket) - bracketRank(b.bracket) || a.roundNumber - b.roundNumber,
  );
}

/**
 * Le lecteur peut-il choisir dans un pool de ce match ? Le staff (permission
 * `tournaments`) qui ne le joue pas, toujours ; sinon une équipe du match, en autogestion
 * seulement, par un rôle qui déclare son « Prêt » (`canDeclareReady`, comme
 * `assertMapPicker`). Le serveur tranche (`pickMatchMap`) : ceci ne règle que l'écran.
 *
 * « Joue le match » se lit d'abord dans le rôle que le serveur a calculé pour
 * le lecteur (`launchRole`, `launch.viewer.role` : appartenance **en cours**,
 * entrées solo comprises, comme `resolveMatchParty`) ; à défaut de lancement
 * lu, dans `myTeamId`.
 */
export function canPickMatchMap(
  viewer: { staff: boolean; myTeamId: number | null; canDeclareReady: boolean; launchRole?: string | null },
  match: { status: string; selfManaged: boolean; team1Id: number | null; team2Id: number | null },
): boolean {
  if (match.status === "COMPLETED") return false;
  const plays =
    viewer.launchRole !== undefined && viewer.launchRole !== null
      ? viewer.launchRole === "TEAM1" || viewer.launchRole === "TEAM2"
      : viewer.myTeamId !== null && (viewer.myTeamId === match.team1Id || viewer.myTeamId === match.team2Id);
  // Un membre du staff qui joue le match suit la règle des joueurs.
  if (viewer.staff && !plays) return true;
  return plays && match.selfManaged && viewer.canDeclareReady;
}

/** Cartes du tour d'un match, telles que la saisie du score les lit. */
export type MatchMapPlan = { mapNames: (string | null)[]; tiebreakMap: string | null };

const NO_MAP_PLAN: MatchMapPlan = { mapNames: [], tiebreakMap: null };

/**
 * Nom des cartes et map de départage d'un match pour la saisie du score
 * (`matchMapNames`, `roundTiebreakOf`) ; rien sans match. Séparée pour qu'un
 * écran la mémorise sur le réglage et le match, pas sur chaque rendu.
 */
export function matchMapPlan(
  rules: Pick<TournamentMapRules, "rounds" | "tiebreaks"> | null | undefined,
  match: Parameters<typeof matchMapNames>[1] | null,
): MatchMapPlan {
  if (!rules || !match) return NO_MAP_PLAN;
  return { mapNames: matchMapNames(rules.rounds, match), tiebreakMap: roundTiebreakOf(rules.tiebreaks, match) };
}
