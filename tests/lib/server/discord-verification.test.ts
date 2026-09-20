import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/users-service", () => {
  const actual = jest.requireActual<typeof import("@/lib/server/users-service")>(
    "@/lib/server/users-service",
  );
  return {
    // `normalizeDiscordHandle` reste **la vraie** : c'est elle qui décide qu'un
    // identifiant numérique n'est pas un tag, et la remplacer par un bouchon
    // ferait passer ce test sans rien prouver de la règle.
    normalizeDiscordHandle: actual.normalizeDiscordHandle,
    createDiscordLoginChallenge: jest.fn(),
    consumeDiscordChallenge: jest.fn(),
    discardDiscordChallenge: jest.fn(),
  };
});

import {
  confirmDiscordVerification,
  getDiscordAccountState,
  startDiscordVerification,
} from "@/lib/server/discord-verification";
import { getDatabase } from "@/lib/server/database";
import { resolveDiscordUser, sendDiscordLoginCode } from "@/lib/server/bot-integration";
import {
  consumeDiscordChallenge,
  createDiscordLoginChallenge,
  discardDiscordChallenge,
} from "@/lib/server/users-service";

/**
 * La certification du tag Discord.
 *
 * Quatre propriétés, et chacune correspond à une panne qu'on veut interdire :
 *
 * 1. **un compte déjà relié se certifie sans code** — lui en redemander un
 *    rejouerait une preuve qu'on détient ;
 * 2. **on ne déplace jamais une porte d'entrée** — `discord_id` est un moyen de
 *    connexion, un tag qui résout ailleurs est refusé, pas rattaché ;
 * 3. **le tag écrit est celui du défi**, jamais celui que le client renvoie à la
 *    confirmation ;
 * 4. **un envoi raté ne laisse pas sa ligne**, faute de quoi la mort-née
 *    masquerait comme « dernier émis » le code que le joueur détient.
 *
 * Voir `docs/features/DISCORD_VERIFICATION.md`.
 */

type UserState = {
  discord_id: string | null;
  discord_pseudo: string | null;
  discord_verified_at: Date | null;
};

const resolveMock = resolveDiscordUser as jest.MockedFunction<typeof resolveDiscordUser>;
const sendMock = sendDiscordLoginCode as jest.MockedFunction<typeof sendDiscordLoginCode>;
const createChallengeMock = createDiscordLoginChallenge as jest.MockedFunction<
  typeof createDiscordLoginChallenge
>;
const consumeMock = consumeDiscordChallenge as jest.MockedFunction<typeof consumeDiscordChallenge>;
const discardMock = discardDiscordChallenge as jest.MockedFunction<typeof discardDiscordChallenge>;

/**
 * Base factice qui **rejoue** l'écriture de certification plutôt que de la
 * compter : ce qui nous intéresse est la ligne obtenue (identifiant posé une
 * seule fois, tag, date), pas le nombre d'appels.
 */
function fakeDb(state: UserState, otherAccountHolds: string | null = null) {
  const writes: { sql: string; params: unknown[] }[] = [];
  const execute = jest.fn(async (sql: string, params: unknown[] = []) => {
    const q = String(sql).replace(/\s+/g, " ").trim();

    if (q.startsWith("SELECT discord_id, discord_pseudo, discord_verified_at")) {
      return [[{ ...state }]];
    }

    if (q.startsWith("SELECT id FROM bg_users WHERE discord_id = ? AND id <> ?")) {
      return [otherAccountHolds !== null && params[0] === otherAccountHolds ? [{ id: 1234 }] : []];
    }

    if (q.startsWith("UPDATE bg_users")) {
      writes.push({ sql: q, params });
      // `COALESCE(discord_id, ?)` : l'identifiant n'est posé que s'il manquait.
      state.discord_id = state.discord_id ?? String(params[0]);
      state.discord_pseudo = String(params[1]);
      state.discord_verified_at = new Date("2026-09-20T12:00:00Z");
      return [{ affectedRows: 1 }];
    }

    throw new Error(`requête inattendue : ${q}`);
  });

  (getDatabase as jest.Mock).mockResolvedValue({ execute } as never);
  return { state, writes, execute };
}

const GOOGLE_ACCOUNT: UserState = {
  discord_id: null,
  discord_pseudo: null,
  discord_verified_at: null,
};

const LINKED_ACCOUNT: UserState = {
  discord_id: "900000000000000001",
  discord_pseudo: null,
  discord_verified_at: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  createChallengeMock.mockResolvedValue({
    challengeId: 77,
    code: "123456",
    expiresAt: new Date("2026-09-20T12:10:00Z"),
  });
  sendMock.mockResolvedValue(undefined);
  discardMock.mockResolvedValue(undefined);
});

