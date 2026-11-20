/**
 * La prod d'un match (`docs/features/MATCH_PROD.md`) : la production du direct,
 * une au plus par match (`bg_matches.prod_user_id`), distincte des casters.
 *
 * - **Se placer / se retirer** : permission `prod` (rôle PROD, administrateur ;
 *   un invité du planning la garde) — {@link claimMatchProd}, {@link releaseMatchProd}.
 * - **Placer, changer, retirer** la prod d'un autre : permission `tournaments`
 *   (staff) — {@link assignMatchProd}. Le compte placé doit tenir `prod`, lu en
 *   base, et n'être ni suspendu ni effacé.
 *
 * Mêmes refus que le cast : un match joué ou une exemption n'a pas de prod à
 * changer ; qui joue le match ou en est caster (inscrit, ou caster tenu au
 * planning) n'en est pas la prod. Une prod tenue au planning par un autre
 * compte réserve la place : se placer soi-même est refusé (`MATCH_PROD_TAKEN`).
 * Ordre des verrous de la suppression de compte : la ligne du compte d'abord
 * (en partage), puis le match (`SELECT … FOR UPDATE`, sans jointure — MariaDB).
 *
 * Après le commit : une ligne au journal du staff, sans personne nommée, et un
 * avis au compte que le staff place ou retire (`./prod-notices`).
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import { jsonRoleLiteral } from "@/lib/server/privacy-consent";
import { lockedSuspendedUserIds, userSuspendedSql } from "@/lib/server/suspension-sql";
import type { ProdLogChange } from "@/lib/shared/bot-logs";
import { nullableId } from "@/lib/shared/nullable-id";
import { rolesGranting } from "@/lib/shared/permissions";
import { actingUserId, type SessionActor } from "./cast-settings";
import type { CastPairing } from "./cast-notices";
import { retryOnDeadlock } from "./deadlock-retry";
import { resolveTeamParty } from "./match-launch";
import { loadMatchPlayerIds } from "./match-players";
import { publishMatchUpdatedEvent } from "./notifications";
import { announceProdChange, type ProdChange } from "./prod-notices";
import { inTransaction } from "./transaction";

export {
  announceProdChange,
  deliverProdChange,
  formatProdNotice,
  prodLogCategory,
  type ProdChange,
} from "./prod-notices";

/**
 * Le compte tient-il la permission `prod` ? Rôles lus en base (jamais ceux
 * d'une session), constantes du code vérifiées par `jsonRoleLiteral`.
 */
export const PROD_ROLE_SQL = `(u.is_admin = 1${rolesGranting("prod")
  .map((role) => ` OR JSON_CONTAINS(u.platform_roles_json, ${jsonRoleLiteral(role)})`)
  .join("")})`;

/** Ligne du planning **tenue** (choix du staff ou proposition confirmée), comme au décompte de l'équité. */
const HELD_PLANNING_ROW_SQL = `(source = 'MANUAL' OR confirmed = 1)`;

type ProdAccountRow = RowDataPacket & { is_deleted: number | null; holds_prod: number | null };

type ProdMatchRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  status: string;
  is_bye: number;
  team1_id: number | null;
  team2_id: number | null;
  prod_user_id: number | null;
};

/** Un match dont la place de prod vient d'être rendue. */
export type ReleasedProdPlace = { matchId: number; tournamentId: number; pairing: CastPairing };

/**
 * Ligne du compte lue en partage, **en première instruction** — l'ordre de la
 * suppression de compte (compte, puis matchs). `null` : compte absent ou effacé.
 */
async function lockProdAccount(connection: PoolConnection, userId: number): Promise<{ holdsProd: boolean } | null> {
  const [rows] = await connection.execute<ProdAccountRow[]>(
    `SELECT u.is_deleted, ${PROD_ROLE_SQL} AS holds_prod FROM bg_users u WHERE u.id = ? LIMIT 1 LOCK IN SHARE MODE`,
    [userId],
  );
  const row = rows[0];
  if (!row || Number(row.is_deleted ?? 0) === 1) return null;
  return { holdsProd: Number(row.holds_prod ?? 0) === 1 };
}

/** Le match verrouillé, seul (aucune jointure sous `FOR UPDATE` : MariaDB). */
async function lockProdMatch(connection: PoolConnection, matchId: number): Promise<ProdMatchRow> {
  const [rows] = await connection.execute<ProdMatchRow[]>(
    `SELECT id, tournament_id, status, is_bye, team1_id, team2_id, prod_user_id
       FROM bg_matches WHERE id = ? LIMIT 1 FOR UPDATE`,
    [matchId],
  );
  const row = rows[0];
  if (!row) throw new Error("MATCH_NOT_FOUND");
  if (row.status === "COMPLETED") throw new Error("MATCH_ALREADY_COMPLETED");
  if (Number(row.is_bye) === 1) throw new Error("MATCH_NOT_LAUNCHABLE");
  return row;
}

