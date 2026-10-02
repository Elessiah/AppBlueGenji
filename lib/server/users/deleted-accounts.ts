import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { accountDeletionPlan } from "@/lib/shared/account-deletion";
import { isLegacyDeletedPseudo } from "@/lib/shared/anonymous-pseudos";
import { accountTraceSql, loadAccountTrace } from "./account-deletion";
import { anonymizeAccount, eraseAccount } from "./account-erasure";

/** Ce que le rattrapage des comptes supprimés a fait. */
export type DeletedAccountsReconciliation = {
  /** Comptes supprimés sans match joué, effacés entièrement. */
  erased: number;
  /** Comptes renommés sous un pseudo d'emprunt (ancienne règle `compte_supprime_<id>`). */
  renamed: number;
  /** Comptes laissés en l'état faute d'avoir pu être traités (reportés au prochain démarrage). */
  failed: number;
};

/**
 * Applique la règle de suppression **en vigueur** aux comptes déjà supprimés.
 *
 * La règle a changé deux fois sous des comptes qui l'avaient déjà subie : un
 * compte n'est plus conservé que s'il a **joué** (il suffisait d'avoir été au
 * roster d'une équipe engagée), et le compte conservé porte un **pseudo
 * d'emprunt** (il s'appelait `compte_supprime_<id>`, et gardait ses rôles de
 * plateforme). Une suppression ne se rejoue pas à la demande du joueur — il est
 * parti —, d'où ce rattrapage, lancé une fois par processus après les
 * migrations (`getDatabase`).
 *
 * Il ne fait rien dans le cas nominal : une suppression faite sous la règle
 * actuelle ne laisse ni compte effaçable ni ancien pseudo. D'où **une seule
 * lecture** pour repérer les comptes à traiter — les mêmes questions que la
 * suppression (`accountTraceSql`), posées à tous les comptes supprimés d'un
 * coup —, sans quoi chaque démarrage de chaque processus verrouillerait et
 * relirait un à un des comptes qu'il n'y a plus à toucher. Chaque compte repéré est
 * traité dans **sa** transaction, sous le verrou de sa ligne et après relecture
 * de `is_deleted` — deux processus qui démarrent ensemble ne se marchent pas
 * dessus —, et l'échec de l'un n'empêche pas les autres.
 *
 * Aucune ligne au journal des suppressions (`account-deletion-journal`) : ces
 * comptes y figurent depuis leur suppression, et le rejeu après restauration
 * redécide déjà le mode sur la base restaurée, avec la règle du jour.
 */
export async function reconcileDeletedAccounts(): Promise<DeletedAccountsReconciliation> {
  const db = await getDatabase();
  const trace = accountTraceSql();
  const [candidates] = await db.execute<(RowDataPacket & { id: number })[]>(
    String.raw`SELECT u.id
       FROM bg_users u
      WHERE u.is_deleted = 1
        AND (
          u.pseudo LIKE 'compte\_supprime\_%'
          OR u.is_admin = 1
          OR u.platform_roles_json IS NOT NULL
          OR NOT (${trace.played} OR ${trace.soloRegistered} OR ${trace.organized} OR ${trace.owned})
        )
      ORDER BY u.id`,
  );
  const outcome: DeletedAccountsReconciliation = { erased: 0, renamed: 0, failed: 0 };

  // L'anonymisation efface désormais la dernière acceptation des conditions
  // d'utilisation ; les comptes anonymisés avant la règle la gardent encore.
  // Une instruction idempotente et non un nouveau passage d'`anonymizeAccount`,
  // qui leur tirerait un autre pseudo d'emprunt — le seul nom sous lequel
  // leurs anciens adversaires les retrouvent. Un échec ne bloque pas le reste.
  try {
    await db.execute(
      `UPDATE bg_users
          SET terms_version = NULL, terms_accepted_at = NULL
        WHERE is_deleted = 1
          AND (terms_version IS NOT NULL OR terms_accepted_at IS NOT NULL)`,
    );
  } catch (error) {
    console.error(
      "[deleted-accounts] Effacement des acceptations des conditions reporté au prochain démarrage :",
      error instanceof Error ? error.message : error,
    );
  }

  for (const candidate of candidates) {
    const userId = Number(candidate.id);
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [locked] = await connection.execute<(RowDataPacket & {
        pseudo: string;
        is_deleted: 0 | 1;
        is_admin: 0 | 1;
        platform_roles_json: unknown;
      })[]>(
        `SELECT pseudo, is_deleted, is_admin, platform_roles_json
           FROM bg_users WHERE id = ? FOR UPDATE`,
        [userId],
      );
      const row = locked[0];
      if (!row || Number(row.is_deleted) !== 1) {
        await connection.rollback();
        continue;
      }
      const plan = accountDeletionPlan(await loadAccountTrace(connection, userId));
      if (plan.mode === "ERASE") {
        await eraseAccount(connection, userId);
        outcome.erased += 1;
      } else if (
        isLegacyDeletedPseudo(row.pseudo)
        || Number(row.is_admin) === 1
        || row.platform_roles_json !== null
      ) {
        await anonymizeAccount(connection, userId);
        outcome.renamed += 1;
      }
      await connection.commit();
    } catch (error) {
      // Sur une connexion morte — la panne même qu'on traite —, l'annulation
      // lève à son tour : sans garde, elle sortirait de la boucle et laisserait
      // tous les comptes suivants au prochain démarrage.
      await connection.rollback().catch(() => {});
      outcome.failed += 1;
      console.error(
        `[deleted-accounts] Rattrapage du compte #${userId} reporté au prochain démarrage :`,
        error instanceof Error ? error.message : error,
      );
    } finally {
      connection.release();
    }
  }

  return outcome;
}
