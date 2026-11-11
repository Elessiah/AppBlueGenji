import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/snapshot");
jest.mock("@/lib/server/tournaments/cast-eligibility", () => ({
  ...jest.requireActual<typeof import("@/lib/server/tournaments/cast-eligibility")>("@/lib/server/tournaments/cast-eligibility"),
  loadRefereeStanding: jest.fn(),
}));

import {
  findBroadcastingTournament,
  isDesignatedMatchReferee,
  setMatchLiveConfig,
  setMatchOnAir,
  setTournamentLiveUrl,
  StreamLinkError,
} from "@/lib/server/tournaments/live-streams";
import { publishMatchUpdatedEvent, publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { invalidateSpectatorSnapshot } from "@/lib/server/tournaments/snapshot";
import { loadRefereeStanding } from "@/lib/server/tournaments/cast-eligibility";
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
    // L'arbitre désigné : celui que la lecture retient, sauf mention contraire.
    referee_user_id: overrides.kept_referee_user_id ?? null,
    ...overrides,
  };
}

/** Un caster du match dans les bases simulées ; `eligible: false` : tu (inéligible). */
type WorldCaster = { user_id: number; stream_id: number; eligible?: boolean };

/** Colonnes d'un compte qui remplit la condition du cast (admin, identités certifiées). */
const ELIGIBLE_CASTER = {
  discord_verified_at: new Date("2026-01-01T00:00:00Z"),
  discord_pseudo: "voix",
  blizzard_sub: "bnet",
  overwatch_battletag: "Voix#1234",
  overwatch_battletag_typed: 0,
  is_deleted: 0,
  is_admin: 1,
  platform_roles_json: null,
};

/** Réponse de `loadShownCasterIds` : les casters demandés, avec leur condition. */
function shownCasterRows(casters: readonly WorldCaster[], ids: readonly unknown[]) {
  return casters
    .filter((caster) => ids.includes(caster.user_id))
    .map((caster) => ({ user_id: caster.user_id, ...ELIGIBLE_CASTER, is_admin: caster.eligible === false ? 0 : 1 }));
}

