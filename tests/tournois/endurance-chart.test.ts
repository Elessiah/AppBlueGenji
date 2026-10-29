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
  assignChartColors,
  chartColoredIds,
  chartGeometry,
  chartHitPath,
  chartLine,
  chartOrderAt,
  chartRankAt,
  chartRecordAt,
  chartRoundMs,
  chartShownRound,
  chartTargetFor,
  chartThresholdAt,
  chartThresholdOf,
  chartTickStep,
  chartTopAt,
  chartTopOf,
  chartValueAt,
  chartX,
  chartY,
  easeInOutQuad,
  ENDURANCE_CHART_ROUND_MS,
  ENDURANCE_CHART_TOTAL_MS,
  enduranceChartInputKey,
  enduranceChartRoundCount,
  enduranceChartSeries,
  togglePick,
} from "@/app/(secured)/tournois/[id]/_lib/endurance-chart";
import { enduranceRoundColumnCell } from "@/app/(secured)/tournois/[id]/_lib/endurance-ranking-views";
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
    cancellableForfeitTeamIds: [],
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
      { kind: "PLAYED", points: 12, delta: 3, penalty: 0 },
      { kind: "PLAYED", points: 14, delta: 2, penalty: 0 },
    ]);
  });

  it("arrête la courbe à la manche pas encore jouée", () => {
    expect(series[1].values).toEqual([9, 10]);
    expect(series[1].states[1]).toEqual({ kind: "PENDING", penalty: 0 });
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
    expect(line.d).toBe(chartHitPath(series[0], 2, geometry));
    expect(line).not.toHaveProperty("hit");
    expect(line.head).toEqual({ x: chartX(geometry, 2), y: chartY(geometry, 14) });
    expect(line.hollow).toBe(false);
    expect(line.forfeit).toBe(false);
  });

  it("à mi-animation, la tête est interpolée et la zone de survol reste entière", () => {
    const line = chartLine(series[0], 2, 1.5, geometry);
    expect(line.head.x).toBeCloseTo(chartX(geometry, 1.5));
    expect(line.head.y).toBeCloseTo(chartY(geometry, 13));
    expect(chartHitPath(series[0], 2, geometry).split(" L")).toHaveLength(3);
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
  it("sélection vide hors « Ma sélection » : elle s'ouvre sur l'engagé seul", () => {
    expect(togglePick("TOP", [], 7)).toEqual({ mode: "PICK", picked: [7], full: false });
    expect(togglePick("ALL", [], 7)).toEqual({ mode: "PICK", picked: [7], full: false });
  });

  it("sélection déjà construite hors « Ma sélection » : gardée, l'engagé s'y ajoute", () => {
    expect(togglePick("TOP", [1, 2, 3, 4, 5], 7)).toEqual({ mode: "PICK", picked: [1, 2, 3, 4, 5, 7], full: false });
  });

  it("engagé déjà choisi, hors « Ma sélection » : on revient au mode sans rien retirer", () => {
    expect(togglePick("ALL", [1, 2], 2)).toEqual({ mode: "PICK", picked: [1, 2], full: false });
  });

  it("ajoute puis retire en « Ma sélection »", () => {
    expect(togglePick("PICK", [1], 2)).toEqual({ mode: "PICK", picked: [1, 2], full: false });
    expect(togglePick("PICK", [1, 2], 1)).toEqual({ mode: "PICK", picked: [2], full: false });
  });

  it("plafonne à huit en le disant (full), le retrait restant possible", () => {
    const full = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(ENDURANCE_CHART_PICK_MAX).toBe(8);
    expect(togglePick("PICK", full, 9)).toEqual({ mode: "PICK", picked: full, full: true });
    expect(togglePick("PICK", full, 8)).toEqual({ mode: "PICK", picked: [1, 2, 3, 4, 5, 6, 7], full: false });
  });

  it("sélection pleine hors « Ma sélection » : le mode change, l'ajout est refusé et signalé", () => {
    const full = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(togglePick("TOP", full, 9)).toEqual({ mode: "PICK", picked: full, full: true });
  });

  it("ne modifie jamais la sélection reçue", () => {
    const picked = [1, 2];
    togglePick("PICK", picked, 3);
    togglePick("PICK", picked, 1);
    expect(picked).toEqual([1, 2]);
  });
});

