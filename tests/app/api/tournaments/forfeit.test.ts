import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");

import { POST } from "@/app/api/tournaments/[id]/forfeit/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/tournaments-service";
import { authUser } from "../../../helpers/auth-user";

const member = { id: 2, isAdmin: false, roles: [] } as unknown as Awaited<
  ReturnType<typeof getCurrentUser>
>;
const referee = authUser({ id: 9, isAdmin: true });

function req(body: unknown = {}) {
  return new Request("http://localhost/api/tournaments/5/forfeit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: "5" }) };

/** Engagé du joueur tel que le rend `getUserEntrant`. */
function entrant(teamId: number | null, canActForEntrant = true) {
  return { teamId, canActForEntrant };
}

describe("POST /api/tournaments/[id]/forfeit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(service.forfeitTournamentTeam).mockResolvedValue(undefined);
    jest.mocked(service.getUserEntrant).mockResolvedValue(entrant(null));
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejette les anonymes (401)", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const res = await POST(req(), params);
    expect(res.status).toBe(401);
    expect(service.forfeitTournamentTeam).not.toHaveBeenCalled();
  });

  it("un membre déclare le forfait de son engagé (équipe active ou entrée solo)", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(member);
    jest.mocked(service.getUserEntrant).mockResolvedValue(entrant(77));
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(service.forfeitTournamentTeam).toHaveBeenCalledWith(5, 77, 2);
  });

  it("refuse un membre sans engagé dans ce tournoi (400)", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(member);
    jest.mocked(service.getUserEntrant).mockResolvedValue(entrant(null));
    const res = await POST(req(), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "NO_ACTIVE_TEAM" });
  });

  it("accepte qu'un membre cible explicitement sa propre équipe", async () => {
    // Le bouton du classement envoie toujours l'identifiant de l'équipe.
    jest.mocked(getCurrentUser).mockResolvedValue(member);
    jest.mocked(service.getUserEntrant).mockResolvedValue(entrant(77));
    const res = await POST(req({ teamId: 77 }), params);
    expect(res.status).toBe(200);
    expect(service.forfeitTournamentTeam).toHaveBeenCalledWith(5, 77, 2);
  });

  it("empêche un membre de forfaiter une autre équipe (403)", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(member);
    jest.mocked(service.getUserEntrant).mockResolvedValue(entrant(77));
    const res = await POST(req({ teamId: 88 }), params);
    expect(res.status).toBe(403);
    expect(service.forfeitTournamentTeam).not.toHaveBeenCalled();
  });

  it("refuse au joueur du roster sans rôle de gestion (403 NOT_TEAM_MANAGER)", async () => {
    // Même qualité que pour inscrire l'équipe : retirer l'équipe du tournoi
    // l'engage tout entière, et sans retour.
    jest.mocked(getCurrentUser).mockResolvedValue(member);
    jest.mocked(service.getUserEntrant).mockResolvedValue(entrant(77, false));
    const res = await POST(req({ teamId: 77 }), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "NOT_TEAM_MANAGER" });
    expect(service.forfeitTournamentTeam).not.toHaveBeenCalled();
  });

  it("refuse aussi sans corps : le refus tient à la personne, pas à la cible", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(member);
    jest.mocked(service.getUserEntrant).mockResolvedValue(entrant(77, false));
    const res = await POST(req(), params);
    expect(res.status).toBe(403);
    expect(service.forfeitTournamentTeam).not.toHaveBeenCalled();
  });

  it("un arbitre peut forcer le forfait d'une équipe ciblée", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(referee);
    const res = await POST(req({ teamId: 88 }), params);
    expect(res.status).toBe(200);
    // `null` : l'arbitrage ne se revérifie pas contre un engagé à lui.
    expect(service.forfeitTournamentTeam).toHaveBeenCalledWith(5, 88, null);
  });

  // Un tournoi inconnu ne doit pas être maquillé en problème d'équipe : le
  // joueur a bien un engagé, c'est la cible qui n'existe pas.
  it("répond 404 quand le tournoi n'existe pas", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(member);
    jest.mocked(service.getUserEntrant).mockRejectedValue(
      new Error("TOURNAMENT_NOT_FOUND"),
    );
    const res = await POST(req(), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "TOURNAMENT_NOT_FOUND" });
    expect(service.forfeitTournamentTeam).not.toHaveBeenCalled();
  });

  it("traduit en 403 le refus que le service oppose dans sa transaction", async () => {
    // Le droit est relu à l'instant de l'écriture : un OWNER rétrogradé entre
    // la lecture de la route et le commit doit être arrêté là, pas avant.
    jest.mocked(getCurrentUser).mockResolvedValue(member);
    jest.mocked(service.getUserEntrant).mockResolvedValue(entrant(77));
    jest.mocked(service.forfeitTournamentTeam).mockRejectedValue(
      new Error("NOT_TEAM_MANAGER"),
    );

    const res = await POST(req({ teamId: 77 }), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "NOT_TEAM_MANAGER" });
  });

  it("remonte TEAM_ALREADY_OUT en 400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(referee);
    jest.mocked(service.forfeitTournamentTeam).mockRejectedValue(
      new Error("TEAM_ALREADY_OUT"),
    );
    const res = await POST(req({ teamId: 88 }), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "TEAM_ALREADY_OUT" });
  });
});
