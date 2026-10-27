import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");

import {
  findBroadcastingTournament,
  setMatchLiveConfig,
  setMatchOnAir,
  setTournamentLiveUrl,
} from "@/lib/server/tournaments/live-streams";
import { publishMatchUpdatedEvent, publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { type SqlQuery, type SqlMock, fakeConnection, fakePool } from "../../helpers/sql-double";

async function mockDb(execute: SqlMock) {
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

/** Ligne de match telle que la lit `loadMatchLiveRow`. */
function matchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    tournament_id: 7,
    status: "READY",
    start_at: null,
    live_trigger: null,
    live_started_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("setTournamentLiveUrl", () => {
  it("normalise et enregistre la chaîne officielle", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 7, state: "RUNNING" }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    const result = await setTournamentLiveUrl(7, "twitch.tv/bluegenji");

    expect(result).toBe("https://twitch.tv/bluegenji");
    const [sql, params] = execute.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/UPDATE bg_tournaments SET live_url = \?/);
    expect(params).toEqual(["https://twitch.tv/bluegenji", 7]);
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("traite une chaîne vide comme un effacement", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 7, state: "RUNNING" }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    expect(await setTournamentLiveUrl(7, "   ")).toBeNull();
    expect((execute.mock.calls[1] as [string, unknown[]])[1]).toEqual([null, 7]);
  });

  it("accepte null comme effacement", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 7, state: "RUNNING" }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    expect(await setTournamentLiveUrl(7, null)).toBeNull();
  });

  it("refuse une URL hors liste blanche sans rien écrire", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[{ id: 7, state: "RUNNING" }]]);
    await mockDb(execute);

    await expect(setTournamentLiveUrl(7, "https://exemple.com/live")).rejects.toThrow(
      "INVALID_STREAM_URL",
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });

  it("refuse un tournoi inconnu", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await expect(setTournamentLiveUrl(999, "https://twitch.tv/x")).rejects.toThrow(
      "TOURNAMENT_NOT_FOUND",
    );
  });
});

