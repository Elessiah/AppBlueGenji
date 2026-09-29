import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/users-service", () => {
  const actual = jest.requireActual<
    typeof import("@/lib/server/users-service")
  >("@/lib/server/users-service");
  return {
    // La vraie : c'est elle qui décide qu'un identifiant numérique n'est pas un
    // pseudo.
    normalizeDiscordHandle: actual.normalizeDiscordHandle,
    createDiscordLoginChallenge: jest.fn(),
    consumeDiscordChallenge: jest.fn(),
    discardDiscordChallenge: jest.fn(),
  };
});

import {
  confirmDiscordHandleUpdate,
  startDiscordHandleUpdate,
} from "@/lib/server/discord-verification";
import { getDatabase } from "@/lib/server/database";
import {
  resolveDiscordUser,
  sendDiscordLoginCode,
} from "@/lib/server/bot-integration";
import {
  consumeDiscordChallenge,
  createDiscordLoginChallenge,
  discardDiscordChallenge,
} from "@/lib/server/users-service";
import { fakePool } from "../../helpers/sql-double";

/**
 * « Mettre à jour mon pseudo » — la ligne « Bot Discord ».
 *
 * Les propriétés tenues : on ne déplace jamais une porte (`DISCORD_ID_MISMATCH`),
 * le pseudo écrit est celui du défi, la certification tombe s'il change et reste
 * sinon, la méthode n'est posée que sur un rattachement neuf, et un envoi raté
 * ne laisse pas sa ligne. Voir `docs/features/OAUTH_PROVIDERS.md`.
 */

type UserState = {
  discord_id: string | null;
  discord_pseudo: string | null;
  discord_verified_at: Date | null;
  discord_pseudo_from_discord: number;
  discord_link_method: "OAUTH" | "DM_CODE" | null;
  is_deleted?: boolean;
};

const CERTIFIED_AT = new Date("2026-09-20T12:00:00Z");

/** Rejoue l'`UPDATE` de la confirmation, affectations dans l'ordre de MySQL. */
function fakeDb(
  state: UserState,
  otherAccountHolds: string | null = null,
  duplicate = false,
) {
  const writes: { sql: string; params: unknown[] }[] = [];
  const execute = jest.fn(async (sql: string, params: unknown[] = []) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    if (
      q.startsWith(
        "SELECT discord_id, discord_pseudo, discord_verified_at, discord_pseudo_from_discord",
      )
    ) {
      return [state.is_deleted ? [] : [{ ...state }]];
    }
    if (
      q.startsWith("SELECT id FROM bg_users WHERE discord_id = ? AND id <> ?")
    ) {
      return [
        otherAccountHolds !== null && params[0] === otherAccountHolds
          ? [{ id: 1234 }]
          : [],
      ];
    }
    if (
      q.startsWith(
        "UPDATE bg_users SET discord_verified_at = CASE WHEN discord_pseudo <=> ?",
      )
    ) {
      writes.push({ sql: q, params });
      if (duplicate)
        throw Object.assign(new Error("dup"), {
          code: "ER_DUP_ENTRY",
          errno: 1062,
        });
      const [tag, method, discordId, pseudo, , guardId] = params as string[];
      const matches =
        !state.is_deleted &&
        (state.discord_id === null || state.discord_id === guardId);
      if (!matches) return [{ affectedRows: 0 }];
      if (state.discord_pseudo !== tag) state.discord_verified_at = null;
      if (state.discord_id === null)
        state.discord_link_method = method as "DM_CODE";
      state.discord_id = state.discord_id ?? discordId;
      state.discord_pseudo = pseudo;
      state.discord_pseudo_from_discord = 1;
      return [{ affectedRows: 1 }];
    }
    throw new Error(`requête inattendue : ${q}`);
  });
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return { state, writes };
}

const LINKED_BY_CODE: UserState = {
  discord_id: "900000000000000001",
  discord_pseudo: "keryan",
  discord_verified_at: CERTIFIED_AT,
  discord_pseudo_from_discord: 1,
  discord_link_method: "DM_CODE",
};

const GOOGLE_ACCOUNT: UserState = {
  discord_id: null,
  discord_pseudo: null,
  discord_verified_at: null,
  discord_pseudo_from_discord: 0,
  discord_link_method: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(createDiscordLoginChallenge).mockResolvedValue({
    challengeId: 77,
    challengeToken: "t".repeat(32),
    code: "123456",
    expiresAt: new Date("2026-09-20T12:10:00Z"),
  });
  jest.mocked(sendDiscordLoginCode).mockResolvedValue(undefined);
  jest.mocked(discardDiscordChallenge).mockResolvedValue(undefined);
});

