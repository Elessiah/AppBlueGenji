import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/image-upload");

import { deleteTournament } from "@/lib/server/tournaments/deletion";
import { getDatabase } from "@/lib/server/database";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { deleteStoredImage } from "@/lib/server/image-upload";

type ExecuteMock = jest.Mock;

/** Requêtes émises sur la connexion, dans l'ordre, normalisées sur une ligne. */
function statements(execute: ExecuteMock): string[] {
  return execute.mock.calls.map((call) => String((call as [string])[0]).replace(/\s+/g, " ").trim());
}

function mockConnection(execute: ExecuteMock) {
  const connection = {
    execute,
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };
  (getDatabase as jest.Mock).mockResolvedValue({
    execute: jest.fn(),
    getConnection: jest.fn(async () => connection),
  } as never);
  return connection;
}

/** Connexion dont le SELECT d'identité renvoie le tournoi demandé. */
function mockExistingTournament(name = "BlueGenji Open", imageUrl: string | null = null) {
  const execute = jest.fn(async (sql: string) => {
    if (/SELECT id, name, image_url FROM bg_tournaments/.test(sql)) {
      return [[{ id: 7, name, image_url: imageUrl }]];
    }
    return [{ affectedRows: 1 }];
  }) as unknown as ExecuteMock;
  return { execute, connection: mockConnection(execute) };
}

