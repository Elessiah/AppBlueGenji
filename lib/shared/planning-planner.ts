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
 *    restée vide est retentée. Jusqu'à ce que plus rien ne s'améliore.
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

/** Attribution déjà posée, gardée par le calcul (choix du staff, confirmée, caster inscrit, arbitre du match). */
export type LockedAssignment = { entryKey: string; userId: number; role: PlanningRole; reason: AssignmentReason };

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

type Placement = { entryKey: string; userId: number; role: PlanningRole; locked: boolean };

class PlannerState {
  readonly placements: Placement[] = [];
  private readonly entries: Map<string, PlannerEntry>;
  private readonly availability = new Map<string, PlannerAvailability>();

  constructor(readonly input: PlannerInput) {
    this.entries = new Map(input.entries.map((entry) => [entry.key, entry]));
    for (const row of input.availability) {
      this.availability.set(exclusionKey(row.entryKey, row.userId, row.role), row);
    }
  }

  entry(key: string): PlannerEntry | undefined {
    return this.entries.get(key);
  }

  held(entryKey: string, role: PlanningRole): number[] {
    return this.placements.filter((p) => p.entryKey === entryKey && p.role === role).map((p) => p.userId);
  }

  rolesOn(entryKey: string, userId: number): PlanningRole[] {
    return this.placements.filter((p) => p.entryKey === entryKey && p.userId === userId).map((p) => p.role);
  }

  place(entryKey: string, userId: number, role: PlanningRole, locked: boolean): Placement {
    const placement = { entryKey, userId, role, locked };
    this.placements.push(placement);
    return placement;
  }

  remove(placement: Placement): void {
    this.placements.splice(this.placements.indexOf(placement), 1);
  }

  preferred(entryKey: string, userId: number, role: PlanningRole): boolean {
    return this.availability.get(exclusionKey(entryKey, userId, role))?.preferred === true;
  }

  /** Le membre peut-il prendre ce rôle de cette entrée, dans l'état courant ? */
  eligible(entry: PlannerEntry, userId: number, role: PlanningRole): boolean {
    if (this.availability.get(exclusionKey(entry.key, userId, role))?.status !== "AVAILABLE") return false;
    if (!(this.input.members.get(userId) ?? []).includes(role)) return false;
    if (this.input.excluded.has(exclusionKey(entry.key, userId, role))) return false;
    if (this.rolesOn(entry.key, userId).some((held) => held === role || rolesConflict(held, role))) return false;
    return !this.placements.some((p) => {
      if (p.userId !== userId || p.entryKey === entry.key) return false;
      const other = this.entry(p.entryKey);
      return other !== undefined && slotsOverlap(entry, other);
    });
  }

  candidates(entry: PlannerEntry, role: PlanningRole): number[] {
    const ids = new Set<number>();
    for (const row of this.input.availability) {
      if (row.entryKey === entry.key && row.role === role && this.eligible(entry, row.userId, role)) ids.add(row.userId);
    }
    return [...ids].sort((a, b) => a - b);
  }

  weekLoad(userId: number, at: number): number {
    const week = planningWeekStart(at);
    return this.placements.filter((p) => {
      const entry = this.entry(p.entryKey);
      return p.userId === userId && entry !== undefined && planningWeekStart(entry.startAt) === week;
    }).length;
  }

