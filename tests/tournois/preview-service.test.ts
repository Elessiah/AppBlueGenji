import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments/phases-repository");

import { isPreviewableState, loadTournamentPreview } from "@/lib/server/tournaments/preview";
import { loadPhases } from "@/lib/server/tournaments/phases-repository";
import type { TournamentRow } from "@/lib/server/tournaments/_internal";

type Row = Record<string, unknown>;

const connection = { execute: jest.fn() };

/** Ligne de tournoi minimale : l'aperçu ne lit qu'une poignée de colonnes. */
function tournament(overrides: Row = {}): TournamentRow {
  return {
    id: 7,
    format: "SINGLE",
    state: "REGISTRATION",
    manual_seeding: 0,
    survival_rounds_before_first_cut: null,
    survival_rounds_per_cut: null,
    ...overrides,
  } as unknown as TournamentRow;
}

/** Inscrites renvoyées par la requête d'ordre, dans l'ordre du SQL. */
function entrantRows(names: string[]) {
  return names.map((name, index) => ({ team_id: index + 1, team_name: name }));
}

function settingsRows(overrides: Row = {}) {
  return [{ swiss_total_rounds: null, endurance_playoff_size: null, ...overrides }];
}

/**
 * Répond **par le SQL** et non par l'ordre des appels : le seeding par
 * classement du site rejoue les matchs (`loadEntrantsBySiteRanking`), donc le
 * nombre de requêtes dépend de la source d'ordre — figer une séquence rendrait
 * le test faux à la première lecture ajoutée.
 */
function mockQueries(entrants: Row[], settings: Row[] = settingsRows(), matches: Row[] = []) {
  connection.execute.mockReset();
  connection.execute.mockImplementation((async (sql: unknown) => {
    const text = String(sql);
    if (text.includes("swiss_total_rounds")) return [settings];
    if (text.includes("FROM bg_matches")) return [matches];
    return [entrants];
  }) as never);
}

/** SQL de toutes les requêtes exécutées, espaces normalisés. */
function allSql(): string[] {
  return connection.execute.mock.calls.map((call) =>
    String(call[0]).replace(/\s+/g, " "),
  );
}

/** La requête qui lit les inscrites — celle qui porte l'ordre de seeding. */
function entrantsSql(): string {
  return allSql().find((sql) => sql.includes("bg_tournament_registrations")) ?? "";
}

function run(row: TournamentRow) {
  return loadTournamentPreview(
    connection as unknown as Parameters<typeof loadTournamentPreview>[0],
    row,
  );
}

describe("isPreviewableState", () => {
  it("n'ouvre l'aperçu qu'avant le lancement", () => {
    expect(isPreviewableState("UPCOMING")).toBe(true);
    expect(isPreviewableState("REGISTRATION")).toBe(true);
    expect(isPreviewableState("RUNNING")).toBe(false);
    expect(isPreviewableState("FINISHED")).toBe(false);
  });
});