describe("startDiscordHandleUpdate", () => {
  it("envoie un code au compte Discord déjà rattaché, pour le pseudo saisi", async () => {
    fakeDb({ ...LINKED_BY_CODE });
    jest.mocked(resolveDiscordUser).mockResolvedValue("900000000000000001");

    const result = await startDiscordHandleUpdate(7, "  keryan_neuf ");

    expect(result).toEqual({
      status: "CODE_SENT",
      discordId: "900000000000000001",
      expiresAt: "2026-09-20T12:10:00.000Z",
    });
    expect(createDiscordLoginChallenge).toHaveBeenCalledWith(
      "900000000000000001",
      "keryan_neuf",
    );
    expect(sendDiscordLoginCode).toHaveBeenCalledWith(
      "900000000000000001",
      "123456",
    );
  });

  it("refuse un pseudo qui résout vers un autre compte Discord, sans rien envoyer", async () => {
    fakeDb({ ...LINKED_BY_CODE });
    jest.mocked(resolveDiscordUser).mockResolvedValue("900000000000000099");

    await expect(startDiscordHandleUpdate(7, "quelquun")).rejects.toThrow(
      "DISCORD_ID_MISMATCH",
    );
    expect(createDiscordLoginChallenge).not.toHaveBeenCalled();
    expect(sendDiscordLoginCode).not.toHaveBeenCalled();
  });

  it("refuse un identifiant numérique : ce n'est pas un pseudo", async () => {
    fakeDb({ ...LINKED_BY_CODE });
    await expect(
      startDiscordHandleUpdate(7, "900000000000000001"),
    ).rejects.toThrow("INVALID_DISCORD_HANDLE");
    expect(resolveDiscordUser).not.toHaveBeenCalled();
  });

  it("sans Discord rattaché, refuse un Discord détenu par un autre compte", async () => {
    fakeDb({ ...GOOGLE_ACCOUNT }, "900000000000000002");
    jest.mocked(resolveDiscordUser).mockResolvedValue("900000000000000002");

    await expect(startDiscordHandleUpdate(7, "keryan")).rejects.toThrow(
      "DISCORD_ALREADY_LINKED",
    );
    expect(sendDiscordLoginCode).not.toHaveBeenCalled();
  });

  it("appelle le garde d'avant-envoi et laisse son refus remonter", async () => {
    fakeDb({ ...LINKED_BY_CODE });
    jest.mocked(resolveDiscordUser).mockResolvedValue("900000000000000001");
    const guard = jest.fn((_discordId: string): void => {
      throw new Error("TOO_MANY_CODE_REQUESTS");
    });

    await expect(startDiscordHandleUpdate(7, "keryan", guard)).rejects.toThrow(
      "TOO_MANY_CODE_REQUESTS",
    );
    expect(guard).toHaveBeenCalledWith("900000000000000001");
    expect(createDiscordLoginChallenge).not.toHaveBeenCalled();
  });

  it("efface le défi quand l'envoi échoue", async () => {
    fakeDb({ ...LINKED_BY_CODE });
    jest.mocked(resolveDiscordUser).mockResolvedValue("900000000000000001");
    jest
      .mocked(sendDiscordLoginCode)
      .mockRejectedValue(new Error("DISCORD_DM_FAILED"));

    await expect(startDiscordHandleUpdate(7, "keryan")).rejects.toThrow(
      "DISCORD_DM_FAILED",
    );
    expect(discardDiscordChallenge).toHaveBeenCalledWith(77);
  });

  it("dit qu'un compte supprimé est introuvable", async () => {
    fakeDb({ ...LINKED_BY_CODE, is_deleted: true });
    await expect(startDiscordHandleUpdate(7, "keryan")).rejects.toThrow(
      "PROFILE_NOT_FOUND",
    );
  });
});

