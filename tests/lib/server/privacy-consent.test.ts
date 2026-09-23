import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { getDatabase } from "@/lib/server/database";
import {
  acknowledgePrivacyChanges,
  listPrivacyAcknowledgments,
  loadPendingPrivacyChanges,
} from "@/lib/server/privacy-consent";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { fakePool } from "../../helpers/sql-double";

const flat = (sql: unknown) => String(sql).replace(/\s+/g, " ").trim();

function mockExecute(result: unknown[]) {
  const execute = jest.fn(async () => [result]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return execute;
}

describe("loadPendingPrivacyChanges", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("lit création et acceptations en une seule requête, compte vivant seulement", async () => {
    const execute = mockExecute([{ created_at: "2025-01-01 10:00:00", change_id: null }]);
    const pending = await loadPendingPrivacyChanges(7);
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(flat(sql)).toContain("LEFT JOIN bg_privacy_acknowledgments");
    expect(flat(sql)).toContain("u.is_deleted = 0");
    expect(params).toEqual([7]);
    expect(pending.map((c) => c.id)).toEqual(PRIVACY_CHANGES.map((c) => c.id));
  });

  it("retire les changements déjà acceptés", async () => {
    mockExecute([
      { created_at: "2025-01-01 10:00:00", change_id: PRIVACY_CHANGES[0].id },
    ]);
    const pending = await loadPendingPrivacyChanges(7);
    expect(pending.map((c) => c.id)).not.toContain(PRIVACY_CHANGES[0].id);
    expect(pending).toHaveLength(PRIVACY_CHANGES.length - 1);
  });

  it("n'impose rien à un compte créé après la dernière publication", async () => {
    mockExecute([{ created_at: "2099-01-01 00:00:00", change_id: null }]);
    expect(await loadPendingPrivacyChanges(7)).toEqual([]);
  });

  it("compte introuvable ou supprimé : rien", async () => {
    mockExecute([]);
    expect(await loadPendingPrivacyChanges(7)).toEqual([]);
  });
});

describe("acknowledgePrivacyChanges", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("insère une ligne par changement, sans doublon et sur un compte vivant", async () => {
    const execute = mockExecute([]);
    await acknowledgePrivacyChanges(7, ["a", "b"]);
    const [sql, params] = execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(flat(sql)).toMatch(/^INSERT IGNORE INTO bg_privacy_acknowledgments/);
    expect(flat(sql)).toContain("SELECT ? AS change_id UNION ALL SELECT ? AS change_id");
    expect(flat(sql)).toContain("u.is_deleted = 0");
    expect(params).toEqual(["a", "b", 7]);
  });

  it("liste vide : aucune requête", async () => {
    const execute = mockExecute([]);
    await acknowledgePrivacyChanges(7, []);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("listPrivacyAcknowledgments", () => {
  it("rend les acceptations datées pour l'export", async () => {
    mockExecute([{ change_id: "a", accepted_at: "2026-09-24 12:00:00" }]);
    const rows = await listPrivacyAcknowledgments(7);
    expect(rows).toHaveLength(1);
    expect(rows[0].changeId).toBe("a");
    expect(rows[0].acceptedAt).toMatch(/^2026-09-24/);
  });
});
