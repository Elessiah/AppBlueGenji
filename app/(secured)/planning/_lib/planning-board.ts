/**
 * Logique pure de l'écran « Planning » (`docs/features/CAST_PLANNING.md`) :
 * regroupement par semaine, teinte de couverture, choix proposés au staff,
 * texte d'un refus. Se teste sans navigateur.
 */
import type { PillVariant } from "@/components/cyber/Pill";
import { planningWeekStart, type CoverageLevel, type PlanningRole } from "@/lib/shared/planning";
import { rolesConflict } from "@/lib/shared/planning-planner";
import type { PlanningEntryView, PlanningMember } from "@/lib/shared/planning-view";

export type PlanningWeek = { weekStart: number; entries: PlanningEntryView[] };

const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

/** Les entrées par semaine (lundi UTC), dans l'ordre chronologique. */
export function groupByWeek(entries: readonly PlanningEntryView[]): PlanningWeek[] {
  const weeks = new Map<number, PlanningEntryView[]>();
  const sorted = [...entries].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.key.localeCompare(b.key));
  for (const entry of sorted) {
    const week = planningWeekStart(Date.parse(entry.startAt));
    weeks.set(week, [...(weeks.get(week) ?? []), entry]);
  }
  return [...weeks.entries()].map(([weekStart, list]) => ({ weekStart, entries: list }));
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

/** Fenêtre d'un calcul de semaine : `[lundi, lundi + 7 j[` en ISO. */
export function weekWindow(weekStart: number): { from: string; to: string } {
  return { from: new Date(weekStart).toISOString(), to: new Date(weekStart + WEEK_MS).toISOString() };
}

/** Échéance d'une confirmation par délai de prévenance (`now` + `hours`). */
export function leadUntil(now: number, hours: number): string {
  return new Date(now + hours * 60 * 60 * 1000).toISOString();
}
