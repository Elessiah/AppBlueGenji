/**
 * Attribution automatique du planning (`docs/features/CAST_PLANNING.md`) —
 * calcul pur, déterministe et expliqué, **par lot** sur une fenêtre de temps
 * (une semaine, une manche) : relancé, il recalcule les propositions
 * provisoires de la fenêtre sans toucher à ce qui est verrouillé (choix du
 * staff, propositions confirmées, caster inscrit, arbitre désigné du match).
 *
 * Deux temps :
 * 1. **Construction**, entrée par entrée, la plus contrainte d'abord (le moins
 *    de candidats, puis l'heure) : la diffusion (un caster — un caster qui
 *    n'est pas autonome seulement si un autre membre peut assurer le prod —,
 *    puis un prod, jamais sans caster), puis l'arbitrage, entrées **diffusées
 *    d'abord** ; le premier arbitre de chaque entrée avant le reste du groupe
 *    d'un tournoi entier.
 * 2. **Amélioration globale** : chaque proposition est remise en jeu — un
 *    autre candidat la prend si le planning entier s'en trouve meilleur
 *    ({@link planningScore}), à couverture égale de l'entrée ; une place
 *    restée vide est retentée ; deux membres d'un même rôle **échangent**
 *    leurs entrées quand l'un préfère celle de l'autre (deux entrées qui se
 *    chevauchent, chacun posé sur celle que l'autre voulait). Jusqu'à ce que
 *    plus rien ne s'améliore. Chaque essai se juge sur la seule partie du
 *    planning qu'il touche : un lot d'un mois se calcule en un instant.
 *
 * Une personne ne tient pas deux entrées qui se **chevauchent** (durées
 * estimées, `planning-durations.ts`) mais enchaîne des entrées consécutives.
 * Elle peut cumuler arbitre et caster, ou arbitre et prod, sur une même
 * entrée — en dernier recours ; jamais caster et prod ({@link rolesConflict}).
 */
import {
  planningCoverage,
  planningWeekStart,
  PLANNING_ROLES,
  type AssignmentReason,
  type AvailabilityStatus,
  type PlanningRole,
} from "./planning";

export type PlannerEntry = {
  key: string;
  startAt: number;
  /** Fin estimée (début + durée estimée) : deux entrées se chevauchent si l'une commence avant la fin de l'autre. */
  endAt: number;
  /** Entrée que le calcul remplit : à venir, non jouée, dans la fenêtre du lot. */
  open: boolean;
  /** Arbitres que le calcul pose au plus (défaut 1 ; un tournoi entier : un groupe). */
  refereeSlots?: number;
};

export type PlannerAvailability = {
  entryKey: string;
  userId: number;
  role: PlanningRole;
  status: AvailabilityStatus;
  preferred: boolean;
};

/**
 * Attribution déjà posée, gardée par le calcul (choix du staff, confirmée,
 * caster inscrit, arbitre du match, proposition provisoire hors du lot).
 * `provisional` : une simple proposition, qui occupe sa place mais ne compte
 * pas comme travail tenu dans l'équité (`historyWeek`).
 */
export type LockedAssignment = {
  entryKey: string;
  userId: number;
  role: PlanningRole;
  reason: AssignmentReason;
  provisional?: boolean;
};

export type PlannerInput = {
  entries: readonly PlannerEntry[];
  availability: readonly PlannerAvailability[];
  /** Membres et rôles tenus (`planningRolesOf`), relus en base. */
  members: ReadonlyMap<number, readonly PlanningRole[]>;
  soloCasterIds: ReadonlySet<number>;
  locked: readonly LockedAssignment[];
  /** Entrées dont l'arbitrage est décidé hors du planning (autogestion posée par le staff). */
  refereeDecided: ReadonlySet<string>;
  /** Attributions des semaines précédentes, par membre (équité). */
  history: ReadonlyMap<number, number>;
  /**
   * Début (`planningWeekStart`) de la semaine où `history` s'arrête. Pour une
   * entrée d'une semaine plus tardive du lot, le travail **tenu** (verrouillé)
   * (hors propositions provisoires) des semaines entre les deux s'ajoute à son historique : un lot de
   * plusieurs semaines reste équitable d'une semaine à l'autre. Absent : rien
   * ne s'ajoute.
   */
  historyWeek?: number;
  /** `entryKey|userId|role` refusés (joueur du match, condition d'arbitrage, retrait par le staff). */
  excluded: ReadonlySet<string>;
};

