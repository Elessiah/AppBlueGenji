import { describe, expect, it, jest } from "@jest/globals";
import {
  firstStreamUrlSql,
  hasOrganisationLink,
  loadCasterLinks,
  loadMatchStreams,
  lockMatchCasters,
  lockMatchStreams,
  orphanStreamIds,
  pruneMatchStreams,
  staffStream,
  streamUrlCandidatesSql,
  unmarkUncastMatches,
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
    expect(sql).toContain("fs.staff_owned = 1 OR ((m.status = 'COMPLETED'");
    // Lancé sur son appariement courant seulement, comme l'instantané (`castBeforeLaunch`).
    expect(sql).toContain("OR (m.launched_at IS NOT NULL AND m.launch_pairing = CONCAT(m.team1_id, ':', m.team2_id)))");
    expect(sql).toContain("EXISTS (SELECT 1 FROM bg_match_casters fc JOIN bg_users u ON u.id = fc.user_id");
    // La condition du cast, comme `castEligibilityBlock` : identité et permission `live`.
    expect(sql).toContain("COALESCE(u.is_deleted, 0) = 0");
    expect(sql).toContain("u.discord_verified_at IS NOT NULL AND COALESCE(u.discord_pseudo, '') <> ''");
    // Un BattleTag tapé sous un Battle.net qui n'en donnait aucun ne vaut pas (D3).
    expect(sql).toContain("((u.blizzard_sub IS NOT NULL AND u.overwatch_battletag_typed = 0) AND COALESCE(u.overwatch_battletag, '') <> '')");
    expect(sql).toContain(`AND ${LIVE_STAFF_SQL})`);
  });

  it("un match lancé ou joué ne donne pas le lien d'un stream orphelin (D25)", () => {
    const sql = firstStreamUrlSql("m").replace(/\s+/g, " ");
    expect(sql).toContain(
      "m.team2_id))) AND EXISTS (SELECT 1 FROM bg_match_casters oc WHERE oc.match_id = fs.match_id AND oc.stream_id = fs.id))",
    );
  });
});

