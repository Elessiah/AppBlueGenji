import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import {
  ACCOUNT_REACTIVATION_DAYS,
  type AccountDeletionPlan,
  accountDeletionPlan,
  ACTIVE_TOURNAMENT_STATES,
  ownedTeamFate,
  pickTeamSuccessor,
  reactivationDeadline,
  soloRegistrationsWithdrawnOnRequest,
  successorRoles,
  type TeamSuccessorCandidate,
} from "@/lib/shared/account-deletion";
import { parseRoles } from "@/lib/server/serialization";
import { rolesGranting } from "@/lib/shared/permissions";
import { jsonRoleLiteral } from "@/lib/server/privacy-consent";
import { formatAccountDeletionLog } from "@/lib/shared/bot-logs";
import { sendBotLog } from "@/lib/server/bot-integration";
import { closeUserStreams } from "@/lib/server/session-streams";
import { invalidateTeamIdentityViews } from "@/lib/server/ranking-cache";
import { invalidateLandingCounters } from "@/lib/server/landing-cache";
import { invalidateStats } from "@/lib/server/stats-cache";
import { deleteUnreferencedUpload } from "@/lib/server/stored-upload-cleanup";
import { publishMatchUpdatedEvent, publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { lockTournamentRow } from "@/lib/server/tournaments/registration";
import { withdrawUserCasts } from "@/lib/server/tournaments/match-casters";
import { lockMemberRoles, writeActiveMembership } from "@/lib/server/teams/access";
import { dissolveTeamOn } from "@/lib/server/teams/dissolution";
import { refreshTeamViewers, teamStreamTournamentIds } from "@/lib/server/teams/roster";
import { notifyTeamInviteInBackground } from "@/lib/server/team-invite-notifications";
import { recordAccountDeletion } from "@/lib/server/account-deletion-journal";
import { holdAccountIdentity } from "./account-deletion-hold";
import {
  listCastTournamentIds,
  listSoloRegistrationTournamentIds,
  loadAccountTrace,
  loadSoloRegistrations,
  mergeTournamentIds,
} from "./account-deletion";
import {
  type DeletionWithdrawal,
  forfeitSoloEntriesAfterCommit,
  listForfeitableSoloEntries,
  logDeletionWithdrawal,
  withdrawSoloRegistrationsOn,
} from "./deleted-solo-entries";

/*
 * Demande de suppression de son compte (décisions E1, E3, E4, E5 —
 * `docs/features/ACCOUNT_DELETION.md`).
 *
 * La demande **ne détruit rien** : le compte passe en attente
 * (`is_deleted = 1`, `deletion_requested_at` daté), invisible, sans session ni
 * notification, et l'effacement ou l'anonymisation tombe trente jours plus tard
 * (`finalizeDueAccountDeletions`). Se reconnecter dans la fenêtre le réactive.
 *
 * Ce qui touche les **autres** se fait en revanche tout de suite et n'est pas
 * défait par la réactivation : le compte quitte ses équipes (propriété
 * transmise, équipe fantôme ou dissoute), ses tournois organisés changent
 * d'organisateur, ses inscriptions solo à un tournoi pas encore commencé sont
 * retirées et ses matchs pas encore joués d'un tournoi en cours, s'il n'y a
 * jamais joué, perdus par forfait.
 */

/** Ce que la demande a fait, et quand la suppression deviendra définitive. */
export type AccountDeletionRequestOutcome = AccountDeletionPlan & {
  /** Fin de la fenêtre de réactivation (ISO). */
  finalAt: string;
};

/** Le sort d'une équipe que le compte quittait. */
type TeamDeparture = {
  teamId: number;
  fate: "LEFT" | "TRANSFER" | "GHOST" | "DISSOLVE";
  successorId: number | null;
  logoUrl: string | null;
  everRegistered: boolean;
  detachedUserIds: number[];
  streamTournamentIds: ReadonlySet<number>;
};

/** Les équipes réelles (ni entrée solo, ni dissoute) dont le compte est membre, par id croissant. */
async function listActiveTeamIds(connection: Pick<PoolConnection, "execute">, userId: number): Promise<number[]> {
  const [rows] = await connection.execute<(RowDataPacket & { team_id: number })[]>(
    `SELECT tm.team_id
       FROM bg_team_members tm
       JOIN bg_teams t ON t.id = tm.team_id
      WHERE tm.user_id = ?
        AND tm.left_at IS NULL
        AND t.solo_user_id IS NULL
        AND t.deleted_at IS NULL
      ORDER BY tm.team_id`,
    [userId],
  );
  return rows.map((row) => Number(row.team_id));
}

/** Les autres membres en cours, comptes vivants seulement : les héritiers possibles. */
async function loadSuccessorCandidates(
  connection: Pick<PoolConnection, "execute">,
  teamId: number,
  userId: number,
): Promise<TeamSuccessorCandidate[]> {
  // Les lignes d'appartenance seules sont verrouillées : joindre `bg_users` en
  // `FOR UPDATE` verrouillerait aussi le compte de chaque autre membre, alors
  // qu'une demande simultanée de l'un d'eux tient son compte puis attend
  // l'équipe que celle-ci tient déjà (interblocage). Les comptes vivants se
  // lisent à part, sans verrou.
  const [rows] = await connection.execute<(RowDataPacket & {
    id: number;
    user_id: number;
    roles_json: string;
    joined_at: Date | string;
  })[]>(
    `SELECT tm.id, tm.user_id, tm.roles_json, tm.joined_at
       FROM bg_team_members tm
      WHERE tm.team_id = ?
        AND tm.user_id <> ?
        AND tm.left_at IS NULL
      ORDER BY tm.id
      FOR UPDATE`,
    [teamId, userId],
  );
  if (rows.length === 0) return [];
  const ids = rows.map((row) => Number(row.user_id));
  const [alive] = await connection.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users WHERE is_deleted = 0 AND id IN (${ids.map(() => "?").join(", ")})`,
    ids,
  );
  const living = new Set(alive.map((row) => Number(row.id)));
  return rows
    .filter((row) => living.has(Number(row.user_id)))
    .map((row) => ({
      userId: Number(row.user_id),
      roles: parseRoles(row.roles_json),
      joinedAt: row.joined_at,
      membershipId: Number(row.id),
    }));
}

/** L'équipe est inscrite à un tournoi qui n'est pas terminé. */
async function registeredInActiveTournament(
  connection: Pick<PoolConnection, "execute">,
  teamId: number,
): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT 1
       FROM bg_tournament_registrations r
       JOIN bg_tournaments t ON t.id = r.tournament_id
      WHERE r.team_id = ?
        AND t.state IN (${ACTIVE_TOURNAMENT_STATES.map(() => "?").join(", ")})
      LIMIT 1`,
    [teamId, ...ACTIVE_TOURNAMENT_STATES],
  );
  return rows.length > 0;
}