describe("couleurs attribuées une fois", () => {
  const series = enduranceChartSeries(fixture().endurance, fixture().matches);

  it("engagés mis en couleur : Top N dans l'ordre, sélection dans l'ordre de choix, toutes les séries", () => {
    const ctx = { top: [5, 3], picked: [3], series };
    expect(chartColoredIds("TOP", ctx)).toEqual([5, 3]);
    expect(chartColoredIds("PICK", ctx)).toEqual([3]);
    expect(chartColoredIds("ALL", ctx)).toEqual([1, 2, 3, 4]);
  });

  it("à l'ouverture : une couleur par engagé, dans l'ordre", () => {
    expect([...assignChartColors(new Map(), [5, 3, 9])]).toEqual([[5, 0], [3, 1], [9, 2]]);
  });

  it("deux engagés qui s'échangent leurs places gardent chacun leur couleur", () => {
    const first = assignChartColors(new Map(), [5, 3]);
    expect(assignChartColors(first, [3, 5])).toEqual(first);
  });

  it("retirer le premier choix ne recolore pas les autres", () => {
    const first = assignChartColors(new Map(), [5, 3, 9]);
    const next = assignChartColors(first, [3, 9]);
    expect(next.get(3)).toBe(1);
    expect(next.get(9)).toBe(2);
  });

  it("un engagé qui entre prend la première couleur libre", () => {
    const first = assignChartColors(new Map(), [5, 3]);
    expect(assignChartColors(first, [5, 3, 8]).get(8)).toBe(2);
    expect(assignChartColors(first, [3, 8]).get(8)).toBe(0);
  });

  it("une couleur déjà prise par un engagé tracé avant lui est réattribuée", () => {
    const first = assignChartColors(new Map(), [5, 3]);
    // 7 prend la couleur libre 0 pendant que 5 est masqué ; 5 revient et trouve 0 prise.
    const second = assignChartColors(first, [3, 7]);
    const third = assignChartColors(second, [7, 3, 5]);
    expect(third.get(7)).toBe(second.get(7));
    expect(new Set([third.get(7), third.get(3), third.get(5)]).size).toBe(3);
  });

  it("au-delà de huit tracés les couleurs se répètent, sans changer d'un appel à l'autre", () => {
    const ids = Array.from({ length: 12 }, (_, i) => i + 1);
    const first = assignChartColors(new Map(), ids);
    expect(new Set(ids.map((id) => first.get(id))).size).toBe(ENDURANCE_CHART_PALETTE.length);
    expect(assignChartColors(first, ids)).toEqual(first);
  });

  it("palette saturée : retirer un engagé répété ne décale pas les autres", () => {
    const ids = Array.from({ length: 12 }, (_, i) => i + 1);
    const first = assignChartColors(new Map(), ids);
    const without = assignChartColors(first, ids.filter((id) => id !== 9));
    for (const id of ids.filter((value) => value !== 9)) expect(without.get(id)).toBe(first.get(id));
  });

  it("ne modifie pas les attributions reçues et garde celles des engagés masqués", () => {
    const previous = new Map([[1, 4]]);
    const next = assignChartColors(previous, [2]);
    expect([...previous]).toEqual([[1, 4]]);
    expect(next.get(1)).toBe(4);
    expect(next.get(2)).toBe(0);
  });
});

describe("clé de contenu des entrées", () => {
  it("de nouveaux objets de même contenu donnent la même clé", () => {
    const a = fixture();
    const b = fixture();
    expect(enduranceChartInputKey(a.endurance, a.matches)).toBe(enduranceChartInputKey(b.endurance, b.matches));
  });

  it("un résultat qualificatif change la clé", () => {
    const a = fixture();
    const b = fixture();
    b.matches[3] = match(4, 2, 2, 3, [2, 0]);
    expect(enduranceChartInputKey(b.endurance, b.matches)).not.toBe(enduranceChartInputKey(a.endurance, a.matches));
  });

  it("un capital, un rang ou une case de manche change la clé", () => {
    const base = fixture();
    const baseKey = enduranceChartInputKey(base.endurance, base.matches);
    const points = fixture();
    points.endurance.standings[0] = { ...points.endurance.standings[0], points: 15 };
    const rank = fixture();
    rank.endurance.standings[1] = { ...rank.endurance.standings[1], rank: 3 };
    const cell = fixture();
    cell.endurance.standings[2] = { ...cell.endurance.standings[2], rounds: [pts(1, 8, 3), pts(2, 7, 3)] };
    for (const changed of [points, rank, cell]) {
      expect(enduranceChartInputKey(changed.endurance, changed.matches)).not.toBe(baseKey);
    }
  });

  it("un match de play-off ne change pas la clé", () => {
    const base = fixture();
    const withPlayoff = fixture();
    withPlayoff.matches.push(match(90, 1001, 1, 2, [3, 1]));
    expect(enduranceChartInputKey(withPlayoff.endurance, withPlayoff.matches)).toBe(
      enduranceChartInputKey(base.endurance, base.matches),
    );
  });

  it("deux noms qui se touchent ne se confondent pas avec un seul", () => {
    const a = fixture();
    const b = fixture();
    a.endurance.standings[0] = { ...a.endurance.standings[0], teamName: "AB", seed: 1 };
    b.endurance.standings[0] = { ...b.endurance.standings[0], teamName: "A", seed: 1 };
    expect(enduranceChartInputKey(a.endurance, a.matches)).not.toBe(enduranceChartInputKey(b.endurance, b.matches));
  });
});

