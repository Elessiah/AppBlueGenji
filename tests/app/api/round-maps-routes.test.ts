import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/round-maps-notice");
jest.mock("@/lib/server/tournaments/round-maps", () => {
  const actual = jest.requireActual<typeof import("@/lib/server/tournaments/round-maps")>(
    "@/lib/server/tournaments/round-maps",
  );
  return {
    parseRoundKey: actual.parseRoundKey,
    parseRoundKeys: actual.parseRoundKeys,
    parseMapRulesInput: actual.parseMapRulesInput,
    setRoundsMaps: jest.fn(),
    setTournamentMapRules: jest.fn(),
    pickMatchMap: jest.fn(),
  };
});

import { POST as flushPost } from "@/app/api/admin/tournaments/[id]/round-maps/flush/route";
import { flushRoundMapsNotice } from "@/lib/server/tournaments/round-maps-notice";
import { PUT as roundMapsPut } from "@/app/api/admin/tournaments/[id]/round-maps/route";
import { PUT as mapRulesPut } from "@/app/api/admin/tournaments/[id]/map-rules/route";
import { PUT as mapPickPut } from "@/app/api/matches/[matchId]/map-pick/route";
import { MAP_PICK_WRITE_RULE } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { pickMatchMap, setRoundsMaps, setTournamentMapRules, type MapRulesInput } from "@/lib/server/tournaments/round-maps";
import { authUser } from "../../helpers/auth-user";

/**
 * Routes des cartes par manche (`docs/features/ROUND_MAPS.md`) : réglage de la
 * manche et des règles de ban par le staff (`tournaments`), choix dans un pool.
 */

const player = authUser({ id: 2, roles: [] });
const caster = authUser({ id: 4, roles: ["CASTER"] });
const arbitre = authUser({ id: 3, roles: ["ARBITRE"] });

const tournament = (id: string) => ({ params: Promise.resolve({ id }) });
const match = (matchId: string) => ({ params: Promise.resolve({ matchId }) });

function put(body: unknown) {
  return new Request("http://localhost/api/x", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ROUND = { phaseId: 0, bracket: "UPPER", roundNumber: 2 };
const RULES = { firstBan: "NON_HOST", nextBan: "LOSER", nextPick: "LOSER" };

beforeEach(() => {
  jest.clearAllMocks();
});

describe("PUT /api/admin/tournaments/[id]/round-maps", () => {
  it("rejette un visiteur anonyme (401)", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await roundMapsPut(put({ ...ROUND, slots: [] }), tournament("7"))).status).toBe(401);
  });

  it("refuse sans la permission `tournaments`, caster compris (403)", async () => {
    for (const user of [player, caster]) {
      jest.mocked(getCurrentUser).mockResolvedValue(user);
      expect((await roundMapsPut(put({ ...ROUND, slots: [] }), tournament("7"))).status).toBe(403);
    }
    expect(setRoundsMaps).not.toHaveBeenCalled();
  });

  it("refuse une manche invalide (400 INVALID_ROUND)", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    for (const round of [{ ...ROUND, bracket: "SIDE" }, { ...ROUND, roundNumber: 0 }, { ...ROUND, phaseId: -1 }]) {
      const res = await roundMapsPut(put({ ...round, slots: [] }), tournament("7"));
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: "INVALID_ROUND" });
    }
    expect(setRoundsMaps).not.toHaveBeenCalled();
  });

  it("refuse des cartes invalides (400) et un tournoi absent (404)", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setRoundsMaps).mockRejectedValueOnce(new Error("INVALID_ROUND_MAPS"));
    expect((await roundMapsPut(put({ ...ROUND, slots: "x" }), tournament("7"))).status).toBe(400);
    jest.mocked(setRoundsMaps).mockRejectedValueOnce(new Error("TOURNAMENT_NOT_FOUND"));
    expect((await roundMapsPut(put({ ...ROUND, slots: [] }), tournament("7"))).status).toBe(404);
  });

  it("pose les cartes de la manche et rend les créneaux retenus", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setRoundsMaps).mockResolvedValue([["Ilios"]]);
    const res = await roundMapsPut(put({ ...ROUND, slots: [[" Ilios "]] }), tournament("7"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ slots: [["Ilios"]] });
    expect(setRoundsMaps).toHaveBeenCalledWith(7, [ROUND], [[" Ilios "]]);
  });
  it("PUT_roundsList_appliesSlotsToEveryRound", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setRoundsMaps).mockResolvedValue([["Ilios"]]);
    const rounds = [ROUND, { ...ROUND, roundNumber: 3 }];
    const res = await roundMapsPut(put({ rounds, slots: [["Ilios"]] }), tournament("7"));
    expect(res.status).toBe(200);
    expect(setRoundsMaps).toHaveBeenCalledWith(7, rounds, [["Ilios"]]);
  });

  it("PUT_invalidRoundsList_returns400InvalidRound", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    for (const rounds of [[], [{ ...ROUND, bracket: "SIDE" }], "x"]) {
      const res = await roundMapsPut(put({ rounds, slots: [] }), tournament("7"));
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: "INVALID_ROUND" });
    }
    expect(setRoundsMaps).not.toHaveBeenCalled();
  });
});

