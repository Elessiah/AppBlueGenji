import { describe, expect, it } from "@jest/globals";
import {
  ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS,
  BACKUP_RETENTION_DAYS,
  formatJournalEntry,
  parseJournal,
  pruneJournal,
  replayDecision,
  withoutPendingEntry,
  type AccountDeletionEntry,
} from "@/lib/shared/account-deletion-journal";

const entry = (over: Partial<AccountDeletionEntry> = {}): AccountDeletionEntry => ({
  userId: 7,
  accountCreatedAt: "2026-01-02 03:04:05",
  deletedAt: "2026-09-20T10:00:00.000Z",
  ...over,
});

describe("formatJournalEntry / parseJournal", () => {
  it("écrit une ligne JSON terminée par un saut de ligne, relue à l'identique", () => {
    const line = formatJournalEntry(entry());
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trim().includes("\n")).toBe(false);
    expect(parseJournal(line)).toEqual({ entries: [entry()], invalidLines: 0 });
  });

  it("n'écrit que les trois champs, même si l'objet en porte d'autres", () => {
    const line = formatJournalEntry({ ...entry(), pseudo: "Nova" } as AccountDeletionEntry);
    expect(line).not.toContain("Nova");
  });

  it("un journal vide ou blanc ne contient rien", () => {
    expect(parseJournal("")).toEqual({ entries: [], invalidLines: 0 });
    expect(parseJournal("\n\n  \r\n")).toEqual({ entries: [], invalidLines: 0 });
  });

  it("écarte une ligne tronquée sans perdre les autres", () => {
    const text =
      formatJournalEntry(entry({ userId: 1 })) +
      '{"userId":2,"accou\n' +
      formatJournalEntry(entry({ userId: 3 }));
    const parsed = parseJournal(text);
    expect(parsed.entries.map((e) => e.userId)).toEqual([1, 3]);
    expect(parsed.invalidLines).toBe(1);
  });

  it("accepte les fins de ligne Windows", () => {
    const text = formatJournalEntry(entry()).replace("\n", "\r\n");
    expect(parseJournal(text).entries).toHaveLength(1);
  });

  it.each([
    ['{"userId":0,"accountCreatedAt":"x","deletedAt":"2026-01-01T00:00:00Z"}', "identifiant nul"],
    ['{"userId":1.5,"accountCreatedAt":"x","deletedAt":"2026-01-01T00:00:00Z"}', "identifiant non entier"],
    ['{"userId":"1","accountCreatedAt":"x","deletedAt":"2026-01-01T00:00:00Z"}', "identifiant en chaîne"],
    ['{"userId":1,"accountCreatedAt":"","deletedAt":"2026-01-01T00:00:00Z"}', "date de création vide"],
    ['{"userId":1,"accountCreatedAt":"x","deletedAt":"hier"}', "date de suppression illisible"],
    ["[1,2,3]", "tableau"],
    ["null", "null"],
  ])("refuse %s (%s)", (line) => {
    expect(parseJournal(line)).toEqual({ entries: [], invalidLines: 1 });
  });
});

describe("pruneJournal", () => {
  const now = new Date("2026-09-23T12:00:00.000Z");
  const day = 24 * 60 * 60 * 1000;

  it("garde deux fois la rétention des sauvegardes", () => {
    expect(ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS).toBe(BACKUP_RETENTION_DAYS * 2);
  });

  it("retire les lignes plus vieilles que la rétention, garde la borne", () => {
    const atLimit = new Date(now.getTime() - 60 * day).toISOString();
    const beyond = new Date(now.getTime() - 60 * day - 1).toISOString();
    const kept = pruneJournal(
      [entry({ userId: 1, deletedAt: atLimit }), entry({ userId: 2, deletedAt: beyond })],
      now,
      60,
    );
    expect(kept.map((e) => e.userId)).toEqual([1]);
  });

  it("applique la rétention par défaut", () => {
    const old = new Date(now.getTime() - (ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS + 1) * day).toISOString();
    expect(pruneJournal([entry({ deletedAt: old })], now)).toEqual([]);
  });

  it("dédoublonne un même compte en gardant la première suppression", () => {
    const kept = pruneJournal(
      [entry({ deletedAt: "2026-09-22T00:00:00.000Z" }), entry({ deletedAt: "2026-09-20T00:00:00.000Z" })],
      now,
    );
    expect(kept).toEqual([entry({ deletedAt: "2026-09-20T00:00:00.000Z" })]);
  });

  it("ne confond pas deux comptes qui ont porté le même identifiant", () => {
    const kept = pruneJournal(
      [entry({ accountCreatedAt: "2026-01-01 00:00:00" }), entry({ accountCreatedAt: "2026-05-01 00:00:00" })],
      now,
    );
    expect(kept).toHaveLength(2);
  });

  it("trie par date de suppression, puis par identifiant", () => {
    const kept = pruneJournal(
      [
        entry({ userId: 9, deletedAt: "2026-09-21T00:00:00.000Z" }),
        entry({ userId: 5, deletedAt: "2026-09-21T00:00:00.000Z" }),
        entry({ userId: 1, deletedAt: "2026-09-22T00:00:00.000Z" }),
      ],
      now,
    );
    expect(kept.map((e) => e.userId)).toEqual([5, 9, 1]);
  });

  it("ne modifie pas le tableau reçu", () => {
    const input = [entry({ userId: 2 }), entry({ userId: 1 })];
    pruneJournal(input, now);
    expect(input.map((e) => e.userId)).toEqual([2, 1]);
  });
});

