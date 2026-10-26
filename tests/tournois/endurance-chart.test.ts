import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BracketMatch, EnduranceMeta, EnduranceStandingRow } from "@/lib/shared/types";
import type { EnduranceRoundCell } from "@/lib/shared/bg-survie/replay";
import {
  CHART_H,
  CHART_PAD,
  CHART_W,
  ENDURANCE_CHART_PALETTE,
  ENDURANCE_CHART_PICK_MAX,
  chartAnimationFrame,
  chartColorIndex,
  chartGeometry,
  chartLine,
  chartOrderAt,
  chartRankAt,
  chartRecordAt,
  chartShownRound,
  chartTargetFor,
  chartThresholdAt,
  chartTickStep,
  chartTopAt,
  chartValueAt,
  chartX,
  chartY,
  easeInOutQuad,
  enduranceChartRoundCount,
  enduranceChartSeries,
  togglePick,
} from "@/app/(secured)/tournois/[id]/_lib/endurance-chart";
import { bracketMatch } from "../helpers/bracket-match";

/**
 * Graphique « Évolution de l'endurance » (`docs/features/ENDURANCE_RANKING_VIEWS.md`,
 * § Graphique) : séries, tracés, Top N, seuil, sélection, palette, animation.
 */

function match(id: number, round: number, team1: number, team2: number, score: [number, number] | null): BracketMatch {
  return bracketMatch({
    id,
    roundNumber: round,
    matchNumber: id,
    team1Id: team1,
    team1Name: `Team ${team1}`,
    team2Id: team2,
    team2Name: `Team ${team2}`,
    team1Score: score?.[0] ?? null,
    team2Score: score?.[1] ?? null,
    winnerTeamId: score === null ? null : score[0] > score[1] ? team1 : team2,
    loserTeamId: score === null ? null : score[0] > score[1] ? team2 : team1,
    status: score === null ? "READY" : "COMPLETED",
  });
}

const pts = (round: number, points: number, rank: number): EnduranceRoundCell => ({ round, kind: "POINTS", points, rank });

function row(teamId: number, overrides: Partial<EnduranceStandingRow>): EnduranceStandingRow {
  return {
    teamId,
    teamName: `Team ${teamId}`,
    logoUrl: null,
    seed: teamId,
    points: 9,
    wins: 0,
    losses: 0,
    draws: 0,
    status: "ACTIVE",
    eliminatedRound: null,
    rank: teamId,
    rounds: [],
    penaltyPoints: 0,
    ...overrides,
  };
}

/**
 * Quatre engagés, manche 1 close, manche 2 en cours :
 * - 1 : 9 → 12 → 14 (M2 jouée) ;
 * - 2 : 9 → 10, M2 à jouer contre 3 ;
 * - 3 : 9 → 8, M2 à jouer ;
 * - 4 : 9 → 6, forfait en M2.
 */
function fixture(): { endurance: EnduranceMeta; matches: BracketMatch[] } {
  const standings = [
    row(1, { points: 14, rank: 1, wins: 2, rounds: [pts(1, 12, 1), pts(2, 14, 1)] }),
    row(2, { points: 10, rank: 2, wins: 1, losses: 1, rounds: [pts(1, 10, 2), pts(2, 10, 2)] }),
    row(3, { points: 8, rank: 3, losses: 1, rounds: [pts(1, 8, 3), pts(2, 8, 3)] }),
    row(4, {
      points: 0,
      rank: 4,
      status: "FORFEIT",
      eliminatedRound: 2,
      losses: 1,
      rounds: [pts(1, 6, 4), { round: 2, kind: "FORFEIT", points: null }],
    }),
  ];
  const endurance: EnduranceMeta = {
    startPoints: 9,
    winDelta: 1,
    lossDelta: 1,
    forfeitMaps: 3,
    playoffSize: 2,
    maxRounds: 4,
    earlyExit: false,
    currentRound: 2,
    playoffsStarted: false,
    rounds: [1, 2],
    penalties: [],
    standings,
  };
  const matches = [
    match(1, 1, 1, 4, [3, 0]),
    match(2, 1, 2, 3, [2, 1]),
    match(3, 2, 1, 4, [2, 0]),
    match(4, 2, 2, 3, null),
  ];
  return { endurance, matches };
}