describe("streamUrlCandidatesSql — tous les liens publics, même règle", () => {
  it("streamUrlCandidatesSql_sameRuleAsFirstLink_orderedStaffFirst", () => {
    const sql = streamUrlCandidatesSql("m").replace(/\s+/g, " ");
    const first = firstStreamUrlSql("m").replace(/\s+/g, " ");

    expect(sql).toContain("GROUP_CONCAT(fs.live_url ORDER BY fs.staff_owned DESC, fs.id SEPARATOR ' ')");
    expect(sql).not.toContain("LIMIT");
    // Même FROM … WHERE que le premier lien : aucun stream tu n'y entre.
    const where = first.slice(first.indexOf("FROM bg_match_streams"), first.indexOf(" ORDER BY"));
    expect(sql).toContain(where);
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
type WorldMatch = {
  id: number;
  tournament_id: number;
  status: string;
  referee_user_id: number | null;
  referee_ready_at: string | null;
  live_trigger_user_id?: number | null;
  live_trigger?: string | null;
};

const matchOf = (row: { match_id?: number }) => row.match_id ?? 42;
const flat = (sql: string) => sql.replace(/\s+/g, " ").trim();

type WorldState = { streams: WorldStream[]; casters: WorldCaster[]; matches: WorldMatch[]; locked: number[][] };

/** La lecture de départ de `withdrawUserCasts` (une `UNION ALL`), et le verrou de ses matchs. */
function readWithdrawRows(state: WorldState, sql: string, params: unknown[]): unknown[] | null {
  const userId = params[0];
  if (sql.startsWith("SELECT 'C' AS kind, c.match_id FROM bg_match_casters c JOIN bg_matches cm")) {
    const includeCompleted = params[1] === 1;
    const statusOf = (id: number) => state.matches.find((m) => m.id === id)?.status;
    return [
      [
        ...state.casters
          .filter((c) => c.user_id === userId && (includeCompleted || statusOf(matchOf(c)) !== "COMPLETED"))
          .map((c) => ({ kind: "C", match_id: matchOf(c) })),
        ...state.streams.filter((s) => s.link_user_id === userId).map((s) => ({ kind: "L", match_id: matchOf(s) })),
        ...state.matches.filter((m) => m.referee_user_id === userId).map((m) => ({ kind: "R", match_id: m.id })),
        ...state.matches.filter((m) => m.live_trigger_user_id === userId).map((m) => ({ kind: "T", match_id: m.id })),
      ],
    ];
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
  // Le BattleTag de cast d'un cast gardé (anonymisation) : la base n'en modélise
  // pas la valeur, l'instruction se lit dans `sqls()`.
  if (sql === "UPDATE bg_match_casters SET cast_battletag = NULL WHERE user_id = ? AND cast_battletag IS NOT NULL") {
    return [{ affectedRows: 1 }];
  }
  if (sql.startsWith("UPDATE bg_match_streams SET live_url = NULL, link_user_id = NULL WHERE link_user_id = ? AND match_id IN")) {
    const provided = state.streams.filter((s) => s.link_user_id === userId && ids.includes(matchOf(s)));
    for (const s of provided) Object.assign(s, { live_url: null, link_user_id: null });
    return [{ affectedRows: provided.length }];
  }
  // Le mode d'antenne qu'il avait posé n'est plus à lui (`live_trigger_user_id`).
  if (sql.startsWith("UPDATE bg_matches SET live_trigger_user_id = NULL WHERE live_trigger_user_id = ? AND id IN")) {
    const owned = state.matches.filter((m) => m.live_trigger_user_id === userId && ids.includes(m.id));
    for (const m of owned) m.live_trigger_user_id = null;
    return [{ affectedRows: owned.length }];
  }
  // Démarquage d'un match non joué resté sans stream (`unmarkUncastMatches`).
  if (sql.startsWith("UPDATE bg_matches m SET m.live_trigger = NULL")) {
    const unmarked = state.matches.filter(
      (m) =>
        params.includes(m.id) &&
        m.status !== "COMPLETED" &&
        (m.live_trigger ?? null) !== null &&
        !state.streams.some((st) => matchOf(st) === m.id),
    );
    for (const m of unmarked) Object.assign(m, { live_trigger: null, live_trigger_user_id: null });
    return [{ affectedRows: unmarked.length }];
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

describe("pruneMatchStreams — lectures déjà faites par l'appelant", () => {
  it("ne relit pas les casters fournis : un seul SELECT verrouillant (les streams)", async () => {
    const w = world([{ id: 3, live_url: null }, { id: 4, live_url: "https://kick.com/x" }], [
      { user_id: 9, stream_id: 3 },
      { user_id: 12, stream_id: 4 },
    ]);
    // 12 vient de partir : l'appelant passe les casters restants.
    await pruneMatchStreams(w.connection, 42, { casters: [{ streamId: 3 }] });
    expect(w.state.streams.map((s) => s.id)).toEqual([3]);
    expect(w.sqls().filter((sql) => sql.includes("FROM bg_match_casters"))).toEqual([]);
  });

  it("ne relit pas les streams fournis, et lit les casters sous verrou", async () => {
    const w = world([{ id: 3, live_url: null }], [{ user_id: 9, stream_id: 3 }]);
    await pruneMatchStreams(w.connection, 42, { streams: [stream(3, null), stream(8, null)] });
    expect(w.sqls().filter((sql) => sql.includes("FROM bg_match_streams") && sql.includes("SELECT"))).toEqual([]);
    expect(w.sqls().some((sql) => sql.includes("FROM bg_match_casters") && sql.endsWith("FOR UPDATE"))).toBe(true);
    // Le stream 8, que personne ne tient, est effacé.
    expect(w.execute.mock.calls.find(([sql]) => sql.startsWith("DELETE"))?.[1]).toEqual([42, 8]);
  });
});

describe("lockMatchCasters / lockMatchStreams — verrou du match déjà tenu", () => {
  it("held : lecture ordinaire, sans FOR UPDATE ; par défaut, lecture verrouillante", async () => {
    const execute = jest.fn<SqlQuery>(async () => [[]]);
    const connection = fakeConnection({ execute });
    await lockMatchCasters(connection, 42, true);
    await lockMatchStreams(connection, 42, true);
    await lockMatchCasters(connection, 42);
    await lockMatchStreams(connection, 42);
    const sqls = execute.mock.calls.map(([sql]) => flat(sql));
    expect(sqls.map((sql) => sql.endsWith("FOR UPDATE"))).toEqual([false, false, true, true]);
  });
});

describe("CAST_ELIGIBLE_SQL — aligné sur la règle JS (shownStreams / castEligibilityBlock)", () => {
  it("couvre les quatre conditions du cast : compte, tag Discord, Battle.net, permission live", () => {
    const sql = firstStreamUrlSql("m");
    for (const clause of ["is_deleted", "discord_verified_at", "discord_pseudo", "overwatch_battletag", LIVE_STAFF_SQL]) {
      expect(sql).toContain(clause);
    }
  });
});

describe("withdrawUserCasts — un compte qui part quitte ses casts", () => {
  it("verrouille le match, retire le compte, efface son stream à part et rend les matchs touchés", async () => {
    const w = world(
      [{ id: 3, live_url: "https://twitch.tv/match" }, { id: 4, live_url: "https://kick.com/sa-chaine" }],
      [{ user_id: 9, stream_id: 3 }, { user_id: 12, stream_id: 4 }],
    );
    expect(await withdrawUserCasts(w.connection, 12, true)).toMatchObject(touched42);
    expect(w.state.locked).toEqual([[42]]);
    expect(w.state.casters).toEqual([{ user_id: 9, stream_id: 3 }]);
    // Le lien de sa chaîne part avec lui ; le stream partagé reste.
    expect(w.state.streams).toEqual([{ id: 3, live_url: "https://twitch.tv/match" }]);
  });

  it("withdrawUserCasts_ownerOfUncastMatchTrigger_releasesOwnershipAndTouchesMatch", async () => {
    // Le mode du match 43, posé sans le caster (permission `live` seule).
    const other = { id: 43, tournament_id: 5, status: "READY", referee_user_id: null, referee_ready_at: null, live_trigger_user_id: 12 };
    const w = world([], [], false, [other]);

    const result = await withdrawUserCasts(w.connection, 12, true);

    expect(w.state.matches.find((m) => m.id === 43)?.live_trigger_user_id).toBeNull();
    expect(w.state.locked).toEqual([[43]]);
    expect(result).toMatchObject({ matchIds: [43], tournamentIds: [5] });
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
    expect(await withdrawUserCasts(w.connection, 12, false)).toMatchObject(untouched);
    expect(w.state.casters).toEqual([{ user_id: 12, stream_id: 4 }]);
    expect(w.sqls().some((sql) => sql.startsWith("DELETE"))).toBe(false);
  });

  it("withdrawUserCasts_keptCompletedCast_clearsCastBattletag", async () => {
    const w = world([{ id: 4, live_url: null }], [{ user_id: 12, stream_id: 4 }], true);
    await withdrawUserCasts(w.connection, 12, false);
    // Le cast reste sur le match joué, son BattleTag de cast part avec le compte.
    expect(w.state.casters).toEqual([{ user_id: 12, stream_id: 4 }]);
    expect(w.sqls()).toContain("UPDATE bg_match_casters SET cast_battletag = NULL WHERE user_id = ? AND cast_battletag IS NOT NULL");
  });

  it("withdrawUserCasts_erasure_noBattletagUpdate", async () => {
    // Effacement : toutes les inscriptions partent, il n'y a rien à vider.
    const w = world([{ id: 4, live_url: null }], [{ user_id: 12, stream_id: 4 }], true);
    await withdrawUserCasts(w.connection, 12, true);
    expect(w.sqls().some((sql) => sql.includes("cast_battletag"))).toBe(false);
  });

  it("withdrawUserCasts_anonymisationOfOpenCast_clearsBattletagWithoutStaleCount", async () => {
    // Le match était à jouer à la lecture de départ : l'effacement du BattleTag
    // de cast ne dépend plus d'un décompte lu avant les verrous.
    const w = world([{ id: 4, live_url: null }], [{ user_id: 12, stream_id: 4 }]);
    await withdrawUserCasts(w.connection, 12, false);
    expect(w.sqls()).toContain("UPDATE bg_match_casters SET cast_battletag = NULL WHERE user_id = ? AND cast_battletag IS NOT NULL");
  });

  it("withdrawUserCasts_anonymisation_doesNotLockCompletedCastOnly", async () => {
    // Un cast gardé sur un match joué n'est pas candidat : rien à verrouiller.
    const w = world([{ id: 4, live_url: null }], [{ user_id: 12, stream_id: 4 }], true);
    await withdrawUserCasts(w.connection, 12, false);
    expect(w.state.locked).toEqual([]);
    expect(w.execute.mock.calls[0][1]).toEqual([12, 0, 12, 12, 12]);
  });

  it("withdrawUserCasts_startLists_readInOneStatement", async () => {
    const w = world([], [{ user_id: 12, stream_id: 4 }]);
    await withdrawUserCasts(w.connection, 12, true);
    const first = w.sqls()[0];
    for (const kind of ["'C'", "'L'", "'R'", "'T'"]) expect(first).toContain(`${kind} AS kind`);
    expect(w.execute.mock.calls[0][1]).toEqual([12, 1, 12, 12, 12]);
  });

  it("effacement : le cast d'un match joué part aussi", async () => {
    const w = world([{ id: 4, live_url: null }], [{ user_id: 12, stream_id: 4 }], true);
    expect(await withdrawUserCasts(w.connection, 12, true)).toMatchObject(touched42);
    expect(w.state.casters).toEqual([]);
    expect(w.state.streams).toEqual([]);
  });

  it("ne touche à rien pour un compte qui ne caste rien et n'a fourni aucun lien", async () => {
    const w = world([{ id: 3, live_url: "https://twitch.tv/autre", link_user_id: 9 }], [{ user_id: 9, stream_id: 3 }]);
    expect(await withdrawUserCasts(w.connection, 12, true)).toMatchObject(untouched);
    // Une seule lecture (casts, liens, arbitrages, modes d'antenne), rien d'autre.
    expect(w.execute).toHaveBeenCalledTimes(1);
  });
});

describe("withdrawUserCasts — le lien qu'un compte a fourni part avec lui", () => {
  it("effacement : son stream à part, qu'il tenait seul, part avec son lien", async () => {
    const w = world(
      [{ id: 3, live_url: null }, { id: 4, live_url: "https://kick.com/sa-chaine", link_user_id: 12 }],
      [{ user_id: 9, stream_id: 3 }, { user_id: 12, stream_id: 4 }],
    );
    expect(await withdrawUserCasts(w.connection, 12, true)).toMatchObject(touched42);
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
    expect(await withdrawUserCasts(w.connection, 12, true)).toMatchObject(touched42);
    expect(w.state.locked).toEqual([[42]]);
    expect(w.state.streams).toEqual([{ id: 4, live_url: null, link_user_id: null }]);
    // Aucune inscription à retirer : le co-caster garde la sienne.
    expect(w.execute.mock.calls.some(([sql]) => sql.startsWith("DELETE FROM bg_match_casters"))).toBe(false);
    expect(w.state.casters).toEqual([{ user_id: 9, stream_id: 4 }]);
  });

  it("anonymisation d'un match joué : il reste inscrit, son lien part quand même", async () => {
    const w = world([{ id: 4, live_url: "https://kick.com/sa-chaine", link_user_id: 12 }], [{ user_id: 12, stream_id: 4 }], true);
    expect(await withdrawUserCasts(w.connection, 12, false)).toMatchObject(touched42);
    expect(w.state.casters).toEqual([{ user_id: 12, stream_id: 4 }]);
    expect(w.state.streams).toEqual([{ id: 4, live_url: null, link_user_id: null }]);
  });

  it("le lien de l'organisation n'est jamais touché, même sur un stream qu'il tenait", async () => {
    const staff = { id: 3, live_url: "https://twitch.tv/bluegenji", staff_owned: 1, link_user_id: null };
    const w = world([staff], [{ user_id: 12, stream_id: 3 }]);
    await withdrawUserCasts(w.connection, 12, true);
    expect(w.state.streams).toEqual([staff]);
    const sqls = w.execute.mock.calls.map(([sql]) => sql.replace(/\s+/g, " ").trim());
    // Les liens fournis se lisent par `link_user_id`, dans la lecture de départ unique.
    expect(sqls[0]).toContain("UNION ALL SELECT 'L' AS kind, match_id FROM bg_match_streams WHERE link_user_id = ?");
    expect(sqls.some((sql) => sql.startsWith("UPDATE bg_match_streams"))).toBe(false);
  });

  it("le lien qu'un caster (permission `live` seule) a posé dans la configuration du direct part aussi", async () => {
    // Stream du match, lien rattaché au caster : retiré ; sans caster, le stream part.
    const w = world([{ id: 3, live_url: "https://twitch.tv/sa-chaine", staff_owned: 1, link_user_id: 12 }], []);
    expect(await withdrawUserCasts(w.connection, 12, true)).toMatchObject(touched42);
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
      expect(await withdrawUserCasts(w.connection, 5, includeCompleted)).toMatchObject(touched42);
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
    expect(await withdrawUserCasts(w.connection, 12, true)).toMatchObject({ matchIds: [7, 42], tournamentIds: [2] });
    expect(w.state.locked).toEqual([[7, 42]]);
    expect(w.sqls().filter((sql) => sql.startsWith("DELETE FROM bg_match_casters"))).toEqual([
      "DELETE FROM bg_match_casters WHERE user_id = ? AND match_id IN (?, ?)",
    ]);
    expect(w.state.casters.map((c) => c.user_id)).toEqual([9, 9]);
  });

  it("rend chaque tournoi touché une seule fois, dans l'ordre croissant", async () => {
    const w = world([], [{ user_id: 12, stream_id: 3, match_id: 42 }], false, [other(7, 9, 12), other(8, 9, 12)]);
    expect(await withdrawUserCasts(w.connection, 12, true)).toMatchObject({ matchIds: [7, 8, 42], tournamentIds: [2, 9] });
  });

  it("arbitre désigné : retiré avec son « Prêt », sans ménage des streams", async () => {
    const w = world([{ id: 3, live_url: null }], [{ user_id: 9, stream_id: 3 }], false, [other(7, 5, 12)]);
    expect(await withdrawUserCasts(w.connection, 12, false)).toMatchObject({ matchIds: [7], tournamentIds: [5] });
    expect(w.state.matches.find((m) => m.id === 7)).toMatchObject({ referee_user_id: null, referee_ready_at: null });
    expect(w.sqls().some((sql) => sql.includes("FROM bg_match_streams WHERE match_id IN"))).toBe(false);
  });

  it("rend à part les arbitrages et casts retirés de matchs non joués", async () => {
    const w = world([{ id: 3, live_url: null }], [{ user_id: 12, stream_id: 3 }], false, [
      other(7, 5, 12),
      { ...other(8, 5, 12), status: "COMPLETED" },
    ]);
    const result = await withdrawUserCasts(w.connection, 12, false);
    expect(result.releasedRefereeMatchIds).toEqual([7]);
    expect(result.releasedCastMatchIds).toEqual([42]);
  });

  it("withdrawUserCasts_completedAndOpenMatchesTouched_liveTournamentIdsKeepOnlyOpenOnes", async () => {
    const w = world([], [], false, [other(7, 5, 12), { ...other(8, 6, 12), status: "COMPLETED" }]);

    const result = await withdrawUserCasts(w.connection, 12, false);

    expect(result.tournamentIds).toEqual([5, 6]);
    expect(result.liveTournamentIds).toEqual([5]);
  });

  it("sans rien à retirer, les listes de matchs relâchés sont vides", async () => {
    const w = world([], [], false, []);
    expect(await withdrawUserCasts(w.connection, 12, false)).toEqual({
      matchIds: [],
      tournamentIds: [],
      liveTournamentIds: [],
      releasedRefereeMatchIds: [],
      releasedCastMatchIds: [],
    });
  });

  it("l'arbitrage d'un match joué part aussi à l'anonymisation", async () => {
    const w = world([], [], false, [{ ...other(7, 5, 12), status: "COMPLETED" }]);
    expect(await withdrawUserCasts(w.connection, 12, false)).toMatchObject({ matchIds: [7], tournamentIds: [5] });
    expect(w.state.matches.find((m) => m.id === 7)?.referee_user_id).toBeNull();
  });
});

describe("parseCastTarget — corps de POST /api/matches/[id]/caster", () => {
  it("rejoindre un stream, ou ouvrir le sien avec le lien de sa chaîne", () => {
    expect(parseCastTarget({ streamId: 3 })).toEqual({ streamId: 3 });
    expect(parseCastTarget({ liveUrl: "twitch.tv/x" })).toEqual({ liveUrl: "twitch.tv/x" });
    // Aucune cible : le lien d'un stream propre est obligatoire
    // (`docs/features/CAST_SETTINGS.md`), un corps vide ne choisit rien.
    expect(parseCastTarget({ liveUrl: null })).toBeNull();
    expect(parseCastTarget({})).toBeNull();
    expect(parseCastTarget(null)).toBeNull();
  });

  it("refuse les deux à la fois, un identifiant mal formé et un lien qui n'est pas du texte", () => {
    expect(parseCastTarget({ streamId: 3, liveUrl: "twitch.tv/x" })).toBeNull();
    for (const streamId of ["3", 0, -1, 1.5, null]) expect(parseCastTarget({ streamId })).toBeNull();
    expect(parseCastTarget({ liveUrl: 12 })).toBeNull();
  });
});

describe("lien de l'organisation — décision du 2026-11-10", () => {
  it("hasOrganisationLink_staffStreamWithoutProvider_true", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ 1: 1 }], []]);

    await expect(hasOrganisationLink(fakeConnection({ execute }), 42)).resolves.toBe(true);

    const [sql, params] = execute.mock.calls[0];
    // Seul le stream du staff à lien, case cochée (sans auteur) : ni la chaîne d'un membre, ni un stream de caster.
    expect(String(sql).replace(/\s+/g, " ")).toContain("staff_owned = 1 AND live_url IS NOT NULL AND link_user_id IS NULL");
    expect(params).toEqual([42]);
  });

  it("hasOrganisationLink_noRow_false", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], []]);

    await expect(hasOrganisationLink(fakeConnection({ execute }), 42)).resolves.toBe(false);
  });

  it("loadMatchStreams_staffStreamWithoutProvider_flagsOrganisation", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([
      [
        { id: 1, match_id: 42, live_url: "https://twitch.tv/orga", staff_owned: 1, link_user_id: null },
        { id: 2, match_id: 42, live_url: "https://twitch.tv/staff5", staff_owned: 1, link_user_id: 5 },
        { id: 3, match_id: 42, live_url: "https://twitch.tv/ancien", staff_owned: 0, link_user_id: null },
      ],
      [],
    ]);

    const streams = (await loadMatchStreams(fakeConnection({ execute }), [42])).get(42);

    expect(streams?.map((row) => row.organisation)).toEqual([true, false, false]);
  });
});

