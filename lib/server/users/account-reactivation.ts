import crypto from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import {
  ACCOUNT_PENDING_DELETION_CODE,
  isReactivationWindowOpen,
  REACTIVATION_TICKET_MINUTES,
  reactivationDeadline,
} from "@/lib/shared/account-deletion";
import type { ConnectionLogEvent } from "@/lib/shared/connection-logs";
import { forgetPendingAccountDeletion } from "@/lib/server/account-deletion-journal";
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

/** Une date relue de la base (`dateStrings`), ou son absence. */
type StoredDate = string | Date | null;

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
    // Servi une fois, quoi qu'il advienne de la suite — et réservé par cette
    // instruction même (`affectedRows`) : une seconde requête au même cookie,
    // qui a lu le ticket avant ce retrait, n'en tire rien.
    const [consumed] = await connection.execute<ResultSetHeader>(
      `DELETE FROM bg_account_reactivation_tickets WHERE token_hash = ?`,
      [tokenHash],
    );
    const ticket = Number(consumed.affectedRows) === 1 ? tickets[0] : undefined;
    if (!ticket) {
      await connection.commit();
      return null;
    }
    const userId = Number(ticket.user_id);
    const [locked] = await connection.execute<(RowDataPacket & {
      is_deleted: 0 | 1;
      deletion_requested_at: StoredDate;
      created_at: string;
    })[]>(
      `SELECT is_deleted, deletion_requested_at, created_at FROM bg_users WHERE id = ? FOR UPDATE`,
      [userId],
    );
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
    await connection.commit();
    if (!restored) return null;
    // Après le commit : la demande en attente ne doit plus être rejouée par une
    // restauration, et les vues en cache montraient le pseudo d'emprunt.
    await forgetPendingAccountDeletion({ userId, accountCreatedAt: String(row.created_at) });
    invalidateTeamIdentityViews();
    invalidateStats();
    return { userId, event: ticket.login_event as ConnectionLogEvent };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}
