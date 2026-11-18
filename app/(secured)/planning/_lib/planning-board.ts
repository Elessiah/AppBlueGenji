/**
 * Logique pure de l'écran « Planning » (`docs/features/CAST_PLANNING.md`) :
 * regroupement par semaine, teinte de couverture, choix proposés au staff,
 * texte d'un refus. Se teste sans navigateur.
 */
import type { PillVariant } from "@/components/cyber/Pill";
import { planningDayStart, planningNextWeekStart, planningWeekStart, type CoverageLevel, type PlanningRole } from "@/lib/shared/planning";
import { rolesConflict } from "@/lib/shared/planning-planner";
import type { PlanningEntryView, PlanningMember } from "@/lib/shared/planning-view";

export type PlanningDay = { dayStart: number; entries: PlanningEntryView[] };
export type PlanningWeek = { weekStart: number; entries: PlanningEntryView[]; days: PlanningDay[] };

/** Les entrées par semaine (lundi, minuit à Paris), dans l'ordre chronologique. */
export function groupByWeek(entries: readonly PlanningEntryView[]): PlanningWeek[] {
  const weeks = new Map<number, PlanningEntryView[]>();
  const sorted = [...entries].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.key.localeCompare(b.key));
  for (const entry of sorted) {
    const week = planningWeekStart(Date.parse(entry.startAt));
    weeks.set(week, [...(weeks.get(week) ?? []), entry]);
  }
  return [...weeks.entries()].map(([weekStart, list]) => ({ weekStart, entries: list, days: groupByDay(list) }));
}

/** Les entrées (déjà triées) par jour, minuit à Paris. */
export function groupByDay(entries: readonly PlanningEntryView[]): PlanningDay[] {
  const days = new Map<number, PlanningEntryView[]>();
  for (const entry of entries) {
    const day = planningDayStart(Date.parse(entry.startAt));
    days.set(day, [...(days.get(day) ?? []), entry]);
  }
  return [...days.entries()].map(([dayStart, list]) => ({ dayStart, entries: list }));
}

/** Les filtres de l'agenda : « mes créneaux », « à couvrir », un tournoi. */
export type PlanningFilters = { mine: boolean; uncovered: boolean; tournamentId: number | null };

export const NO_FILTERS: PlanningFilters = { mine: false, uncovered: false, tournamentId: null };

export function filtersActive(filters: PlanningFilters): boolean {
  return filters.mine || filters.uncovered || filters.tournamentId !== null;
}

/** Le lecteur tient-il un rôle sur cette entrée (proposition provisoire comprise) ? */
export function heldBy(entry: PlanningEntryView, userId: number): boolean {
  return entry.assignments.some((row) => row.userId === userId);
}

/**
 * Une entrée à couvrir : ouverte, pas en autogestion voulue, et il manque
 * quelqu'un (ni caster, ou caster sans prod, ou diffusé sans arbitre).
 */
export function needsCover(entry: PlanningEntryView): boolean {
  if (!entry.open || entry.selfManaged) return false;
  const { level, refereePriority, casterNeedsProd } = entry.coverage;
  return refereePriority || casterNeedsProd || level === "REFEREED" || level === "SELF_MANAGED";
}

export function filterEntries(
  entries: readonly PlanningEntryView[],
  filters: PlanningFilters,
  me: number,
): PlanningEntryView[] {
  return entries.filter(
    (entry) =>
      (!filters.mine || heldBy(entry, me)) &&
      (!filters.uncovered || needsCover(entry)) &&
      (filters.tournamentId === null || entry.tournamentId === filters.tournamentId),
  );
}

/** Les tournois présents dans l'agenda, par nom. */
export function tournamentChoices(entries: readonly PlanningEntryView[]): { id: number; name: string }[] {
  const byId = new Map(entries.map((entry) => [entry.tournamentId, entry.tournamentName]));
  return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Teinte de la pastille de couverture : jamais d'ambre, réservé à « à arbitrer en priorité ». */
export const COVERAGE_PILL: Readonly<Record<CoverageLevel, PillVariant>> = {
  COMPLETE: "success",
  STREAMED: "info",
  REFEREED: "accent",
  SELF_MANAGED: "neutral",
};

/** Une entrée porte-t-elle des propositions encore provisoires ? */
export function hasProvisional(entry: PlanningEntryView): boolean {
  return entry.assignments.some((row) => row.provisional);
}

/**
 * Les membres que le staff peut ajouter dans un rôle d'une entrée : ceux qui
 * tiennent le rôle et n'y sont pas déjà ; les disponibles d'abord (préférence
 * en tête), puis « à voir », sans réponse, absents — chacun par pseudo.
 */
export function candidatesFor(
  entry: PlanningEntryView,
  role: PlanningRole,
  members: readonly PlanningMember[],
): { member: PlanningMember; status: "AVAILABLE" | "UNAVAILABLE" | "PENDING" | null; preferred: boolean }[] {
  // Déjà tenu ce rôle, ou un rôle incompatible (caster et prod) sur le même créneau : hors liste.
  const taken = new Set(
    entry.assignments.filter((row) => row.role === role || rolesConflict(row.role, role)).map((row) => row.userId),
  );
  const rank = { AVAILABLE: 0, PENDING: 1, UNKNOWN: 2, UNAVAILABLE: 3 } as const;
  return members
    .filter((member) => member.roles.includes(role) && !taken.has(member.userId))
    .map((member) => {
      const row = entry.availability.find((candidate) => candidate.userId === member.userId && candidate.role === role);
      return { member, status: row?.status ?? null, preferred: row?.preferred ?? false };
    })
    .sort(
      (a, b) =>
        rank[a.status ?? "UNKNOWN"] - rank[b.status ?? "UNKNOWN"] ||
        Number(b.preferred) - Number(a.preferred) ||
        a.member.pseudo.localeCompare(b.member.pseudo),
    );
}

/** Clé du texte d'un refus : un code connu de `errors`, sinon `generic`. */
export function errorKey(code: string | null | undefined, known: object): string {
  return code && Object.hasOwn(known, code) ? code : "generic";
}

/** Fenêtre d'un calcul de semaine : `[lundi, lundi suivant[` (minuit à Paris) en ISO. */
export function weekWindow(weekStart: number): { from: string; to: string } {
  return { from: new Date(weekStart).toISOString(), to: new Date(planningNextWeekStart(weekStart)).toISOString() };
}

/** Échéance d'une confirmation par délai de prévenance (`now` + `hours`). */
export function leadUntil(now: number, hours: number): string {
  return new Date(now + hours * 60 * 60 * 1000).toISOString();
}
