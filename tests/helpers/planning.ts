import type { LoadedAssignment, LoadedEntry, LoadedMember, PlanningData } from "@/lib/server/planning/load";
import { planningCoverage, type AvailabilityStatus, type PlanningRole } from "@/lib/shared/planning";
import { DEFAULT_PLANNING_DURATIONS } from "@/lib/shared/planning-durations";
import type { PlannerAvailability, PlannerEntry, PlannerInput } from "@/lib/shared/planning-planner";
import type { PlanningEntryView } from "@/lib/shared/planning-view";

/**
 * Fabriques complètes du planning des casts et arbitres
 * (`docs/features/CAST_PLANNING.md`) : chaque champ a une valeur, le test ne
 * surcharge que ce qui compte pour son cas.
 */

/** Lundi 2026-11-23, 00:00 à Paris (23:00 UTC la veille) : début d'une semaine de planning. */
export const MONDAY = Date.UTC(2026, 10, 22, 23);
export const HOUR_MS = 60 * 60 * 1000;

export function plannerEntry(key: string, startHour: number, overrides: Partial<PlannerEntry> = {}): PlannerEntry {
  return { key, startAt: MONDAY + startHour * HOUR_MS, endAt: MONDAY + (startHour + 1) * HOUR_MS, open: true, ...overrides };
}

export function available(
  entryKey: string,
  userId: number,
  role: PlanningRole,
  overrides: Partial<PlannerAvailability> = {},
): PlannerAvailability {
  return { entryKey, userId, role, status: "AVAILABLE" satisfies AvailabilityStatus, preferred: false, ...overrides };
}

export function plannerInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    entries: [],
    availability: [],
    members: new Map(),
    soloCasterIds: new Set(),
    locked: [],
    refereeDecided: new Set(),
    history: new Map(),
    excluded: new Set(),
    ...overrides,
  };
}

export function loadedEntry(overrides: Partial<LoadedEntry> = {}): LoadedEntry {
  return {
    key: "m:1",
    kind: "MATCH",
    tournamentId: 10,
    tournamentName: "Coupe",
    game: "OW",
    matchId: 1,
    roundNumber: 1,
    team1: { teamId: 100, name: "Alpha", soloUserId: null },
    team2: { teamId: 200, name: "Bravo", soloUserId: null },
    startAt: MONDAY,
    endAt: MONDAY + HOUR_MS,
    open: true,
    editable: true,
    tournamentFinished: false,
    hidden: false,
    channelUrl: null,
    selfManaged: false,
    matchRefereeId: null,
    deadlineAt: null,
    ...overrides,
  };
}

export function loadedAssignment(overrides: Partial<LoadedAssignment> = {}): LoadedAssignment {
  return { entryKey: "m:1", userId: 1, role: "REFEREE", source: "AUTO", reason: "LOAD", confirmed: false, ...overrides };
}

/** `seesHidden` suit par défaut le rôle d'arbitre (tous deux viennent de `tournaments`). */
export function loadedMember(overrides: Partial<LoadedMember> = {}): LoadedMember {
  const roles = overrides.roles ?? ["REFEREE"];
  return { userId: 1, pseudo: "Membre", roles, soloCaster: false, seesHidden: roles.includes("REFEREE"), suspended: false, ...overrides };
}

export function planningData(overrides: Partial<PlanningData> = {}): PlanningData {
  return {
    entries: [],
    durations: DEFAULT_PLANNING_DURATIONS,
    availability: [],
    assignments: [],
    removals: [],
    withdrawals: [],
    matchCasters: new Map(),
    members: [],
    ...overrides,
  };
}

export function entryView(overrides: Partial<PlanningEntryView> = {}): PlanningEntryView {
  return {
    key: "m:1",
    kind: "MATCH",
    tournamentId: 10,
    tournamentName: "Coupe",
    game: "OW",
    matchId: 1,
    roundNumber: 1,
    round: null,
    matchNumber: 1,
    team1: null,
    team2: null,
    startAt: new Date(MONDAY).toISOString(),
    endAt: new Date(MONDAY + HOUR_MS).toISOString(),
    open: true,
    editable: true,
    hidden: false,
    channelUrl: null,
    selfManaged: false,
    deadlineAt: null,
    confirmAt: null,
    confirmPending: false,
    assignments: [],
    coverage: planningCoverage({ hasReferee: false, casterIds: [], prodIds: [], soloCasterIds: new Set() }),
    mine: [],
    availability: [],
    unfilled: [],
    withdrawals: [],
    ...overrides,
  };
}