beforeEach(() => {
  jest.clearAllMocks();
  // Un arbitre retenu remplit, par défaut, la condition d'arbitrage.
  jest.mocked(loadRefereeStanding).mockResolvedValue({ block: null, objection: false });
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

  it("setTournamentLiveUrl_success_evictsSpectatorCopy", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 7, state: "RUNNING" }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    await setTournamentLiveUrl(7, null);

    expect(invalidateSpectatorSnapshot).toHaveBeenCalledTimes(1);
    expect(invalidateSpectatorSnapshot).toHaveBeenCalledWith(7);
  });

  it("setTournamentLiveUrl_invalidUrl_evictsNothing", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[{ id: 7, state: "RUNNING" }]]);
    await mockDb(execute);

    await expect(setTournamentLiveUrl(7, "https://exemple.com/live")).rejects.toThrow("INVALID_STREAM_URL");

    expect(invalidateSpectatorSnapshot).not.toHaveBeenCalled();
  });

  it("setTournamentLiveUrl_unknownTournament_evictsNothing", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await expect(setTournamentLiveUrl(999, "https://twitch.tv/x")).rejects.toThrow("TOURNAMENT_NOT_FOUND");

    expect(invalidateSpectatorSnapshot).not.toHaveBeenCalled();
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
  /** Droits sur le mode d'antenne : la seule permission `live`, ou le staff `tournaments`. */
  const LIVE_ONLY = { oversees: false, manages: false, live: true };
  const STAFF = { oversees: true, manages: true, live: true };
  /** Le staff `tournaments` sans `live` : n'entre que comme arbitre désigné du match. */
  const REFEREE_ONLY = { oversees: false, manages: true, live: false };

  /**
   * Base à état pour le réglage d'un match : sa ligne, ses streams et ses
   * casters (`bg_match_streams`, `bg_match_casters`), rejoués écriture après
   * écriture dans la transaction de `setMatchLiveConfig`.
   */
  type StreamState = { id: number; live_url: string | null; staff_owned: number; link_user_id?: number | null };
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
    casters: WorldCaster[] = [],
  ) {
    const state = { streams: streams.map((stream) => ({ ...stream })), casters, matchWrites: [] as [string, unknown[]][], heldReads: 0, holderReads: 0, casterHolderReads: 0, setterLocks: [] as number[], deletedUsers: [] as number[] };
    const execute = jest.fn<SqlQuery>(async (rawSql, rawParams) => {
      const sql = rawSql.replace(/\s+/g, " ").trim();
      const params = (rawParams ?? []) as unknown[];
      if (sql.startsWith("SELECT id, tournament_id, status")) return [[{ ...row }]];
      // La ligne du compte qui fournit le lien, en lecture partagée (#129).
      if (sql === "SELECT is_deleted FROM bg_users WHERE id = ? LIMIT 1 LOCK IN SHARE MODE") {
        state.setterLocks.push(params[0] as number);
        return [[{ is_deleted: state.deletedUsers.includes(params[0] as number) ? 1 : 0 }]];
      }
      if (sql.startsWith("SELECT t.game,")) return [[{ game: "OW", kept: row.kept_referee_user_id ?? null }]];
      if (sql.startsWith("SELECT mc.user_id, mc.stream_id FROM bg_match_casters mc")) {
        // Tous les casters du match d'une lecture : le fournisseur du lien de son stream d'abord, puis l'ordre d'inscription.
        state.casterHolderReads += 1;
        const isProvider = (caster: WorldCaster) =>
          state.streams.find((stream) => stream.id === caster.stream_id)?.link_user_id === caster.user_id;
        const ordered = [...state.casters.filter(isProvider), ...state.casters.filter((caster) => !isProvider(caster))];
        return [ordered.map((caster) => ({ user_id: caster.user_id, stream_id: caster.stream_id }))];
      }
      if (sql.startsWith("SELECT mc.user_id,")) return [shownCasterRows(state.casters, params.slice(1))];
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
      if (sql.startsWith("SELECT user_id, stream_id FROM bg_match_casters WHERE match_id = ? AND user_id <> ? AND stream_id IS NOT NULL")) {
        state.heldReads += 1;
        // Le filtre SQL : ni l'auteur du réglage, ni une inscription sans stream.
        const others = state.casters.filter((caster) => caster.user_id !== params[1] && caster.stream_id !== null);
        return [others.map((caster) => ({ user_id: caster.user_id, stream_id: caster.stream_id }))];
      }
      if (sql.startsWith("SELECT s.link_user_id,")) {
        state.holderReads += 1;
        const provider = byId(state, params[1])?.link_user_id ?? null;
        const casts = state.casters.some((caster) => caster.stream_id === params[1] && caster.user_id === provider);
        return [[{ link_user_id: provider, holder_casts: casts ? 1 : 0 }]];
      }
      if (sql.startsWith("SELECT 1 FROM bg_match_streams")) {
        // Vrai lien de l'organisation ? Stream du staff à lien, sans auteur
        // (`link_user_id` absent ou nul) — décision du 2026-11-10.
        const orgLinked = state.streams.filter(
          (stream) => stream.live_url !== null && stream.staff_owned === 1 && (stream.link_user_id ?? null) === null,
        );
        return [orgLinked.map(() => ({ 1: 1 }))];
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

  type StreamWrite = (state: { streams: StreamState[] }, params: unknown[]) => void;
  const byId = (state: { streams: StreamState[] }, id: unknown) => state.streams.find((candidate) => candidate.id === id);
  /** Écritures exactes sur `bg_match_streams`, rejouées sur l'état. */
  const STREAM_WRITES: Record<string, StreamWrite> = {
    "UPDATE bg_match_streams SET live_url = NULL, link_user_id = NULL WHERE match_id = ? AND staff_owned = 1": (state) => {
      for (const stream of state.streams) if (stream.staff_owned === 1) setStream(stream, null, null);
    },
    "UPDATE bg_match_streams SET link_user_id = NULL WHERE id = ? AND staff_owned = 1": (state, params) => {
      const stream = byId(state, params[0]);
      if (stream) delete stream.link_user_id;
    },
    "UPDATE bg_match_streams SET live_url = ?, staff_owned = 1, link_user_id = ? WHERE id = ?": (state, params) => {
      const stream = byId(state, params[2]);
      if (stream) setStream(Object.assign(stream, { staff_owned: 1 }), params[0] as string | null, params[1] as number | null);
    },
    "UPDATE bg_match_streams SET live_url = NULL, link_user_id = NULL WHERE id = ? AND match_id = ? AND staff_owned = 0": (state, params) => {
      const stream = byId(state, params[0]);
      if (stream) setStream(stream, null, null);
    },
    "UPDATE bg_match_streams SET live_url = ? WHERE id = ? AND match_id = ? AND staff_owned = 0": (state, params) => {
      const stream = byId(state, params[1]);
      if (stream) stream.live_url = params[0] as string;
    },
    "UPDATE bg_match_streams SET live_url = ?, link_user_id = ? WHERE id = ? AND match_id = ? AND staff_owned = 0": (state, params) => {
      const stream = byId(state, params[2]);
      if (stream) setStream(stream, params[0] as string, params[1] as number | null);
    },
  };

  /** Écritures sur `bg_match_streams`, rejouées sur l'état. */
  function writeStreams(state: { streams: StreamState[] }, sql: string, params: unknown[]) {
    const write = STREAM_WRITES[sql];
    if (write) {
      write(state, params);
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

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "kick.com/bg", setter: ORGANISER_5, access: STAFF });

    const [sql, params] = world.state.matchWrites[0];
    expect(sql).toBe("UPDATE bg_matches SET live_trigger = ?, live_trigger_user_id = ? WHERE id = ?");
    // L'antenne n'est PAS touchée en MANUAL : une reconfiguration en cours de
    // direct ne doit pas couper l'antenne déjà ouverte.
    expect(sql).not.toMatch(/live_started_at/);
    expect(params).toEqual(["MANUAL", null, 42]);
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

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/neuve", setter: ORGANISER_5, access: STAFF });

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

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/bluegenji", setter: ORGANISER_5, access: STAFF });

    expect(world.state.streams).toEqual([
      dbStream(3, "https://kick.com/voix"),
      dbStream(4, "https://twitch.tv/bluegenji", true),
    ]);
  });

  it("rattache au membre le lien de sa chaîne qu'il ne dit pas de l'organisation ; un réglage réenregistré ne le lui prend pas", async () => {
    const row = matchRow();
    const world = liveWorld(row);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/voix", setter: OWN_CHANNEL_5, access: STAFF });
    expect(world.state.streams).toEqual([{ ...dbStream(1, "https://twitch.tv/voix", true), link_user_id: 5 }]);

    // Le même lien, dit de l'organisation par un autre (mode changé) : refusé, il reste au membre.
    await expect(
      setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/voix", setter: ORGANISER_7, access: STAFF }),
    ).rejects.toThrow("ORGANISATION_LINK_NOT_PROVIDER");
    expect(world.state.streams).toEqual([{ ...dbStream(1, "https://twitch.tv/voix", true), link_user_id: 5 }]);
    // Réenregistré case décochée : le mode change, le lien reste au membre.
    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/voix", setter: { userId: 7, asOrganisation: false }, access: STAFF });
    expect(world.state.streams).toEqual([{ ...dbStream(1, "https://twitch.tv/voix", true), link_user_id: 5 }]);

    // Un autre lien, posé par l'organisation : c'est le sien.
    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/bluegenji", setter: ORGANISER_7, access: STAFF });
    expect(world.state.streams).toEqual([dbStream(1, "https://twitch.tv/bluegenji", true)]);

    // Et un membre qui le réenregistre tel quel ne le prend pas.
    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/bluegenji", setter: OWN_CHANNEL_5, access: STAFF });
    expect(world.state.streams).toEqual([dbStream(1, "https://twitch.tv/bluegenji", true)]);

    // Démarquer efface lien et fournisseur (le match porte alors le mode du caster 12).
    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/voix", setter: OWN_CHANNEL_5, access: STAFF });
    Object.assign(row, { live_trigger: "MANUAL", live_trigger_user_id: 12 });
    world.state.casters.push({ user_id: 12, stream_id: 7 });
    await setMatchLiveConfig(42, { trigger: null, liveUrl: null, setter: ORGANISER_7, access: STAFF });
    expect(world.state.streams).toEqual([]);
  });

  it("setMatchLiveConfig_providerMarksUnchangedLinkAsOrganisation_detachesLinkFromAccount", async () => {
    const world = liveWorld(matchRow({ live_trigger: "MANUAL" }), [{ ...dbStream(1, "https://twitch.tv/voix", true), link_user_id: 5 }]);
    await mockLiveDb(world);

    const outcome = await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/voix", setter: ORGANISER_5, access: STAFF });

    expect(world.state.streams).toEqual([dbStream(1, "https://twitch.tv/voix", true)]);
    expect(outcome.changed).toBe(true);
  });

  it("setMatchLiveConfig_otherMemberMarksUnchangedLinkAsOrganisation_throwsAndKeepsProvider", async () => {
    // La case cochée sur le lien d'autrui est refusée, jamais ignorée derrière un succès.
    const world = liveWorld(matchRow({ live_trigger: "MANUAL" }), [{ ...dbStream(1, "https://twitch.tv/voix", true), link_user_id: 5 }]);
    await mockLiveDb(world);

    await expect(
      setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/voix", setter: ORGANISER_7, access: STAFF }),
    ).rejects.toThrow("ORGANISATION_LINK_NOT_PROVIDER");

    expect(world.state.streams).toEqual([{ ...dbStream(1, "https://twitch.tv/voix", true), link_user_id: 5 }]);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("setMatchLiveConfig_memberMarksUnchangedOrganisationLinkAsOrganisation_changesNothing", async () => {
    const world = liveWorld(matchRow({ live_trigger: "MANUAL" }), [dbStream(1, "https://twitch.tv/bluegenji", true)]);
    await mockLiveDb(world);

    const outcome = await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/bluegenji", setter: ORGANISER_7, access: STAFF });

    expect(outcome.changed).toBe(false);
    expect(world.state.streams).toEqual([dbStream(1, "https://twitch.tv/bluegenji", true)]);
  });

  it("setMatchLiveConfig_unchangedOrganisationLinkSavedAsOwnChannel_readsNoProvider", async () => {
    const world = liveWorld(matchRow({ live_trigger: "MANUAL" }), [dbStream(1, "https://twitch.tv/bluegenji", true)]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/bluegenji", setter: OWN_CHANNEL_5, access: STAFF });

    expect(world.state.streams).toEqual([dbStream(1, "https://twitch.tv/bluegenji", true)]);
    expect(world.state.holderReads).toBe(0);
  });

  it("un membre de l'organisation qui caste le match pose le lien de l'organisation quand il le dit : rien n'est déduit de son inscription", async () => {
    // L'arbitre 5 (permission tournaments) caste le match, sur le stream 3 sans lien.
    const world = liveWorld(matchRow(), [dbStream(3, null)], [{ user_id: 5, stream_id: 3 }]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/bluegenji", setter: ORGANISER_5, access: STAFF });

    expect(world.state.streams).toEqual([dbStream(3, "https://twitch.tv/bluegenji", true)]);
  });

  it("le même membre, case « lien de l'organisation » décochée, pose sa propre chaîne ; réenregistrée par un autre, elle lui reste", async () => {
    const world = liveWorld(matchRow(), [dbStream(3, null)], [{ user_id: 5, stream_id: 3 }]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/arbitre", setter: OWN_CHANNEL_5, access: STAFF });
    expect(world.state.streams).toEqual([{ ...dbStream(3, "https://twitch.tv/arbitre", true), link_user_id: 5 }]);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/arbitre", setter: { userId: 7, asOrganisation: false }, access: STAFF });
    expect(world.state.streams).toEqual([{ ...dbStream(3, "https://twitch.tv/arbitre", true), link_user_id: 5 }]);
  });

  it("qui quitte le match garde son lien ; son lien posé après son départ, comme lien de l'organisation, reste au match", async () => {
    const world = liveWorld(matchRow(), [dbStream(1, null, true)], []);
    await mockLiveDb(world);

    // Le membre 5 n'est plus (ou n'a jamais été) caster : sa chaîne propre lui reste rattachée.
    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/arbitre", setter: OWN_CHANNEL_5, access: STAFF });
    expect(world.state.streams).toEqual([{ ...dbStream(1, "https://twitch.tv/arbitre", true), link_user_id: 5 }]);
    // Un lien neuf, dit de l'organisation, n'a aucun fournisseur.
    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/bluegenji", setter: ORGANISER_5, access: STAFF });
    expect(world.state.streams).toEqual([dbStream(1, "https://twitch.tv/bluegenji", true)]);
  });

  it("refuse (MATCH_NOT_CASTABLE) un réglage sur un match terminé ou en attente de confirmation qui n'est pas casté", async () => {
    for (const status of ["COMPLETED", "AWAITING_CONFIRMATION"]) {
      const world = liveWorld(matchRow({ status }));
      await mockLiveDb(world);

      await expect(
        setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/x", setter: ORGANISER_5, access: STAFF }),
      ).rejects.toThrow("MATCH_NOT_CASTABLE");
      expect(world.state.matchWrites).toEqual([]);
    }
  });

  it("setMatchLiveConfig_liveOnlyNonCasterOnPlayedMatch_refusesRoleBeforeState", async () => {
    // Le rôle se juge avant tout refus qui dirait l'état du match (score saisi).
    const world = liveWorld(matchRow({ status: "COMPLETED" }));
    await mockLiveDb(world);

    await expect(
      setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/x", setter: CASTER_12, access: LIVE_ONLY }),
    ).rejects.toThrow("NOT_MATCH_CASTER");
    expect(world.state.matchWrites).toEqual([]);
  });

  it("setMatchLiveConfig_liveOnlyNonCasterStartTimeWithoutDate_refusesRoleBeforeState", async () => {
    const world = liveWorld(matchRow({ start_at: null }));
    await mockLiveDb(world);

    await expect(
      setMatchLiveConfig(42, { trigger: "START_TIME", liveUrl: "twitch.tv/x", setter: CASTER_12, access: LIVE_ONLY }),
    ).rejects.toThrow("NOT_MATCH_CASTER");
    expect(world.state.matchWrites).toEqual([]);
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
      setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/x", setter: ORGANISER_5, access: STAFF }),
    ).rejects.toThrow("MATCH_NOT_CASTABLE");
    expect(world.state.streams).toEqual([]);
    expect(world.state.matchWrites).toEqual([]);
  });

  it("setMatchLiveConfig_playedMatchAlreadyMarked_refusesNewLinkOrMode", async () => {
    const world = liveWorld(matchRow({ status: "COMPLETED", live_trigger: "AUTO", live_trigger_user_id: 12 }), [dbStream(1, "https://twitch.tv/x", true)]);
    await mockLiveDb(world);

    await expect(
      setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/me", setter: ORGANISER_5, access: STAFF }),
    ).rejects.toThrow("MATCH_NOT_CASTABLE");
    expect(world.state.matchWrites).toEqual([]);
    expect(world.state.streams[0]?.live_url).toBe("https://twitch.tv/x");
  });

  it("setMatchLiveConfig_playedMarkedMatchCasterLinksOnly_refereeCorrectsLink", async () => {
    // Match joué resté marqué : la fenêtre n'envoie que les liens des casters (mode et lien du staff absents).
    const world = liveWorld(
      matchRow({ status: "COMPLETED", live_trigger: "AUTO", live_trigger_user_id: 12, kept_referee_user_id: 9 }),
      [dbStream(4, "https://kick.com/voix")],
      [{ user_id: 12, stream_id: 4 }],
    );
    await mockLiveDb(world);

    await setMatchLiveConfig(42, {
      trigger: undefined,
      liveUrl: undefined,
      setter: { userId: 9, asOrganisation: false },
      access: STAFF,
      streamLinks: [{ streamId: 4, liveUrl: "twitch.tv/neuve" }],
    });

    expect(world.state.streams).toEqual([{ ...dbStream(4, "https://twitch.tv/neuve"), link_user_id: 12 }]);
    expect(world.state.matchWrites).toEqual([]);
  });

  it("setMatchLiveConfig_playedMarkedMatchEmptyBody_throwsMatchNotCastable", async () => {
    // Un corps qui ne change rien (ni mode, ni lien du staff, ni lien de caster) n'ouvre pas un match joué.
    const world = liveWorld(
      matchRow({ status: "COMPLETED", live_trigger: "AUTO", live_trigger_user_id: 12 }),
      [dbStream(1, "https://twitch.tv/x", true), dbStream(4, null)],
      [{ user_id: 12, stream_id: 1 }],
    );
    await mockLiveDb(world);

    await expect(
      setMatchLiveConfig(42, { trigger: undefined, liveUrl: undefined, setter: CASTER_12, access: LIVE_ONLY }),
    ).rejects.toThrow("MATCH_NOT_CASTABLE");
    expect(world.state.streams).toHaveLength(2);
    expect(world.state.matchWrites).toEqual([]);
  });

  it("setMatchLiveConfig_playedMarkedMatchEmptyStreamLinks_throwsMatchNotCastable", async () => {
    const world = liveWorld(
      matchRow({ status: "AWAITING_CONFIRMATION", live_trigger: "AUTO", live_trigger_user_id: 12 }),
      [dbStream(1, "https://twitch.tv/x", true), dbStream(4, null)],
    );
    await mockLiveDb(world);

    await expect(
      setMatchLiveConfig(42, { trigger: undefined, liveUrl: undefined, setter: ORGANISER_5, access: STAFF, streamLinks: [] }),
    ).rejects.toThrow("MATCH_NOT_CASTABLE");
    expect(world.state.streams).toHaveLength(2);
  });

  it("setMatchLiveConfig_playedUnmarkedMatchCasterLinksOnly_throwsMatchNotCastable", async () => {
    const world = liveWorld(matchRow({ status: "COMPLETED", kept_referee_user_id: 9 }), [dbStream(4, "https://kick.com/voix")], [
      { user_id: 12, stream_id: 4 },
    ]);
    await mockLiveDb(world);

    await expect(
      setMatchLiveConfig(42, {
        trigger: undefined,
        liveUrl: undefined,
        setter: { userId: 9, asOrganisation: false },
        access: STAFF,
        streamLinks: [{ streamId: 4, liveUrl: "twitch.tv/neuve" }],
      }),
    ).rejects.toThrow("MATCH_NOT_CASTABLE");
    expect(world.state.streams[0]?.live_url).toBe("https://kick.com/voix");
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
      setMatchLiveConfig(42, { trigger: "START_TIME", liveUrl: null, setter: ORGANISER_5, access: STAFF }),
    ).rejects.toThrow("MATCH_START_AT_REQUIRED");
    expect(world.state.matchWrites).toEqual([]);
  });

  it("laisse démarquer un match terminé encore casté : une diffusion posée ne devient pas ineffaçable", async () => {
    const world = liveWorld(matchRow({ status: "COMPLETED", live_trigger: "AUTO", live_trigger_user_id: 12 }), [dbStream(1, "https://twitch.tv/x", true)], [
      { user_id: 12, stream_id: 7 },
    ]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: null, liveUrl: null, setter: ORGANISER_7, access: STAFF });

    expect(world.state.streams).toEqual([]);
  });

  it("setMatchLiveConfig_liveOnlyShownChangesStaffModeWithLink_throwsStaffStreamForbidden", async () => {
    // Sans quoi, devenu maître en le changeant, il démarquerait ensuite le mode du staff.
    const world = liveWorld(matchRow({ live_trigger: "AUTO", live_trigger_user_id: null }), [dbStream(1, "https://twitch.tv/x", true)], [
      { user_id: 12, stream_id: 7 },
    ]);
    await mockLiveDb(world);

    await expect(
      setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: undefined, setter: CASTER_12, access: LIVE_ONLY }),
    ).rejects.toThrow("STAFF_STREAM_FORBIDDEN");
    expect(world.state.matchWrites).toEqual([]);
  });

  it("setMatchLiveConfig_liveOnlyTakesOrphanModeWithLegacyCasterOrgLink_writesMode", async () => {
    // Décision du 2026-11-10 : un ancien lien de caster dit « de l'organisation » ne ferme pas le mode.
    const world = liveWorld(
      matchRow({ live_trigger: "MANUAL", live_trigger_user_id: null }),
      [{ ...dbStream(7, "https://twitch.tv/orga"), link_user_id: null }],
      [{ user_id: 12, stream_id: 7 }],
    );
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: undefined, setter: CASTER_12, access: LIVE_ONLY });

    expect(world.state.matchWrites).toEqual([[expect.stringContaining("SET live_trigger = ?"), ["AUTO", 12, 42]]]);
  });

  it("setMatchLiveConfig_liveOnlyChangesModeWithStaffMemberOwnChannel_writesMode", async () => {
    // Décision du 2026-11-10 : la chaîne qu'un membre du staff a posée comme la sienne ne ferme pas le mode.
    const world = liveWorld(
      matchRow({ live_trigger: "MANUAL", live_trigger_user_id: null }),
      [{ ...dbStream(6, "https://twitch.tv/staff5", true), link_user_id: 5 }, dbStream(7, "https://twitch.tv/voix")],
      [{ user_id: 12, stream_id: 7 }],
    );
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: undefined, setter: CASTER_12, access: LIVE_ONLY });

    expect(world.state.matchWrites).toEqual([[expect.stringContaining("SET live_trigger = ?"), ["AUTO", 12, 42]]]);
  });

  it("setMatchLiveConfig_liveOnlySetsFirstModeWithOrganisationLink_writesMode", async () => {
    // Avant tout mode, le lien de l'organisation ne ferme rien : le premier mode posé par un caster est le sien.
    const world = liveWorld(
      matchRow({ live_trigger: null, live_trigger_user_id: null }),
      [dbStream(6, "https://twitch.tv/orga", true), dbStream(7, "https://twitch.tv/voix")],
      [{ user_id: 12, stream_id: 7 }],
    );
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: undefined, setter: CASTER_12, access: LIVE_ONLY });

    expect(world.state.matchWrites).toEqual([[expect.stringContaining("SET live_trigger = ?"), ["AUTO", 12, 42]]]);
  });

  it("setMatchLiveConfig_liveOnlyOwnerUnmarks_keepsOrganisationLink", async () => {
    // Décision 1 du 2026-11-09 : la seule `live` démarque son mode, jamais le lien de l'organisation.
    const world = liveWorld(matchRow({ status: "COMPLETED", live_trigger: "AUTO", live_trigger_user_id: 12 }), [dbStream(1, "https://twitch.tv/x", true)], [
      { user_id: 12, stream_id: 7 },
    ]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: null, liveUrl: null, setter: CASTER_12, access: LIVE_ONLY });

    expect(world.state.streams).toEqual([dbStream(1, "https://twitch.tv/x", true)]);
    expect(world.state.matchWrites.some(([sql]) => sql.includes("SET live_trigger = NULL"))).toBe(true);
  });

  it("setMatchLiveConfig_matchRowLockHeld_readsStreamsAndCastersOnceWithoutRangeLock", async () => {
    // La ligne du match est verrouillée en première instruction : les streams et casters
    // se lisent sans `FOR UPDATE` (un verrou d'intervalle vide serait partagé avec les matchs voisins).
    const world = liveWorld(matchRow({ live_trigger: "MANUAL" }), [dbStream(3, "https://twitch.tv/match", true)], [
      { user_id: 5, stream_id: 3 },
    ]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/neuve", setter: ORGANISER_5, access: STAFF });

    const reads = (table: string, locking: boolean) =>
      world.execute.mock.calls.filter(
        ([sql]) => String(sql).includes(`FROM ${table}`) && String(sql).includes("FOR UPDATE") === locking,
      );
    expect(reads("bg_match_streams", true)).toHaveLength(0);
    expect(reads("bg_match_casters", true)).toHaveLength(0);
    expect(reads("bg_match_streams", false)).toHaveLength(1);
    expect(reads("bg_match_casters", false).filter(([sql]) => String(sql).includes("ORDER BY created_at, user_id"))).toHaveLength(1);
    const order = world.execute.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, " "));
    const lockAt = order.findIndex((sql) => sql.includes("FROM bg_matches WHERE id = ? FOR UPDATE"));
    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(order.findIndex((sql) => sql.includes("FROM bg_match_streams"))).toBeGreaterThan(lockAt);
  });

  it("setMatchLiveConfig_severalCasterLinksEdited_readsHoldersOnce", async () => {
    const world = liveWorld(
      matchRow({ kept_referee_user_id: 9 }),
      [dbStream(3, "https://twitch.tv/a"), dbStream(5, "https://twitch.tv/b"), dbStream(6, null)],
      [
        { user_id: 12, stream_id: 3 },
        { user_id: 13, stream_id: 5 },
        { user_id: 14, stream_id: 6 },
      ],
    );
    await mockLiveDb(world);

    await setMatchLiveConfig(42, {
      trigger: undefined,
      liveUrl: undefined,
      setter: { userId: 9, asOrganisation: false },
      access: STAFF,
      streamLinks: [
        { streamId: 3, liveUrl: "twitch.tv/a2" },
        { streamId: 5, liveUrl: "twitch.tv/b2" },
        { streamId: 6, liveUrl: "twitch.tv/c2" },
      ],
    });

    expect(world.state.casterHolderReads).toBe(1);
    expect(world.state.streams.map((stream) => [stream.id, stream.link_user_id])).toEqual([
      [3, 12],
      [5, 13],
      [6, 14],
    ]);
  });

  it("setMatchLiveConfig_emptyStreamHeldByCaster_opensStaffStreamInstead", async () => {
    const world = liveWorld(matchRow(), [dbStream(3, null)], [{ user_id: 9, stream_id: 3 }]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/match", setter: ORGANISER_5, access: STAFF });

    // Le stream vidé reste à son caster ; le staff ouvre le sien.
    expect(world.state.streams).toEqual([dbStream(3, null), dbStream(4, "https://twitch.tv/match", true)]);
  });

  it("setMatchLiveConfig_firstEmptyStreamHeldSecondFree_dressesSecondInsteadOfOpening", async () => {
    const world = liveWorld(matchRow(), [dbStream(3, null), dbStream(5, null)], [{ user_id: 9, stream_id: 3 }]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/match", setter: ORGANISER_5, access: STAFF });

    expect(world.state.streams).toEqual([dbStream(3, null), dbStream(5, "https://twitch.tv/match", true)]);
  });

  it("setMatchLiveConfig_severalEmptyStreamsHeld_readsHoldersOnce", async () => {
    const world = liveWorld(
      matchRow(),
      [dbStream(3, null), dbStream(5, null), dbStream(6, null)],
      [{ user_id: 9, stream_id: 3 }, { user_id: 10, stream_id: 5 }],
    );
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/match", setter: ORGANISER_5, access: STAFF });

    // Une seule lecture des casters qui tiennent un stream, quel que soit le nombre de streams vides.
    expect(world.state.heldReads).toBe(1);
    expect(world.state.streams[2]).toEqual(dbStream(6, "https://twitch.tv/match", true));
  });

  it("setMatchLiveConfig_noEmptyStream_opensStaffStreamWithoutReadingHolders", async () => {
    const world = liveWorld(matchRow(), [dbStream(3, "https://twitch.tv/caster")], [{ user_id: 9, stream_id: 3 }]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/match", setter: ORGANISER_5, access: STAFF });

    expect(world.state.heldReads).toBe(0);
    expect(world.state.streams).toEqual([dbStream(3, "https://twitch.tv/caster"), dbStream(4, "https://twitch.tv/match", true)]);
  });

  it("setMatchLiveConfig_emptyStreamHeldOnlyBySetter_dressesIt", async () => {
    const world = liveWorld(matchRow(), [dbStream(3, null)], [{ user_id: 5, stream_id: 3 }]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/match", setter: ORGANISER_5, access: STAFF });

    expect(world.state.streams).toEqual([dbStream(3, "https://twitch.tv/match", true)]);
  });

  it("setMatchLiveConfig_emptyStreamHeldByNobody_becomesStaffStream", async () => {
    const world = liveWorld(matchRow(), [dbStream(3, null)]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/match", setter: ORGANISER_5, access: STAFF });

    expect(world.state.streams).toEqual([dbStream(3, "https://twitch.tv/match", true)]);
  });

  it("setMatchLiveConfig_linkWithoutTriggerOnUnmarkedMatch_throwsMatchNotStreamed", async () => {
    const world = liveWorld(matchRow({ live_trigger: null }));
    await mockLiveDb(world);

    await expect(
      setMatchLiveConfig(42, { trigger: undefined, liveUrl: "twitch.tv/orga", setter: ORGANISER_5, access: STAFF }),
    ).rejects.toThrow("MATCH_NOT_STREAMED");
    expect(world.state.streams).toEqual([]);
  });

  it("setMatchLiveConfig_clearedLinkWithoutTriggerOnUnmarkedMatch_passes", async () => {
    const world = liveWorld(matchRow({ live_trigger: null }));
    await mockLiveDb(world);

    await expect(
      setMatchLiveConfig(42, { trigger: undefined, liveUrl: null, setter: ORGANISER_5, access: STAFF }),
    ).resolves.toBeDefined();
    expect(world.state.streams).toEqual([]);
  });

  it("referme l'antenne en passant en AUTO — elle n'y a plus de sens", async () => {
    const world = liveWorld(matchRow({ live_trigger: "MANUAL", live_started_at: new Date() }));
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: null, setter: ORGANISER_5, access: STAFF });

    const [sql, params] = world.state.matchWrites[0];
    expect(sql).toMatch(/live_started_at = NULL/);
    expect(params).toEqual(["AUTO", null, 42]);
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

    await setMatchLiveConfig(42, { trigger: "START_TIME", liveUrl: null, setter: ORGANISER_5, access: STAFF });

    const [sql, params] = world.state.matchWrites[0];
    expect(sql).toMatch(/live_started_at = NULL/);
    expect(params).toEqual(["START_TIME", null, 42]);
  });

  it("laisse démarquer un match sans date — l'impasse doit rester réversible", async () => {
    const world = liveWorld(matchRow({ start_at: null, live_trigger: "START_TIME" }));
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: null, liveUrl: null, setter: ORGANISER_5, access: STAFF });

    expect(world.state.matchWrites[0][1]).toEqual([42]);
  });

  it("démarquer le match efface le lien du staff et l'antenne ; les casters gardent le leur", async () => {
    const world = liveWorld(
      matchRow({ live_trigger: "MANUAL", live_started_at: new Date() }),
      [dbStream(3, "https://twitch.tv/match", true), dbStream(4, "https://kick.com/voix")],
      [{ user_id: 12, stream_id: 4 }],
    );
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: null, liveUrl: "https://twitch.tv/x", setter: ORGANISER_5, access: STAFF });

    const [sql, params] = world.state.matchWrites[0];
    // Sans cet effacement, une remise en MANUAL rouvrirait une antenne fantôme.
    expect(sql).toMatch(/live_trigger = NULL, live_trigger_user_id = NULL, live_started_at = NULL/);
    expect(params).toEqual([42]);
    // Le stream du staff, sans lien ni caster, part ; celui du caster garde sa
    // chaîne, qu'une remise en diffusion retrouve.
    expect(world.state.streams).toEqual([dbStream(4, "https://kick.com/voix")]);
  });

  it("accepte un match casté sans lien — badge seul, aucun stream ouvert", async () => {
    const world = liveWorld(matchRow());
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "", setter: ORGANISER_5, access: STAFF });

    expect(world.state.matchWrites[0][1]).toEqual(["MANUAL", null, 42]);
    expect(world.state.streams).toEqual([]);
  });

  it("retirer le lien du staff efface son stream que personne ne tient", async () => {
    const world = liveWorld(matchRow({ live_trigger: "AUTO" }), [dbStream(3, "https://twitch.tv/match", true)]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: null, setter: ORGANISER_5, access: STAFF });

    expect(world.state.streams).toEqual([]);
  });

  it("retirer un lien sans stream du staff ne prend pas le stream d'un caster", async () => {
    const world = liveWorld(matchRow({ live_trigger: "AUTO" }), [dbStream(3, null)], [{ user_id: 9, stream_id: 3 }]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: null, setter: ORGANISER_5, access: STAFF });

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

    await expect(setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/x", setter: ORGANISER_5, access: STAFF })).rejects.toThrow("base injoignable");
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("refuse START_TIME sur un match sans date de début", async () => {
    // Accepter ce couple poserait une diffusion qui ne s'ouvrirait jamais, et
    // l'échec ne se verrait qu'à l'heure du match.
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[matchRow({ start_at: null })]]);
    await mockDb(execute);

    await expect(setMatchLiveConfig(42, { trigger: "START_TIME", liveUrl: null, setter: ORGANISER_5, access: STAFF })).rejects.toThrow(
      "MATCH_START_AT_REQUIRED",
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("setMatchLiveConfig_unchangedStartTimeWithoutDate_savesStaffLink", async () => {
    // Mode d'un caster renvoyé tel quel (verrouillé) après que le staff a retiré la date.
    const world = liveWorld(matchRow({ live_trigger: "START_TIME", live_trigger_user_id: 12, start_at: null }));
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "START_TIME", liveUrl: "twitch.tv/orga", setter: ORGANISER_5, access: STAFF });

    expect(world.state.matchWrites).toEqual([]);
    expect(world.state.streams).toEqual([dbStream(1, "https://twitch.tv/orga", true)]);
  });

  it("refuse une URL hors liste blanche sans rien écrire", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[matchRow()]]);
    await mockDb(execute);

    await expect(
      setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "https://exemple.com/live", setter: ORGANISER_5, access: STAFF }),
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
        access: STAFF,
      }),
    ).rejects.toThrow("INVALID_LIVE_TRIGGER");
    expect(execute).not.toHaveBeenCalled();
  });

  it("setMatchLiveConfig_coCasterChangesOwnersTrigger_refusedWithoutWrite", async () => {
    const world = liveWorld(matchRow({ live_trigger: "MANUAL", live_trigger_user_id: 12 }), [dbStream(4, "https://kick.com/voix")], [
      { user_id: 12, stream_id: 4 },
      { user_id: 13, stream_id: 4 },
    ]);
    await mockLiveDb(world);

    await expect(
      setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: null, setter: { userId: 13, asOrganisation: false }, access: LIVE_ONLY }),
    ).rejects.toThrow("LIVE_TRIGGER_NOT_OWNED");
    expect(world.state.matchWrites).toEqual([]);
  });

  it("setMatchLiveConfig_otherMatchRefereeEditsStreamLinks_refused", async () => {
    // Arbitre (staff) d'un autre match : l'arbitre retenu de celui-ci est 9.
    const world = liveWorld(matchRow({ live_trigger: "MANUAL", live_trigger_user_id: 12, kept_referee_user_id: 9 }), [
      dbStream(4, "https://kick.com/voix"),
    ]);
    await mockLiveDb(world);

    await expect(
      setMatchLiveConfig(42, {
        trigger: "MANUAL",
        liveUrl: null,
        setter: OWN_CHANNEL_5,
        access: STAFF,
        streamLinks: [{ streamId: 4, liveUrl: "twitch.tv/autre" }],
      }),
    ).rejects.toThrow("NOT_MATCH_REFEREE");
    expect(world.state.streams).toEqual([dbStream(4, "https://kick.com/voix")]);
  });

  it("setMatchLiveConfig_ownRefereeEditsStreamLinks_rebindsLinkToStreamHolder", async () => {
    // Lien posé au nom de l'organisation : celui que l'arbitre corrige revient au caster qui tient le stream.
    const world = liveWorld(
      matchRow({ live_trigger: "MANUAL", live_trigger_user_id: 12, kept_referee_user_id: 9 }),
      [dbStream(4, "https://kick.com/voix")],
      [{ user_id: 12, stream_id: 4 }],
    );
    await mockLiveDb(world);

    await setMatchLiveConfig(42, {
      trigger: "MANUAL",
      liveUrl: null,
      setter: { userId: 9, asOrganisation: false },
      access: STAFF,
      streamLinks: [{ streamId: 4, liveUrl: "twitch.tv/neuve" }],
    });

    expect(world.state.streams).toEqual([{ ...dbStream(4, "https://twitch.tv/neuve"), link_user_id: 12 }]);
  });

  it("setMatchLiveConfig_ownLinkSet_locksSetterRowBeforeMatch", async () => {
    const world = liveWorld(matchRow({ kept_referee_user_id: 9 }));
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/arbitre", setter: { userId: 9, asOrganisation: false }, access: STAFF });

    expect(world.state.setterLocks).toEqual([9]);
    // Le compte d'abord, puis le verrou du match (même ordre que la suppression de compte).
    const statements = world.execute.mock.calls.map(([sql]) => String(sql));
    const setterLock = statements.findIndex((sql) => sql.includes("FROM bg_users"));
    const matchLock = statements.findIndex((sql) => sql.includes("FROM bg_matches") && sql.includes("FOR UPDATE"));
    expect(setterLock).toBeGreaterThanOrEqual(0);
    expect(setterLock).toBeLessThan(matchLock);
  });

  it("setMatchLiveConfig_deletedSetter_throwsUnauthorizedAndWritesNothing", async () => {
    const world = liveWorld(matchRow({ kept_referee_user_id: 9 }), [dbStream(4, null)]);
    world.state.deletedUsers.push(9);
    await mockLiveDb(world);

    await expect(
      setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/arbitre", setter: { userId: 9, asOrganisation: false }, access: STAFF }),
    ).rejects.toThrow("UNAUTHORIZED");

    expect(world.state.matchWrites).toEqual([]);
    expect(world.state.streams).toEqual([dbStream(4, null)]);
  });

  it("setMatchLiveConfig_organisationLink_takesNoSetterLock", async () => {
    const world = liveWorld(matchRow({ kept_referee_user_id: 9 }));
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/bluegenji", setter: { userId: 9, asOrganisation: true }, access: STAFF });

    expect(world.state.setterLocks).toEqual([]);
  });

  it("setMatchLiveConfig_noLiveUrl_takesNoSetterLock", async () => {
    const world = liveWorld(matchRow({ kept_referee_user_id: 9 }));
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: undefined, setter: { userId: 9, asOrganisation: false }, access: STAFF });

    expect(world.state.setterLocks).toEqual([]);
  });

  it("setMatchLiveConfig_mutedFirstCasterOnStream_rebindsLinkToShownCaster", async () => {
    // Le premier inscrit est tu (inéligible avant le lancement) : le lien revient au caster montré.
    const world = liveWorld(matchRow({ live_trigger: "MANUAL", live_trigger_user_id: 12, kept_referee_user_id: 9 }), [dbStream(4, null)], [
      { user_id: 12, stream_id: 4, eligible: false },
      { user_id: 13, stream_id: 4 },
    ]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, {
      trigger: "MANUAL",
      liveUrl: null,
      setter: { userId: 9, asOrganisation: false },
      access: STAFF,
      streamLinks: [{ streamId: 4, liveUrl: "twitch.tv/neuve" }],
    });

    expect(world.state.streams).toEqual([{ ...dbStream(4, "https://twitch.tv/neuve"), link_user_id: 13 }]);
  });

  it("setMatchLiveConfig_onlyMutedCasterOnStream_throwsStreamNotFound", async () => {
    const world = liveWorld(matchRow({ live_trigger: "MANUAL", live_trigger_user_id: 12, kept_referee_user_id: 9 }), [dbStream(4, null)], [
      { user_id: 12, stream_id: 4, eligible: false },
    ]);
    await mockLiveDb(world);

    await expect(
      setMatchLiveConfig(42, {
        trigger: "MANUAL",
        liveUrl: null,
        setter: { userId: 9, asOrganisation: false },
        access: STAFF,
        streamLinks: [{ streamId: 4, liveUrl: "twitch.tv/neuve" }],
      }),
    ).rejects.toMatchObject({ message: "STREAM_NOT_FOUND", streamId: 4 });
  });

  it("setMatchLiveConfig_refereeChangesCasterMode_keepsCasterOwner", async () => {
    const world = liveWorld(matchRow({ live_trigger: "MANUAL", live_trigger_user_id: 12, kept_referee_user_id: 9 }), [dbStream(4, null)], [
      { user_id: 12, stream_id: 4 },
    ]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: null, setter: { userId: 9, asOrganisation: true }, access: STAFF });

    expect(world.state.matchWrites).toEqual([[expect.stringContaining("SET live_trigger = ?"), ["AUTO", 12, 42]]]);
  });

  it("setMatchLiveConfig_castingRefereeChangesCasterMode_keepsCasterOwner", async () => {
    const world = liveWorld(
      matchRow({ live_trigger: "MANUAL", live_trigger_user_id: 12, kept_referee_user_id: 9 }),
      [dbStream(4, null), dbStream(5, null)],
      [
        { user_id: 12, stream_id: 4 },
        { user_id: 9, stream_id: 5 },
      ],
    );
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: null, setter: { userId: 9, asOrganisation: true }, access: STAFF });

    expect(world.state.matchWrites).toEqual([[expect.stringContaining("SET live_trigger = ?"), ["AUTO", 12, 42]]]);
  });

  it("setMatchLiveConfig_refereeCorrectsLinkOfStillCastingProvider_keepsProvider", async () => {
    // Le co-caster inscrit en second a fourni le lien : il le garde.
    const world = liveWorld(
      matchRow({ live_trigger: "MANUAL", live_trigger_user_id: 12, kept_referee_user_id: 9 }),
      [{ ...dbStream(4, "https://kick.com/voix"), link_user_id: 13 }],
      [
        { user_id: 12, stream_id: 4 },
        { user_id: 13, stream_id: 4 },
      ],
    );
    await mockLiveDb(world);

    await setMatchLiveConfig(42, {
      trigger: "MANUAL",
      liveUrl: null,
      setter: { userId: 9, asOrganisation: false },
      access: STAFF,
      streamLinks: [{ streamId: 4, liveUrl: "twitch.tv/neuve" }],
    });

    expect(world.state.streams).toEqual([{ ...dbStream(4, "https://twitch.tv/neuve"), link_user_id: 13 }]);
  });

  it("setMatchLiveConfig_resaveSameTriggerAndLink_changedFalse", async () => {
    // Réglage réenregistré tel quel : rien d'écrit, rien à annoncer.
    const world = liveWorld(matchRow({ live_trigger: "MANUAL" }), [dbStream(6, "https://twitch.tv/orga", true)]);
    await mockLiveDb(world);

    const outcome = await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/orga", setter: ORGANISER_5, access: STAFF });

    expect(outcome).toEqual({ previousTrigger: "MANUAL", changed: false });
    expect(world.state.matchWrites).toEqual([]);
    expect(world.state.streams).toEqual([dbStream(6, "https://twitch.tv/orga", true)]);
  });

  it("setMatchLiveConfig_liveHolderNotCasting_throwsNotMatchCaster", async () => {
    // Décision du 2026-11-05 : un porteur de la seule `live` ne règle que son cast.
    const world = liveWorld(
      matchRow({ live_trigger: "MANUAL", live_trigger_user_id: 12 }),
      [dbStream(6, "https://twitch.tv/orga", true), dbStream(7, "https://twitch.tv/voix")],
      [{ user_id: 12, stream_id: 7 }],
    );
    await mockLiveDb(world);

    await expect(
      setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/autre", setter: ORGANISER_5, access: LIVE_ONLY }),
    ).rejects.toThrow("NOT_MATCH_CASTER");

    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("setMatchLiveConfig_liveHolderNotCastingLinkOnUnmarkedMatch_throwsNotMatchCasterFirst", async () => {
    // Le rôle se juge avant le mode : pas de `MATCH_NOT_STREAMED` pour un appelant sans droit.
    const world = liveWorld(matchRow({ live_trigger: null }));
    await mockLiveDb(world);

    await expect(
      setMatchLiveConfig(42, { trigger: undefined, liveUrl: "twitch.tv/autre", setter: ORGANISER_5, access: LIVE_ONLY }),
    ).rejects.toThrow("NOT_MATCH_CASTER");
  });

  it("setMatchLiveConfig_noLiveNotRefereeLinkOnUnmarkedMatch_throwsNotMatchRefereeFirst", async () => {
    const world = liveWorld(matchRow({ live_trigger: null }));
    await mockLiveDb(world);

    await expect(
      setMatchLiveConfig(42, { trigger: undefined, liveUrl: "twitch.tv/autre", setter: ORGANISER_5, access: REFEREE_ONLY }),
    ).rejects.toThrow("NOT_MATCH_REFEREE");
  });

  it("setMatchLiveConfig_coCasterResendsSameStaffLinkOnOtherCasterMode_passes", async () => {
    const world = liveWorld(
      matchRow({ live_trigger: "MANUAL", live_trigger_user_id: 12 }),
      [dbStream(6, "https://twitch.tv/orga", true), dbStream(7, "https://twitch.tv/voix")],
      [
        { user_id: 12, stream_id: 7 },
        { user_id: 13, stream_id: 7 },
      ],
    );
    await mockLiveDb(world);

    const outcome = await setMatchLiveConfig(42, {
      trigger: "MANUAL",
      liveUrl: "twitch.tv/orga",
      setter: { userId: 13, asOrganisation: false },
      access: LIVE_ONLY,
    });

    expect(outcome.changed).toBe(false);
  });

  it("setMatchLiveConfig_tournamentsWithoutLiveOnOtherCasterMode_throwsNotMatchReferee", async () => {
    // Décision 2 : le lien du staff suit le mode d'un autre caster montré —
    // sauf pour le staff `tournaments` + `live` (`oversees`, décision du 2026-11-09).
    const world = liveWorld(
      matchRow({ live_trigger: "MANUAL", live_trigger_user_id: 12 }),
      [dbStream(6, "https://twitch.tv/orga", true), dbStream(7, "https://twitch.tv/voix")],
      [{ user_id: 12, stream_id: 7 }],
    );
    await mockLiveDb(world);

    await expect(
      setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/autre", setter: ORGANISER_5, access: REFEREE_ONLY }),
    ).rejects.toThrow("NOT_MATCH_REFEREE");
  });

  it("setMatchLiveConfig_overseerChangesOtherCasterMode_writesIt", async () => {
    // Décision du 2026-11-09 : le staff `tournaments` + `live` règle tout cast.
    const world = liveWorld(matchRow({ live_trigger: "MANUAL", live_trigger_user_id: 12 }), [dbStream(4, null)], [
      { user_id: 12, stream_id: 4 },
    ]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: null, setter: ORGANISER_5, access: STAFF });

    expect(world.state.matchWrites).toEqual([[expect.stringContaining("SET live_trigger = ?"), ["AUTO", 12, 42]]]);
  });

  it("setMatchLiveConfig_liveOnlyOwnerChangesStaffLink_throwsStaffStreamForbidden", async () => {
    const world = liveWorld(
      matchRow({ live_trigger: "MANUAL", live_trigger_user_id: 12 }),
      [dbStream(6, "https://twitch.tv/orga", true), dbStream(7, "https://twitch.tv/voix")],
      [{ user_id: 12, stream_id: 7 }],
    );
    await mockLiveDb(world);

    await expect(
      setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/neuve", setter: CASTER_12, access: LIVE_ONLY }),
    ).rejects.toThrow("STAFF_STREAM_FORBIDDEN");
    // La transaction est annulée (rollback) : rien n'est publié.
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
    // Refusé avant toute écriture : le lien du staff n'a pas été touché.
    expect(world.execute.mock.calls.some(([sql]) => String(sql).includes("UPDATE bg_match_streams"))).toBe(false);
  });

  it("setMatchLiveConfig_liveOnlyCasterOnOwnerlessMode_becomesOwner", async () => {
    // Décision du 2026-11-05 : le caster qui change un mode sans maître en devient le maître.
    const world = liveWorld(matchRow({ live_trigger: "AUTO", live_trigger_user_id: null }), [dbStream(7, null)], [
      { user_id: 12, stream_id: 7 },
    ]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: null, setter: CASTER_12, access: LIVE_ONLY });

    expect(world.state.matchWrites).toEqual([[expect.stringContaining("SET live_trigger = ?"), ["MANUAL", 12, 42]]]);
  });

  it("setMatchLiveConfig_liveOnlyCasterUnmarksOwnerlessModeWithStaffLink_throwsNotOwned", async () => {
    // Un mode sans maître ne se démarque pas par la seule `live` (décision du 2026-11-09).
    const world = liveWorld(
      matchRow({ live_trigger: "AUTO", live_trigger_user_id: null }),
      [dbStream(6, "https://twitch.tv/orga", true), dbStream(7, "https://twitch.tv/voix")],
      [{ user_id: 12, stream_id: 7 }],
    );
    await mockLiveDb(world);

    await expect(setMatchLiveConfig(42, { trigger: null, liveUrl: null, setter: CASTER_12, access: LIVE_ONLY })).rejects.toThrow(
      "LIVE_TRIGGER_NOT_OWNED",
    );
    expect(world.state.matchWrites).toEqual([]);
  });

  it("setMatchLiveConfig_liveOnlyCasterUnmarksOrphanModeWithoutStaffLink_throwsNotOwned", async () => {
    const world = liveWorld(matchRow({ live_trigger: "AUTO", live_trigger_user_id: null }), [dbStream(7, "https://twitch.tv/voix")], [
      { user_id: 12, stream_id: 7 },
    ]);
    await mockLiveDb(world);

    await expect(setMatchLiveConfig(42, { trigger: null, liveUrl: null, setter: CASTER_12, access: LIVE_ONLY })).rejects.toThrow(
      "LIVE_TRIGGER_NOT_OWNED",
    );
    expect(world.state.matchWrites).toEqual([]);
  });

  it("setMatchLiveConfig_triggerUndefinedWithLink_writesLinkOnCurrentMode", async () => {
    const world = liveWorld(matchRow({ live_trigger: "AUTO" }), [dbStream(6, null, true)]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: undefined, liveUrl: "twitch.tv/orga", setter: ORGANISER_5, access: STAFF });

    expect(world.state.streams[0]?.live_url).toBe("https://twitch.tv/orga");
    expect(world.state.matchWrites).toEqual([]);
  });

  it("setMatchLiveConfig_triggerAndLinkUndefined_writesNothing", async () => {
    const world = liveWorld(matchRow({ live_trigger: "AUTO" }), [dbStream(6, "https://twitch.tv/orga", true)]);
    await mockLiveDb(world);

    const outcome = await setMatchLiveConfig(42, { trigger: undefined, liveUrl: undefined, setter: ORGANISER_5, access: STAFF });

    expect(outcome).toEqual({ previousTrigger: "AUTO", changed: false });
    expect(world.state.matchWrites).toEqual([]);
    expect(world.state.streams).toEqual([dbStream(6, "https://twitch.tv/orga", true)]);
  });

  it("setMatchLiveConfig_triggerChangedLinkUndefined_keepsStaffLink", async () => {
    const world = liveWorld(matchRow({ live_trigger: "AUTO" }), [dbStream(6, "https://twitch.tv/orga", true)]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: undefined, setter: ORGANISER_5, access: STAFF });

    expect(world.state.streams).toEqual([dbStream(6, "https://twitch.tv/orga", true)]);
  });

  it("setMatchLiveConfig_ownerLiveOnlyChangesMode_writes", async () => {
    const world = liveWorld(
      matchRow({ live_trigger: "MANUAL", live_trigger_user_id: 12 }),
      [dbStream(6, "https://twitch.tv/orga", true), dbStream(7, "https://twitch.tv/voix")],
      [{ user_id: 12, stream_id: 7 }],
    );
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: "twitch.tv/orga", setter: CASTER_12, access: LIVE_ONLY });

    expect(world.state.matchWrites).toEqual([[expect.stringContaining("SET live_trigger = ?"), ["AUTO", 12, 42]]]);
  });

  it("setMatchLiveConfig_resaveUnchanged_publishesNoEvent", async () => {
    // Rien d'écrit : aucun instantané rebâti ni poussé aux lecteurs.
    const world = liveWorld(matchRow({ live_trigger: "MANUAL" }), [dbStream(6, "https://twitch.tv/orga", true)]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/orga", setter: ORGANISER_5, access: STAFF });

    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("setMatchLiveConfig_sameTriggerNewStaffLink_changedTrue", async () => {
    const world = liveWorld(matchRow({ live_trigger: "MANUAL" }), [dbStream(6, "https://twitch.tv/orga", true)]);
    await mockLiveDb(world);

    const outcome = await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: "twitch.tv/neuve", setter: ORGANISER_5, access: STAFF });

    expect(outcome.changed).toBe(true);
  });

  it("setMatchLiveConfig_refereeLinksOnlyOnUnmarkedMatch_changedTrue", async () => {
    const world = liveWorld(matchRow({ kept_referee_user_id: 9 }), [dbStream(4, null)], [{ user_id: 12, stream_id: 4 }]);
    await mockLiveDb(world);

    const outcome = await setMatchLiveConfig(42, {
      trigger: null,
      liveUrl: null,
      setter: { userId: 9, asOrganisation: false },
      access: STAFF,
      streamLinks: [{ streamId: 4, liveUrl: "twitch.tv/x" }],
    });

    expect(outcome).toEqual({ previousTrigger: null, changed: true });
  });

  it("setMatchLiveConfig_liveStaffWithEmptyStreamLinks_savesConfig", async () => {
    const world = liveWorld(matchRow({ live_trigger: "AUTO" }));
    await mockLiveDb(world);

    await setMatchLiveConfig(42, {
      trigger: "MANUAL",
      liveUrl: null,
      setter: { userId: 3, asOrganisation: true },
      access: STAFF,
      streamLinks: [],
    });

    expect(world.state.matchWrites).toEqual([[expect.stringContaining("SET live_trigger = ?"), ["MANUAL", null, 42]]]);
  });

  it("setMatchLiveConfig_ownRefereeNoLongerEligible_refusedWithoutWrite", async () => {
    jest.mocked(loadRefereeStanding).mockResolvedValue({ block: "NOT_REFEREE", objection: false });
    const world = liveWorld(matchRow({ live_trigger: "MANUAL", live_trigger_user_id: 12, kept_referee_user_id: 9 }), [
      dbStream(4, "https://kick.com/voix"),
    ]);
    await mockLiveDb(world);

    await expect(
      setMatchLiveConfig(42, {
        trigger: "MANUAL",
        liveUrl: null,
        setter: { userId: 9, asOrganisation: false },
        access: STAFF,
        streamLinks: [{ streamId: 4, liveUrl: "twitch.tv/neuve" }],
      }),
    ).rejects.toThrow("NOT_MATCH_REFEREE");
    expect(world.state.streams).toEqual([dbStream(4, "https://kick.com/voix")]);
  });

  it("setMatchLiveConfig_actorNotDesignatedReferee_readsGameWithoutRefereeSql", async () => {
    // L'acteur avec `tournaments` qui n'est pas l'arbitre désigné : la lecture
    // ne paie pas les sous-requêtes de l'arbitre, sous le verrou du match.
    const world = liveWorld(matchRow({ live_trigger: "AUTO", referee_user_id: 9 }));
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: null, setter: ORGANISER_5, access: STAFF });

    const game = world.execute.mock.calls.map(([sql]) => String(sql)).find((sql) => sql.startsWith("SELECT t.game,"));
    expect(game).toContain("NULL AS kept");
  });

  it("setMatchLiveConfig_lockedRead_excludesRefereeWhoPlaysMatch", async () => {
    const world = liveWorld(matchRow({ live_trigger: "AUTO", referee_user_id: 5 }));
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: null, setter: ORGANISER_5, access: STAFF });

    const kept = world.execute.mock.calls.map(([sql]) => String(sql)).find((sql) => sql.includes("AS kept"));
    expect(kept).toContain("krtm.user_id = m.referee_user_id");
    expect(kept).toContain("krst.solo_user_id = m.referee_user_id");
  });

  it("setMatchLiveConfig_lockedRead_keepsRefereeOnlyOnMatchToPlay", async () => {
    const world = liveWorld(matchRow({ live_trigger: "AUTO", referee_user_id: 5 }));
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: null, setter: ORGANISER_5, access: STAFF });

    const kept = world.execute.mock.calls.map(([sql]) => String(sql)).find((sql) => sql.includes("AS kept"));
    expect(kept).toContain("m.status IN ('PENDING', 'READY')");
  });

  it("setMatchLiveConfig_lockedRead_launchedBranchRequiresCurrentPairing", async () => {
    const world = liveWorld(matchRow({ live_trigger: "AUTO", referee_user_id: 5 }));
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: null, setter: ORGANISER_5, access: STAFF });

    const kept = world.execute.mock.calls.map(([sql]) => String(sql)).find((sql) => sql.includes("AS kept"));
    expect(kept).toContain("m.launch_pairing = CONCAT(m.team1_id, ':', m.team2_id)");
  });

  it("setMatchLiveConfig_refereeLinksAndStaffUrlTogether_staffUrlDoesNotTakeCasterStream", async () => {
    const world = liveWorld(matchRow({ live_trigger: "MANUAL", kept_referee_user_id: 9 }), [dbStream(4, null)], [
      { user_id: 12, stream_id: 4 },
    ]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, {
      trigger: "MANUAL",
      liveUrl: "twitch.tv/orga",
      setter: { userId: 9, asOrganisation: true },
      access: STAFF,
      streamLinks: [{ streamId: 4, liveUrl: "kick.com/caster" }],
    });

    // Le stream du caster garde son lien, rattaché à son caster ; celui du staff en ouvre un autre.
    expect(world.state.streams.find((stream) => stream.id === 4)).toEqual({ ...dbStream(4, "https://kick.com/caster"), link_user_id: 12 });
    expect(world.state.streams.find((stream) => stream.id === 5)?.live_url).toBe("https://twitch.tv/orga");
  });

  it("setMatchLiveConfig_refereeClearsCasterLinkWithStaffUrl_staffUrlOpensOwnStream", async () => {
    const world = liveWorld(matchRow({ live_trigger: "MANUAL", kept_referee_user_id: 9 }), [dbStream(4, "https://kick.com/caster")], [
      { user_id: 12, stream_id: 4 },
    ]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, {
      trigger: "MANUAL",
      liveUrl: "twitch.tv/orga",
      setter: { userId: 9, asOrganisation: true },
      access: STAFF,
      streamLinks: [{ streamId: 4, liveUrl: "" }],
    });

    expect(world.state.streams.find((stream) => stream.id === 4)).toEqual(dbStream(4, null));
    expect(world.state.streams.find((stream) => stream.id === 5)).toEqual(dbStream(5, "https://twitch.tv/orga", true));
  });

  it("setMatchLiveConfig_nonLiveCallerNoLongerReferee_refusedWithoutWrite", async () => {
    jest.mocked(loadRefereeStanding).mockResolvedValue({ block: "NOT_REFEREE", objection: false });
    const world = liveWorld(matchRow({ live_trigger: "MANUAL", kept_referee_user_id: 9 }));
    await mockLiveDb(world);

    await expect(
      setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: null, setter: { userId: 9, asOrganisation: true }, access: REFEREE_ONLY }),
    ).rejects.toThrow("NOT_MATCH_REFEREE");
    expect(world.state.matchWrites).toEqual([]);
  });

  it("setMatchLiveConfig_nonLiveCallerStillReferee_writesTriggerWithoutOwner", async () => {
    const world = liveWorld(matchRow({ live_trigger: "MANUAL", kept_referee_user_id: 9 }));
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: null, setter: { userId: 9, asOrganisation: true }, access: REFEREE_ONLY });

    expect(world.state.matchWrites).toEqual([[expect.stringContaining("SET live_trigger = ?"), ["AUTO", null, 42]]]);
  });

  it("setMatchLiveConfig_liveOnlyNotCastingSetsTrigger_throwsNotMatchCaster", async () => {
    const world = liveWorld(matchRow());
    await mockLiveDb(world);

    await expect(
      setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: null, setter: { userId: 13, asOrganisation: false }, access: LIVE_ONLY }),
    ).rejects.toThrow("NOT_MATCH_CASTER");
    expect(world.state.matchWrites).toEqual([]);
  });

  it("setMatchLiveConfig_staffNotCastingSetsTrigger_ownerNull", async () => {
    const world = liveWorld(matchRow());
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: null, setter: ORGANISER_5, access: STAFF });

    expect(world.state.matchWrites).toEqual([[expect.stringContaining("SET live_trigger = ?"), ["AUTO", null, 42]]]);
  });

  it("setMatchLiveConfig_casterSetsMode_readsOwnerAndActorOnce", async () => {
    const world = liveWorld(matchRow({ live_trigger: "AUTO", live_trigger_user_id: 12 }), [dbStream(4, null)], [
      { user_id: 12, stream_id: 4 },
    ]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: null, setter: CASTER_12, access: LIVE_ONLY });

    const shownReads = world.execute.mock.calls.filter(([sql]) => String(sql).includes("SELECT mc.user_id"));
    expect(shownReads).toHaveLength(1);
    expect(world.state.matchWrites).toEqual([[expect.stringContaining("SET live_trigger = ?"), ["MANUAL", 12, 42]]]);
  });

  it("setMatchLiveConfig_refereeLinkOnStreamWithoutCaster_throwsStreamNotFound", async () => {
    // Le dernier caster du stream est parti : le lien n'aurait personne à qui se rattacher.
    const world = liveWorld(matchRow({ live_trigger: "MANUAL", kept_referee_user_id: 9 }), [dbStream(4, null)]);
    await mockLiveDb(world);

    await expect(
      setMatchLiveConfig(42, {
        trigger: "MANUAL",
        liveUrl: null,
        setter: { userId: 9, asOrganisation: false },
        access: STAFF,
        streamLinks: [{ streamId: 4, liveUrl: "twitch.tv/x" }],
      }),
    ).rejects.toMatchObject({ message: "STREAM_NOT_FOUND", streamId: 4 });
    expect(world.state.streams).toEqual([dbStream(4, null)]);
  });

  it("setMatchLiveConfig_linksOnlyOnUnmarkedMatch_noUnmarkWrites", async () => {
    const world = liveWorld(matchRow({ kept_referee_user_id: 9 }), [dbStream(4, null), dbStream(6, "https://twitch.tv/orga", true)], [
      { user_id: 12, stream_id: 4 },
    ]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, {
      trigger: null,
      liveUrl: null,
      setter: { userId: 9, asOrganisation: false },
      access: STAFF,
      streamLinks: [{ streamId: 4, liveUrl: "twitch.tv/x" }],
    });

    expect(world.state.matchWrites).toEqual([]);
    expect(world.state.streams.find((stream) => stream.id === 6)?.live_url).toBe("https://twitch.tv/orga");
  });

  it("setMatchLiveConfig_triggerChanged_returnsPreviousTrigger", async () => {
    const world = liveWorld(matchRow({ live_trigger: "AUTO" }));
    await mockLiveDb(world);

    const outcome = await setMatchLiveConfig(42, { trigger: "MANUAL", liveUrl: null, setter: ORGANISER_5, access: STAFF });

    expect(outcome).toEqual({ previousTrigger: "AUTO", changed: true });
  });

  it("setMatchLiveConfig_hiddenOwnerMode_staffChangesIt", async () => {
    // Le maître 12 n'est plus caster du match : le mode revient au staff.
    const world = liveWorld(matchRow({ live_trigger: "MANUAL", live_trigger_user_id: 12 }));
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: null, setter: ORGANISER_5, access: STAFF });

    expect(world.state.matchWrites).toEqual([[expect.stringContaining("SET live_trigger = ?"), ["AUTO", null, 42]]]);
  });

  it("setMatchLiveConfig_ineligibleOwnerBeforeLaunch_staffChangesIt", async () => {
    // Le maître caste encore, mais tu (inéligible) : il ne tient plus le mode.
    const world = liveWorld(matchRow({ live_trigger: "MANUAL", live_trigger_user_id: 12 }), [dbStream(4, null)], [
      { user_id: 12, stream_id: 4, eligible: false },
    ]);
    await mockLiveDb(world);

    await setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: null, setter: ORGANISER_5, access: STAFF });

    expect(world.state.matchWrites).toEqual([[expect.stringContaining("SET live_trigger = ?"), ["AUTO", null, 42]]]);
  });

  it("setMatchLiveConfig_shownOwnerMode_tournamentsWithoutLiveNotRefereeRefused", async () => {
    const world = liveWorld(matchRow({ live_trigger: "MANUAL", live_trigger_user_id: 12 }), [dbStream(4, null)], [
      { user_id: 12, stream_id: 4 },
    ]);
    await mockLiveDb(world);

    await expect(
      setMatchLiveConfig(42, { trigger: "AUTO", liveUrl: null, setter: ORGANISER_5, access: REFEREE_ONLY }),
    ).rejects.toThrow("NOT_MATCH_REFEREE");
    expect(world.state.matchWrites).toEqual([]);
  });

  it("setMatchLiveConfig_invalidCasterLink_throwsStreamLinkErrorWithStreamId", async () => {
    const world = liveWorld(matchRow({ live_trigger: "MANUAL", kept_referee_user_id: 9 }), [dbStream(4, null)], [
      { user_id: 12, stream_id: 4 },
    ]);
    await mockLiveDb(world);

    const refusal = setMatchLiveConfig(42, {
      trigger: "MANUAL",
      liveUrl: null,
      setter: { userId: 9, asOrganisation: false },
      access: STAFF,
      streamLinks: [{ streamId: 4, liveUrl: "https://exemple.com/x" }],
    });

    await expect(refusal).rejects.toBeInstanceOf(StreamLinkError);
    await expect(refusal).rejects.toMatchObject({ message: "INVALID_STREAM_URL", streamId: 4 });
  });

  describe("setMatchOnAir", () => {
    /** La seule permission `live` (caster), ou le staff `tournaments`. */
    const LIVE_ACCESS = { oversees: false, manages: false, live: true };
    const STAFF_ACCESS = { oversees: true, manages: true, live: true };

    /** Match MANUAL posé par le caster 12, montré sur le stream 4 ; co-caster 13 sur le stream 5. */
    function ownedWorld(overrides: Record<string, unknown> = {}) {
      return liveWorld(
        matchRow({ live_trigger: "MANUAL", live_trigger_user_id: 12, ...overrides }),
        [dbStream(4, "https://twitch.tv/a"), dbStream(5, "https://twitch.tv/b")],
        [
          { user_id: 12, stream_id: 4 },
          { user_id: 13, stream_id: 5 },
        ],
      );
    }

    it("setMatchOnAir_notManualByNonReferee_throwsNotManualFirst", async () => {
      const world = ownedWorld({ live_trigger: "AUTO" });
      await mockLiveDb(world);

      await expect(setMatchOnAir(42, true, 9, { oversees: false, manages: true, live: false })).rejects.toThrow(
        "LIVE_TRIGGER_NOT_MANUAL",
      );
    });

    it("setMatchOnAir_coCasterOnOwnersMode_throwsNotOwned", async () => {
      const world = ownedWorld();
      await mockLiveDb(world);

      await expect(setMatchOnAir(42, true, 13, LIVE_ACCESS)).rejects.toThrow("LIVE_TRIGGER_NOT_OWNED");
      expect(world.state.matchWrites).toEqual([]);
      expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
    });

    it("setMatchOnAir_liveOnlyWithStaffMemberOwnChannel_setsOnAir", async () => {
      const world = liveWorld(
        matchRow({ live_trigger: "MANUAL", live_trigger_user_id: null }),
        [{ ...dbStream(3, "https://twitch.tv/staff5", true), link_user_id: 5 }, dbStream(5, "https://twitch.tv/b")],
        [{ user_id: 13, stream_id: 5 }],
      );
      await mockLiveDb(world);

      await expect(setMatchOnAir(42, true, 13, LIVE_ACCESS)).resolves.toBe(true);
      expect(world.state.matchWrites).toEqual([["UPDATE bg_matches SET live_started_at = ? WHERE id = ?", [expect.any(Date), 42]]]);
    });

    it("setMatchOnAir_liveOnlyShownOnStaffModeWithLink_throwsStaffStreamForbidden", async () => {
      const world = liveWorld(
        matchRow({ live_trigger: "MANUAL", live_trigger_user_id: null }),
        [dbStream(3, "https://twitch.tv/orga", true), dbStream(5, "https://twitch.tv/b")],
        [{ user_id: 13, stream_id: 5 }],
      );
      await mockLiveDb(world);

      await expect(setMatchOnAir(42, true, 13, LIVE_ACCESS)).rejects.toThrow("STAFF_STREAM_FORBIDDEN");
      expect(world.state.matchWrites).toEqual([]);
    });

    it("setMatchOnAir_owner_opensAntennaAndPublishes", async () => {
      const world = ownedWorld();
      await mockLiveDb(world);

      await expect(setMatchOnAir(42, true, 12, LIVE_ACCESS)).resolves.toBe(true);

      expect(world.state.matchWrites).toEqual([["UPDATE bg_matches SET live_started_at = ? WHERE id = ?", [expect.any(Date), 42]]]);
      expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7, { landingLive: true });
    });

    it("setMatchOnAir_ownerCloses_clearsStartedAt", async () => {
      const world = ownedWorld({ live_started_at: new Date("2026-11-05T20:00:00Z") });
      await mockLiveDb(world);

      await expect(setMatchOnAir(42, false, 12, LIVE_ACCESS)).resolves.toBe(true);

      expect(world.state.matchWrites).toEqual([["UPDATE bg_matches SET live_started_at = NULL WHERE id = ?", [42]]]);
    });

    it("setMatchOnAir_hiddenOwner_staffAllowed", async () => {
      const world = liveWorld(matchRow({ live_trigger: "MANUAL", live_trigger_user_id: 12 }));
      await mockLiveDb(world);

      await expect(setMatchOnAir(42, true, 5, STAFF_ACCESS)).resolves.toBe(true);
    });

    it("setMatchOnAir_withoutLiveNorReferee_throwsNotMatchReferee", async () => {
      const world = ownedWorld();
      await mockLiveDb(world);

      await expect(setMatchOnAir(42, true, 5, { oversees: false, manages: true, live: false })).rejects.toThrow(
        "NOT_MATCH_REFEREE",
      );
    });

    it("setMatchOnAir_designatedRefereeWithoutLive_allowed", async () => {
      const world = ownedWorld({ kept_referee_user_id: 9 });
      await mockLiveDb(world);

      await expect(setMatchOnAir(42, true, 9, { oversees: false, manages: true, live: false })).resolves.toBe(true);
    });

    it("setMatchOnAir_notManual_throwsNotManual", async () => {
      const world = ownedWorld({ live_trigger: "AUTO" });
      await mockLiveDb(world);

      await expect(setMatchOnAir(42, true, 12, LIVE_ACCESS)).rejects.toThrow("LIVE_TRIGGER_NOT_MANUAL");
    });

    it("setMatchOnAir_openOnPendingMatch_throwsNotLiveReady", async () => {
      const world = ownedWorld({ status: "PENDING" });
      await mockLiveDb(world);

      await expect(setMatchOnAir(42, true, 12, LIVE_ACCESS)).rejects.toThrow("MATCH_NOT_LIVE_READY");
    });

    it("setMatchOnAir_alreadyOnAir_returnsFalseWithoutWriteOrPublish", async () => {
      const world = ownedWorld({ live_started_at: new Date("2026-11-05T20:00:00Z") });
      await mockLiveDb(world);

      await expect(setMatchOnAir(42, true, 12, LIVE_ACCESS)).resolves.toBe(false);
      expect(world.state.matchWrites).toEqual([]);
      expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
    });

    it("setMatchOnAir_ownerlessModeShownCaster_allowed", async () => {
      // Le maître est parti : le caster qui reste ouvre l'antenne sans attendre le staff.
      const world = liveWorld(matchRow({ live_trigger: "MANUAL", live_trigger_user_id: null }), [dbStream(5, "https://twitch.tv/b")], [
        { user_id: 13, stream_id: 5 },
      ]);
      await mockLiveDb(world);

      await expect(setMatchOnAir(42, true, 13, LIVE_ACCESS)).resolves.toBe(true);
    });

    it("setMatchOnAir_ownerlessModeLiveNonCaster_throwsNotOwned", async () => {
      const world = liveWorld(matchRow({ live_trigger: "MANUAL", live_trigger_user_id: null }));
      await mockLiveDb(world);

      await expect(setMatchOnAir(42, true, 13, LIVE_ACCESS)).rejects.toThrow("LIVE_TRIGGER_NOT_OWNED");
      expect(world.state.matchWrites).toEqual([]);
    });

    it("setMatchOnAir_actorWithoutTournaments_readsGameWithoutRefereeSql", async () => {
      const world = ownedWorld();
      await mockLiveDb(world);

      await setMatchOnAir(42, true, 12, LIVE_ACCESS);

      const gameRead = world.execute.mock.calls.find(([sql]) => String(sql).startsWith("SELECT t.game,"));
      expect(String(gameRead?.[0])).toContain("NULL AS kept");
      expect(String(gameRead?.[0])).not.toContain("referee_user_id");
    });

    it("setMatchOnAir_deadlockOnce_retriesAndSucceeds", async () => {
      const world = ownedWorld();
      await mockLiveDb(world);
      const real = world.execute.getMockImplementation()!;
      world.execute.mockImplementationOnce(async () => {
        throw Object.assign(new Error("Deadlock found when trying to get lock"), { code: "ER_LOCK_DEADLOCK" });
      });
      world.execute.mockImplementation(real);

      await expect(setMatchOnAir(42, true, 12, LIVE_ACCESS)).resolves.toBe(true);
      expect(world.state.matchWrites).toHaveLength(1);
    });

    it("setMatchOnAir_unknownMatch_throwsMatchNotFound", async () => {
      const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[]]);
      const connection = fakeConnection({
        execute,
        beginTransaction: async () => undefined,
        commit: async () => undefined,
        rollback: async () => undefined,
      });
      const { withConnection } = await import("@/lib/server/database");
      jest.mocked(withConnection).mockImplementation((run) => run(connection));

      await expect(setMatchOnAir(999, true, 12, LIVE_ACCESS)).rejects.toThrow("MATCH_NOT_FOUND");
    });
  });

  it("refuse un match inconnu", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await expect(setMatchLiveConfig(999, { trigger: "AUTO", liveUrl: null, setter: ORGANISER_5, access: STAFF })).rejects.toThrow(
      "MATCH_NOT_FOUND",
    );
  });
});

