import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { accountDeletionPlan } from "@/lib/shared/account-deletion";
import { isLegacyDeletedPseudo } from "@/lib/shared/anonymous-pseudos";
import { ACCOUNT_REACTIVATION_DAYS } from "@/lib/shared/account-deletion";
import { accountTraceSql, afterCommit, finalizeAccountDeletion, loadAccountTrace } from "./account-deletion";
import { settleDeletedSoloEntries } from "./deleted-solo-entries";
import { anonymizeAccount, eraseAccount } from "./account-erasure";
import { invalidateTeamIdentityViews } from "@/lib/server/ranking-cache";
import { publishMatchUpdatedEvent } from "@/lib/server/tournaments/notifications";

/** Ce que le rattrapage des comptes supprimés a fait. */
export type DeletedAccountsReconciliation = {
  /** Comptes supprimés sans match joué, effacés entièrement. */
  erased: number;
  /** Comptes renommés sous un pseudo d'emprunt (ancienne règle `compte_supprime_<id>`). */
  renamed: number;
  /** Comptes laissés en l'état faute d'avoir pu être traités (reportés au prochain démarrage). */
  failed: number;
  /** Inscriptions solo retirées et tournois forfaités (E2, `settleDeletedSoloEntries`). */
  withdrawn: number;
  forfeited: number;
};

/**
 * Applique à un compte supprimé, verrouillé, la règle d'aujourd'hui : effacé
 * s'il n'a rien laissé, sinon anonymisé s'il porte encore l'ancien pseudo ou
 * des droits. Rend le geste fait — compté par l'appelant **après** le commit,
 * un commit en échec ne comptant pas deux fois — et les tournois dont un match
 * le nommait, à prévenir après le commit.
 */
async function settleDeletedAccount(
  connection: PoolConnection,
  userId: number,
  row: { pseudo: string; is_admin: 0 | 1; platform_roles_json: unknown },
): Promise<{ gesture: "erased" | "renamed" | null; tournamentIds: number[] }> {
  const plan = accountDeletionPlan(await loadAccountTrace(connection, userId));
  if (plan.mode === "ERASE") {
    const { tournamentIds } = await eraseAccount(connection, userId);
    return { gesture: "erased", tournamentIds };
  }
  if (isLegacyDeletedPseudo(row.pseudo) || Number(row.is_admin) === 1 || row.platform_roles_json !== null) {
    const { tournamentIds } = await anonymizeAccount(connection, userId);
    return { gesture: "renamed", tournamentIds };
  }
  return { gesture: null, tournamentIds: [] };
}


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
  // E2 d'abord : une inscription solo retirée peut rendre le compte effaçable
  // au passage suivant de la boucle. Comptes en attente compris — la demande
  // fait le même geste, ceci n'en rattrape qu'un échec.
  const solo = await settleDeletedSoloEntries().catch((error: unknown) => {
    console.error(
      "[deleted-accounts] Inscriptions solo des comptes supprimés reportées :",
      error instanceof Error ? error.message : error,
    );
    return { withdrawn: 0, forfeited: 0 };
  });
  const trace = accountTraceSql();
  const [candidates] = await db.execute<(RowDataPacket & { id: number })[]>(
    String.raw`SELECT u.id
       FROM bg_users u
      WHERE u.is_deleted = 1
        AND u.deletion_requested_at IS NULL
        AND (
          u.pseudo LIKE 'compte\_supprime\_%'
          OR u.is_admin = 1
          OR u.platform_roles_json IS NOT NULL
          OR NOT (${trace.played} OR ${trace.soloRegistered} OR ${trace.organized} OR ${trace.owned})
        )
      ORDER BY u.id`,
  );
  const outcome: DeletedAccountsReconciliation = { erased: 0, renamed: 0, failed: 0, ...solo };
  const touchedTournaments = new Set<number>();

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
          AND deletion_requested_at IS NULL
          AND (terms_version IS NOT NULL OR terms_accepted_at IS NOT NULL)`,
    );
  } catch (error) {
    console.error(
      "[deleted-accounts] Effacement des acceptations des conditions reporté au prochain démarrage :",
      error instanceof Error ? error.message : error,
    );
  }

  for (const candidate of candidates) {
    await reconcileOneAccount(db, Number(candidate.id), outcome, touchedTournaments);
  }

  // Même raison que la suppression elle-même (`deleteOwnAccount`) : les vues
  // de l'accueil qui nomment une entrée solo ne gardent pas l'ancien pseudo.
  if (outcome.erased + outcome.renamed > 0) invalidateTeamIdentityViews();
  // Et les matchs qui le nommaient (caster, lien, arbitre), comme `deleteOwnAccount`.
  // Un écouteur qui lève ne transforme pas un rattrapage fait en échec.
  for (const tournamentId of touchedTournaments) {
    afterCommit(() => publishMatchUpdatedEvent(tournamentId, { landingLive: true }), `Tournoi #${tournamentId} non prévenu`);
  }
  return outcome;
}

