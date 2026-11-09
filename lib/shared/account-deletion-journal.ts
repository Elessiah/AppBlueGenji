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
 * D'où ce journal, tenu **hors de la base** (un fichier, copié, chiffré, sur le stockage distant par
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
  /**
   * Instant de la suppression, ISO 8601 (d'une demande en attente : celui de la
   * demande ; d'une réactivation : celui de la réactivation).
   */
  deletedAt: string;
  /**
   * Demande **en attente** (fenêtre de réactivation de trente jours) : écrite à
   * la demande, remplacée par la ligne de réactivation, rendue caduque par la
   * ligne de la suppression définitive. Absent = suppression définitive.
   */
  pending?: boolean;
  /**
   * **Réactivation** d'une demande (décision R1 du 2026-11-04) : remplace la
   * ligne en attente, pour qu'une sauvegarde prise pendant les trente jours,
   * restaurée, ne ramène pas le compte en attente de suppression — le rejeu le
   * réactive. Exclusif de `pending`.
   */
  reactivated?: boolean;
  /**
   * D'une réactivation : `deletion_requested_at` de la demande défaite, **tel
   * que la base le rend** (`AAAA-MM-JJ HH:MM:SS`). Le rejeu le compare, texte à
   * texte, à celui de la base restaurée — sans conversion de fuseau ni perte à
   * la seconde : seule une demande égale ou antérieure est défaite.
   */
  undoneRequestAt?: string;
}

/** Ligne qui n'est ni une demande en attente ni une réactivation : une suppression définitive. */
function isFinalEntry(entry: AccountDeletionEntry): boolean {
  return entry.pending !== true && entry.reactivated !== true;
}

/**
 * Une ligne JSON par suppression, terminée par un saut de ligne.
 *
 * Une réactivation s'écrit **sans** `deletedAt`, sous `reactivatedAt` : une
 * version antérieure du site (retour arrière, vieux rejeu) exige `deletedAt` et
 * écarte donc la ligne comme illisible, au lieu de la lire comme une
 * suppression définitive et d'effacer un compte réactivé.
 */
export function formatJournalEntry(entry: AccountDeletionEntry): string {
  const line =
    entry.reactivated && !entry.pending
      ? {
          userId: entry.userId,
          accountCreatedAt: entry.accountCreatedAt,
          reactivatedAt: entry.deletedAt,
          undoneRequestAt: entry.undoneRequestAt,
        }
      : {
          userId: entry.userId,
          accountCreatedAt: entry.accountCreatedAt,
          deletedAt: entry.deletedAt,
          ...(entry.pending ? { pending: true } : {}),
        };
  return `${JSON.stringify(line)}\n`;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/**
 * Une date telle que MariaDB la rend (`dateStrings`, `DATETIME(0)`) : seule
 * forme que `undoneRequestAt` peut prendre, comparée ensuite texte à texte —
 * une ligne abîmée (« 9 », ISO à « T ») passerait sinon pour antérieure ou
 * postérieure à tort.
 */
const STORED_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** Ligne lue : suppression ou demande (`deletedAt`), ou réactivation (`reactivatedAt` seul). */
function readEntry(value: unknown): AccountDeletionEntry | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const keyValid =
    typeof v.userId === "number" &&
    Number.isInteger(v.userId) &&
    v.userId > 0 &&
    typeof v.accountCreatedAt === "string" &&
    v.accountCreatedAt.length > 0;
  if (!keyValid || v.reactivated !== undefined) return null;
  const key = { userId: v.userId as number, accountCreatedAt: v.accountCreatedAt as string };
  if (v.deletedAt === undefined) {
    const undone = v.undoneRequestAt;
    if (!isIsoDate(v.reactivatedAt) || v.pending !== undefined) return null;
    if (typeof undone !== "string" || !STORED_DATETIME.test(undone)) return null;
    return { ...key, deletedAt: v.reactivatedAt, reactivated: true, undoneRequestAt: undone };
  }
  if (!isIsoDate(v.deletedAt) || v.reactivatedAt !== undefined || v.undoneRequestAt !== undefined) return null;
  if (v.pending !== undefined && typeof v.pending !== "boolean") return null;
  return { ...key, deletedAt: v.deletedAt, ...(v.pending ? { pending: true } : {}) };
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
      const parsed = readEntry(JSON.parse(line));
      if (parsed) {
        entries.push(parsed);
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
    // Une suppression définitive rend caduques la demande en attente et la
    // réactivation du même compte ; entre deux suppressions définitives, la plus
    // ancienne l'emporte (elle situe le compte face aux sauvegardes) ; entre
    // demandes et réactivations, la plus récente (une réactivation succède à sa
    // demande, une nouvelle demande à la réactivation).
    const knownAt = known ? Date.parse(known.deletedAt) : 0;
    const replaces =
      !known ||
      (!isFinalEntry(known) && isFinalEntry(entry)) ||
      (isFinalEntry(known) && isFinalEntry(entry) && at < knownAt) ||
      (!isFinalEntry(known) && !isFinalEntry(entry) && at >= knownAt);
    if (replaces) byKey.set(key, entry);
  }
  return [...byKey.values()].sort(
    (a, b) => Date.parse(a.deletedAt) - Date.parse(b.deletedAt) || a.userId - b.userId,
  );
}

