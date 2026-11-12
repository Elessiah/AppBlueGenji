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
import { DELETE as deleteTeamRoute, PATCH as patchTeamRoute } from "@/app/api/teams/[id]/route";
import { TEAM_IDENTITY_WRITE_RULE, TEAM_LIFECYCLE_RULE } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { resetRateLimit } from "@/lib/server/rate-limit";
import { softDeleteTeam } from "@/lib/server/teams/dissolution";
import { createTeam, updateTeamMeta } from "@/lib/server/teams/identity";
import { getTeamDetail } from "@/lib/server/teams/detail";
import { teamDetailResponse } from "../../../helpers/team-detail";
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

const rename = () =>
  patchTeamRoute(
    new Request("http://localhost/api/teams/12", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Dragon Squad" }),
    }),
    { params: Promise.resolve({ id: "12" }) },
  );

const emptyPatch = () =>
  patchTeamRoute(
    new Request("http://localhost/api/teams/12", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    { params: Promise.resolve({ id: "12" }) },
  );

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

  it("POST_parallelRequestsAtLastSlot_onlyOnePasses", async () => {
    for (let i = 0; i < TEAM_LIFECYCLE_RULE.limit - 1; i += 1) await create();
    const pending: ((id: number) => void)[] = [];
    jest.mocked(createTeam).mockImplementation(() => new Promise<number>((resolve) => pending.push(resolve)));

    const first = create();
    const second = await create();
    pending[0](11);

    expect(second.status).toBe(429);
    expect((await first).status).toBe(201);
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
    jest.mocked(softDeleteTeam).mockRejectedValue(new Error("TEAM_ALREADY_DELETED"));
    for (let i = 0; i < TEAM_LIFECYCLE_RULE.limit; i += 1) expect((await dissolve()).status).toBe(409);
    jest.mocked(softDeleteTeam).mockResolvedValue(undefined);

    expect((await dissolve()).status).toBe(200);
  });

  it("DELETE_forbiddenRefusals_keepTheirPlace", async () => {
    // Un compte sans qualité qui boucle sur les équipes des autres reste plafonné.
    jest.mocked(softDeleteTeam).mockRejectedValue(new Error("FORBIDDEN"));
    for (let i = 0; i < TEAM_LIFECYCLE_RULE.limit; i += 1) expect((await dissolve()).status).toBe(403);
    jest.mocked(softDeleteTeam).mockResolvedValue(undefined);

    expect((await dissolve()).status).toBe(429);
  });

  it("DELETE_parallelRequestsAtLastSlot_onlyOnePasses", async () => {
    for (let i = 0; i < TEAM_LIFECYCLE_RULE.limit - 1; i += 1) await dissolve();
    const pending: (() => void)[] = [];
    jest.mocked(softDeleteTeam).mockImplementation(() => new Promise<void>((resolve) => pending.push(() => resolve())));

    const first = dissolve();
    const second = await dissolve();
    pending[0]();

    expect(second.status).toBe(429);
    expect((await first).status).toBe(200);
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

// Écritures d'identité (nom, sigle, description) : une boucle de renommages
// vidait à volonté le classement et les vues de l'accueil.
describe("PATCH /api/teams/[id] — plafond des écritures d'identité", () => {
  beforeEach(() => {
    jest.mocked(updateTeamMeta).mockResolvedValue(undefined);
    jest.mocked(getTeamDetail).mockResolvedValue(teamDetailResponse());
  });

  it("PATCH_overIdentityWriteLimit_returns429WithoutWriting", async () => {
    for (let i = 0; i < TEAM_IDENTITY_WRITE_RULE.limit; i += 1) expect((await rename()).status).toBe(200);

    const res = await rename();

    expect(res.status).toBe(429);
    expect(updateTeamMeta).toHaveBeenCalledTimes(TEAM_IDENTITY_WRITE_RULE.limit);
  });

  it("PATCH_nameTakenRefusals_doNotUseUpTheLimit", async () => {
    jest.mocked(updateTeamMeta).mockRejectedValue(new Error("TEAM_NAME_ALREADY_USED"));
    for (let i = 0; i < TEAM_IDENTITY_WRITE_RULE.limit; i += 1) expect((await rename()).status).toBe(409);
    jest.mocked(updateTeamMeta).mockResolvedValue(undefined);

    const res = await rename();

    expect(res.status).toBe(200);
  });

  it("PATCH_forbiddenRefusals_keepTheirPlace", async () => {
    // Un compte sans qualité qui boucle sur l'équipe d'un autre reste plafonné.
    jest.mocked(updateTeamMeta).mockRejectedValue(new Error("FORBIDDEN"));
    for (let i = 0; i < TEAM_IDENTITY_WRITE_RULE.limit; i += 1) expect((await rename()).status).toBe(403);
    jest.mocked(updateTeamMeta).mockResolvedValue(undefined);

    const res = await rename();

    expect(res.status).toBe(429);
  });

  it("PATCH_invalidFields_doNotUseUpTheLimit", async () => {
    const invalid = () =>
      patchTeamRoute(
        new Request("http://localhost/api/teams/12", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: 42 }),
        }),
        { params: Promise.resolve({ id: "12" }) },
      );
    for (let i = 0; i < TEAM_IDENTITY_WRITE_RULE.limit; i += 1) expect((await invalid()).status).toBe(400);

    const res = await rename();

    expect(res.status).toBe(200);
  });

  it("PATCH_emptyBody_doesNotUseUpTheLimit", async () => {
    for (let i = 0; i < TEAM_IDENTITY_WRITE_RULE.limit; i += 1) expect((await emptyPatch()).status).toBe(200);

    const res = await rename();

    expect(res.status).toBe(200);
  });

  it("PATCH_emptyBodyForbidden_keepsItsPlace", async () => {
    jest.mocked(updateTeamMeta).mockRejectedValue(new Error("FORBIDDEN"));
    for (let i = 0; i < TEAM_IDENTITY_WRITE_RULE.limit; i += 1) expect((await emptyPatch()).status).toBe(403);

    const res = await emptyPatch();

    expect(res.status).toBe(429);
  });

  it("PATCH_staffTournaments_isNotCapped", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(staff);
    for (let i = 0; i < TEAM_IDENTITY_WRITE_RULE.limit; i += 1) await rename();

    expect((await rename()).status).toBe(200);
  });
});
