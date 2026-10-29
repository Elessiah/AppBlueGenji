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
  /** Un caster à la seule permission `live`. */
  const CASTER_12 = { userId: 12, asOrganisation: false };
  /** Des membres de l'organisation (permission `tournaments`). */
  const ORGANISER_5 = { userId: 5, asOrganisation: true };
  /** Le même membre, qui dit poser sa propre chaîne (case décochée). */
  const OWN_CHANNEL_5 = { userId: 5, asOrganisation: false };
  const ORGANISER_7 = { userId: 7, asOrganisation: true };

  /**
   * Base à état pour le réglage d'un match : sa ligne, ses streams et ses
   * casters (`bg_match_streams`, `bg_match_casters`), rejoués écriture après
   * écriture dans la transaction de `setMatchLiveConfig`.
   */
  type StreamState = { id: number; live_url: string | null; staff_owned: number; link_user_id?: number };
  /** Un stream de la base ; `staff` : celui du staff (`staff_owned`). */
  const dbStream = (id: number, liveUrl: string | null, staff = false): StreamState => ({
    id,
    live_url: liveUrl,
    staff_owned: staff ? 1 : 0,
  });

  /**
   * Base à état pour le réglage d'un match : sa ligne, ses streams et ses
   * casters (`bg_match_streams`, `bg_match_casters`), rejoués écriture après
   * écriture dans la transaction de `setMatchLiveConfig`.
   */
  function liveWorld(
    row: Record<string, unknown>,
    streams: StreamState[] = [],
    casters: { user_id: number; stream_id: number }[] = [],
  ) {
    const state = { streams: streams.map((stream) => ({ ...stream })), casters, matchWrites: [] as [string, unknown[]][] };
    const execute = jest.fn<SqlQuery>(async (rawSql, rawParams) => {
      const sql = rawSql.replace(/\s+/g, " ").trim();
      const params = (rawParams ?? []) as unknown[];
      if (sql.startsWith("SELECT id, tournament_id, status")) return [[{ ...row }]];
      if (sql.startsWith("UPDATE bg_matches")) {
        state.matchWrites.push([sql, params]);
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("SELECT id, match_id, live_url, staff_owned FROM bg_match_streams")) {
        return [state.streams.map((stream) => ({ ...stream, match_id: row.id }))];
      }
      if (sql.startsWith("SELECT match_id, user_id, stream_id, ready_at FROM bg_match_casters")) {
        return [state.casters.map((caster) => ({ ...caster, match_id: row.id, ready_at: null }))];
      }
      return writeStreams(state, sql, params);
    });
    const connection = fakeConnection({
      execute,
      beginTransaction: async () => undefined,
      commit: async () => undefined,
      rollback: async () => undefined,
    });
    return { state, execute, connection };
  }

  /** Pose lien et fournisseur ; `link_user_id` n'apparaît que s'il désigne un compte. */
  function setStream(stream: StreamState, liveUrl: string | null, providerId: number | null): StreamState {
    stream.live_url = liveUrl;
    if (providerId === null) delete stream.link_user_id;
    else stream.link_user_id = providerId;
    return stream;
  }

  /** Écritures sur `bg_match_streams`, rejouées sur l'état. */
  function writeStreams(state: { streams: StreamState[] }, sql: string, params: unknown[]) {
    if (sql === "UPDATE bg_match_streams SET live_url = NULL, link_user_id = NULL WHERE match_id = ? AND staff_owned = 1") {
      for (const stream of state.streams) if (stream.staff_owned === 1) setStream(stream, null, null);
      return [{ affectedRows: 1 }];
    }
    if (sql === "UPDATE bg_match_streams SET live_url = ?, staff_owned = 1, link_user_id = ? WHERE id = ?") {
      const stream = state.streams.find((candidate) => candidate.id === params[2]);
      if (stream) setStream(Object.assign(stream, { staff_owned: 1 }), params[0] as string | null, params[1] as number | null);
      return [{ affectedRows: 1 }];
    }
    if (sql === "INSERT INTO bg_match_streams (match_id, live_url, staff_owned, link_user_id) VALUES (?, ?, 1, ?)") {
      const id = Math.max(0, ...state.streams.map((stream) => stream.id)) + 1;
      state.streams.push(setStream(dbStream(id, null, true), params[1] as string | null, params[2] as number | null));
      return [{ affectedRows: 1, insertId: id }];
    }
    if (sql.startsWith("DELETE FROM bg_match_streams")) {
      const ids = params.slice(1);
      state.streams = state.streams.filter((stream) => !ids.includes(stream.id));
      return [{ affectedRows: ids.length }];
    }
    throw new Error(`requête inattendue : ${sql}`);
  }

  async function mockLiveDb(world: ReturnType<typeof liveWorld>) {
    const { getDatabase, withConnection } = await import("@/lib/server/database");
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: world.execute }));
    jest.mocked(withConnection).mockImplementation((run) => run(world.connection));
  }

  it("marque un match casté en MANUAL avec sa chaîne : le stream du staff est ouvert", async () => {
    const world = liveWorld(matchRow());
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "kick.com/bg", setter: ORGANISER_5 });

    const [sql, params] = world.state.matchWrites[0];
    expect(sql).toBe("UPDATE bg_matches SET live_trigger = ? WHERE id = ?");
    // L'antenne n'est PAS touchée en MANUAL : une reconfiguration en cours de
    // direct ne doit pas couper l'antenne déjà ouverte.
    expect(sql).not.toMatch(/live_started_at/);
    expect(params).toEqual(["MANUAL", 42]);
    expect(world.state.streams).toEqual([dbStream(1, "https://kick.com/bg", true)]);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7, { landingLive: true });
    // Un réglage d'antenne ne touche que le plateau et le direct de l'accueil.
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });

  it("change le lien du stream du staff, sans toucher au stream à part d'un caster", async () => {
    const world = liveWorld(
      matchRow({ live_trigger: "MANUAL" }),
      [dbStream(3, "https://twitch.tv/match", true), dbStream(4, "https://kick.com/voix")],
      [{ user_id: 9, stream_id: 3 }, { user_id: 12, stream_id: 4 }],
    );
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/neuve", setter: ORGANISER_5 });

    expect(world.state.streams).toEqual([
      dbStream(3, "https://twitch.tv/neuve", true),
      dbStream(4, "https://kick.com/voix"),
    ]);
  });

  it("n'écrase jamais le lien qu'un caster a ouvert, même seul et premier : le staff ouvre le sien", async () => {
    const world = liveWorld(matchRow({ live_trigger: "MANUAL" }), [dbStream(3, "https://kick.com/voix")], [
      { user_id: 12, stream_id: 3 },
    ]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/bluegenji", setter: ORGANISER_5 });

    expect(world.state.streams).toEqual([
      dbStream(3, "https://kick.com/voix"),
      dbStream(4, "https://twitch.tv/bluegenji", true),
    ]);
  });

  it("rattache au caster le lien qu'il pose sans être de l'organisation ; un réglage réenregistré ne le lui prend pas", async () => {
    const world = liveWorld(matchRow());
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/voix", setter: CASTER_12 });
    expect(world.state.streams).toEqual([{ ...dbStream(1, "https://twitch.tv/voix", true), link_user_id: 12 }]);

    // Le même lien, réenregistré par l'organisation (mode changé) : il reste au caster.
    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/voix", setter: ORGANISER_7 });
    expect(world.state.streams).toEqual([{ ...dbStream(1, "https://twitch.tv/voix", true), link_user_id: 12 }]);

    // Un autre lien, posé par l'organisation : c'est le sien.
    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/bluegenji", setter: ORGANISER_7 });
    expect(world.state.streams).toEqual([dbStream(1, "https://twitch.tv/bluegenji", true)]);

    // Et un caster qui le réenregistre tel quel ne le prend pas.
    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/bluegenji", setter: CASTER_12 });
    expect(world.state.streams).toEqual([dbStream(1, "https://twitch.tv/bluegenji", true)]);

    // Démarquer efface lien et fournisseur.
    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/voix", setter: CASTER_12 });
    await setMatchLiveConfig(42, { trigger: null, liveUrl: null, setter: CASTER_12 });
    expect(world.state.streams).toEqual([]);
  });

  it("un membre de l'organisation qui caste le match pose le lien de l'organisation quand il le dit : rien n'est déduit de son inscription", async () => {
    // L'arbitre 5 (permission tournaments) caste le match, sur le stream 3 sans lien.
    const world = liveWorld(matchRow(), [dbStream(3, null)], [{ user_id: 5, stream_id: 3 }]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/bluegenji", setter: ORGANISER_5 });

    expect(world.state.streams).toEqual([dbStream(3, "https://twitch.tv/bluegenji", true)]);
  });

  it("le même membre, case « lien de l'organisation » décochée, pose sa propre chaîne ; réenregistrée par un autre, elle lui reste", async () => {
    const world = liveWorld(matchRow(), [dbStream(3, null)], [{ user_id: 5, stream_id: 3 }]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/arbitre", setter: OWN_CHANNEL_5 });
    expect(world.state.streams).toEqual([{ ...dbStream(3, "https://twitch.tv/arbitre", true), link_user_id: 5 }]);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/arbitre", setter: ORGANISER_7 });
    expect(world.state.streams).toEqual([{ ...dbStream(3, "https://twitch.tv/arbitre", true), link_user_id: 5 }]);
  });

  it("qui quitte le match garde son lien ; son lien posé après son départ, comme lien de l'organisation, reste au match", async () => {
    const world = liveWorld(matchRow(), [dbStream(1, null, true)], []);
    await mockLiveDb(world);

    // Le membre 5 n'est plus (ou n'a jamais été) caster : sa chaîne propre lui reste rattachée.
    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/arbitre", setter: OWN_CHANNEL_5 });
    expect(world.state.streams).toEqual([{ ...dbStream(1, "https://twitch.tv/arbitre", true), link_user_id: 5 }]);
    // Réenregistré tel quel en tant qu'organisation : le lien inchangé garde son fournisseur.
    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/arbitre", setter: ORGANISER_5 });
    expect(world.state.streams).toEqual([{ ...dbStream(1, "https://twitch.tv/arbitre", true), link_user_id: 5 }]);
    // Un lien neuf, dit de l'organisation, n'a aucun fournisseur.
    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/bluegenji", setter: ORGANISER_5 });
    expect(world.state.streams).toEqual([dbStream(1, "https://twitch.tv/bluegenji", true)]);
  });

  it("refuse (MATCH_NOT_CASTABLE) un réglage sur un match terminé ou en attente de confirmation qui n'est pas casté", async () => {
    for (const status of ["COMPLETED", "AWAITING_CONFIRMATION"]) {
      const world = liveWorld(matchRow({ status }));
      await mockLiveDb(world);

      await expect(
        setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/x", setter: CASTER_12 }),
      ).rejects.toThrow("MATCH_NOT_CASTABLE");
      expect(world.state.matchWrites).toEqual([]);
    }
  });

  it("rejuge sous le verrou du match : un score validé entre la première lecture et le verrou ferme la porte", async () => {
    const row = matchRow();
    const world = liveWorld(row);
    await mockLiveDb(world);
    const real = world.execute.getMockImplementation()!;
    let reads = 0;
    world.execute.mockImplementation(async (sql, params) => {
      const result = await real(sql, params);
      reads += 1;
      // Le match est joué dès que la lecture ordinaire a rendu sa ligne.
      if (reads === 1) row.status = "COMPLETED";
      return result;
    });

    await expect(
      setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/x", setter: CASTER_12 }),
    ).rejects.toThrow("MATCH_NOT_CASTABLE");
    expect(world.state.streams).toEqual([]);
    expect(world.state.matchWrites).toEqual([]);
  });

  it("setMatchLiveConfig_startAtClearedBeforeLock_rejectsStartTimeUnderLock", async () => {
    const row = matchRow({ start_at: "2026-11-02 20:00:00" });
    const world = liveWorld(row);
    await mockLiveDb(world);
    const real = world.execute.getMockImplementation()!;
    let reads = 0;
    world.execute.mockImplementation(async (sql, params) => {
      const result = await real(sql, params);
      reads += 1;
      // La date de début est retirée dès que la lecture ordinaire a rendu sa ligne.
      if (reads === 1) row.start_at = null;
      return result;
    });

    await expect(
      setMatchLiveConfig(42, { trigger: "START_TIME", liveUrl: null, setter: ORGANISER_5 }),
    ).rejects.toThrow("MATCH_START_AT_REQUIRED");
    expect(world.state.matchWrites).toEqual([]);
  });

  it("laisse démarquer un match terminé encore casté : une diffusion posée ne devient pas ineffaçable", async () => {
    const world = liveWorld(matchRow({ status: "COMPLETED", live_trigger: "AUTO" }), [dbStream(1, "https://twitch.tv/x", true)]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: null, liveUrl: null, setter: CASTER_12 });

    expect(world.state.streams).toEqual([]);
  });

  it("lit une seule fois chaque table sous verrou par réglage : les streams déjà lus ne sont pas relus par le ménage", async () => {
    const world = liveWorld(matchRow({ live_trigger: "MANUAL" }), [dbStream(3, "https://twitch.tv/match", true)], [
      { user_id: 5, stream_id: 3 },
    ]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/neuve", setter: ORGANISER_5 });

    const reads = (table: string) =>
      world.execute.mock.calls.filter(([sql]) => String(sql).includes(`FROM ${table}`) && String(sql).includes("FOR UPDATE"));
    expect(reads("bg_match_streams")).toHaveLength(1);
    expect(reads("bg_match_casters")).toHaveLength(1);
  });

  it("pose le lien sur le stream sans lien d'un caster déjà inscrit, qui devient celui du staff", async () => {
    const world = liveWorld(matchRow(), [dbStream(3, null)], [{ user_id: 9, stream_id: 3 }]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/match", setter: ORGANISER_5 });

    expect(world.state.streams).toEqual([dbStream(3, "https://twitch.tv/match", true)]);
  });

  it("referme l'antenne en passant en AUTO — elle n'y a plus de sens", async () => {
    const world = liveWorld(matchRow({ live_trigger: "MANUAL", live_started_at: new Date() }));
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: null, setter: ORGANISER_5 });

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

    await setMatchLiveConfig(42, { trigger: "START_TIME", liveUrl: null, setter: ORGANISER_5 });

    const [sql, params] = world.state.matchWrites[0];
    expect(sql).toMatch(/live_started_at = NULL/);
    expect(params).toEqual(["START_TIME", 42]);
  });

  it("laisse démarquer un match sans date — l'impasse doit rester réversible", async () => {
    const world = liveWorld(matchRow({ start_at: null, live_trigger: "START_TIME" }));
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: null, liveUrl: null, setter: ORGANISER_5 });

    expect(world.state.matchWrites[0][1]).toEqual([42]);
  });

  it("démarquer le match efface le lien du staff et l'antenne ; les casters gardent le leur", async () => {
    const world = liveWorld(
      matchRow({ live_trigger: "MANUAL", live_started_at: new Date() }),
      [dbStream(3, "https://twitch.tv/match", true), dbStream(4, "https://kick.com/voix")],
      [{ user_id: 12, stream_id: 4 }],
    );
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: null, liveUrl: "https://twitch.tv/x", setter: ORGANISER_5 });

    const [sql, params] = world.state.matchWrites[0];
    // Sans cet effacement, une remise en MANUAL rouvrirait une antenne fantôme.
    expect(sql).toMatch(/live_trigger = NULL, live_started_at = NULL/);
    expect(params).toEqual([42]);
    // Le stream du staff, sans lien ni caster, part ; celui du caster garde sa
    // chaîne, qu'une remise en diffusion retrouve.
    expect(world.state.streams).toEqual([dbStream(4, "https://kick.com/voix")]);
  });

  it("accepte un match casté sans lien — badge seul, aucun stream ouvert", async () => {
    const world = liveWorld(matchRow());
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "", setter: ORGANISER_5 });

    expect(world.state.matchWrites[0][1]).toEqual(["MANUAL", 42]);
    expect(world.state.streams).toEqual([]);
  });

  it("retirer le lien du staff efface son stream que personne ne tient", async () => {
    const world = liveWorld(matchRow({ live_trigger: "AUTO" }), [dbStream(3, "https://twitch.tv/match", true)]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: null, setter: ORGANISER_5 });

    expect(world.state.streams).toEqual([]);
  });

  it("retirer un lien sans stream du staff ne prend pas le stream d'un caster", async () => {
    const world = liveWorld(matchRow({ live_trigger: "AUTO" }), [dbStream(3, null)], [{ user_id: 9, stream_id: 3 }]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: null, setter: ORGANISER_5 });

    expect(world.state.streams).toEqual([dbStream(3, null)]);
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

    await expect(setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/x", setter: ORGANISER_5 })).rejects.toThrow("base injoignable");
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("refuse START_TIME sur un match sans date de début", async () => {
    // Accepter ce couple poserait une diffusion qui ne s'ouvrirait jamais, et
    // l'échec ne se verrait qu'à l'heure du match.
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[matchRow({ start_at: null })]]);
    await mockDb(execute);

    await expect(setMatchLiveConfig(42, { trigger: "START_TIME", liveUrl: null, setter: ORGANISER_5 })).rejects.toThrow(
      "MATCH_START_AT_REQUIRED",
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("refuse une URL hors liste blanche sans rien écrire", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[matchRow()]]);
    await mockDb(execute);

    await expect(
      setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "https://exemple.com/live", setter: ORGANISER_5 }),
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
        setter: ORGANISER_5,
      }),
    ).rejects.toThrow("INVALID_LIVE_TRIGGER");
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuse un match inconnu", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await expect(setMatchLiveConfig(999, { trigger: "AUTO", liveUrl: null, setter: ORGANISER_5 })).rejects.toThrow(
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