/**
 * Le compte quitte une équipe (E3), sur la transaction de la demande, qui tient
 * déjà la ligne du compte. Propriétaire : la propriété passe au gérant, sinon
 * au capitaine, sinon au plus ancien membre ; seul joueur, l'équipe devient
 * fantôme si elle est engagée dans un tournoi actif, sinon elle est dissoute
 * (`dissolveTeamOn` : ligne et historique gardés sous « Équipe dissoute #id »).
 */
async function leaveTeamOn(connection: PoolConnection, teamId: number, userId: number): Promise<TeamDeparture> {
  const [teamRows] = await connection.execute<(RowDataPacket & { logo_url: string | null; deleted_at: Date | null })[]>(
    `SELECT logo_url, deleted_at FROM bg_teams WHERE id = ? FOR UPDATE`,
    [teamId],
  );
  const departure: TeamDeparture = {
    teamId,
    fate: "LEFT",
    successorId: null,
    logoUrl: null,
    everRegistered: false,
    detachedUserIds: [],
    streamTournamentIds: new Set(),
  };
  const roles = await lockMemberRoles(connection, teamId, userId);
  if (!roles || teamRows.length === 0 || teamRows[0].deleted_at !== null) return departure;

  if (roles.includes("OWNER")) {
    const successor = pickTeamSuccessor(await loadSuccessorCandidates(connection, teamId, userId));
    const fate = ownedTeamFate({
      hasSuccessor: successor !== null,
      registeredInActiveTournament: successor === null && (await registeredInActiveTournament(connection, teamId)),
    });
    departure.fate = fate;
    if (fate === "TRANSFER" && successor) {
      await writeActiveMembership(
        connection,
        "roles_json = ?",
        [JSON.stringify(successorRoles(successor.roles))],
        teamId,
        successor.userId,
      );
      departure.successorId = successor.userId;
    } else if (fate === "GHOST") {
      // Fantôme (`GHOST_TEAMS.md`) : le staff la conduit, la propose à un joueur
      // qui la reprend. Les invitations en attente ne viennent plus de personne.
      await connection.execute(`UPDATE bg_teams SET is_ghost = 1 WHERE id = ?`, [teamId]);
      await connection.execute(
        `UPDATE bg_team_invitations SET status = 'CANCELLED', responded_at = NOW()
          WHERE team_id = ? AND status = 'PENDING'`,
        [teamId],
      );
    }
  }

  if (departure.fate === "DISSOLVE") {
    departure.logoUrl = teamRows[0].logo_url ?? null;
    const dissolved = await dissolveTeamOn(connection, teamId);
    departure.everRegistered = dissolved.everRegistered;
    departure.detachedUserIds = dissolved.detachedUserIds;
  } else {
    await writeActiveMembership(connection, "left_at = NOW()", [], teamId, userId);
    departure.detachedUserIds = [userId];
  }
  departure.streamTournamentIds = await teamStreamTournamentIds(connection, teamId);
  return departure;
}

