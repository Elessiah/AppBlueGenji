import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");
jest.mock("@/lib/server/bot-integration");

import { DELETE } from "@/app/api/admin/tournaments/[id]/route";
import { getCurrentUser } from "@/lib/server/auth";
import { deleteTournament } from "@/lib/server/tournaments-service";
import { sendBotLog } from "@/lib/server/bot-integration";
import { authUser } from "../../../helpers/auth-user";

const admin = authUser({ id: 1, pseudo: "Root", isAdmin: true, roles: ["ADMIN"] });
const arbitre = authUser({ id: 2, pseudo: "Sifflet", isAdmin: false, roles: ["ARBITRE"] });
const caster = authUser({ id: 3, pseudo: "Micro", isAdmin: false, roles: ["CASTER"] });
const player = authUser({ id: 4, pseudo: "Joueur", isAdmin: false, roles: [] });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function del(id: string) {
  return DELETE(new Request(`http://localhost/api/admin/tournaments/${id}`, { method: "DELETE" }), params(id));
}

describe("DELETE /api/admin/tournaments/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(deleteTournament).mockResolvedValue({ id: 7, name: "BlueGenji Open" });
    jest.mocked(sendBotLog).mockResolvedValue(undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("supprime le tournoi pour un administrateur", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    const res = await del("7");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: { id: 7, name: "BlueGenji Open" } });
    expect(deleteTournament).toHaveBeenCalledWith(7);
  });

  it("rejette un visiteur anonyme avec 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

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
    jest.mocked(getCurrentUser).mockResolvedValue(user);

    const res = await del("7");

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN" });
    expect(deleteTournament).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "-3", "1.5"])("refuse l'identifiant invalide %s", async (id) => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    const res = await del(id);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_TOURNAMENT_ID" });
    expect(deleteTournament).not.toHaveBeenCalled();
  });

  it("répond 404 pour un tournoi inconnu", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(deleteTournament).mockRejectedValue(new Error("TOURNAMENT_NOT_FOUND"));

    const res = await del("7");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "TOURNAMENT_NOT_FOUND" });
  });

  it("répond 500 sans laisser fuir le message du moteur", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(deleteTournament).mockRejectedValue(new Error("ER_LOCK_DEADLOCK"));
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await del("7");

    expect(res.status).toBe(500);
    // Le texte de mysql2 est anglais et parle du moteur : l'interface est
    // entièrement en français, il reste donc au journal du serveur.
    expect(await res.json()).toEqual({ error: "TOURNAMENT_DELETE_FAILED" });
    expect(logged).toHaveBeenCalled();
  });

  it("journalise la suppression auprès du bot — seule trace restante", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    await del("7");

    expect(sendBotLog).toHaveBeenCalledTimes(1);
    const message = jest.mocked(sendBotLog).mock.calls[0][0] as string;
    expect(message).toContain("BlueGenji Open");
    expect(message).toContain("#7");
    // L'administrateur n'est pas nommé sur Discord…
    expect(message).toContain("par le staff");
    expect(message).not.toContain("Root");
  });

  it("nomme l'administrateur dans les journaux du serveur (pm2)", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const info = jest.spyOn(console, "info").mockImplementation(() => {});

    await del("7");

    const audit = String(info.mock.calls[0]?.[0]);
    expect(audit).toContain("[staff-audit]");
    expect(audit).toContain("Root (#1)");
    info.mockRestore();
  });

  it("reste un succès si le bot est injoignable", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(sendBotLog).mockRejectedValue(new Error("ECONNREFUSED"));

    // Le tournoi est déjà supprimé : un bot muet ne doit pas transformer un
    // succès en erreur côté administrateur.
    const res = await del("7");

    expect(res.status).toBe(200);
  });
});