  coverage(entryKey: string) {
    return planningCoverage({
      hasReferee: this.held(entryKey, "REFEREE").length > 0,
      casterIds: this.held(entryKey, "CASTER"),
      prodIds: this.held(entryKey, "PROD"),
      soloCasterIds: this.input.soloCasterIds,
    });
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
 */
export function planningScore(state: { placements: readonly Placement[] }, input: PlannerInput, weekOf: (key: string) => number): number[] {
  let multiHat = 0;
  let notPreferred = 0;
  let historyLoad = 0;
  const loads = new Map<string, number>();
  const prefs = new Set(
    input.availability.filter((row) => row.preferred).map((row) => exclusionKey(row.entryKey, row.userId, row.role)),
  );
  for (const p of state.placements) {
    const load = `${weekOf(p.entryKey)}|${p.userId}`;
    loads.set(load, (loads.get(load) ?? 0) + 1);
    if (p.locked) continue;
    if (state.placements.some((o) => o !== p && o.entryKey === p.entryKey && o.userId === p.userId)) multiHat += 1;
    if (!prefs.has(exclusionKey(p.entryKey, p.userId, p.role))) notPreferred += 1;
    historyLoad += input.history.get(p.userId) ?? 0;
  }
  let squares = 0;
  for (const value of loads.values()) squares += value * value;
  return [multiHat, notPreferred, squares, historyLoad];
}

function better(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

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
    week: state.weekLoad(userId, entry.startAt),
    history: state.input.history.get(userId) ?? 0,
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

/** Remet en jeu chaque proposition : un autre candidat la prend si le planning entier y gagne. */
function improve(state: PlannerState, weekOf: (key: string) => number): boolean {
  let changed = false;
  const movable = state.placements
    .filter((p) => !p.locked)
    .sort((a, b) => {
      const ea = state.entry(a.entryKey);
      const eb = state.entry(b.entryKey);
      return (ea?.startAt ?? 0) - (eb?.startAt ?? 0) || a.entryKey.localeCompare(b.entryKey) || a.role.localeCompare(b.role);
    });
  for (const placement of movable) {
    const entry = state.entry(placement.entryKey);
    if (!entry || !state.placements.includes(placement)) continue;
    const coverage = state.coverage(entry.key);
    let score = planningScore(state, state.input, weekOf);
    state.remove(placement);
    let best: number | null = null;
    for (const userId of state.candidates(entry, placement.role)) {
      if (userId === placement.userId) continue;
      const trial = state.place(entry.key, userId, placement.role, false);
      const trialScore = planningScore(state, state.input, weekOf);
      if (sameCoverage(state.coverage(entry.key), coverage) && better(trialScore, score)) {
        best = userId;
        score = trialScore;
      }
      state.remove(trial);
    }
    if (best === null) {
      state.placements.push(placement);
    } else {
      state.place(entry.key, best, placement.role, false);
      changed = true;
    }
  }
  return changed;
}

/**
 * Le calcul. Rend les propositions nouvelles (jamais les verrouillées), dans
 * l'ordre du calendrier puis de la clé et du rôle.
 */
export function planAssignments(input: PlannerInput): PlannedAssignment[] {
  const state = new PlannerState(input);
  const lockedRows = [...input.locked].sort(
    (a, b) => a.entryKey.localeCompare(b.entryKey) || a.role.localeCompare(b.role) || a.userId - b.userId,
  );
  for (const row of lockedRows) {
    if (state.entry(row.entryKey) && !state.held(row.entryKey, row.role).includes(row.userId)) {
      state.place(row.entryKey, row.userId, row.role, true);
    }
  }
  const weekOf = (key: string) => planningWeekStart(state.entry(key)?.startAt ?? 0);
  const open = input.entries.filter((entry) => entry.open);
  fillAll(state, open);
  for (let pass = 0; pass < PLANNER_MAX_PASSES; pass += 1) {
    const moved = improve(state, weekOf);
    const filled = fillAll(state, open);
    if (!moved && !filled) break;
  }
  const order = new Map(PLANNING_ROLES.map((role, index) => [role, index]));
  return state.placements
    .filter((p) => !p.locked)
    .map((p) => {
      const entry = state.entry(p.entryKey) as PlannerEntry;
      return {
        entryKey: p.entryKey,
        userId: p.userId,
        role: p.role,
        reason: state.preferred(p.entryKey, p.userId, p.role) ? ("PREFERENCE" as const) : ("LOAD" as const),
        weekLoad: state.weekLoad(p.userId, entry.startAt),
        historyLoad: input.history.get(p.userId) ?? 0,
        startAt: entry.startAt,
      };
    })
    .sort(
      (a, b) =>
        a.startAt - b.startAt || a.entryKey.localeCompare(b.entryKey) || (order.get(a.role) ?? 0) - (order.get(b.role) ?? 0) || a.userId - b.userId,
    )
    .map(({ entryKey, userId, role, reason, weekLoad, historyLoad }) => ({ entryKey, userId, role, reason, weekLoad, historyLoad }));
}