describe("withdrawUserCasts — démarquage d'un match resté sans stream (#296)", () => {
  const marked = (status = "READY") => ({
    id: 42,
    tournament_id: 2,
    status,
    referee_user_id: null,
    referee_ready_at: null,
    live_trigger: "AUTO",
    live_trigger_user_id: 12,
  });

  function markedWorld(streams: WorldStream[], casters: WorldCaster[], status = "READY") {
    const w = world(streams, casters);
    w.state.matches = [marked(status)];
    return w;
  }

  it("withdrawUserCasts_lastStreamGone_unmarksOpenMatch", async () => {
    const w = markedWorld([{ id: 4, live_url: "https://kick.com/sa-chaine", link_user_id: 12 }], [{ user_id: 12, stream_id: 4 }]);
    await withdrawUserCasts(w.connection, 12, true);
    expect(w.state.streams).toEqual([]);
    expect(w.state.matches[0]).toMatchObject({ live_trigger: null, live_trigger_user_id: null });
  });

  it("withdrawUserCasts_coCasterKeepsStream_matchStaysMarked", async () => {
    const w = markedWorld(
      [{ id: 4, live_url: "https://kick.com/sa-chaine", link_user_id: 12 }],
      [{ user_id: 12, stream_id: 4 }, { user_id: 9, stream_id: 4 }],
    );
    await withdrawUserCasts(w.connection, 12, true);
    expect(w.state.matches[0].live_trigger).toBe("AUTO");
  });

  it("withdrawUserCasts_staffLinkRemains_matchStaysMarked", async () => {
    const w = markedWorld(
      [{ id: 3, live_url: "https://twitch.tv/bluegenji", staff_owned: 1, link_user_id: null }],
      [{ user_id: 12, stream_id: 3 }],
    );
    await withdrawUserCasts(w.connection, 12, true);
    expect(w.state.matches[0].live_trigger).toBe("AUTO");
  });

  it("withdrawUserCasts_completedMatch_neverUnmarked", async () => {
    const w = markedWorld([{ id: 4, live_url: "https://kick.com/sa-chaine", link_user_id: 12 }], [{ user_id: 12, stream_id: 4 }], "COMPLETED");
    await withdrawUserCasts(w.connection, 12, true);
    expect(w.state.matches[0].live_trigger).toBe("AUTO");
    const unmark = w.sqls().find((sql) => sql.startsWith("UPDATE bg_matches m SET m.live_trigger = NULL"));
    expect(unmark).toContain("m.status <> 'COMPLETED'");
    expect(unmark).toContain("NOT EXISTS (SELECT 1 FROM bg_match_streams us WHERE us.match_id = m.id)");
  });
});

