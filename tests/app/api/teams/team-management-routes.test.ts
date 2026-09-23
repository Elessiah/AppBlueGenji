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

/**
 * Routes de la fiche d'équipe en mode gestion : ce qu'elles transmettent au
 * service, et le statut HTTP de chaque refus qu'elles connaissent.
 */

type SessionUser = Awaited<ReturnType<typeof getCurrentUser>>;
const player = { id: 2, isAdmin: false, roles: [] } as unknown as SessionUser;

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
  (getCurrentUser as jest.Mock).mockResolvedValue(player as never);
  (getTeamDetail as jest.Mock).mockResolvedValue({} as never);
});

describe.each([
  ["POST /api/teams/[id]/members", membersPost],
  ["POST /api/teams/[id]/invitations", invitationsPost],
])("%s — rôles d'invitation", (_label, route) => {
  it("transmet les rôles choisis au service", async () => {
    (inviteToTeam as jest.Mock).mockResolvedValue("INVITED" as never);

    const res = await route(req("POST", { pseudo: " Nova ", roles: ["TANK", "MANAGER"] }), params("7"));

    expect(res.status).toBe(200);
    expect(inviteToTeam).toHaveBeenCalledWith(2, 7, "Nova", ["TANK", "MANAGER"]);
  });

  it("laisse le service poser son défaut quand le corps ne dit rien", async () => {
    (inviteToTeam as jest.Mock).mockResolvedValue("INVITED" as never);

    await route(req("POST", { pseudo: "Nova" }), params("7"));

    expect(inviteToTeam).toHaveBeenCalledWith(2, 7, "Nova", undefined);
  });

  it.each(["INVITATION_NOT_PENDING", "TEAM_DELETED", "TEAM_NOT_JOINABLE", "PLAYER_ACCOUNT_DELETED"])(
    "rend %s — un état changé pendant l'arrivée — en 409",
    async (code) => {
      (inviteToTeam as jest.Mock).mockRejectedValue(new Error(code) as never);
      const res = await route(req("POST", { pseudo: "Nova" }), params("7"));
      expect(res.status).toBe(409);
    },
  );

  it("rend MISSING_ROLE en 400", async () => {
    (inviteToTeam as jest.Mock).mockRejectedValue(new Error("MISSING_ROLE") as never);

    const res = await route(req("POST", { pseudo: "Nova", roles: [] }), params("7"));

    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("MISSING_ROLE");
  });
});

describe("GET /api/teams/[id]/invitations", () => {
  it("rend les demandes reçues et les invitations envoyées", async () => {
    (listTeamPendingInvitations as jest.Mock).mockResolvedValue({
      requests: [{ id: 1 }],
      invitations: [{ id: 2 }],
    } as never);

    const res = await invitationsGet(req("GET"), params("7"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requests: [{ id: 1 }], invitations: [{ id: 2 }] });
  });

  it("refuse en 403 qui ne gère pas l'équipe", async () => {
    (listTeamPendingInvitations as jest.Mock).mockRejectedValue(new Error("FORBIDDEN") as never);

    const res = await invitationsGet(req("GET"), params("7"));

    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/invitations/[id]", () => {
  it("rejette un visiteur anonyme", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
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
    (cancelInvitation as jest.Mock).mockResolvedValue(undefined as never);
    const res = await invitationDelete(req("DELETE"), params("5"));
    expect(res.status).toBe(200);
    expect(cancelInvitation).toHaveBeenCalledWith(2, 5);
  });

  it.each([
    ["FORBIDDEN", 403],
    ["INVITATION_NOT_FOUND", 404],
    ["INVITATION_NOT_PENDING", 409],
  ])("rend %s en %i", async (code, status) => {
    (cancelInvitation as jest.Mock).mockRejectedValue(new Error(code) as never);
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
    (updateTeamMeta as jest.Mock).mockRejectedValue(new Error(code) as never);
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
    (createTeam as jest.Mock).mockResolvedValue(11 as never);
    const name = "🐉".repeat(60);
    const res = await teamCreate(req("POST", { name }));
    expect(res.status).toBe(201);
    expect(createTeam).toHaveBeenCalledWith(2, name, null, null);
  });
});

describe("refus de gestion traduits en statuts", () => {
  it("DELETE members : CANNOT_KICK_OWNER en 409", async () => {
    (removeTeamMember as jest.Mock).mockRejectedValue(new Error("CANNOT_KICK_OWNER") as never);
    const res = await membersDelete(req("DELETE", { userId: 3 }), params("7"));
    expect(res.status).toBe(409);
  });

  it("transfert vers un compte supprimé : MEMBER_ACCOUNT_DELETED en 409", async () => {
    (transferTeamOwnership as jest.Mock).mockRejectedValue(new Error("MEMBER_ACCOUNT_DELETED") as never);
    const res = await transferPost(req("POST", { newOwnerUserId: 3 }), params("7"));
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe("MEMBER_ACCOUNT_DELETED");
  });
});
