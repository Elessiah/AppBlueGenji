import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { NamedLockUnavailableError, withNamedLock } from "@/lib/server/named-lock";
import { sendBotLog } from "@/lib/server/bot-integration";
import { formatDeletionWithdrawalLog } from "@/lib/shared/bot-logs";
import { toParticipantType } from "@/lib/shared/participants";
import { soloRegistrationsWithdrawnOnRequest, type SoloRegistrationFact } from "@/lib/shared/account-deletion";
import { lockTournamentRow } from "@/lib/server/tournaments/registration";
import { withdrawRegistrationOn } from "@/lib/server/tournaments/registration-removal";
import { syncTournamentState } from "@/lib/server/tournaments/state";
import { discardBotLogs, flushBotLogs } from "@/lib/server/tournaments/bot-logs";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { listSoloRegistrationTournamentIds, loadSoloRegistrations } from "./account-deletion";
import { failureReason } from "@/lib/server/failure-reason";

/*
 * Les inscriptions solo d'un compte dont la suppression est demandée (ou faite)
 * — décisions D12 étendue, E1, E2 et E5 (`docs/features/ACCOUNT_DELETION.md`) :
 *
 * - tournoi **pas encore commencé**, sans match : l'inscription est retirée,
 *   une à une, dès la demande ;
 * - tournoi **en cours** où l'entrée n'a **jamais joué** : ses matchs « à
 *   planifier » ou « planifiés » (deux engagées connues, rien de saisi) sont
 *   perdus par forfait, par le chemin d'arbitrage du format (abandon des
 *   formats à classement, forfait match par match dans un arbre) ;
 * - tout autre cas : rien ici, l'entrée garde son historique.
 *
 * Chaque retrait et chaque forfait écrit une ligne au journal Discord (« un
 * joueur », jamais son pseudo).
 */

/**
 * L'entrée solo `s` n'a jamais joué **dans ce tournoi** : aucun match tranché
 * sur le terrain (ni exemption, ni forfait, ni double forfait) ni score en
 * attente de confirmation. Filtré par tournoi : un compte n'a qu'une entrée
 * solo pour tous ses tournois (`uniq_bg_teams_solo_user`), et un match joué
 * ailleurs ne dit rien de celui-ci.
 */
export function soloEntryNeverPlayedSql(entry = "s.id", tournament = "r.tournament_id"): string {
  return `NOT EXISTS (
         SELECT 1 FROM bg_matches pm
          WHERE pm.tournament_id = ${tournament}
            AND (pm.team1_id = ${entry} OR pm.team2_id = ${entry})
            AND pm.status IN ('COMPLETED', 'AWAITING_CONFIRMATION')
            AND pm.is_bye = 0
            AND pm.team1_id IS NOT NULL
            AND pm.team2_id IS NOT NULL
            AND pm.forfeit_team_id IS NULL
            AND pm.double_forfeit = 0
       )`;
}

/** Comptes relevés par passage de `settleDeletedSoloEntries`. */
export const SETTLE_BATCH_SIZE = 200;

/** Mise à l'écart d'un compte dont le passage n'a rien produit (échec durable, forfait sans prise). */
export const SETTLE_IDLE_MS = 6 * 60 * 60 * 1000;

/** Au-delà, les plus anciennes mises à l'écart tombent : la requête garde une liste bornée. */
const SETTLE_IDLE_MAX = 1000;

/**
 * Comptes mis à l'écart par ce processus, jusqu'à l'instant noté : un compte
 * relevé dont le passage ne retire ni ne forfaite rien (échec qui se répète,
 * match que le forfait ne tranche pas) n'occupe plus le lot à chaque passage
 * horaire — comme `finalizeDueAccountDeletions` met à l'écart ses échecs.
 */
const settleIdleUntil = new Map<number, number>();

/** Les comptes encore à l'écart à `now` ; les échéances passées sont oubliées. */
function idleAccountIds(now: number): number[] {
  for (const [userId, until] of settleIdleUntil) if (until <= now) settleIdleUntil.delete(userId);
  return [...settleIdleUntil.keys()];
}

