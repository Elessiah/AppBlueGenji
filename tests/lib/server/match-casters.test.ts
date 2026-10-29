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
  it("prend le lien du staff, à défaut le plus petit stream qui a un lien, sur l'alias donné", () => {
    const sql = firstStreamUrlSql("m").replace(/\s+/g, " ");
    expect(sql.startsWith("(SELECT fs.live_url FROM bg_match_streams fs WHERE fs.match_id = m.id AND fs.live_url IS NOT NULL")).toBe(true);
    // Un lien de caster ouvert avant celui du staff ne passe pas devant lui :
    // l'annonce #live et l'accueil gardent la chaîne choisie par le staff.
    expect(sql.endsWith("ORDER BY fs.staff_owned DESC, fs.id LIMIT 1)")).toBe(true);
  });

  it("écarte le stream d'un caster qui ne remplit plus la condition, sauf stream du staff ou match lancé/joué", () => {
    const sql = firstStreamUrlSql("m").replace(/\s+/g, " ");
    expect(sql).toContain("fs.staff_owned = 1 OR m.status = 'COMPLETED' OR m.launched_at IS NOT NULL");
    expect(sql).toContain("EXISTS (SELECT 1 FROM bg_match_casters fc JOIN bg_users u ON u.id = fc.user_id");
    // La condition du cast, comme `castEligibilityBlock` : identité et permission `live`.
    expect(sql).toContain("COALESCE(u.is_deleted, 0) = 0");
    expect(sql).toContain("u.discord_verified_at IS NOT NULL AND COALESCE(u.discord_pseudo, '') <> ''");
    // Un BattleTag tapé sous un Battle.net qui n'en donnait aucun ne vaut pas (D3).
    expect(sql).toContain("((u.blizzard_sub IS NOT NULL AND u.overwatch_battletag_typed = 0) AND COALESCE(u.overwatch_battletag, '') <> '')");
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

type WorldStream = { id: number; live_url: string | null; staff_owned?: number; link_user_id?: number | null; match_id?: number };
type WorldCaster = { user_id: number; stream_id: number; match_id?: number };
type WorldMatch = { id: number; tournament_id: number; status: string; referee_user_id: number | null; referee_ready_at: string | null };

const matchOf = (row: { match_id?: number }) => row.match_id ?? 42;
const flat = (sql: string) => sql.replace(/\s+/g, " ").trim();

type WorldState = { streams: WorldStream[]; casters: WorldCaster[]; matches: WorldMatch[]; locked: number[][] };

/** Les trois lectures de départ de `withdrawUserCasts`, et le verrou de ses matchs. */
function readWithdrawRows(state: WorldState, sql: string, params: unknown[]): unknown[] | null {
  const userId = params[0];
  if (sql === "SELECT match_id FROM bg_match_casters WHERE user_id = ? ORDER BY match_id") {
    return [state.casters.filter((c) => c.user_id === userId).map((c) => ({ match_id: matchOf(c) }))];
  }
  if (sql === "SELECT DISTINCT match_id FROM bg_match_streams WHERE link_user_id = ? ORDER BY match_id") {
    return [[...new Set(state.streams.filter((s) => s.link_user_id === userId).map(matchOf))].map((id) => ({ match_id: id }))];
  }
  if (sql === "SELECT id AS match_id FROM bg_matches WHERE referee_user_id = ? ORDER BY id") {
    return [state.matches.filter((m) => m.referee_user_id === userId).map((m) => ({ match_id: m.id }))];
  }
  if (sql.startsWith("SELECT id, tournament_id, status FROM bg_matches WHERE id IN")) {
    state.locked.push(params as number[]);
    return [state.matches.filter((m) => params.includes(m.id)).sort((x, y) => x.id - y.id)];
  }
  return null;
}

/** Les écritures groupées de `withdrawUserCasts` : casts, liens, arbitrages. */
function applyWithdrawWrites(state: WorldState, sql: string, params: unknown[]): unknown[] | null {
  const [userId, ...ids] = params;
  if (sql.startsWith("DELETE FROM bg_match_casters WHERE user_id = ? AND match_id IN")) {
    state.casters = state.casters.filter((c) => !(c.user_id === userId && ids.includes(matchOf(c))));
    return [{ affectedRows: 1 }];
  }
  if (sql.startsWith("UPDATE bg_match_streams SET live_url = NULL, link_user_id = NULL WHERE link_user_id = ? AND match_id IN")) {
    const provided = state.streams.filter((s) => s.link_user_id === userId && ids.includes(matchOf(s)));
    for (const s of provided) Object.assign(s, { live_url: null, link_user_id: null });
    return [{ affectedRows: provided.length }];
  }
  if (sql.startsWith("UPDATE bg_matches SET referee_user_id = NULL, referee_ready_at = NULL WHERE referee_user_id = ? AND id IN")) {
    const refereed = state.matches.filter((m) => m.referee_user_id === userId && ids.includes(m.id));
    for (const m of refereed) Object.assign(m, { referee_user_id: null, referee_ready_at: null });
    return [{ affectedRows: refereed.length }];
  }
  return null;
}

/** Le ménage sous verrou (`pruneMatchStreams`, et sa version groupée). */
function applyPruneSql(state: WorldState, sql: string, params: unknown[]): unknown[] | null {
  if (sql.startsWith("SELECT id, match_id, live_url, staff_owned FROM bg_match_streams")) {
    return [state.streams.filter((s) => params.includes(matchOf(s))).map((s) => ({ staff_owned: 0, ...s, match_id: matchOf(s) }))];
  }
  if (sql.startsWith("SELECT match_id, user_id, stream_id, ready_at FROM bg_match_casters")) {
    return [state.casters.filter((c) => params.includes(matchOf(c))).map((c) => ({ ...c, match_id: matchOf(c), ready_at: null }))];
  }
  if (sql.startsWith("DELETE FROM bg_match_streams")) {
    const doomed = sql.startsWith("DELETE FROM bg_match_streams WHERE match_id = ?") ? params.slice(1) : params;
    state.streams = state.streams.filter((s) => !doomed.includes(s.id));
    return [{ affectedRows: doomed.length }];
  }
  return null;
}

/**
 * Base à état : streams, casters et matchs (42 par défaut, tournoi 2), rejoués
 * par `pruneMatchStreams` et `withdrawUserCasts`. `completed` : le match 42 est
 * joué. `extraMatches` : d'autres matchs, pour un compte présent sur plusieurs.
 */
function world(streams: WorldStream[], casters: WorldCaster[], completed = false, extraMatches: WorldMatch[] = []) {
  const state: WorldState = {
    streams: [...streams],
    casters: [...casters],
    matches: [
      { id: 42, tournament_id: 2, status: completed ? "COMPLETED" : "READY", referee_user_id: null, referee_ready_at: null },
      ...extraMatches,
    ],
    locked: [],
  };
  const execute = jest.fn<SqlQuery>(async (rawSql, rawParams) => {
    const sql = flat(rawSql);
    const params = (rawParams ?? []) as unknown[];
    const result = readWithdrawRows(state, sql, params) ?? applyWithdrawWrites(state, sql, params) ?? applyPruneSql(state, sql, params);
    if (result) return result;
    throw new Error(`requête inattendue : ${sql}`);
  });
  return { state, execute, connection: fakeConnection({ execute }), sqls: () => execute.mock.calls.map(([sql]) => flat(sql)) };
}

const touched42 = { matchIds: [42], tournamentIds: [2] };
const untouched = { matchIds: [], tournamentIds: [] };

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
    expect(await withdrawUserCasts(w.connection, 12, true)).toEqual(touched42);
    expect(w.state.locked).toEqual([[42]]);
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

  it("anonymisation : un cast sur un match joué reste, et le match n'est pas rendu comme touché", async () => {
    const w = world([{ id: 4, live_url: null }], [{ user_id: 12, stream_id: 4 }], true);
    expect(await withdrawUserCasts(w.connection, 12, false)).toEqual(untouched);
    expect(w.state.casters).toEqual([{ user_id: 12, stream_id: 4 }]);
    expect(w.sqls().some((sql) => sql.startsWith("DELETE"))).toBe(false);
  });

  it("effacement : le cast d'un match joué part aussi", async () => {
    const w = world([{ id: 4, live_url: null }], [{ user_id: 12, stream_id: 4 }], true);
    expect(await withdrawUserCasts(w.connection, 12, true)).toEqual(touched42);
    expect(w.state.casters).toEqual([]);
    expect(w.state.streams).toEqual([]);
  });

  it("ne touche à rien pour un compte qui ne caste rien et n'a fourni aucun lien", async () => {
    const w = world([{ id: 3, live_url: "https://twitch.tv/autre", link_user_id: 9 }], [{ user_id: 9, stream_id: 3 }]);
    expect(await withdrawUserCasts(w.connection, 12, true)).toEqual(untouched);
    // Les trois lectures (casts, liens, arbitrages), rien d'autre.
    expect(w.execute).toHaveBeenCalledTimes(3);
  });
});

