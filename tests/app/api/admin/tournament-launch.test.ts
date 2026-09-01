import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/launch");

import { POST } from "@/app/api/admin/tournaments/[id]/launch/route";
import { getCurrentUser } from "@/lib/server/auth";
import { launchTournamentNow } from "@/lib/server/tournaments/launch";

type SessionUser = Awaited<ReturnType<typeof getCurrentUser>>;

const admin = { id: 1, pseudo: "Root", isAdmin: true, roles: ["ADMIN"] } as unknown as SessionUser;
const arbitre = { id: 2, pseudo: "Sifflet", isAdmin: false, roles: ["ARBITRE"] } as unknown as SessionUser;
const caster = { id: 3, pseudo: "Micro", isAdmin: false, roles: ["CASTER"] } as unknown as SessionUser;
const player = { id: 4, pseudo: "Joueur", isAdmin: false, roles: [] } as unknown as SessionUser;

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function launch(id: string) {
  return POST(
    new Request(`http://localhost/api/admin/tournaments/${id}/launch`, { method: "POST" }),
    params(id),
  );
}

const launched = { id: 7, name: "BlueGenji Open", state: "RUNNING", entrantCount: 12 };

describe("POST /api/admin/tournaments/[id]/launch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (launchTournamentNow as jest.Mock).mockResolvedValue(launched as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ["un administrateur", admin],
    // Lancer un tournoi est un acte d'organisation, pas le cran au-dessus :
    // l'arbitre, qui clôt déjà les scores, y a droit — contrairement à la
    // suppression définitive.
    ["un arbitre", arbitre],
  ])("lance le tournoi pour %s", async (_label, user) => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);

    const res = await launch("7");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ launched });
    expect(launchTournamentNow).toHaveBeenCalledWith(7);
  });

  it("rejette un visiteur anonyme avec 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);

    const res = await launch("7");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(launchTournamentNow).not.toHaveBeenCalled();
  });

  it.each([
    // Le cast lit l'aperçu du plateau ; il ne décide pas du coup d'envoi.
    ["un caster", caster],
    ["un joueur ordinaire", player],
  ])("rejette %s avec 403", async (_label, user) => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);

    const res = await launch("7");

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN" });
    expect(launchTournamentNow).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "-3", "1.5"])("refuse l'identifiant invalide %s", async (id) => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);

    const res = await launch(id);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_TOURNAMENT_ID" });
    expect(launchTournamentNow).not.toHaveBeenCalled();
  });

  it("répond 404 pour un tournoi inconnu", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (launchTournamentNow as jest.Mock).mockRejectedValue(new Error("TOURNAMENT_NOT_FOUND") as never);

    const res = await launch("7");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "TOURNAMENT_NOT_FOUND" });
  });

  it.each(["TOURNAMENT_ALREADY_STARTED", "TOURNAMENT_ALREADY_FINISHED"])(
    "répond 409 quand il n'y a plus rien à abréger (%s)",
    async (code) => {
      (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
      (launchTournamentNow as jest.Mock).mockRejectedValue(new Error(code) as never);

      const res = await launch("7");

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: code });
    },
  );

  it.each(["INVALID_DATES", "INVALID_DATE_ORDER"])("répond 400 sur %s", async (code) => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (launchTournamentNow as jest.Mock).mockRejectedValue(new Error(code) as never);

    const res = await launch("7");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: code });
  });

  it("répond 500 sans laisser fuir le message du moteur", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (launchTournamentNow as jest.Mock).mockRejectedValue(new Error("ER_LOCK_DEADLOCK") as never);
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await launch("7");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "TOURNAMENT_LAUNCH_FAILED" });
    expect(logged).toHaveBeenCalled();
  });
});
