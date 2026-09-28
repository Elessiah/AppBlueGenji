import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { POST } from "@/app/api/auth/discord/request/route";
import { resolveDiscordUser, sendDiscordLoginCode } from "@/lib/server/bot-integration";
import { createDiscordLoginChallenge, discardDiscordChallenge } from "@/lib/server/users-service";
import { resetRateLimit } from "@/lib/server/rate-limit";
import { DISCORD_CODE_REQUEST_IP_RULE, DISCORD_CODE_REQUEST_RULE } from "@/lib/server/api-guard";

jest.mock("@/lib/server/bot-integration", () => ({
  resolveDiscordUser: jest.fn(),
  sendDiscordLoginCode: jest.fn(),
}));

jest.mock("@/lib/server/users-service", () => ({
  createDiscordLoginChallenge: jest.fn(),
  discardDiscordChallenge: jest.fn(),
}));

const resolveDiscordUserMock = resolveDiscordUser as jest.MockedFunction<typeof resolveDiscordUser>;
const sendDiscordLoginCodeMock = sendDiscordLoginCode as jest.MockedFunction<typeof sendDiscordLoginCode>;
const createDiscordLoginChallengeMock =
  createDiscordLoginChallenge as jest.MockedFunction<typeof createDiscordLoginChallenge>;
const discardChallengeMock =
  discardDiscordChallenge as jest.MockedFunction<typeof discardDiscordChallenge>;

function buildRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost:3000/api/auth/discord/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/discord/request", () => {
  beforeEach(() => {
    resolveDiscordUserMock.mockReset();
    sendDiscordLoginCodeMock.mockReset();
    createDiscordLoginChallengeMock.mockReset();
    discardChallengeMock.mockReset();
    discardChallengeMock.mockResolvedValue();
    // Le plafond est par compte Discord visé et vit en mémoire du processus :
    // sans remise à zéro, les cas suivants héritent des demandes des premiers.
    resetRateLimit(DISCORD_CODE_REQUEST_RULE.name);
    resetRateLimit(DISCORD_CODE_REQUEST_IP_RULE.name);
    // Par défaut, resolve renvoie l'identifiant tel quel (cas ID numérique).
    resolveDiscordUserMock.mockImplementation(async (handle: string) => handle);
  });

  it("returns 400 for an empty handle", async () => {
    const response = await POST(buildRequest({ handle: "   " }));
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("INVALID_DISCORD_HANDLE");
    expect(resolveDiscordUserMock).not.toHaveBeenCalled();
    expect(createDiscordLoginChallengeMock).not.toHaveBeenCalled();
    expect(sendDiscordLoginCodeMock).not.toHaveBeenCalled();
  });

  it("returns 200 with the challenge token when the code is generated and sent", async () => {
    createDiscordLoginChallengeMock.mockResolvedValue({
      challengeId: 1,
      challengeToken: "t1",
      code: "123456",
      expiresAt: new Date("2030-01-01T10:00:00.000Z"),
    });
    sendDiscordLoginCodeMock.mockResolvedValue();

    const response = await POST(buildRequest({ discordId: "123456789012345678" }));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      success: true,
      challenge: "t1",
      expiresAt: "2030-01-01T10:00:00.000Z",
    });
    expect(sendDiscordLoginCodeMock).toHaveBeenCalledWith("123456789012345678", "123456");
  });

  it("plafonne les demandes par compte visé, message privé compris", async () => {
    // Chaque appel envoie un message privé à quelqu'un et remet un code neuf en
    // jeu — donc rouvre un quota d'essais. Sans ce plafond, la demande en
    // boucle rendait le décompte des essais purement décoratif.
    createDiscordLoginChallengeMock.mockResolvedValue({
      challengeId: 1,
      challengeToken: "t1",
      code: "123456",
      expiresAt: new Date("2030-01-01T10:00:00.000Z"),
    });
    sendDiscordLoginCodeMock.mockResolvedValue();

    for (let i = 0; i < DISCORD_CODE_REQUEST_RULE.limit; i += 1) {
      const ok = await POST(buildRequest({ discordId: "123456789012345678" }));
      expect(ok.status).toBe(200);
    }

    const blocked = await POST(buildRequest({ discordId: "123456789012345678" }));
    expect(blocked.status).toBe(429);
    // Ni code neuf, ni message privé : le plafond est posé avant les deux.
    expect(createDiscordLoginChallengeMock).toHaveBeenCalledTimes(
      DISCORD_CODE_REQUEST_RULE.limit,
    );
    expect(sendDiscordLoginCodeMock).toHaveBeenCalledTimes(DISCORD_CODE_REQUEST_RULE.limit);
  });

  it("ne plafonne pas un second compte au passage", async () => {
    createDiscordLoginChallengeMock.mockResolvedValue({
      challengeId: 1,
      challengeToken: "t1",
      code: "123456",
      expiresAt: new Date("2030-01-01T10:00:00.000Z"),
    });
    sendDiscordLoginCodeMock.mockResolvedValue();

    for (let i = 0; i < DISCORD_CODE_REQUEST_RULE.limit; i += 1) {
      await POST(buildRequest({ discordId: "123456789012345678" }));
    }

    const other = await POST(buildRequest({ discordId: "111222333444555666" }));
    expect(other.status).toBe(200);
  });

  it("efface le code mort-né quand l'envoi échoue", async () => {
    // **Rendre au code déjà reçu sa place de dernier.**
    // `verifyDiscordChallenge` ne lit que le dernier émis : laissée en base, la
    // ligne dont le message privé n'est jamais parti ferait refuser le code que
    // le joueur tient de sa demande précédente — et lui brûlerait ses cinq
    // essais sur la mauvaise ligne.
    createDiscordLoginChallengeMock.mockResolvedValue({
      challengeId: 42,
      challengeToken: "t42",
      code: "123456",
      expiresAt: new Date("2030-01-01T10:00:00.000Z"),
    });
    sendDiscordLoginCodeMock.mockRejectedValue(new Error("BOT_INTERNAL_UNREACHABLE"));

    const response = await POST(buildRequest({ discordId: "123456789012345678" }));

    expect(response.status).toBe(503);
    expect(discardChallengeMock).toHaveBeenCalledWith(42);
  });

  it("rend l'échec d'envoi même si le ménage échoue à son tour", async () => {
    // Le joueur doit lire pourquoi il n'a rien reçu, pas une erreur de base.
    createDiscordLoginChallengeMock.mockResolvedValue({
      challengeId: 42,
      challengeToken: "t42",
      code: "123456",
      expiresAt: new Date("2030-01-01T10:00:00.000Z"),
    });
    sendDiscordLoginCodeMock.mockRejectedValue(new Error("DISCORD_DM_FAILED"));
    discardChallengeMock.mockRejectedValue(new Error("ER_LOCK_WAIT_TIMEOUT"));

    const response = await POST(buildRequest({ discordId: "123456789012345678" }));
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(payload.error).toBe("DISCORD_DM_FAILED");
  });

  it("laisse vivre le code dont le message privé est bien parti", async () => {
    createDiscordLoginChallengeMock.mockResolvedValue({
      challengeId: 42,
      challengeToken: "t42",
      code: "123456",
      expiresAt: new Date("2030-01-01T10:00:00.000Z"),
    });
    sendDiscordLoginCodeMock.mockResolvedValue();

    const response = await POST(buildRequest({ discordId: "123456789012345678" }));

    expect(response.status).toBe(200);
    expect(discardChallengeMock).not.toHaveBeenCalled();
  });

  it("remonte le plafond de codes en 429", async () => {
    createDiscordLoginChallengeMock.mockRejectedValue(new Error("TOO_MANY_CODE_REQUESTS"));

    const response = await POST(buildRequest({ discordId: "123456789012345678" }));
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(429);
    expect(payload.error).toBe("TOO_MANY_CODE_REQUESTS");
    expect(sendDiscordLoginCodeMock).not.toHaveBeenCalled();
  });

  it("plafonne par IP **avant** de résoudre le pseudo auprès du bot", async () => {
    // Le plafond par compte visé ne peut être posé qu'après la résolution :
    // sans celui-ci, la route anonyme faisait sortir une requête par appel.
    createDiscordLoginChallengeMock.mockResolvedValue({
      challengeId: 1,
      challengeToken: "t1",
      code: "123456",
      expiresAt: new Date("2030-01-01T10:00:00.000Z"),
    });
    sendDiscordLoginCodeMock.mockResolvedValue();

    const fromSameIp = (handle: string) =>
      POST(
        new Request("http://localhost:3000/api/auth/discord/request", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
          body: JSON.stringify({ handle }),
        }),
      );

    // Des pseudos tous différents : seul le plafond par IP peut les arrêter.
    // Composés en **chaîne** : un identifiant Discord dépasse 2^53, et
    // `100000000000000000 + i` rendrait la même valeur pour tout `i`.
    for (let i = 0; i < DISCORD_CODE_REQUEST_IP_RULE.limit; i += 1) {
      const ok = await fromSameIp(`100000000000000${String(i).padStart(3, "0")}`);
      expect(ok.status).toBe(200);
    }

    resolveDiscordUserMock.mockClear();
    const blocked = await fromSameIp("999888777666555444");

    expect(blocked.status).toBe(429);
    expect(resolveDiscordUserMock).not.toHaveBeenCalled();
  });

  it("ne dit ni l'identifiant Discord ni l'existence d'un compte : pas d'oracle", async () => {
    // La réponse rendait l'identifiant résolu et `isNewAccount` pour n'importe
    // quel pseudo, à un appelant anonyme. Elle ne porte plus que le jeton du
    // défi : deux pseudos, dont l'un seul est membre, donnent la même forme.
    resolveDiscordUserMock.mockResolvedValue("123456789012345678");
    createDiscordLoginChallengeMock.mockResolvedValue({
      challengeId: 3,
      challengeToken: "t3",
      code: "111222",
      expiresAt: new Date("2030-01-01T10:00:00.000Z"),
    });
    sendDiscordLoginCodeMock.mockResolvedValue();

    const response = await POST(buildRequest({ handle: "keryan" }));
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["challenge", "expiresAt", "success"]);
    expect(text).not.toContain("123456789012345678");
    expect(text).not.toContain("isNewAccount");
  });

  it("refuse un formulaire venu d'un autre site, avant d'écrire à qui que ce soit", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/auth/discord/request", {
        method: "POST",
        headers: { "content-type": "text/plain", "sec-fetch-site": "cross-site" },
        body: '{"handle":"victime","x":"="}',
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "CROSS_SITE_REQUEST" });
    expect(resolveDiscordUserMock).not.toHaveBeenCalled();
    expect(sendDiscordLoginCodeMock).not.toHaveBeenCalled();
  });

  it("refuse un corps qui n'est pas déclaré en JSON", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/auth/discord/request", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ handle: "keryan" }),
      }),
    );

    expect(response.status).toBe(415);
    expect(resolveDiscordUserMock).not.toHaveBeenCalled();
  });

  it("remonte le plafond journalier en 429, sous son propre code", async () => {
    createDiscordLoginChallengeMock.mockRejectedValue(new Error("TOO_MANY_CODE_REQUESTS_TODAY"));

    const response = await POST(buildRequest({ handle: "keryan" }));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "TOO_MANY_CODE_REQUESTS_TODAY" });
    expect(sendDiscordLoginCodeMock).not.toHaveBeenCalled();
  });

  it("resolves a discord tag to an id before sending the code", async () => {
    resolveDiscordUserMock.mockResolvedValue("999888777666555444");
    createDiscordLoginChallengeMock.mockResolvedValue({
      challengeId: 2,
      challengeToken: "t2",
      code: "654321",
      expiresAt: new Date("2030-01-01T10:00:00.000Z"),
    });
    sendDiscordLoginCodeMock.mockResolvedValue();

    const response = await POST(buildRequest({ handle: "keryan" }));

    expect(response.status).toBe(200);
    expect(resolveDiscordUserMock).toHaveBeenCalledWith("keryan");
    // Le tag part **avec** le défi : c'est lui que la certification écrira si le
    // code revient juste (`consumeDiscordChallenge`), et il doit être celui qui a
    // servi à la résolution, pas celui qu'un second appel renverrait.
    expect(createDiscordLoginChallengeMock).toHaveBeenCalledWith("999888777666555444", "keryan");
    expect(sendDiscordLoginCodeMock).toHaveBeenCalledWith("999888777666555444", "654321");
  });

  it("maps DISCORD_USER_NOT_FOUND to 404 when the tag cannot be resolved", async () => {
    resolveDiscordUserMock.mockRejectedValue(new Error("DISCORD_USER_NOT_FOUND"));

    const response = await POST(buildRequest({ handle: "unknown_tag" }));
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(payload.error).toBe("DISCORD_USER_NOT_FOUND");
    expect(createDiscordLoginChallengeMock).not.toHaveBeenCalled();
    expect(sendDiscordLoginCodeMock).not.toHaveBeenCalled();
  });

  it("maps BOT_INTERNAL_UNREACHABLE to 503", async () => {
    createDiscordLoginChallengeMock.mockResolvedValue({
      challengeId: 1,
      challengeToken: "t1",
      code: "123456",
      expiresAt: new Date("2030-01-01T10:00:00.000Z"),
    });
    sendDiscordLoginCodeMock.mockRejectedValue(new Error("BOT_INTERNAL_UNREACHABLE"));

    const response = await POST(buildRequest({ discordId: "123456789012345678" }));
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(503);
    expect(payload.error).toBe("BOT_INTERNAL_UNREACHABLE");
  });

  it("maps BOT_RESOLVE_TIMEOUT to 504", async () => {
    resolveDiscordUserMock.mockRejectedValue(new Error("BOT_RESOLVE_TIMEOUT"));

    const response = await POST(buildRequest({ discordId: "keryan" }));
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(504);
    expect(payload.error).toBe("BOT_RESOLVE_TIMEOUT");
    expect(sendDiscordLoginCodeMock).not.toHaveBeenCalled();
  });

  it("maps DISCORD_DM_FAILED to 502", async () => {
    createDiscordLoginChallengeMock.mockResolvedValue({
      challengeId: 1,
      challengeToken: "t1",
      code: "123456",
      expiresAt: new Date("2030-01-01T10:00:00.000Z"),
    });
    sendDiscordLoginCodeMock.mockRejectedValue(new Error("DISCORD_DM_FAILED"));

    const response = await POST(buildRequest({ discordId: "123456789012345678" }));
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(payload.error).toBe("DISCORD_DM_FAILED");
  });
});