describe("withdrawUserCasts — le lien qu'un compte a fourni part avec lui", () => {
  it("effacement : son stream à part, qu'il tenait seul, part avec son lien", async () => {
    const w = world(
      [{ id: 3, live_url: null }, { id: 4, live_url: "https://kick.com/sa-chaine", link_user_id: 12 }],
      [{ user_id: 9, stream_id: 3 }, { user_id: 12, stream_id: 4 }],
    );
    expect(await withdrawUserCasts(w.connection, 12, true)).toEqual(touched42);
    expect(w.state.streams).toEqual([{ id: 3, live_url: null }]);
  });

  it("co-cast : le stream reste au co-caster, sans le lien de la chaîne du compte effacé", async () => {
    const w = world(
      [{ id: 4, live_url: "https://kick.com/sa-chaine", link_user_id: 12 }],
      [{ user_id: 12, stream_id: 4 }, { user_id: 9, stream_id: 4 }],
    );
    await withdrawUserCasts(w.connection, 12, true);
    expect(w.state.casters).toEqual([{ user_id: 9, stream_id: 4 }]);
    expect(w.state.streams).toEqual([{ id: 4, live_url: null, link_user_id: null }]);
  });

  it("co-cast : retiré aussi quand il avait déjà quitté le stream qu'il avait ouvert", async () => {
    const w = world([{ id: 4, live_url: "https://kick.com/sa-chaine", link_user_id: 12 }], [{ user_id: 9, stream_id: 4 }]);
    expect(await withdrawUserCasts(w.connection, 12, true)).toEqual(touched42);
    expect(w.state.locked).toEqual([[42]]);
    expect(w.state.streams).toEqual([{ id: 4, live_url: null, link_user_id: null }]);
    // Aucune inscription à retirer : le co-caster garde la sienne.
    expect(w.execute.mock.calls.some(([sql]) => sql.startsWith("DELETE FROM bg_match_casters"))).toBe(false);
    expect(w.state.casters).toEqual([{ user_id: 9, stream_id: 4 }]);
  });

  it("anonymisation d'un match joué : il reste inscrit, son lien part quand même", async () => {
    const w = world([{ id: 4, live_url: "https://kick.com/sa-chaine", link_user_id: 12 }], [{ user_id: 12, stream_id: 4 }], true);
    expect(await withdrawUserCasts(w.connection, 12, false)).toEqual(touched42);
    expect(w.state.casters).toEqual([{ user_id: 12, stream_id: 4 }]);
    expect(w.state.streams).toEqual([{ id: 4, live_url: null, link_user_id: null }]);
  });

  it("le lien de l'organisation n'est jamais touché, même sur un stream qu'il tenait", async () => {
    const staff = { id: 3, live_url: "https://twitch.tv/bluegenji", staff_owned: 1, link_user_id: null };
    const w = world([staff], [{ user_id: 12, stream_id: 3 }]);
    await withdrawUserCasts(w.connection, 12, true);
    expect(w.state.streams).toEqual([staff]);
    const sqls = w.execute.mock.calls.map(([sql]) => sql.replace(/\s+/g, " ").trim());
    expect(sqls[1]).toBe("SELECT DISTINCT match_id FROM bg_match_streams WHERE link_user_id = ? ORDER BY match_id");
    expect(sqls.some((sql) => sql.startsWith("UPDATE bg_match_streams"))).toBe(false);
  });

  it("le lien qu'un caster (permission `live` seule) a posé dans la configuration du direct part aussi", async () => {
    // Stream du match, lien rattaché au caster : retiré ; sans caster, le stream part.
    const w = world([{ id: 3, live_url: "https://twitch.tv/sa-chaine", staff_owned: 1, link_user_id: 12 }], []);
    expect(await withdrawUserCasts(w.connection, 12, true)).toEqual(touched42);
    expect(w.state.streams).toEqual([]);
    // Tenu par un autre caster : le stream reste, sans lien.
    const held = world([{ id: 3, live_url: "https://twitch.tv/sa-chaine", staff_owned: 1, link_user_id: 12 }], [{ user_id: 9, stream_id: 3 }]);
    await withdrawUserCasts(held.connection, 12, true);
    expect(held.state.streams).toEqual([{ id: 3, live_url: null, staff_owned: 1, link_user_id: null }]);
  });

  it("la chaîne qu'un membre de l'organisation a posée en castant le match part avec son compte, effacé ou anonymisé", async () => {
    // L'arbitre 5 caste le match et y a posé sa chaîne par la configuration du
    // direct (`setMatchLiveConfig` l'a rattachée à lui) ; le caster 9 le tient aussi.
    const adminLink = () => ({ id: 3, live_url: "https://twitch.tv/arbitre", staff_owned: 1, link_user_id: 5 });
    for (const includeCompleted of [true, false]) {
      const w = world([adminLink()], [{ user_id: 5, stream_id: 3 }, { user_id: 9, stream_id: 3 }]);
      expect(await withdrawUserCasts(w.connection, 5, includeCompleted)).toEqual(touched42);
      expect(w.state.streams).toEqual([{ id: 3, live_url: null, staff_owned: 1, link_user_id: null }]);
      expect(w.state.casters).toEqual([{ user_id: 9, stream_id: 3 }]);
    }
    // Seul à le tenir : le stream part avec son lien.
    const alone = world([adminLink()], [{ user_id: 5, stream_id: 3 }]);
    await withdrawUserCasts(alone.connection, 5, true);
    expect(alone.state.streams).toEqual([]);
  });

  it("efface sous le verrou du match, sans lire sa table en sous-requête, le seul stream de caster du compte", async () => {
    const w = world([{ id: 4, live_url: "https://kick.com/sa-chaine", link_user_id: 12 }], [{ user_id: 9, stream_id: 4 }]);
    await withdrawUserCasts(w.connection, 12, true);
    const sqls = w.sqls();
    const lock = sqls.indexOf("SELECT id, tournament_id, status FROM bg_matches WHERE id IN (?) ORDER BY id FOR UPDATE");
    const update = sqls.findIndex((sql) => sql.startsWith("UPDATE bg_match_streams"));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(update).toBeGreaterThan(lock);
    expect(sqls[update]).toBe(
      "UPDATE bg_match_streams SET live_url = NULL, link_user_id = NULL WHERE link_user_id = ? AND match_id IN (?)",
    );
    expect(w.execute.mock.calls[update][1]).toEqual([12, 42]);
  });
});

