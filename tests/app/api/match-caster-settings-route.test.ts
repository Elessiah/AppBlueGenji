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
    jest.mocked(loadOwnCastSettings).mockResolvedValue({ streamId: 3, liveUrl: "https://twitch.tv/voix", staffStream: false, battletag: "Voix#2100" });
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

  it("casterPut_organisationLinkTrue_returns403StaffStreamForbidden", async () => {
    // Décision D7 du 2026-11-09 : un caster ne dit jamais son lien « de l'organisation ».
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    const res = await casterPut(jsonRequest("PUT", { liveUrl: "twitch.tv/voix", organisationLink: true }), params("42"));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "STAFF_STREAM_FORBIDDEN" });
    expect(setCastSettings).not.toHaveBeenCalled();
  });

  it("casterPut_organisationLinkFalseFromOldTab_ignored", async () => {
    // Une fenêtre ouverte avant D7 envoie encore `false` (sa propre chaîne) : la clé est ignorée.
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    jest.mocked(setCastSettings).mockResolvedValue();
    const res = await casterPut(jsonRequest("PUT", { trigger: "AUTO", organisationLink: false }), params("42"));
    expect(res.status).toBe(200);
    expect(jest.mocked(setCastSettings).mock.calls[0]?.[3]).toEqual({ trigger: "AUTO" });
  });

  it("casterPut_organisationLinkFromTournamentsStaff_returns403StaffStreamForbidden", async () => {
    // Le staff `tournaments` qui caste règle le lien de l'organisation dans la configuration du direct, pas ici.
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 3, roles: ["ARBITRE"] }));
    const res = await casterPut(jsonRequest("PUT", { liveUrl: "https://twitch.tv/voix", organisationLink: true }), params("42"));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "STAFF_STREAM_FORBIDDEN" });
    expect(setCastSettings).not.toHaveBeenCalled();
  });

  it.each<[string, unknown]>([
    ["string", "true"],
    ["number", 1],
    ["null", null],
  ])("casterPut_organisationLinkNotBoolean_%s_returns400InvalidOrganisationLink", async (_label, value) => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    const res = await casterPut(jsonRequest("PUT", { liveUrl: "https://twitch.tv/voix", organisationLink: value }), params("42"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "INVALID_ORGANISATION_LINK" });
    expect(setCastSettings).not.toHaveBeenCalled();
  });

  it("casterPut_emptyChunkedBodyWithoutType_savesNothingAndSucceeds", async () => {
    // Corps vide sans `Content-Length` (fragmenté, HTTP/2) : aucun réglage, pas un refus.
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    jest.mocked(setCastSettings).mockResolvedValue();
    const body = new ReadableStream<Uint8Array>({ start: (controller) => controller.close() });
    const req = new Request("http://localhost/api/matches/42/caster", { method: "PUT", body, duplex: "half" } as RequestInit);
    const res = await casterPut(req, params("42"));
    expect(res.status).toBe(200);
    expect(setCastSettings).toHaveBeenCalledWith(42, 4, true, {}, { oversees: false, manages: false });
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
    await expect(res.json()).resolves.toMatchObject({ error: "STAFF_STREAM_FORBIDDEN" });
    expect(setCastSettings).not.toHaveBeenCalled();
  });

  it.each<[string, number]>([
    ["STREAM_URL_REQUIRED", 400],
    ["MATCH_CAST_CLOSED", 409],
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
