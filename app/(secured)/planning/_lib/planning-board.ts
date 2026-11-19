/**
 * Logique pure de l'écran « Planning » (`docs/features/CAST_PLANNING.md`) :
 * regroupement par semaine, teinte de couverture, choix proposés au staff,
 * texte d'un refus. Se teste sans navigateur.
 */
import type { PillVariant } from "@/components/cyber/Pill";
import {
  planningCastersFull,
  planningDayStart,
  planningNextWeekStart,
  planningWeekStart,
  PLANNING_MAX_CASTERS,
  type AvailabilityStatus,
  type CoverageLevel,
  type PlanningRole,
} from "@/lib/shared/planning";
import { rolesConflict } from "@/lib/shared/planning-planner";
import type { PlanningAvailabilityView, PlanningEntryView, PlanningMember, PlanningView, WithdrawalResponse } from "@/lib/shared/planning-view";

export type PlanningDay = { dayStart: number; entries: PlanningEntryView[] };
export type PlanningWeek = { weekStart: number; entries: PlanningEntryView[]; days: PlanningDay[] };

type EntryDates = { start: number; week: number; day: number };

// Semaine et jour (minuit à Paris) d'une entrée : `Intl` n'est interrogé qu'une
// fois par entrée (les entrées gardent leur identité d'une relecture à l'autre,
// `mergeView`), non à chaque changement de filtre.
const datesOf = new WeakMap<PlanningEntryView, EntryDates>();

function entryDates(entry: PlanningEntryView): EntryDates {
  let dates = datesOf.get(entry);
  if (!dates) {
    const start = Date.parse(entry.startAt);
    dates = { start, week: planningWeekStart(start), day: planningDayStart(start) };
    datesOf.set(entry, dates);
  }
  return dates;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Clé `localStorage` d'une section repliable du planning, propre au compte (un
 * appareil partagé garde le choix de chacun) **sans son numéro en clair** :
 * une empreinte courte (FNV-1a 32 bits, base 36). Ce n'est pas un secret — la
 * clé ne quitte pas l'appareil et ne porte qu'un état ouvert/replié — mais
 * l'outil de développement d'un poste partagé n'y lit plus quels comptes ont
 * ouvert le planning.
 */
