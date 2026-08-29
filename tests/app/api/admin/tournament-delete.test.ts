import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");
jest.mock("@/lib/server/bot-integration");

import { DELETE } from "@/app/api/admin/tournaments/[id]/route";
import { getCurrentUser } from "@/lib/server/auth";
import { deleteTournament } from "@/lib/server/tournaments-service";
import { sendBotLog } from "@/lib/server/bot-integration";

type SessionUser = Awaited<ReturnType<typeof getCurrentUser>>;

const admin = { id: 1, pseudo: "Root", isAdmin: true, roles: ["ADMIN"] } as unknown as SessionUser;
const arbitre = { id: 2, pseudo: "Sifflet", isAdmin: false, roles: ["ARBITRE"] } as unknown as SessionUser;
const caster = { id: 3, pseudo: "Micro", isAdmin: false, roles: ["CASTER"] } as unknown as SessionUser;
const player = { id: 4, pseudo: "Joueur", isAdmin: false, roles: [] } as unknown as SessionUser;

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function del(id: string) {
  return DELETE(new Request(`http://localhost/api/admin/tournaments/${id}`, { method: "DELETE" }), params(id));
}

describe("DELETE /api/admin/tournaments/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (deleteTournament as jest.Mock).mockResolvedValue({ id: 7, name: "BlueGenji Open" } as never);
    (sendBotLog as jest.Mock).mockResolvedValue(undefined as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it("supprime le tournoi pour un administrateur", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);

    const res = await del("7");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: { id: 7, name: "BlueGenji Open" } });
    expect(deleteTournament).toHaveBeenCalledWith(7);
  });

  it("rejette un visiteur anonyme avec 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);

    const res = await del("7");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(deleteTournament).not.toHaveBeenCalled();
  });

  it.each([
    ["un arbitre", arbitre],
    ["un caster", caster],
    ["un joueur ordinaire", player],
  ])("rejette %s avec 403 — la permission `tournaments` ne suffit pas", async (_label, user) => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user as never);

    const res = await del("7");

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN" });
    expect(deleteTournament).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "-3", "1.5"])("refuse l'identifiant invalide %s", async (id) => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);

    const res = await del(id);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_TOURNAMENT_ID" });
    expect(deleteTournament).not.toHaveBeenCalled();
  });

  it("répond 404 pour un tournoi inconnu", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (deleteTournament as jest.Mock).mockRejectedValue(new Error("TOURNAMENT_NOT_FOUND") as never);

    const res = await del("7");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "TOURNAMENT_NOT_FOUND" });
  });

  it("répond 500 sans laisser fuir le message du moteur", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (deleteTournament as jest.Mock).mockRejectedValue(new Error("ER_LOCK_DEADLOCK") as never);
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await del("7");

    expect(res.status).toBe(500);
    // Le texte de mysql2 est anglais et parle du moteur : l'interface est
    // entièrement en français, il reste donc au journal du serveur.
    expect(await res.json()).toEqual({ error: "TOURNAMENT_DELETE_FAILED" });
    expect(logged).toHaveBeenCalled();
  });

  it("journalise la suppression auprès du bot — seule trace restante", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);

    await del("7");

    expect(sendBotLog).toHaveBeenCalledTimes(1);
    const message = (sendBotLog as jest.Mock).mock.calls[0][0] as string;
    expect(message).toContain("BlueGenji Open");
    expect(message).toContain("#7");
    expect(message).toContain("Root");
  });

  it("reste un succès si le bot est injoignable", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(admin as never);
    (sendBotLog as jest.Mock).mockRejectedValue(new Error("ECONNREFUSED") as never);

    // Le tournoi est déjà supprimé : un bot muet ne doit pas transformer un
    // succès en erreur côté administrateur.
    const res = await del("7");

    expect(res.status).toBe(200);
  });
});
