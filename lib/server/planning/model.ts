/**
 * Ce que tient chaque entrée du planning, toutes sources réunies : lignes du
 * planning, arbitre désigné du match (`bg_matches.referee_user_id`) et casters
 * inscrits (`bg_match_casters`). Pur : se teste sans base.
 */
import { planningCoverage, type Coverage } from "@/lib/shared/planning";
import type { PlanningAssignmentView } from "@/lib/shared/planning-view";
import type { LoadedEntry, PlanningData } from "./load";

/**
 * Les attributions d'une entrée. L'arbitre d'un **match** est celui du match :
 * une ligne REFEREE confirmée du planning n'en est que la provenance quand
 * elle nomme le même compte ; un arbitre désigné ailleurs (fenêtre
 * « Arbitrage ») vaut `MATCH`. Une proposition **provisoire** d'arbitre de
 * match ne compte que tant que le match n'a pas d'arbitre. Un caster inscrit
 * sur le match sans ligne du planning tenue (confirmée ou choix du staff) vaut
 * `CAST` : son inscription l'emporte sur une simple proposition provisoire.
 * La prod placée sur le match (`bg_matches.prod_user_id`, `MATCH_PROD.md`)
 * vaut aussi `CAST` et fait foi : une seule par match, elle remplace toute
 * autre ligne PROD (proposition provisoire ou ligne tenue d'un autre compte)
 * et la proposition provisoire qui la ferait caster ; une ligne PROD tenue qui
 * la nomme en reste la provenance.
 */
function matchRefereeRows(entry: LoadedEntry, rows: PlanningData["assignments"]): PlanningAssignmentView[] {
  if (entry.matchRefereeId === null) {
    return rows
      .filter((row) => row.role === "REFEREE" && !row.confirmed)
      .map((row) => ({ userId: row.userId, role: "REFEREE", source: row.source, reason: row.reason, provisional: true }));
  }
  const provenance = rows.find((row) => row.role === "REFEREE" && row.confirmed && row.userId === entry.matchRefereeId);
  return [
    provenance
      ? { userId: provenance.userId, role: "REFEREE", source: provenance.source, reason: provenance.reason, provisional: false }
      : { userId: entry.matchRefereeId, role: "REFEREE", source: "MATCH", reason: "MATCH", provisional: false },
  ];
}

const byEntryCache = new WeakMap<PlanningData["assignments"], Map<string, PlanningData["assignments"]>>();

/** Les lignes du planning de chaque entrée, regroupées une fois par chargement (et non refiltrées à chaque entrée). */
function assignmentsByEntry(rows: PlanningData["assignments"]): Map<string, PlanningData["assignments"]> {
  let index = byEntryCache.get(rows);
  if (!index) {
    index = new Map();
    for (const row of rows) {
      const list = index.get(row.entryKey);
      if (list) list.push(row);
      else index.set(row.entryKey, [row]);
    }
    byEntryCache.set(rows, index);
  }
  return index;
}

export function entryAssignments(
  entry: LoadedEntry,
  data: Pick<PlanningData, "assignments" | "matchCasters">,
): PlanningAssignmentView[] {
  const rows = assignmentsByEntry(data.assignments).get(entry.key) ?? [];
  const out: PlanningAssignmentView[] = [];
  for (const row of rows) {
    if (entry.kind === "MATCH" && row.role === "REFEREE") continue;
    out.push({ userId: row.userId, role: row.role, source: row.source, reason: row.reason, provisional: !row.confirmed });
  }
  if (entry.kind === "MATCH") out.push(...matchRefereeRows(entry, rows));
  for (const userId of data.matchCasters.get(entry.key) ?? []) {
    const index = out.findIndex((row) => row.role === "CASTER" && row.userId === userId);
    const signup: PlanningAssignmentView = { userId, role: "CASTER", source: "CAST", reason: "CAST", provisional: false };
    if (index === -1) out.push(signup);
    else if (out[index].provisional) out[index] = signup;
  }
  const prodId = entry.kind === "MATCH" ? (entry.matchProdId ?? null) : null;
  return sortedRows(prodId === null ? out : withMatchProd(out, prodId));
}

const ROLE_ORDER = { REFEREE: 0, CASTER: 1, PROD: 2 } as const;

function sortedRows(rows: PlanningAssignmentView[]): PlanningAssignmentView[] {
  return rows.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.userId - b.userId);
}

/**
 * La prod du match fait foi : une seule passe écarte les lignes PROD (la
 * sienne, tenue, est gardée) et la proposition de caster de la prod, puis la pose.
 */
function withMatchProd(rows: readonly PlanningAssignmentView[], prodId: number): PlanningAssignmentView[] {
  let held: PlanningAssignmentView | undefined;
  const kept: PlanningAssignmentView[] = [];
  for (const row of rows) {
    if (row.role === "PROD") held ??= row.userId === prodId && !row.provisional ? row : undefined;
    else if (!(row.role === "CASTER" && row.userId === prodId && row.provisional)) kept.push(row);
  }
  kept.push(held ?? { userId: prodId, role: "PROD", source: "CAST", reason: "MATCH", provisional: false });
  return kept;
}

/** Couverture d'une entrée : les rôles tenus comptent (propositions provisoires comprises), pas les personnes. */
export function entryCoverage(
  assignments: readonly PlanningAssignmentView[],
  soloCasterIds: ReadonlySet<number>,
): Coverage {
  return planningCoverage({
    hasReferee: assignments.some((row) => row.role === "REFEREE"),
    casterIds: assignments.filter((row) => row.role === "CASTER").map((row) => row.userId),
    prodIds: assignments.filter((row) => row.role === "PROD").map((row) => row.userId),
    soloCasterIds,
  });
}
