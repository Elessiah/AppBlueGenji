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

/**
 * Statuts HTTP du sigle.
 *
 * Deux familles à ne pas confondre : la **forme** est une faute de saisie (400,
 * et le code dit lequel des trois défauts corriger) ; l'**unicité** est un
 * conflit d'état (409). Et la collision de sigle ne doit jamais ressortir en
 * « nom déjà utilisé » — `bg_teams` porte deux uniques.
 */

type SessionUser = Awaited<ReturnType<typeof getCurrentUser>>;

const player = { id: 2, isAdmin: false, roles: [] } as unknown as SessionUser;
const admin = { id: 1, isAdmin: true, roles: ["ADMIN"] } as unknown as SessionUser;

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
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("transmet le sigle normalisé au service", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(player as never);
    (createTeam as jest.Mock).mockResolvedValue(11 as never);

    const res = await createTeamRoute(postReq({ name: "Dragon Squad", tag: " drgn " }));

    expect(res.status).toBe(201);
    expect(createTeam).toHaveBeenCalledWith(2, "Dragon Squad", null, "DRGN");
  });

  it("transmet null quand aucun sigle n'est saisi", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(player as never);
    (createTeam as jest.Mock).mockResolvedValue(11 as never);

    await createTeamRoute(postReq({ name: "Dragon Squad", tag: "" }));

    expect(createTeam).toHaveBeenCalledWith(2, "Dragon Squad", null, null);
  });

  it.each([
    ["D", "TEAM_TAG_TOO_SHORT"],
    ["DRGNS", "TEAM_TAG_TOO_LONG"],
    ["DR GN", "TEAM_TAG_NOT_ALPHANUMERIC"],
  ])("refuse %s en 400 avec le motif exact", async (tag, code) => {
    (getCurrentUser as jest.Mock).mockResolvedValue(player as never);

    const res = await createTeamRoute(postReq({ name: "Dragon Squad", tag }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: code });
    expect(createTeam).not.toHaveBeenCalled();
  });

  it("refuse la forme avant de créer quoi que ce soit, équipe fantôme comprise", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);

    const res = await createTeamRoute(postReq({ name: "Fantômes", tag: "X", ghost: true }));

    expect(res.status).toBe(400);
    expect(createGhostTeam).not.toHaveBeenCalled();
  });

  it("transmet le sigle à la création d'une équipe fantôme — même espace de noms", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (createGhostTeam as jest.Mock).mockResolvedValue(42 as never);

    const res = await createTeamRoute(postReq({ name: "Fantômes", tag: "gh01", ghost: true }));

    expect(res.status).toBe(201);
    expect(createGhostTeam).toHaveBeenCalledWith("Fantômes", null, "GH01");
  });

  it("rend 409 sur un sigle déjà pris", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(player as never);
    (createTeam as jest.Mock).mockRejectedValue(new Error("TEAM_TAG_ALREADY_USED") as never);

    const res = await createTeamRoute(postReq({ name: "Dragon Squad", tag: "DRGN" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "TEAM_TAG_ALREADY_USED" });
  });

  it("ne confond pas la collision de sigle avec celle du nom", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(player as never);
    (createTeam as jest.Mock).mockRejectedValue(new Error("TEAM_TAG_ALREADY_USED") as never);

    const res = await createTeamRoute(postReq({ name: "Dragon Squad", tag: "DRGN" }));

    expect((await res.json()).error).not.toBe("TEAM_NAME_ALREADY_USED");
  });

  it("laisse la collision de nom sur son propre code", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(player as never);
    (createTeam as jest.Mock).mockRejectedValue(
      new Error("Duplicate entry 'Dragon Squad' for key 'bg_teams.name'") as never,
    );

    const res = await createTeamRoute(postReq({ name: "Dragon Squad", tag: "DRGN" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "TEAM_NAME_ALREADY_USED" });
  });
});

describe("PATCH /api/teams/[id] — sigle", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("transmet le sigle au service", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(player as never);
    (updateTeamMeta as jest.Mock).mockResolvedValue(undefined as never);
    (getTeamDetail as jest.Mock).mockResolvedValue({ team: { id: 12 } } as never);

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
    (getCurrentUser as jest.Mock).mockResolvedValue(player as never);
    (updateTeamMeta as jest.Mock).mockRejectedValue(new Error("TEAM_TAG_ALREADY_USED") as never);

    const res = await patchTeamRoute(patchReq({ tag: "DRGN" }), params("12"));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "TEAM_TAG_ALREADY_USED" });
  });

  it.each(["TEAM_TAG_TOO_SHORT", "TEAM_TAG_TOO_LONG", "TEAM_TAG_NOT_ALPHANUMERIC"])(
    "rend 400 sur %s",
    async (code) => {
      (getCurrentUser as jest.Mock).mockResolvedValue(player as never);
      (updateTeamMeta as jest.Mock).mockRejectedValue(new Error(code) as never);

      const res = await patchTeamRoute(patchReq({ tag: "?" }), params("12"));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: code });
    },
  );

  it("laisse le refus d'autorisation en 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(player as never);
    (updateTeamMeta as jest.Mock).mockRejectedValue(new Error("FORBIDDEN") as never);

    const res = await patchTeamRoute(patchReq({ tag: "DRGN" }), params("12"));

    expect(res.status).toBe(403);
  });
});
