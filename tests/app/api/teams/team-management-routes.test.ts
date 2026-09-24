import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/teams-service");
jest.mock("@/lib/server/ghost-teams-service");
jest.mock("@/lib/server/solo-entries-service");

import { POST as membersPost, DELETE as membersDelete } from "@/app/api/teams/[id]/members/route";
import { GET as invitationsGet, POST as invitationsPost } from "@/app/api/teams/[id]/invitations/route";
import { DELETE as invitationDelete } from "@/app/api/invitations/[id]/route";
import { PATCH as teamPatch } from "@/app/api/teams/[id]/route";
import { POST as teamCreate } from "@/app/api/teams/route";
import { POST as transferPost } from "@/app/api/teams/[id]/transfer-ownership/route";
import { getCurrentUser } from "@/lib/server/auth";
import {
  cancelInvitation,
  createTeam,
  getTeamDetail,
  inviteToTeam,
  listTeamPendingInvitations,
  removeTeamMember,
  transferTeamOwnership,
  updateTeamMeta,
} from "@/lib/server/teams-service";
import { authUser } from "../../../helpers/auth-user";
import { teamDetailResponse } from "../../../helpers/team-detail";

/**
 * Routes de la fiche d'équipe en mode gestion : ce qu'elles transmettent au
 * service, et le statut HTTP de chaque refus qu'elles connaissent.
 */