describe("PUT /api/admin/tournaments/[id]/map-rules", () => {
  it("rejette un visiteur anonyme (401)", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await mapRulesPut(put(RULES), tournament("7"))).status).toBe(401);
  });

  it("refuse sans la permission `tournaments` (403)", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    expect((await mapRulesPut(put(RULES), tournament("7"))).status).toBe(403);
    expect(setTournamentMapRules).not.toHaveBeenCalled();
  });

  it("refuse une règle inconnue (400 INVALID_MAP_RULES)", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    for (const rules of [{ ...RULES, firstBan: "COIN" }, { ...RULES, nextBan: "" }, { ...RULES, nextPick: 1 }]) {
      const res = await mapRulesPut(put(rules), tournament("7"));
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: "INVALID_MAP_RULES" });
    }
  });

  it("enregistre les règles", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(setTournamentMapRules).mockResolvedValue();
    const rules: MapRulesInput = { firstBan: "HOST", nextBan: "WINNER", nextPick: "FREE" };
    expect((await mapRulesPut(put(rules), tournament("7"))).status).toBe(200);
    expect(setTournamentMapRules).toHaveBeenCalledWith(7, rules);
  });
});

describe("PUT /api/matches/[matchId]/map-pick", () => {
  it("rejette un visiteur anonyme (401)", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await mapPickPut(put({ slot: 1, map: "Ilios" }), match("42"))).status).toBe(401);
  });

  it("refuse un identifiant de match invalide (400)", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    expect((await mapPickPut(put({ slot: 1, map: "Ilios" }), match("abc"))).status).toBe(400);
    expect(pickMatchMap).not.toHaveBeenCalled();
  });

  it("passe le droit d'arbitrage selon la permission `tournaments`", async () => {
    jest.mocked(pickMatchMap).mockResolvedValue();
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    expect((await mapPickPut(put({ slot: 2, map: "Busan" }), match("42"))).status).toBe(200);
    expect(pickMatchMap).toHaveBeenLastCalledWith(42, { userId: 3, staff: true }, 2, "Busan");
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    await mapPickPut(put({ slot: 2 }), match("42"));
    expect(pickMatchMap).toHaveBeenLastCalledWith(42, { userId: 2, staff: false }, 2, null);
  });

  it("PUT_overRateLimit_returns429WithoutPicking", async () => {
    // Compte propre à ce test : le plafond (`MAP_PICK_WRITE_RULE`) est en mémoire.
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 9_001, roles: ["ARBITRE"] }));
    jest.mocked(pickMatchMap).mockResolvedValue();
    for (let call = 0; call < MAP_PICK_WRITE_RULE.limit; call += 1) {
      await mapPickPut(put({ slot: 1, map: "Ilios" }), match("42"));
    }
    jest.mocked(pickMatchMap).mockClear();

    const res = await mapPickPut(put({ slot: 1, map: "Ilios" }), match("42"));

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ error: "TOO_MANY_REQUESTS" });
    expect(pickMatchMap).not.toHaveBeenCalled();
  });

  it.each<[string, number]>([
    ["INVALID_MAP_PICK", 400],
    ["NOT_MAP_PICKER", 403],
    ["MATCH_NOT_FOUND", 404],
    ["TOURNAMENT_NOT_FOUND", 404],
    ["MATCH_ALREADY_COMPLETED", 409],
  ])("traduit %s en %i", async (code, status) => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(pickMatchMap).mockRejectedValue(new Error(code));
    const res = await mapPickPut(put({ slot: 1, map: "Ilios" }), match("42"));
    expect(res.status).toBe(status);
    await expect(res.json()).resolves.toEqual({ error: code });
  });
});

describe("POST /round-maps/flush", () => {
  const post = () => new Request("http://localhost/api/x", { method: "POST" });

  it("flush_anonymous_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await flushPost(post(), tournament("7"))).status).toBe(401);
    expect(flushRoundMapsNotice).not.toHaveBeenCalled();
  });

  it("flush_player_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    expect((await flushPost(post(), tournament("7"))).status).toBe(403);
  });

  it("flush_badTournamentId_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    expect((await flushPost(post(), tournament("abc"))).status).toBe(400);
  });

  it("flush_referee_sendsThePendingNotice", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(flushRoundMapsNotice).mockResolvedValue(true);
    const response = await flushPost(post(), tournament("7"));
    expect(response.status).toBe(200);
    expect(flushRoundMapsNotice).toHaveBeenCalledWith(7);
  });

  it("flush_serviceThrows_returns500WithCode", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(flushRoundMapsNotice).mockRejectedValue(new Error("db"));
    expect((await flushPost(post(), tournament("7"))).status).toBe(500);
  });
});