/** Met un compte à l'écart (borné : la plus ancienne mise à l'écart tombe la première). */
function setAside(userId: number, now: number): void {
  settleIdleUntil.delete(userId);
  settleIdleUntil.set(userId, now + SETTLE_IDLE_MS);
  if (settleIdleUntil.size > SETTLE_IDLE_MAX) {
    const oldest = settleIdleUntil.keys().next().value;
    if (oldest !== undefined) settleIdleUntil.delete(oldest);
  }
}

/** Tests : oublie les mises à l'écart du processus. */
export function resetSettleIdleForTests(): void {
  settleIdleUntil.clear();
}

/** Une inscription retirée par la suppression du compte. */
export type DeletionWithdrawal = { tournamentId: number; teamId: number };

/**
 * Remet à l'heure, sur la transaction de l'appelant (qui tient déjà leur ligne,
 * et celle du compte), les tournois pas encore commencés de l'entrée solo
 * (`syncTournamentState`). Sans cela, un tournoi dont l'heure de début est
 * passée sans que personne ait ouvert sa page restait `UPCOMING` ou
 * `REGISTRATION` en base : son inscription n'était ni retirée (la fenêtre de
 * retrait la refusait, le coup d'envoi étant passé) ni forfaitée (le tournoi
 * n'était pas `RUNNING`), et elle retenait la ligne au jour 30. Synchronisé, il
 * passe en cours, ses matchs naissent, et l'entrée est forfaitée comme dans
 * tout tournoi en cours. Les lignes de journal que la synchronisation réserve
 * partent avec le commit de l'appelant (`flushBotLogs`). Rend les tournois
 * dont l'état a changé : leurs lecteurs sont à prévenir après le commit.
 */
export async function syncOpenSoloTournamentsOn(
  connection: PoolConnection,
  tournamentIds: readonly number[],
): Promise<number[]> {
  const changed: number[] = [];
  for (const tournamentId of tournamentIds) {
    if ((await syncTournamentState(connection, tournamentId)).stateChanged) changed.push(tournamentId);
  }
  return changed;
}

/**
 * Retire, sur la transaction de l'appelant (qui tient déjà la ligne de chacun
 * des tournois `locked`), chaque inscription solo retirable dès la demande.
 */
export async function withdrawSoloRegistrationsOn(
  connection: PoolConnection,
  registrations: readonly SoloRegistrationFact[],
  locked: ReadonlySet<number>,
): Promise<DeletionWithdrawal[]> {
  const withdrawn: DeletionWithdrawal[] = [];
  for (const registration of soloRegistrationsWithdrawnOnRequest(registrations, locked)) {
    await withdrawRegistrationOn(connection, registration.tournamentId, registration.teamId);
    withdrawn.push({ tournamentId: registration.tournamentId, teamId: registration.teamId });
  }
  return withdrawn;
}

/**
 * L'entrée solo `s` n'a jamais joué dans le tournoi `t` (`r.tournament_id`)
 * **et** le forfait a encore prise sur elle :
 *
 * - un match à jouer (« à planifier » ou « planifié ») dont les **deux**
 *   engagés sont connus — le seul que `forfeitDeletedEntryMatch` sait trancher
 *   (`hasOpenDeletedEntryMatch`). Un match d'arbre qui attend encore son
 *   adversaire ne compte pas : l'entrée serait relevée à chaque passage sans
 *   que rien ne se forfaite, et occuperait le lot pour rien ;
 * - ou, dans un format à classement de la phase en cours (survie, ronde
 *   suisse, BG Survie avant ses phases finales), une place encore `ACTIVE` au
 *   classement : l'abandon s'y pose d'un geste, entre deux rondes comme
 *   pendant une ronde, sans attendre que la ronde suivante l'apparie.
 *
 * Une fois l'abandon posé, la place n'est plus `ACTIVE` : l'entrée sort du
 * relevé. Lit `t.format`, `t.current_phase_id` et
 * `t.endurance_playoffs_started` : `t` est le tournoi joint par l'appelant.
 */
