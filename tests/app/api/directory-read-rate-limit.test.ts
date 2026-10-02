import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users/full-profile");
jest.mock("@/lib/server/users/players");
jest.mock("@/lib/server/teams/detail");
jest.mock("@/lib/server/teams/directory");
jest.mock("@/lib/server/teams/dissolution");
jest.mock("@/lib/server/teams/identity");
jest.mock("@/lib/server/teams/roster");
jest.mock("@/lib/server/solo-entries-service");

import { GET as listPlayersRoute } from "@/app/api/players/route";
import { GET as playerRoute } from "@/app/api/players/[id]/route";
import { GET as listTeamsRoute } from "@/app/api/teams/route";
import { GET as teamRoute } from "@/app/api/teams/[id]/route";
import { DIRECTORY_READ_RULE } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { resetRateLimit } from "@/lib/server/rate-limit";
import { getFullProfile } from "@/lib/server/users/full-profile";
import { listPlayers } from "@/lib/server/users/players";
import { getTeamDetail } from "@/lib/server/teams/detail";
import { listTeams } from "@/lib/server/teams/directory";
import { getUserActiveTeam } from "@/lib/server/teams/roster";
import { authUser, fullProfileResponse } from "../../helpers/auth-user";
import { teamDetailResponse } from "../../helpers/team-detail";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** Les quatre lectures de l'annuaire et des fiches, sous un même nom d'appel. */
const routes: [string, () => Promise<Response>][] = [
  ["GET /api/players", () => listPlayersRoute()],
  ["GET /api/players/[id]", () => playerRoute(new Request("http://localhost/api/players/9"), params("9"))],
  ["GET /api/teams", () => listTeamsRoute()],
  ["GET /api/teams/[id]", () => teamRoute(new Request("http://localhost/api/teams/5"), params("5"))],
];

/**
 * Ces lectures recalculaient des statistiques à chaque appel et n'avaient aucun
 * plafond : F5 maintenu sur `/joueurs` ou sur une fiche pouvait occuper toutes
 * les connexions du pool. Le plafond est large — il borne l'anormal.
 */
describe("plafond de lecture de l'annuaire et des fiches", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimit();
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 2 }));
    jest.mocked(listPlayers).mockResolvedValue([]);
    jest.mocked(getFullProfile).mockResolvedValue(fullProfileResponse());
    jest.mocked(listTeams).mockResolvedValue([]);
    jest.mocked(getUserActiveTeam).mockResolvedValue(null);
    jest.mocked(getTeamDetail).mockResolvedValue(teamDetailResponse());
  });
  afterEach(() => {
    jest.restoreAllMocks();
    resetRateLimit();
  });

  it.each(routes)("%s : répond jusqu'au plafond, puis 429 avec Retry-After", async (_name, call) => {
    for (let i = 0; i < DIRECTORY_READ_RULE.limit; i += 1) {
      expect((await call()).status).toBe(200);
    }

    const refused = await call();
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "TOO_MANY_REQUESTS" });
    expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  });

  it.each(routes)("%s : un refus ne lance aucun calcul", async (_name, call) => {
    for (let i = 0; i < DIRECTORY_READ_RULE.limit; i += 1) await call();
    jest.clearAllMocks();
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 2 }));

    await call();

    expect(listPlayers).not.toHaveBeenCalled();
    expect(getFullProfile).not.toHaveBeenCalled();
    expect(listTeams).not.toHaveBeenCalled();
    expect(getTeamDetail).not.toHaveBeenCalled();
  });

  it("partage un seul seau entre les quatre routes", async () => {
    // Ce qui est borné est le rythme auquel un compte fait recalculer des
    // statistiques, quelle que soit la fiche : alterner les routes ne donne
    // pas quatre plafonds.
    for (let i = 0; i < DIRECTORY_READ_RULE.limit; i += 1) {
      expect((await routes[i % routes.length][1]()).status).toBe(200);
    }
    for (const [, call] of routes) {
      expect((await call()).status).toBe(429);
    }
  });

  it("compte par compte : un joueur plafonné ne bloque pas les autres", async () => {
    for (let i = 0; i < DIRECTORY_READ_RULE.limit; i += 1) await listPlayersRoute();
    expect((await listPlayersRoute()).status).toBe(429);

    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 3 }));
    expect((await listPlayersRoute()).status).toBe(200);
  });

  it("refuse un visiteur sans session avant tout décompte", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    for (let i = 0; i < DIRECTORY_READ_RULE.limit + 5; i += 1) {
      expect((await listPlayersRoute()).status).toBe(401);
    }

    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 2 }));
    expect((await listPlayersRoute()).status).toBe(200);
  });

  it("ne plafonne pas un usage normal", () => {
    // Une page d'annuaire ou de fiche par seconde pendant une minute : personne
    // ne lit à ce rythme, et le plafond ne doit jamais toucher la navigation.
    expect(DIRECTORY_READ_RULE.limit).toBeGreaterThanOrEqual(60);
    expect(DIRECTORY_READ_RULE.windowMs).toBe(60_000);
  });
});
