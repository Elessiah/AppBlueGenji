import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/api-guard", () => ({
  PROFILELESS_LOOKUP_RULE: { name: "profileless-lookup", limit: 60, windowMs: 60_000 },
  enforceRateLimit: jest.fn(),
}));
jest.mock("@/lib/server/users/profileless-players");
jest.mock("@/lib/server/users/profileless-guess-budget");

import { NextResponse } from "next/server";
import { POST } from "@/app/api/players/profileless/route";
import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit, PROFILELESS_LOOKUP_RULE } from "@/lib/server/api-guard";
import { profilelessAmong } from "@/lib/server/users/profileless-players";
import { admitProfilelessGuesses } from "@/lib/server/users/profileless-guess-budget";
import { authUser } from "../../../helpers/auth-user";

const SAME_ORIGIN = { "sec-fetch-site": "same-origin", "content-type": "application/json" };

/** Question des liens de joueur (D86) : connecté seulement, comptes affichés avec leur nom, dans le corps. */
function post(body: string, headers: Record<string, string> = SAME_ORIGIN) {
  return POST(new Request("http://localhost/api/players/profileless", { method: "POST", headers, body }));
}

const VALID = JSON.stringify({ players: [{ id: 3, name: "Alpha" }, { id: 8, name: "Beta" }] });

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));
  jest.mocked(enforceRateLimit).mockReturnValue(null);
  jest.mocked(profilelessAmong).mockResolvedValue([8]);
  jest.mocked(admitProfilelessGuesses).mockImplementation((_viewer, players) => [...players]);
});

describe("POST /api/players/profileless", () => {
  it("POST_crossSite_returns403WithoutReading", async () => {
    const res = await post(VALID, { "sec-fetch-site": "cross-site", "content-type": "application/json" });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "CROSS_SITE_REQUEST" });
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it("POST_anonymous_returns401WithoutReading", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const res = await post(VALID);

    expect(res.status).toBe(401);
    expect(profilelessAmong).not.toHaveBeenCalled();
  });

  it("POST_signedIn_returnsProfilelessAmongAskedPlayers", async () => {
    const res = await post(VALID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ids: [8] });
    expect(profilelessAmong).toHaveBeenCalledWith([{ id: 3, name: "Alpha" }, { id: 8, name: "Beta" }]);
  });

  it("POST_guessBudget_onlyAdmittedPairsJudged", async () => {
    // Revue sécurité EF-65 cycle 2 : noms essayés bornés par compte et par visiteur.
    jest.mocked(admitProfilelessGuesses).mockReturnValue([{ id: 3, name: "Alpha" }]);

    await post(VALID);

    expect(admitProfilelessGuesses).toHaveBeenCalledWith(7, [{ id: 3, name: "Alpha" }, { id: 8, name: "Beta" }]);
    expect(profilelessAmong).toHaveBeenCalledWith([{ id: 3, name: "Alpha" }]);
  });

  it("POST_signedIn_usesOwnBucketNotDirectory", async () => {
    await post(VALID);

    // Un seau à part : les questions des liens n'épuisent pas celui de l'annuaire.
    expect(enforceRateLimit).toHaveBeenCalledWith(PROFILELESS_LOOKUP_RULE, 7);
  });

  it("POST_rateLimited_returns429", async () => {
    jest.mocked(enforceRateLimit).mockReturnValue(NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 }));

    const res = await post(VALID);

    expect(res.status).toBe(429);
    expect(profilelessAmong).not.toHaveBeenCalled();
  });

  it("POST_invalidJson_returns400", async () => {
    const res = await post("{");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_PLAYER_IDS" });
  });

  it("POST_idsWithoutNames_returns400WithoutReading", async () => {
    // L'ancienne forme (identifiants seuls) ne répond plus : un nom est exigé.
    const res = await post(JSON.stringify({ players: [{ id: 3 }] }));

    expect(res.status).toBe(400);
    expect(profilelessAmong).not.toHaveBeenCalled();
  });

  it("POST_bodyTooLarge_returns413", async () => {
    const res = await post(JSON.stringify({ players: [{ id: 3, name: "a".repeat(40_000) }] }));

    expect(res.status).toBe(413);
  });

  it("POST_nonJsonContentType_returns415", async () => {
    const res = await post(VALID, { "sec-fetch-site": "same-origin", "content-type": "text/plain" });

    expect(res.status).toBe(415);
  });

  it("POST_listUnreadable_returns503NotEmptyAnswer", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(profilelessAmong).mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await post(VALID);

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "PROFILELESS_UNAVAILABLE" });
  });
});