describe("séries du graphique", () => {
  const { endurance, matches } = fixture();
  const series = enduranceChartSeries(endurance, matches);

  it("suit le rejeu : départ, puis le capital de chaque manche jouée", () => {
    expect(series.map((s) => s.teamId)).toEqual([1, 2, 3, 4]);
    expect(series[0].values).toEqual([9, 12, 14]);
    expect(series[0].states).toEqual([
      { kind: "PLAYED", points: 12, delta: 3 },
      { kind: "PLAYED", points: 14, delta: 2 },
    ]);
  });

  it("arrête la courbe à la manche pas encore jouée", () => {
    expect(series[1].values).toEqual([9, 10]);
    expect(series[1].states[1]).toEqual({ kind: "PENDING" });
  });

  it("marque le forfait sur la manche de sa sortie", () => {
    expect(series[3].values).toEqual([9, 6]);
    expect(series[3].states[1]).toEqual({ kind: "FORFEIT" });
  });

  it("une équipe sortie plus tôt ne se prolonge pas", () => {
    const out = row(5, {
      points: 0,
      rank: 5,
      status: "ELIMINATED",
      eliminatedRound: 1,
      rounds: [pts(1, 0, 5), { round: 2, kind: "OUT", points: null }],
    });
    const [line] = enduranceChartSeries({ ...endurance, standings: [out] }, [match(9, 1, 5, 1, [0, 3])]);
    expect(line.values).toEqual([9, 0]);
    expect(line.states[1]).toEqual({ kind: "OUT" });
  });

  it("l'axe va jusqu'au plafond de manches, sinon jusqu'à la dernière tirée", () => {
    expect(enduranceChartRoundCount(endurance)).toBe(4);
    expect(enduranceChartRoundCount({ ...endurance, maxRounds: null })).toBe(2);
  });
});

describe("Top N, seuil et valeurs à la manche affichée", () => {
  const { endurance, matches } = fixture();
  const series = enduranceChartSeries(endurance, matches);

  it("le Top N d'une manche passée suit le rang de cette manche", () => {
    const ranksAfterRound1: Record<number, number> = { 1: 2, 2: 3, 3: 1, 4: 4 };
    const swapped = series.map((s) => ({
      ...s,
      standing: {
        ...s.standing,
        rounds: s.standing.rounds.map((cell) => (cell.round === 1 ? { ...cell, rank: ranksAfterRound1[s.teamId] } : cell)),
      },
    }));
    expect(chartTopAt(swapped, 1, 2, 2)).toEqual([3, 1]);
    expect(chartTopAt(swapped, 2, 2, 2)).toEqual([1, 2]);
  });

  it("la dernière manche lit le classement général", () => {
    expect(chartRankAt(series[3], 2, 2)).toBe(4);
    expect(chartValueAt(series[1], 2, 2)).toBe(10);
    expect(chartValueAt(series[0], 1, 2)).toBe(12);
  });

  it("le seuil est le capital du N-ième à la manche affichée", () => {
    expect(chartThresholdAt(series, 2, 2, 2)).toBe(10);
    expect(chartThresholdAt(series, 1, 2, 3)).toBe(8);
  });

  it("pas de seuil sans assez d'engagés ni sans place", () => {
    expect(chartThresholdAt(series, 2, 2, 8)).toBeNull();
    expect(chartThresholdAt(series, 2, 2, 0)).toBeNull();
  });

  it("l'ordre de la légende suit le rang de la manche affichée", () => {
    expect(chartOrderAt(series, 2, 2).map((s) => s.teamId)).toEqual([1, 2, 3, 4]);
  });
});