function forfeitableEntrySql(): string {
  const phase = "(CASE WHEN t.format = 'MULTI' THEN t.current_phase_id ELSE 0 END)";
  return `${soloEntryNeverPlayedSql()}
        AND (
          EXISTS (
            SELECT 1 FROM bg_matches om
             WHERE om.tournament_id = r.tournament_id
               AND (om.team1_id = s.id OR om.team2_id = s.id)
               AND om.team1_id IS NOT NULL AND om.team2_id IS NOT NULL
               AND om.status IN ('PENDING', 'READY')
          )
          OR EXISTS (
            SELECT 1 FROM bg_swiss_standings ss
             WHERE ss.tournament_id = r.tournament_id AND ss.team_id = s.id
               AND ss.phase_id = ${phase} AND ss.status = 'ACTIVE'
          )
          OR EXISTS (
            SELECT 1 FROM bg_survival_standings sv
             WHERE sv.tournament_id = r.tournament_id AND sv.team_id = s.id
               AND sv.phase_id = ${phase} AND sv.status = 'ACTIVE'
          )
          OR (
            t.format = 'BG_SURVIE' AND t.endurance_playoffs_started = 0
            AND EXISTS (
              SELECT 1 FROM bg_endurance_standings es
               WHERE es.tournament_id = r.tournament_id AND es.team_id = s.id AND es.status = 'ACTIVE'
            )
          )
        )`;
}

/** Les tournois en cours où l'entrée solo du compte n'a jamais joué et où le forfait a encore prise (`forfeitableEntrySql`). */
export async function listForfeitableSoloEntries(
  runner: Pick<PoolConnection, "execute">,
  userId: number,
): Promise<DeletionWithdrawal[]> {
  const [rows] = await runner.execute<(RowDataPacket & { tournament_id: number; team_id: number })[]>(
    `SELECT DISTINCT r.tournament_id, s.id AS team_id
       FROM bg_teams s
       JOIN bg_tournament_registrations r ON r.team_id = s.id
       JOIN bg_tournaments t ON t.id = r.tournament_id AND t.state = 'RUNNING'
      WHERE s.solo_user_id = ?
        AND ${forfeitableEntrySql()}
      ORDER BY r.tournament_id`,
    [userId],
  );
  return rows.map((row) => ({ tournamentId: Number(row.tournament_id), teamId: Number(row.team_id) }));
}

/** Formats où un engagé abandonne d'un geste (tout le reste du tournoi). */
const ABANDON_FORMATS: ReadonlySet<string> = new Set(["SURVIVAL", "SWISS", "BG_SURVIE"]);

/** Le format qui décide d'un abandon : celui de la phase en cours d'un multi-phases. */
async function engineFormat(tournamentId: number): Promise<string | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { format: string; phase_format: string | null })[]>(
    `SELECT t.format, p.format AS phase_format
       FROM bg_tournaments t
       LEFT JOIN bg_tournament_phases p ON p.id = t.current_phase_id
      WHERE t.id = ? LIMIT 1`,
    [tournamentId],
  );
  const row = rows[0];
  if (!row) return null;
  return row.format === "MULTI" ? row.phase_format : row.format;
}

/**
 * L'entrée appartient toujours à un compte en suppression et n'a toujours pas
 * joué dans ce tournoi — relu juste avant l'abandon : un compte réactivé, ou
 * une manche saisie, entre le relevé et le geste garde l'entrée.
 */
async function entryStillForfeitable(tournamentId: number, teamId: number): Promise<boolean> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { is_deleted: number })[]>(
    `SELECT u.is_deleted FROM bg_teams s JOIN bg_users u ON u.id = s.solo_user_id
      WHERE s.id = ? AND ${soloEntryNeverPlayedSql("?", "?")} LIMIT 1`,
    [teamId, tournamentId, teamId, teamId],
  );
  return Number(rows[0]?.is_deleted ?? 0) === 1;
}

