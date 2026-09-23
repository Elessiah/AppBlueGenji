import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { deleteOwnAccount } from "@/lib/server/users-service";
import {
  replayDecision,
  type AccountDeletionEntry,
  type ReplayDecision,
} from "@/lib/shared/account-deletion-journal";

export interface ReplayReport {
  replayed: number;
  absent: number;
  alreadyDeleted: number;
  otherAccount: number;
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
  const report: ReplayReport = { replayed: 0, absent: 0, alreadyDeleted: 0, otherAccount: 0, failed: 0 };
  const counters: Record<ReplayDecision, keyof ReplayReport> = {
    REPLAY: "replayed",
    ABSENT: "absent",
    ALREADY_DELETED: "alreadyDeleted",
    OTHER_ACCOUNT: "otherAccount",
  };

  // Séquentiel : chaque suppression prend le verrou de sa ligne et ouvre sa
  // transaction, rien ne presse, et l'ordre du journal est celui des faits.
  for (const entry of entries) {
    const [rows] = await db.execute<(RowDataPacket & { created_at: string; is_deleted: number })[]>(
      `SELECT created_at, is_deleted FROM bg_users WHERE id = ?`,
      [entry.userId],
    );
    const row = rows[0]
      ? { createdAt: String(rows[0].created_at), isDeleted: Boolean(rows[0].is_deleted) }
      : null;
    const decision = replayDecision(entry, row);

    if (decision !== "REPLAY") {
      report[counters[decision]] += 1;
      if (decision === "OTHER_ACCOUNT") {
        log(`  ≠ #${entry.userId} — identifiant réattribué à un autre compte, laissé intact`);
      }
      continue;
    }

    if (options.dryRun) {
      report.replayed += 1;
      log(`  · #${entry.userId} — serait supprimé (supprimé le ${entry.deletedAt})`);
      continue;
    }

    try {
      const plan = await deleteOwnAccount(entry.userId);
      report.replayed += 1;
      log(`  ✓ #${entry.userId} — ${plan.mode === "ERASE" ? "effacé" : "anonymisé"}`);
    } catch (error) {
      report.failed += 1;
      log(`  ✗ #${entry.userId} — échec : ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return report;
}