describe("tracés", () => {
  const { endurance, matches } = fixture();
  const series = enduranceChartSeries(endurance, matches);
  const geometry = chartGeometry(series, 4, endurance.startPoints);

  it("géométrie : graduations rondes, axe jusqu'au plus haut capital", () => {
    expect(geometry.tick).toBe(3);
    expect(geometry.maxY).toBe(15);
    expect(chartX(geometry, 0)).toBe(CHART_PAD.left);
    expect(chartX(geometry, 4)).toBe(CHART_W - CHART_PAD.right);
    expect(chartY(geometry, geometry.maxY)).toBe(CHART_PAD.top);
    expect(chartY(geometry, 0)).toBe(CHART_H - CHART_PAD.bottom);
  });

  it("pas des graduations : au plus sept lignes", () => {
    expect(chartTickStep(5)).toBe(1);
    expect(chartTickStep(18)).toBe(3);
    expect(chartTickStep(40)).toBe(10);
    expect(chartTickStep(1000)).toBe(167);
  });

  it("courbe complète : un segment par manche, tête pleine sur la dernière", () => {
    const line = chartLine(series[0], 2, 2, geometry);
    expect(line.d.split(" L")).toHaveLength(3);
    expect(line.d).toBe(line.hit);
    expect(line.head).toEqual({ x: chartX(geometry, 2), y: chartY(geometry, 14) });
    expect(line.hollow).toBe(false);
    expect(line.forfeit).toBe(false);
  });

  it("à mi-animation, la tête est interpolée et la zone de survol reste entière", () => {
    const line = chartLine(series[0], 2, 1.5, geometry);
    expect(line.head.x).toBeCloseTo(chartX(geometry, 1.5));
    expect(line.head.y).toBeCloseTo(chartY(geometry, 13));
    expect(line.hit.split(" L")).toHaveLength(3);
    expect(line.d.split(" L")).toHaveLength(3);
  });

  it("au départ de l'animation, rien n'est tracé au-delà du point de départ", () => {
    const line = chartLine(series[0], 2, 0, geometry);
    expect(line.d).not.toContain(" L");
  });

  it("manche affichée pas jouée : tête creuse, sans « FF »", () => {
    const line = chartLine(series[1], 2, 2, geometry);
    expect(line.hollow).toBe(true);
    expect(line.forfeit).toBe(false);
    expect(line.head).toEqual({ x: chartX(geometry, 1), y: chartY(geometry, 10) });
  });

  it("forfait à la manche affichée : tête creuse et « FF »", () => {
    const line = chartLine(series[3], 2, 2, geometry);
    expect(line.hollow).toBe(true);
    expect(line.forfeit).toBe(true);
  });

  it("la tête creuse n'apparaît qu'une fois l'animation arrivée", () => {
    expect(chartLine(series[1], 2, 0.5, geometry).hollow).toBe(false);
  });

  it("une manche passée s'affiche pleine même si la suivante ne l'est pas", () => {
    const line = chartLine(series[3], 1, 1, geometry);
    expect(line.hollow).toBe(false);
    expect(line.forfeit).toBe(false);
  });
});

describe("modes et sélection", () => {
  it("un clic hors « Ma sélection » isole l'engagé", () => {
    expect(togglePick("TOP", [], 7)).toEqual({ mode: "PICK", picked: [7] });
    expect(togglePick("ALL", [1, 2], 7)).toEqual({ mode: "PICK", picked: [7] });
  });

  it("ajoute puis retire", () => {
    expect(togglePick("PICK", [1], 2)).toEqual({ mode: "PICK", picked: [1, 2] });
    expect(togglePick("PICK", [1, 2], 1)).toEqual({ mode: "PICK", picked: [2] });
  });

  it("plafonne à huit, le retrait restant possible", () => {
    const full = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(ENDURANCE_CHART_PICK_MAX).toBe(8);
    expect(togglePick("PICK", full, 9).picked).toEqual(full);
    expect(togglePick("PICK", full, 8).picked).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("couleurs : Top N par place, sélection par ordre de choix, toutes en boucle", () => {
    const ctx = { top: [5, 3], picked: [3], generalIndex: 9 };
    expect(chartColorIndex("TOP", 3, ctx)).toBe(1);
    expect(chartColorIndex("TOP", 4, ctx)).toBeNull();
    expect(chartColorIndex("PICK", 3, ctx)).toBe(0);
    expect(chartColorIndex("PICK", 5, ctx)).toBeNull();
    expect(chartColorIndex("ALL", 4, ctx)).toBe(1);
  });
});

describe("palette", () => {
  const css = readFileSync(join(__dirname, "..", "..", "app", "globals.css"), "utf8");
  const root = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf(":root")));
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it("huit jetons du site, à la valeur déclarée", () => {
    expect(ENDURANCE_CHART_PALETTE).toHaveLength(8);
    for (const { token, hex } of ENDURANCE_CHART_PALETTE) {
      expect(root).toMatch(new RegExp(`${token}:\\s*${hex};`, "i"));
    }
  });

  it("aucun ambre, aucun rouge réservé", () => {
    for (const { token, hex } of ENDURANCE_CHART_PALETTE) {
      expect(token).not.toMatch(/amber|orange|danger|red|loss/);
      expect(hex.toLowerCase()).not.toBe("#f5a524");
    }
  });

  it("chaque couleur ≥ 3:1 sur les fonds du graphique", () => {
    for (const { hex } of ENDURANCE_CHART_PALETTE) {
      expect(contrast(hex, "#0a0c11")).toBeGreaterThanOrEqual(3);
      expect(contrast(hex, "#0f1218")).toBeGreaterThanOrEqual(3);
    }
  });

  it("deux couleurs voisines se distinguent aussi par la clarté", () => {
    for (let i = 1; i < ENDURANCE_CHART_PALETTE.length; i += 1) {
      const gap = Math.abs(luminance(ENDURANCE_CHART_PALETTE[i].hex) - luminance(ENDURANCE_CHART_PALETTE[i - 1].hex));
      expect(gap).toBeGreaterThanOrEqual(0.1);
    }
  });
});

