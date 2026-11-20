/**
 * Placement du cast d'un match par le planning (`docs/features/CAST_PLANNING.md`
 * § Placement sur le match) : quand **personne** ne caste encore un match — ni
 * caster inscrit, ni prod placée, hors ceux que le planning y a lui-même posés —,
 * les casters et la prod que le planning **tient** sur ce créneau (proposition
 * confirmée ou choix du staff) y sont placés, comme une inscription de cast et
 * une prod posée par le staff.
 *
 * Joué après le geste qui rend la ligne tenue (confirmation, confirmation
 * d'office, choix du staff, remplaçant confirmé d'un désistement), pour les
 * seules lignes de ce geste : une personne qui a quitté le match depuis n'y est
 * jamais reposée par un geste suivant. Chaque match a sa transaction, dans
 * l'ordre des verrous d'une prise de prod (`claimMatchProd`) : comptes (en
 * partage), tournoi, puis match (`FOR UPDATE`, sans jointure — MariaDB), puis
 * casters, streams et lignes du planning relus en lecture courante. Ne lève
 * jamais : un match en échec est consigné et laissé au staff, le planning reste
 * écrit.
 */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { failureDiagnostic } from "@/lib/server/failure-reason";
import { auditStaffAction } from "@/lib/server/staff-audit";
import { announceCastChange, type CastPairing } from "@/lib/server/tournaments/cast-notices";
import { loadCastBlocks } from "@/lib/server/tournaments/cast-eligibility";
import { retryOnDeadlock } from "@/lib/server/tournaments/deadlock-retry";
import { lockMatchCasters, lockMatchStreams } from "@/lib/server/tournaments/match-casters";
import { resolveTeamParty } from "@/lib/server/tournaments/match-launch";
import { publishMatchUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { announceProdChange, type ProdChange } from "@/lib/server/tournaments/prod-notices";
import { heldPlanningRowSql } from "@/lib/server/tournaments/prod-sql";
import { inTransaction } from "@/lib/server/tournaments/transaction";
import type { StaffActor } from "@/lib/shared/log-privacy";
import { nullableId } from "@/lib/shared/nullable-id";
import type { PlanningRole } from "@/lib/shared/planning";
import type { TournamentGame } from "@/lib/shared/types";
import { lockedHolding, type HoldingEntry } from "./auto-assign";
import type { LoadedEntry } from "./load";

/** Une ligne du planning qu'un geste vient de rendre tenue. */
export type PlannedCastLine = { entry: LoadedEntry; userId: number; role: PlanningRole };

/** Ce qu'un match a reçu du planning. */
export type MatchPlacement = { matchId: number; casterIds: number[]; prodId: number | null };

/** Pourquoi rien n'a été placé sur un match. */
export type PlacementSkip = "MATCH_GONE" | "MATCH_CLOSED" | "CAST_HELD" | "NONE_ELIGIBLE";

/** L'issue du placement d'un match. */
export type PlacementOutcome =
  | { skip: PlacementSkip }
  | { placement: MatchPlacement; tournamentId: number; pairing: CastPairing };

type PlacementMatchRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  status: string;
  is_bye: number;
  team1_id: number | null;
  team2_id: number | null;
  launched_at: Date | string | null;
  prod_user_id: number | null;
};

type HeldLineRow = RowDataPacket & { user_id: number; role: PlanningRole };

type PlacementTarget = { entry: LoadedEntry; casterIds: number[]; prodIds: number[] };

/** Les lignes CASTER / PROD des entrées de match, groupées par match (un arbitre suit le match par sa désignation). */
export function placementTargets(lines: readonly PlannedCastLine[]): Map<number, PlacementTarget> {
  const byMatch = new Map<number, PlacementTarget>();
  for (const line of lines) {
    const { entry } = line;
    if (entry.kind !== "MATCH" || entry.matchId === null || line.role === "REFEREE") continue;
    const target = byMatch.get(entry.matchId) ?? { entry, casterIds: [], prodIds: [] };
    const list = line.role === "CASTER" ? target.casterIds : target.prodIds;
    if (!list.includes(line.userId)) list.push(line.userId);
    byMatch.set(entry.matchId, target);
  }
  return byMatch;
}

/**
 * Le cast du match est-il libre pour le planning ? Oui quand chaque caster
 * inscrit et la prod placée y sont tenus par une ligne du planning du même rôle
 * — ce que le planning y a lui-même posé ; un caster inscrit de lui-même, ou une
 * prod placée hors du planning, ferme le match au placement (rien n'est ni
 * remplacé ni ajouté).
 */