describe("deleteTournament", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // `clearAllMocks` garde les implémentations : un rejet posé par un test
    // déborderait sur le suivant.
    (deleteStoredImage as jest.Mock).mockResolvedValue(undefined as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it("rend l'identité du tournoi supprimé", async () => {
    const { connection } = mockExistingTournament("Coupe d'Été");

    await expect(deleteTournament(7)).resolves.toEqual({ id: 7, name: "Coupe d'Été" });
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("efface toutes les tables portant un tournament_id", async () => {
    const { execute } = mockExistingTournament();

    await deleteTournament(7);

    const sql = statements(execute).join("\n");
    for (const table of [
      "bg_tournament_phase_teams",
      "bg_swiss_standings",
      "bg_survival_standings",
      "bg_endurance_standings",
      "bg_endurance_penalties",
      "bg_matches",
      "bg_tournament_phases",
      "bg_tournament_registrations",
      "bg_tournaments",
    ]) {
      expect(sql).toContain(`DELETE FROM ${table}`);
    }
  });

  it("ne supprime jamais une équipe, un joueur ou une adhésion", async () => {
    const { execute } = mockExistingTournament();

    await deleteTournament(7);

    // Le cœur de la garantie donnée à l'utilisateur : la purge ne connaît que
    // des tables du tournoi. Toute requête touchant ces tables serait un bug.
    const sql = statements(execute).join("\n");
    expect(sql).not.toMatch(/(DELETE|UPDATE)[^\n]*\bbg_teams\b/);
    expect(sql).not.toMatch(/(DELETE|UPDATE)[^\n]*\bbg_team_members\b/);
    expect(sql).not.toMatch(/(DELETE|UPDATE)[^\n]*\bbg_users\b/);
  });

  it("désarme les liens entre matchs avant de les effacer", async () => {
    const { execute } = mockExistingTournament();

    await deleteTournament(7);

    const sql = statements(execute);
    const unlink = sql.findIndex((s) => /^UPDATE bg_matches SET next_winner_match_id = NULL/.test(s));
    const remove = sql.findIndex((s) => /^DELETE FROM bg_matches/.test(s));
    expect(unlink).toBeGreaterThanOrEqual(0);
    expect(remove).toBeGreaterThan(unlink);
  });

  it("efface les phases après les matchs, et le tournoi en dernier", async () => {
    const { execute } = mockExistingTournament();

    await deleteTournament(7);

    const sql = statements(execute);
    const matches = sql.findIndex((s) => /^DELETE FROM bg_matches/.test(s));
    const phases = sql.findIndex((s) => /^DELETE FROM bg_tournament_phases/.test(s));
    const tournament = sql.findIndex((s) => /^DELETE FROM bg_tournaments/.test(s));
    expect(phases).toBeGreaterThan(matches);
    expect(tournament).toBe(sql.length - 1);
  });

  it("passe l'identifiant du tournoi à chaque requête", async () => {
    const { execute } = mockExistingTournament();

    await deleteTournament(7);

    for (const call of execute.mock.calls) {
      expect((call as [string, unknown[]])[1]).toEqual([7]);
    }
  });

  it("passe par le point de publication commun, qui vide les caches", async () => {
    mockExistingTournament();

    await deleteTournament(7);

    // `publishUpdatedEvent` vide l'instantané, l'aperçu et **les listes** — sans
    // quoi le tournoi supprimé resterait dans `/tournois` jusqu'à cinq minutes —
    // puis réveille la salle du flux, qui ferme les connexions faute
    // d'instantané (`docs/features/REALTIME_REFRESH.md`).
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("remonte TOURNAMENT_NOT_FOUND sans rien effacer", async () => {
    const execute = jest.fn(async () => [[]]) as unknown as ExecuteMock;
    const connection = mockConnection(execute);

    await expect(deleteTournament(999)).rejects.toThrow("TOURNAMENT_NOT_FOUND");

    expect(statements(execute)).toHaveLength(1);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });

  it("annule la transaction et ne publie rien si une requête échoue", async () => {
    const execute = jest.fn(async (sql: string) => {
      if (/SELECT id, name, image_url FROM bg_tournaments/.test(sql)) return [[{ id: 7, name: "Open" }]];
      if (/DELETE FROM bg_matches/.test(sql)) throw new Error("ER_LOCK_DEADLOCK");
      return [{ affectedRows: 1 }];
    }) as unknown as ExecuteMock;
    const connection = mockConnection(execute);

    await expect(deleteTournament(7)).rejects.toThrow("ER_LOCK_DEADLOCK");

    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
    // Publier ici viderait les caches et fermerait les flux d'un tournoi
    // toujours vivant : les lecteurs quitteraient la fiche pour rien.
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
    expect(deleteStoredImage).not.toHaveBeenCalled();
  });

  it("relève l'image sous verrou, avant toute suppression", async () => {
    const { execute } = mockExistingTournament("Open", "/api/uploads/tournaments/7-a.webp");
    await deleteTournament(7);
    // Un envoi concurrent ne peut plus poser un fichier que plus rien ne désignerait.
    expect(statements(execute)[0]).toBe(
      "SELECT id, name, image_url FROM bg_tournaments WHERE id = ? LIMIT 1 FOR UPDATE",
    );
  });

  it("efface le fichier de l'image du tournoi, après le commit", async () => {
    const { connection } = mockExistingTournament("Open", "/api/uploads/tournaments/7-a.webp");
    let committed = false;
    connection.commit.mockImplementation(async () => {
      committed = true;
    });
    (deleteStoredImage as jest.Mock).mockImplementation(async () => {
      // Un `unlink` ne se défait pas : il ne part qu'une fois la ligne effacée.
      expect(committed).toBe(true);
    });

    await deleteTournament(7);
    expect(deleteStoredImage).toHaveBeenCalledWith("/uploads/tournaments/7-a.webp");
  });

  it("un ménage de fichier raté ne fait pas échouer une suppression déjà acquise", async () => {
    mockExistingTournament("Open", "/api/uploads/tournaments/7-a.webp");
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    (deleteStoredImage as jest.Mock).mockRejectedValue(new Error("EPERM") as never);

    await expect(deleteTournament(7)).resolves.toEqual({ id: 7, name: "Open" });
    expect(log).toHaveBeenCalled();
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("n'efface aucun fichier pour un tournoi sans image", async () => {
    mockExistingTournament("Open", null);
    await deleteTournament(7);
    expect(deleteStoredImage).not.toHaveBeenCalledWith(expect.any(String));
  });
});