export type PlannedAssignment = {
  entryKey: string;
  userId: number;
  role: PlanningRole;
  /** `PREFERENCE` : le membre voulait cette entrée ; `LOAD` : la répartition de la charge l'a choisi. */
  reason: "PREFERENCE" | "LOAD";
  /** Charge du membre la semaine de l'entrée (cette attribution comprise), et sur les semaines précédentes. */
  weekLoad: number;
  historyLoad: number;
};

/** Plafond des tours d'amélioration (chacun améliore strictement : le calcul s'arrête toujours bien avant). */
export const PLANNER_MAX_PASSES = 20;

/**
 * Mesure du coût d'un calcul : tours d'amélioration joués, essais jugés, et
 * `checks`, le travail des questions d'éligibilité (une par question, plus une
 * par place du membre parcourue) — ce que coûtent construction et échanges.
 */
export type PlannerStats = { passes: number; trials: number; checks: number };

export function exclusionKey(entryKey: string, userId: number, role: PlanningRole): string {
  return `${entryKey}|${userId}|${role}`;
}

/**
 * Rôles qu'une même personne ne cumule pas sur une entrée : un caster qui
 * serait son propre prod est un caster autonome, pas deux rôles. Arbitre +
 * caster, arbitre + prod : permis.
 */
export function rolesConflict(a: PlanningRole, b: PlanningRole): boolean {
  return (a === "CASTER" && b === "PROD") || (a === "PROD" && b === "CASTER");
}

/** Deux créneaux se chevauchent ; deux créneaux consécutifs (fin = début) s'enchaînent. */
export function slotsOverlap(a: { startAt: number; endAt: number }, b: { startAt: number; endAt: number }): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

type Placement = { entryKey: string; userId: number; role: PlanningRole; locked: boolean; provisional?: boolean };

/** Valeur d'un planning, ou d'une partie : `[cumuls, préférences non servies, Σ charges², historique]` (plus petit = meilleur). */
type Score = [number, number, number, number];

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function dropFrom<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (!list) return;
  const index = list.indexOf(value);
  if (index >= 0) list.splice(index, 1);
}

/**
 * État du calcul, indexé (par entrée, chevauchements, charge par semaine) : chaque
 * question du calcul se pose sans parcourir tout le planning, et un essai se
 * juge sur la seule partie du planning qu'il touche ({@link PlannerState.localScore}).
 */
class PlannerState {
  readonly placements = new Set<Placement>();
  private readonly entries: Map<string, PlannerEntry>;
  private readonly weeks = new Map<string, number>();
  private readonly availability = new Map<string, PlannerAvailability>();
  /** `entryKey|role` → membres qui ont donné une disponibilité (triés). */
  private readonly offered = new Map<string, number[]>();
  /** `userId|role` → entrées préférées (triées). */
  private readonly preferences = new Map<string, string[]>();
  private readonly byEntry = new Map<string, Placement[]>();
  /** Entrée → clés des autres entrées dont le créneau chevauche le sien. */
  private readonly overlapping = new Map<string, string[]>();
  private readonly loads = new Map<string, number>();
  /** Membre → semaine → places verrouillées (figé par {@link PlannerState.freezeHistory}). */
  private readonly lockedWeeks = new Map<number, Map<number, number>>();
  private readonly historyCache = new Map<string, number>();
  /** Essais jugés (chaque {@link PlannerState.localScore}) : la mesure du coût du calcul. */
  trials = 0;
  /** Travail des questions d'éligibilité ({@link PlannerState.eligible}). */
  checks = 0;