describe("pénalités d'arbitrage dans le graphique", () => {
  /** Manche 2 en cours : l'équipe 2 est sanctionnée de 3 points avant son match. */
  function penalised(): { endurance: EnduranceMeta; matches: BracketMatch[] } {
    const { endurance, matches } = fixture();
    const standings = endurance.standings.map((standing) =>
      standing.teamId === 2
        ? { ...standing, points: 7, penaltyPoints: 3, rounds: [pts(1, 10, 2), { ...pts(2, 7, 3), penalty: 3 }] }
        : standing,
    );
    return { endurance: { ...endurance, standings }, matches };
  }

  it("une manche jouée porte la pénalité de sa case", () => {
    const { endurance, matches } = fixture();
    const standings = endurance.standings.map((standing) =>
      standing.teamId === 1 ? { ...standing, rounds: [pts(1, 12, 1), { ...pts(2, 11, 1), penalty: 3 }] } : standing,
    );
    const [first] = enduranceChartSeries({ ...endurance, standings }, matches);
    expect(first.states[1]).toEqual({ kind: "PLAYED", points: 11, delta: -1, penalty: 3 });
    expect(first.states[0]).toMatchObject({ kind: "PLAYED", penalty: 0 });
  });

  it("sanction avant le match de la dernière manche : la courbe va jusqu'au capital de la légende", () => {
    const { endurance, matches } = penalised();
    const second = enduranceChartSeries(endurance, matches).find((item) => item.teamId === 2)!;
    expect(second.states[1]).toEqual({ kind: "PENDING", penalty: 3 });
    expect(second.values).toEqual([9, 10, 7]);
    expect(chartValueAt(second, 2, 2)).toBe(second.values.at(-1));
  });

  it("le seuil lit un capital que la courbe atteint", () => {
    const { endurance, matches } = penalised();
    const all = enduranceChartSeries(endurance, matches);
    const threshold = chartThresholdAt(all, 2, 2, 3);
    expect(all.some((item) => item.values.includes(threshold ?? -1))).toBe(true);
  });

  it("la tête reste creuse : l'engagé n'a pas joué la manche affichée", () => {
    const { endurance, matches } = penalised();
    const all = enduranceChartSeries(endurance, matches);
    const geometry = chartGeometry(all, 4, endurance.startPoints);
    const second = all.find((item) => item.teamId === 2)!;
    const line = chartLine(second, 2, 2, geometry);
    expect(line.hollow).toBe(true);
    expect(line.head).toEqual({ x: chartX(geometry, 2), y: chartY(geometry, 7) });
  });

  it("sans sanction, la courbe d'un match à jouer s'arrête toujours au capital précédent", () => {
    const [, second] = enduranceChartSeries(fixture().endurance, fixture().matches);
    expect(second.states[1]).toEqual({ kind: "PENDING", penalty: 0 });
    expect(second.values).toEqual([9, 10]);
  });
});

