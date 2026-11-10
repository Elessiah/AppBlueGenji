import crypto from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import {
  ACCOUNT_PENDING_DELETION_CODE,
  isReactivationWindowOpen,
  REACTIVATION_TICKET_MINUTES,
  reactivationDeadline,
  type StoredDate,
} from "@/lib/shared/account-deletion";
import type { ConnectionLogEvent } from "@/lib/shared/connection-logs";
import { recordAccountReactivation } from "@/lib/server/account-deletion-journal";
import { reactivationUndoes, type AccountDeletionEntry } from "@/lib/shared/account-deletion-journal";
import { invalidateTeamIdentityViews } from "@/lib/server/ranking-cache";
import { invalidateStats } from "@/lib/server/stats-cache";
import { restoreAccountIdentity } from "./account-deletion-hold";

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

function hashTicket(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** L'état de suppression d'un compte : `null` s'il est vivant, inconnu ou déjà supprimé définitivement. */
export async function readPendingDeletion(userId: number): Promise<{ requestedAt: string; windowOpen: boolean } | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { is_deleted: 0 | 1; deletion_requested_at: StoredDate })[]>(
    `SELECT is_deleted, deletion_requested_at FROM bg_users WHERE id = ? LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (!row || Number(row.is_deleted) !== 1 || row.deletion_requested_at === null) return null;
  return {
    requestedAt: new Date(row.deletion_requested_at).toISOString(),
    windowOpen: isReactivationWindowOpen(row.deletion_requested_at),
  };
}

/** Remet un ticket de réactivation au compte ; rend le jeton en clair (pour le cookie). */
export async function createReactivationTicket(userId: number, event: ConnectionLogEvent): Promise<string> {
  const db = await getDatabase();
  const token = crypto.randomBytes(32).toString("hex");
  await db.execute(`DELETE FROM bg_account_reactivation_tickets WHERE expires_at < NOW() OR user_id = ?`, [userId]);
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
  const [rows] = await db.execute<(RowDataPacket & { user_id: number; deletion_requested_at: StoredDate })[]>(
    `SELECT k.user_id, u.deletion_requested_at
       FROM bg_account_reactivation_tickets k
       JOIN bg_users u ON u.id = k.user_id AND u.is_deleted = 1
      WHERE k.token_hash = ? AND k.expires_at > NOW()
      LIMIT 1`,
    [hashTicket(token)],
  );
  const row = rows[0];
  if (!row || row.deletion_requested_at === null || !isReactivationWindowOpen(row.deletion_requested_at)) return null;
  return { userId: Number(row.user_id), finalAt: reactivationDeadline(row.deletion_requested_at).toISOString() };
}

/**
 * L'entrée solo reprend le vrai pseudo : les lecteurs de ses tournois voyaient
 * le pseudo d'emprunt. Meilleur effort, ne lève jamais (le compte est déjà
 * réactivé). Imports différés : ce module est lu par `auth.ts`.
 */
async function republishSoloEntryTournaments(userId: number): Promise<void> {
  try {
    const db = await getDatabase();
    const { listSoloRegistrationTournamentIds } = await import("./account-deletion");
    const { publishUpdatedEvent } = await import("@/lib/server/tournaments/notifications");
    for (const tournamentId of await listSoloRegistrationTournamentIds(db, userId)) publishUpdatedEvent(tournamentId);
  } catch (error) {
    console.error("[account-reactivation] tournois de l'entrée solo non rediffusés", error);
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
    console.error("[account-reactivation] alerte de réactivation non écrite", error);
  }
}

/**
 * Consomme le ticket et relève la demande de suppression, sous le verrou du
 * compte (fenêtre relue dessous : la suppression définitive ne passe pas entre
 * la lecture et l'écriture). Rend le compte et sa porte d'entrée, ou `null` —
 * ticket inconnu, expiré, déjà servi, ou fenêtre close.
 */
export async function reactivateAccount(
  token: string | undefined,
): Promise<{ userId: number; event: ConnectionLogEvent } | null> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const db = await getDatabase();
  const tokenHash = hashTicket(token);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [tickets] = await connection.execute<(RowDataPacket & { user_id: number; login_event: string })[]>(
      `SELECT user_id, login_event FROM bg_account_reactivation_tickets
        WHERE token_hash = ? AND expires_at > NOW() LIMIT 1`,
      [tokenHash],
    );
    const candidate = tickets[0];
    if (!candidate) {
      await connection.commit();
      return null;
    }
    const userId = Number(candidate.user_id);
    // Le compte d'abord, le ticket ensuite : même ordre que la suppression
    // définitive (`deleteAccountNow` verrouille le compte, puis la cascade
    // atteint ses tickets) — l'ordre inverse s'interbloquait avec elle.
    const [locked] = await connection.execute<(RowDataPacket & {
      is_deleted: 0 | 1;
      deletion_requested_at: StoredDate;
      created_at: string;
    })[]>(
      `SELECT is_deleted, deletion_requested_at, created_at FROM bg_users WHERE id = ? FOR UPDATE`,
      [userId],
    );
    // Servi une fois, quoi qu'il advienne de la suite — et réservé par cette
    // instruction même (`affectedRows`) : une seconde requête au même cookie,
    // qui a lu le ticket avant ce retrait, n'en tire rien.
    const [consumed] = await connection.execute<ResultSetHeader>(
      `DELETE FROM bg_account_reactivation_tickets WHERE token_hash = ? AND user_id = ?`,
      [tokenHash, userId],
    );
    const ticket = Number(consumed.affectedRows) === 1 ? candidate : undefined;
    if (!ticket) {
      await connection.commit();
      return null;
    }
    const row = locked[0];
    if (
      !row ||
      Number(row.is_deleted) !== 1 ||
      row.deletion_requested_at === null ||
      !isReactivationWindowOpen(row.deletion_requested_at)
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
    // Les vues en cache montraient le pseudo d'emprunt.
    invalidateTeamIdentityViews();
    invalidateStats();
    await republishSoloEntryTournaments(userId);
    await logReactivation();
    return { userId, event: ticket.login_event as ConnectionLogEvent };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
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
      restored = await restoreAccountIdentity(connection, userId);
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