describe("confirmDiscordHandleUpdate", () => {
  it("écrit le pseudo du défi, « donné par Discord », et défait la certification s'il change", async () => {
    const db = fakeDb({ ...LINKED_BY_CODE, discord_pseudo_from_discord: 0 });
    jest
      .mocked(consumeDiscordChallenge)
      .mockResolvedValue({ handle: "keryan_neuf" });

    const result = await confirmDiscordHandleUpdate(
      7,
      "900000000000000001",
      "123456",
    );

    expect(result).toEqual({ tag: "keryan_neuf" });
    expect(db.state.discord_pseudo).toBe("keryan_neuf");
    expect(db.state.discord_pseudo_from_discord).toBe(1);
    expect(db.state.discord_verified_at).toBeNull();
  });

  it("garde la certification quand le pseudo ne change pas", async () => {
    const db = fakeDb({ ...LINKED_BY_CODE });
    jest
      .mocked(consumeDiscordChallenge)
      .mockResolvedValue({ handle: "keryan" });

    await confirmDiscordHandleUpdate(7, "900000000000000001", "123456");

    expect(db.state.discord_verified_at).toEqual(CERTIFIED_AT);
  });

  it("ne réécrit pas la méthode d'un rattachement existant : `OAUTH` ne redescend jamais", async () => {
    const db = fakeDb({ ...LINKED_BY_CODE, discord_link_method: "OAUTH" });
    jest
      .mocked(consumeDiscordChallenge)
      .mockResolvedValue({ handle: "keryan" });

    await confirmDiscordHandleUpdate(7, "900000000000000001", "123456");

    expect(db.state.discord_link_method).toBe("OAUTH");
  });

  it("rattache par code un compte sans Discord", async () => {
    const db = fakeDb({ ...GOOGLE_ACCOUNT });
    jest
      .mocked(consumeDiscordChallenge)
      .mockResolvedValue({ handle: "keryan" });

    await confirmDiscordHandleUpdate(7, "900000000000000002", "123456");

    expect(db.state.discord_id).toBe("900000000000000002");
    expect(db.state.discord_link_method).toBe("DM_CODE");
    expect(db.state.discord_verified_at).toBeNull();
  });

  it("refuse un défi portant un autre compte Discord que celui rattaché, sans le consommer", async () => {
    fakeDb({ ...LINKED_BY_CODE });

    await expect(
      confirmDiscordHandleUpdate(7, "900000000000000099", "123456"),
    ).rejects.toThrow("DISCORD_ID_MISMATCH");
    expect(consumeDiscordChallenge).not.toHaveBeenCalled();
  });

  it("refuse un code faux sans rien écrire", async () => {
    const db = fakeDb({ ...LINKED_BY_CODE });
    jest.mocked(consumeDiscordChallenge).mockResolvedValue(null);

    await expect(
      confirmDiscordHandleUpdate(7, "900000000000000001", "000000"),
    ).rejects.toThrow("CODE_INVALID_OR_EXPIRED");
    expect(db.writes).toHaveLength(0);
  });

  it("refuse un défi sans pseudo (connexion par identifiant numérique)", async () => {
    const db = fakeDb({ ...LINKED_BY_CODE });
    jest.mocked(consumeDiscordChallenge).mockResolvedValue({ handle: null });

    await expect(
      confirmDiscordHandleUpdate(7, "900000000000000001", "123456"),
    ).rejects.toThrow("INVALID_DISCORD_HANDLE");
    expect(db.writes).toHaveLength(0);
  });

  it("l'écriture porte elle-même la garde : un rattachement changé entre-temps fait refuser", async () => {
    const db = fakeDb({ ...GOOGLE_ACCOUNT });
    jest.mocked(consumeDiscordChallenge).mockImplementation(async () => {
      // Pendant l'`await`, un autre Discord a été rattaché au compte.
      db.state.discord_id = "900000000000000099";
      return { handle: "keryan" };
    });

    await expect(
      confirmDiscordHandleUpdate(7, "900000000000000002", "123456"),
    ).rejects.toThrow("DISCORD_ID_MISMATCH");
    expect(db.state.discord_pseudo).toBeNull();
  });

  it("traduit la course sur l'index unique en `DISCORD_ALREADY_LINKED`", async () => {
    fakeDb({ ...GOOGLE_ACCOUNT }, null, true);
    jest
      .mocked(consumeDiscordChallenge)
      .mockResolvedValue({ handle: "keryan" });

    await expect(
      confirmDiscordHandleUpdate(7, "900000000000000002", "123456"),
    ).rejects.toThrow("DISCORD_ALREADY_LINKED");
  });
});
