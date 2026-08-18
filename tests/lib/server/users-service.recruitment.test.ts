import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { updateOwnProfile } from "@/lib/server/users-service";

jest.mock("@/lib/server/database");

async function mockDb(execute: jest.Mock) {
  const { getDatabase } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({ execute });
}

describe("updateOwnProfile — pseudo non masquable + ouverture au recrutement", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("n'écrit plus jamais visible_pseudo", async () => {
    const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute);

    await updateOwnProfile(42, { visibility: { avatar: false } });

    const [sql] = execute.mock.calls[0] as [string];
    expect(sql).not.toMatch(/visible_pseudo/);
    expect(sql).toMatch(/visible_avatar = COALESCE\(\?, visible_avatar\)/);
  });

  it("persiste la fermeture au recrutement", async () => {
    const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute);

    await updateOwnProfile(42, { openToRecruitment: false });

    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/open_to_recruitment = COALESCE\(\?, open_to_recruitment\)/);
    // Dernier paramètre avant l'id = open_to_recruitment.
    expect(params[params.length - 2]).toBe(false);
    expect(params[params.length - 1]).toBe(42);
  });

  it("laisse la valeur inchangée quand le champ est absent du patch", async () => {
    const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute);

    await updateOwnProfile(42, { isAdult: true });

    const [, params] = execute.mock.calls[0] as [string, unknown[]];
    // `null` → COALESCE conserve la valeur en base.
    expect(params[params.length - 2]).toBeNull();
  });
});
