import { describe, expect, it } from "@jest/globals";
import {
  DEFAULT_ENDURANCE_CONFIG,
  replayEndurance,
  replayEnduranceDetailed,
  type EnduranceConfig,
  type EnduranceMatchOutcome,
  type EndurancePenalty,
} from "@/lib/shared/bg-survie";

const CONFIG = DEFAULT_ENDURANCE_CONFIG;

/** N équipes seedées 1..N, dans l'ordre fixé par l'arbitre. */
function teams(count: number) {
  return Array.from({ length: count }, (_, index) => ({ teamId: index + 1, seed: index + 1 }));
}

function winMaps(
  round: number,
  winnerTeamId: number,
  loserTeamId: number,
  winnerMaps: number,
  loserMaps: number,
): EnduranceMatchOutcome {
  return { round, completed: true, winnerTeamId, loserTeamId, winnerMaps, loserMaps };
}

function penalty(teamId: number, round: number, points: number): EndurancePenalty {
  return { teamId, round, points };
}

function replay(input: {
  teamCount: number;
  matches?: EnduranceMatchOutcome[];
  forfeits?: { teamId: number; round: number }[];
  penalties?: EndurancePenalty[];
  lastRound: number;
  config?: EnduranceConfig;
}) {
  return replayEndurance({
    teams: teams(input.teamCount),
    matches: input.matches ?? [],
    forfeits: input.forfeits ?? [],
    penalties: input.penalties,
    config: input.config ?? CONFIG,
    lastRound: input.lastRound,
  });
}

function pointsOf(standings: ReturnType<typeof replay>, teamId: number): number {
  const found = standings.find((standing) => standing.teamId === teamId);
  if (!found) throw new Error(`équipe ${teamId} absente du classement`);
  return found.points;
}

function statusOf(standings: ReturnType<typeof replay>, teamId: number): string {
  const found = standings.find((standing) => standing.teamId === teamId);
  if (!found) throw new Error(`équipe ${teamId} absente du classement`);
  return found.status;
}

describe("replayEndurance — pénalités d'arbitrage", () => {
  it("retire les points de la manche où la sanction est prononcée", () => {
    const standings = replay({
      teamCount: 4,
      penalties: [penalty(2, 1, 3)],
      lastRound: 1,
    });

    expect(pointsOf(standings, 2)).toBe(CONFIG.startPoints - 3);
    // Les autres n'ont rien perdu : la sanction ne vaut que pour sa cible.
    expect(pointsOf(standings, 1)).toBe(CONFIG.startPoints);
  });

  it("un tournoi sans pénalité se rejoue exactement comme avant", () => {
    const matches = [winMaps(1, 1, 2, 3, 1)];
    const withField = replay({ teamCount: 4, matches, penalties: [], lastRound: 1 });
    const withoutField = replay({ teamCount: 4, matches, lastRound: 1 });

    expect(withField).toEqual(withoutField);
  });

  it("cumule deux sanctions posées sur la même manche", () => {
    const standings = replay({
      teamCount: 4,
      penalties: [penalty(2, 1, 2), penalty(2, 1, 3)],
      lastRound: 1,
    });

    expect(pointsOf(standings, 2)).toBe(CONFIG.startPoints - 5);
  });

  it("s'ajoute au barème du match de la même manche", () => {
    const standings = replay({
      teamCount: 4,
      matches: [winMaps(1, 1, 2, 3, 0)],
      penalties: [penalty(2, 1, 2)],
      lastRound: 1,
    });

    // 9 − 3 maps perdues − 2 de pénalité.
    expect(pointsOf(standings, 2)).toBe(CONFIG.startPoints - 5);
  });

  it("élimine quand la sanction vide le capital — la règle du mode vaut aussi ici", () => {
    const standings = replay({
      teamCount: 4,
      penalties: [penalty(3, 1, CONFIG.startPoints)],
      lastRound: 1,
    });

    expect(pointsOf(standings, 3)).toBe(0);
    expect(statusOf(standings, 3)).toBe("ELIMINATED");
    expect(
      standings.find((standing) => standing.teamId === 3)?.eliminatedRound,
    ).toBe(1);
  });

  it("ne descend jamais sous zéro, même sur une sanction plus lourde que le capital", () => {
    const standings = replay({
      teamCount: 4,
      penalties: [penalty(3, 1, CONFIG.startPoints + 20)],
      lastRound: 1,
    });

    expect(pointsOf(standings, 3)).toBe(0);
  });

  it("n'ampute rien sur une équipe déjà sortie à une manche antérieure", () => {
    const standings = replay({
      teamCount: 4,
      // 9 points, trois manches à 3-0 : l'équipe 2 tombe à 0 dès la manche 3.
      matches: [
        winMaps(1, 1, 2, 3, 0),
        winMaps(2, 1, 2, 3, 0),
        winMaps(3, 1, 2, 3, 0),
      ],
      penalties: [penalty(2, 4, 5)],
      lastRound: 4,
    });

    expect(statusOf(standings, 2)).toBe("ELIMINATED");
    // La manche de sortie reste la 3 : la sanction de la 4 n'a pas réécrit
    // l'histoire d'une équipe qui n'était plus là.
    expect(standings.find((s) => s.teamId === 2)?.eliminatedRound).toBe(3);
    expect(pointsOf(standings, 2)).toBe(0);
  });

  it("l'abandon de la même manche prime sur l'élimination que la sanction provoque", () => {
    const standings = replay({
      teamCount: 4,
      penalties: [penalty(4, 1, CONFIG.startPoints)],
      forfeits: [{ teamId: 4, round: 1 }],
      lastRound: 1,
    });

    expect(statusOf(standings, 4)).toBe("FORFEIT");
    expect(pointsOf(standings, 4)).toBe(0);
  });

  it("pèse sur le classement, donc sur l'appariement de la manche suivante", () => {
    const standings = replay({
      teamCount: 4,
      penalties: [penalty(1, 1, 4)],
      lastRound: 1,
    });

    // Tête de série pénalisée : elle passe derrière les trois autres, restées
    // au capital de départ.
    const ranked = standings.map((standing) => standing.teamId);
    expect(ranked[ranked.length - 1]).toBe(1);
  });

  it("une manche postérieure au dernier round généré est tout de même rejouée", () => {
    // `maxRound` doit tenir compte des pénalités : sans cela, une sanction
    // posée sur une manche que le moteur n'a pas encore comptée serait ignorée.
    const standings = replay({
      teamCount: 4,
      penalties: [penalty(2, 3, 2)],
      lastRound: 0,
    });

    expect(pointsOf(standings, 2)).toBe(CONFIG.startPoints - 2);
  });

  it("retirer la sanction rend les points et défait l'élimination qu'elle avait causée", () => {
    const sanctioned = replay({
      teamCount: 4,
      penalties: [penalty(3, 1, CONFIG.startPoints)],
      lastRound: 1,
    });
    expect(statusOf(sanctioned, 3)).toBe("ELIMINATED");

    // Le rejeu ne garde rien : la même entrée sans la ligne rend l'état d'avant.
    const lifted = replay({ teamCount: 4, penalties: [], lastRound: 1 });
    expect(statusOf(lifted, 3)).toBe("ACTIVE");
    expect(pointsOf(lifted, 3)).toBe(CONFIG.startPoints);
  });
});

