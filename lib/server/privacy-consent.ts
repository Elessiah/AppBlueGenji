import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { toIso } from "@/lib/server/serialization";
import {
  PRIVACY_CHANGES,
  pendingPrivacyChanges,
  type PrivacyChange,
} from "@/lib/shared/privacy-changes";

/**
 * Lecture et écriture de l'acceptation des changements du traitement des
 * données (`lib/shared/privacy-changes.ts`).
 */

type PendingRow = RowDataPacket & { created_at: string | null; change_id: string | null };

/**
 * Les changements qu'un compte n'a pas encore acceptés.
 *
 * Une seule requête — la mise en page racine l'appelle à chaque page d'un
 * visiteur connecté : la date de création et les acceptations arrivent
 * ensemble par une jointure externe. Registre vide : aucune requête du tout.
 *
 * Un compte supprimé n'a rien à accepter (`is_deleted = 0`) : la session l'a
 * déjà écarté, la condition le redit pour qui appellerait sans elle.
 */
export async function loadPendingPrivacyChanges(userId: number): Promise<PrivacyChange[]> {
  if (PRIVACY_CHANGES.length === 0) return [];

  const db = await getDatabase();
  const [rows] = await db.execute<PendingRow[]>(
    `SELECT u.created_at, a.change_id
       FROM bg_users u
       LEFT JOIN bg_privacy_acknowledgments a ON a.user_id = u.id
      WHERE u.id = ? AND u.is_deleted = 0`,
    [userId],
  );
  if (rows.length === 0) return [];

  const acknowledged = rows.flatMap((row) => (row.change_id ? [row.change_id] : []));
  return pendingPrivacyChanges(rows[0].created_at ? String(rows[0].created_at) : null, acknowledged);
}

/**
 * Enregistre l'acceptation de changements **déjà validés** par
 * `checkPrivacyAcknowledgement`.
 *
 * `INSERT IGNORE` : accepter deux fois (deux onglets, double clic) n'est pas une
 * erreur, la première date fait foi. L'insertion passe par un `SELECT` sur la
 * ligne du compte vivant : une acceptation arrivée après la suppression du
 * compte ne se pose pas sur une ligne anonymisée.
 */
export async function acknowledgePrivacyChanges(userId: number, changeIds: readonly string[]): Promise<void> {
  if (changeIds.length === 0) return;
  const db = await getDatabase();
  const changes = changeIds.map(() => "SELECT ? AS change_id").join(" UNION ALL ");
  await db.execute(
    `INSERT IGNORE INTO bg_privacy_acknowledgments (user_id, change_id)
     SELECT u.id, c.change_id
       FROM bg_users u
       JOIN (${changes}) c
      WHERE u.id = ? AND u.is_deleted = 0`,
    [...changeIds, userId],
  );
}

/** Acceptations d'un compte, pour l'export RGPD — la date est la preuve du consentement. */
export async function listPrivacyAcknowledgments(
  userId: number,
): Promise<{ changeId: string; acceptedAt: string }[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { change_id: string; accepted_at: string })[]>(
    `SELECT change_id, accepted_at
       FROM bg_privacy_acknowledgments
      WHERE user_id = ?
      ORDER BY accepted_at, change_id`,
    [userId],
  );
  return rows.map((row) => ({ changeId: row.change_id, acceptedAt: toIso(row.accepted_at) ?? String(row.accepted_at) }));
}
