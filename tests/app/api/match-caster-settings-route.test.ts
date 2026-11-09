import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/match-launch");
jest.mock("@/lib/server/tournaments/cast-settings");

import { GET as casterGet, PUT as casterPut } from "@/app/api/matches/[matchId]/caster/route";
import { getCurrentUser } from "@/lib/server/auth";
import { loadOwnCastSettings } from "@/lib/server/tournaments/cast-settings";
import { setCastSettings } from "@/lib/server/tournaments/match-launch";
import { authUser } from "../../helpers/auth-user";

/**
 * « Configurer ma diffusion » (`docs/features/CAST_SETTINGS.md`) : lecture de
 * **son** cast (GET) et réglages (PUT) de `/api/matches/[matchId]/caster`.
 */

const caster = authUser({ id: 4, roles: ["CASTER"] });
const params = (matchId: string) => ({ params: Promise.resolve({ matchId }) });

function jsonRequest(method: string, body?: unknown) {
  return new Request("http://localhost/api/matches/42/caster", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/matches/[matchId]/caster", () => {
  it("casterGet_anonymous_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await casterGet(jsonRequest("GET"), params("42"))).status).toBe(401);
    expect(loadOwnCastSettings).not.toHaveBeenCalled();
  });

  it("casterGet_registeredCaster_returnsOwnSettingsOnly", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    jest.mocked(loadOwnCastSettings).mockResolvedValue({ streamId: 3, liveUrl: "https://twitch.tv/voix", staffStream: false, battletag: "Voix#2100", organisationLink: false });
    const res = await casterGet(jsonRequest("GET"), params("42"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ streamId: 3, battletag: "Voix#2100" });
    // Toujours le lecteur lui-même : aucun identifiant de compte n'est lu dans la requête.
    expect(loadOwnCastSettings).toHaveBeenCalledWith(42, 4);
  });

  it("casterGet_notCaster_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    jest.mocked(loadOwnCastSettings).mockRejectedValue(new Error("NOT_MATCH_CASTER"));
    expect((await casterGet(jsonRequest("GET"), params("42"))).status).toBe(403);
  });

  it("casterGet_invalidMatchId_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    expect((await casterGet(jsonRequest("GET"), params("abc"))).status).toBe(400);
  });
});

describe("PUT /api/matches/[matchId]/caster", () => {
  it("casterPut_anonymous_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await casterPut(jsonRequest("PUT", { battletag: null }), params("42"))).status).toBe(401);
    expect(setCastSettings).not.toHaveBeenCalled();
  });

  it("casterPut_presentFieldsOnly_passesThemWithLivePermission", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    jest.mocked(setCastSettings).mockResolvedValue();
    const res = await casterPut(jsonRequest("PUT", { trigger: "MANUAL", battletag: null }), params("42"));
    expect(res.status).toBe(200);
    // Le lien, absent du corps, n'est pas touché.
    expect(setCastSettings).toHaveBeenCalledWith(
      42,
      4,
      true,
      { trigger: "MANUAL", battletag: null },
      { oversees: false, manages: false },
    );
  });

  it("casterPut_arbitre_passesOverseerAccess", async () => {
    // Décision du 2026-11-09 : `tournaments` + `live` règle tout cast, sans `isAdmin` codé.
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 3, roles: ["ARBITRE"] }));
    jest.mocked(setCastSettings).mockResolvedValue();
    await casterPut(jsonRequest("PUT", { trigger: "AUTO" }), params("42"));
    expect(setCastSettings).toHaveBeenCalledWith(42, 3, true, { trigger: "AUTO" }, { oversees: true, manages: true });
  });

  it("casterPut_organisationLinkFalseAlone_allowedForCaster", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    jest.mocked(setCastSettings).mockResolvedValue();
    const res = await casterPut(jsonRequest("PUT", { organisationLink: false }), params("42"));
    expect(res.status).toBe(200);
    expect(setCastSettings).toHaveBeenCalledWith(42, 4, true, { asOrganisation: false }, { oversees: false, manages: false });
  });

  it("casterPut_wrongFieldType_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    const res = await casterPut(jsonRequest("PUT", { battletag: 12 }), params("42"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "INVALID_CAST_SETTINGS" });
    expect(setCastSettings).not.toHaveBeenCalled();
  });

  it("casterPut_organisationLinkWithoutTournaments_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    const res = await casterPut(jsonRequest("PUT", { liveUrl: "https://twitch.tv/voix", organisationLink: true }), params("42"));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "FORBIDDEN" });
    expect(setCastSettings).not.toHaveBeenCalled();
  });

  it.each<[string, number]>([
    ["STREAM_URL_REQUIRED", 400],
    ["MATCH_ALREADY_COMPLETED", 409],
    ["CAST_STREAM_NOT_OWNED", 409],
    ["NOT_MATCH_CASTER", 403],
    ["LIVE_TRIGGER_NOT_OWNED", 403],
  ])("casterPut_serviceRefuses_%s_maps to %i", async (code, status) => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    jest.mocked(setCastSettings).mockRejectedValue(new Error(code));
    const res = await casterPut(jsonRequest("PUT", { liveUrl: null }), params("42"));
    expect(res.status).toBe(status);
    await expect(res.json()).resolves.toMatchObject({ error: code });
  });
});
