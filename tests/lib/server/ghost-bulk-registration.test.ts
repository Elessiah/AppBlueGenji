import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";

jest.mock("@/lib/server/tournaments/bot-logs");
jest.mock("@/lib/server/tournaments/state");

import { registerTeamsByIds } from "@/lib/server/tournaments/registration";
import { queueBotLog } from "@/lib/server/tournaments/bot-logs";
import { syncTournamentState } from "@/lib/server/tournaments/state";
import { registrationErrorTeamId } from "@/lib/shared/ghost-registration";

/**
 * Inscription **en lot** d'équipes fantômes, vue du moteur.
 *
 * Le lot est tout ou rien : ces tests tiennent la promesse par la seule chose
 * que le moteur maîtrise à ce niveau — au premier refus, il **lève**, et rien
 * n'est écrit après. La transaction elle-même est ouverte par
 * `registerGhostTeams` (`tournaments/index.ts`), qui la défait sur l'erreur.
 */

type Row = Record<string, unknown>;

const TOURNAMENT = {
  id: 12,
  state: "REGISTRATION",
  max_teams: 4,
  participant_type: "TEAM",
};

/** Fantôme active, la forme attendue par le contrôle préalable. */
const ghost = (id: number): Row => ({ id, is_ghost: 1, deleted_at: null });

/**
 * Connexion factice. `teams` répond au contrôle préalable, `registered` compte
 * les inscriptions déjà en base — et **grandit à chaque INSERT**, comme le fait
 * la vraie transaction : c'est ce qui permet au plafond de tomber en cours de
 * lot.
 */