/** Garde-fou de la boucle d'un arbre : au-delà, un match qui ne se tranche pas. */
const MAX_BRACKET_FORFEITS = 64;

/**
 * Les matchs encore à jouer de l'entrée passent en forfait (E1), par les gestes
 * de l'arbitrage — abandon (`forfeitTournamentTeam`) dans un format à
 * classement, forfait match par match dans un arbre
 * (`forfeitDeletedEntryMatch`, qui relit tout sous le verrou du tournoi puis
 * du match et tranche par `adminResolveMatch`) : chaque forfait propage
 * l'adversaire, et un match d'aval qui reçoit l'entrée (tableau des perdants)
 * est tranché au tour suivant de la boucle. Un match dont l'adversaire n'est
 * pas encore connu attend son appariement : le passage horaire suivant
 * (`settleDeletedSoloEntries`, lancé avec les suppressions définitives) le
 * tranchera.
 *
 * Rend le nombre de forfaits posés. Chaque geste ouvre sa propre transaction
 * et prend `lockTournamentRow` le premier.
 */
export async function forfeitUnplayedSoloEntry(tournamentId: number, teamId: number): Promise<number> {
  const { forfeitTournamentTeam } = await import("@/lib/server/tournaments-service");
  const { lockDeletedSoloEntryStillForfeitable } = await import("@/lib/server/tournaments/deleted-entry-forfeit");
  const format = await engineFormat(tournamentId);
  if (format !== null && ABANDON_FORMATS.has(format)) {
    if (!(await entryStillForfeitable(tournamentId, teamId))) return 0;
    try {
      // Une seule ligne au journal : celle de la suppression, qui dit le forfait.
      // Relu une seconde fois sous le verrou du tournoi et du compte : le
      // premier relevé, hors transaction, ne ferme pas la course d'une
      // réactivation.
      await forfeitTournamentTeam(tournamentId, teamId, null, undefined, {
        skipForfeitLog: true,
        stillDue: (connection) => lockDeletedSoloEntryStillForfeitable(connection, tournamentId, teamId),
      });
    } catch (error) {
      // Plus dû (compte réactivé, manche jouée) : rien à faire.
      if (error instanceof Error && error.message === "FORFEIT_NO_LONGER_DUE") return 0;
      // Déjà hors course (abandon antérieur, passage précédent) ou absente du
      // classement : l'abandon n'a plus de prise, mais un match déjà apparié
      // peut encore l'attendre — son adversaire resterait bloqué. Ce match se
      // tranche comme dans un arbre ; rien d'ouvert : 0, sans erreur, ce qui
      // fait converger le passage horaire.
      if (error instanceof Error && (error.message === "TEAM_ALREADY_OUT" || error.message === "TEAM_NOT_IN_TOURNAMENT")) {
        return forfeitOpenMatches(tournamentId, teamId);
      }
      throw error;
    }
    return 1;
  }
  return forfeitOpenMatches(tournamentId, teamId);
}

/**
 * Forfait match par match des rencontres ouvertes de l'entrée
 * (`forfeitDeletedEntryMatch`), jusqu'à ce qu'il n'en reste plus.
 */
async function forfeitOpenMatches(tournamentId: number, teamId: number): Promise<number> {
  const { forfeitDeletedEntryMatch } = await import("@/lib/server/tournaments-service");
  let forfeits = 0;
  let previousMatchId: number | null = null;
  for (let round = 0; round < MAX_BRACKET_FORFEITS; round += 1) {
    const matchId = await forfeitDeletedEntryMatch(tournamentId, teamId);
    // Rien d'ouvert : la boucle s'arrête.
    if (matchId === null) break;
    // Le même match encore rendu : il ne se tranche pas. Arrêt, et trace pour
    // le diagnostic (identifiants seuls, aucun pseudo).
    if (matchId === previousMatchId) {
      console.warn(`[account-deletion] forfait sans effet, match ${matchId} encore ouvert (tournoi ${tournamentId})`);
      break;
    }
    previousMatchId = matchId;
    forfeits += 1;
  }
  return forfeits;
}

