import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");

import { GET } from "@/app/api/tournaments/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/tournaments-service";

const emptyBuckets = { upcoming: [], registration: [], running: [], finished: [] };

type User = Awaited<ReturnType<typeof getCurrentUser>>;

const admin = { id: 1, isAdmin: true, roles: ["ADMIN"] } as unknown as User;
const arbitre = { id: 2, isAdmin: false, roles: ["ARBITRE"] } as unknown as User;
const communityManager = { id: 3, isAdmin: false, roles: ["COMMUNITY_MANAGER"] } as unknown as User;
const player = { id: 4, isAdmin: false, roles: [] } as unknown as User;

function get(url: string) {
  return GET(new Request(`http://localhost${url}`));
}

async function errorOf(response: Response): Promise<string> {
  return ((await response.json()) as { error?: string }).error ?? "";
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

  it("sert les invisibles à un administrateur", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);

    const res = await get("/api/tournaments?scope=hidden");

    expect(res.status).toBe(200);
    expect(service.listTournamentBuckets).toHaveBeenCalledWith(null, { hiddenOnly: true });
  });

  it("sert les invisibles à un arbitre", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);

    const res = await get("/api/tournaments?scope=hidden");

    expect(res.status).toBe(200);
    expect(service.listTournamentBuckets).toHaveBeenCalledWith(null, { hiddenOnly: true });
  });

  it("refuse les invisibles à un joueur", async () => {
    const res = await get("/api/tournaments?scope=hidden");

    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe("FORBIDDEN");
    // Rien ne doit être lu : le refus tombe avant la requête.
    expect(service.listTournamentBuckets).not.toHaveBeenCalled();
  });

  it("refuse les invisibles à un rôle d'un autre domaine", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(communityManager as never);

    const res = await get("/api/tournaments?scope=hidden");

    expect(res.status).toBe(403);
    expect(service.listTournamentBuckets).not.toHaveBeenCalled();
  });

  it("laisse la vue publique ouverte au joueur malgré le refus sur hidden", async () => {
    const res = await get("/api/tournaments");

    expect(res.status).toBe(200);
    expect(service.listTournamentBuckets).toHaveBeenCalledWith(null, {});
  });

  it("retombe sur la vue publique pour une portée inconnue", async () => {
    await get("/api/tournaments?scope=mine");

    expect(service.listTournamentBuckets).toHaveBeenCalledWith(null, {});
  });

  it("combine portée et recherche", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);

    await get("/api/tournaments?scope=hidden&search=Marvel");

    expect(service.listTournamentBuckets).toHaveBeenCalledWith("Marvel", { hiddenOnly: true });
  });

  it("refuse un visiteur non connecté", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);

    const res = await get("/api/tournaments?scope=hidden");

    expect(res.status).toBe(401);
    expect(service.listTournamentBuckets).not.toHaveBeenCalled();
  });
});