function fakeConnection(options: {
  teams: Row[];
  registered?: number;
  alreadyRegistered?: number[];
  tournament?: Row;
}) {
  const inserted: number[] = [];
  let registered = options.registered ?? 0;

  const connection = {
    execute: jest.fn(async (sql: string, params: unknown[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();

      if (q.startsWith("INSERT INTO bg_tournament_registrations")) {
        inserted.push(Number(params[1]));
        registered += 1;
        return [{ affectedRows: 1, insertId: 1 }, []];
      }
      if (q.startsWith("SELECT id FROM bg_tournaments")) return [[{ id: 12 }], []];
      if (q.includes("FROM bg_teams")) return [options.teams, []];
      if (q.includes("COUNT(*)") && q.includes("AND team_id = ?")) {
        return [[{ c: (options.alreadyRegistered ?? []).includes(Number(params[1])) ? 1 : 0 }], []];
      }
      if (q.includes("COUNT(*)")) return [[{ c: registered }], []];
      return [[], []];
    }),
  } as unknown as PoolConnection;

  return { connection, inserted };
}

/** Requêtes lancées sur une connexion factice, normalisées. */
function sqlOf(connection: PoolConnection): string[] {
  return (connection.execute as unknown as jest.Mock).mock.calls.map((call) =>
    String(call[0]).replace(/\s+/g, " ").trim(),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (queueBotLog as jest.Mock).mockReturnValue(true);
  (syncTournamentState as jest.Mock).mockResolvedValue({
    row: TOURNAMENT,
    stateChanged: false,
  } as never);
});

describe("registerTeamsByIds", () => {
  it("inscrit tout le lot, dans l'ordre de la sélection", async () => {
    const { connection, inserted } = fakeConnection({ teams: [ghost(900), ghost(901)] });

    await registerTeamsByIds(connection, 12, [900, 901]);

    expect(inserted).toEqual([900, 901]);
    // Chaque inscription réserve sa ligne de journal, marquée « par le staff ».
    expect((queueBotLog as jest.Mock).mock.calls.map((call) => call[1])).toEqual([
      { kind: "registration", tournamentId: 12, teamId: 900, byStaff: true },
      { kind: "registration", tournamentId: 12, teamId: 901, byStaff: true },
    ]);
  });

  it("attribue des rangs de départ qui se suivent", async () => {
    const inserts: unknown[][] = [];
    const connection = {
      execute: async (sql: string, params: unknown[] = []) => {
        const q = sql.replace(/\s+/g, " ").trim();
        if (q.startsWith("INSERT INTO bg_tournament_registrations")) {
          inserts.push(params);
          return [{ affectedRows: 1 }, []];
        }
        if (q.includes("FROM bg_teams")) return [[ghost(900), ghost(901)], []];
        if (q.includes("COUNT(*)") && q.includes("AND team_id = ?")) return [[{ c: 0 }], []];
        if (q.includes("COUNT(*)")) return [[{ c: inserts.length }], []];
        return [[], []];
      },
    } as unknown as PoolConnection;

    await registerTeamsByIds(connection, 12, [900, 901]);

    expect(inserts).toEqual([
      [12, 900, 1],
      [12, 901, 2],
    ]);
  });

  it("refuse un lot vide sans toucher la base", async () => {
    const { connection, inserted } = fakeConnection({ teams: [] });

    await expect(registerTeamsByIds(connection, 12, [])).rejects.toThrow("EMPTY_TEAM_SELECTION");
    expect(inserted).toEqual([]);
  });

  it("verrouille la ligne du tournoi avant de compter les places", async () => {
    // Sans ce verrou, deux inscriptions simultanées lisent le même effectif et
    // passent toutes les deux : une place de plus que le maximum.
    const { connection } = fakeConnection({ teams: [ghost(900)] });

    await registerTeamsByIds(connection, 12, [900]);

    const queries = sqlOf(connection);
    const lock = queries.findIndex((q) => q.includes("FROM bg_tournaments") && q.includes("FOR UPDATE"));
    const count = queries.findIndex((q) => q.includes("COUNT(*)"));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(count);
  });

  it("s'arrête à la première déjà inscrite, en la nommant", async () => {
    // Course avec une autre inscription : la liste affichée l'excluait, elle
    // est arrivée entre-temps.
    const { connection, inserted } = fakeConnection({
      teams: [ghost(900), ghost(901), ghost(902)],
      alreadyRegistered: [901],
    });

    const error = await registerTeamsByIds(connection, 12, [900, 901, 902]).catch((e) => e);

    expect((error as Error).message).toBe("ALREADY_REGISTERED");
    expect(registrationErrorTeamId(error)).toBe(901);
    // 900 a bien été inséré — c'est le rollback de la transaction appelante qui
    // le défait, pas le moteur.
    expect(inserted).toEqual([900]);
  });

  it("bute sur le plafond d'effectif atteint en cours de lot", async () => {
    // Trois places libres sur quatre, quatre engagés demandés : le compte est
    // relu à chaque insertion, donc le quatrième tombe.
    const { connection, inserted } = fakeConnection({
      teams: [ghost(900), ghost(901), ghost(902), ghost(903)],
      registered: 1,
    });

    await expect(registerTeamsByIds(connection, 12, [900, 901, 902, 903])).rejects.toThrow(
      "TOURNAMENT_FULL",
    );
    expect(inserted).toEqual([900, 901, 902]);
  });

  it("ne nomme aucun engagé sur un refus qui vaut pour le lot entier", async () => {
    // « Complet » ne désigne personne : l'affubler d'un nom laisserait croire
    // que les autres seraient passés.
    const { connection } = fakeConnection({ teams: [ghost(900)], registered: 4 });

    const error = await registerTeamsByIds(connection, 12, [900]).catch((e) => e);

    expect((error as Error).message).toBe("TOURNAMENT_FULL");
    expect(registrationErrorTeamId(error)).toBeUndefined();
  });

  it("refuse tout le lot hors de la fenêtre d'inscription", async () => {
    (syncTournamentState as jest.Mock).mockResolvedValue({
      row: { ...TOURNAMENT, state: "RUNNING" },
      stateChanged: true,
    } as never);
    const { connection, inserted } = fakeConnection({ teams: [ghost(900), ghost(901)] });

    await expect(registerTeamsByIds(connection, 12, [900, 901])).rejects.toThrow(
      "REGISTRATION_CLOSED",
    );
    expect(inserted).toEqual([]);
  });

  it("refuse un tournoi inconnu", async () => {
    (syncTournamentState as jest.Mock).mockResolvedValue({ row: null, stateChanged: false } as never);
    const { connection } = fakeConnection({ teams: [ghost(900)] });

    await expect(registerTeamsByIds(connection, 12, [900])).rejects.toThrow("TOURNAMENT_NOT_FOUND");
  });

  it("refuse une équipe réelle, en la nommant, sans rien inscrire", async () => {
    // La dérogation d'administration ne vaut que pour les fantômes : le staff
    // n'inscrit jamais l'équipe d'un joueur à sa place.
    const { connection, inserted } = fakeConnection({
      teams: [ghost(900), { id: 901, is_ghost: 0, deleted_at: null }],
    });

    const error = await registerTeamsByIds(connection, 12, [900, 901]).catch((e) => e);

    expect((error as Error).message).toBe("NOT_A_GHOST_TEAM");
    expect(registrationErrorTeamId(error)).toBe(901);
    // Le contrôle est **préalable** : rien n'a été inscrit, pas même 900.
    expect(inserted).toEqual([]);
  });

  it("refuse une entrée solo par la même condition qu'une équipe réelle", async () => {
    // Une entrée solo naît avec `is_ghost = 0` : elle n'est pas une fantôme, et
    // c'est un joueur du site qui s'inscrit lui-même.
    const { connection, inserted } = fakeConnection({
      teams: [{ id: 950, is_ghost: 0, deleted_at: null, solo_user_id: 42 }],
    });

    const error = await registerTeamsByIds(connection, 12, [950]).catch((e) => e);

    expect((error as Error).message).toBe("NOT_A_GHOST_TEAM");
    expect(registrationErrorTeamId(error)).toBe(950);
    expect(inserted).toEqual([]);
  });

  it("refuse une fantôme dissoute entre l'affichage et le clic", async () => {
    const { connection, inserted } = fakeConnection({
      teams: [{ id: 900, is_ghost: 1, deleted_at: new Date() }],
    });

    const error = await registerTeamsByIds(connection, 12, [900]).catch((e) => e);

    expect((error as Error).message).toBe("TEAM_ALREADY_DELETED");
    expect(registrationErrorTeamId(error)).toBe(900);
    expect(inserted).toEqual([]);
  });

  it("refuse un identifiant qui ne désigne aucune équipe", async () => {
    const { connection, inserted } = fakeConnection({ teams: [ghost(900)] });

    const error = await registerTeamsByIds(connection, 12, [900, 999]).catch((e) => e);

    expect((error as Error).message).toBe("TEAM_NOT_FOUND");
    expect(registrationErrorTeamId(error)).toBe(999);
    expect(inserted).toEqual([]);
  });

  it("relit le caractère fantôme en une seule requête, quelle que soit la taille du lot", async () => {
    const teamIds = [900, 901, 902, 903];
    const { connection } = fakeConnection({ teams: teamIds.map(ghost) });

    await registerTeamsByIds(connection, 12, teamIds);

    const checks = sqlOf(connection).filter((q) => q.includes("SELECT id, is_ghost, deleted_at"));
    expect(checks).toHaveLength(1);
    expect(checks[0]).toContain("IN (?,?,?,?)");
  });
});