  constructor(readonly input: PlannerInput) {
    this.entries = new Map(input.entries.map((entry) => [entry.key, entry]));
    for (const entry of input.entries) this.weeks.set(entry.key, planningWeekStart(entry.startAt));
    this.indexOverlaps(input.entries);
    for (const row of input.availability) {
      this.availability.set(exclusionKey(row.entryKey, row.userId, row.role), row);
      pushTo(this.offered, `${row.entryKey}|${row.role}`, row.userId);
      if (row.preferred) pushTo(this.preferences, `${row.userId}|${row.role}`, row.entryKey);
    }
    for (const [key, ids] of this.offered) this.offered.set(key, [...new Set(ids)].sort((x, y) => x - y));
    for (const list of this.preferences.values()) list.sort((x, y) => x.localeCompare(y));
  }

  /** Chevauchements, par un balayage dans l'ordre des débuts (sans comparer toutes les paires). */
  private indexOverlaps(entries: readonly PlannerEntry[]): void {
    const sorted = [...entries].sort((a, b) => a.startAt - b.startAt || a.key.localeCompare(b.key));
    for (let i = 0; i < sorted.length; i += 1) {
      const a = sorted[i];
      for (let j = i + 1; j < sorted.length && sorted[j].startAt < a.endAt; j += 1) {
        const b = sorted[j];
        if (a.key === b.key || !slotsOverlap(a, b)) continue;
        pushTo(this.overlapping, a.key, b.key);
        pushTo(this.overlapping, b.key, a.key);
      }
    }
  }

  entry(key: string): PlannerEntry | undefined {
    return this.entries.get(key);
  }

  weekOf(key: string): number {
    return this.weeks.get(key) ?? 0;
  }

  on(entryKey: string): readonly Placement[] {
    return this.byEntry.get(entryKey) ?? [];
  }

  held(entryKey: string, role: PlanningRole): number[] {
    return this.on(entryKey)
      .filter((p) => p.role === role)
      .map((p) => p.userId);
  }

  rolesOn(entryKey: string, userId: number): PlanningRole[] {
    return this.on(entryKey)
      .filter((p) => p.userId === userId)
      .map((p) => p.role);
  }

  preferredEntries(userId: number, role: PlanningRole): readonly string[] {
    return this.preferences.get(`${userId}|${role}`) ?? [];
  }

  place(entryKey: string, userId: number, role: PlanningRole, locked: boolean, provisional = false): Placement {
    const placement: Placement = provisional ? { entryKey, userId, role, locked, provisional } : { entryKey, userId, role, locked };
    this.restore(placement);
    return placement;
  }

  /** Pose (ou remet) cette place, le même objet. */
  restore(placement: Placement): void {
    this.placements.add(placement);
    pushTo(this.byEntry, placement.entryKey, placement);
    const load = `${this.weekOf(placement.entryKey)}|${placement.userId}`;
    this.loads.set(load, (this.loads.get(load) ?? 0) + 1);
  }

  remove(placement: Placement): void {
    if (!this.placements.delete(placement)) return;
    dropFrom(this.byEntry, placement.entryKey, placement);
    const load = `${this.weekOf(placement.entryKey)}|${placement.userId}`;
    this.loads.set(load, (this.loads.get(load) ?? 1) - 1);
  }

  preferred(entryKey: string, userId: number, role: PlanningRole): boolean {
    return this.availability.get(exclusionKey(entryKey, userId, role))?.preferred === true;
  }

