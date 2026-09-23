import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  accountDeletionJournalPath,
  readAccountDeletionJournal,
  recordAccountDeletion,
} from "@/lib/server/account-deletion-journal";
import type { AccountDeletionEntry } from "@/lib/shared/account-deletion-journal";

const now = new Date("2026-09-23T12:00:00.000Z");
const entry = (userId: number, deletedAt = "2026-09-23T11:00:00.000Z"): AccountDeletionEntry => ({
  userId,
  accountCreatedAt: "2026-01-02 03:04:05",
  deletedAt,
});

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "bg-journal-"));
  file = path.join(dir, "sub", "account-deletions.jsonl");
});

afterEach(async () => {
  jest.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("accountDeletionJournalPath", () => {
  const saved = process.env.ACCOUNT_DELETION_JOURNAL_PATH;
  afterEach(() => {
    process.env.ACCOUNT_DELETION_JOURNAL_PATH = saved;
  });

  it("suit ACCOUNT_DELETION_JOURNAL_PATH", () => {
    process.env.ACCOUNT_DELETION_JOURNAL_PATH = "/srv/journal.jsonl";
    expect(accountDeletionJournalPath()).toBe("/srv/journal.jsonl");
  });

  it("retombe sur data/ du dossier de l'app, hors de public/", () => {
    process.env.ACCOUNT_DELETION_JOURNAL_PATH = "  ";
    const resolved = accountDeletionJournalPath();
    expect(resolved).toBe(path.join(process.cwd(), "data", "account-deletions.jsonl"));
    expect(resolved).not.toContain(`${path.sep}public${path.sep}`);
  });

  it("la suite de tests écrit hors du dépôt", () => {
    // `tests/setup-env.cjs` : sans lui, chaque test passant par
    // `deleteOwnAccount` déposerait une ligne dans `data/` du dépôt.
    expect(saved?.startsWith(os.tmpdir())).toBe(true);
  });
});

describe("readAccountDeletionJournal", () => {
  it("un fichier absent est un journal vide", async () => {
    expect(await readAccountDeletionJournal(file)).toEqual({ entries: [], invalidLines: 0 });
  });
});

describe("recordAccountDeletion", () => {
  it("crée le dossier et le fichier", async () => {
    await recordAccountDeletion(entry(1), { filePath: file, now });
    expect((await readAccountDeletionJournal(file)).entries).toEqual([entry(1)]);
  });

  it("ajoute sans perdre les lignes existantes", async () => {
    await recordAccountDeletion(entry(1), { filePath: file, now });
    await recordAccountDeletion(entry(2), { filePath: file, now });
    expect((await readAccountDeletionJournal(file)).entries.map((e) => e.userId)).toEqual([1, 2]);
  });

  it("n'en perd aucune quand plusieurs suppressions arrivent de front", async () => {
    await Promise.all(
      [1, 2, 3, 4, 5, 6, 7, 8].map((id) => recordAccountDeletion(entry(id), { filePath: file, now })),
    );
    const ids = (await readAccountDeletionJournal(file)).entries.map((e) => e.userId);
    expect(ids.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("élague les lignes périmées au passage", async () => {
    await recordAccountDeletion(entry(1, "2026-01-01T00:00:00.000Z"), { filePath: file, now });
    await recordAccountDeletion(entry(2), { filePath: file, now });
    expect((await readAccountDeletionJournal(file)).entries.map((e) => e.userId)).toEqual([2]);
  });

  it("écarte une ligne abîmée plutôt que de refuser d'écrire", async () => {
    await recordAccountDeletion(entry(1), { filePath: file, now });
    await writeFile(file, `${await readFile(file, "utf8")}{"userId":`, "utf8");
    await recordAccountDeletion(entry(2), { filePath: file, now });
    expect(await readAccountDeletionJournal(file)).toEqual({ entries: [entry(1), entry(2)], invalidLines: 0 });
  });

  it("ne laisse aucun fichier temporaire", async () => {
    await recordAccountDeletion(entry(1), { filePath: file, now });
    expect(await readdir(path.dirname(file))).toEqual(["account-deletions.jsonl"]);
  });

  it("ne lève jamais : un échec d'écriture est signalé, pas propagé", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    // Un fichier à l'endroit du dossier : l'écriture ne peut pas aboutir.
    await writeFile(path.join(dir, "sub"), "x");
    await expect(recordAccountDeletion(entry(1), { filePath: file, now })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("#1");
  });

  it("un échec n'empêche pas l'écriture suivante", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    await writeFile(path.join(dir, "sub"), "x");
    await recordAccountDeletion(entry(1), { filePath: file, now });
    const other = path.join(dir, "other.jsonl");
    await recordAccountDeletion(entry(2), { filePath: other, now });
    expect((await readAccountDeletionJournal(other)).entries).toEqual([entry(2)]);
  });
});
