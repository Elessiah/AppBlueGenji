import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { listTournamentBuckets } from "@/lib/server/tournaments-service";
import { clearCache } from "@/lib/server/cache";
import { type SqlQuery, type SqlMock, fakePool } from "../../helpers/sql-double";
import { tournamentListRow } from "../../helpers/tournament-rows";
import { FINISHED_TOURNAMENTS_LIST_LIMIT } from "@/lib/shared/constants";

jest.mock("@/lib/server/database");

// La liste publique est mutualisée (`lib/server/tournaments/list-cache.ts`) :
// sans cette remise à zéro, le deuxième cas serait servi depuis le cache du
// premier et ne toucherait jamais la base.
beforeEach(() => {
  clearCache();
});
afterEach(() => {
  clearCache();
});

type ExecuteMock = SqlMock;

/**
 * Pose une base factice. La requête de liste passe par le pool (`db.execute`),
 * la remise à niveau des états par une connexion : deux mocks distincts pour
 * pouvoir lire la première sans être noyé dans la seconde.
 */
async function mockDb(execute: ExecuteMock) {
  const { getDatabase } = await import("@/lib/server/database");
  const connectionExecute: ExecuteMock = jest.fn<SqlQuery>().mockResolvedValue([[], undefined]);
  const connection = {
    execute: connectionExecute,
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };
  jest.mocked(getDatabase).mockResolvedValue(fakePool({
    execute,
    getConnection: jest.fn(async () => connection),
  }));
  return connectionExecute;
}

function listQuery(execute: ExecuteMock): [string, unknown[]] {
  const call = execute.mock.calls.find(([sql]) => String(sql).includes("FROM bg_tournaments"));
  if (!call) throw new Error("aucune requête de liste");
  return call as [string, unknown[]];
}

/** Clause WHERE seule : la liste des colonnes sélectionnées n'y participe pas. */
function whereClause(sql: string): string {
  return sql.slice(sql.indexOf("WHERE "), sql.indexOf("GROUP BY"));
}

describe("listTournamentBuckets — portée", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("ne montre par défaut que les tournois déjà visibles", async () => {
    const execute: ExecuteMock = jest.fn<SqlQuery>().mockResolvedValue([[], undefined]);
    await mockDb(execute);

    await listTournamentBuckets(null);

    const [sql, params] = listQuery(execute);
    expect(sql).toMatch(/WHERE t\.start_visibility_at <= \?/);
    // Le second instant borne la sélection des terminés les plus récents, sur
    // la même visibilité.
    expect(params).toHaveLength(2);
    expect(params[0]).toBeInstanceOf(Date);
    expect(params[1]).toBe(params[0]);
  });

  it("prend exactement le complément avec hiddenOnly", async () => {
    const execute: ExecuteMock = jest.fn<SqlQuery>().mockResolvedValue([[], undefined]);
    await mockDb(execute);

    await listTournamentBuckets(null, { hiddenOnly: true });

    const [sql, params] = listQuery(execute);
    expect(sql).toMatch(/WHERE t\.start_visibility_at > \?/);
    // Complément strict : pas de « <= » qui traînerait, sinon un tournoi
    // pourrait manquer aux deux portées ou figurer dans les deux.
    expect(sql).not.toMatch(/start_visibility_at <= \?/);
    expect(params).toHaveLength(1);
    expect(params[0]).toBeInstanceOf(Date);
  });

  it("ne filtre pas par organisateur : le staff voit tous les invisibles", async () => {
    const execute: ExecuteMock = jest.fn<SqlQuery>().mockResolvedValue([[], undefined]);
    await mockDb(execute);

    await listTournamentBuckets(null, { hiddenOnly: true });

    const [sql] = listQuery(execute);
    expect(whereClause(sql)).not.toMatch(/organizer_user_id/);
  });

  it("retombe sur la vue publique quand hiddenOnly est faux", async () => {
    const execute: ExecuteMock = jest.fn<SqlQuery>().mockResolvedValue([[], undefined]);
    await mockDb(execute);

    await listTournamentBuckets(null, { hiddenOnly: false });

    const [sql] = listQuery(execute);
    expect(sql).toMatch(/WHERE t\.start_visibility_at <= \?/);
  });

  it("garde la recherche par nom dans la portée invisible", async () => {
    const execute: ExecuteMock = jest.fn<SqlQuery>().mockResolvedValue([[], undefined]);
    await mockDb(execute);

    await listTournamentBuckets("  Marvel  ", { hiddenOnly: true });

    const [sql, params] = listQuery(execute);
    expect(sql).toMatch(/t\.start_visibility_at > \? AND LOWER\(t\.name\) LIKE \?/);
    expect(params[1]).toBe("%marvel%");
  });

  it("range les tournois invisibles dans le panier de leur état", async () => {
    const row = (id: number, state: string) => ({
      id,
      name: `Tournoi ${id}`,
      description: null,
      format: "SINGLE",
      game: "OW",
      max_teams: 8,
      state,
      start_visibility_at: "2030-01-01T00:00:00Z",
      registration_open_at: "2030-01-02T00:00:00Z",
      registration_close_at: "2030-01-03T00:00:00Z",
      start_at: "2030-01-04T00:00:00Z",
      bracket_size: null,
      created_at: "2026-01-01T00:00:00Z",
      organizer_user_id: 321,
      finished_at: null,
      has_third_place_match: 0,
      survival_rounds_before_first_cut: null,
      survival_rounds_per_cut: null,
      survival_current_round: null,
      participant_type: "TEAM",
      match_format_type: null,
      match_format_value: null,
      registered_teams: 0,
    });

    const execute: ExecuteMock = jest.fn(async (sql: unknown) =>
      String(sql).includes("FROM bg_tournaments")
        ? [[row(1, "UPCOMING"), row(2, "RUNNING")], undefined]
        : [[], undefined],
    );
    await mockDb(execute);

    const buckets = await listTournamentBuckets(null, { hiddenOnly: true });

    // La page remet ces paniers à plat : un tournoi invisible n'est pas
    // forcément « à venir », l'état doit donc rester lisible.
    expect(buckets.upcoming.map((t) => t.id)).toEqual([1]);
    expect(buckets.running.map((t) => t.id)).toEqual([2]);
    expect(buckets.registration).toEqual([]);
    expect(buckets.finished).toEqual([]);
  });
});

