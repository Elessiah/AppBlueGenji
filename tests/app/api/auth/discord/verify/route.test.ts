import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users-service");

import { POST } from "@/app/api/auth/discord/verify/route";
import { createSession } from "@/lib/server/auth";
import { consumeDiscordLoginChallenge, createOrGetDiscordUser } from "@/lib/server/users-service";
import { DISCORD_CODE_VERIFY_RULE } from "@/lib/server/api-guard";
import { resetRateLimit } from "@/lib/server/rate-limit";

/**
 * Le plafond de vérification, et **l'axe sur lequel il est posé**.
 *
 * La route est anonyme : un plafond porté sur le seul défi (ou compte) visé
 * désigne la **victime**, et dix codes bidon suffisent à lui fermer sa propre
 * connexion pour un quart d'heure. La clé est le couple (défi visé, IP
 * appelante) — l'attaquant ne ferme la porte qu'à lui-même. Voir
 * `docs/AUTHORIZATION_RULES.md` §1.1.
 *
 * Le défi est désigné par **son numéro** : la demande de code ne publie plus
 * l'identifiant Discord (c'était un oracle), que la route relit du défi une
 * fois le code juste.
 */

const verifyMock = jest.mocked(consumeDiscordLoginChallenge);
const createUserMock = jest.mocked(createOrGetDiscordUser);
const createSessionMock = jest.mocked(createSession);

const VICTIM_CHALLENGE = 7;
const OTHER_CHALLENGE = 8;
const VICTIM_DISCORD = "999888777666555444";
const ATTACKER_IP = "203.0.113.7";
const VICTIM_IP = "198.51.100.42";

function request(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost:3000/api/auth/discord/verify", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function attempt(challengeId: unknown, code: string, ip: string | null = ATTACKER_IP) {
  return request({ challengeId, code }, ip === null ? {} : { "x-forwarded-for": ip });
}

const exhaust = async (challengeId: number, ip: string) => {
  for (let i = 0; i < DISCORD_CODE_VERIFY_RULE.limit; i += 1) {
    await attempt(challengeId, "000000", ip);
  }
};