describe("setMatchLiveConfig", () => {
  /**
   * Base à état pour le réglage d'un match : sa ligne, ses streams et ses
   * casters (`bg_match_streams`, `bg_match_casters`), rejoués écriture après
   * écriture dans la transaction de `setMatchLiveConfig`.
   */
  function liveWorld(
    row: Record<string, unknown>,
    streams: { id: number; live_url: string | null }[] = [],
    casters: { user_id: number; stream_id: number }[] = [],
  ) {
    const state = { streams: streams.map((stream) => ({ ...stream })), casters, matchWrites: [] as [string, unknown[]][] };
    const execute = jest.fn<SqlQuery>(async (rawSql, rawParams) => {
      const sql = rawSql.replace(/\s+/g, " ").trim();
      const params = (rawParams ?? []) as unknown[];
      if (sql.startsWith("SELECT id, tournament_id, status")) return [[row]];
      if (sql.startsWith("SELECT id FROM bg_matches")) return [[{ id: row.id }]];
      if (sql.startsWith("UPDATE bg_matches")) {
        state.matchWrites.push([sql, params]);
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("SELECT id, match_id, live_url FROM bg_match_streams")) {
        return [state.streams.map((stream) => ({ ...stream, match_id: row.id }))];
      }
      if (sql.startsWith("SELECT match_id, user_id, stream_id, ready_at FROM bg_match_casters")) {
        return [state.casters.map((caster) => ({ ...caster, match_id: row.id, ready_at: null }))];
      }
      if (sql === "UPDATE bg_match_streams SET live_url = NULL WHERE match_id = ?") {
        for (const stream of state.streams) stream.live_url = null;
        return [{ affectedRows: state.streams.length }];
      }
      if (sql.startsWith("UPDATE bg_match_streams SET live_url = ? WHERE id = ?")) {
        const stream = state.streams.find((candidate) => candidate.id === params[1]);
        if (stream) stream.live_url = params[0] as string | null;
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("INSERT INTO bg_match_streams")) {
        const id = Math.max(0, ...state.streams.map((stream) => stream.id)) + 1;
        state.streams.push({ id, live_url: params[1] as string | null });
        return [{ affectedRows: 1, insertId: id }];
      }
      if (sql.startsWith("DELETE FROM bg_match_streams")) {
        const ids = params.slice(1);
        state.streams = state.streams.filter((stream) => !ids.includes(stream.id));
        return [{ affectedRows: ids.length }];
      }
      throw new Error(`requête inattendue : ${sql}`);
    });
    const connection = fakeConnection({
      execute,
      beginTransaction: async () => undefined,
      commit: async () => undefined,
      rollback: async () => undefined,
    });
    return { state, execute, connection };
  }

  async function mockLiveDb(world: ReturnType<typeof liveWorld>) {
    const { getDatabase, withConnection } = await import("@/lib/server/database");
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: world.execute }));
    jest.mocked(withConnection).mockImplementation((run) => run(world.connection));
  }

  it("marque un match casté en MANUAL avec sa chaîne : un stream principal est ouvert", async () => {
    const world = liveWorld(matchRow());
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "kick.com/bg" });

    const [sql, params] = world.state.matchWrites[0];
    expect(sql).toBe("UPDATE bg_matches SET live_trigger = ? WHERE id = ?");
    // L'antenne n'est PAS touchée en MANUAL : une reconfiguration en cours de
    // direct ne doit pas couper l'antenne déjà ouverte.
    expect(sql).not.toMatch(/live_started_at/);
    expect(params).toEqual(["MANUAL", 42]);
    expect(world.state.streams).toEqual([{ id: 1, live_url: "https://kick.com/bg" }]);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7, { landingLive: true });
    // Un réglage d'antenne ne touche que le plateau et le direct de l'accueil.
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });

  it("change le lien du stream principal, sans toucher au stream à part d'un caster", async () => {
    const world = liveWorld(
      matchRow({ live_trigger: "MANUAL" }),
      [{ id: 3, live_url: "https://twitch.tv/match" }, { id: 4, live_url: "https://kick.com/voix" }],
      [{ user_id: 9, stream_id: 3 }, { user_id: 12, stream_id: 4 }],
    );
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/neuve" });

    expect(world.state.streams).toEqual([
      { id: 3, live_url: "https://twitch.tv/neuve" },
      { id: 4, live_url: "https://kick.com/voix" },
    ]);
  });

  it("pose le lien sur le stream sans lien d'un caster déjà inscrit, sans en ouvrir un autre", async () => {
    const world = liveWorld(matchRow(), [{ id: 3, live_url: null }], [{ user_id: 9, stream_id: 3 }]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/match" });

    expect(world.state.streams).toEqual([{ id: 3, live_url: "https://twitch.tv/match" }]);
  });

  it("referme l'antenne en passant en AUTO — elle n'y a plus de sens", async () => {
    const world = liveWorld(matchRow({ live_trigger: "MANUAL", live_started_at: new Date() }));
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: null });

    const [sql, params] = world.state.matchWrites[0];
    expect(sql).toMatch(/live_started_at = NULL/);
    expect(params).toEqual(["AUTO", 42]);
  });

  it("referme l'antenne en passant en START_TIME — c'est l'horloge qui décide", async () => {
    const world = liveWorld(
      matchRow({
        start_at: new Date("2026-08-29T18:30:00Z"),
        live_trigger: "MANUAL",
        live_started_at: new Date(),
      }),
    );
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "START_TIME", liveUrl: null });

    const [sql, params] = world.state.matchWrites[0];
    expect(sql).toMatch(/live_started_at = NULL/);
    expect(params).toEqual(["START_TIME", 42]);
  });

  it("laisse démarquer un match sans date — l'impasse doit rester réversible", async () => {
    const world = liveWorld(matchRow({ start_at: null, live_trigger: "START_TIME" }));
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: null, liveUrl: null });

    expect(world.state.matchWrites[0][1]).toEqual([42]);
  });

  it("efface liens et antenne en démarquant le match ; les streams des casters restent, sans lien", async () => {
    const world = liveWorld(
      matchRow({ live_trigger: "MANUAL", live_started_at: new Date() }),
      [{ id: 3, live_url: "https://twitch.tv/match" }, { id: 4, live_url: "https://kick.com/voix" }],
      [{ user_id: 12, stream_id: 4 }],
    );
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: null, liveUrl: "https://twitch.tv/x" });

    const [sql, params] = world.state.matchWrites[0];
    // Sans cet effacement, une remise en MANUAL rouvrirait une antenne fantôme.
    expect(sql).toMatch(/live_trigger = NULL, live_started_at = NULL/);
    expect(params).toEqual([42]);
    // Le stream que personne ne tient part ; celui du caster reste, sans lien.
    expect(world.state.streams).toEqual([{ id: 4, live_url: null }]);
  });

  it("accepte un match casté sans lien — badge seul, aucun stream ouvert", async () => {
    const world = liveWorld(matchRow());
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "" });

    expect(world.state.matchWrites[0][1]).toEqual(["MANUAL", 42]);
    expect(world.state.streams).toEqual([]);
  });

  it("retirer le lien du staff efface le stream principal que personne ne tient", async () => {
    const world = liveWorld(matchRow({ live_trigger: "AUTO" }), [{ id: 3, live_url: "https://twitch.tv/match" }]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: null });

    expect(world.state.streams).toEqual([]);
  });

  it("annule tout sur une panne en cours de transaction", async () => {
    const world = liveWorld(matchRow());
    const rollback = jest.fn(async () => undefined);
    const failing = fakeConnection({
      execute: async (sql: string, params?: unknown) => {
        if (sql.startsWith("UPDATE bg_matches")) throw new Error("base injoignable");
        return world.execute(sql, params);
      },
      beginTransaction: async () => undefined,
      commit: async () => undefined,
      rollback,
    });
    const { getDatabase, withConnection } = await import("@/lib/server/database");
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: world.execute }));
    jest.mocked(withConnection).mockImplementation((run) => run(failing));

    await expect(setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/x" })).rejects.toThrow("base injoignable");
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("refuse START_TIME sur un match sans date de début", async () => {
    // Accepter ce couple poserait une diffusion qui ne s'ouvrirait jamais, et
    // l'échec ne se verrait qu'à l'heure du match.
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[matchRow({ start_at: null })]]);
    await mockDb(execute);

    await expect(setMatchLiveConfig(42, { trigger: "START_TIME", liveUrl: null })).rejects.toThrow(
      "MATCH_START_AT_REQUIRED",
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("refuse une URL hors liste blanche sans rien écrire", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[matchRow()]]);
    await mockDb(execute);

    await expect(
      setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "https://exemple.com/live" }),
    ).rejects.toThrow("INVALID_STREAM_URL");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("refuse un mode inconnu", async () => {
    const execute = jest.fn<SqlQuery>();
    await mockDb(execute);

    await expect(
      setMatchLiveConfig(42, {
        trigger: "SOMETIMES" as never,
        liveUrl: null,
      }),
    ).rejects.toThrow("INVALID_LIVE_TRIGGER");
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuse un match inconnu", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await expect(setMatchLiveConfig(999, { trigger: "AUTO", liveUrl: null })).rejects.toThrow(
      "MATCH_NOT_FOUND",
    );
  });
});