/**
 * Un compte repéré, dans **sa** transaction : relu sous le verrou de sa
 * ligne, réglé, puis compté une fois commité. Ne lève jamais : l'échec de l'un
 * n'empêche pas les autres (compté dans `failed`).
 */
async function reconcileOneAccount(
  db: Awaited<ReturnType<typeof getDatabase>>,
  userId: number,
  outcome: DeletedAccountsReconciliation,
  touchedTournaments: Set<number>,
): Promise<void> {
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
      return;
    }
    const { gesture, tournamentIds } = await settleDeletedAccount(connection, userId, row);
    await connection.commit();
    if (gesture) outcome[gesture] += 1;
    for (const tournamentId of tournamentIds) touchedTournaments.add(tournamentId);
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

/** Les comptes dont la finalisation a échoué, et quand : écartés de la file un temps. */
const failedFinalizations = new Map<number, number>();
const FAILED_FINALIZATION_BACKOFF_MS = 6 * 60 * 60 * 1000;

/**
 * Les suppressions demandées il y a trente jours ou plus, rendues définitives
 * (E4) — effacement ou anonymisation, par le chemin ordinaire
 * (`finalizeAccountDeletion`, qui relit la fenêtre sous le verrou du compte).
 * Idempotent : un compte réactivé ou déjà traité n'est plus en attente.
 * Rend le nombre de comptes traités ; un échec est reporté au passage suivant.
 */
export async function finalizeDueAccountDeletions(): Promise<{ finalized: number; failed: number }> {
  const db = await getDatabase();
  // Un compte qui échoue ne quitte pas la file : sans mise à l'écart, cent
  // échecs durables occuperaient chaque heure les cent premières places et
  // les comptes suivants ne seraient jamais finalisés. Écarté pour
  // `FAILED_FINALIZATION_BACKOFF_MS`, il repasse ensuite (par processus).
  const now = Date.now();
  for (const [id, failedAt] of failedFinalizations) {
    if (now - failedAt >= FAILED_FINALIZATION_BACKOFF_MS) failedFinalizations.delete(id);
  }
  const skipped = [...failedFinalizations.keys()];
  const [due] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users
      WHERE is_deleted = 1
        AND deletion_requested_at IS NOT NULL
        AND deletion_requested_at <= NOW() - INTERVAL ${Number(ACCOUNT_REACTIVATION_DAYS)} DAY
        ${skipped.length > 0 ? `AND id NOT IN (${skipped.map(() => "?").join(", ")})` : ""}
      ORDER BY id
      LIMIT 100`,
    skipped,
  );
  const outcome = { finalized: 0, failed: 0 };
  for (const row of due) {
    try {
      if ((await finalizeAccountDeletion(Number(row.id))) !== null) outcome.finalized += 1;
    } catch (error) {
      outcome.failed += 1;
      failedFinalizations.set(Number(row.id), Date.now());
      console.error(
        `[deleted-accounts] Suppression définitive du compte #${Number(row.id)} reportée :`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return outcome;
}
