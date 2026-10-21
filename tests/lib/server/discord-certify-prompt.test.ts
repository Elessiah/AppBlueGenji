import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { getDatabase } from "@/lib/server/database";
import {
  loadDiscordCertifyPrompt,
  markDiscordCertifyPromptSeen,
  recordDiscordCertifyPromptOff,
} from "@/lib/server/users/discord-certify-prompt";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

/** Fenêtre « Certifier ton tag Discord ? » — côté serveur (`bg_user_sessions.certify_prompt_due`, `bg_users.discord_certify_prompt_dismissed_at`). */

const HASH = "a".repeat(64);
const flat = (sql: unknown) => String(sql).replace(/\s+/g, " ").trim();
const unknownColumn = () => Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR" });

beforeEach(() => {
  jest.clearAllMocks();
});

describe("loadDiscordCertifyPrompt — due, et pour qui", () => {
  const setUp = (rows: unknown[]) => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([rows, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    return execute;
  };

  it("une seule requête, toutes conditions dans le WHERE (session marquée, compte vivant, non certifié, pas de « Ne plus voir »)", async () => {
    const execute = setUp([{ discord_id: null, discord_pseudo: null, discord_pseudo_from_discord: 0 }]);
    await loadDiscordCertifyPrompt(7, HASH);
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0];
    const text = flat(sql);
    for (const clause of [
      "s.token_hash = ? AND s.user_id = ?",
      "s.certify_prompt_due = 1",
      "s.expires_at > NOW()",
      "u.is_deleted = 0",
      "u.discord_verified_at IS NULL",
      "u.discord_certify_prompt_dismissed_at IS NULL",
    ]) {
      expect([clause, text.includes(clause)]).toEqual([clause, true]);
    }
    expect(params).toEqual([HASH, 7]);
  });

  it("rien de dû : null, et la marque de la session est levée (plus aucune lecture ensuite)", async () => {
    const execute = setUp([]);
    expect(await loadDiscordCertifyPrompt(7, HASH)).toBeNull();
    expect(execute).toHaveBeenCalledTimes(2);
    const [sql, params] = execute.mock.calls[1];
    expect(flat(sql)).toBe("UPDATE bg_user_sessions SET certify_prompt_due = 0 WHERE token_hash = ? AND user_id = ?");
    expect(params).toEqual([HASH, 7]);
  });

  it("tag nommé par Discord sur un compte rattaché : un clic", async () => {
    setUp([{ discord_id: "1234567890", discord_pseudo: "keryan", discord_pseudo_from_discord: 1 }]);
    expect(await loadDiscordCertifyPrompt(7, HASH)).toEqual({ mode: "ONE_CLICK", tag: "keryan" });
  });

  it("connexion Blizzard sans Discord : le dialogue de /profil", async () => {
    setUp([{ discord_id: null, discord_pseudo: null, discord_pseudo_from_discord: 0 }]);
    expect(await loadDiscordCertifyPrompt(7, HASH)).toEqual({ mode: "DIALOG", hasTag: false });
  });

  it("sans session (contournement de développement) ou identifiant invalide : aucune requête", async () => {
    const execute = setUp([]);
    expect(await loadDiscordCertifyPrompt(7, "")).toBeNull();
    expect(await loadDiscordCertifyPrompt(0, HASH)).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it("colonne absente (migration en échec) : la fenêtre se tait", async () => {
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: jest.fn<SqlQuery>().mockRejectedValue(unknownColumn()) }));
    expect(await loadDiscordCertifyPrompt(7, HASH)).toBeNull();
  });

  it("toute autre panne remonte", async () => {
    jest.mocked(getDatabase).mockResolvedValue(
      fakePool({ execute: jest.fn<SqlQuery>().mockRejectedValue(Object.assign(new Error("gone"), { code: "PROTOCOL_CONNECTION_LOST" })) }),
    );
    await expect(loadDiscordCertifyPrompt(7, HASH)).rejects.toThrow("gone");
  });
});

describe("markDiscordCertifyPromptSeen — une fois par connexion", () => {
  it("lève la marque de cette session seulement, du compte seulement", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    await markDiscordCertifyPromptSeen(7, HASH);
    expect(execute.mock.calls.map(([sql, params]) => [flat(sql), params])).toEqual([
      ["UPDATE bg_user_sessions SET certify_prompt_due = 0 WHERE token_hash = ? AND user_id = ?", [HASH, 7]],
    ]);
  });

  it("sans session : n'écrit rien (une empreinte vide désignerait toutes les sessions)", async () => {
    const execute = jest.fn<SqlQuery>();
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    await markDiscordCertifyPromptSeen(7, "");
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("recordDiscordCertifyPromptOff — « Ne plus voir »", () => {
  it("posé sur le compte vivant, date du premier choix gardée, en une instruction", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    expect(await recordDiscordCertifyPromptOff(7)).toBe(true);
    expect(execute.mock.calls.map(([sql, params]) => [flat(sql), params])).toEqual([
      [
        "UPDATE bg_users SET discord_certify_prompt_dismissed_at = COALESCE(discord_certify_prompt_dismissed_at, NOW()) WHERE id = ? AND is_deleted = 0",
        [7],
      ],
    ]);
  });

  it("compte supprimé : false", async () => {
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 0 }, []]) }));
    expect(await recordDiscordCertifyPromptOff(7)).toBe(false);
  });

  it("identifiant invalide : rien n'est écrit", async () => {
    const execute = jest.fn<SqlQuery>();
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    expect(await recordDiscordCertifyPromptOff(-1)).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});
