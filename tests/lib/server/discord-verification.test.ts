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
    consumeDiscordLoginChallenge: jest.fn(),
    discardDiscordChallenge: jest.fn(),
  };
});

import {
  certifyLinkedDiscordTag,
  confirmDiscordVerification,
  getDiscordAccountState,
  startDiscordVerification,
} from "@/lib/server/discord-verification";
import { getDatabase } from "@/lib/server/database";
import { resolveDiscordUser, sendDiscordLoginCode } from "@/lib/server/bot-integration";
import {
  consumeDiscordLoginChallenge,
  createDiscordLoginChallenge,
  discardDiscordChallenge,
} from "@/lib/server/users-service";
import { fakePool } from "../../helpers/sql-double";

/**
 * La certification du tag Discord.
 *
 * Quatre propriétés, et chacune correspond à une panne qu'on veut interdire :
 *
 * 1. **un compte déjà relié se certifie d'un clic** — lui redemander une preuve
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
  discord_pseudo_from_discord: number;
};

const resolveMock = resolveDiscordUser as jest.MockedFunction<typeof resolveDiscordUser>;
const sendMock = sendDiscordLoginCode as jest.MockedFunction<typeof sendDiscordLoginCode>;
const createChallengeMock = createDiscordLoginChallenge as jest.MockedFunction<
  typeof createDiscordLoginChallenge
>;
const consumeMock = consumeDiscordLoginChallenge as jest.MockedFunction<
  typeof consumeDiscordLoginChallenge
>;

/** Jeton du défi rendu à la demande — et seul moyen de le désigner ensuite. */
const CHALLENGE = "t".repeat(32);
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

    if (q.startsWith("SELECT discord_id, discord_pseudo, discord_verified_at, discord_pseudo_from_discord")) {
      return [[{ ...state }]];
    }


    // Certification en un clic : rejoue les conditions du `WHERE`, qui sont
    // toute la règle — rattaché, pseudo nommé par Discord, même tag.
    if (q.startsWith("UPDATE bg_users SET discord_verified_at = COALESCE(discord_verified_at, NOW())")) {
      writes.push({ sql: q, params });
      const matches =
        state.discord_id !== null &&
        state.discord_pseudo_from_discord === 1 &&
        state.discord_pseudo === params[1];
      if (matches) state.discord_verified_at ??= new Date("2026-09-20T12:00:00Z");
      return [{ affectedRows: matches ? 1 : 0 }];
    }

    if (q.startsWith("UPDATE bg_users")) {
      // L'index unique de `bg_users.discord_id` : c'est lui, et lui seul, qui
      // refuse un Discord détenu par un autre compte du site.
      if (state.discord_id === null && otherAccountHolds !== null && params[0] === otherAccountHolds) {
        throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
      }
      writes.push({ sql: q, params });
      // `COALESCE(discord_id, ?)` : l'identifiant n'est posé que s'il manquait.
      state.discord_id = state.discord_id ?? String(params[0]);
      state.discord_pseudo = String(params[1]);
      state.discord_verified_at = new Date("2026-09-20T12:00:00Z");
      state.discord_pseudo_from_discord = 1;
      return [{ affectedRows: 1 }];
    }

    throw new Error(`requête inattendue : ${q}`);
  });

  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return { state, writes, execute };
}

const GOOGLE_ACCOUNT: UserState = {
  discord_id: null,
  discord_pseudo: null,
  discord_verified_at: null,
  discord_pseudo_from_discord: 0,
};

/** Compte relié dont la connexion a enregistré le pseudo nommé par Discord. */
const LINKED_ACCOUNT: UserState = {
  discord_id: "900000000000000001",
  discord_pseudo: "keryan",
  discord_verified_at: null,
  discord_pseudo_from_discord: 1,
};

beforeEach(() => {
  jest.clearAllMocks();
  createChallengeMock.mockResolvedValue({
    challengeId: 77,
    challengeToken: "t".repeat(32),
    code: "123456",
    expiresAt: new Date("2026-09-20T12:10:00Z"),
  });
  sendMock.mockResolvedValue(undefined);
  discardMock.mockResolvedValue(undefined);
});

