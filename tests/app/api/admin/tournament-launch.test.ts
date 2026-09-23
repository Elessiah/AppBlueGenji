import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/launch");

import { POST } from "@/app/api/admin/tournaments/[id]/launch/route";
import { getCurrentUser } from "@/lib/server/auth";
import { launchTournamentNow, type LaunchedTournament } from "@/lib/server/tournaments/launch";
import { authUser } from "../../../helpers/auth-user";

const admin = authUser({ id: 1, pseudo: "Root", isAdmin: true, roles: ["ADMIN"] });
const arbitre = authUser({ id: 2, pseudo: "Sifflet", isAdmin: false, roles: ["ARBITRE"] });
const caster = authUser({ id: 3, pseudo: "Micro", isAdmin: false, roles: ["CASTER"] });
const player = authUser({ id: 4, pseudo: "Joueur", isAdmin: false, roles: [] });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function launch(id: string) {
  return POST(
    new Request(`http://localhost/api/admin/tournaments/${id}/launch`, { method: "POST" }),
    params(id),
  );
}

const launched: LaunchedTournament = { id: 7, name: "BlueGenji Open", state: "RUNNING", entrantCount: 12 };

describe("POST /api/admin/tournaments/[id]/launch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(launchTournamentNow).mockResolvedValue(launched);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ["un administrateur", admin],
    // Lancer un tournoi est un acte d'organisation, pas le cran au-dessus :
    // l'arbitre, qui clôt déjà les scores, y a droit — contrairement à la
    // suppression définitive.
    ["un arbitre", arbitre],
  ])("lance le tournoi pour %s", async (_label, user) => {
    jest.mocked(getCurrentUser).mockResolvedValue(user);

    const res = await launch("7");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ launched });
    expect(launchTournamentNow).toHaveBeenCalledWith(7);
  });

  it("rejette un visiteur anonyme avec 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

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
    jest.mocked(getCurrentUser).mockResolvedValue(user);

    const res = await launch("7");

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN" });
    expect(launchTournamentNow).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "-3", "1.5"])("refuse l'identifiant invalide %s", async (id) => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    const res = await launch(id);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_TOURNAMENT_ID" });
    expect(launchTournamentNow).not.toHaveBeenCalled();
  });

  it("répond 404 pour un tournoi inconnu", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(launchTournamentNow).mockRejectedValue(new Error("TOURNAMENT_NOT_FOUND"));

    const res = await launch("7");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "TOURNAMENT_NOT_FOUND" });
  });

  it.each(["TOURNAMENT_ALREADY_STARTED", "TOURNAMENT_ALREADY_FINISHED"])(
    "répond 409 quand il n'y a plus rien à abréger (%s)",
    async (code) => {
      jest.mocked(getCurrentUser).mockResolvedValue(admin);
      jest.mocked(launchTournamentNow).mockRejectedValue(new Error(code));

      const res = await launch("7");

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: code });
    },
  );

  it.each(["INVALID_DATES", "INVALID_DATE_ORDER"])("répond 400 sur %s", async (code) => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(launchTournamentNow).mockRejectedValue(new Error(code));

    const res = await launch("7");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: code });
  });

  it("répond 500 sans laisser fuir le message du moteur", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(launchTournamentNow).mockRejectedValue(new Error("ER_LOCK_DEADLOCK"));
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await launch("7");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "TOURNAMENT_LAUNCH_FAILED" });
    expect(logged).toHaveBeenCalled();
  });
});