describe("loadTournamentPreview", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (loadPhases as jest.Mock).mockResolvedValue([] as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it("ne lit rien pour un tournoi lancé", async () => {
    const preview = await run(tournament({ state: "RUNNING" }));

    expect(preview).toBeNull();
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("ne lit rien pour un tournoi terminé", async () => {
    expect(await run(tournament({ state: "FINISHED" }))).toBeNull();
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("ordonne un bracket par la colonne seed et l'annonce comme ordre d'inscription", async () => {
    mockQueries(entrantRows(["Alpha", "Beta", "Gamma"]));

    const preview = await run(tournament({ format: "SINGLE" }));

    expect(preview?.seedingSource).toBe("REGISTRATION");
    expect(entrantsSql()).toContain("ORDER BY COALESCE(r.seed, 1000000), r.registered_at ASC");
    expect(preview?.entrants.map((entrant) => entrant.teamName)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    // Renumérotation continue, quel que soit l'état de la colonne `seed`.
    expect(preview?.entrants.map((entrant) => entrant.seed)).toEqual([1, 2, 3]);
    expect(preview?.bracketSize).toBe(4);
  });

  it("ordonne une ronde suisse par le classement du site", async () => {
    mockQueries(entrantRows(["Alpha", "Beta"]));

    const preview = await run(tournament({ format: "SWISS" }));

    expect(preview?.seedingSource).toBe("RANKING");
    // Le classement est rejoué depuis les matchs comptés, puis appliqué aux
    // inscrites : la requête d'ordre ne trie donc plus rien elle-même.
    expect(allSql().some((sql) => sql.includes("winner_team_id"))).toBe(true);
    expect(entrantsSql()).not.toContain("ORDER BY COALESCE(r.seed");
  });

  it("ordonne une survie par le classement du site", async () => {
    mockQueries(entrantRows(["Alpha", "Beta"]));

    expect((await run(tournament({ format: "SURVIVAL" })))?.seedingSource).toBe("RANKING");
  });

  it("garde l'ordre d'inscription pour la BlueGenji Survie", async () => {
    mockQueries(entrantRows(["Alpha", "Beta"]));

    const preview = await run(tournament({ format: "BG_SURVIE" }));

    expect(preview?.seedingSource).toBe("REGISTRATION");
    expect(entrantsSql()).toContain("ORDER BY COALESCE(r.seed, 1000000), r.registered_at ASC");
  });

  it("fait primer l'ordre saisi à la main sur le classement du site", async () => {
    mockQueries(entrantRows(["Alpha", "Beta"]));

    const preview = await run(tournament({ format: "SURVIVAL", manual_seeding: 1 }));

    expect(preview?.seedingSource).toBe("MANUAL");
    expect(entrantsSql()).toContain("ORDER BY COALESCE(r.seed, 1000000), r.registered_at ASC");
  });

  it("reprend les réglages de format du tournoi", async () => {
    mockQueries(
      entrantRows(["Alpha", "Beta", "Gamma", "Delta"]),
      settingsRows({ swiss_total_rounds: 6 }),
    );

    const preview = await run(tournament({ format: "SWISS" }));

    expect(preview?.rounds).toBe(6);
  });

  it("reprend la cadence des coupes de la survie", async () => {
    mockQueries(entrantRows(["Alpha", "Beta"]));

    const preview = await run(
      tournament({
        format: "SURVIVAL",
        survival_rounds_before_first_cut: 1,
        survival_rounds_per_cut: 2,
      }),
    );

    expect(preview?.notes.join(" ")).toContain("après 1 manche, puis toutes les 2 manches");
  });

  it("reprend l'effectif de play-offs de la BlueGenji Survie", async () => {
    mockQueries(entrantRows(["Alpha", "Beta"]), settingsRows({ endurance_playoff_size: 4 }));

    const preview = await run(tournament({ format: "BG_SURVIE" }));

    expect(preview?.notes.join(" ")).toContain("s'arrête à 4 équipes");
  });

  it("ne charge les phases que pour un tournoi multi-phases", async () => {
    mockQueries(entrantRows(["Alpha", "Beta"]));
    await run(tournament({ format: "SINGLE" }));

    expect(loadPhases).not.toHaveBeenCalled();
  });

  it("prévisualise la première phase d'un multi-phases", async () => {
    mockQueries(entrantRows(["Alpha", "Beta", "Gamma", "Delta"]));
    (loadPhases as jest.Mock).mockResolvedValue([
      {
        position: 1,
        format: "SWISS",
        name: "Qualifs",
        qualifier_mode: "COUNT",
        qualifier_value: 2,
        has_third_place_match: 0,
        swiss_total_rounds: 3,
        survival_rounds_before_first_cut: null,
        survival_rounds_per_cut: null,
      },
      {
        position: 2,
        format: "SINGLE",
        name: null,
        qualifier_mode: "COUNT",
        qualifier_value: 1,
        has_third_place_match: 1,
        swiss_total_rounds: null,
        survival_rounds_before_first_cut: null,
        survival_rounds_per_cut: null,
      },
    ] as never);

    const preview = await run(tournament({ format: "MULTI" }));

    expect(loadPhases).toHaveBeenCalledWith(connection, 7);
    expect(preview?.format).toBe("SWISS");
    expect(preview?.rounds).toBe(3);
    expect(preview?.phasePlan).toHaveLength(2);
    expect(preview?.notes[0]).toBe("Aperçu de la phase 1 — Qualifs.");
  });

  it("rend un aperçu vide mais complet sans aucune inscription", async () => {
    mockQueries([]);

    const preview = await run(tournament({ state: "UPCOMING" }));

    expect(preview?.entrants).toEqual([]);
    expect(preview?.pairings).toEqual([]);
    expect(preview?.notes[0]).toContain("Aucune inscription");
  });
});