/**
 * Réactivation : la demande en attente du compte (ou une réactivation plus
 * ancienne) cède la place à une ligne de réactivation datée de `reactivatedAt` ;
 * les autres lignes restent — y compris une ligne en attente **plus récente**
 * (écrivain concurrent, horloge décalée), que `pruneJournal` garde ensuite
 * comme la plus récente.
 */
export function withReactivationEntry(
  entries: readonly AccountDeletionEntry[],
  key: AccountReactivationKey,
  reactivatedAt: Date,
): AccountDeletionEntry[] {
  const at = reactivatedAt.getTime();
  const others = entries.filter(
    (entry) =>
      isFinalEntry(entry) ||
      entry.userId !== key.userId ||
      entry.accountCreatedAt !== key.accountCreatedAt ||
      Date.parse(entry.deletedAt) > at,
  );
  return [
    ...others,
    {
      userId: key.userId,
      accountCreatedAt: key.accountCreatedAt,
      deletedAt: reactivatedAt.toISOString(),
      reactivated: true,
      undoneRequestAt: key.undoneRequestAt,
    },
  ];
}

/** Ce qu'une réactivation consigne : le compte, et la demande qu'elle défait. */
export interface AccountReactivationKey {
  userId: number;
  accountCreatedAt: string;
  /** `deletion_requested_at` de la demande défaite, tel que la base le rend. */
  undoneRequestAt: string;
}

/** L'état d'un compte dans la base restaurée, ou `null` s'il n'y figure pas. */
export interface RestoredAccountRow {
  createdAt: string;
  isDeleted: boolean;
  /** En attente de suppression (`is_deleted = 1` et `deletion_requested_at` posé) : réactivable. */
  pendingDeletion?: boolean;
  /** `deletion_requested_at` tel que la base le rend (`AAAA-MM-JJ HH:MM:SS`), quand il est posé. */
  deletionRequestedAt?: string | null;
}

export type ReplayDecision =
  /** La base restaurée ne connaît pas ce compte (sauvegarde postérieure à son effacement). */
  | "ABSENT"
  /** Déjà anonymisé dans la base restaurée : rien à refaire. */
  | "ALREADY_DELETED"
  /** L'identifiant désigne un **autre** compte que celui qui a été supprimé. */
  | "OTHER_ACCOUNT"
  /** Le compte est revenu avec la sauvegarde : la suppression doit être rejouée. */
  | "REPLAY"
  /** Réactivé depuis, mais revenu en attente de suppression avec la sauvegarde : à réactiver. */
  | "REACTIVATE"
  /** Réactivé depuis, et vivant dans la base restaurée : rien à refaire. */
  | "ALREADY_ACTIVE"
  /**
   * Demande en attente, revenue en attente avec la sauvegarde : sa date est
   * reprise de celle du journal (une demande plus ancienne, défaite puis
   * refaite, raccourcirait sinon la nouvelle fenêtre).
   */
  | "REDATE"
  /**
   * Réactivé depuis, mais revenu en attente d'une demande **postérieure** à
   * celle que la réactivation défaisait : cette demande tient (réactivable).
   */
  | "SUPERSEDED";

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
  if (entry.reactivated) {
    if (!row.isDeleted) return "ALREADY_ACTIVE";
    if (reactivationUndoes(entry, row)) return "REACTIVATE";
    return row.pendingDeletion && row.deletionRequestedAt ? "SUPERSEDED" : "ALREADY_DELETED";
  }
  if (entry.pending && row.pendingDeletion) return "REDATE";
  if (row.isDeleted) return "ALREADY_DELETED";
  return "REPLAY";
}

/**
 * La réactivation défait-elle la demande que porte la base restaurée ? Oui si
 * celle-ci est égale ou antérieure à la demande défaite : une demande refaite
 * après la réactivation tient. Comparaison de textes `AAAA-MM-JJ HH:MM:SS`
 * (ordre chronologique), sans conversion de fuseau.
 */
export function reactivationUndoes(entry: AccountDeletionEntry, row: RestoredAccountRow): boolean {
  const restored = row.deletionRequestedAt;
  const undone = entry.undoneRequestAt;
  return row.pendingDeletion === true && !!restored && !!undone && restored <= undone;
}