describe("replayEnduranceDetailed — marque de la pénalité", () => {
  function detailed(penalties: EndurancePenalty[]) {
    return replayEnduranceDetailed({
      teams: teams(4),
      matches: [],
      forfeits: [],
      penalties,
      config: CONFIG,
      lastRound: 2,
    });
  }

  it("marque la case de la manche sanctionnée, et elle seule", () => {
    const replayed = detailed([penalty(2, 1, 3)]);
    const cells = replayed.history.get(2) ?? [];

    expect(cells[0]).toMatchObject({ round: 1, kind: "POINTS", penalty: 3 });
    expect(cells[1]).toMatchObject({ round: 2, kind: "POINTS" });
    expect(cells[1].penalty).toBeUndefined();
  });

  it("ne pose aucune marque sur une équipe jamais sanctionnée", () => {
    const replayed = detailed([penalty(2, 1, 3)]);
    for (const cell of replayed.history.get(1) ?? []) {
      expect(cell.penalty).toBeUndefined();
    }
  });

  it("cumule les sanctions d'une même manche dans la case", () => {
    const replayed = detailed([penalty(2, 1, 2), penalty(2, 1, 1)]);
    expect((replayed.history.get(2) ?? [])[0]).toMatchObject({ penalty: 3 });
  });

  it("totalise les points réellement retirés, par équipe", () => {
    const replayed = detailed([penalty(2, 1, 2), penalty(2, 2, 1), penalty(3, 1, 4)]);

    expect(replayed.penaltyTotals.get(2)).toBe(3);
    expect(replayed.penaltyTotals.get(3)).toBe(4);
    // Une équipe jamais sanctionnée est absente, plutôt que portée à zéro.
    expect(replayed.penaltyTotals.has(1)).toBe(false);
  });

  it("ne totalise pas une sanction qui n'a rien pu retirer", () => {
    const replayed = replayEnduranceDetailed({
      teams: teams(4),
      matches: [
        winMaps(1, 1, 2, 3, 0),
        winMaps(2, 1, 2, 3, 0),
        winMaps(3, 1, 2, 3, 0),
      ],
      forfeits: [],
      penalties: [penalty(2, 4, 5)],
      config: CONFIG,
      lastRound: 4,
    });

    expect(replayed.penaltyTotals.has(2)).toBe(false);
  });
});
