import { describe, expect, it } from "@jest/globals";
import { DEFAULT_ENDURANCE_CONFIG } from "@/lib/shared/bg-survie/config";
import type { EnduranceMatchOutcome } from "@/lib/shared/bg-survie/match-outcome";
import {
  enduranceRecordAfterRound,
  replayEnduranceDetailed,
  type EnduranceRoundCell,
  type ReplayEnduranceInput,
} from "@/lib/shared/bg-survie/replay";

/**
 * Rang et bilan **par manche** posés par le rejeu sur chaque case
 * (`EnduranceRoundCell.rank` / `wins` / `losses` / `draws`) : la source des
 * vues « Classement après la manche n » (`ENDURANCE_RANKING_VIEWS.md`).
 */

const FT3 = { type: "FT", value: 3 } as const;

function teams(count: number) {
  return Array.from({ length: count }, (_, index) => ({ teamId: index + 1, seed: index + 1 }));
}

function win(round: number, winner: number, loser: number, w = 3, l = 0): EnduranceMatchOutcome {
  return { round, completed: true, winnerTeamId: winner, loserTeamId: loser, winnerMaps: w, loserMaps: l };
}

function replay(input: Partial<ReplayEnduranceInput>) {
  return replayEnduranceDetailed({
    teams: teams(4),
    matches: [],
    forfeits: [],
    config: DEFAULT_ENDURANCE_CONFIG,
    lastRound: 1,
    matchFormat: FT3,
    ...input,
  });
}

function ranksAt(history: Map<number, { rank?: number }[]>, roundIndex: number): Record<number, number | undefined> {
  return Object.fromEntries([...history].map(([teamId, cells]) => [teamId, cells[roundIndex]?.rank]));
}

