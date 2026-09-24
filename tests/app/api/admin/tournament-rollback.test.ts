import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/tournaments/rollback");

import { POST } from "@/app/api/admin/tournaments/[id]/rollback/route";
import { getCurrentUser } from "@/lib/server/auth";
import { sendBotLog } from "@/lib/server/bot-integration";
import { rollbackCurrentRound } from "@/lib/server/tournaments/rollback";
import { authUser } from "../../../helpers/auth-user";

const admin = authUser({ id: 1, pseudo: "Root", isAdmin: true, roles: ["ADMIN"] });
const arbitre = authUser({
  id: 2,
  pseudo: "Sifflet",
  isAdmin: false,
  roles: ["ARBITRE"],
});
const caster = authUser({
  id: 3,
  pseudo: "Micro",
  isAdmin: false,
  roles: ["CASTER"],
});
const player = authUser({ id: 4, pseudo: "Joueur", isAdmin: false, roles: [] });

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
    jest.mocked(rollbackCurrentRound).mockResolvedValue(rolledBack);
    jest.mocked(sendBotLog).mockResolvedValue(undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ["un administrateur", admin],
    // Défaire une manche est un acte d'arbitrage — la version en gros de la
    // correction de score que l'arbitre fait déjà. La suppression définitive
    // reste, elle, réservée aux administrateurs.
    ["un arbitre", arbitre],
  ])("défait le stade courant pour %s", async (_label, user) => {
    jest.mocked(getCurrentUser).mockResolvedValue(user);

    const res = await rollback("7");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rolledBack });
    expect(rollbackCurrentRound).toHaveBeenCalledWith(7, { expectedStage: undefined });
  });

  it("transmet le stade annoncé par l'écran", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

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
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    await rollback("7", body);

    expect(rollbackCurrentRound).toHaveBeenCalledWith(7, { expectedStage: undefined });
  });

  it("rejette un visiteur anonyme avec 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const res = await rollback("7");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(rollbackCurrentRound).not.toHaveBeenCalled();
  });

  it.each([
    ["un caster", caster],
    ["un joueur", player],
  ])("rejette %s avec 403", async (_label, user) => {
    jest.mocked(getCurrentUser).mockResolvedValue(user);

    const res = await rollback("7");

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN" });
    expect(rollbackCurrentRound).not.toHaveBeenCalled();
  });

  it("refuse un identifiant qui n'est pas un entier positif", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    const res = await rollback("abc");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_TOURNAMENT_ID" });
    expect(rollbackCurrentRound).not.toHaveBeenCalled();
  });

  it("rend 404 sur un tournoi inconnu", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(rollbackCurrentRound).mockRejectedValue(
      new Error("TOURNAMENT_NOT_FOUND"),
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
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(rollbackCurrentRound).mockRejectedValue(new Error(code));

    const res = await rollback("7");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: code });
  });

  it("masque une panne du moteur derrière un code du domaine", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(rollbackCurrentRound).mockRejectedValue(
      new Error("Deadlock found when trying to get lock"),
    );
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await rollback("7");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "ROLLBACK_FAILED" });
  });

  it("journalise le geste et le stade défait, l'auteur dans pm2 seulement", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    const info = jest.spyOn(console, "info").mockImplementation(() => {});

    await rollback("7");

    const line = String(jest.mocked(sendBotLog).mock.calls[0]?.[0]);
    expect(line).toContain("Retour en arrière");
    expect(line).toContain("« BlueGenji Open » (#7)");
    expect(line).toContain("la manche 4");
    expect(line).toContain("3 rencontres effacées");
    expect(line).toContain("par le staff");
    expect(line).not.toContain("Sifflet");
    expect(line).not.toContain("rouvert");
    expect(String(info.mock.calls[0]?.[0])).toContain("Sifflet");
    info.mockRestore();
  });

  it("reprend le libellé du serveur, jamais un libellé reconstruit", async () => {
    // Le stade que l'écran croyait effacer pouvait être périmé : seul le serveur
    // sait ce qu'il a réellement vidé.
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(rollbackCurrentRound).mockResolvedValue({
      ...rolledBack,
      label: "le tour 2 des play-offs",
      clearedMatches: 1,
    });

    await rollback("7");

    const line = String(jest.mocked(sendBotLog).mock.calls[0]?.[0]);
    expect(line).toContain("tour 2 des play-offs");
    expect(line).toContain("1 rencontre effacée");
  });

  it("dit au journal qu'un tournoi terminé vient d'être rouvert", async () => {
    // Un palmarès annoncé sur ce même canal quelques lignes plus haut ne vaut
    // plus : la clôture qui suivra en annoncera un autre.
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(rollbackCurrentRound).mockResolvedValue({
      ...rolledBack,
      reopenedTournament: true,
    });

    await rollback("7");

    expect(String(jest.mocked(sendBotLog).mock.calls[0]?.[0])).toContain("tournoi rouvert");
  });

  it("n'échoue pas parce que le bot dort", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(sendBotLog).mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await rollback("7");

    expect(res.status).toBe(200);
  });
});
