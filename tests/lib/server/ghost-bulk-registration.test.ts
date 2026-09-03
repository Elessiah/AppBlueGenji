import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";

jest.mock("@/lib/server/tournaments/bot-logs");
jest.mock("@/lib/server/tournaments/state");
jest.mock("@/lib/server/teams-service");

import {
  registerCurrentUserTeam,
  registerTeamsByIds,
} from "@/lib/server/tournaments/registration";
import { MAX_PENDING_PER_TRANSACTION, queueBotLog } from "@/lib/server/tournaments/bot-logs";
import { syncTournamentState } from "@/lib/server/tournaments/state";
import { getUserActiveTeam } from "@/lib/server/teams-service";
import { GHOST_BATCH_MAX, registrationErrorTeamId } from "@/lib/shared/ghost-registration";

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
      // `loadTournamentRow` : la lecture complète du chemin joueur.
      if (q.includes("FROM bg_tournaments")) return [[TOURNAMENT], []];
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

  it("verrouille les équipes relues, dans un ordre fixe", async () => {
    // Lecture verrouillante et non ordinaire : c'est la première lecture de la
    // transaction, donc celle qui fige l'instantané REPEATABLE READ. Sans
    // `FOR UPDATE`, une fantôme attribuée à un joueur juste après resterait
    // « fantôme » aux yeux de la transaction, et s'inscrirait quand même.
    const teamIds = [903, 900];
    const { connection } = fakeConnection({ teams: teamIds.map(ghost) });

    await registerTeamsByIds(connection, 12, teamIds);

    const check = sqlOf(connection).find((q) => q.includes("SELECT id, is_ghost, deleted_at"));
    expect(check).toContain("FOR UPDATE");
    // Ordre de verrouillage constant : deux lots qui se recoupent s'attendent
    // au lieu de s'interbloquer.
    expect(check).toContain("ORDER BY id");
  });

  it("ne dépasse jamais ce que le journal Discord retient par transaction", () => {
    // Un lot est **une** transaction, et `queueBotLog` abandonne au-delà de son
    // plafond : un lot plus large s'écrirait sans les lignes de journal des
    // inscriptions suivantes, silencieusement. Le couple se tient ici, faute de
    // pouvoir importer un module serveur depuis `lib/shared`.
    expect(GHOST_BATCH_MAX).toBeLessThanOrEqual(MAX_PENDING_PER_TRANSACTION);
  });

  it("ne met en file que des inscriptions : le lot ne partage sa transaction avec rien", async () => {
    // C'est ce qui rend l'égalité des deux plafonds suffisante. Les deux autres
    // évènements que la transaction pourrait produire (`tournament_started`,
    // `tournament_underfilled`) supposent que l'état a quitté `REGISTRATION` —
    // auquel cas le lot est refusé et la file jetée.
    const teamIds = [900, 901, 902];
    const { connection } = fakeConnection({ teams: teamIds.map(ghost) });

    await registerTeamsByIds(connection, 12, teamIds);

    const kinds = (queueBotLog as jest.Mock).mock.calls.map((call) => (call[1] as { kind: string }).kind);
    expect(kinds).toEqual(["registration", "registration", "registration"]);
  });

  it("réserve une ligne de journal pour chaque inscription d'un lot plein", async () => {
    const teamIds = Array.from({ length: GHOST_BATCH_MAX }, (_, index) => 900 + index);
    const { connection, inserted } = fakeConnection({ teams: teamIds.map(ghost) });
    (syncTournamentState as jest.Mock).mockResolvedValue({
      row: { ...TOURNAMENT, max_teams: GHOST_BATCH_MAX },
      stateChanged: false,
    } as never);

    await registerTeamsByIds(connection, 12, teamIds);

    expect(inserted).toEqual(teamIds);
    expect((queueBotLog as jest.Mock).mock.calls).toHaveLength(GHOST_BATCH_MAX);
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

/**
 * Le verrou du tournoi doit être la **toute première** instruction de la
 * transaction, et pas seulement précéder le comptage.
 *
 * Sous `REPEATABLE READ`, c'est la première lecture *ordinaire* qui fige
 * l'instantané ; une lecture verrouillante n'en crée pas. Une lecture ordinaire
 * placée avant le verrou — ne serait-ce que pour connaître le type de
 * participant — fige donc le monde *avant* l'attente : la transaction obtient
 * ensuite le verrou, puis compte un effectif périmé, et le plafond saute
 * exactement comme s'il n'y avait pas de verrou.
 */
describe("ordre de verrouillage des points d'entrée", () => {
  const firstStatement = (connection: PoolConnection) => sqlOf(connection)[0];

  it("verrouille avant la moindre lecture, à l'inscription d'un joueur", async () => {
    (getUserActiveTeam as jest.Mock).mockResolvedValue({ teamId: 101 } as never);
    const { connection } = fakeConnection({ teams: [] });

    await registerCurrentUserTeam(connection, 12, 42);

    expect(firstStatement(connection)).toMatch(/FROM bg_tournaments WHERE id = \? FOR UPDATE/);
  });

  it("cherche l'équipe active sur la connexion de la transaction", async () => {
    // Verrou du tournoi en main, emprunter une *seconde* place du pool arme un
    // convoi : le porteur du verrou attend une connexion que les transactions
    // bloquées sur son verrou ne rendront pas avant `innodb_lock_wait_timeout`.
    (getUserActiveTeam as jest.Mock).mockResolvedValue({ teamId: 101 } as never);
    const { connection } = fakeConnection({ teams: [] });

    await registerCurrentUserTeam(connection, 12, 42);

    expect(getUserActiveTeam).toHaveBeenCalledWith(42, connection);
  });

  it("verrouille avant la moindre lecture, à l'inscription d'un lot", async () => {
    const { connection } = fakeConnection({ teams: [ghost(900)] });

    await registerTeamsByIds(connection, 12, [900]);

    // Le tournoi d'abord, les équipes ensuite : même ordre que le chemin joueur
    // (qui ne verrouille, lui, que le tournoi), donc aucun cycle possible.
    expect(firstStatement(connection)).toMatch(/FROM bg_tournaments WHERE id = \? FOR UPDATE/);
    expect(sqlOf(connection)[1]).toContain("SELECT id, is_ghost, deleted_at");
  });
});