describe("replayEnduranceDetailed — rang et bilan par manche", () => {
  it("range chaque manche selon l'ordre du moteur et cumule le bilan", () => {
    const { history, standings } = replay({
      lastRound: 2,
      matches: [win(1, 4, 1), win(1, 3, 2, 3, 2), win(2, 1, 2), win(2, 4, 3, 3, 1)],
    });

    // Manche 1 : 4 → 12, 3 → 10, 2 → 8, 1 → 6.
    expect(ranksAt(history, 0)).toEqual({ 1: 4, 2: 3, 3: 2, 4: 1 });
    // Manche 2 : 4 → 14, 1 → 9, 3 → 8, 2 → 5.
    expect(ranksAt(history, 1)).toEqual({ 1: 2, 2: 4, 3: 3, 4: 1 });
    // La dernière manche dit la même chose que le classement final.
    for (const standing of standings) {
      expect(history.get(standing.teamId)?.at(-1)?.rank).toBe(standing.rank);
    }
    expect(history.get(1)?.[1]).toMatchObject({ wins: 1, losses: 1 });
    expect(history.get(4)?.[1]).toMatchObject({ wins: 2, losses: 0 });
  });

  it("n'écrit pas `draws` sur une case quand il n'y a aucun nul", () => {
    const { history } = replay({ lastRound: 2, matches: [win(1, 1, 2), win(2, 1, 3)] });
    for (const cells of history.values()) {
      for (const cell of cells) expect(cell).not.toHaveProperty("draws");
    }
  });

  it("garde `draws` positif à partir de la manche du nul", () => {
    const { history } = replay({
      lastRound: 2,
      matches: [{ round: 1, completed: true, winnerTeamId: null, loserTeamId: null, drawTeamIds: [1, 2], drawMaps: 1 }],
    });
    expect(history.get(1)?.[0]).toMatchObject({ draws: 1 });
    expect(history.get(1)?.[1]).toMatchObject({ draws: 1 });
    expect(history.get(3)?.[1]).not.toHaveProperty("draws");
  });

  it("le classement final est celui de la dernière manche, sorties et forfaits compris", () => {
    const { standings, history } = replay({
      lastRound: 4,
      matches: [win(1, 1, 2), win(2, 1, 2), win(3, 1, 2), win(4, 1, 3)],
      forfeits: [{ teamId: 4, round: 4 }],
    });
    expect(standings.map((s) => s.rank)).toEqual([1, 2, 3, 4]);
    for (const standing of standings) expect(history.get(standing.teamId)?.at(-1)?.rank).toBe(standing.rank);
  });

  it("sans aucune manche rejouée, le classement suit l'ordre de départ", () => {
    const { standings, rounds } = replay({ lastRound: 0 });
    expect(rounds).toEqual([]);
    expect(standings.map((s) => s.teamId)).toEqual([1, 2, 3, 4]);
  });

  it("départage une égalité de points par le rang de la manche précédente", () => {
    // Manche 1 : 1 et 3 à 10, 2 et 4 à 8 — le seed départage.
    // Manche 2 : 1 et 2 à 9 — le rang de la manche 1 (1 avant 2) départage.
    const { history } = replay({
      lastRound: 2,
      matches: [win(1, 1, 2, 3, 2), win(1, 3, 4, 3, 2), win(2, 3, 1, 3, 2), win(2, 2, 4, 3, 2)],
    });
    expect(ranksAt(history, 0)).toEqual({ 1: 1, 2: 3, 3: 2, 4: 4 });
    expect(ranksAt(history, 1)).toEqual({ 1: 2, 2: 3, 3: 1, 4: 4 });
  });

  it("compte les nuls", () => {
    const { history } = replay({
      matches: [
        { round: 1, completed: true, winnerTeamId: null, loserTeamId: null, drawTeamIds: [1, 2], drawMaps: 1 },
      ],
    });
    expect(history.get(1)?.[0]).toMatchObject({ wins: 0, losses: 0, draws: 1 });
  });

  it("classe une équipe forfait derrière les équipes en lice", () => {
    const { history } = replay({
      lastRound: 2,
      matches: [win(1, 1, 2), win(1, 3, 4)],
      forfeits: [{ teamId: 1, round: 2 }],
    });
    expect(history.get(1)?.[0]?.rank).toBe(1);
    expect(history.get(1)?.[1]).toMatchObject({ kind: "FORFEIT", rank: 4 });
    // Le forfait ne bouge pas le bilan : la case ne le réécrit pas, il se reporte.
    expect(history.get(1)?.[1]).not.toHaveProperty("wins");
    expect(enduranceRecordAfterRound(history.get(1) ?? [], 2)).toEqual({ wins: 1, losses: 0, draws: 0 });
  });

  it("fait descendre une équipe pénalisée dès la manche de la sanction", () => {
    const { history } = replay({
      lastRound: 1,
      matches: [win(1, 1, 2, 3, 2), win(1, 3, 4, 3, 2)],
      penalties: [{ teamId: 1, round: 1, points: 3 }],
    });
    // 1 : 10 − 3 = 7 ; 3 : 10 ; 2 et 4 : 8.
    expect(history.get(1)?.[0]).toMatchObject({ rank: 4, penalty: 3 });
    expect(history.get(3)?.[0]?.rank).toBe(1);
  });

  it("garde un rang aux manches qu'une équipe éliminée n'a plus jouées", () => {
    const { history } = replay({
      lastRound: 4,
      matches: [win(1, 1, 2), win(2, 1, 2), win(3, 1, 2), win(4, 1, 3)],
    });
    const cells = history.get(2) ?? [];
    expect(cells[2]).toMatchObject({ kind: "POINTS", points: 0, rank: 4, losses: 3 });
    expect(cells[3]).toMatchObject({ kind: "OUT", rank: 4 });
    expect(cells[3]).not.toHaveProperty("wins");
    expect(cells[3]).not.toHaveProperty("losses");
    expect(enduranceRecordAfterRound(cells, 4)).toEqual({ wins: 0, losses: 3, draws: 0 });
  });

  it("écarte en sortie anticipée sans perdre le rang", () => {
    const { history } = replay({
      lastRound: 2,
      config: { ...DEFAULT_ENDURANCE_CONFIG, playoffSize: 2, maxRounds: 3, earlyExit: true },
      matches: [win(1, 1, 3), win(1, 2, 4), win(2, 1, 3), win(2, 2, 4)],
    });
    expect(history.get(3)?.[1]?.rank).toBeGreaterThan(2);
    expect(history.get(1)?.[1]?.rank).toBe(1);
  });
});