describe("zone de survol", () => {
  const { endurance, matches } = fixture();
  const series = enduranceChartSeries(endurance, matches);
  const geometry = chartGeometry(series, 4, endurance.startPoints);

  it("la courbe entière jusqu'à la manche affichée, un point par manche", () => {
    expect(chartHitPath(series[0], 2, geometry).split(" L")).toHaveLength(3);
    expect(chartHitPath(series[0], 1, geometry).split(" L")).toHaveLength(2);
  });

  it("s'arrête à la dernière manche jouée d'un engagé", () => {
    expect(chartHitPath(series[1], 2, geometry).split(" L")).toHaveLength(2);
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

  it("le 6e tracé est un jeton propre au graphique, que le contraste élevé ne redéfinit pas", () => {
    expect(ENDURANCE_CHART_PALETTE[5].token).toBe("--chart-blue-deep");
    const contrastBlock = css.slice(css.indexOf(':root[data-a11y~="contrast"],'));
    expect(contrastBlock.slice(0, contrastBlock.indexOf("}"))).not.toContain("--chart-blue-deep");
    expect(ENDURANCE_CHART_PALETTE.map((entry) => entry.token)).not.toContain("--blue-700");
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

  it("durée par manche : 650 ms, plafonnée à 2,4 s au total", () => {
    expect(ENDURANCE_CHART_ROUND_MS).toBe(650);
    expect(chartRoundMs(1)).toBe(650);
    expect(chartRoundMs(3)).toBe(650);
    expect(chartRoundMs(12)).toBe(200);
    expect(chartRoundMs(12) * 12).toBeLessThanOrEqual(ENDURANCE_CHART_TOTAL_MS);
    expect(chartRoundMs(0)).toBe(650);
  });

  it("sur douze manches, l'animation par défaut est finie en 2,4 s", () => {
    expect(chartAnimationFrame(0, 12, 2399).done).toBe(false);
    expect(chartAnimationFrame(0, 12, 2400)).toEqual({ progress: 12, done: true });
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

describe("performance : grand plateau (64 engagés × 12 manches)", () => {
  const TEAMS = 64;
  const ROUNDS = 12;
  // Manches 1 à 11 jouées, 12 à moitié : chaque équipe affronte sa voisine.
  const matches: BracketMatch[] = [];
  let id = 1;
  for (let round = 1; round <= ROUNDS; round += 1) {
    for (let t = 1; t <= TEAMS; t += 2) {
      const played = round < ROUNDS || t <= TEAMS / 2;
      matches.push(match(id, round, t, t + 1, played ? [2, (round + t) % 2] : null));
      id += 1;
    }
  }
  const standings = Array.from({ length: TEAMS }, (_, i) =>
    row(i + 1, {
      points: 9 + ((i * 7) % 13),
      rounds: Array.from({ length: ROUNDS - 1 }, (_, r) => pts(r + 1, 9 + ((i + r) % 11), ((i + r * 5) % TEAMS) + 1)),
    }),
  );
  const big: EnduranceMeta = {
    ...fixture().endurance,
    playoffSize: 8,
    maxRounds: ROUNDS,
    currentRound: ROUNDS,
    rounds: Array.from({ length: ROUNDS }, (_, r) => r + 1),
    standings,
  };

  it("les séries ne lisent que les matchs de chaque manche — même résultat que tous les matchs", () => {
    const series = enduranceChartSeries(big, matches);
    expect(series).toHaveLength(TEAMS);
    for (const item of series) {
      for (let round = 1; round <= ROUNDS; round += 1) {
        const cell = enduranceRoundColumnCell(item.standing, round, matches, big.startPoints);
        const kind = cell.kind === "BYE" ? "PLAYED" : cell.kind;
        expect(item.states[round - 1].kind).toBe(kind);
      }
    }
    // Moitié de la manche 12 encore à jouer.
    expect(series.filter((item) => item.states[ROUNDS - 1].kind === "PENDING")).toHaveLength(TEAMS / 2);
  });

  it("Top N et seuil tirés d'un ordre déjà calculé = mêmes valeurs qu'en retriant", () => {
    const series = enduranceChartSeries(big, matches);
    for (const round of [1, 6, ROUNDS]) {
      const order = chartOrderAt(series, round, ROUNDS);
      expect(chartTopOf(order, 8)).toEqual(chartTopAt(series, round, ROUNDS, 8));
      expect(chartThresholdOf(order, round, ROUNDS, 8)).toBe(chartThresholdAt(series, round, ROUNDS, 8));
    }
    const order = chartOrderAt(series, ROUNDS, ROUNDS);
    expect(chartTopOf(order, 0)).toEqual([]);
    expect(chartThresholdOf(order, ROUNDS, ROUNDS, 0)).toBeNull();
    expect(chartThresholdOf(order.slice(0, 4), ROUNDS, ROUNDS, 8)).toBeNull();
  });
});