describe("POST /api/auth/discord/verify — plafond d'énumération", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimit(DISCORD_CODE_VERIFY_RULE.name);
    verifyMock.mockResolvedValue(null);
    createUserMock.mockResolvedValue(42);
    createSessionMock.mockResolvedValue(undefined);
  });

  it("refuse un code faux en 401, puis coupe court en 429", async () => {
    for (let i = 0; i < DISCORD_CODE_VERIFY_RULE.limit; i += 1) {
      expect((await attempt(VICTIM_CHALLENGE, "000000")).status).toBe(401);
    }

    const blocked = await attempt(VICTIM_CHALLENGE, "000000");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });

  it("ne consulte plus la base une fois le plafond atteint", async () => {
    await exhaust(VICTIM_CHALLENGE, ATTACKER_IP);
    verifyMock.mockClear();

    await attempt(VICTIM_CHALLENGE, "000000");
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("laisse la victime se connecter pendant qu'un tiers épuise son quota", async () => {
    // **Le cœur de la règle.** Sur l'axe du seul défi visé, cette ligne
    // rendait 429 : l'attaquant fermait la connexion de quelqu'un d'autre avec
    // dix requêtes non authentifiées, sans jamais rien tenter de plausible.
    await exhaust(VICTIM_CHALLENGE, ATTACKER_IP);
    verifyMock.mockResolvedValue({ discordId: VICTIM_DISCORD, handle: "keryan" });

    const res = await attempt(VICTIM_CHALLENGE, "424242", VICTIM_IP);

    expect(res.status).toBe(200);
    expect(createSessionMock).toHaveBeenCalledWith(42);
  });

  it("ne rend pas un essai de plus à l'attaquant qui change de défi", async () => {
    await exhaust(VICTIM_CHALLENGE, ATTACKER_IP);

    expect((await attempt(OTHER_CHALLENGE, "000000", ATTACKER_IP)).status).toBe(401);
    expect((await attempt(VICTIM_CHALLENGE, "000000", ATTACKER_IP)).status).toBe(429);
  });

  it("ne plafonne pas du tout quand aucune IP n'est lisible", async () => {
    // Règle de la maison (`enforceRateLimit`) : une identité absente n'est pas
    // plafonnée. Le quota d'essais du code, lui, reste en base et ne dépend
    // d'aucun en-tête.
    for (let i = 0; i < DISCORD_CODE_VERIFY_RULE.limit * 2; i += 1) {
      expect((await attempt(VICTIM_CHALLENGE, "000000", null)).status).toBe(401);
    }
  });

  it("laisse passer le bon code tant que le plafond n'est pas atteint", async () => {
    verifyMock.mockResolvedValue({ discordId: VICTIM_DISCORD, handle: "keryan" });
    const res = await attempt(VICTIM_CHALLENGE, "424242");

    expect(res.status).toBe(200);
    expect(verifyMock).toHaveBeenCalledWith(VICTIM_CHALLENGE, "424242");
    expect(createSessionMock).toHaveBeenCalledWith(42);
  });

  it("ouvre le compte **du défi** et transmet le tag prouvé", async () => {
    // L'identifiant vient de la ligne du défi, jamais du client : un
    // `discordId` glissé dans le corps n'a plus aucun effet.
    verifyMock.mockResolvedValue({ discordId: VICTIM_DISCORD, handle: "keryan" });

    await request(
      { challengeId: VICTIM_CHALLENGE, code: "424242", discordId: "111111111111111111" },
      { "x-forwarded-for": ATTACKER_IP },
    );

    // Et la porte est nommée : ce chemin-ci ne laisse **aucune** autorisation
    // d'application chez Discord, à la différence du bouton.
    expect(createUserMock).toHaveBeenCalledWith(VICTIM_DISCORD, undefined, "keryan", {
      method: "DM_CODE",
      // Aucune case cochée dans ce corps : un compte existant se connecte, un
      // compte neuf serait refusé par le service (`TERMS_REQUIRED`).
      termsAccepted: false,
    });
  });

  it("plafonne après la validation de forme, pas avant", async () => {
    // Un corps mal formé ne doit pas consommer le quota : sinon n'importe qui
    // épuiserait les essais d'autrui sans même tenter un code.
    for (let i = 0; i < DISCORD_CODE_VERIFY_RULE.limit * 2; i += 1) {
      expect((await attempt(VICTIM_CHALLENGE, "12")).status).toBe(400);
    }

    expect((await attempt(VICTIM_CHALLENGE, "000000")).status).toBe(401);
  });

  it.each<[string, unknown]>([
    ["absent", undefined],
    ["nul", 0],
    ["négatif", -3],
    ["décimal", 1.5],
    ["texte", "abc"],
  ])("refuse un numéro de défi %s en 400, sans rien consulter", async (_label, challengeId) => {
    const res = await attempt(challengeId, "424242");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_CHALLENGE" });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("accepte un numéro de défi transmis en chaîne", async () => {
    verifyMock.mockResolvedValue({ discordId: VICTIM_DISCORD, handle: null });

    expect((await attempt("7", "424242")).status).toBe(200);
    expect(verifyMock).toHaveBeenCalledWith(7, "424242");
  });
});

describe("POST /api/auth/discord/verify — CSRF de connexion", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimit(DISCORD_CODE_VERIFY_RULE.name);
    verifyMock.mockResolvedValue({ discordId: VICTIM_DISCORD, handle: "keryan" });
    createUserMock.mockResolvedValue(42);
    createSessionMock.mockResolvedValue(undefined);
  });

  it("refuse le formulaire `text/plain` d'un autre site, sans ouvrir de session", async () => {
    // Le nom de champ reconstitue un JSON valide : `req.json()` l'acceptait, et
    // la victime se retrouvait connectée au compte de l'attaquant.
    const res = await request('{"challengeId":7,"code":"424242","x":"="}', {
      "content-type": "text/plain",
      "sec-fetch-site": "cross-site",
      origin: "https://attaquant.example",
    });

    expect(res.status).toBe(403);
    expect(verifyMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("refuse le même formulaire sur un navigateur qui ne pose aucun en-tête de provenance", async () => {
    const res = await request('{"challengeId":7,"code":"424242","x":"="}', {
      "content-type": "text/plain",
    });

    expect(res.status).toBe(415);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("laisse passer la page de connexion du site", async () => {
    const res = await request(
      { challengeId: VICTIM_CHALLENGE, code: "424242" },
      { "sec-fetch-site": "same-origin", origin: "http://localhost:3000" },
    );

    expect(res.status).toBe(200);
    expect(createSessionMock).toHaveBeenCalledWith(42);
  });
});
