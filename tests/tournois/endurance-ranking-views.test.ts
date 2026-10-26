import { describe, expect, it } from "@jest/globals";
import type { BracketMatch, EnduranceMeta, EnduranceStandingRow } from "@/lib/shared/types";
import {
  enduranceCurrentRound,
  enduranceRankingRows,
  enduranceRankingViews,
  enduranceRoundColumnCell,
  enduranceTabKey,
  enduranceViewBaseRound,
  enduranceViewColumnRound,
  enduranceViewKey,
  nextScheduledMatch,
  pendingEntrantCount,
  playoffCutIndex,
  rankMove,
  resolveEnduranceViewIndex,
  statusAfterRound,
  type EnduranceRankingView,
} from "@/app/(secured)/tournois/[id]/_lib/endurance-ranking-views";
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie/rounds";
import { FR_VIEWS_TEXT } from "@/app/(secured)/tournois/[id]/_lib/views-text";
import { bracketMatch } from "../helpers/bracket-match";

/**
 * Vues du classement d'endurance (`docs/features/ENDURANCE_RANKING_VIEWS.md`) :
 * liste des vues, lignes de chaque vue, ▲▼, filtre « déjà joués », ligne des
 * play-offs, prochain match, case « MANCHE n » de la variante A.
 */

function played(id: number, round: number, team1: number, team2: number, s1: number, s2: number, startAt: string | null = null): BracketMatch {
  return bracketMatch({
    id,
    roundNumber: round,
    matchNumber: id,
    team1Id: team1,
    team1Name: `Team ${team1}`,
    team2Id: team2,
    team2Name: `Team ${team2}`,
    team1Score: s1,
    team2Score: s2,
    winnerTeamId: s1 > s2 ? team1 : team2,
    loserTeamId: s1 > s2 ? team2 : team1,
    status: "COMPLETED",
    startAt,
  });
}

function pending(id: number, round: number, team1: number, team2: number, startAt: string | null = null): BracketMatch {
  return bracketMatch({
    id,
    roundNumber: round,
    matchNumber: id,
    team1Id: team1,
    team1Name: `Team ${team1}`,
    team2Id: team2,
    team2Name: `Team ${team2}`,
    status: "READY",
    startAt,
  });
}

