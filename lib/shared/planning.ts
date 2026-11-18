/**
 * Planning des casts, prods et arbitres (`docs/features/CAST_PLANNING.md`) —
 * règles pures, importables partout : clés d'entrée, rôles du planning,
 * niveaux de couverture. L'attribution automatique : `planning-planner.ts`.
 *
 * Règles d'équipe d'une diffusion (addendum de l'utilisateur, 2026-11-18) :
 * l'idéal est arbitre + caster + prod ; un arbitre seul suffit à tenir un
 * match ; un prod ne sert à rien sans caster (jamais attribué ni compté seul) ;
 * un caster « autonome » (`soloCaster`) diffuse seul, les autres ont besoin
 * d'un prod ; un match diffusé sans arbitre est « à arbitrer en priorité ».
 */
import { can, type PlatformRole } from "@/lib/shared/permissions";

/** Adresse de la page « Planning » (sans préfixe de langue). */
export const PLANNING_PATH = "/planning";

/** Rôles du planning : qui arbitre, qui caste, qui assure la production. */
export type PlanningRole = "REFEREE" | "CASTER" | "PROD";
export const PLANNING_ROLES: readonly PlanningRole[] = ["REFEREE", "CASTER", "PROD"];

/** Disponibilité donnée par un membre (Présent / Absent / En attente du tableur d'origine). */
export type AvailabilityStatus = "AVAILABLE" | "UNAVAILABLE" | "PENDING";
export const AVAILABILITY_STATUSES: readonly AvailabilityStatus[] = ["AVAILABLE", "UNAVAILABLE", "PENDING"];

/**
 * Pourquoi un membre est attribué : sa préférence, la répartition de la
 * charge, un choix du staff (`MANUAL`), ou un état déjà posé ailleurs — un
 * caster inscrit sur le match (`CAST`), l'arbitre désigné du match hors
 * planning (`MATCH`).
 */
export type AssignmentReason = "PREFERENCE" | "LOAD" | "MANUAL" | "CAST" | "MATCH";
export type AssignmentSource = "AUTO" | "MANUAL";

/**
 * Niveaux de couverture, du meilleur au pire : complet (arbitre + caster +
 * prod), diffusé (caster autonome, ou caster + prod — avec ou sans arbitre),
 * arbitré seul, autogestion (personne).
 */
export type CoverageLevel = "COMPLETE" | "STREAMED" | "REFEREED" | "SELF_MANAGED";
export const COVERAGE_LEVELS: readonly CoverageLevel[] = ["COMPLETE", "STREAMED", "REFEREED", "SELF_MANAGED"];

/** Une entrée du planning : un match planifié, ou un tournoi entier (sans planification des matchs). */
export type PlanningEntryKind = "MATCH" | "TOURNAMENT";

/** Semaines précédentes comptées dans l'équité (historique des attributions). */
export const PLANNING_HISTORY_WEEKS = 8;
/** Durée de garde des disponibilités et attributions, après le début de l'entrée. */
export const PLANNING_RETENTION_DAYS = 90;
/** Le planning montre les entrées commencées depuis au plus ce délai. */
export const PLANNING_PAST_DAYS = 7;
/** Arbitres posés par le calcul sur un tournoi entier (évènement aux matchs enchaînés) ; le staff peut en ajouter. */
export const PLANNING_EVENT_REFEREES = 2;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Clé stable d'une entrée : `m:<match>` ou `t:<tournoi>`. */
export function planningEntryKey(kind: PlanningEntryKind, id: number): string {
  return `${kind === "MATCH" ? "m" : "t"}:${id}`;
}

/** Lecture d'une clé reçue (corps de requête) : `null` si elle n'est pas de la forme attendue. */
export function parsePlanningEntryKey(value: unknown): { kind: PlanningEntryKind; id: number } | null {
  if (typeof value !== "string") return null;
  const match = /^([mt]):([1-9]\d{0,14})$/.exec(value);
  if (!match) return null;
  return { kind: match[1] === "m" ? "MATCH" : "TOURNAMENT", id: Number(match[2]) };
}

export function isPlanningRole(value: unknown): value is PlanningRole {
  return typeof value === "string" && (PLANNING_ROLES as readonly string[]).includes(value);
}

export function isAvailabilityStatus(value: unknown): value is AvailabilityStatus {
  return typeof value === "string" && (AVAILABILITY_STATUSES as readonly string[]).includes(value);
}

/**
 * Les rôles du planning qu'un compte tient : arbitre avec la permission
 * `tournaments` (rôle `ARBITRE` ou administrateur — celle qui désigne un
 * arbitre de match), caster avec le rôle `CASTER`, prod avec le rôle `PROD`.
 * En vue joueur (`roles: []`, `isAdmin: false`), aucun.
 */
export function planningRolesOf(
  user: { roles?: readonly PlatformRole[]; isAdmin?: boolean } | null | undefined,
): PlanningRole[] {
  if (!user) return [];
  const roles = user.roles ?? [];
  const held: PlanningRole[] = [];
  if (can(user, "tournaments")) held.push("REFEREE");
  if (roles.includes("CASTER")) held.push("CASTER");
  if (roles.includes("PROD")) held.push("PROD");
  return held;
}

/** Ce que compte une entrée pour sa couverture. */
export type CoverageInput = {
  hasReferee: boolean;
  casterIds: readonly number[];
  prodIds: readonly number[];
  /** Casters autonomes (diffusent seuls). */
  soloCasterIds: ReadonlySet<number>;
};

export type Coverage = {
  level: CoverageLevel;
  streamed: boolean;
  /** Diffusé sans arbitre : « à arbitrer en priorité ». */
  refereePriority: boolean;
  /** Prods attribués sans caster : ils ne comptent pas (un prod ne fait rien sans caster). */
  idleProds: number;
  /** Un caster qui n'est pas autonome, sans prod : il ne diffuse pas encore. */
  casterNeedsProd: boolean;
};

/** Niveau de couverture d'une entrée (voir {@link CoverageLevel}). */
export function planningCoverage(input: CoverageInput): Coverage {
  const casters = input.casterIds.length;
  const prods = casters > 0 ? input.prodIds.length : 0;
  const solo = input.casterIds.some((id) => input.soloCasterIds.has(id));
  const streamed = casters > 0 && (prods > 0 || solo);
  let level: CoverageLevel = "SELF_MANAGED";
  if (streamed && input.hasReferee && prods > 0) level = "COMPLETE";
  else if (streamed) level = "STREAMED";
  else if (input.hasReferee) level = "REFEREED";
  return {
    level,
    streamed,
    refereePriority: streamed && !input.hasReferee,
    idleProds: casters > 0 ? 0 : input.prodIds.length,
    casterNeedsProd: casters > 0 && !streamed,
  };
}

/** Début de la semaine (lundi 00:00 UTC) qui contient `at` : la clé de charge hebdomadaire. */
export function planningWeekStart(at: number): number {
  const day = new Date(at);
  const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const weekday = (day.getUTCDay() + 6) % 7; // lundi = 0
  return midnight - weekday * DAY_MS;
}

/** Début de la période d'équité : les {@link PLANNING_HISTORY_WEEKS} semaines qui précèdent celle de `now`. */
export function planningHistoryStart(now: number): number {
  return planningWeekStart(now) - PLANNING_HISTORY_WEEKS * WEEK_MS;
}
