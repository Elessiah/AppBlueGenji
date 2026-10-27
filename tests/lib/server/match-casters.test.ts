import { describe, expect, it, jest } from "@jest/globals";
import {
  firstStreamUrlSql,
  orphanStreamIds,
  pruneMatchStreams,
  staffStream,
  withdrawUserCasts,
  type MatchStreamRow,
} from "@/lib/server/tournaments/match-casters";
import { parseCastTarget } from "@/lib/server/tournaments/match-launch-routes";
import { LIVE_STAFF_SQL } from "@/lib/server/privacy-consent";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";

/**
 * Casters et streams d'un match (`lib/server/tournaments/match-casters.ts`,
 * `docs/features/MATCH_LAUNCH.md` § Casters et streams) : stream principal,
 * ménage des streams orphelins, retrait d'un compte de ses casts, corps de
 * l'inscription.
 */

const stream = (id: number, liveUrl: string | null, staff = false): MatchStreamRow => ({ id, matchId: 42, liveUrl, staff });

describe("firstStreamUrlSql — le premier lien, seule définition", () => {
  it("prend le plus petit stream qui a un lien, sur l'alias donné", () => {
    const sql = firstStreamUrlSql("m").replace(/\s+/g, " ");
    expect(sql.startsWith("(SELECT fs.live_url FROM bg_match_streams fs WHERE fs.match_id = m.id AND fs.live_url IS NOT NULL")).toBe(true);
    expect(sql.endsWith("ORDER BY fs.id LIMIT 1)")).toBe(true);
  });

  it("écarte le stream d'un caster qui ne remplit plus la condition, sauf stream du staff ou match lancé/joué", () => {
    const sql = firstStreamUrlSql("m").replace(/\s+/g, " ");
    expect(sql).toContain("fs.staff_owned = 1 OR m.status = 'COMPLETED' OR m.launched_at IS NOT NULL");
    expect(sql).toContain("EXISTS (SELECT 1 FROM bg_match_casters fc JOIN bg_users u ON u.id = fc.user_id");
    // La condition du cast, comme `castEligibilityBlock` : identité et permission `live`.
    expect(sql).toContain("COALESCE(u.is_deleted, 0) = 0");
    expect(sql).toContain("u.discord_verified_at IS NOT NULL AND COALESCE(u.discord_pseudo, '') <> ''");
    expect(sql).toContain("u.blizzard_sub IS NOT NULL AND COALESCE(u.overwatch_battletag, '') <> ''");
    expect(sql).toContain(`AND ${LIVE_STAFF_SQL})`);
  });
});

describe("staffStream — le stream que règle le staff", () => {
  it("le stream du staff, même sans lien ni rang", () => {
    expect(staffStream([stream(3, "https://twitch.tv/a"), stream(4, null, true)])?.id).toBe(4);
  });

  it("sans lui, le premier stream sans lien ; jamais celui qu'un caster a ouvert avec sa chaîne", () => {
    expect(staffStream([stream(3, "https://twitch.tv/voix"), stream(4, null), stream(5, null)])?.id).toBe(4);
    expect(staffStream([stream(3, "https://twitch.tv/voix")])).toBeNull();
    expect(staffStream([])).toBeNull();
  });
});

describe("orphanStreamIds — ce qui part quand un caster s'en va", () => {
  it("garde tout stream tenu par un caster", () => {
    expect(orphanStreamIds([stream(3, null), stream(4, "https://twitch.tv/b")], [{ streamId: 3 }, { streamId: 4 }])).toEqual([]);
  });

  it("efface un stream que personne ne tient, sauf celui du staff tant qu'il porte un lien", () => {
    const streams = [stream(3, "https://twitch.tv/match", true), stream(4, "https://kick.com/voix"), stream(5, null)];
    expect(orphanStreamIds(streams, [])).toEqual([4, 5]);
  });

  it("le stream du staff sans lien n'a rien à garder : il part aussi", () => {
    expect(orphanStreamIds([stream(3, null, true)], [])).toEqual([3]);
  });

  it("le stream qu'un caster a ouvert part avec lui, même s'il porte le premier lien du match", () => {
    // Le stream 3 (premier lien, chaîne du caster parti) ; le 4, tenu.
    expect(orphanStreamIds([stream(3, "https://kick.com/voix"), stream(4, null)], [{ streamId: 4 }])).toEqual([3]);
    expect(orphanStreamIds([stream(3, "https://kick.com/voix")], [])).toEqual([3]);
  });
});

