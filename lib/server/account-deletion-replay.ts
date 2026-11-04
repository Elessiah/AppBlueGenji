import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { deleteOwnAccount } from "@/lib/server/users/account-deletion";
import { requestAccountDeletion } from "@/lib/server/users/account-deletion-request";
import { replayAccountReactivation } from "@/lib/server/users/account-reactivation";
import { isReactivationWindowOpen } from "@/lib/shared/account-deletion";
import {
  replayDecision,
  type AccountDeletionEntry,
  type ReplayDecision,
  type RestoredAccountRow,
} from "@/lib/shared/account-deletion-journal";

export interface ReplayReport {
  replayed: number;
  absent: number;
  alreadyDeleted: number;
  otherAccount: number;
  /** Comptes réactivés depuis la sauvegarde, revenus en attente avec elle, réactivés de nouveau. */
  reactivated: number;
  /** Comptes réactivés depuis la sauvegarde et déjà vivants dans la base restaurée. */
  alreadyActive: number;
  failed: number;
}

/**
 * Rejoue sur la base **restaurée** les suppressions consignées au journal.
 *
 * Chaque suppression repasse par `deleteOwnAccount`, le chemin ordinaire : le
 * mode (effacement ou anonymisation) se redécide sur les traces de la base
 * restaurée, avatar et identités partent comme au premier jour. Sans danger à
 * relancer — un compte déjà supprimé est reconnu et laissé tel quel, et un
 * identifiant réattribué à un autre compte depuis la restauration n'est jamais
 * touché (`replayDecision`).
 *
 * `dryRun` n'écrit rien et dit ce qui serait fait : c'est la première commande
 * à lancer après une restauration.
 */
export async function replayAccountDeletions(
  entries: readonly AccountDeletionEntry[],
  options: { dryRun?: boolean; log?: (line: string) => void } = {},
): Promise<ReplayReport> {
  const log = options.log ?? ((line: string) => console.log(line));
  const db = await getDatabase();
  const report: ReplayReport = {
    replayed: 0,
    absent: 0,
    alreadyDeleted: 0,
    otherAccount: 0,
    reactivated: 0,
    alreadyActive: 0,
    failed: 0,
  };
  const counters: Record<ReplayDecision, keyof ReplayReport> = {
    REPLAY: "replayed",
    ABSENT: "absent",
    ALREADY_DELETED: "alreadyDeleted",
    OTHER_ACCOUNT: "otherAccount",
    REACTIVATE: "reactivated",
    ALREADY_ACTIVE: "alreadyActive",
    REDATE: "replayed",
  };

  // Séquentiel : chaque suppression prend le verrou de sa ligne et ouvre sa
  // transaction, rien ne presse, et l'ordre du journal est celui des faits.
  for (const entry of entries) {
    const decision = replayDecision(entry, await readRestoredRow(db, entry.userId));

    if (await handleStateDecision(db, decision, entry, report, log, options.dryRun === true)) continue;

    if (decision !== "REPLAY") {
      report[counters[decision]] += 1;
      if (decision === "OTHER_ACCOUNT") {
        log(`  ≠ #${entry.userId} — identifiant réattribué à un autre compte, laissé intact`);
      }
      continue;
    }

    if (options.dryRun) {
      report.replayed += 1;
      log(
        entry.pending && isReactivationWindowOpen(entry.deletedAt)
          ? `  · #${entry.userId} — demande de suppression du ${entry.deletedAt} à rejouer`
          : `  · #${entry.userId} — serait supprimé (supprimé le ${entry.deletedAt})`,
      );
      continue;
    }

    await replayDeletion(entry, report, log);
  }

  return report;
}

/** L'état du compte dans la base restaurée, ou `null` s'il n'y figure pas. */
async function readRestoredRow(
  db: Awaited<ReturnType<typeof getDatabase>>,
  userId: number,
): Promise<RestoredAccountRow | null> {
  const [rows] = await db.execute<(RowDataPacket & {
    created_at: string;
    is_deleted: number;
    deletion_requested_at: string | Date | null;
  })[]>(`SELECT created_at, is_deleted, deletion_requested_at FROM bg_users WHERE id = ?`, [userId]);
  const row = rows[0];
  if (!row) return null;
  const isDeleted = Boolean(row.is_deleted);
  return {
    createdAt: String(row.created_at),
    isDeleted,
    pendingDeletion: isDeleted && row.deletion_requested_at !== null,
    deletionRequestedAt: row.deletion_requested_at === null ? null : String(row.deletion_requested_at),
  };
}

