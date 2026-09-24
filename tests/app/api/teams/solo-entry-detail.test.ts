import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/teams-service");
jest.mock("@/lib/server/solo-entries-service");

import { GET as teamDetailRoute } from "@/app/api/teams/[id]/route";
import { getCurrentUser } from "@/lib/server/auth";
import { getTeamDetail } from "@/lib/server/teams-service";
import { findSoloEntryUser } from "@/lib/server/solo-entries-service";
import { authUser } from "../../../helpers/auth-user";
import { teamDetailResponse } from "../../../helpers/team-detail";

const player = authUser({ id: 2, isAdmin: false, roles: [] });

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (id: string) => new Request(`http://localhost/api/teams/${id}`);

/**
 * Une **entrée solo** occupe une ligne de `bg_teams` mais représente un joueur :
 * `getTeamDetail` la refuse, et un lien vers `/equipes/[id]` tombait donc sur
 * « Équipe non trouvée ». Rendre les noms cliquables partout ferait naître ce
 * cul-de-sac à chaque écran qui n'a qu'un `team_id` sous la main (adversaire
 * favori, bête noire) ; la route dit désormais où mener le lecteur, plutôt que
 * de laisser chaque appelant deviner.
 */
describe("GET /api/teams/[id] — un identifiant d'entrée solo", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getCurrentUser).mockResolvedValue(player);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rend le profil du joueur derrière l'entrée solo", async () => {
    jest.mocked(getTeamDetail).mockResolvedValue(null);
    jest.mocked(findSoloEntryUser).mockResolvedValue(77);

    const res = await teamDetailRoute(req("15245"), params("15245"));

    // 404 tout de même : il n'y a pas d'équipe à cet identifiant. Le corps porte
    // de quoi rebondir, il n'affirme pas le contraire.
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "TEAM_IS_SOLO_ENTRY", soloUserId: 77 });
  });

  it("garde le 404 nu pour une équipe qui n'existe pas", async () => {
    jest.mocked(getTeamDetail).mockResolvedValue(null);
    jest.mocked(findSoloEntryUser).mockResolvedValue(null);

    const res = await teamDetailRoute(req("999999"), params("999999"));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "TEAM_NOT_FOUND" });
  });

  it("ne cherche pas d'entrée solo quand l'équipe existe", async () => {
    const detail = teamDetailResponse({ team: { id: 641, name: "Test - Cosmic Void" } });
    jest.mocked(getTeamDetail).mockResolvedValue(detail);

    const res = await teamDetailRoute(req("641"), params("641"));

    expect(res.status).toBe(200);
    // La fiche dit en plus si le lecteur peut modérer le logo (`moderation`).
    expect(await res.json()).toEqual({ ...detail, canModerate: false });
    // Une requête de plus sur le chemin nominal serait payée par toutes les
    // fiches d'équipe pour le seul cas dégénéré.
    expect(findSoloEntryUser).not.toHaveBeenCalled();
  });

  it("refuse un identifiant qui n'est pas un entier positif, sans toucher la base", async () => {
    for (const id of ["0", "-3", "abc"]) {
      const res = await teamDetailRoute(req(id), params(id));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_TEAM_ID" });
    }
    expect(getTeamDetail).not.toHaveBeenCalled();
    expect(findSoloEntryUser).not.toHaveBeenCalled();
  });

  it("exige une session avant tout", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const res = await teamDetailRoute(req("641"), params("641"));

    expect(res.status).toBe(401);
    expect(getTeamDetail).not.toHaveBeenCalled();
  });
});
