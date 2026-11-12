import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users/roles");

import { POST } from "@/app/api/admin/users/[id]/roles/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/users/roles";
import type { RolesSaveResult } from "@/lib/server/users/roles";
import type { PlatformRole } from "@/lib/shared/permissions";
import { authUser } from "../../../helpers/auth-user";

const admin = authUser({ id: 1, isAdmin: true });
const normalUser = authUser({ id: 2, isAdmin: false });

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/admin/users/7/roles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Ce que rend le service : les rôles enregistrés et ceux qu'ils remplacent. */
function saved(roles: PlatformRole[], previous: PlatformRole[] = []): RolesSaveResult {
  return { roles, previous };
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/admin/users/[id]/roles", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects anonymous users with 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const res = await POST(jsonReq({ roles: ["ARBITRE"] }), params("7"));
    expect(res.status).toBe(401);
    expect(service.setUserRoles).not.toHaveBeenCalled();
  });

  it("rejects non-admins with 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(normalUser);
    const res = await POST(jsonReq({ roles: ["ARBITRE"] }), params("7"));
    expect(res.status).toBe(403);
    expect(service.setUserRoles).not.toHaveBeenCalled();
  });

  it("refuse un cumul de rôles qui ne comprend pas ADMIN", async () => {
    // La garde s'écrit `can(user, "roles")`, la permission que seul `ADMIN`
    // porte : un arbitre qui est aussi caster et community manager n'approche
    // pas plus de l'attribution des rôles qu'un compte nu. Le test tient
    // l'équivalence entre la permission et `isAdmin` — c'est elle qui permet à
    // §1.4 de n'avoir qu'une seule exception, la suppression d'un tournoi.
    const staff = authUser({
      id: 3,
      isAdmin: false,
      roles: ["ARBITRE", "CASTER", "COMMUNITY_MANAGER", "RECRUTEUR"],
    });

    jest.mocked(getCurrentUser).mockResolvedValue(staff);
    const res = await POST(jsonReq({ roles: ["ADMIN"] }), params("7"));
    expect(res.status).toBe(403);
    expect(service.setUserRoles).not.toHaveBeenCalled();
  });

  it("accepte un ADMIN porté par `roles` sans le drapeau `isAdmin`", async () => {
    // L'autre face de l'équivalence : `can()` lit les deux, le contrôle ne doit
    // pas dépendre de la seule colonne.
    const rolesAdmin = { id: 4, isAdmin: false, roles: ["ADMIN"] } as Awaited<
      ReturnType<typeof getCurrentUser>
    >;

    jest.mocked(getCurrentUser).mockResolvedValue(rolesAdmin);
    jest.mocked(service.setUserRoles).mockResolvedValue(saved(["ARBITRE"]));
    const res = await POST(jsonReq({ roles: ["ARBITRE"] }), params("7"));
    expect(res.status).toBe(200);
    expect(service.setUserRoles).toHaveBeenCalledWith(7, ["ARBITRE"], 4, undefined);
  });

  it("rejects invalid ids with 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await POST(jsonReq({ roles: [] }), params("abc"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_ID" });
  });

  // ADMIN-SELF-ROLES : un administrateur règle ses rôles cumulables, jamais son ADMIN.
  it("post_adminOnSelfWithoutAdmin_returns400CannotRemoveOwnAdmin", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await POST(jsonReq({ roles: ["ARBITRE"] }), params("1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "CANNOT_REMOVE_OWN_ADMIN" });
    expect(service.setOwnPlatformRoles).not.toHaveBeenCalled();
    expect(service.setUserRoles).not.toHaveBeenCalled();
    expect(service.publishRolesChange).not.toHaveBeenCalled();
  });

  it("post_adminOnSelfKeepingAdmin_returns200AndUsesOwnPath", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.setOwnPlatformRoles).mockResolvedValue(saved(["ADMIN", "CASTER"], ["ADMIN"]));

    const res = await POST(jsonReq({ roles: ["ADMIN", "CASTER"] }), params("1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ roles: ["ADMIN", "CASTER"] });
    expect(service.setOwnPlatformRoles).toHaveBeenCalledWith(1, ["ADMIN", "CASTER"], undefined);
    expect(service.setUserRoles).not.toHaveBeenCalled();
    expect(service.publishRolesChange).toHaveBeenCalledWith(
      { id: 1, pseudo: admin.pseudo },
      1,
      saved(["ADMIN", "CASTER"], ["ADMIN"]),
    );
  });

  it("post_rolesOnlyAdminWithoutColumnOnSelf_returns400CannotModifySelf", async () => {
    const rolesAdmin = authUser({ id: 4, isAdmin: false, roles: ["ADMIN"] });
    jest.mocked(getCurrentUser).mockResolvedValue(rolesAdmin);

    const res = await POST(jsonReq({ roles: ["ADMIN"] }), params("4"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "CANNOT_MODIFY_SELF" });
    expect(service.setOwnPlatformRoles).not.toHaveBeenCalled();
  });

  it("post_selfDemotedDuringSave_returns403Forbidden", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.setOwnPlatformRoles).mockRejectedValue(new Error("NOT_ADMIN"));

    const res = await POST(jsonReq({ roles: ["ADMIN"] }), params("1"));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN" });
    expect(service.publishRolesChange).not.toHaveBeenCalled();
  });

  it("post_otherAccountWhileActorDemoted_returns403ForbiddenWithoutAudit", async () => {
    // Deux administrateurs qui se retirent l'administration au même instant :
    // l'écriture du second ne trouve plus d'auteur administrateur.
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.setUserRoles).mockRejectedValue(new Error("NOT_ADMIN"));

    const res = await POST(jsonReq({ roles: [] }), params("7"));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN" });
    expect(service.publishRolesChange).not.toHaveBeenCalled();
  });

  it("post_selfInvalidPayload_returns400InvalidPayload", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    const res = await POST(jsonReq({ roles: ["ADMIN", "NOPE"] }), params("1"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_PAYLOAD" });
    expect(service.setOwnPlatformRoles).not.toHaveBeenCalled();
  });

  it("post_otherAccountSaved_publishesAuditWithActorAndTarget", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.setUserRoles).mockResolvedValue(saved(["RECRUTEUR"], ["CASTER"]));

    await POST(jsonReq({ roles: ["RECRUTEUR"] }), params("7"));

    expect(service.publishRolesChange).toHaveBeenCalledWith(
      { id: 1, pseudo: admin.pseudo },
      7,
      saved(["RECRUTEUR"], ["CASTER"]),
    );
  });

  it("post_serviceThrowsUnknownError_returns500WithGenericCode", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.setUserRoles).mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.3:3306"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(jsonReq({ roles: ["ARBITRE"] }), params("7"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "ROLES_UPDATE_FAILED" });
    expect(service.publishRolesChange).not.toHaveBeenCalled();
  });

  it("post_serviceThrowsUnknownError_logsCodeOnly", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const driverError = Object.assign(new Error("Duplicate entry 'Test_Pseudo' for key 'pseudo'"), {
      code: "ER_DUP_ENTRY",
      sqlMessage: "Duplicate entry 'Test_Pseudo' for key 'pseudo'",
    });
    jest.mocked(service.setUserRoles).mockRejectedValue(driverError);
    const error = jest.spyOn(console, "error").mockImplementation(() => {});

    await POST(jsonReq({ roles: ["ARBITRE"] }), params("7"));

    expect(error).toHaveBeenCalledWith("[roles] enregistrement impossible : ER_DUP_ENTRY");
  });

  it("post_serviceDeadlock_returns409ConcurrentUpdateRetry", async () => {
    // La ligne du compte est lue `FOR UPDATE` : deux enregistrements simultanés
    // peuvent s'interbloquer, ce qui se réessaie.
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest
      .mocked(service.setUserRoles)
      .mockRejectedValue(Object.assign(new Error("Deadlock found when trying to get lock"), { code: "ER_LOCK_DEADLOCK", errno: 1213 }));
    jest.spyOn(console, "warn").mockImplementation(() => {});

    const res = await POST(jsonReq({ roles: ["ARBITRE"] }), params("7"));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "CONCURRENT_UPDATE_RETRY" });
  });

  it("rejects a non-array roles payload with 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await POST(jsonReq({ roles: "ARBITRE" }), params("7"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_PAYLOAD" });
    expect(service.setUserRoles).not.toHaveBeenCalled();
  });

  it("rejects unknown role values with 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const res = await POST(jsonReq({ roles: ["ARBITRE", "NOPE"] }), params("7"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_PAYLOAD" });
    expect(service.setUserRoles).not.toHaveBeenCalled();
  });

  it("assigns cumulative roles for admins", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.setUserRoles).mockResolvedValue(saved(["ARBITRE", "RECRUTEUR"]));

    const res = await POST(jsonReq({ roles: ["ARBITRE", "RECRUTEUR"] }), params("7"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ roles: ["ARBITRE", "RECRUTEUR"] });
    expect(service.setUserRoles).toHaveBeenCalledWith(7, ["ARBITRE", "RECRUTEUR"], admin.id, undefined);
  });

  it("accepts an empty roles array (revokes all)", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.setUserRoles).mockResolvedValue(saved([], ["ARBITRE"]));

    const res = await POST(jsonReq({ roles: [] }), params("7"));
    expect(res.status).toBe(200);
    expect(service.setUserRoles).toHaveBeenCalledWith(7, [], admin.id, undefined);
  });

  it("returns 404 when the target user does not exist", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.setUserRoles).mockRejectedValue(new Error("USER_NOT_FOUND"));

    const res = await POST(jsonReq({ roles: ["ADMIN"] }), params("7"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "USER_NOT_FOUND" });
  });

  it("post_expectedRoles_forwardedToService", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.setUserRoles).mockResolvedValue(saved(["ARBITRE"], ["CASTER"]));

    await POST(jsonReq({ roles: ["ARBITRE"], expectedRoles: ["CASTER"] }), params("7"));

    expect(service.setUserRoles).toHaveBeenCalledWith(7, ["ARBITRE"], admin.id, ["CASTER"]);
  });

  it("post_expectedRolesNotAnArray_returns400InvalidPayload", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    const res = await POST(jsonReq({ roles: ["ARBITRE"], expectedRoles: "CASTER" }), params("7"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_PAYLOAD" });
    expect(service.setUserRoles).not.toHaveBeenCalled();
  });

  it("post_expectedRolesUnknownValue_returns400InvalidPayload", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    const res = await POST(jsonReq({ roles: ["ARBITRE"], expectedRoles: ["NOPE"] }), params("7"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_PAYLOAD" });
    expect(service.setUserRoles).not.toHaveBeenCalled();
  });

  it("post_rolesChangedSinceDisplay_returns409WithoutAudit", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.setUserRoles).mockRejectedValue(new Error("ROLES_CHANGED"));

    const res = await POST(jsonReq({ roles: ["ARBITRE"], expectedRoles: [] }), params("7"));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "ROLES_CHANGED" });
    expect(service.publishRolesChange).not.toHaveBeenCalled();
  });

  it("post_auditThrowsAfterCommit_stillReturns200AndLogsCodeOnly", async () => {
    // L'écriture est validée : une levée du journal ne doit pas faire croire
    // à l'auteur que rien n'a été enregistré.
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.setUserRoles).mockResolvedValue(saved(["ARBITRE"]));
    jest.mocked(service.publishRolesChange).mockImplementation(() => {
      throw new Error("staff log down at 10.0.0.3");
    });
    const error = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(jsonReq({ roles: ["ARBITRE"] }), params("7"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ roles: ["ARBITRE"] });
    expect(error).toHaveBeenCalledWith("[roles] journal du staff non publié : Error");
  });
});
