import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");

import { POST } from "@/app/api/tournaments/[id]/register/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/tournaments-service";
import { REGISTRATION_FILTER_ERRORS } from "@/lib/shared/registration-filters";

/**
 * Les statuts de `POST /api/tournaments/[id]/register`.
 *
 * Ce qui se joue ici est le **409** des conditions d'inscription : la saisie est
 * bonne, c'est l'état de l'équipe qui ne convient pas, et il se corrige —
 * recruter, certifier un tag, rattacher un compte Blizzard. Un 400 laisserait
 * entendre le contraire, et un 500 ne dirait rien du tout.
 *
 * La route ne recopie plus la liste des refus : elle interroge le module pur
 * (`isRegistrationFilterError`). Le balayage ci-dessous est ce qui rend cette
 * délégation vérifiable — un refus ajouté demain au module y est couvert sans
 * qu'une ligne soit écrite ici.
 *
 * Voir `docs/features/REGISTRATION_FILTERS.md`.
 */

const player = { id: 7, isAdmin: false, roles: [] } as unknown as Awaited<
  ReturnType<typeof getCurrentUser>
>;

const params = { params: Promise.resolve({ id: "5" }) };

function req() {
  return new Request("http://localhost/api/tournaments/5/register", { method: "POST" });
}

/** Le service lève son code par `message`, comme partout dans le moteur. */
function rejectsWith(code: string) {
  (service.registerCurrentUserTeam as jest.Mock).mockRejectedValue(new Error(code) as never);
}

describe("POST /api/tournaments/[id]/register", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCurrentUser as jest.Mock).mockResolvedValue(player as never);
    (service.registerCurrentUserTeam as jest.Mock).mockResolvedValue(undefined as never);
  });

  it("rejette les anonymes (401)", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(401);
    expect(service.registerCurrentUserTeam).not.toHaveBeenCalled();
  });

  it("inscrit l'engagé du joueur", async () => {
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(service.registerCurrentUserTeam).toHaveBeenCalledWith(5, 7);
  });

  it("refuse un identifiant de tournoi illisible (400)", async () => {
    const res = await POST(req(), { params: Promise.resolve({ id: "douze" }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_TOURNAMENT_ID" });
  });

  it("rend 409 sur **chaque** refus de condition, et le code avec", async () => {
    for (const code of REGISTRATION_FILTER_ERRORS) {
      rejectsWith(code);
      const res = await POST(req(), params);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: code });
    }
  });

  it("garde 403 pour le refus de qualité, qui n'est pas une condition", async () => {
    // Le joueur a bien une équipe et elle remplit peut-être tout : c'est son
    // droit d'engager qui manque (`OWNER`/`MANAGER`).
    rejectsWith("NOT_TEAM_MANAGER");
    const res = await POST(req(), params);
    expect(res.status).toBe(403);
  });

  it("garde 400 pour les refus d'état du tournoi", async () => {
    for (const code of [
      "NO_ACTIVE_TEAM",
      "REGISTRATION_CLOSED",
      "TOURNAMENT_FULL",
      "ALREADY_REGISTERED",
      "SOLO_ENTRY_NAME_UNAVAILABLE",
    ]) {
      rejectsWith(code);
      const res = await POST(req(), params);
      expect(res.status).toBe(400);
    }
  });

  it("laisse un échec inconnu en 500 : il n'a pas de geste à proposer", async () => {
    rejectsWith("ER_LOCK_DEADLOCK");
    const res = await POST(req(), params);
    expect(res.status).toBe(500);
  });
});