  /** Le membre peut-il prendre ce rôle de cette entrée, dans l'état courant ? */
  eligible(entry: PlannerEntry, userId: number, role: PlanningRole): boolean {
    this.checks += 1;
    if (this.availability.get(exclusionKey(entry.key, userId, role))?.status !== "AVAILABLE") return false;
    if (!(this.input.members.get(userId) ?? []).includes(role)) return false;
    if (this.input.excluded.has(exclusionKey(entry.key, userId, role))) return false;
    if (this.rolesOn(entry.key, userId).some((held) => held === role || rolesConflict(held, role))) return false;
    // Les seules entrées qui la chevauchent (indexées) : le coût ne croît pas avec le lot.
    return !(this.overlapping.get(entry.key) ?? []).some((other) => {
      this.checks += 1;
      return this.on(other).some((p) => p.userId === userId);
    });
  }

  candidates(entry: PlannerEntry, role: PlanningRole): number[] {
    return (this.offered.get(`${entry.key}|${role}`) ?? []).filter((userId) => this.eligible(entry, userId, role));
  }

  /** Une fois les places verrouillées posées : leur charge par semaine, pour l'historique (propositions provisoires exclues). */
  freezeHistory(): void {
    for (const p of this.placements) {
      if (!p.locked || p.provisional === true) continue;
      const weeks = this.lockedWeeks.get(p.userId) ?? new Map<number, number>();
      const week = this.weekOf(p.entryKey);
      weeks.set(week, (weeks.get(week) ?? 0) + 1);
      this.lockedWeeks.set(p.userId, weeks);
    }
  }

  /** Historique d'un membre pour une entrée : `history`, plus le travail tenu des semaines du lot qui la précèdent. */
  historyOf(userId: number, entryKey: string): number {
    const base = this.input.history.get(userId) ?? 0;
    const from = this.input.historyWeek;
    if (from === undefined) return base;
    const week = this.weekOf(entryKey);
    const key = `${week}|${userId}`;
    const cached = this.historyCache.get(key);
    if (cached !== undefined) return cached;
    let total = base;
    for (const [lockedWeek, count] of this.lockedWeeks.get(userId) ?? []) {
      if (lockedWeek >= from && lockedWeek < week) total += count;
    }
    this.historyCache.set(key, total);
    return total;
  }

  weekLoad(userId: number, entryKey: string): number {
    return this.loads.get(`${this.weekOf(entryKey)}|${userId}`) ?? 0;
  }

  coverage(entryKey: string) {
    return planningCoverage({
      hasReferee: this.held(entryKey, "REFEREE").length > 0,
      casterIds: this.held(entryKey, "CASTER"),
      prodIds: this.held(entryKey, "PROD"),
      soloCasterIds: this.input.soloCasterIds,
    });
  }

  /**
   * La part de {@link planningScore} que portent ces membres sur ces entrées
   * (leurs places, et leurs charges des semaines de ces entrées) : un essai
   * qui ne touche qu'elles se juge sur la différence avant / après.
   */
  localScore(entryKeys: readonly string[], userIds: readonly number[]): Score {
    this.trials += 1;
    const score: Score = [0, 0, 0, 0];
    const users = [...new Set(userIds)];
    for (const entryKey of new Set(entryKeys)) {
      for (const userId of users) this.addGroupScore(score, entryKey, userId);
    }
    for (const week of new Set(entryKeys.map((key) => this.weekOf(key)))) {
      for (const userId of users) {
        const load = this.loads.get(`${week}|${userId}`) ?? 0;
        score[2] += load * load;
      }
    }
    return score;
  }

  /** Cumuls, préférences non servies et historique des places (non verrouillées) d'un membre sur une entrée. */
  private addGroupScore(score: Score, entryKey: string, userId: number): void {
    const group = this.on(entryKey).filter((p) => p.userId === userId);
    for (const p of group.filter((placement) => !placement.locked)) {
      if (group.length > 1) score[0] += 1;
      if (!this.preferred(p.entryKey, p.userId, p.role)) score[1] += 1;
      score[3] += this.historyOf(p.userId, p.entryKey);
    }
  }
}

