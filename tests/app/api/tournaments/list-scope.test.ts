import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");

import { GET } from "@/app/api/tournaments/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/tournaments-service";

const emptyBuckets = { upcoming: [], registration: [], running: [], finished: [] };

const player = { id: 42, isAdmin: false } as Awaited<ReturnType<typeof getCurrentUser>>;

function get(url: string) {
  return GET(new Request(`http://localhost${url}`));
}

describe("GET /api/tournaments — portée", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCurrentUser as jest.Mock).mockResolvedValue(player as never);
    (service.listTournamentBuckets as jest.Mock).mockResolvedValue(emptyBuckets as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it("liste la vue publique sans portée", async () => {
    const res = await get("/api/tournaments");

    expect(res.status).toBe(200);
    expect(service.listTournamentBuckets).toHaveBeenCalledWith(null, {});
  });

  it("restreint à l'utilisateur connecté avec scope=mine", async () => {
    const res = await get("/api/tournaments?scope=mine");

    expect(res.status).toBe(200);
    expect(service.listTournamentBuckets).toHaveBeenCalledWith(null, { organizerUserId: 42 });
  });

  it("ignore un identifiant d'organisateur fourni par le client", async () => {
    await get("/api/tournaments?scope=mine&organizerUserId=1&userId=1");

    // La portée vient de la session : impossible de lire les tournois d'un autre.
    expect(service.listTournamentBuckets).toHaveBeenCalledWith(null, { organizerUserId: 42 });
  });

  it("retombe sur la vue publique pour une portée inconnue", async () => {
    await get("/api/tournaments?scope=all");

    expect(service.listTournamentBuckets).toHaveBeenCalledWith(null, {});
  });

  it("combine portée et recherche", async () => {
    await get("/api/tournaments?scope=mine&search=Marvel");

    expect(service.listTournamentBuckets).toHaveBeenCalledWith("Marvel", { organizerUserId: 42 });
  });

  it("refuse un visiteur non connecté", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);

    const res = await get("/api/tournaments?scope=mine");

    expect(res.status).toBe(401);
    expect(service.listTournamentBuckets).not.toHaveBeenCalled();
  });
});