describe("bilan des cases non jouées (instantané allégé)", () => {
  it("une case jouée écrit toujours son bilan, même s'il n'a pas bougé (exemption)", () => {
    const { history } = replay({
      teams: teams(3),
      lastRound: 2,
      matches: [win(1, 1, 2), win(2, 1, 3)],
    });
    // Équipe 3 : exemptée en manche 1, perd en manche 2 ; équipe 1 : victoires aux deux.
    expect(history.get(3)?.[0]).toMatchObject({ kind: "POINTS", wins: 0, losses: 0 });
    expect(history.get(1)?.[1]).toMatchObject({ kind: "POINTS", wins: 2 });
  });

  it("sortie : la case répétant le bilan l'omet, avec le rang", () => {
    const { history } = replay({
      lastRound: 4,
      matches: [win(1, 1, 2), win(2, 1, 2), win(3, 1, 2), win(4, 1, 3)],
    });
    const out = history.get(2)?.[3];
    expect(out).toEqual({ round: 4, kind: "OUT", points: null, rank: 4 });
  });

  it("les nuls déjà cumulés se reportent aussi", () => {
    const { history } = replay({
      lastRound: 2,
      matches: [{ round: 1, completed: true, winnerTeamId: null, loserTeamId: null, drawTeamIds: [1, 2], drawMaps: 1 }],
      forfeits: [{ teamId: 1, round: 2 }],
    });
    const cells = history.get(1) ?? [];
    expect(cells[1]).toMatchObject({ kind: "FORFEIT" });
    expect(cells[1]).not.toHaveProperty("draws");
    expect(enduranceRecordAfterRound(cells, 2)).toEqual({ wins: 0, losses: 0, draws: 1 });
  });

  it("un forfait qui change le bilan réécrit la case", () => {
    const { history } = replay({ lastRound: 1, matches: [], forfeits: [{ teamId: 1, round: 1 }] });
    const cell = history.get(2)?.[0];
    expect(cell).toMatchObject({ kind: "POINTS" });
    const forfeited = history.get(1)?.[0];
    expect(forfeited).toMatchObject({ kind: "FORFEIT", wins: 0, losses: 0 });
  });
});

describe("enduranceRecordAfterRound", () => {
  const cell = (round: number, extra: Partial<EnduranceRoundCell>): EnduranceRoundCell => ({
    round,
    kind: "POINTS",
    points: 9,
    ...extra,
  });

  it("lit le bilan de la case de la manche", () => {
    const cells = [cell(1, { wins: 1, losses: 0 }), cell(2, { wins: 1, losses: 1, draws: 2 })];
    expect(enduranceRecordAfterRound(cells, 2)).toEqual({ wins: 1, losses: 1, draws: 2 });
  });

  it("case sans bilan : reporte celui de la dernière case antérieure qui le porte", () => {
    const cells = [cell(1, { wins: 1, losses: 2 }), cell(2, { kind: "OUT", points: null }), cell(3, { kind: "OUT", points: null })];
    expect(enduranceRecordAfterRound(cells, 3)).toEqual({ wins: 1, losses: 2, draws: 0 });
  });

  it("manche absente de l'instantané : zéros", () => {
    expect(enduranceRecordAfterRound([cell(1, { wins: 1, losses: 0 })], 5)).toEqual({ wins: 0, losses: 0, draws: 0 });
  });

  it("ancien format sans aucun bilan : zéros", () => {
    expect(enduranceRecordAfterRound([cell(1, {}), cell(2, {})], 2)).toEqual({ wins: 0, losses: 0, draws: 0 });
  });

  it("ne reporte jamais un bilan d'une manche postérieure", () => {
    const cells = [cell(1, { kind: "OUT", points: null }), cell(2, { wins: 3, losses: 0 })];
    expect(enduranceRecordAfterRound(cells, 1)).toEqual({ wins: 0, losses: 0, draws: 0 });
  });
});
