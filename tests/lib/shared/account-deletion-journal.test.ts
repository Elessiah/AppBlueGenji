import { describe, expect, it } from "@jest/globals";
import {
  ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS,
  BACKUP_RETENTION_DAYS,
  formatJournalEntry,
  parseJournal,
  pruneJournal,
  prunePreservedLines,
  replayDecision,
  withReactivationEntry,
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
    expect(parseJournal(line)).toMatchObject({ entries: [entry()], invalidLines: 0 });
  });

  it("n'écrit que les trois champs, même si l'objet en porte d'autres", () => {
    const line = formatJournalEntry({ ...entry(), pseudo: "Nova" } as AccountDeletionEntry);
    expect(line).not.toContain("Nova");
  });

  it("un journal vide ou blanc ne contient rien", () => {
    expect(parseJournal("")).toMatchObject({ entries: [], invalidLines: 0 });
    expect(parseJournal("\n\n  \r\n")).toMatchObject({ entries: [], invalidLines: 0 });
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
    expect(parseJournal(line)).toMatchObject({ entries: [], invalidLines: 1 });
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

  it("pruneJournal_twoPending_newestWins", () => {
    const stale = entry({ pending: true, deletedAt: "2026-10-01T10:00:00.000Z" });
    const current = entry({ pending: true, deletedAt: "2026-10-05T10:00:00.000Z" });

    expect(pruneJournal([current, stale], now)).toEqual([current]);
  });

});