describe("isDesignatedMatchReferee", () => {
  it("isDesignatedMatchReferee_refereeOfAnotherMatch_false", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ kept: 9 }], []]);
    await mockDb(execute);

    await expect(isDesignatedMatchReferee(43, 3, true)).resolves.toBe(false);
    expect(execute.mock.calls[0][1]).toEqual([43]);
  });

  it("isDesignatedMatchReferee_playedMatch_queryRestrictsToMatchToPlay", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ kept: null }], []]);
    await mockDb(execute);

    await expect(isDesignatedMatchReferee(42, 9, true)).resolves.toBe(false);
    expect(String(execute.mock.calls[0][0])).toContain("m.status IN ('PENDING', 'READY')");
  });

  it("isDesignatedMatchReferee_keptReferee_true", async () => {
    await mockDb(jest.fn<SqlQuery>().mockResolvedValue([[{ kept: "9", tournament_id: 7, game: "OW" }], []]));

    await expect(isDesignatedMatchReferee(42, 9, true)).resolves.toBe(true);
    expect(loadRefereeStanding).toHaveBeenCalledWith(expect.anything(), 9, "OW");
  });

  it("isDesignatedMatchReferee_keptRefereeIneligible_false", async () => {
    jest.mocked(loadRefereeStanding).mockResolvedValue({ block: "NOT_REFEREE", objection: false });
    await mockDb(jest.fn<SqlQuery>().mockResolvedValue([[{ kept: 9, tournament_id: 7, game: "OW" }], []]));

    await expect(isDesignatedMatchReferee(42, 9, true)).resolves.toBe(false);
  });

  it("isDesignatedMatchReferee_keptRefereeWithObjection_false", async () => {
    // L'opposition retenue se relit avec la condition d'arbitrage, plus dans le SQL.
    jest.mocked(loadRefereeStanding).mockResolvedValue({ block: null, objection: true });
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ kept: 9, game: "OW" }], []]);
    await mockDb(execute);

    await expect(isDesignatedMatchReferee(42, 9, true)).resolves.toBe(false);
    expect(String(execute.mock.calls[0][0])).not.toContain("referee_objection_at");
  });

  it("isDesignatedMatchReferee_unknownMatch_false", async () => {
    await mockDb(jest.fn<SqlQuery>().mockResolvedValueOnce([[], []]));

    await expect(isDesignatedMatchReferee(42, 9, true)).resolves.toBe(false);
    expect(loadRefereeStanding).not.toHaveBeenCalled();
  });

  it("isDesignatedMatchReferee_withoutTournamentsPermission_falseWithoutRead", async () => {
    const execute = jest.fn<SqlQuery>();
    await mockDb(execute);

    await expect(isDesignatedMatchReferee(42, 9, false)).resolves.toBe(false);
    expect(execute).not.toHaveBeenCalled();
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