/** Le compte vivant le plus ancien, autre que `userId`, qui tient la permission `tournaments` (rôle, sinon administrateur). */
async function findOrganizerSuccessor(
  connection: Pick<PoolConnection, "execute">,
  userId: number,
): Promise<number | null> {
  const byRole = rolesGranting("tournaments")
    .map((role) => `JSON_CONTAINS(u.platform_roles_json, ${jsonRoleLiteral(role)})`)
    .join(" OR ");
  const roleSql = byRole.length > 0 ? `(${byRole})` : "FALSE";
  const [rows] = await connection.execute<(RowDataPacket & { id: number })[]>(
    `SELECT u.id
       FROM bg_users u
      WHERE u.is_deleted = 0
        AND u.id <> ?
        AND (u.is_admin = 1 OR ${roleSql})
      ORDER BY (${roleSql}) DESC, u.created_at, u.id
      LIMIT 1`,
    [userId],
  );
  return rows.length > 0 ? Number(rows[0].id) : null;
}

/** Les tournois organisés par le compte, par id croissant : la demande les verrouille avant de les céder. */
async function listOrganizedTournamentIds(
  connection: Pick<PoolConnection, "execute">,
  userId: number,
): Promise<number[]> {
  const [rows] = await connection.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_tournaments WHERE organizer_user_id = ? ORDER BY id`,
    [userId],
  );
  return rows.map((row) => Number(row.id));
}

/** Les tournois organisés par le compte passent à un autre membre du staff ; rend les tournois touchés. */
async function handOverOrganizedTournaments(
  connection: Pick<PoolConnection, "execute">,
  userId: number,
): Promise<number[]> {
  const organized = await listOrganizedTournamentIds(connection, userId);
  if (organized.length === 0) return [];
  const successor = await findOrganizerSuccessor(connection, userId);
  // Personne à qui les confier : rien ne change (décision requise), et le
  // compte sera anonymisé et non effacé, l'organisateur le retenant.
  if (successor === null) return [];
  await connection.execute(`UPDATE bg_tournaments SET organizer_user_id = ? WHERE organizer_user_id = ?`, [
    successor,
    userId,
  ]);
  return organized;
}

/**
 * Ce que la demande **ferait** (route de prévisualisation), sans rien écrire :
 * le compte aura quitté ses équipes, ses tournois auront changé d'organisateur
 * si un autre membre du staff peut les reprendre, et ses inscriptions solo à un
 * tournoi pas encore commencé seront retirées. Pas une promesse — la demande
 * repose la question sous verrou.
 */
export async function getAccountDeletionRequestPlan(userId: number): Promise<AccountDeletionPlan> {
  const db = await getDatabase();
  const trace = await loadAccountTrace(db, userId);
  const registrations = trace.soloRegistrations ? await loadSoloRegistrations(db, userId) : [];
  const withdrawn = soloRegistrationsWithdrawnOnRequest(
    registrations,
    new Set(registrations.map((registration) => registration.tournamentId)),
  );
  const organized = trace.organizedTournaments && (await findOrganizerSuccessor(db, userId)) === null;
  return accountDeletionPlan({
    ...trace,
    soloRegistrations: registrations.length > withdrawn.length,
    organizedTournaments: organized,
    ownedTeams: false,
  });
}

/** Ce que la demande a changé, à diffuser une fois la transaction validée. */
type DeletionRequestEffects = {
  withdrawn: DeletionWithdrawal[];
  forfeitable: DeletionWithdrawal[];
  departures: TeamDeparture[];
  organizedHandedOver: number[];
  castTournaments: number[];
};

/** Rafraîchit les lecteurs, notifie le successeur, journalise et joue les forfaits. */
async function afterDeletionRequest(userId: number, effects: DeletionRequestEffects): Promise<void> {
  const { withdrawn, forfeitable, departures, organizedHandedOver, castTournaments } = effects;
  closeUserStreams(userId);
  for (const tournamentId of new Set([...withdrawn.map((entry) => entry.tournamentId), ...organizedHandedOver])) {
    publishUpdatedEvent(tournamentId);
  }
  for (const tournamentId of castTournaments) publishMatchUpdatedEvent(tournamentId, { landingLive: true });
  for (const departure of departures) await settleDeparture(userId, departure);
  // Le compte est anonyme dès la demande : classements, accueil, statistiques
  // et liste des comptes sans fiche gardaient son vrai pseudo en cache.
  invalidateTeamIdentityViews();
  invalidateStats();

  // Journal Discord : la demande (sans pseudo), puis chaque retrait (E5).
  try {
    sendBotLog(formatAccountDeletionLog({ days: ACCOUNT_REACTIVATION_DAYS }), { category: "signups" });
  } catch (error) {
    console.error("[account-deletion] alerte de suppression non écrite", error);
  }
  for (const entry of withdrawn) await logDeletionWithdrawal(entry.tournamentId, false);
  await forfeitSoloEntriesAfterCommit(forfeitable);
}

/** Les suites d'un départ d'équipe ; rend `true` si l'identité publiée d'une équipe a changé. */
async function settleDeparture(userId: number, departure: TeamDeparture): Promise<boolean> {
  refreshTeamViewers(departure.teamId, departure.detachedUserIds, departure.streamTournamentIds);
  if (departure.successorId !== null) {
    notifyTeamInviteInBackground("OWNERSHIP", departure.teamId, departure.successorId, userId);
  }
  if (departure.fate !== "DISSOLVE") return false;
  if (!departure.everRegistered) invalidateLandingCounters();
  await deleteUnreferencedUpload(departure.logoUrl, "teams").catch(() => {});
  return departure.everRegistered;
}

/**
 * Demande la suppression du compte : tout ce qui touche les autres se fait
 * tout de suite, le compte passe en attente trente jours.
 *
 * Une transaction : tournois verrouillés d'abord (id croissant,
 * `lockTournamentRow`) — ceux de l'entrée solo, ceux qu'il organise (cédés) et
 * ceux dont un match le nomme (casts, arbitrage : leurs matchs se verrouillent
 * dans la transaction) —, puis le compte, puis chaque équipe : l'ordre de
 * l'inscription en tournoi individuel et du transfert de propriété.
 */
export async function requestAccountDeletion(
  userId: number,
  options: { requestedAt?: Date } = {},
): Promise<AccountDeletionRequestOutcome> {
  const db = await getDatabase();
  const soloTournaments = mergeTournamentIds(
    await listSoloRegistrationTournamentIds(db, userId),
    await listOrganizedTournamentIds(db, userId),
    await listCastTournamentIds(db, userId),
  );
  const connection = await db.getConnection();
  let plan: AccountDeletionPlan;
  let withdrawn: DeletionWithdrawal[] = [];
  let forfeitable: DeletionWithdrawal[] = [];
  const departures: TeamDeparture[] = [];
  let organizedHandedOver: number[] = [];
  let castTournaments: number[] = [];
  // Le rejeu d'une demande après restauration (`account-deletion-replay.ts`)
  // garde la date d'origine : la fenêtre de trente jours ne repart pas à zéro.
  const requestedAt = options.requestedAt ?? new Date();
  let accountCreatedAt = "";
  try {
    await connection.beginTransaction();
    for (const tournamentId of soloTournaments) await lockTournamentRow(connection, tournamentId);
    const [locked] = await connection.execute<(RowDataPacket & { is_deleted: 0 | 1; created_at: string })[]>(
      `SELECT is_deleted, created_at FROM bg_users WHERE id = ? FOR UPDATE`,
      [userId],
    );
    if (locked.length === 0 || Number(locked[0].is_deleted) === 1) throw new Error("USER_NOT_FOUND");
    accountCreatedAt = String(locked[0].created_at);

    withdrawn = await withdrawSoloRegistrationsOn(
      connection,
      await loadSoloRegistrations(connection, userId),
      new Set(soloTournaments),
    );
    forfeitable = await listForfeitableSoloEntries(connection, userId);

    for (const teamId of await listActiveTeamIds(connection, userId)) {
      departures.push(await leaveTeamOn(connection, teamId, userId));
    }
    organizedHandedOver = await handOverOrganizedTournaments(connection, userId);
    // Il ne castera ni n'arbitrera plus rien à venir ; les matchs joués gardent
    // leur cast jusqu'à la suppression définitive.
    castTournaments = (await withdrawUserCasts(connection, userId, false)).tournamentIds;
    // Ses invitations en attente ne seront acceptées par personne.
    await connection.execute(
      `UPDATE bg_team_invitations SET status = 'CANCELLED', responded_at = NOW()
        WHERE user_id = ? AND status = 'PENDING'`,
      [userId],
    );
    // Anonyme dès la demande (décision du 2026-11-04) : pseudo d'emprunt et
    // avatar retiré posés avec le drapeau, le vrai pseudo mis de côté pour la
    // réactivation (`account-deletion-hold.ts`).
    if (!(await holdAccountIdentity(connection, userId, requestedAt))) throw new Error("USER_NOT_FOUND");
    // Le pseudo relevé sur ses signalements est montré à la modération quand
    // le compte n'est plus vivant : il part dès la demande (la cible reste).
    await connection.execute(
      `UPDATE bg_report_targets SET label_snapshot = NULL WHERE target_type = 'USER' AND target_id = ?`,
      [userId],
    );
    await connection.execute(`DELETE FROM bg_user_sessions WHERE user_id = ?`, [userId]);
    plan = accountDeletionPlan(await loadAccountTrace(connection, userId));
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }

  // Demande consignée « en attente » au journal hors base (décision 8 du
  // 2026-11-04) : une restauration d'une sauvegarde antérieure la rejoue. La
  // réactivation la retire ; la suppression définitive écrit la sienne.
  await recordAccountDeletion({ userId, accountCreatedAt, deletedAt: requestedAt.toISOString(), pending: true });
  await afterDeletionRequest(userId, { withdrawn, forfeitable, departures, organizedHandedOver, castTournaments });

  return { ...plan, finalAt: reactivationDeadline(requestedAt).toISOString() };
}
