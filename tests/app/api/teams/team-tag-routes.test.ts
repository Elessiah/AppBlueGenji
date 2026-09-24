import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/teams-service");
jest.mock("@/lib/server/ghost-teams-service");
jest.mock("@/lib/server/solo-entries-service");

import { POST as createTeamRoute } from "@/app/api/teams/route";
import { PATCH as patchTeamRoute } from "@/app/api/teams/[id]/route";
import { getCurrentUser } from "@/lib/server/auth";
import { createTeam, getTeamDetail, updateTeamMeta } from "@/lib/server/teams-service";
import { createGhostTeam } from "@/lib/server/ghost-teams-service";
import { authUser } from "../../../helpers/auth-user";
import { teamDetailResponse } from "../../../helpers/team-detail";

/**
 * Statuts HTTP du sigle.
 *
 * Deux familles à ne pas confondre : la **forme** est une faute de saisie (400,
 * et le code dit lequel des trois défauts corriger) ; l'**unicité** est un
 * conflit d'état (409). Et la collision de sigle ne doit jamais ressortir en
 * « nom déjà utilisé » — `bg_teams` porte deux uniques.
 */

const player = authUser({ id: 2, isAdmin: false, roles: [] });
const admin = authUser({ id: 1, isAdmin: true, roles: ["ADMIN"] });

function postReq(body: unknown) {
  return new Request("http://localhost/api/teams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchReq(body: unknown) {
  return new Request("http://localhost/api/teams/12", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/teams — sigle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("transmet le sigle normalisé au service", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(createTeam).mockResolvedValue(11);

    const res = await createTeamRoute(postReq({ name: "Dragon Squad", tag: " drgn ", acceptTerms: true }));

    expect(res.status).toBe(201);
    expect(createTeam).toHaveBeenCalledWith(2, "Dragon Squad", null, "DRGN");
  });

  it("transmet null quand aucun sigle n'est saisi", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(createTeam).mockResolvedValue(11);

    await createTeamRoute(postReq({ name: "Dragon Squad", tag: "", acceptTerms: true }));

    expect(createTeam).toHaveBeenCalledWith(2, "Dragon Squad", null, null);
  });

  it.each([
    ["D", "TEAM_TAG_TOO_SHORT"],
    ["DRGNS", "TEAM_TAG_TOO_LONG"],
    ["DR GN", "TEAM_TAG_NOT_ALPHANUMERIC"],
  ])("refuse %s en 400 avec le motif exact", async (tag, code) => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);

    const res = await createTeamRoute(postReq({ name: "Dragon Squad", tag, acceptTerms: true }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: code });
    expect(createTeam).not.toHaveBeenCalled();
  });

  it("refuse la forme avant de créer quoi que ce soit, équipe fantôme comprise", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    const res = await createTeamRoute(postReq({ name: "Fantômes", tag: "X", ghost: true }));

    expect(res.status).toBe(400);
    expect(createGhostTeam).not.toHaveBeenCalled();
  });

  it("transmet le sigle à la création d'une équipe fantôme — même espace de noms", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(createGhostTeam).mockResolvedValue(42);

    const res = await createTeamRoute(postReq({ name: "Fantômes", tag: "gh01", ghost: true }));

    expect(res.status).toBe(201);
    expect(createGhostTeam).toHaveBeenCalledWith("Fantômes", null, "GH01");
  });

  it("rend 409 sur un sigle déjà pris", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(createTeam).mockRejectedValue(new Error("TEAM_TAG_ALREADY_USED"));

    const res = await createTeamRoute(postReq({ name: "Dragon Squad", tag: "DRGN", acceptTerms: true }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "TEAM_TAG_ALREADY_USED" });
  });

  it("ne confond pas la collision de sigle avec celle du nom", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(createTeam).mockRejectedValue(new Error("TEAM_TAG_ALREADY_USED"));

    const res = await createTeamRoute(postReq({ name: "Dragon Squad", tag: "DRGN", acceptTerms: true }));

    expect((await res.json()).error).not.toBe("TEAM_NAME_ALREADY_USED");
  });

  it("laisse la collision de nom sur son propre code", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(createTeam).mockRejectedValue(
      new Error("Duplicate entry 'Dragon Squad' for key 'bg_teams.name'"),
    );

    const res = await createTeamRoute(postReq({ name: "Dragon Squad", tag: "DRGN", acceptTerms: true }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "TEAM_NAME_ALREADY_USED" });
  });
});

describe("PATCH /api/teams/[id] — sigle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("transmet le sigle au service", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(updateTeamMeta).mockResolvedValue(undefined);
    jest.mocked(getTeamDetail).mockResolvedValue(teamDetailResponse({ team: { id: 12 } }));

    const res = await patchTeamRoute(patchReq({ name: "Dragon", tag: "DRGN" }), params("12"));

    expect(res.status).toBe(200);
    expect(updateTeamMeta).toHaveBeenCalledWith(
      2,
      12,
      { name: "Dragon", description: undefined, tag: "DRGN" },
      false,
    );
  });

  it("rend 409 sur un sigle déjà pris", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(updateTeamMeta).mockRejectedValue(new Error("TEAM_TAG_ALREADY_USED"));

    const res = await patchTeamRoute(patchReq({ tag: "DRGN" }), params("12"));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "TEAM_TAG_ALREADY_USED" });
  });

  it.each(["TEAM_TAG_TOO_SHORT", "TEAM_TAG_TOO_LONG", "TEAM_TAG_NOT_ALPHANUMERIC"])(
    "rend 400 sur %s",
    async (code) => {
      jest.mocked(getCurrentUser).mockResolvedValue(player);
      jest.mocked(updateTeamMeta).mockRejectedValue(new Error(code));

      const res = await patchTeamRoute(patchReq({ tag: "?" }), params("12"));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: code });
    },
  );

  it("laisse le refus d'autorisation en 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(updateTeamMeta).mockRejectedValue(new Error("FORBIDDEN"));

    const res = await patchTeamRoute(patchReq({ tag: "DRGN" }), params("12"));

    expect(res.status).toBe(403);
  });
});
