import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/tournaments/rollback");

import { POST } from "@/app/api/admin/tournaments/[id]/rollback/route";
import { getCurrentUser } from "@/lib/server/auth";
import { sendBotLog } from "@/lib/server/bot-integration";
import { rollbackCurrentRound } from "@/lib/server/tournaments/rollback";

type SessionUser = Awaited<ReturnType<typeof getCurrentUser>>;

const admin = { id: 1, pseudo: "Root", isAdmin: true, roles: ["ADMIN"] } as unknown as SessionUser;
const arbitre = {
  id: 2,
  pseudo: "Sifflet",
  isAdmin: false,
  roles: ["ARBITRE"],
} as unknown as SessionUser;
const caster = {
  id: 3,
  pseudo: "Micro",
  isAdmin: false,
  roles: ["CASTER"],
} as unknown as SessionUser;
const player = { id: 4, pseudo: "Joueur", isAdmin: false, roles: [] } as unknown as SessionUser;

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function rollback(id: string, body?: unknown) {
  return POST(
    new Request(`http://localhost/api/admin/tournaments/${id}/rollback`, {
      method: "POST",
      ...(body === undefined
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    }),
    params(id),
  );
}

const rolledBack = {
  tournamentId: 7,
  tournamentName: "BlueGenji Open",
  stageKey: "0:4",
  roundNumber: 4,
  phaseRank: 0,
  label: "la manche 4",
  clearedMatches: 3,
  reopenedTournament: false,
};

describe("POST /api/admin/tournaments/[id]/rollback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (rollbackCurrentRound as jest.Mock).mockResolvedValue(rolledBack as never);
    (sendBotLog as jest.Mock).mockResolvedValue(true as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ["un administrateur", admin],
    // Défaire une manche est un acte d'arbitrage — la version en gros de la
    // correction de score que l'arbitre fait déjà. La suppression définitive
    // reste, elle, réservée aux administrateurs.
    ["un arbitre", arbitre],
  ])("défait le stade courant pour %s", async (_label, user) => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);

    const res = await rollback("7");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rolledBack });
    expect(rollbackCurrentRound).toHaveBeenCalledWith(7, { expectedStage: undefined });
  });

  it("transmet le stade annoncé par l'écran", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);

    await rollback("7", { expectedStage: "0:4" });

    expect(rollbackCurrentRound).toHaveBeenCalledWith(7, { expectedStage: "0:4" });
  });

  it.each([
    ["un corps absent", undefined],
    ["un corps sans la clé", { autre: 1 }],
    ["un stade qui n'est pas une chaîne", { expectedStage: 4 }],
    ["une chaîne vide", { expectedStage: "" }],
    ["une chaîne démesurée", { expectedStage: "0:".padEnd(200, "9") }],
  ])("s'en remet à la base sur %s", async (_label, body) => {
    // Le garde-fou ne peut que faire refuser le geste, jamais le déplacer : un
    // corps qu'on ne sait pas lire retombe donc sur le comportement d'origine.
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);

    await rollback("7", body);

    expect(rollbackCurrentRound).toHaveBeenCalledWith(7, { expectedStage: undefined });
  });

  it("rejette un visiteur anonyme avec 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);

    const res = await rollback("7");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(rollbackCurrentRound).not.toHaveBeenCalled();
  });

  it.each([
    ["un caster", caster],
    ["un joueur", player],
  ])("rejette %s avec 403", async (_label, user) => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);

    const res = await rollback("7");

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN" });
    expect(rollbackCurrentRound).not.toHaveBeenCalled();
  });

  it("refuse un identifiant qui n'est pas un entier positif", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);

    const res = await rollback("abc");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_TOURNAMENT_ID" });
    expect(rollbackCurrentRound).not.toHaveBeenCalled();
  });

  it("rend 404 sur un tournoi inconnu", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (rollbackCurrentRound as jest.Mock).mockRejectedValue(
      new Error("TOURNAMENT_NOT_FOUND") as never,
    );

    const res = await rollback("7");

    expect(res.status).toBe(404);
  });

  it.each([
    "ROLLBACK_TOURNAMENT_NOT_STARTED",
    "ROLLBACK_NOTHING_TO_UNDO",
    "ROLLBACK_ROUND_CHANGED",
  ])("rend 409 sur %s", async (code) => {
    // La demande est bien formée : c'est l'état du tournoi qui la contredit.
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (rollbackCurrentRound as jest.Mock).mockRejectedValue(new Error(code) as never);

    const res = await rollback("7");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: code });
  });

  it("masque une panne du moteur derrière un code du domaine", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (rollbackCurrentRound as jest.Mock).mockRejectedValue(
      new Error("Deadlock found when trying to get lock") as never,
    );
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await rollback("7");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "ROLLBACK_FAILED" });
  });

  it("journalise le geste avec son auteur et le stade défait", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(arbitre as never);

    await rollback("7");

    const line = String((sendBotLog as jest.Mock).mock.calls[0]?.[0]);
    expect(line).toContain("Retour en arrière");
    expect(line).toContain("« BlueGenji Open » (#7)");
    expect(line).toContain("la manche 4");
    expect(line).toContain("3 rencontres effacées");
    expect(line).toContain("Sifflet");
    expect(line).not.toContain("rouvert");
  });

  it("reprend le libellé du serveur, jamais un libellé reconstruit", async () => {
    // Le stade que l'écran croyait effacer pouvait être périmé : seul le serveur
    // sait ce qu'il a réellement vidé.
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (rollbackCurrentRound as jest.Mock).mockResolvedValue({
      ...rolledBack,
      label: "le tour 2 des play-offs",
      clearedMatches: 1,
    } as never);

    await rollback("7");

    const line = String((sendBotLog as jest.Mock).mock.calls[0]?.[0]);
    expect(line).toContain("tour 2 des play-offs");
    expect(line).toContain("1 rencontre effacée");
  });

  it("dit au journal qu'un tournoi terminé vient d'être rouvert", async () => {
    // Un palmarès annoncé sur ce même canal quelques lignes plus haut ne vaut
    // plus : la clôture qui suivra en annoncera un autre.
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (rollbackCurrentRound as jest.Mock).mockResolvedValue({
      ...rolledBack,
      reopenedTournament: true,
    } as never);

    await rollback("7");

    expect(String((sendBotLog as jest.Mock).mock.calls[0]?.[0])).toContain("tournoi rouvert");
  });

  it("n'échoue pas parce que le bot dort", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (sendBotLog as jest.Mock).mockRejectedValue(new Error("ECONNREFUSED") as never);

    const res = await rollback("7");

    expect(res.status).toBe(200);
  });
});