describe("animation", () => {
  it("accélère puis freine", () => {
    expect(easeInOutQuad(0)).toBe(0);
    expect(easeInOutQuad(0.5)).toBe(0.5);
    expect(easeInOutQuad(1)).toBe(1);
    expect(easeInOutQuad(0.25)).toBeLessThan(0.25);
  });

  it("avance manche par manche puis s'arrête sur la cible", () => {
    expect(chartAnimationFrame(0, 3, 0, 100)).toEqual({ progress: 0, done: false });
    expect(chartAnimationFrame(0, 3, 150, 100).progress).toBeCloseTo(1.5);
    expect(chartAnimationFrame(0, 3, 300, 100)).toEqual({ progress: 3, done: true });
  });

  it("revient en arrière vers une manche plus ancienne", () => {
    expect(chartAnimationFrame(3, 1, 100, 100).progress).toBeCloseTo(2);
    expect(chartAnimationFrame(3, 1, 999, 100)).toEqual({ progress: 1, done: true });
  });

  it("cible déjà atteinte : une seule image", () => {
    expect(chartAnimationFrame(2, 2, 0)).toEqual({ progress: 2, done: true });
  });
});

describe("manche affichée et flux", () => {
  it("sans choix, suit la dernière manche tirée, y compris une manche poussée ensuite", () => {
    expect(chartShownRound(null, 3)).toBe(3);
    expect(chartShownRound(null, 4)).toBe(4);
  });

  it("une manche passée choisie reste affichée quand une nouvelle arrive", () => {
    expect(chartShownRound(2, 3)).toBe(2);
    expect(chartShownRound(2, 4)).toBe(2);
  });

  it("bornée à [1, dernière manche]", () => {
    expect(chartShownRound(0, 3)).toBe(1);
    expect(chartShownRound(7, 3)).toBe(3);
  });

  it("choisir la dernière manche revient à la suivre ; une manche passée est retenue", () => {
    expect(chartTargetFor(3, 3)).toBeNull();
    expect(chartTargetFor(1, 3)).toBe(1);
    expect(chartShownRound(chartTargetFor(3, 3), 4)).toBe(4);
  });
});

describe("bilan de l'encart", () => {
  const { endurance, matches } = fixture();
  const series = enduranceChartSeries(endurance, matches);
  const withRecord = {
    ...series[0],
    standing: {
      ...series[0].standing,
      rounds: [{ ...pts(1, 12, 1), wins: 1, losses: 0, draws: 0 }, { ...pts(2, 14, 1), wins: 2, losses: 0, draws: 0 }],
    },
  };

  it("une manche passée lit le bilan cumulé à son issue, pas le total du tournoi", () => {
    expect(chartRecordAt(withRecord, 1, 2)).toEqual({ wins: 1, draws: 0, losses: 0 });
  });

  it("la dernière manche lit le bilan général", () => {
    expect(chartRecordAt(withRecord, 2, 2)).toEqual({ wins: 2, draws: 0, losses: 0 });
    expect(chartRecordAt(series[1], 2, 2)).toEqual({ wins: 1, draws: 0, losses: 1 });
  });

  it("instantané sans bilan par manche : 0, comme la vue « après la manche n »", () => {
    expect(chartRecordAt(series[0], 1, 2)).toEqual({ wins: 0, draws: 0, losses: 0 });
  });
});
