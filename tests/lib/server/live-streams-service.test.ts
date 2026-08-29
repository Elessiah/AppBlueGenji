import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");

import {
  findBroadcastingTournament,
  setMatchLiveConfig,
  setMatchOnAir,
  setTournamentLiveUrl,
} from "@/lib/server/tournaments/live-streams";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";

async function mockDb(execute: jest.Mock) {
  const { getDatabase } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({ execute });
}

/** Ligne de match telle que la lit `loadMatchLiveRow`. */
function matchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    tournament_id: 7,
    status: "READY",
    live_trigger: null,
    live_started_at: null,
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

describe("setTournamentLiveUrl", () => {
  it("normalise et enregistre la chaîne officielle", async () => {
    const execute = jest
      .fn()
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
      .fn()
      .mockResolvedValueOnce([[{ id: 7, state: "RUNNING" }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    expect(await setTournamentLiveUrl(7, "   ")).toBeNull();
    expect((execute.mock.calls[1] as [string, unknown[]])[1]).toEqual([null, 7]);
  });

  it("accepte null comme effacement", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[{ id: 7, state: "RUNNING" }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    expect(await setTournamentLiveUrl(7, null)).toBeNull();
  });

  it("refuse une URL hors liste blanche sans rien écrire", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[{ id: 7, state: "RUNNING" }]]);
    await mockDb(execute);

    await expect(setTournamentLiveUrl(7, "https://exemple.com/live")).rejects.toThrow(
      "INVALID_STREAM_URL",
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });

  it("refuse un tournoi inconnu", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await expect(setTournamentLiveUrl(999, "https://twitch.tv/x")).rejects.toThrow(
      "TOURNAMENT_NOT_FOUND",
    );
  });
});

describe("setMatchLiveConfig", () => {
  it("marque un match casté en MANUAL avec sa chaîne", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[matchRow()]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "kick.com/bg" });

    const [sql, params] = execute.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/live_trigger = \?, live_url = \?/);
    // L'antenne n'est PAS touchée en MANUAL : une reconfiguration en cours de
    // direct ne doit pas couper l'antenne déjà ouverte.
    expect(sql).not.toMatch(/live_started_at/);
    expect(params).toEqual(["MANUAL", "https://kick.com/bg", 42]);
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("referme l'antenne en passant en AUTO — elle n'y a plus de sens", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[matchRow({ live_trigger: "MANUAL", live_started_at: new Date() })]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: null });

    const [sql, params] = execute.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/live_started_at = NULL/);
    expect(params).toEqual(["AUTO", null, 42]);
  });

  it("efface lien et antenne en démarquant le match", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[matchRow({ live_trigger: "MANUAL", live_started_at: new Date() })]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    await setMatchLiveConfig(42, { trigger: null, liveUrl: "https://twitch.tv/x" });

    const [sql, params] = execute.mock.calls[1] as [string, unknown[]];
    // Sans cet effacement, une remise en MANUAL rouvrirait une antenne fantôme.
    expect(sql).toMatch(/live_trigger = NULL, live_url = NULL, live_started_at = NULL/);
    expect(params).toEqual([42]);
  });

  it("accepte un match casté sans lien — badge seul", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[matchRow()]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "" });

    expect((execute.mock.calls[1] as [string, unknown[]])[1]).toEqual(["MANUAL", null, 42]);
  });

  it("refuse une URL hors liste blanche sans rien écrire", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[matchRow()]]);
    await mockDb(execute);

    await expect(
      setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "https://exemple.com/live" }),
    ).rejects.toThrow("INVALID_STREAM_URL");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("refuse un mode inconnu", async () => {
    const execute = jest.fn();
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
    const execute = jest.fn().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await expect(setMatchLiveConfig(999, { trigger: "AUTO", liveUrl: null })).rejects.toThrow(
      "MATCH_NOT_FOUND",
    );
  });
});

describe("setMatchOnAir", () => {
  it("ouvre l'antenne d'un match MANUAL jouable", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[matchRow({ live_trigger: "MANUAL" })]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    await setMatchOnAir(42, true);

    const [sql, params] = execute.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/UPDATE bg_matches SET live_started_at = \?/);
    expect(params[0]).toBeInstanceOf(Date);
    expect(params[1]).toBe(42);
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("referme l'antenne en reposant NULL", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[matchRow({ live_trigger: "MANUAL", live_started_at: new Date() })]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    await setMatchOnAir(42, false);

    expect((execute.mock.calls[1] as [string, unknown[]])[1]).toEqual([null, 42]);
  });

  it("referme l'antenne même sur un match déjà noté — nettoyage toujours permis", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([
        [matchRow({ live_trigger: "MANUAL", status: "COMPLETED", live_started_at: new Date() })],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    await expect(setMatchOnAir(42, false)).resolves.toBeUndefined();
  });

  it("refuse d'ouvrir l'antenne sur un match en AUTO", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[matchRow({ live_trigger: "AUTO" })]]);
    await mockDb(execute);

    await expect(setMatchOnAir(42, true)).rejects.toThrow("LIVE_TRIGGER_NOT_MANUAL");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("refuse d'ouvrir l'antenne sur un match non casté", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[matchRow()]]);
    await mockDb(execute);

    await expect(setMatchOnAir(42, true)).rejects.toThrow("LIVE_TRIGGER_NOT_MANUAL");
  });

  it("refuse d'ouvrir l'antenne sur un match pas encore jouable ou déjà noté", async () => {
    for (const status of ["PENDING", "AWAITING_CONFIRMATION", "COMPLETED"]) {
      const execute = jest
        .fn()
        .mockResolvedValueOnce([[matchRow({ live_trigger: "MANUAL", status })]]);
      await mockDb(execute);

      await expect(setMatchOnAir(42, true)).rejects.toThrow("MATCH_NOT_LIVE_READY");
      expect(execute).toHaveBeenCalledTimes(1);
    }
  });

  it("refuse un match inconnu", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[]]);
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
      live_trigger: "AUTO",
      live_started_at: null,
      ...overrides,
    };
  }

  it("retient le premier tournoi dont un match est réellement à l'antenne", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[row()]]);
    await mockDb(execute);

    expect(await findBroadcastingTournament()).toEqual({
      tournamentId: 7,
      url: "https://twitch.tv/bluegenji",
    });
  });

  it("ignore un match seulement programmé", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[row({ live_trigger: "MANUAL", live_started_at: null })]]);
    await mockDb(execute);

    expect(await findBroadcastingTournament()).toBeNull();
  });

  it("ignore un match dont le score est saisi", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[row({ status: "AWAITING_CONFIRMATION" })]]);
    await mockDb(execute);

    expect(await findBroadcastingTournament()).toBeNull();
  });

  it("saute les tournois hors antenne et retient le premier qui diffuse", async () => {
    const execute = jest.fn().mockResolvedValueOnce([
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
      .fn()
      .mockResolvedValueOnce([[row({ live_url: "javascript:alert(1)" })]]);
    await mockDb(execute);

    expect(await findBroadcastingTournament()).toBeNull();
  });

  it("ne filtre l'état du direct qu'en mémoire, jamais en SQL", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[]]);
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
    const execute = jest.fn().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    expect(await findBroadcastingTournament()).toBeNull();
  });
});
