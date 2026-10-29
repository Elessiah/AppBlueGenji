import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/teams/detail");
jest.mock("@/lib/server/teams/directory");
jest.mock("@/lib/server/teams/dissolution");
jest.mock("@/lib/server/teams/identity");
jest.mock("@/lib/server/teams/roster");
jest.mock("@/lib/server/ghost-teams-service");
jest.mock("@/lib/server/solo-entries-service");

import { POST as createTeamRoute } from "@/app/api/teams/route";
import { DELETE as deleteTeamRoute } from "@/app/api/teams/[id]/route";
import { TEAM_LIFECYCLE_RULE } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { resetRateLimit } from "@/lib/server/rate-limit";
import { softDeleteTeam } from "@/lib/server/teams/dissolution";
import { createTeam } from "@/lib/server/teams/identity";
import { TERMS_VERSION } from "@/lib/shared/terms-of-use";
import { authUser } from "../../../helpers/auth-user";

/**
 * Plafond des créations et dissolutions d'équipe (`TEAM_LIFECYCLE_RULE`) : une
 * boucle « créer → dissoudre » faisait recalculer le classement et le podium
 * aux visiteurs à volonté. Un seul seau pour les deux gestes, par compte ;
 * seul un geste réussi est décompté ; le staff `tournaments` n'est pas plafonné.
 */

const player = authUser({ id: 2, isAdmin: false, roles: [] });
const staff = authUser({ id: 1, isAdmin: true, roles: ["ADMIN"] });

const create = () =>
  createTeamRoute(
    new Request("http://localhost/api/teams", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Dragon Squad", acceptTerms: true, termsVersion: TERMS_VERSION }),
    }),
  );
const dissolve = () =>
  deleteTeamRoute(new Request("http://localhost/api/teams/12", { method: "DELETE" }), {
    params: Promise.resolve({ id: "12" }),
  });

async function useUpTheBucket(gesture: () => Promise<Response>): Promise<void> {
  for (let i = 0; i < TEAM_LIFECYCLE_RULE.limit; i += 1) expect((await gesture()).status).toBeLessThan(300);
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimit();
  jest.mocked(getCurrentUser).mockResolvedValue(player);
  jest.mocked(createTeam).mockResolvedValue(11);
  jest.mocked(softDeleteTeam).mockResolvedValue(undefined);
});

describe("POST /api/teams — plafond de création", () => {
  it("POST_withinLimit_creates", async () => {
    expect((await create()).status).toBe(201);
    expect(createTeam).toHaveBeenCalledTimes(1);
  });

  it("POST_overLimit_returns429WithoutCreating", async () => {
    await useUpTheBucket(create);

    const res = await create();

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "TOO_MANY_REQUESTS" });
    expect(createTeam).toHaveBeenCalledTimes(TEAM_LIFECYCLE_RULE.limit);
  });

  it("POST_refusedCreation_isNotCharged", async () => {
    jest.mocked(createTeam).mockRejectedValue(new Error("TEAM_NAME_ALREADY_USED"));
    for (let i = 0; i < TEAM_LIFECYCLE_RULE.limit; i += 1) await create();
    jest.mocked(createTeam).mockResolvedValue(11);

    expect((await create()).status).toBe(201);
  });

  it("POST_staffTournaments_isNotCapped", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(staff);
    await useUpTheBucket(create);

    expect((await create()).status).toBe(201);
  });
});

describe("DELETE /api/teams/[id] — plafond de dissolution", () => {
  it("DELETE_withinLimit_dissolves", async () => {
    expect((await dissolve()).status).toBe(200);
    expect(softDeleteTeam).toHaveBeenCalledTimes(1);
  });

  it("DELETE_overLimit_returns429WithoutDissolving", async () => {
    await useUpTheBucket(dissolve);

    const res = await dissolve();

    expect(res.status).toBe(429);
    expect(softDeleteTeam).toHaveBeenCalledTimes(TEAM_LIFECYCLE_RULE.limit);
  });

  it("DELETE_refusedDissolution_isNotCharged", async () => {
    jest.mocked(softDeleteTeam).mockRejectedValue(new Error("FORBIDDEN"));
    for (let i = 0; i < TEAM_LIFECYCLE_RULE.limit; i += 1) await dissolve();
    jest.mocked(softDeleteTeam).mockResolvedValue(undefined);

    expect((await dissolve()).status).toBe(200);
  });

  it("DELETE_staffTournaments_isNotCapped", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(staff);
    await useUpTheBucket(dissolve);

    expect((await dissolve()).status).toBe(200);
  });

  it("DELETE_afterCreations_sharesTheSameBucket", async () => {
    await useUpTheBucket(create);

    expect((await dissolve()).status).toBe(429);
  });
});
