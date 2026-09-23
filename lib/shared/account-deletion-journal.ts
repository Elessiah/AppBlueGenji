/**
 * Journal des suppressions de compte — la mémoire qu'une restauration n'efface pas.
 *
 * Une sauvegarde ne se corrige pas personne par personne : elle est chiffrée,
 * et c'est un instantané. Restaurer celle d'il y a dix jours ferait donc
 * **revenir** tous les comptes supprimés depuis — pseudo, identités de
 * connexion, tag Discord —, soit exactement ce qu'on avait promis d'effacer.
 * La règle admise est de rejouer ces suppressions avant de remettre le site en
 * service ; encore faut-il savoir lesquelles, et la base restaurée ne peut pas
 * le dire, puisqu'elle date d'avant.
 *
 * D'où ce journal, tenu **hors de la base** (un fichier, copié sur OneDrive par
 * la synchronisation horaire du bot) : une ligne par suppression, et rien qui
 * désigne une personne — un identifiant de ligne, la date de création du
 * compte, la date de la suppression. C'est le minimum pour rejouer, et rien de
 * plus : le journal n'est pas une archive des comptes partis.
 *
 * Module pur : lecture, écriture, élagage et décision de rejeu. Le fichier et
 * la base sont l'affaire de `lib/server/account-deletion-journal.ts`.
 */

/** Durée de conservation des sauvegardes chiffrées de la base (bot, `RETENTION_DAYS`). */
export const BACKUP_RETENTION_DAYS = 30;

/**
 * Durée de vie d'une ligne du journal.
 *
 * Une ligne ne sert qu'à rejouer une suppression sur une sauvegarde **plus
 * ancienne qu'elle** ; passé la rétention des sauvegardes, il n'en existe plus
 * aucune, et garder la ligne reviendrait à tenir la liste des comptes partis.
 * La marge couvre une restauration qui traînerait, et un réglage de rétention
 * relevé côté serveur sans qu'on y pense ici.
 */
export const ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS = BACKUP_RETENTION_DAYS * 2;

export interface AccountDeletionEntry {
  /** `bg_users.id` du compte supprimé. */
  userId: number;
  /**
   * `bg_users.created_at` tel que la base le rend (`AAAA-MM-JJ HH:MM:SS`).
   *
   * C'est ce qui rend le rejeu sûr : après une restauration, le compteur
   * d'identifiants repart de sa valeur ancienne, et un compte **neuf** peut
   * recevoir l'identifiant d'un compte supprimé entre-temps. Rejouer sur le
   * seul identifiant effacerait un innocent ; la date de création, elle, ne se
   * répète pas d'un compte à l'autre sur la même ligne.
   */
  accountCreatedAt: string;
  /** Instant de la suppression, ISO 8601. */
  deletedAt: string;
}

/** Une ligne JSON par suppression, terminée par un saut de ligne. */
export function formatJournalEntry(entry: AccountDeletionEntry): string {
  return `${JSON.stringify({
    userId: entry.userId,
    accountCreatedAt: entry.accountCreatedAt,
    deletedAt: entry.deletedAt,
  })}\n`;
}

function isEntry(value: unknown): value is AccountDeletionEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.userId === "number" &&
    Number.isInteger(v.userId) &&
    v.userId > 0 &&
    typeof v.accountCreatedAt === "string" &&
    v.accountCreatedAt.length > 0 &&
    typeof v.deletedAt === "string" &&
    Number.isFinite(Date.parse(v.deletedAt))
  );
}

export interface ParsedJournal {
  entries: AccountDeletionEntry[];
  /** Lignes non vides qu'on n'a pas su lire — à signaler, jamais à rejouer. */
  invalidLines: number;
}

/**
 * Lit le journal, en tolérant ce qu'une écriture interrompue laisse derrière
 * elle : une ligne tronquée est comptée et écartée, pas fatale — refuser tout le
 * fichier pour une ligne abîmée priverait le rejeu de toutes les autres.
 */
export function parseJournal(text: string): ParsedJournal {
  const entries: AccountDeletionEntry[] = [];
  let invalidLines = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isEntry(parsed)) {
        entries.push({
          userId: parsed.userId,
          accountCreatedAt: parsed.accountCreatedAt,
          deletedAt: parsed.deletedAt,
        });
      } else {
        invalidLines += 1;
      }
    } catch {
      invalidLines += 1;
    }
  }
  return { entries, invalidLines };
}

/**
 * Élague et dédoublonne.
 *
 * Une même suppression peut s'écrire deux fois — le rejeu repasse par
 * `deleteOwnAccount`, qui journalise comme d'habitude. La clé est le couple
 * (identifiant, date de création), et la première date de suppression l'emporte :
 * c'est elle qui situe le compte par rapport aux sauvegardes.
 */
export function pruneJournal(
  entries: readonly AccountDeletionEntry[],
  now: Date,
  retentionDays: number = ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS,
): AccountDeletionEntry[] {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const byKey = new Map<string, AccountDeletionEntry>();
  for (const entry of entries) {
    const at = Date.parse(entry.deletedAt);
    if (!Number.isFinite(at) || at < cutoff) continue;
    const key = `${entry.userId}|${entry.accountCreatedAt}`;
    const known = byKey.get(key);
    if (!known || at < Date.parse(known.deletedAt)) byKey.set(key, entry);
  }
  return [...byKey.values()].sort(
    (a, b) => Date.parse(a.deletedAt) - Date.parse(b.deletedAt) || a.userId - b.userId,
  );
}

/** L'état d'un compte dans la base restaurée, ou `null` s'il n'y figure pas. */
export interface RestoredAccountRow {
  createdAt: string;
  isDeleted: boolean;
}

export type ReplayDecision =
  /** La base restaurée ne connaît pas ce compte (sauvegarde postérieure à son effacement). */
  | "ABSENT"
  /** Déjà anonymisé dans la base restaurée : rien à refaire. */
  | "ALREADY_DELETED"
  /** L'identifiant désigne un **autre** compte que celui qui a été supprimé. */
  | "OTHER_ACCOUNT"
  /** Le compte est revenu avec la sauvegarde : la suppression doit être rejouée. */
  | "REPLAY";

/**
 * Faut-il rejouer cette suppression sur la base restaurée ?
 *
 * Le mode (effacement ou anonymisation) n'est **pas** dans le journal, à
 * dessein : il se décide sur les traces que porte la base restaurée, qui ne
 * sont pas celles du jour de la suppression. Rejouer, c'est reposer la question
 * à `deleteOwnAccount`, pas recopier sa réponse d'alors.
 */
export function replayDecision(
  entry: AccountDeletionEntry,
  row: RestoredAccountRow | null,
): ReplayDecision {
  if (!row) return "ABSENT";
  if (row.createdAt !== entry.accountCreatedAt) return "OTHER_ACCOUNT";
  if (row.isDeleted) return "ALREADY_DELETED";
  return "REPLAY";
}
