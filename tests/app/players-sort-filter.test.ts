import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compareNewestFirst, matchesPlayerStatusFilter } from "@/lib/shared/player-directory";

const ROOT = join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const playersList = read("app/(secured)/joueurs/PlayersList.tsx");
const frPlayers = JSON.parse(read("messages/fr/players.json")) as typeof import("@/messages/fr/players.json");
const enPlayers = JSON.parse(read("messages/en/players.json")) as typeof import("@/messages/fr/players.json");

const team = { id: 4 };
const inRoster = { team, openToRecruitment: true };
const freeAgent = { team: null, openToRecruitment: true };
const closed = { team: null, openToRecruitment: false };
const unknown = { team: null };

describe("matchesPlayerStatusFilter", () => {
  it("« all » garde tout le monde", () => {
    for (const p of [inRoster, freeAgent, closed, unknown]) expect(matchesPlayerStatusFilter(p, "all")).toBe(true);
  });

  it("« free » ne garde que les joueurs sans roster et ouverts", () => {
    expect([inRoster, freeAgent, closed, unknown].filter((p) => matchesPlayerStatusFilter(p, "free"))).toEqual([freeAgent]);
  });

  it("« unaffiliated » garde tout joueur sans roster, ouvert ou non", () => {
    expect([inRoster, freeAgent, closed, unknown].filter((p) => matchesPlayerStatusFilter(p, "unaffiliated"))).toEqual([
      freeAgent,
      closed,
      unknown,
    ]);
  });

  it("un joueur en roster ouvert au recrutement n'est jamais « sans équipe »", () => {
    expect(matchesPlayerStatusFilter(inRoster, "unaffiliated")).toBe(false);
    expect(matchesPlayerStatusFilter({ team }, "unaffiliated")).toBe(false);
  });
});

describe("compareNewestFirst", () => {
  const at = (createdAt: string, id: number) => ({ createdAt, id });

  it("range les comptes les plus récents d'abord", () => {
    const players = [
      at("2026-01-02T10:00:00.000Z", 1),
      at("2026-10-20T08:00:00.000Z", 2),
      at("2025-12-31T23:59:59.000Z", 3),
    ];
    expect([...players].sort(compareNewestFirst).map((p) => p.id)).toEqual([2, 1, 3]);
  });

  it("garde l'ordre d'arrivée à égalité (tri stable)", () => {
    const players = [at("2026-05-05T05:05:05.000Z", 1), at("2026-05-05T05:05:05.000Z", 2)];
    expect(compareNewestFirst(players[0], players[1])).toBe(0);
    expect([...players].sort(compareNewestFirst).map((p) => p.id)).toEqual([1, 2]);
  });

  it("une liste vide reste vide", () => {
    expect([].sort(compareNewestFirst)).toEqual([]);
  });
});

describe("Annuaire joueurs — branchement et libellés", () => {
  it("le composant passe par les fonctions partagées et propose les trois tris", () => {
    expect(playersList).toContain("matchesPlayerStatusFilter(p, statusFilter)");
    expect(playersList).toContain("r.sort(compareNewestFirst)");
    expect(playersList).toContain('(["pseudo", "tournaments", "created"] as const)');
    expect(playersList).toContain('["all", "free", "unaffiliated"] as const');
  });

  it("les libellés existent en français et en anglais", () => {
    expect(frPlayers.list.sort.created).toBe("Date de création");
    expect(enPlayers.list.sort.created).toBe("Creation date");
    expect(frPlayers.list.statusFilter.unaffiliated).toBe("SANS ÉQUIPE");
    expect(enPlayers.list.statusFilter.unaffiliated).toBe("NO TEAM");
  });
});