/** Ce qu'il faut pour rédiger la ligne de journal d'un retrait. */
async function withdrawalLogFacts(tournamentId: number): Promise<{
  name: string;
  registered: number;
  maxTeams: number;
  participantType: ReturnType<typeof toParticipantType>;
} | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & {
    name: string;
    max_teams: number;
    participant_type: string;
    registered: number;
  })[]>(
    `SELECT t.name, t.max_teams, t.participant_type,
            (SELECT COUNT(*) FROM bg_tournament_registrations r WHERE r.tournament_id = t.id) AS registered
       FROM bg_tournaments t WHERE t.id = ? LIMIT 1`,
    [tournamentId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    name: row.name,
    registered: Number(row.registered),
    maxTeams: Number(row.max_teams),
    participantType: toParticipantType(row.participant_type),
  };
}

/** Journal Discord d'un retrait ou d'un forfait dû à la suppression d'un compte (E5). Ne lève jamais. */
export async function logDeletionWithdrawal(tournamentId: number, forfeited: boolean): Promise<void> {
  try {
    const facts = await withdrawalLogFacts(tournamentId);
    if (!facts) return;
    sendBotLog(
      formatDeletionWithdrawalLog({
        tournament: { id: tournamentId, name: facts.name },
        // Nom jamais lu en tournoi individuel (« un joueur ») ; vide par prudence.
        entrant: { name: "", participantType: facts.participantType },
        registeredTeams: facts.registered,
        maxTeams: facts.maxTeams,
        forfeited,
      }),
      { tournamentId, category: "registrations" },
    );
  } catch (error) {
    console.error("[account-deletion] ligne de journal du retrait non écrite", failureReason(error));
  }
}

/**
 * Verrou nommé d'une entrée solo pendant son forfait : le forfait d'une demande
 * et le passage horaire, lancés ensemble sur la même entrée, posaient chacun un
 * forfait d'arbre différent et écrivaient chacun leur ligne Discord. Sans
 * attente : celui qui trouve le verrou pris laisse l'autre finir, et le passage
 * suivant reprend ce qui resterait.
 */
export function soloForfeitLockName(teamId: number): string {
  return `bg_solo_forfeit_${teamId}`;
}

/**
 * Forfait de chaque entrée, une à une et au meilleur effort : un échec est dit
 * et reporté au prochain passage, sans empêcher les suivantes. Jamais levé.
 * Rend le nombre de tournois où un forfait a été posé. Appelé après le commit
 * de la demande, et par le passage horaire (`settleDeletedSoloEntries`), qui
 * reprend tout échec. `silent` (rejeu d'une demande après restauration) : sans
 * ligne au journal Discord, le forfait ayant déjà été annoncé.
 *
 * Les appels d'un même processus passent **un à un** : chacun tient une
 * connexion du pool (celle du verrou nommé) pendant que le forfait en emprunte
 * d'autres ; lancés en nombre (demandes simultanées, passage horaire), ils
 * pouvaient occuper tout le pool à attendre une connexion qu'aucun ne rendait.
 */
export function forfeitSoloEntriesAfterCommit(
  entries: readonly DeletionWithdrawal[],
  options: { silent?: boolean } = {},
): Promise<number> {
  const run = forfeitQueue.then(() => forfeitEntriesOneByOne(entries, options));
  forfeitQueue = run.catch(() => undefined);
  return run;
}

/** File des forfaits du processus (voir {@link forfeitSoloEntriesAfterCommit}). */
let forfeitQueue: Promise<unknown> = Promise.resolve();