describe("replayDecision", () => {
  it("rejoue un compte revenu avec la sauvegarde", () => {
    expect(replayDecision(entry(), { createdAt: "2026-01-02 03:04:05", isDeleted: false })).toBe("REPLAY");
  });

  it("ignore un compte absent de la base restaurée", () => {
    expect(replayDecision(entry(), null)).toBe("ABSENT");
  });

  it("ignore un compte déjà anonymisé", () => {
    expect(replayDecision(entry(), { createdAt: "2026-01-02 03:04:05", isDeleted: true })).toBe(
      "ALREADY_DELETED",
    );
  });

  it("ne touche jamais un identifiant réattribué à un autre compte, anonymisé ou non", () => {
    expect(replayDecision(entry(), { createdAt: "2026-09-22 08:00:00", isDeleted: false })).toBe("OTHER_ACCOUNT");
    expect(replayDecision(entry(), { createdAt: "2026-09-22 08:00:00", isDeleted: true })).toBe("OTHER_ACCOUNT");
  });
});

describe("demande en attente (décision du 2026-11-04)", () => {
  const now = new Date("2026-11-06T12:00:00.000Z");

  it("formatJournalEntry_pendingFlag_roundTrips", () => {
    const pending = entry({ pending: true });

    expect(parseJournal(formatJournalEntry(pending) + "\n").entries).toEqual([pending]);
  });

  it("formatJournalEntry_finalEntry_hasNoPendingField", () => {
    expect(formatJournalEntry(entry())).not.toContain("pending");
  });

  it("pruneJournal_finalAfterPending_finalWins", () => {
    const pending = entry({ pending: true, deletedAt: "2026-10-01T10:00:00.000Z" });
    const final = entry({ deletedAt: "2026-10-31T10:00:00.000Z" });

    expect(pruneJournal([pending, final], now)).toEqual([final]);
  });

  it("pruneJournal_pendingAfterFinal_finalKept", () => {
    const final = entry({ deletedAt: "2026-10-31T10:00:00.000Z" });
    const pending = entry({ pending: true, deletedAt: "2026-11-01T10:00:00.000Z" });

    expect(pruneJournal([final, pending], now)).toEqual([final]);
  });

  it("pruneJournal_twoPending_oldestWins", () => {
    const first = entry({ pending: true, deletedAt: "2026-10-01T10:00:00.000Z" });
    const second = entry({ pending: true, deletedAt: "2026-10-05T10:00:00.000Z" });

    expect(pruneJournal([second, first], now)).toEqual([first]);
  });

  it("withoutPendingEntry_reactivatedAccount_removesOnlyItsPendingLine", () => {
    const pending = entry({ pending: true });
    const otherCreation = entry({ pending: true, accountCreatedAt: "2025-05-05 05:05:05" });
    const other = entry({ userId: 8, pending: true });
    const final = entry({ userId: 9 });

    expect(withoutPendingEntry([pending, otherCreation, other, final], { userId: 7, accountCreatedAt: "2026-01-02 03:04:05" })).toEqual([
      otherCreation,
      other,
      final,
    ]);
  });

  it("withoutPendingEntry_finalLineOfSameAccount_kept", () => {
    const final = entry();

    expect(withoutPendingEntry([final], { userId: 7, accountCreatedAt: "2026-01-02 03:04:05" })).toEqual([final]);
  });
});
