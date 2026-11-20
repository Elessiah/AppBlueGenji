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
 * changer ; qui joue le match ou en est caster n'en est pas la prod.
 * Ordre des verrous de la suppression de compte : la ligne du compte d'abord
 * (en partage), puis le match (`SELECT … FOR UPDATE`, sans jointure — MariaDB).
 *
 * Après le commit : une ligne au journal du staff (salon des casts), sans
 * personne nommée, et un avis (message privé, push `MATCH_PROD`) au compte que
 * le staff place ou retire — jamais à qui agit sur sa propre place.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { sendBotLog } from "@/lib/server/bot-integration";
import { trackAnnouncement } from "@/lib/server/coalescer";
import { withConnection } from "@/lib/server/database";
import { failureDiagnostic } from "@/lib/server/failure-reason";
import { loadNotificationRecipients, notifyUsers } from "@/lib/server/notify";
import { jsonRoleLiteral } from "@/lib/server/privacy-consent";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { lockedSuspendedUserIds, userSuspendedSql } from "@/lib/server/suspension-sql";
import { formatProdChangeLog, type ProdLogChange } from "@/lib/shared/bot-logs";
import type { BotLogCategory } from "@/lib/shared/bot-log-category";
import { discordQuoted } from "@/lib/shared/discord-text";
import { localizedSiteUrl } from "@/lib/shared/dm-language";
import type { Locale } from "@/lib/shared/locales";
import { prodNoticeHref, type ProdNoticeKind, type ProdNoticeMatch } from "@/lib/shared/match-prod";
import { nullableId } from "@/lib/shared/nullable-id";
import { rolesGranting } from "@/lib/shared/permissions";
import { matchProdPush, pushRoundLabel } from "@/lib/shared/push-messages";
import { actingUserId, type SessionActor } from "./cast-settings";
import type { CastPairing } from "./cast-notices";
import { retryOnDeadlock } from "./deadlock-retry";
import { resolveTeamParty } from "./match-launch";
import { loadMatchLogRow, matchLogSubject } from "./match-log-subject";
import { loadMatchPlayerIds } from "./match-players";
import { publishMatchUpdatedEvent } from "./notifications";
import { inTransaction } from "./transaction";

/**
 * Le compte tient-il la permission `prod` ? Rôles lus en base (jamais ceux
 * d'une session), constantes du code vérifiées par `jsonRoleLiteral`.
 */
export const PROD_ROLE_SQL = `(u.is_admin = 1${rolesGranting("prod")
  .map((role) => ` OR JSON_CONTAINS(u.platform_roles_json, ${jsonRoleLiteral(role)})`)
  .join("")})`;

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