// Décision R1 du 2026-11-04 : la réactivation est journalisée.
describe("réactivation journalisée (décision R1)", () => {
  const now = new Date("2026-11-06T12:00:00.000Z");
  const key = { userId: 7, accountCreatedAt: "2026-01-02 03:04:05", undoneRequestAt: "2026-11-01 10:00:00" };
  const reactivatedAt = new Date("2026-11-03T09:00:00.000Z");
  const reactivated = entry({
    reactivated: true,
    deletedAt: "2026-11-03T09:00:00.000Z",
    undoneRequestAt: "2026-11-01 10:00:00",
  });
  const pendingRow = (deletionRequestedAt: string | null) => ({
    createdAt: "2026-01-02 03:04:05",
    isDeleted: true,
    pendingDeletion: true,
    deletionRequestedAt,
  });

  it("withReactivationEntry_pendingLine_replacedByReactivatedLine", () => {
    const pending = entry({ pending: true });
    const other = entry({ userId: 8, pending: true });
    const final = entry({ userId: 9 });

    expect(withReactivationEntry([pending, other, final], key, reactivatedAt)).toEqual([other, final, reactivated]);
  });

  it("withReactivationEntry_otherCreationDate_untouched", () => {
    const otherCreation = entry({ pending: true, accountCreatedAt: "2025-05-05 05:05:05" });

    expect(withReactivationEntry([otherCreation], key, reactivatedAt)).toEqual([otherCreation, reactivated]);
  });

  // Revue sécurité #546, cycle 9 : une demande plus récente que la réactivation reste.
  it("withReactivationEntry_laterPendingLine_keptAndWinsAtPrune", () => {
    const later = entry({ pending: true, deletedAt: "2026-11-04T10:00:00.000Z" });

    const written = withReactivationEntry([later], key, reactivatedAt);

    expect(written).toEqual([later, reactivated]);
    expect(pruneJournal(written, now)).toEqual([later]);
  });

  it("withReactivationEntry_pendingLineAtSameInstant_replaced", () => {
    const same = entry({ pending: true, deletedAt: "2026-11-03T09:00:00.000Z" });

    expect(withReactivationEntry([same], key, reactivatedAt)).toEqual([reactivated]);
  });

  it("withReactivationEntry_finalLineOfSameAccount_kept", () => {
    const final = entry();

    expect(withReactivationEntry([final], key, reactivatedAt)).toEqual([final, reactivated]);
  });

  it("pruneJournal_reactivationAfterRequest_reactivationWins", () => {
    const pending = entry({ pending: true, deletedAt: "2026-11-01T10:00:00.000Z" });

    expect(pruneJournal([pending, reactivated], now)).toEqual([reactivated]);
  });

  it("pruneJournal_newRequestAfterReactivation_requestWins", () => {
    const pending = entry({ pending: true, deletedAt: "2026-11-05T10:00:00.000Z" });

    expect(pruneJournal([reactivated, pending], now)).toEqual([pending]);
  });

  it("pruneJournal_finalDeletion_overridesReactivation", () => {
    const final = entry({ deletedAt: "2026-10-01T10:00:00.000Z" });

    expect(pruneJournal([reactivated, final], now)).toEqual([final]);
  });

  it("formatParse_reactivatedEntry_roundTrips", () => {
    expect(parseJournal(formatJournalEntry(reactivated)).entries).toEqual([reactivated]);
  });

  // Revue sécurité #546, cycle 8 : une version antérieure exige `deletedAt` et
  // écarte la ligne, au lieu d'y lire une suppression définitive.
  it("formatJournalEntry_reactivatedEntry_writesReactivatedAtAndUndoneRequestAt", () => {
    expect(formatJournalEntry(reactivated)).toBe(
      '{"userId":7,"accountCreatedAt":"2026-01-02 03:04:05","reactivatedAt":"2026-11-03T09:00:00.000Z",' +
        '"undoneRequestAt":"2026-11-01 10:00:00"}\n',
    );
  });

  it("parseJournal_reactivationWithoutUndoneRequestAt_rejected", () => {
    const line = JSON.stringify({ userId: 7, accountCreatedAt: "2026-01-02 03:04:05", reactivatedAt: "2026-11-03T09:00:00.000Z" });

    expect(parseJournal(line)).toMatchObject({ entries: [], invalidLines: 1 });
  });

  // Revue sécurité #546, cycle 10 : seule la forme rendue par la base est admise.
  it.each<[string]>([["9"], ["2026-11-01T10:00:00.000Z"], ["2026-11-01 10:00"], [" 2026-11-01 10:00:00"]])(
    "parseJournal_undoneRequestAtMalformed_rejected (%s)",
    (undone) => {
      const line = JSON.stringify({ ...key, reactivatedAt: "2026-11-03T09:00:00.000Z", undoneRequestAt: undone });

      expect(parseJournal(line)).toMatchObject({ entries: [], invalidLines: 1 });
    },
  );

  it("parseJournal_deletionLineWithUndoneRequestAt_rejected", () => {
    const line = JSON.stringify({ ...entry(), undoneRequestAt: "2026-11-01 10:00:00" });

    expect(parseJournal(line)).toMatchObject({ entries: [], invalidLines: 1 });
  });

  it("parseJournal_deletedAtAndReactivatedAt_rejected", () => {
    const line = JSON.stringify({ ...entry(), reactivatedAt: "2026-11-03T09:00:00.000Z" });

    expect(parseJournal(line)).toMatchObject({ entries: [], invalidLines: 1 });
  });

  it("parseJournal_reactivatedAtWithPending_rejected", () => {
    const line = JSON.stringify({ ...key, reactivatedAt: "2026-11-03T09:00:00.000Z", pending: true });

    expect(parseJournal(line)).toMatchObject({ entries: [], invalidLines: 1 });
  });

  it("parseJournal_legacyReactivatedFlag_rejected", () => {
    const line = JSON.stringify({ ...entry(), reactivated: true });

    expect(parseJournal(line)).toMatchObject({ entries: [], invalidLines: 1 });
  });

  it("parseJournal_invalidReactivatedAt_rejected", () => {
    const line = JSON.stringify({ ...key, reactivatedAt: "pas une date" });

    expect(parseJournal(line)).toMatchObject({ entries: [], invalidLines: 1 });
  });

  it("replayDecision_restoredRequestEqualToUndone_reactivate", () => {
    expect(replayDecision(reactivated, pendingRow("2026-11-01 10:00:00"))).toBe("REACTIVATE");
  });

  it("replayDecision_restoredRequestOlderThanUndone_reactivate", () => {
    expect(replayDecision(reactivated, pendingRow("2026-10-20 08:00:00"))).toBe("REACTIVATE");
  });

  // Revue sécurité #546, cycle 8 : une nouvelle demande, postérieure, reste en attente.
  it("replayDecision_restoredRequestLaterThanUndone_superseded", () => {
    expect(replayDecision(reactivated, pendingRow("2026-11-05 10:00:00"))).toBe("SUPERSEDED");
  });

  // Revue sécurité #546, cycle 9 : comparaison à la seconde, sans fuseau.
  it("replayDecision_restoredRequestSameSecondLater_superseded", () => {
    expect(replayDecision(reactivated, pendingRow("2026-11-01 10:00:01"))).toBe("SUPERSEDED");
  });

  // Revue sécurité #546, cycle 9 : une demande défaite puis refaite reprend la date du journal.
  it("replayDecision_pendingEntryPendingRow_redate", () => {
    expect(replayDecision(entry({ pending: true }), pendingRow("2026-09-01 10:00:00"))).toBe("REDATE");
  });

  it("replayDecision_reactivatedEntryPendingWithoutRequestDate_alreadyDeleted", () => {
    expect(
      replayDecision(reactivated, {
        createdAt: "2026-01-02 03:04:05",
        isDeleted: true,
        pendingDeletion: true,
        deletionRequestedAt: null,
      }),
    ).toBe("ALREADY_DELETED");
  });

  it("replayDecision_reactivatedEntryAliveRow_alreadyActive", () => {
    expect(replayDecision(reactivated, { createdAt: "2026-01-02 03:04:05", isDeleted: false })).toBe("ALREADY_ACTIVE");
  });

  it("replayDecision_reactivatedEntryFinalDeletedRow_alreadyDeleted", () => {
    expect(
      replayDecision(reactivated, { createdAt: "2026-01-02 03:04:05", isDeleted: true, pendingDeletion: false }),
    ).toBe("ALREADY_DELETED");
  });

  it("replayDecision_reactivatedEntryOtherAccount_otherAccount", () => {
    expect(
      replayDecision(reactivated, { createdAt: "2026-09-22 08:00:00", isDeleted: true, pendingDeletion: true }),
    ).toBe("OTHER_ACCOUNT");
  });
});

