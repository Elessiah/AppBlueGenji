import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/tournaments-service");
jest.mock("@/lib/server/tournaments/registration-removal");
jest.mock("@/lib/server/tournaments/write-visibility");

import { DELETE, POST } from "@/app/api/tournaments/[id]/register/route";
import { TOURNAMENT_REGISTRATION_ATTEMPT_RULE, TOURNAMENT_REGISTRATION_TOGGLE_RULE } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { resetRateLimit } from "@/lib/server/rate-limit";
import { registerCurrentUserTeam } from "@/lib/server/tournaments-service";
import { withdrawOwnRegistration } from "@/lib/server/tournaments/registration-removal";
import { canActOnTournament } from "@/lib/server/tournaments/write-visibility";
import { authUser } from "../../../helpers/auth-user";

/**
 * Plafond des inscriptions et désinscriptions (`TOURNAMENT_REGISTRATION_TOGGLE_RULE`) :
 * depuis la désinscription (`SELF_WITHDRAWAL.md`), une boucle « inscrire →
 * désinscrire » vidait les caches du classement et de l'accueil, relançait le
 * flux des spectateurs et remplissait le journal Discord à volonté. Un seul seau
 * pour les deux gestes, par compte ; seul un geste réussi est décompté ; le
 * staff `tournaments` n'est pas plafonné.
 */

const player = authUser({ id: 7, pseudo: "Joueur", isAdmin: false, roles: [] });
const referee = authUser({ id: 2, pseudo: "Sifflet", isAdmin: false, roles: ["ARBITRE"] });

const withdrawn = {
  tournamentId: 5,
  tournamentName: "BlueGenji Open",
  teamId: 102,
  entrantName: "Team Nova",
  registeredTeams: 3,
  maxTeams: 8,
  participantType: "TEAM" as const,
};

const params = () => ({ params: Promise.resolve({ id: "5" }) });
const register = () => POST(new Request("http://localhost/api/tournaments/5/register", { method: "POST" }), params());
const unregister = () => DELETE(new Request("http://localhost/api/tournaments/5/register", { method: "DELETE" }), params());

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimit();
  jest.mocked(getCurrentUser).mockResolvedValue(player);
  jest.mocked(canActOnTournament).mockResolvedValue(true);
  jest.mocked(registerCurrentUserTeam).mockResolvedValue(undefined);
  jest.mocked(withdrawOwnRegistration).mockResolvedValue(withdrawn);
});

describe("POST/DELETE /api/tournaments/[id]/register — plafond", () => {
  it("toggle_withinLimit_registersAndWithdraws", async () => {
    expect((await register()).status).toBe(200);
    expect((await unregister()).status).toBe(200);
  });

  it("toggle_registerUnregisterLoopOverLimit_returns429WithoutTouchingTheTournament", async () => {
    for (let i = 0; i < TOURNAMENT_REGISTRATION_TOGGLE_RULE.limit / 2; i += 1) {
      expect((await register()).status).toBe(200);
      expect((await unregister()).status).toBe(200);
    }

    const res = await register();

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "TOO_MANY_REQUESTS" });
    expect(registerCurrentUserTeam).toHaveBeenCalledTimes(TOURNAMENT_REGISTRATION_TOGGLE_RULE.limit / 2);
  });

  it("DELETE_overLimit_returns429WithoutWithdrawing", async () => {
    for (let i = 0; i < TOURNAMENT_REGISTRATION_TOGGLE_RULE.limit; i += 1) await register();

    const res = await unregister();

    expect(res.status).toBe(429);
    expect(withdrawOwnRegistration).not.toHaveBeenCalled();
  });

  it("toggle_refusedGestures_areNotCharged", async () => {
    jest.mocked(withdrawOwnRegistration).mockRejectedValue(new Error("NOT_TEAM_MANAGER"));
    jest.mocked(registerCurrentUserTeam).mockRejectedValue(new Error("REGISTRATION_CLOSED"));
    for (let i = 0; i < TOURNAMENT_REGISTRATION_TOGGLE_RULE.limit; i += 1) {
      await unregister();
      await register();
    }
    jest.mocked(registerCurrentUserTeam).mockResolvedValue(undefined);

    expect((await register()).status).toBe(200);
  });

  it("toggle_refusalLoopOverAttemptCap_returns429WithoutTakingTheLock", async () => {
    jest.mocked(withdrawOwnRegistration).mockRejectedValue(new Error("TEAM_NOT_IN_TOURNAMENT"));
    for (let i = 0; i < TOURNAMENT_REGISTRATION_ATTEMPT_RULE.limit; i += 1) {
      expect((await unregister()).status).toBe(404);
    }

    const res = await unregister();

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "TOO_MANY_REQUESTS" });
    expect(withdrawOwnRegistration).toHaveBeenCalledTimes(TOURNAMENT_REGISTRATION_ATTEMPT_RULE.limit);
  });

  it("toggle_unpublishedTournament_isNotCharged", async () => {
    jest.mocked(canActOnTournament).mockResolvedValue(false);
    for (let i = 0; i < TOURNAMENT_REGISTRATION_TOGGLE_RULE.limit; i += 1) await register();
    jest.mocked(canActOnTournament).mockResolvedValue(true);

    expect((await register()).status).toBe(200);
  });

  it("toggle_tournamentStaff_isNeverCapped", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(referee);

    for (let i = 0; i <= TOURNAMENT_REGISTRATION_TOGGLE_RULE.limit; i += 1) {
      expect((await unregister()).status).toBe(200);
    }
  });
});