const player = authUser({ id: 2, isAdmin: false, roles: [] });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function req(method: string, body?: unknown) {
  return new Request("http://localhost/api/x", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function errorOf(res: Response) {
  return ((await res.json()) as { error?: string }).error;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(player);
  jest.mocked(getTeamDetail).mockResolvedValue(teamDetailResponse());
});

describe.each([
  ["POST /api/teams/[id]/members", membersPost],
  ["POST /api/teams/[id]/invitations", invitationsPost],
])("%s — rôles d'invitation", (_label, route) => {
  it("transmet les rôles choisis au service", async () => {
    jest.mocked(inviteToTeam).mockResolvedValue("INVITED");

    const res = await route(req("POST", { pseudo: " Nova ", roles: ["TANK", "MANAGER"] }), params("7"));

    expect(res.status).toBe(200);
    expect(inviteToTeam).toHaveBeenCalledWith(2, 7, "Nova", ["TANK", "MANAGER"]);
  });

  it("laisse le service poser son défaut quand le corps ne dit rien", async () => {
    jest.mocked(inviteToTeam).mockResolvedValue("INVITED");

    await route(req("POST", { pseudo: "Nova" }), params("7"));

    expect(inviteToTeam).toHaveBeenCalledWith(2, 7, "Nova", undefined);
  });

  it.each(["INVITATION_NOT_PENDING", "TEAM_DELETED", "TEAM_NOT_JOINABLE", "PLAYER_ACCOUNT_DELETED"])(
    "rend %s — un état changé pendant l'arrivée — en 409",
    async (code) => {
      jest.mocked(inviteToTeam).mockRejectedValue(new Error(code));
      const res = await route(req("POST", { pseudo: "Nova" }), params("7"));
      expect(res.status).toBe(409);
    },
  );

  it("rend MISSING_ROLE en 400", async () => {
    jest.mocked(inviteToTeam).mockRejectedValue(new Error("MISSING_ROLE"));

    const res = await route(req("POST", { pseudo: "Nova", roles: [] }), params("7"));

    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("MISSING_ROLE");
  });
});

describe("GET /api/teams/[id]/invitations", () => {
  it("rend les demandes reçues et les invitations envoyées", async () => {
    const pending = {
      requests: [{ id: 1, userId: 3, pseudo: "Candidat", createdAt: "2026-01-01T00:00:00.000Z" }],
      invitations: [
        {
          id: 2,
          userId: 4,
          pseudo: "Invité",
          roles: ["DPS" as const],
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    jest.mocked(listTeamPendingInvitations).mockResolvedValue(pending);

    const res = await invitationsGet(req("GET"), params("7"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(pending);
  });

  it("refuse en 403 qui ne gère pas l'équipe", async () => {
    jest.mocked(listTeamPendingInvitations).mockRejectedValue(new Error("FORBIDDEN"));

    const res = await invitationsGet(req("GET"), params("7"));

    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/invitations/[id]", () => {
  it("rejette un visiteur anonyme", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const res = await invitationDelete(req("DELETE"), params("5"));
    expect(res.status).toBe(401);
    expect(cancelInvitation).not.toHaveBeenCalled();
  });

  it.each(["0", "-1", "abc"])("rejette un identifiant invalide (%s)", async (id) => {
    const res = await invitationDelete(req("DELETE"), params(id));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("INVALID_INVITATION_ID");
  });

  it("retire l'invitation au nom de l'appelant", async () => {
    jest.mocked(cancelInvitation).mockResolvedValue(undefined);
    const res = await invitationDelete(req("DELETE"), params("5"));
    expect(res.status).toBe(200);
    expect(cancelInvitation).toHaveBeenCalledWith(2, 5);
  });

  it.each([
    ["FORBIDDEN", 403],
    ["INVITATION_NOT_FOUND", 404],
    ["INVITATION_NOT_PENDING", 409],
  ])("rend %s en %i", async (code, status) => {
    jest.mocked(cancelInvitation).mockRejectedValue(new Error(code));
    const res = await invitationDelete(req("DELETE"), params("5"));
    expect(res.status).toBe(status);
    expect(await errorOf(res)).toBe(code);
  });
});

describe("PATCH /api/teams/[id] — nom", () => {
  it.each([
    ["INVALID_TEAM_NAME", 400],
    ["TEAM_NAME_ALREADY_USED", 409],
  ])("rend %s en %i", async (code, status) => {
    jest.mocked(updateTeamMeta).mockRejectedValue(new Error(code));
    const res = await teamPatch(req("PATCH", { name: "x" }), params("7"));
    expect(res.status).toBe(status);
    expect(await errorOf(res)).toBe(code);
  });
});

describe("POST /api/teams — mêmes bornes qu'au renommage", () => {
  it("refuse un nom de deux caractères sans rien créer", async () => {
    const res = await teamCreate(req("POST", { name: "ab" }));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("INVALID_TEAM_NAME");
    expect(createTeam).not.toHaveBeenCalled();
  });

  it("compte un emoji pour un caractère, comme la colonne", async () => {
    jest.mocked(createTeam).mockResolvedValue(11);
    const name = "🐉".repeat(60);
    const res = await teamCreate(req("POST", { name, acceptTerms: true }));
    expect(res.status).toBe(201);
    expect(createTeam).toHaveBeenCalledWith(2, name, null, null);
  });

  it("refuse la création sans l'acceptation des conditions d'utilisation, avant toute écriture", async () => {
    for (const body of [{ name: "Rolex" }, { name: "Rolex", acceptTerms: false }, { name: "Rolex", acceptTerms: "true" }]) {
      const res = await teamCreate(req("POST", body));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "TERMS_REQUIRED" });
    }
    expect(createTeam).not.toHaveBeenCalled();
  });
});

describe("refus de gestion traduits en statuts", () => {
  it("DELETE members : CANNOT_KICK_OWNER en 409", async () => {
    jest.mocked(removeTeamMember).mockRejectedValue(new Error("CANNOT_KICK_OWNER"));
    const res = await membersDelete(req("DELETE", { userId: 3 }), params("7"));
    expect(res.status).toBe(409);
  });

  it("transfert vers un compte supprimé : MEMBER_ACCOUNT_DELETED en 409", async () => {
    jest.mocked(transferTeamOwnership).mockRejectedValue(new Error("MEMBER_ACCOUNT_DELETED"));
    const res = await transferPost(req("POST", { newOwnerUserId: 3 }), params("7"));
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe("MEMBER_ACCOUNT_DELETED");
  });
});

describe("champs d'équipe non textuels", () => {
  it.each([
    [{ name: "Rolex", description: 5 }],
    [{ name: "Rolex", tag: 5 }],
    [{ name: 123 }],
  ])("PATCH refuse %p par un code nommé, sans atteindre le service", async (body) => {
    const res = await teamPatch(req("PATCH", body), params("7"));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("INVALID_TEAM_FIELDS");
    expect(updateTeamMeta).not.toHaveBeenCalled();
  });

  it("POST refuse une description numérique sans rien créer", async () => {
    const res = await teamCreate(req("POST", { name: "Rolex", description: 5 }));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("INVALID_TEAM_FIELDS");
    expect(createTeam).not.toHaveBeenCalled();
  });

  it("laisse passer null — qui vaut « retirer » — et l'absence", async () => {
    jest.mocked(updateTeamMeta).mockResolvedValue(undefined);
    const res = await teamPatch(req("PATCH", { name: "Rolex", tag: null }), params("7"));
    expect(res.status).toBe(200);
  });
});