/** Un changement de prod constaté sous verrou, annoncé après le commit. */
export type ProdChange = {
  matchId: number;
  log: ProdLogChange;
  /** Comptes à prévenir (placés ou retirés par un autre qu'eux). */
  notices: { userId: number; kind: ProdNoticeKind }[];
  /** Appariement lu sous verrou : un match réapparié depuis n'est pas nommé par ses nouveaux engagés. */
  pairing: CastPairing;
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

/** Qui joue le match ou en est caster n'en est pas la prod. */
async function assertProdFree(connection: PoolConnection, row: ProdMatchRow, userId: number): Promise<void> {
  if (await resolveTeamParty(connection, row, userId)) throw new Error("PROD_IS_PLAYER");
  const [casters] = await connection.execute<RowDataPacket[]>(
    `SELECT 1 FROM bg_match_casters WHERE match_id = ? AND user_id = ? LIMIT 1`,
    [row.id, userId],
  );
  if (casters.length > 0) throw new Error("PROD_IS_CASTER");
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
 * rien ne change. Une place tenue par un autre est refusée.
 *
 * @throws `PLAYER_VIEW_ACTIVE` | `NOT_PROD` | `MATCH_NOT_FOUND` | `MATCH_ALREADY_COMPLETED`
 *   | `MATCH_NOT_LAUNCHABLE` | `MATCH_PROD_TAKEN` | `PROD_IS_PLAYER` | `PROD_IS_CASTER`
 */
export async function claimMatchProd(matchId: number, actor: SessionActor): Promise<void> {
  const userId = actingUserId(actor, "prod");
  const result = await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      const account = await lockProdAccount(connection, userId);
      if (!account?.holdsProd) throw new Error("NOT_PROD");
      const row = await lockProdMatch(connection, matchId);
      const current = nullableId(row.prod_user_id);
      if (current === userId) return null;
      if (current !== null) throw new Error("MATCH_PROD_TAKEN");
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
 * des matchs à jouer sont rendues, dans la transaction du changement de rôles.
 * Un match joué garde sa prod : l'histoire ne se réécrit pas. Rend les matchs
 * libérés, à annoncer après le commit ({@link announceProdWithdrawals}).
 */
export async function withdrawLostProdPlaces(connection: PoolConnection, userId: number): Promise<ReleasedProdPlace[]> {
  const [rows] = await connection.execute<ProdMatchRow[]>(
    `SELECT id, tournament_id, status, is_bye, team1_id, team2_id, prod_user_id
       FROM bg_matches WHERE prod_user_id = ? AND status <> 'COMPLETED' FOR UPDATE`,
    [userId],
  );
  if (rows.length === 0) return [];
  await connection.execute(
    `UPDATE bg_matches SET prod_user_id = NULL WHERE prod_user_id = ? AND status <> 'COMPLETED'`,
    [userId],
  );
  return rows.map((row) => ({ matchId: Number(row.id), tournamentId: Number(row.tournament_id), pairing: pairingOf(row) }));
}

/** Après le commit d'un retrait de rôle : plateaux rafraîchis, une ligne par match, l'ancienne prod prévenue. */
export function announceProdWithdrawals(userId: number, released: readonly ReleasedProdPlace[]): void {
  for (const tournamentId of new Set(released.map((entry) => entry.tournamentId))) {
    publishMatchUpdatedEvent(tournamentId, { landingLive: true });
  }
  for (const entry of released) {
    announceProdChange({
      matchId: entry.matchId,
      log: "INELIGIBLE",
      notices: [{ userId, kind: "RELEASED" }],
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
    const [casterRows] = await connection.execute<(RowDataPacket & { user_id: number })[]>(
      `SELECT user_id FROM bg_match_casters WHERE match_id = ?`,
      [matchId],
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

/** Catégorie de la ligne : `staff-removal` (alerte) quand le match perd sa prod, `casts` sinon. */
export function prodLogCategory(change: ProdLogChange): BotLogCategory {
  return change === "RELEASED" || change === "RELEASED_BY_STAFF" || change === "INELIGIBLE" ? "staff-removal" : "casts";
}

const DM_TEXT: Readonly<Record<Locale, Readonly<Record<ProdNoticeKind, string>>>> = {
  fr: { ASSIGNED: "Le staff te place comme prod", RELEASED: "Le staff te retire la prod" },
  en: { ASSIGNED: "The staff made you the prod", RELEASED: "The staff removed you as the prod" },
};

function quotedName(value: string | null, locale: Locale): string {
  return value === null ? "TBD" : discordQuoted(value, locale);
}

/**
 * Le message privé Discord d'un avis de prod, dans la langue du compte. Aucun
 * pseudo de joueur : en tournoi individuel, « un match ».
 */
export function formatProdNotice(match: ProdNoticeMatch, url: string, locale: Locale = "fr"): string {
  const round = pushRoundLabel(match.bracket, match.roundNumber, locale, match.swiss);
  const tournament = quotedName(match.tournamentName, locale);
  const lead = DM_TEXT[locale][match.kind];
  if (locale === "en") {
    const subject = match.solo
      ? "of a match"
      : `of the match ${quotedName(match.team1Name, locale)} vs ${quotedName(match.team2Name, locale)}`;
    return `🎛️ BlueGenji — ${lead} ${subject} (${round}, ${tournament}). Match page: ${localizedSiteUrl(url, locale)}`;
  }
  const subject = match.solo
    ? "d'un match"
    : `du match ${quotedName(match.team1Name, locale)} contre ${quotedName(match.team2Name, locale)}`;
  return `🎛️ BlueGenji — ${lead} ${subject} (${round}, ${tournament}). Fiche du match : ${url}`;
}

/** Le journal, puis les avis. Peut lever : {@link announceProdChange} l'enveloppe. */
export async function deliverProdChange(change: ProdChange): Promise<void> {
  const row = await loadMatchLogRow(change.matchId);
  if (!row) return;
  const current =
    change.pairing.team1Id === nullableId(row.team1_id ?? null) &&
    change.pairing.team2Id === nullableId(row.team2_id ?? null);
  // Appariement changé depuis le geste : le match est désigné sans ses engagés.
  const named = current ? row : { ...row, team1_name: null, team2_name: null };
  const match = matchLogSubject(named);
  sendBotLog(formatProdChangeLog({ ...match, change: change.log }), {
    tournamentId: match.tournament.id,
    category: prodLogCategory(change.log),
  });
  for (const notice of change.notices) {
    // Message de match : l'interrupteur « messages privés de mes matchs » le
    // coupe, le push garde son sujet ; seul un tag Discord certifié le reçoit.
    const recipients = await loadNotificationRecipients([notice.userId], "certified", { matchDm: true });
    const subject: ProdNoticeMatch = {
      tournamentId: match.tournament.id,
      tournamentName: match.tournament.name,
      matchId: match.matchId,
      bracket: match.bracket,
      roundNumber: match.roundNumber,
      swiss: match.swiss,
      team1Name: named.team1_name,
      team2Name: named.team2_name,
      solo: match.participantType === "SOLO",
      kind: notice.kind,
    };
    const url = `${siteCanonicalBase()}${prodNoticeHref(subject)}`;
    await notifyUsers(recipients, {
      topic: "MATCH_PROD",
      discord: { message: (locale) => formatProdNotice(subject, url, locale), context: "match-prod" },
      push: (locale) => matchProdPush(subject, locale),
    });
  }
}

/** Annonce sans attendre ; attendue à l'arrêt du serveur. Ne lève jamais. */
export function announceProdChange(change: ProdChange): void {
  void trackAnnouncement(
    deliverProdChange(change).catch((error: unknown) =>
      console.error(`[prod] changement de prod non annoncé : ${failureDiagnostic(error)}`),
    ),
  );
}
