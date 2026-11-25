import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");
jest.mock("@/lib/server/tournaments/write-visibility");
jest.mock("@/lib/server/tournaments/registration-removal");
jest.mock("@/lib/server/bot-integration");

import { DELETE, POST } from "@/app/api/tournaments/[id]/register/route";
import { sendBotLog } from "@/lib/server/bot-integration";
import { withdrawOwnRegistration } from "@/lib/server/tournaments/registration-removal";
import { authUser } from "../../../helpers/auth-user";
import { canActOnTournament } from "@/lib/server/tournaments/write-visibility";
import { getCurrentUser } from "@/lib/server/auth";
import { resetRateLimit } from "@/lib/server/rate-limit";
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
  jest.mocked(service.registerCurrentUserTeam).mockRejectedValue(new Error(code));
}

describe("POST /api/tournaments/[id]/register", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimit();
    jest.mocked(canActOnTournament).mockResolvedValue(true);
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(service.registerCurrentUserTeam).mockResolvedValue(undefined);
  });

  it("rejette les anonymes (401)", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
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

describe("tournoi non publié", () => {
  it("répond le même 404 qu'un identifiant inexistant, sans atteindre le service", async () => {
    jest.clearAllMocks();
    resetRateLimit();
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(canActOnTournament).mockResolvedValue(false);
    const res = await POST(req(), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "TOURNAMENT_NOT_FOUND" });
    expect(service.registerCurrentUserTeam).not.toHaveBeenCalled();
  });
});

/**
 * `DELETE /api/tournaments/[id]/register` — désinscription par le joueur
 * lui-même, avant le coup d'envoi (`docs/features/SELF_WITHDRAWAL.md`).
 */
describe("DELETE /api/tournaments/[id]/register", () => {
  const withdrawer = authUser({ id: 7, pseudo: "Pseudonyme", isAdmin: false, roles: [] });
  const withdrawn = {
    tournamentId: 5,
    tournamentName: "BlueGenji Open",
    teamId: 102,
    entrantName: "Team Nova",
    registeredTeams: 15,
    maxTeams: 16,
    participantType: "TEAM" as const,
  };

  function unregister(id = "5") {
    return DELETE(
      new Request(`http://localhost/api/tournaments/${id}/register`, { method: "DELETE" }),
      { params: Promise.resolve({ id }) },
    );
  }

  function withdrawalRejectsWith(code: string) {
    jest.mocked(withdrawOwnRegistration).mockRejectedValue(new Error(code));
  }

  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimit();
    jest.mocked(canActOnTournament).mockResolvedValue(true);
    jest.mocked(getCurrentUser).mockResolvedValue(withdrawer);
    jest.mocked(withdrawOwnRegistration).mockResolvedValue(withdrawn);
    jest.mocked(sendBotLog).mockReturnValue(undefined);
  });

  it("DELETE_anonymous_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const res = await unregister();

    expect(res.status).toBe(401);
    expect(withdrawOwnRegistration).not.toHaveBeenCalled();
  });

  it("DELETE_invalidTournamentId_returns400", async () => {
    const res = await unregister("douze");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_TOURNAMENT_ID" });
  });

  it("DELETE_unpublishedTournament_returns404", async () => {
    jest.mocked(canActOnTournament).mockResolvedValue(false);

    const res = await unregister();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "TOURNAMENT_NOT_FOUND" });
    expect(withdrawOwnRegistration).not.toHaveBeenCalled();
  });

  it("DELETE_registeredEntrant_returns200AndLogsWithoutPseudo", async () => {
    const res = await unregister();

    expect(res.status).toBe(200);
    expect(withdrawOwnRegistration).toHaveBeenCalledWith(5, 7);
    const [line, scope] = jest.mocked(sendBotLog).mock.calls[0];
    expect(line).toContain("Désinscription");
    expect(line).toContain("Team Nova");
    expect(line).not.toContain("Pseudonyme");
    expect(scope).toEqual({ category: "registrations", tournamentId: 5 });
  });

  it.each<[string, string, number]>([
    ["DELETE_notTeamManager_returns403", "NOT_TEAM_MANAGER", 403],
    ["DELETE_noActiveTeam_returns400", "NO_ACTIVE_TEAM", 400],
    ["DELETE_teamNotInTournament_returns404", "TEAM_NOT_IN_TOURNAMENT", 404],
    ["DELETE_tournamentStarted_returns409", "ENTRANT_REMOVAL_TOURNAMENT_STARTED", 409],
    ["DELETE_tournamentFinished_returns409", "ENTRANT_REMOVAL_TOURNAMENT_FINISHED", 409],
    ["DELETE_activeTeamChangedDuringLock_returns409", "CONCURRENT_UPDATE_RETRY", 409],
  ])("%s", async (_name, code, status) => {
    withdrawalRejectsWith(code);

    const res = await unregister();

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: code });
    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("DELETE_unexpectedError_returns500WithoutLeakingMessage", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    withdrawalRejectsWith("Table 'bg_tournament_registrations' is marked as crashed");

    const res = await unregister();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "WITHDRAWAL_FAILED" });
    jest.mocked(console.error).mockRestore();
  });
});
