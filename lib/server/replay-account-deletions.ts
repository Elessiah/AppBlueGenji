import "./script-env";
import { replayAccountDeletions } from "./account-deletion-replay";
import { accountDeletionJournalPath, readAccountDeletionJournal } from "./account-deletion-journal";

/**
 * Après la restauration d'une sauvegarde de la base, rejoue les suppressions de
 * compte intervenues depuis — **avant** de remettre le site en service.
 *
 *     npm run replay:deletions -- --dry-run            # ce qui serait fait
 *     npm run replay:deletions                          # journal du site
 *     npm run replay:deletions -- /chemin/journal.jsonl # journal récupéré sur OneDrive
 *
 * Le journal par défaut est celui du site (`ACCOUNT_DELETION_JOURNAL_PATH`,
 * sinon `data/account-deletions.jsonl`). Si la machine elle-même a été perdue,
 * sa copie se récupère sur OneDrive — voir `docs/features/BACKUP_DATA_PROTECTION.md`.
 *
 * Fait pour tourner **en production**, d'où `./script-env` (voir
 * `backfill-avatars.ts`).
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const filePath = args.find((arg) => !arg.startsWith("--")) ?? accountDeletionJournalPath();

  try {
    const { entries, invalidLines } = await readAccountDeletionJournal(filePath);
    console.log(`Journal : ${filePath}`);
    console.log(`${entries.length} suppression(s) consignée(s)${dryRun ? " — simulation, rien n'est écrit" : ""}.\n`);
    if (invalidLines > 0) {
      console.warn(`⚠ ${invalidLines} ligne(s) illisible(s) écartée(s).\n`);
    }

    const report = await replayAccountDeletions(entries, { dryRun });

    console.log(
      `\n${dryRun ? "À rejouer" : "Rejouées"} : ${report.replayed} · absentes de la base : ${report.absent}` +
        ` · déjà supprimées : ${report.alreadyDeleted} · identifiant réattribué : ${report.otherAccount}` +
        ` · échecs : ${report.failed}`,
    );
    process.exit(report.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error("Rejeu impossible :", error);
    process.exit(1);
  }
}

void main();