async function forfeitEntriesOneByOne(
  entries: readonly DeletionWithdrawal[],
  options: { silent?: boolean },
): Promise<number> {
  if (entries.length === 0) return 0;
  let forfeited = 0;
  let db: Awaited<ReturnType<typeof getDatabase>>;
  try {
    db = await getDatabase();
  } catch (error) {
    console.error("[account-deletion] forfaits reportés, base injoignable :", failureReason(error));
    return 0;
  }
  for (const entry of entries) {
    try {
      const forfeits = await withNamedLock(db, soloForfeitLockName(entry.teamId), 0, async () => {
        const count = await forfeitUnplayedSoloEntry(entry.tournamentId, entry.teamId);
        // Écrite sous le verrou : l'appelant concurrent ne peut pas l'écrire aussi.
        if (count > 0 && !options.silent) await logDeletionWithdrawal(entry.tournamentId, true);
        return count;
      });
      if (forfeits > 0) forfeited += 1;
    } catch (error) {
      // Déjà en cours ailleurs : l'autre appelant forfaite et journalise.
      if (error instanceof NamedLockUnavailableError) continue;
      console.error(
        `[account-deletion] forfait de l'entrée ${entry.teamId} (tournoi ${entry.tournamentId}) reporté :`,
        failureReason(error),
      );
    }
  }
  return forfeited;
}

/**
 * Rediffuse puis journalise un retrait déjà commis par la passe horaire, chacun
 * dans son `try` : l'un qui lève ne prive pas l'autre — le retrait ne sera plus
 * jamais relu par une passe. Ne lève jamais.
 */
async function announceSettledWithdrawal(userId: number, tournamentId: number): Promise<void> {
  try {
    publishUpdatedEvent(tournamentId);
  } catch (error) {
    console.error(
      `[deleted-accounts] retrait du compte #${userId} (tournoi ${tournamentId}) non rediffusé :`,
      failureReason(error),
    );
  }
  try {
    await logDeletionWithdrawal(tournamentId, false);
  } catch (error) {
    console.error(
      `[deleted-accounts] retrait du compte #${userId} (tournoi ${tournamentId}) non journalisé :`,
      failureReason(error),
    );
  }
}

/**
 * Rattrapage (E2) : applique la règle du jour aux comptes **déjà** supprimés
 * (demande en cours ou suppression faite) — inscriptions solo à un tournoi pas
 * encore commencé retirées, entrées jamais jouées d'un tournoi en cours
 * forfaitées. Idempotent : un compte sans rien à retirer ni à forfaiter n'est
 * pas touché, et un second passage ne trouve plus rien.
 *
 * Rend le nombre d'inscriptions retirées et de tournois forfaités.
 */
