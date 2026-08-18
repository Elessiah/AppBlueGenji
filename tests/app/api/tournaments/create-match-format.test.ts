import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");

import { POST } from "@/app/api/tournaments/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/tournaments-service";

const referee = { id: 1, isAdmin: true } as Awaited<ReturnType<typeof getCurrentUser>>;

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/tournaments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const base = {
  name: "Coupe BO5",
  game: "OW2",
  format: "SINGLE",
  maxTeams: 16,
  startVisibilityAt: new Date().toISOString(),
  registrationOpenAt: new Date().toISOString(),
  registrationCloseAt: new Date().toISOString(),
  startAt: new Date().toISOString(),
};

describe("POST /api/tournaments — format de match", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCurrentUser as jest.Mock).mockResolvedValue(referee as never);
    (service.createTournament as jest.Mock).mockResolvedValue(7 as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it("transmet un BO5", async () => {
    const res = await POST(jsonReq({ ...base, matchFormatType: "BO", matchFormatValue: 5 }));
    expect(res.status).toBe(201);
    expect(service.createTournament).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ matchFormat: { type: "BO", value: 5 } }),
    );
  });

  it("transmet un FT3", async () => {
    const res = await POST(jsonReq({ ...base, matchFormatType: "FT", matchFormatValue: 3 }));
    expect(res.status).toBe(201);
    expect(service.createTournament).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ matchFormat: { type: "FT", value: 3 } }),
    );
  });

  it("laisse la saisie libre quand aucun format n'est envoyé", async () => {
    const res = await POST(jsonReq(base));
    expect(res.status).toBe(201);
    expect(service.createTournament).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ matchFormat: null }),
    );
  });

  it("laisse la saisie libre sur un format explicitement nul", async () => {
    const res = await POST(
      jsonReq({ ...base, matchFormatType: null, matchFormatValue: null }),
    );
    expect(res.status).toBe(201);
    expect(service.createTournament).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ matchFormat: null }),
    );
  });

  it("rejette un Best of pair", async () => {
    const res = await POST(jsonReq({ ...base, matchFormatType: "BO", matchFormatValue: 4 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_MATCH_FORMAT" });
    expect(service.createTournament).not.toHaveBeenCalled();
  });

  it("rejette un type inconnu et une valeur hors bornes", async () => {
    const unknownType = await POST(
      jsonReq({ ...base, matchFormatType: "RACE", matchFormatValue: 3 }),
    );
    expect(unknownType.status).toBe(400);

    const outOfBounds = await POST(
      jsonReq({ ...base, matchFormatType: "FT", matchFormatValue: 99 }),
    );
    expect(outOfBounds.status).toBe(400);
    expect(await outOfBounds.json()).toEqual({ error: "INVALID_MATCH_FORMAT" });
  });

  it("rejette un format à moitié renseigné", async () => {
    const typeOnly = await POST(jsonReq({ ...base, matchFormatType: "BO" }));
    expect(typeOnly.status).toBe(400);
    expect(await typeOnly.json()).toEqual({ error: "INVALID_MATCH_FORMAT" });

    const valueOnly = await POST(jsonReq({ ...base, matchFormatValue: 5 }));
    expect(valueOnly.status).toBe(400);
    expect(await valueOnly.json()).toEqual({ error: "INVALID_MATCH_FORMAT" });
  });

  it("s'applique à tous les formats de tournoi, pas seulement à l'élimination", async () => {
    const res = await POST(
      jsonReq({
        ...base,
        format: "SWISS",
        swissTotalRounds: 4,
        matchFormatType: "BO",
        matchFormatValue: 3,
      }),
    );
    expect(res.status).toBe(201);
    expect(service.createTournament).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ format: "SWISS", matchFormat: { type: "BO", value: 3 } }),
    );
  });
});
