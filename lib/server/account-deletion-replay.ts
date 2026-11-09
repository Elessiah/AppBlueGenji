import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { deleteOwnAccount, finalizeAccountDeletion } from "@/lib/server/users/account-deletion";
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
  /** Réactivations non rejouées : une demande postérieure tient, relue sous verrou. */
  superseded: number;
  /** Demandes en attente déjà à la bonne date (ou plus récente) : rien à redater. */
  alreadyPending: number;
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
    superseded: 0,
    alreadyPending: 0,
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
  // Au plus : le vrai rejeu relit l'état sous verrou et peut finir « déjà
  // réactivé » ou « demande postérieure ».
  report.reactivated += 1;
  log(`  · #${entry.userId} — réactivé le ${entry.deletedAt}, à réactiver (au plus, selon l'état relu sous verrou)`);
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
 * qui garde la plus récente (`pruneJournal`). Seulement **vers l'avant** : une
 * ligne plus ancienne que la demande restaurée (journal en échec entre-temps)
 * abrégerait sa fenêtre. Comparée à la seconde (`DATETIME(0)`). Fenêtre du
 * journal déjà close : la suppression définitive suit aussitôt, comme au chemin
 * `REPLAY`, sans attendre la passe horaire.
 */
async function handleRedate(
  db: Awaited<ReturnType<typeof getDatabase>>,
  entry: AccountDeletionEntry,
  report: ReplayReport,
  log: (line: string) => void,
  dryRun: boolean,
): Promise<void> {
  const requestedAt = toWholeSecond(new Date(entry.deletedAt));
  const windowOpen = isReactivationWindowOpen(entry.deletedAt);
  if (dryRun) {
    report.replayed += 1;
    log(
      windowOpen
        ? `  · #${entry.userId} — demande de suppression à redater au ${entry.deletedAt} (si plus récente)`
        : `  · #${entry.userId} — serait supprimé (demande du ${entry.deletedAt}, fenêtre close)`,
    );
    return;
  }
  try {
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE bg_users SET deletion_requested_at = ?
        WHERE id = ? AND created_at = ? AND is_deleted = 1
          AND deletion_requested_at IS NOT NULL AND deletion_requested_at < ?`,
      [requestedAt, entry.userId, entry.accountCreatedAt, requestedAt],
    );
    const redated = Number(result.affectedRows) === 1;
    if (!windowOpen) {
      const plan = await finalizeAccountDeletion(entry.userId);
      if (plan) {
        report.replayed += 1;
        log(`  ✓ #${entry.userId} — ${plan.mode === "ERASE" ? "effacé" : "anonymisé"} (fenêtre close)`);
        return;
      }
    }
    if (redated) {
      report.replayed += 1;
      log(`  ✓ #${entry.userId} — demande de suppression redatée`);
    } else {
      report.alreadyPending += 1;
    }
  } catch (error) {
    report.failed += 1;
    log(`  ✗ #${entry.userId} — échec : ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** La date sans ses millisecondes : `deletion_requested_at` est un `DATETIME(0)`. */
function toWholeSecond(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

/** Rejoue une réactivation (décision R1), et la compte. */
async function replayReactivation(
  entry: AccountDeletionEntry,
  report: ReplayReport,
  log: (line: string) => void,
): Promise<void> {
  try {
    const outcome = await replayAccountReactivation(entry);
    if (outcome === "REACTIVATED") {
      report.reactivated += 1;
      log(`  ✓ #${entry.userId} — réactivé`);
    } else if (outcome === "ALREADY_ACTIVE") {
      report.alreadyActive += 1;
    } else {
      report.superseded += 1;
      log(`  = #${entry.userId} — demande postérieure à la réactivation, laissée en place`);
    }
  } catch (error) {
    report.failed += 1;
    log(`  ✗ #${entry.userId} — échec : ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Passe par la demande un compte restauré **vivant** (sauvegarde antérieure à
 * sa demande) dont la fenêtre de trente jours est close, avant son effacement.
 * Un compte déjà en attente ou supprimé (`USER_NOT_FOUND`) n'a rien à refaire.
 */
async function requestRestoredLiveAccount(entry: AccountDeletionEntry): Promise<void> {
  try {
    await requestAccountDeletion(entry.userId, { requestedAt: new Date(entry.deletedAt) });
  } catch (error) {
    if (error instanceof Error && error.message === "USER_NOT_FOUND") return;
    throw error;
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
    // Revenu vivant avec la sauvegarde (antérieure à la demande), le compte
    // passe d'abord par la demande — quitter ses équipes, céder ses tournois,
    // retirer casts, invitations et inscriptions —, comme l'annoncent /rgpd et
    // le registre (T01) : effacé directement, il laisserait un propriétaire
    // anonyme à ses équipes.
    await requestRestoredLiveAccount(entry);
    const plan = await deleteOwnAccount(entry.userId);
    report.replayed += 1;
    log(`  ✓ #${entry.userId} — ${plan.mode === "ERASE" ? "effacé" : "anonymisé"}`);
  } catch (error) {
    report.failed += 1;
    log(`  ✗ #${entry.userId} — échec : ${error instanceof Error ? error.message : String(error)}`);
  }
}
