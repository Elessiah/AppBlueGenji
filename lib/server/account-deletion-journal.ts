import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import {
  formatJournalEntry,
  parseJournal,
  pruneJournal,
  type AccountDeletionEntry,
} from "@/lib/shared/account-deletion-journal";

/**
 * Le fichier du journal des suppressions (`lib/shared/account-deletion-journal.ts`).
 *
 * Hors de `public/` : tout ce qui vit sous `public/uploads` est servi par
 * `/api/uploads/...`, et ce journal ne doit l'être à personne. Le dossier
 * `data/` est ignoré par git.
 */
export function accountDeletionJournalPath(): string {
  const configured = process.env.ACCOUNT_DELETION_JOURNAL_PATH?.trim();
  return configured || path.join(process.cwd(), "data", "account-deletions.jsonl");
}

/** Lit le journal ; un fichier absent est un journal vide, pas une erreur. */
export async function readAccountDeletionJournal(
  filePath: string = accountDeletionJournalPath(),
): Promise<ReturnType<typeof parseJournal>> {
  try {
    return parseJournal(await readFile(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { entries: [], invalidLines: 0 };
    throw error;
  }
}

// Les écritures d'un même processus passent l'une après l'autre : chacune relit
// puis réécrit le fichier entier, et deux suppressions simultanées perdraient
// sinon l'une des deux lignes. Le site tourne en un seul processus (pm2, mode
// fork — `docs/DEPLOYMENT.md`).
let queue: Promise<void> = Promise.resolve();

async function writeEntry(entry: AccountDeletionEntry, filePath: string, now: Date): Promise<void> {
  const current = await readAccountDeletionJournal(filePath);
  const kept = pruneJournal([...current.entries, entry], now);
  await mkdir(path.dirname(filePath), { recursive: true });
  // Écrit à côté puis renommé : la synchronisation horaire du bot copie le
  // fichier sans prévenir, et un renommage est la seule écriture qu'elle ne
  // puisse pas surprendre à moitié.
  const temp = `${filePath}.${process.pid}.tmp`;
  await writeFile(temp, kept.map(formatJournalEntry).join(""), { encoding: "utf8", mode: 0o600 });
  await rename(temp, filePath);
}

/**
 * Consigne une suppression **déjà commitée**, et ne lève jamais.
 *
 * Après le commit et pas avant : une ligne écrite pour une suppression annulée
 * ferait effacer, à la prochaine restauration, un compte que personne n'a
 * demandé à supprimer — l'erreur inverse de celle qu'on corrige, et pire. Un
 * échec d'écriture est journalisé en erreur et avalé : la suppression a eu
 * lieu, l'annoncer ratée au joueur serait faux ; le prix est qu'une
 * restauration d'une sauvegarde antérieure ne la rejouerait pas, d'où un
 * message qui le dit.
 */
export function recordAccountDeletion(
  entry: AccountDeletionEntry,
  options: { filePath?: string; now?: Date } = {},
): Promise<void> {
  const filePath = options.filePath ?? accountDeletionJournalPath();
  const now = options.now ?? new Date();
  const run = queue.then(() => writeEntry(entry, filePath, now));
  queue = run.catch(() => {});
  return run.catch((error: unknown) => {
    console.error(
      `[account-deletion-journal] suppression du compte #${entry.userId} non consignée (${filePath}) — ` +
        "elle ne serait pas rejouée après restauration d'une sauvegarde antérieure :",
      error,
    );
  });
}