describe("setMatchOnAir", () => {
  it("ouvre l'antenne d'un match MANUAL jouable", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[matchRow({ live_trigger: "MANUAL" })]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    await setMatchOnAir(42, true);

    const [sql, params] = execute.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/UPDATE bg_matches SET live_started_at = \?/);
    expect(params[0]).toBeInstanceOf(Date);
    expect(params[1]).toBe(42);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7, { landingLive: true });
    // Un réglage d'antenne ne touche que le plateau et le direct de l'accueil.
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });

  it("referme l'antenne en reposant NULL", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[matchRow({ live_trigger: "MANUAL", live_started_at: new Date() })]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    await setMatchOnAir(42, false);

    expect((execute.mock.calls[1] as [string, unknown[]])[1]).toEqual([null, 42]);
  });

  it("referme l'antenne même sur un match déjà noté — nettoyage toujours permis", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([
        [matchRow({ live_trigger: "MANUAL", status: "COMPLETED", live_started_at: new Date() })],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    await expect(setMatchOnAir(42, false)).resolves.toBeUndefined();
  });

  it("refuse d'ouvrir l'antenne sur un match en AUTO", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[matchRow({ live_trigger: "AUTO" })]]);
    await mockDb(execute);

    await expect(setMatchOnAir(42, true)).rejects.toThrow("LIVE_TRIGGER_NOT_MANUAL");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("refuse d'ouvrir l'antenne sur un match non casté", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[matchRow()]]);
    await mockDb(execute);

    await expect(setMatchOnAir(42, true)).rejects.toThrow("LIVE_TRIGGER_NOT_MANUAL");
  });

  it("refuse d'ouvrir l'antenne sur un match pas encore jouable ou déjà noté", async () => {
    for (const status of ["PENDING", "AWAITING_CONFIRMATION", "COMPLETED"]) {
      const execute = jest
        .fn<SqlQuery>()
        .mockResolvedValueOnce([[matchRow({ live_trigger: "MANUAL", status })]]);
      await mockDb(execute);

      await expect(setMatchOnAir(42, true)).rejects.toThrow("MATCH_NOT_LIVE_READY");
      expect(execute).toHaveBeenCalledTimes(1);
    }
  });

  it("refuse un match inconnu", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await expect(setMatchOnAir(999, true)).rejects.toThrow("MATCH_NOT_FOUND");
  });
});