export async function settleDeletedSoloEntries(): Promise<{ withdrawn: number; forfeited: number }> {
  const db = await getDatabase();
  const now = Date.now();
  const idle = idleAccountIds(now);
  const notIdle = idle.length > 0 ? `
        AND u.id NOT IN (${idle.map(() => "?").join(", ")})` : "";
  // Seuls les comptes qui ont **quelque chose** à faire : une inscription à
  // retirer (tournoi pas commencé) ou une entrée en cours à forfaiter. Un
  // compte dont l'entrée a joué reste inscrit à un tournoi en cours des
  // semaines durant — le relever ici le ferait relire à chaque passage
  // horaire de chaque processus. Borné : un lot par passage.
  const [candidates] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT DISTINCT u.id
       FROM bg_users u
       JOIN bg_teams s ON s.solo_user_id = u.id
       JOIN bg_tournament_registrations r ON r.team_id = s.id
       JOIN bg_tournaments t ON t.id = r.tournament_id
      WHERE u.is_deleted = 1
        AND (
          t.state IN ('UPCOMING', 'REGISTRATION')
          OR (t.state = 'RUNNING' AND ${forfeitableEntrySql()})
        )${notIdle}
      ORDER BY u.id
      LIMIT ${SETTLE_BATCH_SIZE}`,
    idle,
  );
  const outcome = { withdrawn: 0, forfeited: 0 };
  for (const candidate of candidates) {
    const userId = Number(candidate.id);
    let effective = false;
    let withdrawals: Awaited<ReturnType<typeof withdrawDeletedAccountRegistrations>>;
    try {
      withdrawals = await withdrawDeletedAccountRegistrations(userId);
    } catch (error) {
      console.error(
        `[deleted-accounts] Inscriptions solo du compte #${userId} reportées :`,
        failureReason(error),
      );
      setAside(userId, now);
      continue;
    }
    const { withdrawn, started } = withdrawals;
    outcome.withdrawn += withdrawn.length;
    // Commis : ce qui suit ne défait rien. Une rediffusion ou un journal qui
    // lève n'empêche ni les tournois suivants ni les forfaits, et le compte
    // n'est pas mis à l'écart comme s'il n'avait rien produit.
    effective = withdrawn.length > 0 || started > 0;
    for (const entry of withdrawn) await announceSettledWithdrawal(userId, entry.tournamentId);
    try {
      // Un tournoi qui échoue n'empêche pas les suivants du même compte.
      const forfeited = await forfeitSoloEntriesAfterCommit(await listForfeitableSoloEntries(db, userId));
      outcome.forfeited += forfeited;
      if (forfeited > 0) effective = true;
    } catch (error) {
      console.error(`[deleted-accounts] forfaits du compte #${userId} reportés :`, failureReason(error));
    }
    // Rien de produit (échec, ou forfait sans prise) : à l'écart quelques
    // heures, pour que le lot serve aux comptes qui avancent.
    if (!effective) setAside(userId, now);
  }
  return outcome;
}

/**
 * Une transaction par compte supprimé : tournois verrouillés d'abord (id
 * croissant), puis le compte, relu supprimé sous son verrou.
 */
async function withdrawDeletedAccountRegistrations(
  userId: number,
): Promise<{ withdrawn: DeletionWithdrawal[]; started: number }> {
  const db = await getDatabase();
  // Les seuls tournois pas encore commencés : une inscription ne part que de
  // ceux-là, et verrouiller un tournoi en cours le ferait attendre pour rien.
  const tournamentIds = await listSoloRegistrationTournamentIds(db, userId, true);
  if (tournamentIds.length === 0) return { withdrawn: [], started: 0 };
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    for (const tournamentId of tournamentIds) await lockTournamentRow(connection, tournamentId);
    const [locked] = await connection.execute<(RowDataPacket & { is_deleted: number })[]>(
      `SELECT is_deleted FROM bg_users WHERE id = ? FOR UPDATE`,
      [userId],
    );
    if (Number(locked[0]?.is_deleted ?? 0) !== 1) {
      await connection.rollback();
      return { withdrawn: [], started: 0 };
    }
    // Un tournoi dont l'heure de début est passée sans synchronisation passe
    // en cours ici : son inscription se forfaite ensuite, au lieu d'être
    // relevée à chaque passage sans rien produire.
    const started = await syncOpenSoloTournamentsOn(connection, tournamentIds);
    const withdrawn = await withdrawSoloRegistrationsOn(
      connection,
      await loadSoloRegistrations(connection, userId),
      new Set(tournamentIds),
    );
    await connection.commit();
    // Commis : une annonce ou un écouteur qui lève ne fait pas passer les
    // retraits pour un échec (ni rediffusion ni journal ne suivraient, et le
    // compte serait mis à l'écart comme s'il n'avait rien produit).
    try {
      flushBotLogs(connection);
    } catch (error) {
      console.error(`[deleted-accounts] annonces du compte #${userId} non envoyées :`, failureReason(error));
    }
    // Passé en cours : les lecteurs du tournoi voient son coup d'envoi.
    for (const tournamentId of started) {
      try {
        publishUpdatedEvent(tournamentId);
      } catch (error) {
        console.error(`[deleted-accounts] tournoi #${tournamentId} non prévenu :`, failureReason(error));
      }
    }
    return { withdrawn, started: started.length };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    discardBotLogs(connection);
    connection.release();
  }
}
