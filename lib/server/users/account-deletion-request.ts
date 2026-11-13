import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import {
  ACCOUNT_DELETION_PLAN_CHANGED,
  ACCOUNT_REACTIVATION_DAYS,
  type AccountDeletionPlan,
  type AccountRetentionReason,
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
import {
  formatAccountDeletionFollowUpLogs,
  formatAccountDeletionLog,
  type DeletedAccountLiveAnnouncements,
} from "@/lib/shared/bot-logs";
import { listLiveAnnouncementsForDeletionLog } from "@/lib/server/users/live-announcement-export";
import { sendBotLog } from "@/lib/server/bot-integration";
import { closeUserStreams } from "@/lib/server/session-streams";
import { invalidateTeamIdentityViews } from "@/lib/server/ranking-cache";
import { invalidateLandingCounters } from "@/lib/server/landing-cache";
import { invalidateStats } from "@/lib/server/stats-cache";
import { deleteUnreferencedUpload } from "@/lib/server/stored-upload-cleanup";
import { rotateHeldAvatarFile } from "@/lib/server/avatar-rotation";
import { publishMatchUpdatedEvent, publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { discardBotLogs, flushBotLogs } from "@/lib/server/tournaments/bot-logs";
import { retryOnDeadlock } from "@/lib/server/tournaments/deadlock-retry";
import { relaunchAfterRefereeWithdrawal } from "@/lib/server/tournaments/match-launch";
import { lockTournamentRow } from "@/lib/server/tournaments/registration";
import { activeSuspensionSql } from "@/lib/server/suspension-sql";
import { withdrawUserCasts } from "@/lib/server/tournaments/match-casters";
import { cancelPendingTeamInvitations, lockMemberRoles, writeActiveMembership } from "@/lib/server/teams/access";
import { dissolveTeamOn } from "@/lib/server/teams/dissolution";
import { refreshTeamViewers, teamViewerScope } from "@/lib/server/teams/roster";
import { notifyTeamInviteInBackground } from "@/lib/server/team-invite-notifications";
import { recordAccountDeletion } from "@/lib/server/account-deletion-journal";
import { holdAccountIdentity } from "./account-deletion-hold";
import {
  assertSoloLockSetFresh,
  listCastTournamentIds,
  listNamingTournamentIds,
  listSoloRegistrationTournamentIds,
  loadAccountTrace,
  loadSoloRegistrations,
  mergeTournamentIds,
  retryOnStaleLockSet,
} from "./account-deletion";
import {
  type DeletionWithdrawal,
  forfeitSoloEntriesAfterCommit,
  listForfeitableSoloEntries,
  logDeletionWithdrawal,
  syncOpenSoloTournamentsOn,
  withdrawSoloRegistrationsOn,
} from "./deleted-solo-entries";
import { failureReason } from "@/lib/server/failure-reason";

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
  /** Comptes dont les flux de tournoi se reconnectent : ceux qui partent et les membres qui restent. */
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
  const [alive] = await connection.execute<(RowDataPacket & { id: number; suspended: number | string })[]>(
    `SELECT u.id,
            EXISTS (
              SELECT 1 FROM bg_account_suspensions s
               WHERE s.user_id = u.id AND ${activeSuspensionSql("s")}
            ) AS suspended
       FROM bg_users u
      WHERE u.is_deleted = 0 AND u.id IN (${ids.map(() => "?").join(", ")})`,
    ids,
  );
  const living = new Map(alive.map((row) => [Number(row.id), Number(row.suspended) === 1]));
  return rows
    .filter((row) => living.has(Number(row.user_id)))
    .map((row) => ({
      userId: Number(row.user_id),
      roles: parseRoles(row.roles_json),
      joinedAt: row.joined_at,
      membershipId: Number(row.id),
      suspended: living.get(Number(row.user_id)) === true,
    }));
}

/** L'équipe est inscrite à un tournoi qui n'est pas terminé. */
async function registeredInActiveTournament(
  connection: Pick<PoolConnection, "execute">,
  teamId: number,
): Promise<boolean> {
  // Lecture verrouillante, table seule (MariaDB) : sous `REPEATABLE READ`, une
  // lecture simple rendrait l'instantané d'avant l'attente du verrou de
  // l'équipe, sans l'inscription qu'un gérant vient de valider — et l'équipe
  // inscrite serait dissoute au lieu de devenir fantôme.
  const [registrations] = await connection.execute<(RowDataPacket & { tournament_id: number })[]>(
    `SELECT tournament_id FROM bg_tournament_registrations WHERE team_id = ? LOCK IN SHARE MODE`,
    [teamId],
  );
  if (registrations.length === 0) return false;
  const ids = registrations.map((row) => Number(row.tournament_id));
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT 1 FROM bg_tournaments
      WHERE id IN (${ids.map(() => "?").join(", ")})
        AND state IN (${ACTIVE_TOURNAMENT_STATES.map(() => "?").join(", ")})
      LIMIT 1`,
    [...ids, ...ACTIVE_TOURNAMENT_STATES],
  );
  return rows.length > 0;
}

/**
 * Le compte quitte une équipe (E3), sur la transaction de la demande, qui tient
 * déjà la ligne du compte. Propriétaire : la propriété passe au gérant, sinon
 * au capitaine, sinon au plus ancien membre ; seul joueur, l'équipe devient
 * fantôme si elle est engagée dans un tournoi actif, sinon elle est dissoute
 * (`dissolveTeamOn` : ligne et historique gardés sous « Équipe dissoute #id »).
 * La règle du seul joueur vaut **quel que soit son rôle** : le dernier membre
 * vivant d'une équipe dont le propriétaire est déjà anonymisé ne laisse pas
 * derrière lui une équipe ordinaire sans personne pour la conduire.
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

  const isOwner = roles.includes("OWNER");
  const candidates = await loadSuccessorCandidates(connection, teamId, userId);
  if (isOwner || candidates.length === 0) {
    const successor = isOwner ? pickTeamSuccessor(candidates) : null;
    const fate = ownedTeamFate({
      hasSuccessor: successor !== null,
      registeredInActiveTournament: successor === null && (await registeredInActiveTournament(connection, teamId)),
    });
    departure.fate = fate;
    // Un copropriétaire déjà `OWNER` ne reçoit rien : ni écriture, ni avis
    // « propriété transférée » (`successorId` reste nul).
    if (fate === "TRANSFER" && successor && !successor.roles.includes("OWNER")) {
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
      await cancelPendingTeamInvitations(connection, teamId);
      // Une équipe fantôme n'a aucun membre (`GHOST_TEAMS.md`). Faute de
      // candidat vivant, les appartenances encore ouvertes sont celles de
      // comptes déjà supprimés (lignes d'avant le départ à la demande) : elles
      // se ferment, sinon l'équipe reprise garderait un propriétaire supprimé.
      await connection.execute(
        `UPDATE bg_team_members SET left_at = NOW() WHERE team_id = ? AND user_id <> ? AND left_at IS NULL`,
        [teamId, userId],
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
  // Le compte qui part (ou les membres détachés) et les membres qui restent :
  // leur invitation à certifier se juge sur la composition de l'équipe.
  const scope = await teamViewerScope(connection, teamId, departure.detachedUserIds);
  departure.detachedUserIds = scope.userIds;
  departure.streamTournamentIds = scope.tournamentIds;
  return departure;
}

/**
 * Le compte vivant le plus ancien, autre que `userId`, qui tient la permission
 * `tournaments` (rôle, sinon administrateur). Un compte suspendu ne se connecte
 * pas : il ne reprend rien.
 *
 * `onlyId` : relit ce seul candidat (clé primaire), sous les verrous de la
 * demande — le balayage complet de `bg_users` se fait avant eux.
 */
async function findOrganizerSuccessor(
  connection: Pick<PoolConnection, "execute">,
  userId: number,
  onlyId?: number,
): Promise<number | null> {
  const byRole = rolesGranting("tournaments")
    .map((role) => `JSON_CONTAINS(u.platform_roles_json, ${jsonRoleLiteral(role)})`)
    .join(" OR ");
  const roleSql = byRole.length > 0 ? `(${byRole})` : "FALSE";
  const [rows] = await connection.execute<(RowDataPacket & { id: number })[]>(
    `SELECT u.id
       FROM bg_users u
      WHERE u.is_deleted = 0
        AND u.id <> ?${onlyId === undefined ? "" : " AND u.id = ?"}
        AND (u.is_admin = 1 OR ${roleSql})
        AND NOT EXISTS (
          SELECT 1 FROM bg_account_suspensions s
           WHERE s.user_id = u.id AND ${activeSuspensionSql("s")}
        )
      ORDER BY (${roleSql}) DESC, u.created_at, u.id
      LIMIT 1`,
    onlyId === undefined ? [userId] : [userId, onlyId],
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

/**
 * Les tournois organisés par le compte passent à un autre membre du staff ;
 * rend les tournois touchés. Seuls ceux déjà verrouillés (`lockedIds`, lus
 * avant la transaction) changent de main : un tournoi confié entre-temps reste
 * à l'organisateur, plutôt que d'être écrit sans son verrou.
 * `successorHint`, trouvé avant les verrous, n'est que relu par sa clé : le
 * balayage ne se rejoue ici que s'il ne convient plus (supprimé, suspendu,
 * rôle retiré entre-temps).
 */
async function handOverOrganizedTournaments(
  connection: Pick<PoolConnection, "execute">,
  userId: number,
  lockedIds: ReadonlySet<number>,
  successorHint: number | null,
): Promise<number[]> {
  const organized = (await listOrganizedTournamentIds(connection, userId)).filter((id) => lockedIds.has(id));
  if (organized.length === 0) return [];
  // Aucun candidat avant les verrous : le balayage complet ne se rejoue pas
  // sous eux (décision requise). Un candidat périmé seul déclenche un nouveau balayage.
  if (successorHint === null) return [];
  const successor =
    (await findOrganizerSuccessor(connection, userId, successorHint)) ?? (await findOrganizerSuccessor(connection, userId));
  // Personne à qui les confier : rien ne change (décision requise), et le
  // compte sera anonymisé et non effacé, l'organisateur le retenant.
  if (successor === null) return [];
  await connection.execute(
    `UPDATE bg_tournaments SET organizer_user_id = ?
      WHERE organizer_user_id = ? AND id IN (${organized.map(() => "?").join(", ")})`,
    [successor, userId, ...organized],
  );
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
  /** Parmi eux, ceux dont un match touché n'est pas terminé (accueil, #live). */
  liveCastTournaments: number[];
  /**
   * Rejeu d'une demande après restauration (`account-deletion-replay.ts`) :
   * la demande a déjà été annoncée — ni alerte Discord, ni ligne de retrait,
   * ni avis de propriété ne repartent ; les lecteurs et les caches, eux, sont
   * rafraîchis, et les forfaits attendus (le script ferme son pool en sortant).
   */
  replay: boolean;
  /** Tous les tournois de l'entrée solo : son nom d'engagé vient de passer au pseudo d'emprunt. */
  soloTournaments: number[];
};

/**
 * Annonces #live du compte pour la ligne de suppression du journal (D56b) ;
 * `null` si elles n'ont pas pu être relues — la ligne le dit alors au staff
 * plutôt que de se taire. Ne lève jamais.
 */
async function deletionLogLiveAnnouncements(userId: number): Promise<DeletedAccountLiveAnnouncements | null> {
  try {
    return await listLiveAnnouncementsForDeletionLog(userId);
  } catch (error) {
    console.error("[account-deletion] annonces #live du compte non relues", failureReason(error));
    return null;
  }
}

/** `listNamingTournamentIds`, au meilleur effort : un relevé en échec ne rediffuse rien de plus. */
async function namingTournamentsOrNone(userId: number): Promise<number[]> {
  try {
    return await listNamingTournamentIds(await getDatabase(), userId);
  } catch (error) {
    console.error("[account-deletion] tournois qui nomment le compte non relevés", failureReason(error));
    return [];
  }
}

/** Rafraîchit les lecteurs, notifie le successeur, journalise et joue les forfaits. */
async function afterDeletionRequest(userId: number, effects: DeletionRequestEffects): Promise<void> {
  const { withdrawn, forfeitable, departures, organizedHandedOver, castTournaments, soloTournaments, replay } = effects;
  const liveCast = new Set(effects.liveCastTournaments);
  closeUserStreams(userId);
  // L'avatar mis de côté change d'adresse : l'ancienne, connue de qui l'avait
  // vue, ne doit plus rien servir pendant les trente jours. En premier, avant
  // toute suite plus longue ; un échec est dit, la demande est faite. La purge
  // du cache de l'optimiseur suit en tâche de fond (elle ne retient ni la
  // réponse ni les rafraîchissements ci-dessous) — attendue au rejeu, dont le
  // script sort dès son rapport.
  try {
    await rotateHeldAvatarFile(userId, { detachPurge: !replay });
  } catch (error) {
    // Le code seul : le message d'une erreur de fichier porte son chemin
    // (`<id du compte>-<aléa>.webp`), qui lierait la demande à un compte.
    console.error(
      "[account-deletion] avatar mis de côté non renommé, encore servi à son ancienne adresse",
      (error as NodeJS.ErrnoException)?.code ?? "erreur sans code",
    );
  }
  // L'entrée solo restée inscrite (jouée, tournoi en cours ou terminé) porte
  // désormais le pseudo d'emprunt : ses lecteurs gardaient le vrai. De même
  // tout tournoi pas terminé qui le nomme encore — effectif d'une équipe
  // engagée, cast ou arbitrage d'un match joué (`listNamingTournamentIds`).
  for (const tournamentId of new Set([
    ...withdrawn.map((entry) => entry.tournamentId),
    ...organizedHandedOver,
    ...soloTournaments,
    ...(await namingTournamentsOrNone(userId)),
  ])) {
    publishUpdatedEvent(tournamentId);
  }
  // L'accueil et #live ne bougent que pour un match touché pas encore terminé.
  for (const tournamentId of castTournaments) {
    publishMatchUpdatedEvent(tournamentId, { landingLive: liveCast.has(tournamentId) });
  }
  for (const departure of departures) await settleDeparture(userId, departure, replay);
  // Le compte est anonyme dès la demande : classements, accueil, statistiques
  // et liste des comptes sans fiche gardaient son vrai pseudo en cache.
  invalidateTeamIdentityViews();
  invalidateStats();

  if (replay) {
    await forfeitSoloEntriesAfterCommit(forfeitable, { silent: true });
    return;
  }
  // Journal Discord : la demande (sans pseudo), puis chaque retrait (E5). La
  // ligne dit aussi aux modérateurs quelles alertes AutoMod supprimer à la main
  // (D56b) : chaque soirée #live du compte (tournoi, jour, heure), jamais un pseudo —
  // au-delà de celles que la ligne cite, des lignes de suite citent les autres.
  try {
    const liveAnnouncements = await deletionLogLiveAnnouncements(userId);
    sendBotLog(formatAccountDeletionLog({ days: ACCOUNT_REACTIVATION_DAYS, liveAnnouncements }), {
      category: "signups",
    });
    for (const line of formatAccountDeletionFollowUpLogs(liveAnnouncements)) sendBotLog(line, { category: "signups" });
  } catch (error) {
    console.error("[account-deletion] alerte de suppression non écrite", failureReason(error));
  }
  for (const entry of withdrawn) await logDeletionWithdrawal(entry.tournamentId, false);
  // Les forfaits (une transaction d'arbitrage par match, plusieurs tournois
  // possibles) ne retiennent pas la réponse : la demande est faite, et un délai
  // du mandataire la ferait lire comme un échec. En tâche de fond ; la passe
  // horaire (`settleDeletedSoloEntries`) reprend tout ce qui n'aboutit pas.
  // `forfeitSoloEntriesAfterCommit` ne lève jamais.
  void forfeitSoloEntriesAfterCommit(forfeitable);
}

/** Les suites d'un départ d'équipe ; rend `true` si l'identité publiée d'une équipe a changé. */
async function settleDeparture(userId: number, departure: TeamDeparture, replay = false): Promise<boolean> {
  refreshTeamViewers(departure.teamId, departure.detachedUserIds, departure.streamTournamentIds);
  if (departure.successorId !== null && !replay) {
    notifyTeamInviteInBackground("OWNERSHIP", departure.teamId, departure.successorId, userId);
  }
  if (departure.fate !== "DISSOLVE") return false;
  if (!departure.everRegistered) invalidateLandingCounters();
  await deleteUnreferencedUpload(departure.logoUrl, "teams").catch(() => {});
  return departure.everRegistered;
}

/**
 * Refuse (`LAST_ADMIN_ACCOUNT`) la demande du dernier administrateur vivant.
 * Les autres administrateurs se relèvent sans verrou (une recherche verrouillée
 * sans index sur `is_admin` verrouillerait toute la table), puis le premier
 * se verrouille par sa clé et se relit : deux derniers administrateurs qui
 * demandent ensemble s'interbloquent, et le rejeu (`retryOnDeadlock`) de la
 * victime voit l'autre parti.
 */
async function assertAnotherAdminRemains(connection: PoolConnection, userId: number): Promise<void> {
  const [others] = await connection.execute<(RowDataPacket & { id: number })[]>(
    // Un administrateur suspendu ne peut ouvrir de session (`assertNotSuspended`) :
    // il ne compte pas comme un administrateur restant.
    `SELECT id FROM bg_users u WHERE is_admin = 1 AND is_deleted = 0 AND id <> ?
        AND NOT EXISTS (SELECT 1 FROM bg_account_suspensions s WHERE s.user_id = u.id AND ${activeSuspensionSql("s")})
      ORDER BY id`,
    [userId],
  );
  for (const other of others) {
    const [rows] = await connection.execute<(RowDataPacket & { is_admin: 0 | 1; is_deleted: 0 | 1 })[]>(
      `SELECT is_admin, is_deleted FROM bg_users WHERE id = ? FOR UPDATE`,
      [Number(other.id)],
    );
    if (!rows[0] || Number(rows[0].is_admin) !== 1 || Number(rows[0].is_deleted) !== 0) continue;
    // Relue en lecture verrouillante (donc courante, pas l'instantané) : une
    // suspension posée depuis le premier relevé ne laisse pas passer la
    // demande, et aucune ne se pose sur ce compte avant le commit.
    const [suspended] = await connection.execute<(RowDataPacket & { id: number })[]>(
      `SELECT s.id FROM bg_account_suspensions s
        WHERE s.user_id = ? AND ${activeSuspensionSql("s")} LIMIT 1 LOCK IN SHARE MODE`,
      [Number(other.id)],
    );
    if (suspended.length === 0) return;
  }
  throw new Error("LAST_ADMIN_ACCOUNT");
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
  options: {
    requestedAt?: Date;
    requestedAtRaw?: string;
    accountCreatedAt?: string;
    /**
     * Le motif que la confirmation a annoncé (`null` : effacement complet).
     * Relu juste avant la transaction : différent, rien n'est écrit
     * (`ACCOUNT_DELETION_PLAN_CHANGED`). Hors des verrous, comme l'aperçu :
     * la fenêtre qui compte est celle de la modale, pas les quelques
     * millisecondes jusqu'au verrou.
     */
    confirmedReason?: AccountRetentionReason | null;
  } = {},
): Promise<AccountDeletionRequestOutcome> {
  if (options.confirmedReason !== undefined) {
    const current = await getAccountDeletionRequestPlan(userId);
    if (current.reason !== options.confirmedReason) throw new Error(ACCOUNT_DELETION_PLAN_CHANGED);
  }
  const db = await getDatabase();
  let soloEntryTournaments: number[] = [];
  let withdrawn: DeletionWithdrawal[] = [];
  let forfeitable: DeletionWithdrawal[] = [];
  const departures: TeamDeparture[] = [];
  let organizedHandedOver: number[] = [];
  let castTournaments: number[] = [];
  let liveCastTournaments: number[] = [];
  // Le rejeu d'une demande après restauration (`account-deletion-replay.ts`)
  // garde la date d'origine : la fenêtre de trente jours ne repart pas à zéro.
  const requestedAt = options.requestedAt ?? new Date();
  let accountCreatedAt = "";
  let requestedAtRaw: string | undefined;
  // Une transaction annulée par un interblocage (une désignation d'arbitre
  // verrouille le match puis le compte, la demande l'inverse) se rejoue
  // entière, relevés compris (`retryOnDeadlock`).
  const transact = async (lastAttempt: boolean): Promise<void> => {
    departures.length = 0;
    // Tous les tournois de l'entrée solo sont rediffusés (son nom d'engagé
    // change) ; seuls ceux pas encore commencés sont verrouillés — une
    // inscription à un tournoi en cours ou terminé ne se retire pas, et son
    // verrou ferait attendre un tournoi en cours pour rien.
    soloEntryTournaments = await listSoloRegistrationTournamentIds(db, userId);
    const organizedIds = await listOrganizedTournamentIds(db, userId);
    const openSoloTournaments = await listSoloRegistrationTournamentIds(db, userId, true);
    const soloTournaments = mergeTournamentIds(
      openSoloTournaments,
      organizedIds,
      await listCastTournamentIds(db, userId),
    );
    // Le repreneur se cherche hors verrous (balayage de `bg_users`) ; la
    // transaction ne fait que le relire par sa clé.
    const successorHint = organizedIds.length > 0 ? await findOrganizerSuccessor(db, userId) : null;
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      for (const tournamentId of soloTournaments) await lockTournamentRow(connection, tournamentId);
      const [locked] = await connection.execute<(RowDataPacket & { is_deleted: 0 | 1; is_admin: 0 | 1; created_at: string })[]>(
        `SELECT is_deleted, is_admin, created_at FROM bg_users WHERE id = ? FOR UPDATE`,
        [userId],
      );
      if (locked.length === 0 || Number(locked[0].is_deleted) === 1) throw new Error("USER_NOT_FOUND");
      // Rejeu du journal : la ligne verrouillée doit être ce compte-là
      // (identifiant réattribué depuis la restauration → rien n'est écrit).
      if (options.accountCreatedAt !== undefined && String(locked[0].created_at) !== options.accountCreatedAt) {
        throw new Error("ACCOUNT_REASSIGNED");
      }
      accountCreatedAt = String(locked[0].created_at);
      // Une inscription solo prise entre le relevé et ce verrou tomberait dans
      // un tournoi non verrouillé (retirée à la passe horaire seulement) : la
      // transaction se rejoue avec un relevé frais.
      await assertSoloLockSetFresh(connection, userId, new Set(soloTournaments), lastAttempt);
      // Le dernier administrateur vivant fermerait l'administration de la
      // plateforme (rattrapable seulement en base). Le rejeu d'une demande
      // journalisée n'est pas refusé : elle a eu lieu.
      if (options.accountCreatedAt === undefined && Number(locked[0].is_admin) === 1) {
        await assertAnotherAdminRemains(connection, userId);
      }

      // Un tournoi dont l'heure de début est passée sans que personne ait
      // ouvert sa page passe en cours ici : son inscription, que la fenêtre de
      // retrait refuse, est alors forfaitée dès la demande comme dans tout
      // tournoi en cours, au lieu de rester jusqu'à la passe horaire.
      await syncOpenSoloTournamentsOn(connection, openSoloTournaments);
      withdrawn = await withdrawSoloRegistrationsOn(
        connection,
        await loadSoloRegistrations(connection, userId),
        new Set(soloTournaments),
      );
      forfeitable = await listForfeitableSoloEntries(connection, userId);

      for (const teamId of await listActiveTeamIds(connection, userId)) {
        departures.push(await leaveTeamOn(connection, teamId, userId));
      }
      organizedHandedOver = await handOverOrganizedTournaments(
        connection,
        userId,
        new Set(soloTournaments),
        successorHint,
      );
      // Il ne castera ni n'arbitrera plus rien à venir ; les matchs joués gardent
      // leur cast jusqu'à la suppression définitive.
      // Ses arbitrages de matchs non joués sont annoncés au staff, et un match
      // qui n'attendait plus que lui (arbitre ou caster) part. Pas au rejeu
      // d'une restauration : ni annonce ni lancement pendant la remise en état.
      const withdrawal = await withdrawUserCasts(connection, userId, false);
      castTournaments = withdrawal.tournamentIds;
      liveCastTournaments = withdrawal.liveTournamentIds;
      if (options.accountCreatedAt === undefined) {
        await relaunchAfterRefereeWithdrawal(
          connection,
          withdrawal.releasedRefereeMatchIds,
          withdrawal.releasedCastMatchIds,
        );
      }
      // Ses invitations en attente ne seront acceptées par personne.
      await connection.execute(
        `UPDATE bg_team_invitations SET status = 'CANCELLED', responded_at = NOW()
          WHERE user_id = ? AND status = 'PENDING'`,
        [userId],
      );
      // Anonyme dès la demande (décision du 2026-11-04) : pseudo d'emprunt et
      // avatar retiré posés avec le drapeau, le vrai pseudo mis de côté pour la
      // réactivation (`account-deletion-hold.ts`).
      // Le rejeu d'une ligne qui porte la date brute de sa demande (D21) la
      // réécrit telle quelle : convertie depuis l'ISO, elle suivrait le fuseau
      // du shell du rejeu. Une demande ordinaire est datée par la base
      // (`NOW()`, D67), dont l'horloge juge ensuite sa fenêtre.
      if (!(await holdAccountIdentity(connection, userId, options.requestedAtRaw ?? options.requestedAt ?? null))) {
        throw new Error("USER_NOT_FOUND");
      }
      // Un ticket de réactivation resté d'une demande précédente (connexion
      // faite pendant que le compte se réactivait ailleurs) ne doit pas pouvoir
      // relever **cette** demande sans nouvelle connexion.
      await connection.execute(`DELETE FROM bg_account_reactivation_tickets WHERE user_id = ?`, [userId]);
      // Relue telle que la base l'a écrite : c'est elle que le journal garde (D21).
      const [written] = await connection.execute<(RowDataPacket & { deletion_requested_at: string | null })[]>(
        `SELECT deletion_requested_at FROM bg_users WHERE id = ?`,
        [userId],
      );
      requestedAtRaw = written[0]?.deletion_requested_at == null ? undefined : String(written[0].deletion_requested_at);
      // Le pseudo relevé sur ses signalements est montré à la modération quand
      // le compte n'est plus vivant : il part dès la demande (la cible reste).
      await connection.execute(
        `UPDATE bg_report_targets SET label_snapshot = NULL WHERE target_type = 'USER' AND target_id = ?`,
        [userId],
      );
      await connection.execute(`DELETE FROM bg_user_sessions WHERE user_id = ?`, [userId]);
      await connection.commit();
      // Commis : une annonce qui ne part pas ne doit pas faire passer la
      // demande pour un échec (ni journal ni suites ne suivraient).
      try {
        flushBotLogs(connection);
      } catch (error) {
        console.error("[account-deletion] annonces non envoyées", failureReason(error));
      }
    } catch (error) {
      await connection.rollback().catch(() => {});
      discardBotLogs(connection);
      throw error;
    } finally {
      connection.release();
    }
  };
  // L'interblocage se rejoue **dans** chaque essai du jeu de verrous : sa
  // fenêtre de rejeu se mesure sur une transaction, pas sur plusieurs.
  await retryOnStaleLockSet((lastAttempt) => retryOnDeadlock(() => transact(lastAttempt)));
  // Les traces (quatre `EXISTS`) ne servent qu'au plan rendu au client : lues
  // après le commit, hors des verrous de tournois et d'équipes. Le compte est
  // déjà en attente, rien de ce qu'elles relèvent ne bouge plus de son fait.
  const plan = accountDeletionPlan(await loadAccountTrace(db, userId));

  // Demande consignée « en attente » au journal hors base (décision 8 du
  // 2026-11-04) : une restauration d'une sauvegarde antérieure la rejoue. La
  // réactivation la retire ; la suppression définitive écrit la sienne.
  // La date que la base a écrite (`NOW()`, D67) et dont elle juge la fenêtre :
  // l'échéance annoncée et le journal la suivent, pas l'horloge de Node.
  const storedAt = requestedAtRaw === undefined ? null : new Date(requestedAtRaw);
  const stampedAt = storedAt !== null && Number.isFinite(storedAt.getTime()) ? storedAt : requestedAt;
  await recordAccountDeletion({
    userId,
    accountCreatedAt,
    deletedAt: stampedAt.toISOString(),
    pending: true,
    ...(requestedAtRaw === undefined ? {} : { requestedAt: requestedAtRaw }),
  });
  await afterDeletionRequest(userId, {
    withdrawn,
    forfeitable,
    departures,
    organizedHandedOver,
    castTournaments,
    liveCastTournaments,
    soloTournaments: soloEntryTournaments,
    replay: options.accountCreatedAt !== undefined,
  });

  return { ...plan, finalAt: reactivationDeadline(stampedAt).toISOString() };
}