describe("startDiscordVerification — le compte déjà relié à Discord", () => {
  it("certifie d'un clic le pseudo nommé par Discord : ni bot, ni code", async () => {
    // La preuve est faite à la connexion ; le clic n'apporte que le
    // consentement.
    const db = fakeDb({ ...LINKED_ACCOUNT });

    const result = await startDiscordVerification(7, "keryan");

    expect(result).toEqual({ status: "VERIFIED", tag: "keryan" });
    expect(resolveMock).not.toHaveBeenCalled();
    expect(createChallengeMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    expect(db.state.discord_verified_at).not.toBeNull();
  });

  it("n'écrit jamais le tag envoyé par le client, il ne sert que de garde", async () => {
    const db = fakeDb({ ...LINKED_ACCOUNT });

    await startDiscordVerification(7, "keryan");

    const [update] = db.writes;
    expect(update.sql).not.toMatch(/discord_pseudo\s*=\s*\?,/);
    expect(update.sql).toContain("AND discord_pseudo = ?");
    expect(update.sql).toContain("AND discord_pseudo_from_discord = 1");
    expect(update.sql).toContain("AND discord_id IS NOT NULL");
    expect(update.sql).toContain("is_deleted = 0");
    expect(update.params).toEqual([7, "keryan"]);
  });

  it("refuse un tag que l'écran montrait mais qui a changé depuis", async () => {
    // Une connexion depuis un autre appareil a réenregistré un autre pseudo.
    const db = fakeDb({ ...LINKED_ACCOUNT, discord_pseudo: "nouveau_pseudo" });

    await expect(startDiscordVerification(7, "keryan")).rejects.toThrow("DISCORD_TAG_CHANGED");
    expect(db.state.discord_verified_at).toBeNull();
  });

  it("refuse un tag tapé à la main : il n'a pas été nommé par Discord", async () => {
    const db = fakeDb({ ...LINKED_ACCOUNT, discord_pseudo_from_discord: 0 });

    await expect(startDiscordVerification(7, "keryan")).rejects.toThrow(
      "DISCORD_TAG_NOT_ATTESTED",
    );
    expect(db.state.discord_verified_at).toBeNull();
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("refuse quand aucun tag n'est enregistré", async () => {
    fakeDb({ ...LINKED_ACCOUNT, discord_pseudo: null });

    await expect(startDiscordVerification(7, "")).rejects.toThrow("DISCORD_TAG_MISSING");
  });

  it("ne rejette pas un tag déjà certifié : le geste est idempotent", async () => {
    const certifiedAt = new Date("2026-01-01T00:00:00Z");
    const db = fakeDb({ ...LINKED_ACCOUNT, discord_verified_at: certifiedAt });

    await expect(startDiscordVerification(7, "keryan")).resolves.toEqual({
      status: "VERIFIED",
      tag: "keryan",
    });
    // `COALESCE` : la date d'origine n'est pas réécrite.
    expect(db.state.discord_verified_at).toBe(certifiedAt);
  });
});

describe("certifyLinkedDiscordTag", () => {
  it("dit qu'un compte détaché entre-temps n'a plus de Discord", async () => {
    fakeDb({ ...GOOGLE_ACCOUNT, discord_pseudo: "keryan", discord_pseudo_from_discord: 1 });

    await expect(certifyLinkedDiscordTag(7, "keryan")).rejects.toThrow("DISCORD_NOT_LINKED");
  });

  it("dit qu'un compte supprimé est introuvable", async () => {
    const { execute } = fakeDb({ ...LINKED_ACCOUNT });
    execute.mockImplementation(async (sql: string) =>
      String(sql).includes("UPDATE") ? [{ affectedRows: 0 }] : [[]],
    );

    await expect(certifyLinkedDiscordTag(7, "keryan")).rejects.toThrow("PROFILE_NOT_FOUND");
  });
});

describe("startDiscordVerification — le compte Google", () => {
  it("envoie un code, et transmet le tag au défi", async () => {
    // Le tag part **avec le défi** : c'est cette ligne qui portera la preuve, et
    // c'est de là que la confirmation relira le tag à écrire.
    const db = fakeDb({ ...GOOGLE_ACCOUNT });
    resolveMock.mockResolvedValue("900000000000000002");

    const result = await startDiscordVerification(7, "@keryan");

    // Le jeton du défi, **jamais l'identifiant résolu** : la demande n'est pas
    // un oracle qui dirait quel compte Discord porte ce pseudo.
    expect(result).toEqual({
      status: "CODE_SENT",
      challenge: CHALLENGE,
      expiresAt: "2026-09-20T12:10:00.000Z",
    });
    expect(result).not.toHaveProperty("discordId");
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

  /**
   * **La demande n'est pas un oracle.** Qu'un autre compte du site détienne ce
   * Discord ou non, la réponse a la même forme : le refus rendu ici, avant tout
   * message privé, disait à n'importe quel membre si une personne nommée avait
   * un compte BlueGenji. Il ne vient qu'à la confirmation, à qui détient le code.
   */
  it("répond de la même façon qu'un autre compte détienne ce Discord ou non", async () => {
    fakeDb({ ...GOOGLE_ACCOUNT }, "900000000000000009");
    resolveMock.mockResolvedValue("900000000000000009");
    const held = await startDiscordVerification(7, "keryan");

    fakeDb({ ...GOOGLE_ACCOUNT });
    const free = await startDiscordVerification(7, "keryan");

    expect(held).toEqual(free);
    expect(createChallengeMock).toHaveBeenCalledTimes(2);
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
    consumeMock.mockResolvedValue({ handle: "keryan", discordId: "900000000000000002" });

    const result = await confirmDiscordVerification(7, CHALLENGE, "123456");

    expect(result).toEqual({ tag: "keryan" });
    // Le défi est désigné par son jeton ; l'identifiant vient de sa ligne.
    expect(consumeMock).toHaveBeenCalledWith(CHALLENGE, "123456");
    expect(db.state.discord_pseudo).toBe("keryan");
    expect(db.state.discord_verified_at).not.toBeNull();
  });

  /**
   * **Certifier ouvre la porte Discord à un compte Google.**
   *
   * C'est la seconde moitié de ce que la certification apporte : le compte
   * repart avec un `discord_id`, et `createOrGetDiscordUser` — qui cherche
   * exactement sur cette colonne — le retrouvera à la prochaine connexion par
   * code. Un compte né par Google devient donc joignable par les deux portes,
   * sans qu'aucune route de connexion n'ait à connaître la certification.
   */
  it("rattache l'identifiant au compte : il pourra désormais se connecter par Discord", async () => {
    const db = fakeDb({ ...GOOGLE_ACCOUNT });
    consumeMock.mockResolvedValue({ handle: "keryan", discordId: "900000000000000002" });

    await confirmDiscordVerification(7, CHALLENGE, "123456");

    expect(db.state.discord_id).toBe("900000000000000002");
  });

  it("refuse à la confirmation un Discord détenu par un autre compte du site", async () => {
    // Le refus retiré de la demande : l'index unique le tranche à l'écriture.
    const db = fakeDb({ ...GOOGLE_ACCOUNT }, "900000000000000009");
    consumeMock.mockResolvedValue({ handle: "keryan", discordId: "900000000000000009" });

    await expect(confirmDiscordVerification(7, CHALLENGE, "123456")).rejects.toThrow(
      "DISCORD_ALREADY_LINKED",
    );
    expect(db.state.discord_id).toBeNull();
  });

  it("ne déplace pas un identifiant déjà posé : `COALESCE` le préserve", async () => {
    // Le cas ne devrait pas survenir (la garde de mismatch l'a écarté), mais
    // l'écriture elle-même doit le refuser : une porte d'entrée ne se déplace
    // pas, même par accident.
    const db = fakeDb({ ...LINKED_ACCOUNT });
    consumeMock.mockResolvedValue({ handle: "keryan", discordId: "900000000000000001" });

    await confirmDiscordVerification(7, CHALLENGE, "123456");

    expect(db.state.discord_id).toBe("900000000000000001");
    expect(db.writes[0].sql).toContain("discord_id = COALESCE(discord_id, ?)");
    // Et la méthode d'un rattachement déjà noué n'est pas réécrite.
    expect(db.writes[0].sql).toContain("discord_link_method = COALESCE(discord_link_method, ?)");
    expect(db.writes[0].sql).toContain("discord_pseudo_from_discord = 1");
  });

  it("refuse un code faux sans rien écrire", async () => {
    const db = fakeDb({ ...GOOGLE_ACCOUNT });
    consumeMock.mockResolvedValue(null);

    await expect(confirmDiscordVerification(7, CHALLENGE, "000000")).rejects.toThrow(
      "CODE_INVALID_OR_EXPIRED",
    );
    expect(db.writes).toHaveLength(0);
  });

  it("refuse un défi sans tag : il vient de la page de connexion", async () => {
    // Une demande faite par identifiant numérique n'a aucun tag à certifier.
    const db = fakeDb({ ...GOOGLE_ACCOUNT });
    consumeMock.mockResolvedValue({ handle: null, discordId: "900000000000000002" });

    await expect(confirmDiscordVerification(7, CHALLENGE, "123456")).rejects.toThrow(
      "INVALID_DISCORD_HANDLE",
    );
    expect(db.writes).toHaveLength(0);
  });

  it("relit l'état du compte : un rattachement survenu entre-temps fait refuser", async () => {
    const db = fakeDb({ ...LINKED_ACCOUNT });
    consumeMock.mockResolvedValue({ handle: "keryan", discordId: "111111111111111111" });

    await expect(confirmDiscordVerification(7, CHALLENGE, "123456")).rejects.toThrow(
      "DISCORD_ID_MISMATCH",
    );
    // L'identifiant n'est connu qu'une fois le défi consommé : le refus vient
    // après, mais rien n'est écrit.
    expect(db.writes).toHaveLength(0);

  });
});

describe("getDiscordAccountState", () => {
  it("dit le tag, sa certification, et si un identifiant est rattaché", async () => {
    fakeDb({
      discord_id: "900000000000000001",
      discord_pseudo: "keryan",
      discord_verified_at: new Date("2026-09-01T00:00:00Z"),
      discord_pseudo_from_discord: 1,
    });

    expect(await getDiscordAccountState(7)).toEqual({
      tag: "keryan",
      verified: true,
      linked: true,
      attested: true,
    });
  });

  it("distingue « tag saisi » de « tag prouvé »", async () => {
    // C'est l'état de tous les comptes d'avant la certification : un tag en
    // base, aucune preuve, et donc aucune exposition.
    fakeDb({
      discord_id: null,
      discord_pseudo: "tag_non_prouve",
      discord_verified_at: null,
      discord_pseudo_from_discord: 0,
    });

    expect(await getDiscordAccountState(7)).toEqual({
      tag: "tag_non_prouve",
      verified: false,
      linked: false,
      attested: false,
    });
  });

  it("ne dit pas « nommé par Discord » sans tag", async () => {
    fakeDb({ ...LINKED_ACCOUNT, discord_pseudo: null });

    expect((await getDiscordAccountState(7)).attested).toBe(false);
  });
});

/**
 * Le garde posé sur l'identifiant résolu.
 *
 * C'est par lui que la route plafonne le compte Discord **visé** — celui dont le
 * téléphone sonne. Il ne peut être appelé qu'ici : l'identifiant n'est connu
 * qu'après la résolution du tag, et le plafond doit tomber **avant** l'envoi,
 * sinon il ne refuse rien.
 */
describe("startDiscordVerification — le garde d'avant-envoi", () => {
  it("est appelé avec l'identifiant résolu, avant le défi et avant l'envoi", async () => {
    fakeDb({ ...GOOGLE_ACCOUNT });
    resolveMock.mockResolvedValue("900000000000000002");
    const order: string[] = [];
    createChallengeMock.mockImplementation(async () => {
      order.push("défi");
      return { challengeId: 77, challengeToken: "t".repeat(32), code: "123456", expiresAt: new Date() };
    });
    sendMock.mockImplementation(async () => {
      order.push("envoi");
    });

    await startDiscordVerification(7, "keryan", (discordId) => {
      order.push(`garde:${discordId}`);
    });

    expect(order).toEqual(["garde:900000000000000002", "défi", "envoi"]);
  });

  it("laisse son refus remonter, sans créer de défi ni envoyer quoi que ce soit", async () => {
    fakeDb({ ...GOOGLE_ACCOUNT });
    resolveMock.mockResolvedValue("900000000000000002");

    await expect(
      startDiscordVerification(7, "keryan", () => {
        throw new Error("TOO_MANY_CODE_REQUESTS");
      }),
    ).rejects.toThrow("TOO_MANY_CODE_REQUESTS");

    expect(createChallengeMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("n'est pas appelé sur le chemin sans code : personne n'est dérangé", async () => {
    // Une certification immédiate ne fait sonner aucun téléphone — charger le
    // seau du compte visé fermerait sa connexion Discord pour rien.
    fakeDb({ ...LINKED_ACCOUNT });
    resolveMock.mockResolvedValue("900000000000000001");
    const guard = jest.fn();

    await startDiscordVerification(7, "keryan", guard);

    expect(guard).not.toHaveBeenCalled();
  });
});