// Revue sécurité #571, cycle 3 : une ligne datée qu'on ne sait pas lire survit à la réécriture.
describe("lignes illisibles gardées (parseJournal.preserved)", () => {
  it("parseJournal_datedUnreadableLine_preservedVerbatim", () => {
    const line = '{"userId":7,"accountCreatedAt":"2026-01-02 03:04:05","reactivatedAt":"2026-11-03T09:00:00.000Z","undoneRequestAt":"9"}';

    expect(parseJournal(`  ${line}  \n`)).toEqual({
      entries: [],
      invalidLines: 1,
      preserved: [{ line, at: Date.parse("2026-11-03T09:00:00.000Z") }],
    });
  });

  it("parseJournal_truncatedLine_notPreserved", () => {
    expect(parseJournal('{"userId":7,"deletedAt":"2026-11-03T09:00:00.000Z"')).toEqual({
      entries: [],
      invalidLines: 1,
      preserved: [],
    });
  });

  it("parseJournal_undatedUnreadableObject_notPreserved", () => {
    expect(parseJournal('{"userId":7,"deletedAt":"hier"}').preserved).toEqual([]);
  });

  it("prunePreservedLines_expiredDropped_duplicatesMerged", () => {
    const now = new Date("2026-11-09T00:00:00.000Z");
    const fresh = { line: '{"a":1}', at: Date.parse("2026-11-01T00:00:00.000Z") };
    const expired = { line: '{"b":1}', at: Date.parse("2025-01-01T00:00:00.000Z") };

    expect(prunePreservedLines([fresh, expired, fresh], now)).toEqual(['{"a":1}']);
  });
});
