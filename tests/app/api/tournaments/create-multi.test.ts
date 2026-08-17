import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");
jest.mock("@/lib/shared/permissions");

import { POST } from "@/app/api/tournaments/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/tournaments-service";
import * as perms from "@/lib/shared/permissions";

const admin = { id: 1, isAdmin: true } as Awaited<ReturnType<typeof getCurrentUser>>;
const noPerms = { id: 2, isAdmin: false } as Awaited<ReturnType<typeof getCurrentUser>>;

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/tournaments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const baseMulti = {
  name: "Multi-phase Tournament",
  game: "OW2",
  maxTeams: 128,
  startVisibilityAt: new Date().toISOString(),
  registrationOpenAt: new Date().toISOString(),
  registrationCloseAt: new Date().toISOString(),
  startAt: new Date().toISOString(),
};

const phase1 = {
  format: "SURVIVAL",
  qualifierMode: "COUNT",
  qualifierValue: 16,
  survivalRoundsBeforeFirstCut: 2,
  survivalRoundsPerCut: 1,
};

const phase2 = {
  format: "SINGLE",
  qualifierMode: "COUNT",
  qualifierValue: 4,
  hasThirdPlaceMatch: true,
};

describe("POST /api/tournaments — mode MULTI avec phases", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (perms.can as jest.Mock).mockReturnValue(true);
    (service.createTournament as jest.Mock).mockResolvedValue(42 as never);
  });

  afterEach(() => jest.restoreAllMocks());

  describe("création valide", () => {
    it("accepte un tournoi MULTI avec phases valides", async () => {
      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [phase1, phase2],
        }),
      );

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ id: 42 });
      expect(service.createTournament).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          format: "MULTI",
          phases: [phase1, phase2],
        }),
      );
    });

    it("transmet les paramètres SURVIVAL d'une phase qualificative", async () => {
      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [
            {
              format: "SURVIVAL",
              qualifierMode: "PERCENT",
              qualifierValue: 50,
              survivalRoundsBeforeFirstCut: 3,
              survivalRoundsPerCut: 2,
            },
            phase2,
          ],
        }),
      );

      expect(res.status).toBe(201);
      expect(service.createTournament).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          phases: expect.arrayContaining([
            expect.objectContaining({
              format: "SURVIVAL",
              qualifierMode: "PERCENT",
              survivalRoundsBeforeFirstCut: 3,
              survivalRoundsPerCut: 2,
            }),
          ]),
        }),
      );
    });

    it("accepte SINGLE avec petite finale", async () => {
      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [
            phase1,
            {
              format: "SINGLE",
              qualifierMode: "COUNT",
              qualifierValue: 2,
              hasThirdPlaceMatch: true,
            },
          ],
        }),
      );

      expect(res.status).toBe(201);
    });

    it("accepte SWISS avec totalRounds", async () => {
      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [
            phase1,
            {
              format: "SWISS",
              qualifierMode: "COUNT",
              qualifierValue: 8,
              swissTotalRounds: 4,
            },
          ],
        }),
      );

      expect(res.status).toBe(201);
    });

    it("accepte DOUBLE uniquement en phase finale", async () => {
      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [
            phase1,
            {
              format: "DOUBLE",
              qualifierMode: "COUNT",
              qualifierValue: 1,
              hasThirdPlaceMatch: false,
            },
          ],
        }),
      );

      expect(res.status).toBe(201);
    });
  });

  describe("validation des phases", () => {
    it("rejette DOUBLE en phase non-finale", async () => {
      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [
            {
              format: "DOUBLE",
              qualifierMode: "COUNT",
              qualifierValue: 32,
            },
            phase2,
          ],
        }),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "DOUBLE_MUST_BE_LAST_PHASE" });
      expect(service.createTournament).not.toHaveBeenCalled();
    });

    it("rejette un plan de qualification non-décroissant", async () => {
      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [
            {
              format: "SURVIVAL",
              qualifierMode: "COUNT",
              qualifierValue: 16,
            },
            {
              format: "SINGLE",
              qualifierMode: "COUNT",
              qualifierValue: 32, // ❌ Plus de 16 qualifiés de la phase 1
            },
          ],
        }),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_QUALIFIER_COUNT" });
      expect(service.createTournament).not.toHaveBeenCalled();
    });

    it("rejette un plan avec PERCENT qui monte", async () => {
      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [
            {
              format: "SURVIVAL",
              qualifierMode: "PERCENT",
              qualifierValue: 25,
            },
            {
              format: "SINGLE",
              qualifierMode: "PERCENT",
              qualifierValue: 50, // ❌ 50% > 25%
            },
          ],
        }),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_QUALIFIER_COUNT" });
    });

    it("accepte un plan égal (même nombre de qualifiés)", async () => {
      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [
            {
              format: "SURVIVAL",
              qualifierMode: "COUNT",
              qualifierValue: 8,
            },
            {
              format: "SINGLE",
              qualifierMode: "COUNT",
              qualifierValue: 8,
            },
          ],
        }),
      );

      expect(res.status).toBe(201);
    });

    it("rejette un tableau de phases vide", async () => {
      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [],
        }),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "MISSING_PHASES" });
      expect(service.createTournament).not.toHaveBeenCalled();
    });

    it("rejette MULTI sans phases", async () => {
      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
        }),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "MISSING_PHASES" });
      expect(service.createTournament).not.toHaveBeenCalled();
    });

    it("rejette phases avec format non-supporté", async () => {
      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [
            {
              format: "UNKNOWN_FORMAT",
              qualifierMode: "COUNT",
              qualifierValue: 16,
            },
          ],
        }),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_PHASE_FORMAT" });
      expect(service.createTournament).not.toHaveBeenCalled();
    });

    it("rejette un qualifierValue invalide (< 1)", async () => {
      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [
            {
              format: "SURVIVAL",
              qualifierMode: "COUNT",
              qualifierValue: 0,
            },
          ],
        }),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_QUALIFIER_VALUE" });
      expect(service.createTournament).not.toHaveBeenCalled();
    });

    it("rejette PERCENT < 1 ou > 100", async () => {
      const res1 = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [
            {
              format: "SURVIVAL",
              qualifierMode: "PERCENT",
              qualifierValue: 0,
            },
          ],
        }),
      );
      expect(res1.status).toBe(400);

      const res2 = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [
            {
              format: "SURVIVAL",
              qualifierMode: "PERCENT",
              qualifierValue: 101,
            },
          ],
        }),
      );
      expect(res2.status).toBe(400);
    });

    it("exige survivalRoundsPerCut pour SURVIVAL", async () => {
      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [
            {
              format: "SURVIVAL",
              qualifierMode: "COUNT",
              qualifierValue: 16,
              // survivalRoundsPerCut manquant
            },
          ],
        }),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_SURVIVAL_ROUNDS" });
    });

    it("exige swissTotalRounds pour SWISS", async () => {
      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [
            {
              format: "SWISS",
              qualifierMode: "COUNT",
              qualifierValue: 8,
              // swissTotalRounds manquant
            },
          ],
        }),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_SWISS_ROUNDS" });
    });
  });

  describe("permissions", () => {
    it("retourne 403 si l'utilisateur n'a pas la permission 'tournaments'", async () => {
      (perms.can as jest.Mock).mockReturnValue(false);

      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [phase1, phase2],
        }),
      );

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "FORBIDDEN" });
      expect(service.createTournament).not.toHaveBeenCalled();
    });

    it("retourne 401 si pas authentifié", async () => {
      (getCurrentUser as jest.Mock).mockResolvedValue(null);

      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [phase1, phase2],
        }),
      );

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "UNAUTHORIZED" });
    });
  });

  describe("erreurs serveur", () => {
    it("remonte une erreur de date invalide", async () => {
      (service.createTournament as jest.Mock).mockRejectedValueOnce(
        new Error("INVALID_DATES"),
      );

      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [phase1, phase2],
        }),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_DATES" });
    });

    it("retourne 500 sur erreur interne", async () => {
      (service.createTournament as jest.Mock).mockRejectedValueOnce(new Error("DATABASE_ERROR"));

      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [phase1, phase2],
        }),
      );

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "DATABASE_ERROR" });
    });
  });

  describe("non-MULTI format (retrocompatibilité)", () => {
    it("ignore les phases pour les formats non-MULTI", async () => {
      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "SURVIVAL",
          phases: [phase1, phase2], // Ignoré
          survivalRoundsPerCut: 3,
        }),
      );

      expect(res.status).toBe(201);
      expect(service.createTournament).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          format: "SURVIVAL",
          survivalRoundsPerCut: 3,
        }),
      );
      // Les phases ne doivent pas être transmises aux formats non-MULTI.
      expect(service.createTournament).toHaveBeenCalledWith(
        1,
        expect.not.objectContaining({ phases: expect.anything() }),
      );
    });
  });
});
