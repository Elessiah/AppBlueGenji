import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");
jest.mock("@/lib/shared/permissions");

import { POST } from "@/app/api/tournaments/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/tournaments-service";
import * as perms from "@/lib/shared/permissions";
import { authUser } from "../../../helpers/auth-user";

const admin = authUser({ id: 1, isAdmin: true });
const noPerms = authUser({ id: 2, isAdmin: false });

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/tournaments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const baseMulti = {
  name: "Multi-phase Tournament",
  game: "OW",
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
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(perms.can).mockReturnValue(true);
    jest.mocked(service.createTournament).mockResolvedValue(42);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

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

    it("rejette un plan de qualification non-décroissant entre deux phases non-terminales", async () => {
      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [
            {
              format: "SURVIVAL",
              qualifierMode: "COUNT",
              qualifierValue: 16,
              survivalRoundsPerCut: 1,
            },
            {
              format: "SWISS",
              qualifierMode: "COUNT",
              qualifierValue: 32, // ❌ Plus de 16 qualifiés de la phase 1
              swissTotalRounds: 4,
            },
            phase2, // phase finale — sa valeur n'entre pas dans la comparaison
          ],
        }),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_QUALIFIER_COUNT" });
      expect(service.createTournament).not.toHaveBeenCalled();
    });

    // Régression exacte du cas signalé : une ronde suisse à 50 % suivie d'une
    // finale Survie créée avec le pourcentage par défaut (100 %) — un plan
    // parfaitement valide qui était refusé avant que la borne ne s'aligne sur
    // `validatePhases`. Deux raisons cumulées font passer ce cas précis (la
    // dernière phase n'est jamais comparée, et PERCENT ne l'est jamais non
    // plus) ; le test suivant isole la première à elle seule, avec COUNT.
    it("accepte un plan à deux phases : la dernière qualifierait « plus » en PERCENT, mais sa cible n'est jamais comparée", async () => {
      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [
            {
              format: "SWISS",
              qualifierMode: "PERCENT",
              qualifierValue: 50,
              swissTotalRounds: 4,
            },
            {
              format: "SURVIVAL",
              qualifierMode: "PERCENT",
              qualifierValue: 100,
              survivalRoundsPerCut: 1,
            },
          ],
        }),
      );

      expect(res.status).toBe(201);
    });

    // Isole l'exclusion de la dernière phase, indépendamment de PERCENT : même
    // en COUNT, un plan à deux phases n'a jamais de comparaison à faire — la
    // seconde phase est toujours la dernière.
    it("accepte un plan à deux phases avec COUNT qui monte : la dernière n'est jamais comparée", async () => {
      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [
            {
              format: "SURVIVAL",
              qualifierMode: "COUNT",
              qualifierValue: 16,
              survivalRoundsPerCut: 1,
            },
            {
              format: "SINGLE",
              qualifierMode: "COUNT",
              qualifierValue: 32, // > 16, mais phase finale : jamais comparée
            },
          ],
        }),
      );

      expect(res.status).toBe(201);
    });

    // Le pourcentage s'applique à l'effectif de la phase, qui rétrécit d'une
    // phase à l'autre : une hausse de pourcentage ne dit rien du nombre absolu
    // de qualifiées (80 % d'un effectif déjà réduit de moitié qualifie moins
    // d'équipes que 50 % de l'effectif de départ). Seul COUNT compare des
    // effectifs sur la même échelle, PERCENT n'est donc jamais comparé.
    it("accepte un plan avec PERCENT qui monte entre deux phases non-terminales", async () => {
      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [
            {
              format: "SURVIVAL",
              qualifierMode: "PERCENT",
              qualifierValue: 25,
              survivalRoundsPerCut: 1,
            },
            {
              format: "SWISS",
              qualifierMode: "PERCENT",
              qualifierValue: 50, // pas comparé : PERCENT n'entre jamais dans la règle
              swissTotalRounds: 4,
            },
            phase2,
          ],
        }),
      );

      expect(res.status).toBe(201);
    });

    it("accepte un plan égal à deux phases (même nombre de qualifiés) : la dernière n'est jamais comparée", async () => {
      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [
            {
              format: "SURVIVAL",
              qualifierMode: "COUNT",
              qualifierValue: 8,
              survivalRoundsPerCut: 1,
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

    // Décroissance **stricte** : une égalité de COUNT entre deux phases
    // non-terminales est refusée comme une hausse (même règle que
    // `findPhaseIssue`, `lib/shared/tournament-phases.ts`). Sans le troisième
    // palier, la deuxième phase serait la dernière et l'égalité passerait —
    // voir le test précédent.
    it("rejette une égalité de COUNT entre deux phases non-terminales", async () => {
      const res = await POST(
        jsonReq({
          ...baseMulti,
          format: "MULTI",
          phases: [
            {
              format: "SURVIVAL",
              qualifierMode: "COUNT",
              qualifierValue: 16,
              survivalRoundsPerCut: 1,
            },
            {
              format: "SWISS",
              qualifierMode: "COUNT",
              qualifierValue: 16, // égal, pas <
              swissTotalRounds: 4,
            },
            phase2, // phase finale
          ],
        }),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_QUALIFIER_COUNT" });
      expect(service.createTournament).not.toHaveBeenCalled();
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
      jest.mocked(perms.can).mockReturnValue(false);

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
      jest.mocked(getCurrentUser).mockResolvedValue(null);

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
      jest.mocked(service.createTournament).mockRejectedValueOnce(
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
      jest.mocked(service.createTournament).mockRejectedValueOnce(new Error("DATABASE_ERROR"));

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
