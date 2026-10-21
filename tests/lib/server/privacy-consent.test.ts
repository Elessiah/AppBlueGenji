import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { getDatabase } from "@/lib/server/database";
import {
  LIVE_STAFF_SQL,
  acknowledgePrivacyChanges,
  listPrivacyAcknowledgments,
  loadPendingPrivacyChanges,
  privacyAudienceSql,
} from "@/lib/server/privacy-consent";
import { PRIVACY_CHANGES, type PrivacyAudience } from "@/lib/shared/privacy-changes";
import { PLATFORM_ROLES, can } from "@/lib/shared/permissions";
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
    // Après tout le registre, sauf mention contraire : chaque entrée est publiée.
    jest.useFakeTimers({ now: new Date("2099-01-01T12:00:00Z"), doNotFake: ["nextTick", "queueMicrotask"] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("tait une entrée pas encore publiée au jour de Paris", async () => {
    const last = PRIVACY_CHANGES.at(-1)!;
    // Midi UTC la veille de sa publication.
    jest.setSystemTime(new Date(Date.parse(`${last.publishedAt}T12:00:00Z`) - 86_400_000));
    // Relié à Google : seule la date peut taire la dernière entrée, même ciblée.
    mockExecute([{ created_at: "2025-01-01 10:00:00", google_linked: 1, live_staff: 1, change_id: null }]);
    const pending = await loadPendingPrivacyChanges(7);
    expect(pending.map((c) => c.id)).not.toContain(last.id);
    expect(pending.every((c) => c.publishedAt < last.publishedAt)).toBe(true);
  });

  it("lit création et prises de connaissance en une seule requête, compte vivant seulement", async () => {
    const execute = mockExecute([{ created_at: "2025-01-01 10:00:00", google_linked: 1, live_staff: 1, change_id: null }]);
    const pending = await loadPendingPrivacyChanges(7);
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(flat(sql)).toContain("LEFT JOIN bg_privacy_acknowledgments");
    expect(flat(sql)).toContain("u.is_deleted = 0");
    expect(params).toEqual([7]);
    expect(pending.map((c) => c.id)).toEqual(PRIVACY_CHANGES.map((c) => c.id));
  });

  it("retire les changements déjà lus", async () => {
    mockExecute([
      { created_at: "2025-01-01 10:00:00", google_linked: 1, live_staff: 1, change_id: PRIVACY_CHANGES[0].id },
    ]);
    const pending = await loadPendingPrivacyChanges(7);
    expect(pending.map((c) => c.id)).not.toContain(PRIVACY_CHANGES[0].id);
    expect(pending).toHaveLength(PRIVACY_CHANGES.length - 1);
  });

  it("tait une entrée ciblée Google à un compte qui n'est pas relié à Google", async () => {
    const execute = mockExecute([{ created_at: "2025-01-01 10:00:00", google_linked: 0, live_staff: 1, change_id: null }]);
    const pending = await loadPendingPrivacyChanges(7);
    const [sql] = execute.mock.calls[0] as unknown as [string];
    expect(flat(sql)).toContain("u.google_sub IS NOT NULL AS google_linked");
    const targeted = PRIVACY_CHANGES.filter((c) => c.audience === "GOOGLE_LINKED").map((c) => c.id);
    expect(targeted.length).toBeGreaterThan(0);
    for (const id of targeted) expect(pending.map((c) => c.id)).not.toContain(id);
    expect(pending).toHaveLength(PRIVACY_CHANGES.length - targeted.length);
  });

  it("tait une entrée réservée aux casters (permission live) à un compte qui ne peut pas caster", async () => {
    const targeted = PRIVACY_CHANGES.filter((c) => c.audience === "LIVE_STAFF").map((c) => c.id);
    expect(targeted).toContain("2026-10-contacts-du-caster-aux-arbitres");
    const execute = mockExecute([{ created_at: "2025-01-01 10:00:00", google_linked: 1, live_staff: 0, change_id: null }]);
    const pending = await loadPendingPrivacyChanges(7);
    const [sql] = execute.mock.calls[0] as unknown as [string];
    // La même expression que l'annonce Discord : modale et message visent les mêmes comptes.
    expect(flat(sql)).toContain(`${LIVE_STAFF_SQL} AS live_staff`);
    for (const id of targeted) expect(pending.map((c) => c.id)).not.toContain(id);
    expect(pending).toHaveLength(PRIVACY_CHANGES.length - targeted.length);
  });

  it("la montre à un compte qui peut caster", async () => {
    mockExecute([{ created_at: "2025-01-01 10:00:00", google_linked: 1, live_staff: 1, change_id: null }]);
    const pending = await loadPendingPrivacyChanges(7);
    expect(pending.map((c) => c.id)).toContain("2026-10-contacts-du-caster-aux-arbitres");
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

describe("privacyAudienceSql", () => {
  const base = PRIVACY_CHANGES[0];
  it("traduit chaque cible en condition sur la ligne u", () => {
    expect(privacyAudienceSql({ ...base, audience: undefined })).toBe("1 = 1");
    expect(privacyAudienceSql({ ...base, audience: "GOOGLE_LINKED" })).toBe("u.google_sub IS NOT NULL");
    expect(privacyAudienceSql({ ...base, audience: "LIVE_STAFF" })).toBe(LIVE_STAFF_SQL);
    expect(privacyAudienceSql({ ...base, audience: "AUTRE" as string as PrivacyAudience })).toBe("1 = 0");
  });

  it("LIVE_STAFF nomme exactement les rôles que can(user, \"live\") accepte, et l'administrateur", () => {
    for (const role of PLATFORM_ROLES) {
      expect(LIVE_STAFF_SQL.includes(`'"${role}"'`)).toBe(can({ roles: [role] }, "live"));
    }
    expect(LIVE_STAFF_SQL.startsWith("(u.is_admin = 1")).toBe(can({ isAdmin: true, roles: [] }, "live"));
  });

  it("LIVE_STAFF : la règle de can(user, \"live\"), rôles tirés de ROLE_PERMISSIONS", () => {
    expect(LIVE_STAFF_SQL).toBe(
      `(u.is_admin = 1 OR JSON_CONTAINS(u.platform_roles_json, '"ADMIN"') OR JSON_CONTAINS(u.platform_roles_json, '"ARBITRE"') OR JSON_CONTAINS(u.platform_roles_json, '"CASTER"'))`,
    );
  });
});