/** Base à état : streams et casters d'un match, rejoués par `pruneMatchStreams`. */
function world(streams: { id: number; live_url: string | null; staff_owned?: number }[], casters: { user_id: number; stream_id: number }[]) {
  const state = { streams: [...streams], casters: [...casters], locked: [] as number[] };
  const execute = jest.fn<SqlQuery>(async (rawSql, rawParams) => {
    const sql = rawSql.replace(/\s+/g, " ").trim();
    const params = (rawParams ?? []) as unknown[];
    if (sql.startsWith("SELECT c.match_id FROM bg_match_casters c")) {
      return [state.casters.filter((c) => c.user_id === params[0]).map(() => ({ match_id: 42 }))];
    }
    if (sql === "SELECT id FROM bg_matches WHERE id = ? FOR UPDATE") {
      state.locked.push(params[0] as number);
      return [[{ id: params[0] }]];
    }
    if (sql.startsWith("DELETE FROM bg_match_casters")) {
      state.casters = state.casters.filter((c) => c.user_id !== params[1]);
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("SELECT id, match_id, live_url, staff_owned FROM bg_match_streams")) {
      return [state.streams.map((s) => ({ staff_owned: 0, ...s, match_id: 42 }))];
    }
    if (sql.startsWith("SELECT match_id, user_id, stream_id, ready_at FROM bg_match_casters")) {
      return [state.casters.map((c) => ({ ...c, match_id: 42, ready_at: null }))];
    }
    if (sql.startsWith("DELETE FROM bg_match_streams")) {
      const ids = params.slice(1);
      state.streams = state.streams.filter((s) => !ids.includes(s.id));
      return [{ affectedRows: ids.length }];
    }
    throw new Error(`requête inattendue : ${sql}`);
  });
  return { state, execute, connection: fakeConnection({ execute }) };
}

describe("pruneMatchStreams — ménage sous verrou", () => {
  it("verrouille streams puis casters, chaque table seule, et efface les orphelins d'un seul DELETE", async () => {
    const w = world(
      [{ id: 3, live_url: "https://twitch.tv/match" }, { id: 4, live_url: null }, { id: 5, live_url: "https://kick.com/x" }],
      [{ user_id: 9, stream_id: 3 }],
    );
    await pruneMatchStreams(w.connection, 42);
    expect(w.state.streams.map((s) => s.id)).toEqual([3]);
    const sqls = w.execute.mock.calls.map(([sql]) => sql.replace(/\s+/g, " ").trim());
    expect(sqls[0]).toMatch(/FROM bg_match_streams WHERE match_id = \? ORDER BY id FOR UPDATE$/);
    expect(sqls[1]).toMatch(/FROM bg_match_casters WHERE match_id = \? ORDER BY created_at, user_id FOR UPDATE$/);
    expect(sqls[2]).toBe("DELETE FROM bg_match_streams WHERE match_id = ? AND id IN (?, ?)");
    expect(w.execute.mock.calls[2][1]).toEqual([42, 4, 5]);
  });

  it("n'écrit rien sans stream, ni quand tout est tenu", async () => {
    const empty = world([], []);
    await pruneMatchStreams(empty.connection, 42);
    expect(empty.execute).toHaveBeenCalledTimes(1);
    const held = world([{ id: 3, live_url: null }], [{ user_id: 9, stream_id: 3 }]);
    await pruneMatchStreams(held.connection, 42);
    expect(held.execute.mock.calls.some(([sql]) => sql.startsWith("DELETE"))).toBe(false);
  });
});

