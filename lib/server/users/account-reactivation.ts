import crypto from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { isUnknownColumnError } from "@/lib/server/mysql-errors";
import { retryOnDeadlock } from "@/lib/server/tournaments/deadlock-retry";
import {
  ACCOUNT_DELETED_ERROR,
  ACCOUNT_PENDING_DELETION_CODE,
  REACTIVATION_TICKET_MINUTES,
  reactivationDeadline,
  type StoredDate,
} from "@/lib/shared/account-deletion";
import type { ConnectionLogEvent } from "@/lib/shared/connection-logs";
import { recordAccountReactivation } from "@/lib/server/account-deletion-journal";
import { reactivationUndoes, type AccountDeletionEntry } from "@/lib/shared/account-deletion-journal";
import { invalidateTeamIdentityViews } from "@/lib/server/ranking-cache";
import { invalidateStats } from "@/lib/server/stats-cache";
import { type RestoredIdentity, restoreAccountIdentity } from "./account-deletion-hold";
import { reactivationWindowOpenSql, windowFlag } from "./reactivation-window";
import { failureReason } from "@/lib/server/failure-reason";

/*
 * Réactivation d'un compte dont la suppression est demandée (E4,
 * `docs/features/ACCOUNT_DELETION.md`).
 *
 * Se reconnecter dans les trente jours n'ouvre **pas** de session : la porte
 * d'entrée (`createSession`) remet un ticket — un jeton aléatoire dont seule
 * l'empreinte est gardée, valable quinze minutes, dans un cookie `httpOnly` —
 * et renvoie vers l'écran de réactivation, qui dit ce que la réactivation ne
 * rend pas. Seul le clic « Réactiver mon compte » (`POST /api/auth/reactivate`)
 * consomme le ticket, relève la demande et ouvre la session. Jamais en silence.
 */

/** Cookie du ticket de réactivation (`__Host-` en production, `auth-cookies.ts`). */
export { reactivationCookieName } from "@/lib/shared/auth-cookies";

/** Durée de vie d'un ticket (`lib/shared/account-deletion.ts`). */
export { REACTIVATION_TICKET_MINUTES };

/** Refus d'une connexion à un compte en attente de suppression (la porte renvoie vers la réactivation). */
export const ACCOUNT_PENDING_DELETION = ACCOUNT_PENDING_DELETION_CODE;

/** La connexion vise un compte en attente de suppression : `ticket` est à poser en cookie. */
export class AccountPendingDeletionError extends Error {
  constructor(readonly ticket: string) {
    super(ACCOUNT_PENDING_DELETION);
    this.name = "AccountPendingDeletionError";
  }
}

/**
 * Connexion d'un compte dont le délai de réactivation est écoulé, avant que la
 * passe horaire ne joue la suppression définitive : plus rien ne s'ouvre. Typée
 * pour que chaque porte la rende lisible (410 au code Discord, `error=deleted`
 * à l'OAuth) au lieu d'un échec générique.
 */
export class AccountDeletedError extends Error {
  constructor() {
    super(ACCOUNT_DELETED_ERROR);
    this.name = "AccountDeletedError";
  }
}

