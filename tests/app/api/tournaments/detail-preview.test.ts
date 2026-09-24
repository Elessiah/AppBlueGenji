import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");

import { GET } from "@/app/api/tournaments/[id]/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/tournaments-service";
import type { AuthUser } from "@/lib/server/auth";
import { authUser } from "../../../helpers/auth-user";
import { tournamentDetail } from "../../../helpers/tournament-detail";

type User = Pick<AuthUser, "id" | "isAdmin" | "roles">;

function get(id: string) {
  return GET(new Request(`http://localhost/api/tournaments/${id}`), {
    params: Promise.resolve({ id }),
  });
}

function login(user: User | null) {
  jest.mocked(getCurrentUser).mockResolvedValue(user && authUser(user));
}

/** Arguments du dernier appel : [id, userId, droits du lecteur]. */
function detailCall() {
  return jest.mocked(service.getTournamentDetail).mock.calls[0];
}

describe("GET /api/tournaments/[id] — droits d'aperçu, de diffusion et de suppression", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(service.getTournamentDetail).mockResolvedValue(tournamentDetail());
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("accorde gestion et aperçu à un administrateur", async () => {
    login({ id: 1, isAdmin: true, roles: ["ADMIN"] });

    const res = await get("7");

    expect(res.status).toBe(200);
    expect(detailCall()).toEqual([
      7,
      1,
      { canManage: true, canPreview: true, canManageLive: true, canDelete: true },
    ]);
  });

  // L'arbitre gère le tournoi mais ne l'efface pas : `canDelete` reste faux.
  it("accorde gestion et aperçu à un arbitre, sans droit de suppression", async () => {
    login({ id: 2, isAdmin: false, roles: ["ARBITRE"] });

    await get("7");

    expect(detailCall()).toEqual([
      7,
      2,
      { canManage: true, canPreview: true, canManageLive: true, canDelete: false },
    ]);
  });

  it("accorde au cast l'aperçu et la diffusion, mais aucun droit de gestion", async () => {
    login({ id: 3, isAdmin: false, roles: ["CASTER"] });

    await get("7");

    expect(detailCall()).toEqual([
      7,
      3,
      { canManage: false, canPreview: true, canManageLive: true, canDelete: false },
    ]);
  });

  it("refuse l'aperçu à un joueur ordinaire", async () => {
    login({ id: 4, isAdmin: false, roles: [] });

    await get("7");

    expect(detailCall()).toEqual([
      7,
      4,
      { canManage: false, canPreview: false, canManageLive: false, canDelete: false },
    ]);
  });

  it("refuse l'aperçu à un rôle d'un autre domaine", async () => {
    login({ id: 5, isAdmin: false, roles: ["COMMUNITY_MANAGER", "RECRUTEUR"] });

    await get("7");

    expect(detailCall()).toEqual([
      7,
      5,
      { canManage: false, canPreview: false, canManageLive: false, canDelete: false },
    ]);
  });

  it("refuse un visiteur non connecté", async () => {
    login(null);

    const res = await get("7");

    expect(res.status).toBe(401);
    expect(service.getTournamentDetail).not.toHaveBeenCalled();
  });

  it("refuse un identifiant de tournoi invalide", async () => {
    login({ id: 1, isAdmin: true, roles: ["ADMIN"] });

    const res = await get("abc");

    expect(res.status).toBe(400);
    expect(service.getTournamentDetail).not.toHaveBeenCalled();
  });

  it("répond 404 pour un tournoi inconnu", async () => {
    login({ id: 1, isAdmin: true, roles: ["ADMIN"] });
    jest.mocked(service.getTournamentDetail).mockResolvedValue(null);

    const res = await get("7");

    expect(res.status).toBe(404);
  });
});