describe("withdrawUserCasts — un compte qui part quitte ses casts", () => {
  it("verrouille le match, retire le compte, efface son stream à part et rend les matchs touchés", async () => {
    const w = world(
      [{ id: 3, live_url: "https://twitch.tv/match" }, { id: 4, live_url: "https://kick.com/sa-chaine" }],
      [{ user_id: 9, stream_id: 3 }, { user_id: 12, stream_id: 4 }],
    );
    expect(await withdrawUserCasts(w.connection, 12, true)).toEqual([42]);
    expect(w.state.locked).toEqual([42]);
    expect(w.state.casters).toEqual([{ user_id: 9, stream_id: 3 }]);
    // Le lien de sa chaîne part avec lui ; le stream partagé reste.
    expect(w.state.streams).toEqual([{ id: 3, live_url: "https://twitch.tv/match" }]);
  });

  it("le stream qu'il avait ouvert part, même s'il porte le premier lien du match", async () => {
    // Le co-caster sur un stream sans lien ; le compte effacé, seul sur le
    // stream qui porte le premier lien du match — celui de sa chaîne.
    const w = world(
      [{ id: 3, live_url: null }, { id: 4, live_url: "https://kick.com/sa-chaine" }],
      [{ user_id: 9, stream_id: 3 }, { user_id: 12, stream_id: 4 }],
    );
    await withdrawUserCasts(w.connection, 12, true);
    expect(w.state.streams).toEqual([{ id: 3, live_url: null }]);
  });

  it("le stream du staff qu'il tenait seul reste, avec le lien du staff", async () => {
    const w = world([{ id: 3, live_url: "https://twitch.tv/bluegenji", staff_owned: 1 }], [{ user_id: 12, stream_id: 3 }]);
    await withdrawUserCasts(w.connection, 12, true);
    expect(w.state.casters).toEqual([]);
    expect(w.state.streams).toEqual([{ id: 3, live_url: "https://twitch.tv/bluegenji", staff_owned: 1 }]);
  });

  it("anonymisation : les matchs joués gardent leur caster ; l'effacement emporte tout", async () => {
    const anonymize = world([], []);
    await withdrawUserCasts(anonymize.connection, 12, false);
    expect(anonymize.execute.mock.calls[0][0]).toContain("AND m.status <> 'COMPLETED'");
    const erase = world([], []);
    await withdrawUserCasts(erase.connection, 12, true);
    expect(erase.execute.mock.calls[0][0]).not.toContain("COMPLETED");
  });

  it("ne touche à rien pour un compte qui ne caste rien", async () => {
    const w = world([{ id: 3, live_url: null }], [{ user_id: 9, stream_id: 3 }]);
    expect(await withdrawUserCasts(w.connection, 12, true)).toEqual([]);
    expect(w.execute).toHaveBeenCalledTimes(1);
  });
});

describe("parseCastTarget — corps de POST /api/matches/[id]/caster", () => {
  it("rejoindre un stream, ouvrir le sien avec ou sans lien", () => {
    expect(parseCastTarget({ streamId: 3 })).toEqual({ streamId: 3 });
    expect(parseCastTarget({ liveUrl: "twitch.tv/x" })).toEqual({ liveUrl: "twitch.tv/x" });
    expect(parseCastTarget({ liveUrl: null })).toEqual({ liveUrl: null });
    expect(parseCastTarget({})).toEqual({ liveUrl: null });
    expect(parseCastTarget(null)).toEqual({ liveUrl: null });
  });

  it("refuse les deux à la fois, un identifiant mal formé et un lien qui n'est pas du texte", () => {
    expect(parseCastTarget({ streamId: 3, liveUrl: null })).toBeNull();
    for (const streamId of ["3", 0, -1, 1.5, null]) expect(parseCastTarget({ streamId })).toBeNull();
    expect(parseCastTarget({ liveUrl: 12 })).toBeNull();
  });
});