describe("unmarkUncastMatches — un seul UPDATE, rien sans match", () => {
  it("unmarkUncastMatches_noIds_noQuery", async () => {
    const execute = jest.fn<SqlQuery>(async () => [{ affectedRows: 0 }]);
    expect(await unmarkUncastMatches(fakeConnection({ execute }), [])).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it("unmarkUncastMatches_returnsAffectedRows", async () => {
    const execute = jest.fn<SqlQuery>(async () => [{ affectedRows: 2 }]);
    expect(await unmarkUncastMatches(fakeConnection({ execute }), [4, 7])).toBe(2);
    expect(execute.mock.calls[0][1]).toEqual([4, 7]);
  });
});

describe("loadCasterLinks — BattleTag de cast lu sur demande", () => {
  it("loadCasterLinks_default_omitsCastBattletag", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ match_id: 42, user_id: 7, stream_id: 3, ready_at: null }], []]);

    const links = await loadCasterLinks(fakeConnection({ execute }), [42]);

    expect(String(execute.mock.calls[0][0])).not.toContain("cast_battletag");
    expect(links.get(42)?.[0]).not.toHaveProperty("castBattletag");
  });

  it("loadCasterLinks_battletagRequested_readsCastBattletag", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValue([[{ match_id: 42, user_id: 7, stream_id: 3, ready_at: null, cast_battletag: "Voix#1234" }], []]);

    const links = await loadCasterLinks(fakeConnection({ execute }), [42], { battletag: true });

    expect(String(execute.mock.calls[0][0])).toContain("ready_at, cast_battletag FROM bg_match_casters");
    expect(links.get(42)?.[0].castBattletag).toBe("Voix#1234");
  });
});