/** Réactivation à rejouer : dite en simulation, rejouée sinon. */
async function handleReactivation(
  entry: AccountDeletionEntry,
  report: ReplayReport,
  log: (line: string) => void,
  dryRun: boolean,
): Promise<void> {
  if (!dryRun) {
    await replayReactivation(entry, report, log);
    return;
  }
  report.reactivated += 1;
  log(`  · #${entry.userId} — réactivé le ${entry.deletedAt}, à réactiver`);
}

/** Réactivation ou demande à redater : traitée ici (`true`), sinon laissée au rejeu ordinaire. */
async function handleStateDecision(
  db: Awaited<ReturnType<typeof getDatabase>>,
  decision: ReplayDecision,
  entry: AccountDeletionEntry,
  report: ReplayReport,
  log: (line: string) => void,
  dryRun: boolean,
): Promise<boolean> {
  if (decision === "REACTIVATE") {
    await handleReactivation(entry, report, log, dryRun);
    return true;
  }
  if (decision === "REDATE") {
    await handleRedate(db, entry, report, log, dryRun);
    return true;
  }
  return false;
}

/**
 * Demande en attente revenue en attente : sa date reprend celle du journal,
 * qui garde la plus récente (`pruneJournal`). Rien à faire si elle y est déjà.
 */
async function handleRedate(
  db: Awaited<ReturnType<typeof getDatabase>>,
  entry: AccountDeletionEntry,
  report: ReplayReport,
  log: (line: string) => void,
  dryRun: boolean,
): Promise<void> {
  const requestedAt = new Date(entry.deletedAt);
  if (dryRun) {
    report.replayed += 1;
    log(`  · #${entry.userId} — demande de suppression à redater au ${entry.deletedAt}`);
    return;
  }
  try {
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE bg_users SET deletion_requested_at = ?
        WHERE id = ? AND created_at = ? AND is_deleted = 1
          AND deletion_requested_at IS NOT NULL AND deletion_requested_at <> ?`,
      [requestedAt, entry.userId, entry.accountCreatedAt, requestedAt],
    );
    if (Number(result.affectedRows) === 1) {
      report.replayed += 1;
      log(`  ✓ #${entry.userId} — demande de suppression redatée`);
    } else {
      report.alreadyDeleted += 1;
    }
  } catch (error) {
    report.failed += 1;
    log(`  ✗ #${entry.userId} — échec : ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Rejoue une réactivation (décision R1), et la compte. */
async function replayReactivation(
  entry: AccountDeletionEntry,
  report: ReplayReport,
  log: (line: string) => void,
): Promise<void> {
  try {
    if (await replayAccountReactivation(entry)) {
      report.reactivated += 1;
      log(`  ✓ #${entry.userId} — réactivé`);
    } else {
      report.alreadyActive += 1;
    }
  } catch (error) {
    report.failed += 1;
    log(`  ✗ #${entry.userId} — échec : ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Rejoue une suppression par le chemin ordinaire, et la compte. */
async function replayDeletion(
  entry: AccountDeletionEntry,
  report: ReplayReport,
  log: (line: string) => void,
): Promise<void> {
  try {
    // Une demande en attente revenue vivante avec la sauvegarde est rejouée
    // comme une demande (anonyme dès ce moment, trente jours comptés depuis la
    // date d'origine) ; sa fenêtre déjà close, la suppression devient définitive.
    if (entry.pending && isReactivationWindowOpen(entry.deletedAt)) {
      await requestAccountDeletion(entry.userId, { requestedAt: new Date(entry.deletedAt) });
      report.replayed += 1;
      log(`  ✓ #${entry.userId} — demande de suppression rejouée`);
      return;
    }
    const plan = await deleteOwnAccount(entry.userId);
    report.replayed += 1;
    log(`  ✓ #${entry.userId} — ${plan.mode === "ERASE" ? "effacé" : "anonymisé"}`);
  } catch (error) {
    report.failed += 1;
    log(`  ✗ #${entry.userId} — échec : ${error instanceof Error ? error.message : String(error)}`);
  }
}
