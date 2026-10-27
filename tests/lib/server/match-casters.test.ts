import { describe, expect, it, jest } from "@jest/globals";
import {
  firstStreamUrlSql,
  orphanStreamIds,
  primaryStream,
  pruneMatchStreams,
  withdrawUserCasts,
  type MatchStreamRow,
} from "@/lib/server/tournaments/match-casters";
import { parseCastTarget } from "@/lib/server/tournaments/match-launch-routes";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";

/**
 * Casters et streams d'un match (`lib/server/tournaments/match-casters.ts`,
 * `docs/features/MATCH_LAUNCH.md` § Casters et streams) : stream principal,
 * ménage des streams orphelins, retrait d'un compte de ses casts, corps de
 * l'inscription.
 */

const stream = (id: number, liveUrl: string | null): MatchStreamRow => ({ id, matchId: 42, liveUrl });

describe("firstStreamUrlSql — le premier lien, seule définition", () => {
  it("prend le plus petit stream qui a un lien, sur l'alias donné", () => {
    const sql = firstStreamUrlSql("m").replace(/\s+/g, " ");
    expect(sql).toBe(
      "(SELECT fs.live_url FROM bg_match_streams fs WHERE fs.match_id = m.id AND fs.live_url IS NOT NULL ORDER BY fs.id LIMIT 1)",
    );
  });
});

describe("primaryStream — le stream que règle le staff", () => {
  it("le premier qui a un lien, sinon le premier ; rien sans stream", () => {
    expect(primaryStream([stream(3, null), stream(4, "https://twitch.tv/b"), stream(5, "https://kick.com/c")])?.id).toBe(4);
    expect(primaryStream([stream(3, null), stream(4, null)])?.id).toBe(3);
    expect(primaryStream([])).toBeNull();
  });
});

describe("orphanStreamIds — ce qui part quand un caster s'en va", () => {
  it("garde tout stream tenu par un caster", () => {
    expect(orphanStreamIds([stream(3, null), stream(4, "https://twitch.tv/b")], [{ streamId: 3 }, { streamId: 4 }])).toEqual([]);
  });

  it("efface un stream que personne ne tient, sauf le principal tant qu'il porte un lien", () => {
    const streams = [stream(3, "https://twitch.tv/match"), stream(4, "https://kick.com/voix"), stream(5, null)];
    expect(orphanStreamIds(streams, [])).toEqual([4, 5]);
  });

  it("le principal sans lien n'a rien à garder : il part aussi", () => {
    expect(orphanStreamIds([stream(3, null)], [])).toEqual([3]);
  });

  it("`alwaysDrop` efface le principal à lien qu'il nomme, jamais un stream encore tenu", () => {
    const streams = [stream(3, "https://kick.com/sa-chaine"), stream(4, null)];
    expect(orphanStreamIds(streams, [{ streamId: 4 }], [3])).toEqual([3]);
    expect(orphanStreamIds(streams, [{ streamId: 3 }, { streamId: 4 }], [3])).toEqual([]);
  });

  it("le stream à part d'un autre caster ne devient pas principal pour échapper au ménage", () => {
    // Le stream 4 (avec lien) est tenu ; le 3 (sans lien, premier) n'est tenu par personne.
    expect(orphanStreamIds([stream(3, null), stream(4, "https://kick.com/voix")], [{ streamId: 4 }])).toEqual([3]);
  });
});

/** Base à état : streams et casters d'un match, rejoués par `pruneMatchStreams`. */
function world(streams: { id: number; live_url: string | null }[], casters: { user_id: number; stream_id: number }[]) {
  const state = { streams: [...streams], casters: [...casters], locked: [] as number[] };
  const execute = jest.fn<SqlQuery>(async (rawSql, rawParams) => {
    const sql = rawSql.replace(/\s+/g, " ").trim();
    const params = (rawParams ?? []) as unknown[];
    if (sql.startsWith("SELECT c.match_id, c.stream_id FROM bg_match_casters c")) {
      return [state.casters.filter((c) => c.user_id === params[0]).map((c) => ({ match_id: 42, stream_id: c.stream_id }))];
    }
    if (sql === "SELECT id FROM bg_matches WHERE id = ? FOR UPDATE") {
      state.locked.push(params[0] as number);
      return [[{ id: params[0] }]];
    }
    if (sql.startsWith("DELETE FROM bg_match_casters")) {
      state.casters = state.casters.filter((c) => c.user_id !== params[1]);
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("SELECT id, match_id, live_url FROM bg_match_streams")) {
      return [state.streams.map((s) => ({ ...s, match_id: 42 }))];
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

  it("le stream principal qu'il tenait seul part aussi, avec le lien de sa chaîne", async () => {
    // Le co-caster sur un stream sans lien ; le compte effacé, seul sur le
    // stream qui porte le premier lien du match — donc principal.
    const w = world(
      [{ id: 3, live_url: null }, { id: 4, live_url: "https://kick.com/sa-chaine" }],
      [{ user_id: 9, stream_id: 3 }, { user_id: 12, stream_id: 4 }],
    );
    await withdrawUserCasts(w.connection, 12, true);
    expect(w.state.streams).toEqual([{ id: 3, live_url: null }]);
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