export function castFreeForPlanning(
  casterIds: readonly number[],
  prodId: number | null,
  held: { casterIds: ReadonlySet<number>; prodIds: ReadonlySet<number> },
): boolean {
  return casterIds.every((id) => held.casterIds.has(id)) && (prodId === null || held.prodIds.has(prodId));
}

/** Ligne pm2 du placement : le match et les comptes placés, par identifiant (jamais sur Discord). */
export function placementAuditLine(placement: MatchPlacement): string {
  const parts: string[] = [];
  if (placement.casterIds.length > 0) parts.push(`caster(s) ${placement.casterIds.map((id) => `#${id}`).join(", ")}`);
  if (placement.prodId !== null) parts.push(`prod #${placement.prodId}`);
  return `cast du match #${placement.matchId} posé depuis le planning : ${parts.join(" ; ")}`;
}

/**
 * Place, match par match, les casters et la prod des lignes données (celles
 * qu'un geste vient de rendre tenues). `actor` : le staff du geste, nommé dans
 * pm2 (`auditStaffAction`) ; `null` pour la confirmation d'office. Rend ce qui a
 * été placé. Ne lève jamais.
 */
export async function placePlannedCasts(lines: readonly PlannedCastLine[], actor: StaffActor | null): Promise<MatchPlacement[]> {
  const placed: MatchPlacement[] = [];
  const targets = [...placementTargets(lines)].sort(([a], [b]) => a - b);
  for (const [matchId, target] of targets) {
    try {
      const outcome = await retryOnDeadlock(() =>
        inTransaction((connection) => placeOnMatch(connection, matchId, target.entry, target.casterIds, target.prodIds)),
      );
      if ("skip" in outcome) continue;
      placed.push(outcome.placement);
      afterPlacement(outcome, actor);
    } catch (error) {
      console.error(`[planning] cast du match #${matchId} non placé depuis le planning : ${failureDiagnostic(error)}`);
    }
  }
  return placed;
}

/** Après le commit : le plateau se rafraîchit, le journal du staff (anonyme) et l'avis à la prod partent. */
function afterPlacement(outcome: Extract<PlacementOutcome, { placement: MatchPlacement }>, actor: StaffActor | null): void {
  const { placement, tournamentId, pairing } = outcome;
  publishMatchUpdatedEvent(tournamentId, { landingLive: true });
  for (const casterId of placement.casterIds) announceCastChange({ kind: "PLANNED", matchId: placement.matchId, casterId, pairing });
  if (placement.prodId !== null) {
    // Prévenue comme une prod que le staff place — jamais le staff qui se place lui-même.
    const notices: ProdChange["notices"] = placement.prodId === actor?.id ? [] : [{ userId: placement.prodId, kind: "ASSIGNED" }];
    announceProdChange({ matchId: placement.matchId, log: "PLANNED", notices, pairing });
  }
  if (actor !== null) auditStaffAction(placementAuditLine(placement), actor);
}

async function lockPlacementMatch(connection: PoolConnection, matchId: number): Promise<PlacementMatchRow | null> {
  const [rows] = await connection.execute<PlacementMatchRow[]>(
    `SELECT id, tournament_id, status, is_bye, team1_id, team2_id, launched_at, prod_user_id
       FROM bg_matches WHERE id = ? LIMIT 1 FOR UPDATE`,
    [matchId],
  );
  return rows[0] ?? null;
}

/** Les lignes CASTER / PROD tenues du match, en lecture courante verrouillée (un retrait validé depuis le geste est vu). */
async function lockedHeldLines(connection: PoolConnection, matchId: number): Promise<{ casterIds: Set<number>; prodIds: Set<number> }> {
  const [rows] = await connection.execute<HeldLineRow[]>(
    `SELECT user_id, role FROM bg_planning_assignments
      WHERE match_id = ? AND role IN ('CASTER', 'PROD') AND ${heldPlanningRowSql()}
      ORDER BY user_id LOCK IN SHARE MODE`,
    [matchId],
  );
  const casterIds = new Set<number>();
  const prodIds = new Set<number>();
  for (const row of rows) (row.role === "CASTER" ? casterIds : prodIds).add(Number(row.user_id));
  return { casterIds, prodIds };
}

async function tournamentGame(connection: PoolConnection, tournamentId: number): Promise<TournamentGame | null> {
  const [rows] = await connection.execute<(RowDataPacket & { game: TournamentGame })[]>(
    "SELECT game FROM bg_tournaments WHERE id = ? LIMIT 1",
    [tournamentId],
  );
  return rows[0]?.game ?? null;
}

/**
 * Le stream que rejoignent les casters placés : celui d'un caster déjà posé par
 * le planning (co-cast), sinon le stream du staff (le lien de l'organisation),
 * sinon un stream neuf sans lien, que le caster habille de sa chaîne
 * (« Configurer ma diffusion ») ou le staff du lien de l'organisation.
 */
async function placementStream(connection: PoolConnection, matchId: number, casterStreams: readonly number[]): Promise<number> {
  const streams = await lockMatchStreams(connection, matchId);
  const shared = casterStreams.find((id) => streams.some((stream) => stream.id === id));
  if (shared !== undefined) return shared;
  const staff = streams.find((stream) => stream.staff);
  if (staff) return staff.id;
  const [created] = await connection.execute<ResultSetHeader>(
    "INSERT INTO bg_match_streams (match_id, live_url, link_user_id) VALUES (?, NULL, NULL)",
    [matchId],
  );
  return Number(created.insertId);
}

/** Le placement d'un match, dans sa transaction (`placePlannedCasts`). */
export async function placeOnMatch(
  connection: PoolConnection,
  matchId: number,
  entry: HoldingEntry,
  casterIds: readonly number[],
  prodIds: readonly number[],
): Promise<PlacementOutcome> {
  const candidates = [
    ...casterIds.map((userId) => ({ userId, entry })),
    ...prodIds.map((userId) => ({ userId, entry })),
  ];
  // Comptes (en partage) et tournoi d'abord, puis le match : l'ordre d'une prise de prod ou de cast.
  const holds = await lockedHolding(connection, candidates);
  const row = await lockPlacementMatch(connection, matchId);
  if (!row) return { skip: "MATCH_GONE" };
  if (row.status === "COMPLETED" || Number(row.is_bye) === 1 || row.launched_at !== null) return { skip: "MATCH_CLOSED" };
  const casters = await lockMatchCasters(connection, matchId);
  const currentProd = nullableId(row.prod_user_id);
  const held = await lockedHeldLines(connection, matchId);
  if (!castFreeForPlanning(casters.map((caster) => caster.userId), currentProd, held)) return { skip: "CAST_HELD" };
  const game = await tournamentGame(connection, Number(row.tournament_id));
  if (game === null) return { skip: "MATCH_GONE" };

  const onMatch = new Set(casters.map((caster) => caster.userId));
  // Encore tenue (ni retirée ni désistée depuis le geste), par un membre qui peut la tenir
  // (rôle, suspension, invité, tournoi caché — relus en partage ci-dessus).
  const fit = (userId: number, role: "CASTER" | "PROD") =>
    (role === "CASTER" ? held.casterIds : held.prodIds).has(userId) && holds(userId, entry, role) === null;

  // La prod : une au plus, seulement si le match n'en a pas ; jamais un caster du match ni un joueur.
  let prodId: number | null = null;
  if (currentProd === null) {
    for (const userId of [...prodIds].sort((a, b) => a - b)) {
      if (!fit(userId, "PROD") || onMatch.has(userId)) continue;
      if (await resolveTeamParty(connection, row, userId)) continue;
      prodId = userId;
      break;
    }
  }

  const pending = casterIds.filter(
    (userId) => !onMatch.has(userId) && fit(userId, "CASTER") && userId !== currentProd && userId !== prodId,
  );
  // La condition du cast (permission de diffusion, tag Discord certifié, Battle.net en Overwatch), en lecture courante.
  const blocks = await loadCastBlocks(connection, pending, game, true);
  const placedCasters: number[] = [];
  for (const userId of [...pending].sort((a, b) => a - b)) {
    if (blocks.get(userId) !== null) continue;
    if (await resolveTeamParty(connection, row, userId)) continue;
    placedCasters.push(userId);
  }
  if (prodId === null && placedCasters.length === 0) return { skip: "NONE_ELIGIBLE" };

  if (prodId !== null) {
    await connection.execute("UPDATE bg_matches SET prod_user_id = ? WHERE id = ? AND prod_user_id IS NULL", [prodId, matchId]);
  }
  if (placedCasters.length > 0) {
    const streamId = await placementStream(connection, matchId, casters.map((caster) => caster.streamId));
    for (const userId of placedCasters) {
      await connection.execute("INSERT INTO bg_match_casters (match_id, user_id, stream_id, ready_at) VALUES (?, ?, ?, NULL)", [
        matchId,
        userId,
        streamId,
      ]);
    }
  }
  return {
    placement: { matchId, casterIds: placedCasters, prodId },
    tournamentId: Number(row.tournament_id),
    pairing: { team1Id: nullableId(row.team1_id), team2Id: nullableId(row.team2_id) },
  };
}