function hashTicket(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** L'état de suppression d'un compte : `null` s'il est vivant, inconnu ou déjà supprimé définitivement. */
export async function readPendingDeletion(userId: number): Promise<{ requestedAt: string; windowOpen: boolean } | null> {
  const db = await getDatabase();
  type PendingRow = RowDataPacket & { is_deleted: 0 | 1; deletion_requested_at: StoredDate; window_open: unknown };
  let rows: PendingRow[];
  try {
    // La fenêtre se juge contre l'horloge de la base (D67), celle qui a daté la demande.
    [rows] = await db.execute<PendingRow[]>(
      `SELECT is_deleted, deletion_requested_at, ${reactivationWindowOpenSql()} AS window_open
         FROM bg_users WHERE id = ? LIMIT 1`,
      [userId],
    );
  } catch (error) {
    // Lue à chaque connexion : une migration tolérante en échec (colonne
    // absente) ne doit pas fermer la porte — sans la colonne, aucune demande
    // n'a pu être posée.
    if (isUnknownColumnError(error)) return null;
    throw error;
  }
  const row = rows[0];
  if (!row || Number(row.is_deleted) !== 1 || row.deletion_requested_at === null) return null;
  return {
    requestedAt: new Date(row.deletion_requested_at).toISOString(),
    windowOpen: windowFlag(row.window_open),
  };
}

/**
 * Remet un ticket de réactivation au compte ; rend le jeton en clair (pour le
 * cookie). Les tickets encore valides du compte restent : une seconde connexion
 * (autre appareil, autre onglet) ne périme pas l'écran déjà ouvert. Tous
 * partent à la réactivation, à l'échéance (quinze minutes) ou avec le compte.
 */
export async function createReactivationTicket(userId: number, event: ConnectionLogEvent): Promise<string> {
  const db = await getDatabase();
  const token = crypto.randomBytes(32).toString("hex");
  await db.execute(`DELETE FROM bg_account_reactivation_tickets WHERE expires_at < NOW()`);
  await db.execute(
    `INSERT INTO bg_account_reactivation_tickets (token_hash, user_id, login_event, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [hashTicket(token), userId, event, REACTIVATION_TICKET_MINUTES],
  );
  return token;
}

/** Le ticket valide désigné par ce jeton, sans le consommer (écran de réactivation). */
export async function peekReactivationTicket(
  token: string | undefined,
): Promise<{ userId: number; finalAt: string } | null> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { user_id: number; deletion_requested_at: StoredDate; window_open: unknown })[]>(
    `SELECT k.user_id, u.deletion_requested_at, ${reactivationWindowOpenSql("u.deletion_requested_at")} AS window_open
       FROM bg_account_reactivation_tickets k
       JOIN bg_users u ON u.id = k.user_id AND u.is_deleted = 1
      WHERE k.token_hash = ? AND k.expires_at > NOW()
      LIMIT 1`,
    [hashTicket(token)],
  );
  const row = rows[0];
  if (!row || row.deletion_requested_at === null || !windowFlag(row.window_open)) return null;
  return { userId: Number(row.user_id), finalAt: reactivationDeadline(row.deletion_requested_at).toISOString() };
}

/**
 * « Ne pas réactiver » : retire le ticket désigné par ce jeton **et tous ceux
 * du même compte** — le titulaire vient de dire non, et un ticket resté dans
 * le cookie d'un autre poste (onglet fermé sans répondre) ne doit pas rester
 * utilisable jusqu'à son terme. Sans effet sur la demande, qui suit son cours.
 * Jeton absent, mal formé ou inconnu : rien.
 */
export async function discardReactivationTicket(token: string | undefined): Promise<void> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return;
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { user_id: number })[]>(
    `SELECT user_id FROM bg_account_reactivation_tickets WHERE token_hash = ? LIMIT 1`,
    [hashTicket(token)],
  );
  if (rows.length === 0) return;
  await db.execute(`DELETE FROM bg_account_reactivation_tickets WHERE user_id = ?`, [Number(rows[0].user_id)]);
}

/**
 * Le compte reprend son vrai pseudo : les lecteurs des tournois qui le
 * nomment — son entrée solo (tous ses tournois), et tout tournoi pas terminé où
 * il paraît (effectif d'une équipe engagée, cast, arbitrage :
 * `listNamingTournamentIds`) — voyaient le pseudo d'emprunt. Meilleur effort,
 * ne lève jamais (le compte est déjà réactivé). Imports différés : ce module
 * est lu par `auth.ts`.
 */
async function republishSoloEntryTournaments(userId: number): Promise<void> {
  try {
    const db = await getDatabase();
    const { listNamingTournamentIds, listSoloRegistrationTournamentIds, mergeTournamentIds } = await import(
      "./account-deletion"
    );
    const { publishUpdatedEvent } = await import("@/lib/server/tournaments/notifications");
    const tournamentIds = mergeTournamentIds(
      await listSoloRegistrationTournamentIds(db, userId),
      await listNamingTournamentIds(db, userId),
    );
    for (const tournamentId of tournamentIds) publishUpdatedEvent(tournamentId);
  } catch (error) {
    console.error("[account-reactivation] tournois qui nomment le compte non rediffusés", failureReason(error));
  }
}

/**
 * Ligne du journal Discord du staff (canal `signups`, sans pseudo) : la
 * demande y était notée, son annulation l'est aussi. Meilleur effort, ne lève
 * jamais. Imports différés : ce module est lu par `auth.ts`.
 */
async function logReactivation(): Promise<void> {
  try {
    const { sendBotLog } = await import("@/lib/server/bot-integration");
    const { formatAccountReactivationLog } = await import("@/lib/shared/bot-logs");
    sendBotLog(formatAccountReactivationLog(), { category: "signups" });
  } catch (error) {
    console.error("[account-reactivation] alerte de réactivation non écrite", failureReason(error));
  }
}

/**
 * Consomme le ticket et relève la demande de suppression, sous le verrou du
 * compte (fenêtre relue dessous : la suppression définitive ne passe pas entre
 * la lecture et l'écriture). Rend le compte, sa porte d'entrée et ce qu'il a
 * retrouvé (`pseudoChanged` : pas son pseudo d'avant), ou `null` — ticket
 * inconnu, expiré, déjà servi, ou fenêtre close.
 */
export async function reactivateAccount(
  token: string | undefined,
): Promise<{ userId: number; event: ConnectionLogEvent; pseudoChanged: boolean } | null> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const db = await getDatabase();
  const tokenHash = hashTicket(token);
  // Le ticket se lit hors de la transaction : lu dedans, il y figerait
  // l'instantané (REPEATABLE READ) avant le verrou du compte, et la reprise du
  // pseudo (`restoreAccountIdentity`) ne verrait pas un renommage commis entre-temps.
  const [tickets] = await db.execute<(RowDataPacket & { user_id: number; login_event: string })[]>(
    `SELECT user_id, login_event FROM bg_account_reactivation_tickets
      WHERE token_hash = ? AND expires_at > NOW() LIMIT 1`,
    [tokenHash],
  );
  const candidate = tickets[0];
  if (!candidate) return null;
  const userId = Number(candidate.user_id);
  // Rejouée entière sur interblocage (ou refus d'instantané MariaDB) : elle
  // attend le verrou du compte derrière la suppression définitive. Rien n'est
  // écrit avant l'annulation, et les suites d'après commit restent dehors.
  const transact = async (): Promise<RestoredIdentity | null> => {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      // Le compte d'abord, le ticket ensuite : même ordre que la suppression
      // définitive (`deleteAccountNow` verrouille le compte, puis la cascade
      // atteint ses tickets) — l'ordre inverse s'interbloquait avec elle.
      const [locked] = await connection.execute<(RowDataPacket & {
        is_deleted: 0 | 1;
        deletion_requested_at: StoredDate;
        created_at: string;
        window_open: unknown;
      })[]>(
        `SELECT is_deleted, deletion_requested_at, created_at, ${reactivationWindowOpenSql()} AS window_open
           FROM bg_users WHERE id = ? FOR UPDATE`,
        [userId],
      );
      // Servi une fois, quoi qu'il advienne de la suite — et réservé par cette
      // instruction même (`affectedRows`) : une seconde requête au même cookie,
      // qui a lu le ticket avant ce retrait, n'en tire rien.
      const [consumed] = await connection.execute<ResultSetHeader>(
        `DELETE FROM bg_account_reactivation_tickets WHERE token_hash = ? AND user_id = ? AND expires_at > NOW()`,
        [tokenHash, userId],
      );
      if (Number(consumed.affectedRows) !== 1) {
        await connection.commit();
        return null;
      }
      const row = locked[0];
      if (
        !row ||
        Number(row.is_deleted) !== 1 ||
        row.deletion_requested_at === null ||
        !windowFlag(row.window_open)
      ) {
        await connection.commit();
        return null;
      }
      // Le vrai pseudo et l'avatar reviennent avec le compte (anonyme depuis la
      // demande, `account-deletion-hold.ts`).
      const restored = await restoreAccountIdentity(connection, userId);
      // Une session ouverte pendant la demande (connexion en cours au moment du
      // `DELETE` de la demande) redeviendrait valide avec le compte : toutes
      // partent, seule celle de la réactivation sera créée ensuite.
      if (!restored) {
        await connection.commit();
        return null;
      }
      await connection.execute(`DELETE FROM bg_user_sessions WHERE user_id = ?`, [userId]);
      // Les autres tickets du compte (autre appareil) n'ont plus d'objet.
      await connection.execute(`DELETE FROM bg_account_reactivation_tickets WHERE user_id = ?`, [userId]);
      // Avant le commit, et levé s'il échoue (la transaction s'annule, le ticket
      // revient) : la demande en attente ne doit plus être rejouée par une
      // restauration — la réactivation l'y remplace, et une sauvegarde prise
      // pendant les trente jours, restaurée, réactive le compte au rejeu
      // (décision R1). Un commit qui échouerait ensuite laisse une ligne de
      // réactivation pour une demande restée en attente : son titulaire, qui
      // voit l'échec, réactive de nouveau (même ligne) ou laisse courir le délai.
      await recordAccountReactivation(
        {
          userId,
          accountCreatedAt: String(row.created_at),
          undoneRequestAt: String(row.deletion_requested_at),
        },
        { strict: true },
      );
      await connection.commit();
      return restored;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  };
  const identity = await retryOnDeadlock(transact);
  if (identity === null) return null;
  // Les vues en cache montraient le pseudo d'emprunt.
  invalidateTeamIdentityViews();
  invalidateStats();
  await republishSoloEntryTournaments(userId);
  await logReactivation();
  return { userId, event: candidate.login_event as ConnectionLogEvent, pseudoChanged: identity === "RENAMED" };
}

/**
 * Rejeu après la restauration d'une sauvegarde (décision R1 du 2026-11-04) :
 * un compte réactivé depuis la sauvegarde, revenu avec elle en attente de
 * suppression, est réactivé de nouveau — même écriture que la réactivation
 * (pseudo, avatar, sessions retirées), sans ticket ni fenêtre : elle a eu lieu.
 * N'écrit pas le journal (sa ligne de réactivation y est déjà). Rend l'issue
 * relue sous verrou : `REACTIVATED`, `ALREADY_ACTIVE` (compte vivant),
 * `SUPERSEDED` (même compte toujours en attente, d'une demande postérieure à
 * celle que la réactivation défaisait — elle tient), `GONE` (suppression déjà
 * définitive), `ABSENT` (plus de ligne) ou `OTHER_ACCOUNT` (identifiant
 * réattribué), relus sous verrou.
 */
export type ReplayedReactivation = "REACTIVATED" | "ALREADY_ACTIVE" | "SUPERSEDED" | "GONE" | "ABSENT" | "OTHER_ACCOUNT";

type LockedAccountRow = RowDataPacket & {
  is_deleted: 0 | 1;
  deletion_requested_at: StoredDate;
  created_at: string;
};

/**
 * L'issue d'une réactivation rejouée, hors rétablissement, d'après la ligne
 * relue sous verrou — `null` : même compte, en attente de la demande que la
 * réactivation défait (à rétablir).
 */
function lockedReactivationOutcome(
  entry: AccountDeletionEntry,
  row: LockedAccountRow | undefined,
): Exclude<ReplayedReactivation, "REACTIVATED"> | null {
  if (!row) return "ABSENT";
  if (String(row.created_at) !== entry.accountCreatedAt) return "OTHER_ACCOUNT";
  const isDeleted = Number(row.is_deleted) === 1;
  if (!isDeleted) return "ALREADY_ACTIVE";
  const pendingDeletion = row.deletion_requested_at !== null;
  const undoes = reactivationUndoes(entry, {
    createdAt: String(row.created_at),
    isDeleted,
    pendingDeletion,
    deletionRequestedAt: row.deletion_requested_at === null ? null : String(row.deletion_requested_at),
  });
  if (undoes) return null;
  return pendingDeletion ? "SUPERSEDED" : "GONE";
}

/**
 * Rejoue une réactivation journalisée (voir `ReplayedReactivation`).
 *
 * @throws REACTIVATION_NOT_RESTORED — l'écriture de réactivation n'a apparié
 *   aucune ligne malgré le verrou : rien n'est écrit, le rejeu compte un échec.
 */
export async function replayAccountReactivation(entry: AccountDeletionEntry): Promise<ReplayedReactivation> {
  const userId = entry.userId;
  const db = await getDatabase();
  const connection = await db.getConnection();
  let restored = false;
  let outcome: Exclude<ReplayedReactivation, "REACTIVATED"> | null;
  try {
    await connection.beginTransaction();
    const [locked] = await connection.execute<LockedAccountRow[]>(
      `SELECT is_deleted, deletion_requested_at, created_at FROM bg_users WHERE id = ? FOR UPDATE`,
      [userId],
    );
    // Revérifié sous verrou : même compte, et demande que la réactivation défait.
    outcome = lockedReactivationOutcome(entry, locked[0]);
    if (outcome === null) {
      restored = (await restoreAccountIdentity(connection, userId)) !== null;
      // Sous le verrou, la ligne est en attente : l'écriture ne peut que
      // l'apparier (un masque absent réactive sous le pseudo d'emprunt). Si
      // elle n'apparie rien, c'est un échec à dire (`failed`), jamais une
      // demande qui tiendrait.
      if (!restored) throw new Error("REACTIVATION_NOT_RESTORED");
      await connection.execute(`DELETE FROM bg_user_sessions WHERE user_id = ?`, [userId]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
  // Rien à rétablir sous verrou : l'issue relue le dit.
  if (outcome !== null) return outcome;
  invalidateTeamIdentityViews();
  invalidateStats();
  await republishSoloEntryTournaments(userId);
  return "REACTIVATED";
}
