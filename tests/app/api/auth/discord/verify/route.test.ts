import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users-service");

import { POST } from "@/app/api/auth/discord/verify/route";
import { createSession } from "@/lib/server/auth";
import { consumeDiscordChallenge, createOrGetDiscordUser } from "@/lib/server/users-service";
import { DISCORD_CODE_VERIFY_RULE } from "@/lib/server/api-guard";
import { resetRateLimit } from "@/lib/server/rate-limit";

/**
 * Le plafond de vérification, et **l'axe sur lequel il est posé**.
 *
 * La route est anonyme et l'identifiant Discord d'un joueur se lit dans la
 * réponse de `/api/auth/discord/request` : un plafond porté sur le seul compte
 * visé désigne donc la **victime**, et dix codes bidon suffisent à lui fermer sa
 * propre connexion pour un quart d'heure. La clé est le couple
 * (compte visé, IP appelante) — l'attaquant ne ferme la porte qu'à lui-même.
 * Voir `docs/AUTHORIZATION_RULES.md` §1.1.
 */

/**
 * La route **consomme** le défi plutôt que de le vérifier : la ligne porte le
 * tag qui a servi à résoudre l'identifiant, et une connexion Discord réussie
 * *est* la preuve que la certification du tag demande. D'où un mock qui rend le
 * tag, et non un booléen.
 */
const verifyMock = consumeDiscordChallenge as jest.MockedFunction<typeof consumeDiscordChallenge>;
const createUserMock = createOrGetDiscordUser as jest.MockedFunction<typeof createOrGetDiscordUser>;
const createSessionMock = createSession as jest.MockedFunction<typeof createSession>;

const VICTIM = "999888777666555444";
const OTHER = "111222333444555666";
const ATTACKER_IP = "203.0.113.7";
const VICTIM_IP = "198.51.100.42";

function attempt(discordId: string, code: string, ip: string | null = ATTACKER_IP) {
  return POST(
    new Request("http://localhost:3000/api/auth/discord/verify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(ip === null ? {} : { "x-forwarded-for": ip }),
      },
      body: JSON.stringify({ discordId, code }),
    }),
  );
}

const exhaust = async (discordId: string, ip: string) => {
  for (let i = 0; i < DISCORD_CODE_VERIFY_RULE.limit; i += 1) {
    await attempt(discordId, "000000", ip);
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
      expect((await attempt(VICTIM, "000000")).status).toBe(401);
    }

    const blocked = await attempt(VICTIM, "000000");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });

  it("ne consulte plus la base une fois le plafond atteint", async () => {
    await exhaust(VICTIM, ATTACKER_IP);
    verifyMock.mockClear();

    await attempt(VICTIM, "000000");
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("laisse la victime se connecter pendant qu'un tiers épuise son quota", async () => {
    // **Le cœur de la règle.** Sur l'axe du seul compte visé, cette ligne
    // rendait 429 : l'attaquant fermait la connexion de quelqu'un d'autre avec
    // dix requêtes non authentifiées, sans jamais rien tenter de plausible.
    await exhaust(VICTIM, ATTACKER_IP);
    verifyMock.mockResolvedValue({ handle: "keryan" });

    const res = await attempt(VICTIM, "424242", VICTIM_IP);

    expect(res.status).toBe(200);
    expect(createSessionMock).toHaveBeenCalledWith(42);
  });

  it("ne rend pas un essai de plus à l'attaquant qui change de victime", async () => {
    // L'autre moitié du couple : les seaux restent distincts par compte visé,
    // sans quoi un joueur épuiserait le seau de tout le monde.
    await exhaust(VICTIM, ATTACKER_IP);

    expect((await attempt(OTHER, "000000", ATTACKER_IP)).status).toBe(401);
    expect((await attempt(VICTIM, "000000", ATTACKER_IP)).status).toBe(429);
  });

  it("ne plafonne pas du tout quand aucune IP n'est lisible", async () => {
    // Règle de la maison (`enforceRateLimit`) : une identité absente n'est pas
    // plafonnée. Retomber sur le compte visé rouvrirait la fermeture ci-dessus
    // dès qu'un relais oublie `X-Forwarded-For`. Le quota d'essais du code, lui,
    // reste en base et ne dépend d'aucun en-tête.
    for (let i = 0; i < DISCORD_CODE_VERIFY_RULE.limit * 2; i += 1) {
      expect((await attempt(VICTIM, "000000", null)).status).toBe(401);
    }
  });

  it("laisse passer le bon code tant que le plafond n'est pas atteint", async () => {
    verifyMock.mockResolvedValue({ handle: "keryan" });
    const res = await attempt(VICTIM, "424242");

    expect(res.status).toBe(200);
    expect(createSessionMock).toHaveBeenCalledWith(42);
  });

  it("transmet le tag prouvé au compte : entrer par Discord certifie le tag", async () => {
    // Sans cela, un compte né par Discord n'aurait aucun tag certifié alors que
    // son identifiant vient précisément d'être prouvé — et il faudrait le
    // certifier à la main depuis le profil, geste que la règle rend inutile.
    verifyMock.mockResolvedValue({ handle: "keryan" });

    await attempt(VICTIM, "424242");

    // Et la porte est nommée : ce chemin-ci ne laisse **aucune** autorisation
    // d'application chez Discord, à la différence du bouton.
    expect(createUserMock).toHaveBeenCalledWith(VICTIM, undefined, "keryan", {
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
      expect((await attempt(VICTIM, "12")).status).toBe(400);
    }

    expect((await attempt(VICTIM, "000000")).status).toBe(401);
  });
});
