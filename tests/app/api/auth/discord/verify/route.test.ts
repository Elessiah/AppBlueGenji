import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users-service");

import { POST } from "@/app/api/auth/discord/verify/route";
import { createSession } from "@/lib/server/auth";
import { createOrGetDiscordUser, verifyDiscordChallenge } from "@/lib/server/users-service";
import { DISCORD_CODE_VERIFY_RULE } from "@/lib/server/api-guard";
import { resetRateLimit } from "@/lib/server/rate-limit";

const verifyMock = verifyDiscordChallenge as jest.MockedFunction<typeof verifyDiscordChallenge>;
const createUserMock = createOrGetDiscordUser as jest.MockedFunction<typeof createOrGetDiscordUser>;
const createSessionMock = createSession as jest.MockedFunction<typeof createSession>;

const VICTIM = "999888777666555444";
const OTHER = "111222333444555666";

function attempt(discordId: string, code: string) {
  return POST(
    new Request("http://localhost:3000/api/auth/discord/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ discordId, code }),
    }),
  );
}

describe("POST /api/auth/discord/verify — plafond d'énumération", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimit(DISCORD_CODE_VERIFY_RULE.name);
    verifyMock.mockResolvedValue(false);
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
    for (let i = 0; i < DISCORD_CODE_VERIFY_RULE.limit; i += 1) {
      await attempt(VICTIM, "000000");
    }
    verifyMock.mockClear();

    await attempt(VICTIM, "000000");
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("ne plafonne que le compte visé : viser quelqu'un d'autre, c'est l'attaquer", async () => {
    // Le seau porte sur l'identifiant Discord, pas sur l'appelant. C'est le
    // seul axe qu'un attaquant ne peut pas faire tourner — et le corollaire est
    // qu'un joueur ne peut pas verrouiller la connexion de tout le monde en
    // épuisant un seau partagé.
    for (let i = 0; i < DISCORD_CODE_VERIFY_RULE.limit; i += 1) {
      await attempt(VICTIM, "000000");
    }

    expect((await attempt(OTHER, "000000")).status).toBe(401);
  });

  it("laisse passer le bon code tant que le plafond n'est pas atteint", async () => {
    verifyMock.mockResolvedValue(true);
    const res = await attempt(VICTIM, "424242");

    expect(res.status).toBe(200);
    expect(createSessionMock).toHaveBeenCalledWith(42);
  });

  it("plafonne après la validation de forme, pas avant", async () => {
    // Un corps mal formé ne doit pas consommer le quota du compte visé : sinon
    // n'importe qui épuiserait les essais d'autrui sans même tenter un code.
    for (let i = 0; i < DISCORD_CODE_VERIFY_RULE.limit * 2; i += 1) {
      expect((await attempt(VICTIM, "12")).status).toBe(400);
    }

    expect((await attempt(VICTIM, "000000")).status).toBe(401);
  });
});