/**
 * Valeur d'un planning (plus petit = meilleur), comparée terme à terme :
 * 1. cumuls de rôles sur une même entrée (une personne libre passe d'abord) ;
 * 2. préférences **non** servies (chaque proposition donnée à qui ne l'avait
 *    pas demandée) ;
 * 3. somme des carrés des charges hebdomadaires (répartition : deux membres à
 *    une entrée valent mieux qu'un à deux) ;
 * 4. charge des semaines précédentes des membres choisis (équité dans le temps).
 *
 * Le calcul ne l'évalue jamais en entier : chaque essai se juge sur sa
 * différence locale ({@link PlannerState.localScore}), qui donne le même ordre.
 */
export function planningScore(placements: readonly Placement[], input: PlannerInput): Score {
  const state = new PlannerState(input);
  for (const p of placements) state.restore({ ...p });
  return state.localScore(
    placements.map((p) => p.entryKey),
    placements.map((p) => p.userId),
  );
}

/** `after` − `before`, terme à terme. */
function delta(after: Score, before: Score): Score {
  return [after[0] - before[0], after[1] - before[1], after[2] - before[2], after[3] - before[3]];
}

/** Vrai si `a` est strictement meilleur que `b` (ordre lexicographique). */
function better(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

const NO_CHANGE: Score = [0, 0, 0, 0];

function sameCoverage(a: ReturnType<PlannerState["coverage"]>, b: ReturnType<PlannerState["coverage"]>): boolean {
  return a.level === b.level && a.refereePriority === b.refereePriority;
}

/**
 * Le meilleur candidat d'une place, à la construction : une personne pas
 * encore sur l'entrée, puis la préférence, la charge de la semaine, celle des
 * semaines précédentes, l'identifiant (déterminisme).
 */
function bestCandidate(state: PlannerState, entry: PlannerEntry, role: PlanningRole, ids: readonly number[]): number | null {
  const ranked = ids.map((userId) => ({
    userId,
    alreadyOn: state.rolesOn(entry.key, userId).length > 0 ? 1 : 0,
    preferred: state.preferred(entry.key, userId, role) ? 0 : 1,
    week: state.weekLoad(userId, entry.key),
    history: state.historyOf(userId, entry.key),
  }));
  ranked.sort(
    (a, b) =>
      a.alreadyOn - b.alreadyOn || a.preferred - b.preferred || a.week - b.week || a.history - b.history || a.userId - b.userId,
  );
  return ranked[0]?.userId ?? null;
}

/** Casters éligibles qui diffusent vraiment : autonome, prod déjà tenu, ou un autre membre peut l'assurer. */
function streamingCasters(state: PlannerState, entry: PlannerEntry): number[] {
  const prodHeld = state.held(entry.key, "PROD").length > 0;
  const prods = state.candidates(entry, "PROD");
  return state
    .candidates(entry, "CASTER")
    .filter((id) => prodHeld || state.input.soloCasterIds.has(id) || prods.some((prod) => prod !== id));
}

/** Remplit les places libres d'une entrée pour la diffusion (caster puis prod). */
function fillStream(state: PlannerState, entry: PlannerEntry): boolean {
  let changed = false;
  if (state.held(entry.key, "CASTER").length === 0) {
    const pick = bestCandidate(state, entry, "CASTER", streamingCasters(state, entry));
    if (pick !== null) {
      state.place(entry.key, pick, "CASTER", false);
      changed = true;
    }
  }
  if (state.held(entry.key, "CASTER").length > 0 && state.held(entry.key, "PROD").length === 0) {
    const pick = bestCandidate(state, entry, "PROD", state.candidates(entry, "PROD"));
    if (pick !== null) {
      state.place(entry.key, pick, "PROD", false);
      changed = true;
    }
  }
  return changed;
}

/** Remplit l'arbitrage d'une entrée jusqu'à `slots` arbitres. */
function fillReferees(state: PlannerState, entry: PlannerEntry, slots: number): boolean {
  if (state.input.refereeDecided.has(entry.key)) return false;
  let changed = false;
  while (state.held(entry.key, "REFEREE").length < slots) {
    const pick = bestCandidate(state, entry, "REFEREE", state.candidates(entry, "REFEREE"));
    if (pick === null) break;
    state.place(entry.key, pick, "REFEREE", false);
    changed = true;
  }
  return changed;
}

/** Ordre de construction : la plus contrainte d'abord (le moins de candidats), puis l'heure et la clé. */
function byConstraint(state: PlannerState, entries: readonly PlannerEntry[], role: PlanningRole): PlannerEntry[] {
  const count = new Map(entries.map((entry) => [entry.key, state.candidates(entry, role).length]));
  return [...entries].sort(
    (a, b) => (count.get(a.key) ?? 0) - (count.get(b.key) ?? 0) || a.startAt - b.startAt || a.key.localeCompare(b.key),
  );
}

function fillAll(state: PlannerState, open: readonly PlannerEntry[]): boolean {
  let changed = false;
  for (const entry of byConstraint(state, open, "CASTER")) changed = fillStream(state, entry) || changed;
  const streamed = open.filter((entry) => state.coverage(entry.key).streamed);
  const others = open.filter((entry) => !state.coverage(entry.key).streamed);
  const refereeOrder = [...byConstraint(state, streamed, "REFEREE"), ...byConstraint(state, others, "REFEREE")];
  for (const target of [1, Number.POSITIVE_INFINITY]) {
    for (const entry of refereeOrder) {
      changed = fillReferees(state, entry, Math.min(target, entry.refereeSlots ?? 1)) || changed;
    }
  }
  return changed;
}

/** Propositions remises en jeu, dans l'ordre du calendrier puis de la clé, du rôle et du membre. */
function movablePlacements(state: PlannerState): Placement[] {
  return [...state.placements]
    .filter((p) => !p.locked)
    .sort((a, b) => {
      const ea = state.entry(a.entryKey);
      const eb = state.entry(b.entryKey);
      return (
        (ea?.startAt ?? 0) - (eb?.startAt ?? 0) ||
        a.entryKey.localeCompare(b.entryKey) ||
        a.role.localeCompare(b.role) ||
        a.userId - b.userId
      );
    });
}

/** Remet en jeu chaque proposition : un autre candidat la prend si le planning entier y gagne. */
function improve(state: PlannerState): boolean {
  let changed = false;
  for (const placement of movablePlacements(state)) {
    const entry = state.entry(placement.entryKey);
    if (!entry || !state.placements.has(placement)) continue;
    const coverage = state.coverage(entry.key);
    state.remove(placement);
    const others = state.candidates(entry, placement.role).filter((userId) => userId !== placement.userId);
    state.restore(placement);
    let best: number | null = null;
    let bestGain = NO_CHANGE;
    for (const userId of others) {
      const scope = [placement.userId, userId];
      const before = state.localScore([entry.key], scope);
      state.remove(placement);
      const trial = state.place(entry.key, userId, placement.role, false);
      const gain = delta(state.localScore([entry.key], scope), before);
      if (sameCoverage(state.coverage(entry.key), coverage) && better(gain, bestGain)) {
        best = userId;
        bestGain = gain;
      }
      state.remove(trial);
      state.restore(placement);
    }
    if (best !== null) {
      state.remove(placement);
      state.place(entry.key, best, placement.role, false);
      changed = true;
    }
  }
  return changed;
}

/**
 * Échange deux propositions d'un même rôle entre deux membres si le planning
 * y gagne, à couverture égale des deux entrées. Sort le calcul des impasses
 * qu'un remplacement seul ne lève pas : deux entrées qui se chevauchent,
 * chacun posé sur celle que l'autre voulait.
 */
function trySwap(state: PlannerState, first: Placement, second: Placement): boolean {
  const a = state.entry(first.entryKey);
  const b = state.entry(second.entryKey);
  if (!a || !b) return false;
  const keys = [a.key, b.key];
  const users = [first.userId, second.userId];
  const coverageA = state.coverage(a.key);
  const coverageB = state.coverage(b.key);
  const before = state.localScore(keys, users);
  state.remove(first);
  state.remove(second);
  const placed: Placement[] = [];
  if (state.eligible(b, first.userId, first.role)) placed.push(state.place(b.key, first.userId, first.role, false));
  if (placed.length === 1 && state.eligible(a, second.userId, second.role)) {
    placed.push(state.place(a.key, second.userId, second.role, false));
  }
  const kept =
    placed.length === 2 &&
    sameCoverage(state.coverage(a.key), coverageA) &&
    sameCoverage(state.coverage(b.key), coverageB) &&
    better(delta(state.localScore(keys, users), before), NO_CHANGE);
  if (kept) return true;
  for (const p of placed) state.remove(p);
  state.restore(first);
  state.restore(second);
  return false;
}

/** Les échanges tentés : un membre posé ailleurs que sur une entrée qu'il préfère, contre qui la tient. */
function swapPreferences(state: PlannerState): boolean {
  let changed = false;
  for (const first of movablePlacements(state)) {
    for (const wanted of state.preferredEntries(first.userId, first.role)) {
      if (!state.placements.has(first) || state.preferred(first.entryKey, first.userId, first.role)) break;
      if (wanted === first.entryKey) continue;
      const holders = state
        .on(wanted)
        .filter((p) => !p.locked && p.role === first.role && p.userId !== first.userId)
        .sort((x, y) => x.userId - y.userId);
      if (holders.some((second) => trySwap(state, first, second))) changed = true;
    }
  }
  return changed;
}

/**
 * Le calcul. Rend les propositions nouvelles (jamais les verrouillées), dans
 * l'ordre du calendrier puis de la clé et du rôle.
 */
export function planAssignments(input: PlannerInput, stats?: PlannerStats): PlannedAssignment[] {
  const state = new PlannerState(input);
  const lockedRows = [...input.locked].sort(
    (a, b) => a.entryKey.localeCompare(b.entryKey) || a.role.localeCompare(b.role) || a.userId - b.userId,
  );
  for (const row of lockedRows) {
    if (state.entry(row.entryKey) && !state.held(row.entryKey, row.role).includes(row.userId)) {
      state.place(row.entryKey, row.userId, row.role, true, row.provisional === true);
    }
  }
  state.freezeHistory();
  const open = input.entries.filter((entry) => entry.open);
  fillAll(state, open);
  let passes = 0;
  while (passes < PLANNER_MAX_PASSES) {
    passes += 1;
    const moved = improve(state);
    const swapped = swapPreferences(state);
    const filled = fillAll(state, open);
    if (!moved && !swapped && !filled) break;
  }
  if (stats) {
    stats.passes = passes;
    stats.trials = state.trials;
    stats.checks = state.checks;
  }
  const order = new Map(PLANNING_ROLES.map((role, index) => [role, index]));
  return [...state.placements]
    .filter((p) => !p.locked)
    .map((p) => {
      const entry = state.entry(p.entryKey) as PlannerEntry;
      return {
        entryKey: p.entryKey,
        userId: p.userId,
        role: p.role,
        reason: state.preferred(p.entryKey, p.userId, p.role) ? ("PREFERENCE" as const) : ("LOAD" as const),
        weekLoad: state.weekLoad(p.userId, p.entryKey),
        historyLoad: state.historyOf(p.userId, p.entryKey),
        startAt: entry.startAt,
      };
    })
    .sort(
      (a, b) =>
        a.startAt - b.startAt || a.entryKey.localeCompare(b.entryKey) || (order.get(a.role) ?? 0) - (order.get(b.role) ?? 0) || a.userId - b.userId,
    )
    .map(({ entryKey, userId, role, reason, weekLoad, historyLoad }) => ({ entryKey, userId, role, reason, weekLoad, historyLoad }));
}