/**
 * La liste publique ne porte que les terminés les plus récents : elle chargeait
 * tout l'historique, résumés compris, pour une section qui en montre douze.
 */
describe("listTournamentBuckets — tournois terminés bornés", () => {
  const past = new Date(Date.now() - 86_400_000);
  const finished = (id: number) =>
    tournamentListRow({ id, state: "FINISHED", start_visibility_at: past, game: "OW" });

  /** Liste de `rows`, décompte des terminés `totals` (par jeu). */
  function listing(rows: unknown[], totals: { game: string; total: number | string }[]) {
    return jest.fn<SqlQuery>(async (sql: string) => {
      if (sql.includes("COUNT(r.id)")) return [rows, undefined];
      if (sql.includes("GROUP BY t.game")) return [totals, undefined];
      return [[], undefined];
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("borne les terminés de la liste publique aux plus récents", async () => {
    const execute = listing([], []);
    await mockDb(execute);

    await listTournamentBuckets(null);

    const [sql] = listQuery(execute);
    expect(sql).toContain("t.state <> 'FINISHED' OR t.id IN");
    expect(sql).toContain(`LIMIT ${FINISHED_TOURNAMENTS_LIST_LIMIT}`);
    // Même ordre que la liste : les terminés portés sont ceux qu'elle affiche
    // en premier.
    expect(sql).toContain("ORDER BY f.start_at DESC, f.id DESC");
    expect(sql).toContain("ORDER BY t.start_at DESC, t.id DESC");
  });

  it("dit combien de terminés la liste tronquée laisse de côté, en tout et par jeu", async () => {
    await mockDb(
      listing(
        [finished(1), finished(2)],
        [
          { game: "OW", total: 30 },
          { game: "MR", total: "12" },
        ],
      ),
    );

    const buckets = await listTournamentBuckets(null);

    expect(buckets.finished).toHaveLength(2);
    expect(buckets.finishedTotals).toEqual({ all: 42, byGame: { OW: 30, MR: 12 } });
  });

  it("n'annonce rien quand la liste porte déjà tous les terminés", async () => {
    await mockDb(listing([finished(1), finished(2)], [{ game: "OW", total: 2 }]));

    const buckets = await listTournamentBuckets(null);

    expect(buckets).not.toHaveProperty("finishedTotals");
  });

  // Sans décompte, une liste tronquée passerait pour complète — plus de « Voir
  // plus », et mise en cache ainsi pour tous : on sert la liste entière.
  it("sert la liste entière quand le décompte est en panne", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const execute = jest.fn<SqlQuery>(async (sql: string) => {
      if (sql.includes("COUNT(r.id)")) {
        return [sql.includes("t.id IN") ? [finished(1)] : [finished(1), finished(2)], undefined];
      }
      if (sql.includes("GROUP BY t.game")) throw new Error("table verrouillée");
      return [[], undefined];
    });
    await mockDb(execute);

    const buckets = await listTournamentBuckets(null);

    const lists = execute.mock.calls.filter(([sql]) => String(sql).includes("COUNT(r.id)"));
    expect(lists).toHaveLength(2);
    expect(String(lists[1][0])).not.toContain("t.id IN");
    expect(buckets.finished.map((t) => t.id)).toEqual([1, 2]);
    expect(buckets).not.toHaveProperty("finishedTotals");
    expect(error).toHaveBeenCalled();
  });

  it("sert l'archive entière à qui la demande, sans borne ni décompte", async () => {
    const execute = listing([finished(1)], [{ game: "OW", total: 40 }]);
    await mockDb(execute);

    const buckets = await listTournamentBuckets(null, { allFinished: true });

    const [sql, params] = listQuery(execute);
    expect(sql).not.toContain("t.id IN");
    expect(params).toHaveLength(1);
    expect(execute.mock.calls.some(([text]) => String(text).includes("GROUP BY t.game"))).toBe(false);
    expect(buckets).not.toHaveProperty("finishedTotals");
  });

  it("mutualise l'archive à part de la liste courante", async () => {
    const execute = listing([finished(1)], [{ game: "OW", total: 40 }]);
    await mockDb(execute);

    await listTournamentBuckets(null);
    await listTournamentBuckets(null, { allFinished: true });
    await listTournamentBuckets(null, { allFinished: true });
    await listTournamentBuckets(null);

    // Une lecture par liste, pas une par appel ; et les deux ne se confondent pas.
    expect(execute.mock.calls.filter(([sql]) => String(sql).includes("COUNT(r.id)"))).toHaveLength(2);
  });

  it("ne borne ni une recherche, ni la portée des invisibles", async () => {
    for (const call of [
      () => listTournamentBuckets("coupe"),
      () => listTournamentBuckets(null, { hiddenOnly: true }),
    ]) {
      const execute = listing([], []);
      await mockDb(execute);
      await call();
      const [sql] = listQuery(execute);
      expect(sql).not.toContain("t.id IN");
    }
  });
});