/**
 * Qui joue le match ou en est caster n'en est pas la prod : caster inscrit sur
 * le match, ou caster tenu au planning (une ligne CASTER confirmée ou posée par
 * le staff) — le planning ne montrerait sinon le même compte aux deux places.
 */
async function assertProdFree(connection: PoolConnection, row: ProdMatchRow, userId: number): Promise<void> {
  if (await resolveTeamParty(connection, row, userId)) throw new Error("PROD_IS_PLAYER");
  const [casters] = await connection.execute<RowDataPacket[]>(
    `SELECT 1 FROM bg_match_casters WHERE match_id = ? AND user_id = ?
     UNION ALL
     SELECT 1 FROM bg_planning_assignments
      WHERE match_id = ? AND user_id = ? AND role = 'CASTER' AND ${HELD_PLANNING_ROW_SQL}
     LIMIT 1`,
    [row.id, userId, row.id, userId],
  );
  if (casters.length > 0) throw new Error("PROD_IS_CASTER");
}

/** Une prod tenue au planning par un autre compte réserve la place du match. */
async function assertNoOtherPlannedProd(connection: PoolConnection, matchId: number, userId: number): Promise<void> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT 1 FROM bg_planning_assignments
      WHERE match_id = ? AND role = 'PROD' AND user_id <> ? AND ${HELD_PLANNING_ROW_SQL} LIMIT 1`,
    [matchId, userId],
  );
  if (rows.length > 0) throw new Error("MATCH_PROD_TAKEN");
}

function pairingOf(row: ProdMatchRow): CastPairing {
  return { team1Id: nullableId(row.team1_id), team2Id: nullableId(row.team2_id) };
}

async function writeProd(connection: PoolConnection, matchId: number, userId: number | null): Promise<void> {
  await connection.execute(`UPDATE bg_matches SET prod_user_id = ? WHERE id = ?`, [userId, matchId]);
}

/** Après le commit : le plateau se rafraîchit, puis l'annonce part sans attendre. */
function afterCommit(result: { tournamentId: number; change: ProdChange } | null): void {
  if (result === null) return;
  publishMatchUpdatedEvent(result.tournamentId, { landingLive: true });
  announceProdChange(result.change);
}

/**
 * « Faire la prod » : le lecteur se place comme prod du match. Déjà la sienne :
 * rien ne change. Une place tenue par un autre (sur le match, ou au planning)
 * est refusée ; un compte suspendu ne se place pas plus que le staff ne l'y place.
 *
 * @throws `PLAYER_VIEW_ACTIVE` | `NOT_PROD` | `PROD_SUSPENDED` | `MATCH_NOT_FOUND`
 *   | `MATCH_ALREADY_COMPLETED` | `MATCH_NOT_LAUNCHABLE` | `MATCH_PROD_TAKEN`
 *   | `PROD_IS_PLAYER` | `PROD_IS_CASTER`
 */
export async function claimMatchProd(matchId: number, actor: SessionActor): Promise<void> {
  const userId = actingUserId(actor, "prod");
  const result = await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      const account = await lockProdAccount(connection, userId);
      if (!account?.holdsProd) throw new Error("NOT_PROD");
      if ((await lockedSuspendedUserIds(connection, [userId])).has(userId)) throw new Error("PROD_SUSPENDED");
      const row = await lockProdMatch(connection, matchId);
      const current = nullableId(row.prod_user_id);
      if (current === userId) return null;
      if (current !== null) throw new Error("MATCH_PROD_TAKEN");
      await assertNoOtherPlannedProd(connection, matchId, userId);
      await assertProdFree(connection, row, userId);
      await writeProd(connection, matchId, userId);
      const change: ProdChange = { matchId, log: "CLAIMED", notices: [], pairing: pairingOf(row) };
      return { tournamentId: Number(row.tournament_id), change };
    }),
  );
  afterCommit(result);
}

/**
 * « Ne plus faire la prod » : la prod quitte sa place. Un match joué la garde.
 *
 * @throws `PLAYER_VIEW_ACTIVE` | `MATCH_NOT_FOUND` | `MATCH_ALREADY_COMPLETED`
 *   | `MATCH_NOT_LAUNCHABLE` | `NOT_MATCH_PROD`
 */
export async function releaseMatchProd(matchId: number, actor: SessionActor): Promise<void> {
  const userId = actingUserId(actor, "prod");
  const result = await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      const row = await lockProdMatch(connection, matchId);
      if (nullableId(row.prod_user_id) !== userId) throw new Error("NOT_MATCH_PROD");
      await writeProd(connection, matchId, null);
      const change: ProdChange = { matchId, log: "RELEASED", notices: [], pairing: pairingOf(row) };
      return { tournamentId: Number(row.tournament_id), change };
    }),
  );
  afterCommit(result);
}

/**
 * Le staff place la prod du match (`prodId`), la change, ou la retire (`null`).
 * `expected` : la prod que la fenêtre montrait (`null` : aucune) ; changée
 * depuis, rien ne bouge (`PROD_CHANGED`). `undefined` : pas de contrôle.
 *
 * @throws `MATCH_NOT_FOUND` | `MATCH_ALREADY_COMPLETED` | `MATCH_NOT_LAUNCHABLE`
 *   | `PROD_CHANGED` | `NOT_PROD` (compte sans la permission `prod`, absent ou effacé)
 *   | `PROD_UNAVAILABLE` (compte suspendu) | `PROD_IS_PLAYER` | `PROD_IS_CASTER`
 */
export async function assignMatchProd(
  matchId: number,
  staffUserId: number,
  prodId: number | null,
  expected?: number | null,
): Promise<void> {
  const result = await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      if (prodId !== null) await assertAssignableProd(connection, prodId);
      const row = await lockProdMatch(connection, matchId);
      const current = nullableId(row.prod_user_id);
      if (current === prodId) return null;
      if (expected !== undefined && expected !== current) throw new Error("PROD_CHANGED");
      if (prodId !== null) await assertProdFree(connection, row, prodId);
      await writeProd(connection, matchId, prodId);
      const change: ProdChange = {
        matchId,
        log: staffProdLog(current, prodId),
        notices: staffProdNotices(current, prodId, staffUserId),
        pairing: pairingOf(row),
      };
      return { tournamentId: Number(row.tournament_id), change };
    }),
  );
  afterCommit(result);
}

/** Compte à placer par le staff, lu en partage en première instruction : il tient `prod` et n'est pas suspendu. */
async function assertAssignableProd(connection: PoolConnection, prodId: number): Promise<void> {
  const account = await lockProdAccount(connection, prodId);
  if (!account?.holdsProd) throw new Error("NOT_PROD");
  if ((await lockedSuspendedUserIds(connection, [prodId])).has(prodId)) throw new Error("PROD_UNAVAILABLE");
}

/** Ligne du journal du staff pour un geste du staff sur la place de prod. */
function staffProdLog(current: number | null, prodId: number | null): ProdLogChange {
  if (prodId === null) return "RELEASED_BY_STAFF";
  return current === null ? "ASSIGNED" : "REPLACED";
}

/** Avis du geste du staff : l'ancienne prod retirée, la nouvelle placée — jamais le staff qui agit sur lui-même. */
function staffProdNotices(current: number | null, prodId: number | null, staffUserId: number): ProdChange["notices"] {
  const notices: ProdChange["notices"] = [];
  if (current !== null && current !== staffUserId) notices.push({ userId: current, kind: "RELEASED" });
  if (prodId !== null && prodId !== staffUserId) notices.push({ userId: prodId, kind: "ASSIGNED" });
  return notices;
}

/**
 * Le compte perd la permission `prod` (`setUserRoles`) : ses places de prod sur
 * des matchs **pas encore lancés** sont rendues, dans la transaction du
 * changement de rôles — comme un caster inéligible (`releaseIneligibleCast`).
 * Un match lancé ou joué garde sa prod : le direct n'est pas coupé en cours, et
 * l'histoire ne se réécrit pas. Rend les matchs libérés, à annoncer après le
 * commit ({@link announceProdWithdrawals}).
 */
export async function withdrawLostProdPlaces(connection: PoolConnection, userId: number): Promise<ReleasedProdPlace[]> {
  const [rows] = await connection.execute<ProdMatchRow[]>(
    `SELECT id, tournament_id, status, is_bye, team1_id, team2_id, prod_user_id
       FROM bg_matches WHERE prod_user_id = ? AND status <> 'COMPLETED' AND launched_at IS NULL FOR UPDATE`,
    [userId],
  );
  if (rows.length === 0) return [];
  await connection.execute(
    `UPDATE bg_matches SET prod_user_id = NULL
      WHERE prod_user_id = ? AND id IN (${rows.map(() => "?").join(", ")})`,
    [userId, ...rows.map((row) => Number(row.id))],
  );
  return rows.map((row) => ({ matchId: Number(row.id), tournamentId: Number(row.tournament_id), pairing: pairingOf(row) }));
}

/** Après le commit d'un retrait de rôle : plateaux rafraîchis, une ligne par match, l'ancienne prod prévenue du motif. */
export function announceProdWithdrawals(userId: number, released: readonly ReleasedProdPlace[]): void {
  for (const tournamentId of new Set(released.map((entry) => entry.tournamentId))) {
    publishMatchUpdatedEvent(tournamentId, { landingLive: true });
  }
  for (const entry of released) {
    announceProdChange({
      matchId: entry.matchId,
      log: "INELIGIBLE",
      notices: [{ userId, kind: "INELIGIBLE" }],
      pairing: entry.pairing,
    });
  }
}

/** Un compte de la fenêtre « Prod du match » ; `block` : pourquoi il ne peut pas être placé ici. */
export type ProdPanelUser = { userId: number; pseudo: string; block: "PROD_IS_PLAYER" | "PROD_IS_CASTER" | null };

/** Fenêtre « Prod du match » du staff : la prod actuelle et les comptes qui peuvent l'être. */
export type ProdPanel = { matchId: number; prod: { userId: number; pseudo: string } | null; candidates: ProdPanelUser[] };

type PanelRow = RowDataPacket & { id: number; team1_id: number | null; team2_id: number | null; prod_user_id: number | null };
type CandidateRow = RowDataPacket & { id: number; pseudo: string };

/** Pourquoi ce compte ne peut pas faire la prod de ce match : il le joue, ou il le caste. */
function panelBlock(userId: number, players: ReadonlySet<number>, casters: ReadonlySet<number>): ProdPanelUser["block"] {
  if (players.has(userId)) return "PROD_IS_PLAYER";
  return casters.has(userId) ? "PROD_IS_CASTER" : null;
}

/**
 * Lue à l'ouverture de la fenêtre (staff, permission `tournaments`) : les
 * comptes qui tiennent `prod` (rôle PROD, administrateurs), ni effacés ni
 * suspendus, par pseudo — rien d'autre d'eux. `null` : match absent.
 */
export async function loadProdPanel(matchId: number): Promise<ProdPanel | null> {
  return withConnection(async (connection) => {
    const [matches] = await connection.execute<PanelRow[]>(
      `SELECT id, team1_id, team2_id, prod_user_id FROM bg_matches WHERE id = ? LIMIT 1`,
      [matchId],
    );
    const match = matches[0];
    if (!match) return null;
    const [users] = await connection.execute<CandidateRow[]>(
      `SELECT u.id, u.pseudo FROM bg_users u
        WHERE u.is_deleted = 0 AND ${PROD_ROLE_SQL} AND NOT ${userSuspendedSql("u.id")}
        ORDER BY u.pseudo ASC, u.id ASC`,
    );
    // Casters inscrits, et casters tenus au planning : la même règle que `assertProdFree`.
    const [casterRows] = await connection.execute<(RowDataPacket & { user_id: number })[]>(
      `SELECT user_id FROM bg_match_casters WHERE match_id = ?
       UNION
       SELECT user_id FROM bg_planning_assignments
        WHERE match_id = ? AND role = 'CASTER' AND ${HELD_PLANNING_ROW_SQL}`,
      [matchId, matchId],
    );
    const players = await loadMatchPlayerIds(connection, {
      team1_id: nullableId(match.team1_id),
      team2_id: nullableId(match.team2_id),
    });
    const casters = new Set(casterRows.map((row) => Number(row.user_id)));
    const candidates = users.map((user): ProdPanelUser => {
      const userId = Number(user.id);
      return { userId, pseudo: String(user.pseudo), block: panelBlock(userId, players, casters) };
    });
    const prodId = nullableId(match.prod_user_id);
    let prod: ProdPanel["prod"] = null;
    if (prodId !== null) {
      const known = candidates.find((candidate) => candidate.userId === prodId);
      if (known) {
        prod = { userId: prodId, pseudo: known.pseudo };
      } else {
        const [rows] = await connection.execute<CandidateRow[]>(`SELECT id, pseudo FROM bg_users WHERE id = ? LIMIT 1`, [prodId]);
        prod = rows[0] ? { userId: prodId, pseudo: String(rows[0].pseudo) } : null;
      }
    }
    return { matchId, prod, candidates };
  });
}