describe("findBroadcastingTournament", () => {
  /** Ligne du balayage : un tournoi RUNNING joint à l'un de ses matchs castés. */
  function row(overrides: Record<string, unknown> = {}) {
    return {
      tournament_id: 7,
      live_url: "https://twitch.tv/bluegenji",
      status: "READY",
      start_at: null,
      live_trigger: "AUTO",
      live_started_at: null,
      team1_id: 11,
      team2_id: 12,
      launched_at: new Date(),
      launch_pairing: "11:12",
      ...overrides,
    };
  }

  it("retient le premier tournoi dont un match est réellement à l'antenne", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[row()]]);
    await mockDb(execute);

    expect(await findBroadcastingTournament()).toEqual({
      tournamentId: 7,
      url: "https://twitch.tv/bluegenji",
    });
  });

  it("ignore un match AUTO pas encore lancé (À planifier, Planifié, Lancement)", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[row({ launched_at: null })]]);
    await mockDb(execute);

    expect(await findBroadcastingTournament()).toBeNull();
  });

  it("ignore un lancement posé pour un autre appariement", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[row({ launch_pairing: "11:99" })]]);
    await mockDb(execute);

    expect(await findBroadcastingTournament()).toBeNull();
  });

  it("ignore un match seulement programmé", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[row({ live_trigger: "MANUAL", live_started_at: null })]]);
    await mockDb(execute);

    expect(await findBroadcastingTournament()).toBeNull();
  });

  it("retient un match dont l'heure de début est passée", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([
      [row({ live_trigger: "START_TIME", start_at: new Date(Date.now() - 60_000) })],
    ]);
    await mockDb(execute);

    expect(await findBroadcastingTournament()).toEqual({
      tournamentId: 7,
      url: "https://twitch.tv/bluegenji",
    });
  });

  it("ignore un match dont l'heure de début n'est pas encore atteinte", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([
      [row({ live_trigger: "START_TIME", start_at: new Date(Date.now() + 3_600_000) })],
    ]);
    await mockDb(execute);

    expect(await findBroadcastingTournament()).toBeNull();
  });

  it("ignore un match programmé à l'heure mais sans date", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[row({ live_trigger: "START_TIME", start_at: null })]]);
    await mockDb(execute);

    expect(await findBroadcastingTournament()).toBeNull();
  });

  it("ignore un match dont le score est saisi", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[row({ status: "AWAITING_CONFIRMATION" })]]);
    await mockDb(execute);

    expect(await findBroadcastingTournament()).toBeNull();
  });

  it("saute les tournois hors antenne et retient le premier qui diffuse", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([
      [
        row({ tournament_id: 1, live_trigger: "MANUAL", live_started_at: null }),
        row({ tournament_id: 2, status: "COMPLETED" }),
        row({ tournament_id: 3, live_url: "https://kick.com/bg" }),
      ],
    ]);
    await mockDb(execute);

    expect(await findBroadcastingTournament()).toEqual({
      tournamentId: 3,
      url: "https://kick.com/bg",
    });
  });

  it("revalide le lien à la lecture — une ligne éditée en base ne devient pas un href", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[row({ live_url: "javascript:alert(1)" })]]);
    await mockDb(execute);

    expect(await findBroadcastingTournament()).toBeNull();
  });

  it("ne filtre l'état du direct qu'en mémoire, jamais en SQL", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await findBroadcastingTournament();

    // La requête ne doit pas réimplémenter `resolveMatchLiveState` : une règle
    // dupliquée en SQL divergerait du module pur à la première évolution.
    const [sql] = execute.mock.calls[0] as [string];
    expect(sql).toMatch(/m\.live_trigger IS NOT NULL/);
    expect(sql).not.toMatch(/live_started_at IS NOT NULL/);
    expect(sql).not.toMatch(/'AUTO'/);
  });

  it("renvoie null quand personne ne diffuse", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    expect(await findBroadcastingTournament()).toBeNull();
  });
});
