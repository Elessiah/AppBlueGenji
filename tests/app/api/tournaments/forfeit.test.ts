import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");

import { POST } from "@/app/api/tournaments/[id]/forfeit/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/tournaments-service";

const member = { id: 2, isAdmin: false, roles: [] } as unknown as Awaited<
  ReturnType<typeof getCurrentUser>
>;
const referee = { id: 9, isAdmin: true } as Awaited<ReturnType<typeof getCurrentUser>>;

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
    (service.forfeitTournamentTeam as jest.Mock).mockResolvedValue(undefined as never);
    (service.getUserEntrant as jest.Mock).mockResolvedValue(entrant(null) as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it("rejette les anonymes (401)", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(401);
    expect(service.forfeitTournamentTeam).not.toHaveBeenCalled();
  });

  it("un membre déclare le forfait de son engagé (équipe active ou entrée solo)", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(member as never);
    (service.getUserEntrant as jest.Mock).mockResolvedValue(entrant(77) as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(service.forfeitTournamentTeam).toHaveBeenCalledWith(5, 77);
  });

  it("refuse un membre sans engagé dans ce tournoi (400)", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(member as never);
    (service.getUserEntrant as jest.Mock).mockResolvedValue(entrant(null) as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "NO_ACTIVE_TEAM" });
  });

  it("accepte qu'un membre cible explicitement sa propre équipe", async () => {
    // Le bouton du classement envoie toujours l'identifiant de l'équipe.
    (getCurrentUser as jest.Mock).mockResolvedValue(member as never);
    (service.getUserEntrant as jest.Mock).mockResolvedValue(entrant(77) as never);
    const res = await POST(req({ teamId: 77 }), params);
    expect(res.status).toBe(200);
    expect(service.forfeitTournamentTeam).toHaveBeenCalledWith(5, 77);
  });

  it("empêche un membre de forfaiter une autre équipe (403)", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(member as never);
    (service.getUserEntrant as jest.Mock).mockResolvedValue(entrant(77) as never);
    const res = await POST(req({ teamId: 88 }), params);
    expect(res.status).toBe(403);
    expect(service.forfeitTournamentTeam).not.toHaveBeenCalled();
  });

  it("refuse au joueur du roster sans rôle de gestion (403 NOT_TEAM_MANAGER)", async () => {
    // Même qualité que pour inscrire l'équipe : retirer l'équipe du tournoi
    // l'engage tout entière, et sans retour.
    (getCurrentUser as jest.Mock).mockResolvedValue(member as never);
    (service.getUserEntrant as jest.Mock).mockResolvedValue(entrant(77, false) as never);
    const res = await POST(req({ teamId: 77 }), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "NOT_TEAM_MANAGER" });
    expect(service.forfeitTournamentTeam).not.toHaveBeenCalled();
  });

  it("refuse aussi sans corps : le refus tient à la personne, pas à la cible", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(member as never);
    (service.getUserEntrant as jest.Mock).mockResolvedValue(entrant(77, false) as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(403);
    expect(service.forfeitTournamentTeam).not.toHaveBeenCalled();
  });

  it("un arbitre peut forcer le forfait d'une équipe ciblée", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(referee as never);
    const res = await POST(req({ teamId: 88 }), params);
    expect(res.status).toBe(200);
    expect(service.forfeitTournamentTeam).toHaveBeenCalledWith(5, 88);
  });

  // Un tournoi inconnu ne doit pas être maquillé en problème d'équipe : le
  // joueur a bien un engagé, c'est la cible qui n'existe pas.
  it("répond 404 quand le tournoi n'existe pas", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(member as never);
    (service.getUserEntrant as jest.Mock).mockRejectedValue(
      new Error("TOURNAMENT_NOT_FOUND") as never,
    );
    const res = await POST(req(), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "TOURNAMENT_NOT_FOUND" });
    expect(service.forfeitTournamentTeam).not.toHaveBeenCalled();
  });

  it("remonte TEAM_ALREADY_OUT en 400", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(referee as never);
    (service.forfeitTournamentTeam as jest.Mock).mockRejectedValue(
      new Error("TEAM_ALREADY_OUT") as never,
    );
    const res = await POST(req({ teamId: 88 }), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "TEAM_ALREADY_OUT" });
  });
});