describe("withdrawUserCasts — plusieurs matchs, arbitrages", () => {
  const other = (id: number, tournamentId: number, refereeUserId: number | null = null): WorldMatch => ({
    id,
    tournament_id: tournamentId,
    status: "READY",
    referee_user_id: refereeUserId,
    referee_ready_at: refereeUserId === null ? null : "2026-10-29T18:00:00.000Z",
  });

  it("verrouille tous ses matchs en une instruction triée et les retire d'un seul DELETE", async () => {
    const w = world(
      [{ id: 3, live_url: null, match_id: 42 }, { id: 8, live_url: null, match_id: 7 }],
      [
        { user_id: 12, stream_id: 3, match_id: 42 },
        { user_id: 9, stream_id: 3, match_id: 42 },
        { user_id: 12, stream_id: 8, match_id: 7 },
        { user_id: 9, stream_id: 8, match_id: 7 },
      ],
      false,
      [other(7, 2)],
    );
    expect(await withdrawUserCasts(w.connection, 12, true)).toEqual({ matchIds: [7, 42], tournamentIds: [2] });
    expect(w.state.locked).toEqual([[7, 42]]);
    expect(w.sqls().filter((sql) => sql.startsWith("DELETE FROM bg_match_casters"))).toEqual([
      "DELETE FROM bg_match_casters WHERE user_id = ? AND match_id IN (?, ?)",
    ]);
    expect(w.state.casters.map((c) => c.user_id)).toEqual([9, 9]);
  });

  it("rend chaque tournoi touché une seule fois, dans l'ordre croissant", async () => {
    const w = world([], [{ user_id: 12, stream_id: 3, match_id: 42 }], false, [other(7, 9, 12), other(8, 9, 12)]);
    expect(await withdrawUserCasts(w.connection, 12, true)).toEqual({ matchIds: [7, 8, 42], tournamentIds: [2, 9] });
  });

  it("arbitre désigné : retiré avec son « Prêt », sans ménage des streams", async () => {
    const w = world([{ id: 3, live_url: null }], [{ user_id: 9, stream_id: 3 }], false, [other(7, 5, 12)]);
    expect(await withdrawUserCasts(w.connection, 12, false)).toEqual({ matchIds: [7], tournamentIds: [5] });
    expect(w.state.matches.find((m) => m.id === 7)).toMatchObject({ referee_user_id: null, referee_ready_at: null });
    expect(w.sqls().some((sql) => sql.includes("FROM bg_match_streams WHERE match_id IN"))).toBe(false);
  });

  it("l'arbitrage d'un match joué part aussi à l'anonymisation", async () => {
    const w = world([], [], false, [{ ...other(7, 5, 12), status: "COMPLETED" }]);
    expect(await withdrawUserCasts(w.connection, 12, false)).toEqual({ matchIds: [7], tournamentIds: [5] });
    expect(w.state.matches.find((m) => m.id === 7)?.referee_user_id).toBeNull();
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