describe("startDiscordVerification — le compte déjà relié à Discord", () => {
  it("certifie sur place, sans message privé", async () => {
    // « La pression d'un bouton » : l'identifiant a été prouvé à la connexion,
    // le site n'a plus qu'à vérifier que le tag saisi le désigne.
    const db = fakeDb({ ...LINKED_ACCOUNT });
    resolveMock.mockResolvedValue("900000000000000001");

    const result = await startDiscordVerification(7, "keryan");

    expect(result).toEqual({ status: "VERIFIED", tag: "keryan" });
    expect(createChallengeMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    expect(db.state.discord_pseudo).toBe("keryan");
    expect(db.state.discord_verified_at).not.toBeNull();
  });

  it("refuse un tag qui désigne un autre compte Discord, sans rien écrire", async () => {
    // On ne déplace jamais une porte d'entrée : `discord_id` est un moyen de
    // connexion, le rattacher ailleurs déplacerait la serrure.
    const db = fakeDb({ ...LINKED_ACCOUNT });
    resolveMock.mockResolvedValue("111111111111111111");

    await expect(startDiscordVerification(7, "quelquun_dautre")).rejects.toThrow(
      "DISCORD_ID_MISMATCH",
    );
    expect(db.writes).toHaveLength(0);
    expect(createChallengeMock).not.toHaveBeenCalled();
  });
});

describe("startDiscordVerification — le compte Google", () => {
  it("envoie un code, et transmet le tag au défi", async () => {
    // Le tag part **avec le défi** : c'est cette ligne qui portera la preuve, et
    // c'est de là que la confirmation relira le tag à écrire.
    const db = fakeDb({ ...GOOGLE_ACCOUNT });
    resolveMock.mockResolvedValue("900000000000000002");

    const result = await startDiscordVerification(7, "@keryan");

    expect(result).toEqual({
      status: "CODE_SENT",
      discordId: "900000000000000002",
      expiresAt: "2026-09-20T12:10:00.000Z",
    });
    expect(createChallengeMock).toHaveBeenCalledWith("900000000000000002", "keryan");
    expect(sendMock).toHaveBeenCalledWith("900000000000000002", "123456");
    // Rien n'est certifié avant le code.
    expect(db.writes).toHaveLength(0);
  });

  it("efface le défi quand l'envoi échoue", async () => {
    // Sinon la ligne mort-née reste « la dernière émise » et masque le code que
    // le joueur détient d'une demande précédente.
    fakeDb({ ...GOOGLE_ACCOUNT });
    resolveMock.mockResolvedValue("900000000000000002");
    sendMock.mockRejectedValue(new Error("DISCORD_DM_FAILED"));

    await expect(startDiscordVerification(7, "keryan")).rejects.toThrow("DISCORD_DM_FAILED");
    expect(discardMock).toHaveBeenCalledWith(77);
  });

  it("refuse un Discord déjà certifié par un autre compte du site", async () => {
    fakeDb({ ...GOOGLE_ACCOUNT }, "900000000000000009");
    resolveMock.mockResolvedValue("900000000000000009");

    await expect(startDiscordVerification(7, "keryan")).rejects.toThrow("DISCORD_ALREADY_LINKED");
    expect(createChallengeMock).not.toHaveBeenCalled();
  });
});

describe("startDiscordVerification — ce qui n'est pas un tag", () => {
  it.each([["900000000000000001"], [""], ["   "], ["@"]])(
    "refuse « %s » sans même interroger le bot",
    async (handle) => {
      fakeDb({ ...GOOGLE_ACCOUNT });

      await expect(startDiscordVerification(7, handle)).rejects.toThrow("INVALID_DISCORD_HANDLE");
      // La connexion accepte un identifiant numérique en repli ; la
      // certification publie un pseudo à l'arbitrage, elle ne peut pas.
      expect(resolveMock).not.toHaveBeenCalled();
    },
  );
});

describe("confirmDiscordVerification", () => {
  it("écrit le tag du défi, pas celui que le client renvoie", async () => {
    const db = fakeDb({ ...GOOGLE_ACCOUNT });
    consumeMock.mockResolvedValue({ handle: "keryan" });

    const result = await confirmDiscordVerification(7, "900000000000000002", "123456");

    expect(result).toEqual({ tag: "keryan" });
    expect(db.state.discord_pseudo).toBe("keryan");
    expect(db.state.discord_id).toBe("900000000000000002");
    expect(db.state.discord_verified_at).not.toBeNull();
  });

  it("refuse un code faux sans rien écrire", async () => {
    const db = fakeDb({ ...GOOGLE_ACCOUNT });
    consumeMock.mockResolvedValue(null);

    await expect(confirmDiscordVerification(7, "900000000000000002", "000000")).rejects.toThrow(
      "CODE_INVALID_OR_EXPIRED",
    );
    expect(db.writes).toHaveLength(0);
  });

  it("refuse un défi sans tag : il vient de la page de connexion", async () => {
    // Une demande faite par identifiant numérique n'a aucun tag à certifier.
    const db = fakeDb({ ...GOOGLE_ACCOUNT });
    consumeMock.mockResolvedValue({ handle: null });

    await expect(confirmDiscordVerification(7, "900000000000000002", "123456")).rejects.toThrow(
      "INVALID_DISCORD_HANDLE",
    );
    expect(db.writes).toHaveLength(0);
  });

  it("relit l'état du compte : un rattachement survenu entre-temps fait refuser", async () => {
    const db = fakeDb({ ...LINKED_ACCOUNT });
    consumeMock.mockResolvedValue({ handle: "keryan" });

    await expect(confirmDiscordVerification(7, "111111111111111111", "123456")).rejects.toThrow(
      "DISCORD_ID_MISMATCH",
    );
    // Le code n'est même pas consommé : on refuse avant de brûler un essai.
    expect(consumeMock).not.toHaveBeenCalled();
    expect(db.writes).toHaveLength(0);
  });
});

describe("getDiscordAccountState", () => {
  it("dit le tag, sa certification, et si un identifiant est rattaché", async () => {
    fakeDb({
      discord_id: "900000000000000001",
      discord_pseudo: "keryan",
      discord_verified_at: new Date("2026-09-01T00:00:00Z"),
    });

    expect(await getDiscordAccountState(7)).toEqual({
      tag: "keryan",
      verified: true,
      linked: true,
    });
  });

  it("distingue « tag saisi » de « tag prouvé »", async () => {
    // C'est l'état de tous les comptes d'avant la certification : un tag en
    // base, aucune preuve, et donc aucune exposition.
    fakeDb({ discord_id: null, discord_pseudo: "tag_non_prouve", discord_verified_at: null });

    expect(await getDiscordAccountState(7)).toEqual({
      tag: "tag_non_prouve",
      verified: false,
      linked: false,
    });
  });
});