function row(teamId: number, overrides: Partial<EnduranceStandingRow> = {}): EnduranceStandingRow {
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

function meta(standings: EnduranceStandingRow[], overrides: Partial<EnduranceMeta> = {}): EnduranceMeta {
  return {
    startPoints: 9,
    winDelta: 1,
    lossDelta: 1,
    forfeitMaps: 3,
    playoffSize: 2,
    maxRounds: 5,
    earlyExit: false,
    currentRound: 2,
    playoffsStarted: false,
    rounds: [1, 2],
    penalties: [],
    standings,
    ...overrides,
  };
}

/*
 * Quatre équipes, deux manches.
 * Manche 1 (close) : 1 bat 4 3-0 (12 / 6), 2 bat 3 3-1 (11 / 7).
 *   Rangs : 1, 2, 3, 4.
 * Manche 2 (en cours) : 4 bat 1 3-0 (9 / 9) ; 2 contre 3 à jouer.
 *   Rangs au général : 2 (11), 1 (9), 4 (9), 3 (7).
 */
const MATCHES: BracketMatch[] = [
  played(1, 1, 1, 4, 3, 0, "2026-10-20T19:00:00.000Z"),
  played(2, 1, 2, 3, 3, 1),
  played(3, 2, 4, 1, 3, 0),
  pending(4, 2, 2, 3, "2026-10-23T19:00:00.000Z"),
];

const STANDINGS: EnduranceStandingRow[] = [
  row(2, {
    rank: 1,
    points: 11,
    wins: 1,
    rounds: [
      { round: 1, kind: "POINTS", points: 11, rank: 2, wins: 1, losses: 0, draws: 0 },
      { round: 2, kind: "POINTS", points: 11, rank: 1, wins: 1, losses: 0, draws: 0 },
    ],
  }),
  row(1, {
    rank: 2,
    points: 9,
    wins: 1,
    losses: 1,
    rounds: [
      { round: 1, kind: "POINTS", points: 12, rank: 1, wins: 1, losses: 0, draws: 0 },
      { round: 2, kind: "POINTS", points: 9, rank: 2, wins: 1, losses: 1, draws: 0 },
    ],
  }),
  row(4, {
    rank: 3,
    points: 9,
    wins: 1,
    losses: 1,
    penaltyPoints: 1,
    rounds: [
      { round: 1, kind: "POINTS", points: 6, rank: 4, wins: 0, losses: 1, draws: 0 },
      { round: 2, kind: "POINTS", points: 8, rank: 3, wins: 1, losses: 1, draws: 0, penalty: 1 },
    ],
  }),
  row(3, {
    rank: 4,
    points: 7,
    losses: 1,
    rounds: [
      { round: 1, kind: "POINTS", points: 7, rank: 3, wins: 0, losses: 1, draws: 0 },
      { round: 2, kind: "POINTS", points: 7, rank: 4, wins: 0, losses: 1, draws: 0 },
    ],
  }),
];

const ENDURANCE = meta(STANDINGS);

describe("enduranceRankingViews — la liste des vues", () => {
  it("manches closes, puis la manche en cours (matchs déjà joués), puis le Général", () => {
    expect(enduranceRankingViews(ENDURANCE, MATCHES)).toEqual([
      { kind: "ROUND", round: 1 },
      { kind: "CURRENT", round: 2 },
      { kind: "GENERAL" },
    ]);
  });

  it("n'offre pas la vue « déjà joués » d'une manche où rien n'est joué", () => {
    const matches = [...MATCHES.slice(0, 2), pending(3, 2, 4, 1), pending(4, 2, 2, 3)];
    expect(enduranceRankingViews(ENDURANCE, matches)).toEqual([{ kind: "ROUND", round: 1 }, { kind: "GENERAL" }]);
  });

  it("se réduit au Général avant la première rencontre", () => {
    const views = enduranceRankingViews(meta(STANDINGS, { rounds: [1], currentRound: 1 }), [pending(1, 1, 1, 2)]);
    expect(views).toEqual([{ kind: "GENERAL" }]);
  });

  it("ignore l'arbre des play-offs", () => {
    const matches = [...MATCHES.slice(0, 2), pending(9, PLAYOFF_ROUND_OFFSET, 1, 2)];
    expect(enduranceRankingViews(meta(STANDINGS, { rounds: [1] }), matches)).toEqual([
      { kind: "ROUND", round: 1 },
      { kind: "GENERAL" },
    ]);
    expect(enduranceCurrentRound(matches)).toBeNull();
  });

  it("donne une clé stable à chaque vue", () => {
    expect(enduranceViewKey({ kind: "GENERAL" })).toBe("general");
    expect(enduranceViewKey({ kind: "ROUND", round: 3 })).toBe("round-3");
    expect(enduranceViewKey({ kind: "CURRENT", round: 4 })).toBe("current-4");
  });

  it("garde le lecteur sur sa manche quand la manche en cours se clôt", () => {
    const before = [{ kind: "ROUND", round: 2 }, { kind: "CURRENT", round: 3 }, { kind: "GENERAL" }] satisfies EnduranceRankingView[];
    const after = [{ kind: "ROUND", round: 2 }, { kind: "ROUND", round: 3 }, { kind: "GENERAL" }] satisfies EnduranceRankingView[];
    expect(resolveEnduranceViewIndex(before, "current-3")).toBe(1);
    // « M3 en cours » devient « Manche 3 » : même place, pas de retour au Général.
    expect(resolveEnduranceViewIndex(after, "current-3")).toBe(1);
    // L'onglet garde sa clé React : le bouton focalisé n'est pas démonté.
    expect(enduranceTabKey(before[1])).toBe(enduranceTabKey(after[1]));
    expect(enduranceTabKey({ kind: "GENERAL" })).toBe("general");
  });

  it("retombe sur le Général pour une clé disparue sans manche close", () => {
    const views = [{ kind: "ROUND", round: 1 }, { kind: "GENERAL" }] satisfies EnduranceRankingView[];
    expect(resolveEnduranceViewIndex(views, "general")).toBe(1);
    expect(resolveEnduranceViewIndex(views, "round-1")).toBe(0);
    expect(resolveEnduranceViewIndex(views, "current-5")).toBe(1);
    expect(resolveEnduranceViewIndex(views, "round-9")).toBe(1);
  });
});

describe("enduranceRankingRows — les lignes", () => {
  it("Général : l'ordre du flux, ▲▼ depuis la dernière manche close", () => {
    const rows = enduranceRankingRows({ kind: "GENERAL" }, ENDURANCE, MATCHES);
    expect(rows.map((r) => [r.standing.teamId, r.rank, r.move])).toEqual([
      [2, 1, 1],
      [1, 2, -1],
      [4, 3, 1],
      [3, 4, -1],
    ]);
    expect(rows[2].penaltyPoints).toBe(1);
  });

  it("Manche close : rang, capital et bilan à l'issue de la manche, ▲▼ par rapport au départ", () => {
    const rows = enduranceRankingRows({ kind: "ROUND", round: 1 }, ENDURANCE, MATCHES);
    expect(rows.map((r) => [r.standing.teamId, r.rank, r.points, r.wins, r.losses, r.move])).toEqual([
      [1, 1, 12, 1, 0, 0],
      [2, 2, 11, 1, 0, 0],
      [3, 3, 7, 0, 1, 0],
      [4, 4, 6, 0, 1, 0],
    ]);
    // La pénalité de la manche 2 n'existe pas encore à l'issue de la manche 1.
    expect(rows.find((r) => r.standing.teamId === 4)?.penaltyPoints).toBe(0);
  });

  it("« déjà joués » : les seules équipes ayant joué, au rang du général", () => {
    const rows = enduranceRankingRows({ kind: "CURRENT", round: 2 }, ENDURANCE, MATCHES);
    expect(rows.map((r) => [r.standing.teamId, r.rank])).toEqual([
      [1, 2],
      [4, 3],
    ]);
  });

  it("retombe sur le capital quand l'instantané ne porte pas de rang par manche", () => {
    const old = meta(
      STANDINGS.map((standing) => ({
        ...standing,
        rounds: standing.rounds.map(({ round, kind, points }) => ({ round, kind, points })),
      })),
    );
    const rows = enduranceRankingRows({ kind: "ROUND", round: 1 }, old, MATCHES);
    expect(rows.map((r) => r.standing.teamId)).toEqual([1, 2, 3, 4]);
    // Le départ (seed) reste connu ; la manche 1 sans rang, non.
    expect(rows.map((r) => r.move)).toEqual([0, 0, 0, 0]);
    const second = enduranceRankingRows({ kind: "ROUND", round: 2 }, old, MATCHES);
    expect(second.every((r) => r.move === null)).toBe(true);
  });

  it("lit le statut à la date de la vue : forfait dès sa manche, actif avant", () => {
    const ff = row(5, {
      status: "FORFEIT",
      eliminatedRound: 2,
      rounds: [
        { round: 1, kind: "POINTS", points: 8, rank: 3 },
        { round: 2, kind: "FORFEIT", points: null, rank: 5 },
      ],
    });
    expect(statusAfterRound(ff, 1)).toBe("ACTIVE");
    expect(statusAfterRound(ff, 2)).toBe("FORFEIT");
    const eliminated = row(6, { status: "ELIMINATED", eliminatedRound: 1 });
    expect(statusAfterRound(eliminated, 1)).toBe("ELIMINATED");
    const rows = enduranceRankingRows({ kind: "ROUND", round: 1 }, meta([ff]), []);
    expect(rows[0]).toMatchObject({ status: "ACTIVE", eliminatedRound: null });
  });
});

describe("rankMove et manche de référence", () => {
  it("positif = remonte, négatif = descend, null = inconnu", () => {
    expect(rankMove(5, 2)).toBe(3);
    expect(rankMove(2, 5)).toBe(-3);
    expect(rankMove(3, 3)).toBe(0);
    expect(rankMove(null, 3)).toBeNull();
  });

  it("compare une manche close à la précédente, une vue en direct à la dernière close", () => {
    expect(enduranceViewBaseRound({ kind: "ROUND", round: 1 }, ENDURANCE, MATCHES)).toBe(0);
    expect(enduranceViewBaseRound({ kind: "ROUND", round: 3 }, ENDURANCE, MATCHES)).toBe(2);
    expect(enduranceViewBaseRound({ kind: "GENERAL" }, ENDURANCE, MATCHES)).toBe(1);
    expect(enduranceViewBaseRound({ kind: "CURRENT", round: 2 }, ENDURANCE, MATCHES)).toBe(1);
    // Tout joué : la dernière manche se compare à l'avant-dernière.
    expect(enduranceViewBaseRound({ kind: "GENERAL" }, ENDURANCE, MATCHES.slice(0, 2))).toBe(1);
  });
});

describe("playoffCutIndex — la ligne « Zone play-offs »", () => {
  const rows = enduranceRankingRows({ kind: "GENERAL" }, ENDURANCE, MATCHES);

  it("passe après le dernier qualifié", () => {
    expect(playoffCutIndex(rows, 2)).toBe(1);
  });

  it("ne sépare rien quand tout le monde est dedans ou dehors", () => {
    expect(playoffCutIndex(rows, 8)).toBe(-1);
    expect(playoffCutIndex(rows, 0)).toBe(-1);
  });

  it("tient sur une vue filtrée, où les rangs ne se suivent pas", () => {
    const current = enduranceRankingRows({ kind: "CURRENT", round: 2 }, ENDURANCE, MATCHES);
    expect(playoffCutIndex(current, 2)).toBe(0);
  });
});

describe("nextScheduledMatch et pendingEntrantCount — le bandeau", () => {
  const now = Date.parse("2026-10-22T12:00:00.000Z");

  it("prend la date à venir la plus proche parmi les matchs non joués", () => {
    const matches = [
      ...MATCHES,
      pending(5, 2, 5, 6, "2026-10-22T20:00:00.000Z"),
      pending(6, 2, 7, 8, "2026-10-21T20:00:00.000Z"),
      pending(7, 2, 9, 10, null),
    ];
    expect(nextScheduledMatch(matches, 2, now)?.id).toBe(5);
  });

  it("ignore les matchs joués, sans date ou d'une autre manche", () => {
    expect(nextScheduledMatch(MATCHES, 1, now)).toBeNull();
    expect(nextScheduledMatch([pending(1, 2, 1, 2)], 2, now)).toBeNull();
    expect(nextScheduledMatch([pending(1, 2, 1, 2, "pas une date")], 2, now)).toBeNull();
  });

  it("compte les engagés qui doivent encore jouer", () => {
    expect(pendingEntrantCount(MATCHES, 2)).toBe(2);
    expect(pendingEntrantCount(MATCHES, 1)).toBe(0);
  });

  it("dit la manche en cours et son avancement", () => {
    expect(enduranceCurrentRound(MATCHES)).toEqual({ round: 2, total: 2, played: 1 });
  });
});

describe("enduranceRoundColumnCell — la colonne « MANCHE n » (variante A)", () => {
  it("rencontre jouée : variation, score, adversaire", () => {
    const team1 = STANDINGS.find((s) => s.teamId === 1)!;
    expect(enduranceRoundColumnCell(team1, 2, MATCHES, 9)).toEqual({
      kind: "PLAYED",
      delta: -3,
      ownScore: 0,
      opponentScore: 3,
      opponentId: 4,
      opponentName: "Team 4",
      startAt: null,
    });
    expect(enduranceRoundColumnCell(team1, 1, MATCHES, 9)).toMatchObject({ kind: "PLAYED", delta: 3, ownScore: 3 });
  });

  it("variation pénalité comprise", () => {
    const team4 = STANDINGS.find((s) => s.teamId === 4)!;
    expect(enduranceRoundColumnCell(team4, 2, MATCHES, 9)).toMatchObject({ delta: 2 });
  });

  it("rencontre à jouer : date et adversaire", () => {
    const team2 = STANDINGS.find((s) => s.teamId === 2)!;
    expect(enduranceRoundColumnCell(team2, 2, MATCHES, 9)).toEqual({
      kind: "PENDING",
      opponentId: 3,
      opponentName: "Team 3",
      startAt: "2026-10-23T19:00:00.000Z",
    });
  });

  it("forfait, sortie, manche sans match", () => {
    const ff = row(5, { status: "FORFEIT", eliminatedRound: 2, rounds: [{ round: 2, kind: "FORFEIT", points: null }] });
    expect(enduranceRoundColumnCell(ff, 2, MATCHES, 9)).toEqual({ kind: "FORFEIT" });
    const out = row(6, { status: "ELIMINATED", eliminatedRound: 1, rounds: [{ round: 2, kind: "OUT", points: null }] });
    expect(enduranceRoundColumnCell(out, 2, MATCHES, 9)).toEqual({ kind: "OUT" });
    expect(enduranceRoundColumnCell(row(7), 2, MATCHES, 9)).toEqual({ kind: "BYE" });
  });

  it("montre la manche de la vue, la dernière manche au Général", () => {
    expect(enduranceViewColumnRound({ kind: "ROUND", round: 1 }, ENDURANCE)).toBe(1);
    expect(enduranceViewColumnRound({ kind: "GENERAL" }, ENDURANCE)).toBe(2);
    expect(enduranceViewColumnRound({ kind: "GENERAL" }, meta(STANDINGS, { rounds: [] }))).toBeNull();
  });
});

describe("textes — équipe ou joueur", () => {
  it("accorde le bandeau et les cases au type d'engagé", () => {
    const { t } = FR_VIEWS_TEXT;
    expect(t("endurance.stripPendingTeam", { count: 2 })).toBe("2 équipes doivent encore jouer cette manche");
    expect(t("endurance.stripPendingSolo", { count: 1 })).toBe("1 joueur doit encore jouer cette manche");
    expect(t("endurance.inContentionTeam", { count: 19, size: "8" })).toBe("19 équipes en lice → 8 en play-offs");
    expect(t("endurance.inContentionSolo", { count: 3, size: "8" })).toBe("3 joueurs en lice → 8 en play-offs");
    expect(t("endurance.cellForfeitTeam")).toBe("Forfait — retirée");
    expect(t("endurance.cellForfeitSolo")).toBe("Forfait — retiré");
    expect(t("endurance.stripPlayed", { played: 7, total: "11" })).toBe("7 matchs joués sur 11");
  });
});