export function planningOpenKey(section: "past" | "staff", userId: number): string {
  let hash = 0x811c9dc5;
  for (const char of `bg-planning:${userId}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `planning:${section}-open:${(hash >>> 0).toString(36)}`;
}

/**
 * Une entrée passée : jouée — match clos, tournoi terminé, plus rien n'y est
 * modifiable. Une fin estimée écoulée n'y suffit pas : un match en retard ou
 * qui s'éternise se joue encore et reste « à venir », avec ses actions.
 */
export function isPastEntry(entry: Pick<PlanningEntryView, "editable">): boolean {
  return !entry.editable;
}

/** Sépare les entrées en (à venir, passées), l'ordre de chacune restant celui reçu. */
export function splitPast<T extends Pick<PlanningEntryView, "editable">>(entries: readonly T[]): { upcoming: T[]; past: T[] } {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const entry of entries) (isPastEntry(entry) ? past : upcoming).push(entry);
  return { upcoming, past };
}

/**
 * Les semaines passées, **la plus récente en tête** (jours et créneaux aussi) :
 * on rouvre « Matchs passés » pour le match d'hier, pas pour celui d'il y a trois mois.
 */
export function newestFirst(weeks: readonly PlanningWeek[]): PlanningWeek[] {
  return [...weeks].reverse().map((week) => ({
    ...week,
    entries: [...week.entries].reverse(),
    days: [...week.days].reverse().map((day) => ({ ...day, entries: [...day.entries].reverse() })),
  }));
}

/** Les entrées par semaine (lundi, minuit à Paris), dans l'ordre chronologique. */
export function groupByWeek(entries: readonly PlanningEntryView[]): PlanningWeek[] {
  const weeks = new Map<number, PlanningEntryView[]>();
  const sorted = [...entries].sort((a, b) => entryDates(a).start - entryDates(b).start || a.key.localeCompare(b.key));
  for (const entry of sorted) push(weeks, entryDates(entry).week, entry);
  return [...weeks.entries()].map(([weekStart, list]) => ({ weekStart, entries: list, days: groupByDay(list) }));
}

/** Les entrées (déjà triées) par jour, minuit à Paris. */
export function groupByDay(entries: readonly PlanningEntryView[]): PlanningDay[] {
  const days = new Map<number, PlanningEntryView[]>();
  for (const entry of entries) push(days, entryDates(entry).day, entry);
  return [...days.entries()].map(([dayStart, list]) => ({ dayStart, entries: list }));
}

/**
 * Une relecture qui garde l'identité de ce qui n'a pas changé : une entrée (ou
 * la liste des comptes) identique à celle d'avant reste le même objet, si bien
 * que les cartes mémoïsées ne se redessinent pas pour une relecture sans effet
 * sur elles.
 */
export function mergeView(previous: PlanningView | null, next: PlanningView): PlanningView {
  if (!previous) return next;
  const before = new Map(previous.entries.map((entry) => [entry.key, entry]));
  const entries = next.entries.map((entry) => {
    const old = before.get(entry.key);
    return old && JSON.stringify(old) === JSON.stringify(entry) ? old : entry;
  });
  const same = <T,>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);
  return {
    ...next,
    entries: entries.length === previous.entries.length && entries.every((entry, i) => entry === previous.entries[i]) ? previous.entries : entries,
    members: same(previous.members, next.members) ? previous.members : next.members,
    myRoles: same(previous.myRoles, next.myRoles) ? previous.myRoles : next.myRoles,
    durations: same(previous.durations, next.durations) ? previous.durations : next.durations,
  };
}

/**
 * Pose la disponibilité du lecteur sur une entrée **sans relire la page** :
 * c'est le geste le plus fréquent (un clic par créneau et par rôle), et le
 * serveur n'y change rien d'autre. Pour le staff, la ligne de ses propres
 * disponibilités (`availability`) se met à jour de même.
 */
export function applyAvailability(
  view: PlanningView,
  change: { entryKey: string; role: PlanningRole; status: AvailabilityStatus; preferred: boolean },
): PlanningView {
  const row = { userId: view.me, role: change.role, status: change.status, preferred: change.preferred };
  const put = (rows: readonly PlanningAvailabilityView[]) => [
    ...rows.filter((existing) => !(existing.userId === view.me && existing.role === change.role)),
    row,
  ];
  return {
    ...view,
    entries: view.entries.map((entry) =>
      entry.key === change.entryKey
        ? { ...entry, mine: put(entry.mine), availability: view.canManage ? put(entry.availability) : entry.availability }
        : entry,
    ),
  };
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
 * tiennent le rôle, n'y sont pas déjà et voient l'entrée si elle est cachée ; les disponibles d'abord (préférence
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
  const answers = new Map(entry.availability.filter((row) => row.role === role).map((row) => [row.userId, row]));
  return members
    // Un tournoi encore caché ne va qu'à qui le voit (le serveur refuse les autres : `PLANNING_HIDDEN_FOR_MEMBER`).
    .filter((member) => member.roles.includes(role) && !taken.has(member.userId) && (!entry.hidden || member.seesHidden !== false))
    .map((member) => {
      const row = answers.get(member.userId);
      return { member, status: row?.status ?? null, preferred: row?.preferred ?? false };
    })
    .sort(
      (a, b) =>
        rank[a.status ?? "UNKNOWN"] - rank[b.status ?? "UNKNOWN"] ||
        Number(b.preferred) - Number(a.preferred) ||
        a.member.pseudo.localeCompare(b.member.pseudo),
    );
}

/**
 * Ce que la ligne d'un rôle offre au staff : `full`, le plafond de casters
 * atteint (`PLANNING_MAX_CASTERS` : liste masquée, « Deux casters au plus ») ;
 * `candidates`, la liste « Ajouter » (vide sans droit, entrée close ou plafond) ;
 * `manage`, le staff peut modifier la ligne (droit et entrée modifiable).
 */
export function roleChoices(
  entry: PlanningEntryView,
  role: PlanningRole,
  members: readonly PlanningMember[],
  canManage: boolean,
): { manage: boolean; full: boolean; candidates: ReturnType<typeof candidatesFor> } {
  const manage = canManage && entry.editable;
  const full = manage && role === "CASTER" && planningCastersFull(entry.assignments);
  return { manage, full, candidates: manage && !full ? candidatesFor(entry, role, members) : [] };
}

/**
 * Le texte du plafond atteint : ce que le staff peut faire. Un caster retirable
 * ici (ligne du planning) : le retirer ; s'il n'y a que des propositions du
 * calcul, le dire ; si tous sont inscrits sur le match, ou si les inscrits y
 * suffisent à atteindre le plafond, il faut passer par le match.
 */
export function castersFullKind(
  entry: PlanningEntryView,
): "castersFull" | "castersFullProvisional" | "castersFullMatch" | "castersFullOver" {
  const casters = entry.assignments.filter((row) => row.role === "CASTER");
  const removable = casters.filter((row) => row.source !== "CAST");
  // Les inscrits sur le match atteignent seuls le plafond (inscriptions non plafonnées) : retirer une ligne du
  // planning ne rouvrirait pas la liste, il faut passer par le match.
  if (removable.length === 0 || casters.length - removable.length >= PLANNING_MAX_CASTERS) return "castersFullMatch";
  // Au-delà du plafond (inscrits compris) : un seul retrait ne suffit pas, il faut n'en laisser qu'un.
  if (casters.length > PLANNING_MAX_CASTERS) return "castersFullOver";
  return removable.every((row) => row.provisional) ? "castersFullProvisional" : "castersFull";
}

/** Le texte du dialogue de désistement : l'exception de l'autre caster qui garde la diffusion ne vaut que pour un caster. */
export function withdrawBodyKey(role: PlanningRole): "withdraw.body" | "withdraw.bodyCaster" {
  return role === "CASTER" ? "withdraw.bodyCaster" : "withdraw.body";
}

/** Le message de succès d'un désistement, selon son issue. */
export function withdrawDoneKey(
  result: WithdrawalResponse,
):
  | "withdraw.doneReplaced"
  | "withdraw.doneStreamLost"
  | "withdraw.doneUnfilled"
  | "withdraw.doneStillSignedUp"
  | "withdraw.done" {
  if (result.replaced) return "withdraw.doneReplaced";
  // Encore inscrit sur le match, il le cast toujours : à lui de s'en retirer depuis le match.
  if (result.stillSignedUp) return "withdraw.doneStillSignedUp";
  if (!result.unfilled) return "withdraw.done";
  // Diffusion perdue : le caster restant est toujours affiché, rien n'est montré « à pourvoir ».
  return result.streamLost ? "withdraw.doneStreamLost" : "withdraw.doneUnfilled";
}

/** Clé du texte d'un refus : un code connu de `errors`, sinon `generic`. */
export function errorKey(code: string | null | undefined, known: object): string {
  return code && Object.hasOwn(known, code) ? code : "generic";
}

/** Le geste a-t-il été refusé pour excès (429) ? Rien n'a changé : la page ne se relit pas. */
export function isThrottled(error: unknown): boolean {
  return error instanceof Error && error.message === "TOO_MANY_REQUESTS";
}

/** Fenêtre d'un calcul de semaine : `[lundi, lundi suivant[` (minuit à Paris) en ISO. */
export function weekWindow(weekStart: number): { from: string; to: string } {
  return { from: new Date(weekStart).toISOString(), to: new Date(planningNextWeekStart(weekStart)).toISOString() };
}

/** Échéance d'une confirmation par délai de prévenance (`now` + `hours`). */
export function leadUntil(now: number, hours: number): string {
  return new Date(now + hours * 60 * 60 * 1000).toISOString();
}

/** On se désiste jusqu'au début de l'entrée (`now` : l'horloge d'affichage), tant qu'elle reste modifiable. */
export function canWithdraw(entry: Pick<PlanningEntryView, "editable" | "startAt">, now: number): boolean {
  return entry.editable && Date.parse(entry.startAt) > now;
}
