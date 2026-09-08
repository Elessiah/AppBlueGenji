import { describe, expect, it } from "@jest/globals";
import {
  DEFAULT_ENDURANCE_CONFIG,
  enduranceEliminationCut,
  replayEndurance,
  type EnduranceConfig,
  type EnduranceMatchOutcome,
} from "@/lib/shared/bg-survie";
import type { MatchFormat } from "@/lib/shared/match-format";

const CONFIG = DEFAULT_ENDURANCE_CONFIG;
/** Le format du règlement : premier à 3, cinq maps décisives, égalité possible. */
const QUALIF: MatchFormat = { type: "FT", value: 3, drawsAllowed: true };

function teams(count: number) {
  return Array.from({ length: count }, (_, index) => ({ teamId: index + 1, seed: index + 1 }));
}

/** Un match nul entre deux engagés, tel que le charge `loadQualificationOutcomes`. */
function draw(round: number, a: number, b: number, maps: number): EnduranceMatchOutcome {
  return {
    round,
    completed: true,
    winnerTeamId: null,
    loserTeamId: null,
    drawTeamIds: [a, b],
    drawMaps: maps,
  };
}

function win(
  round: number,
  winner: number,
  loser: number,
  winnerMaps: number,
  loserMaps: number,
): EnduranceMatchOutcome {
  return {
    round,
    completed: true,
    winnerTeamId: winner,
    loserTeamId: loser,
    winnerMaps,
    loserMaps,
  };
}

function pointsOf(standings: ReturnType<typeof replayEndurance>): Map<number, number> {
  return new Map(standings.map((s) => [s.teamId, s.points]));
}

describe("rejeu d'endurance — matchs nuls", () => {
  it("ne déplace rien au barème par défaut : le nul se compte map par map", () => {
    const standings = replayEndurance({
      teams: teams(4),
      matches: [draw(1, 1, 2, 2), draw(1, 3, 4, 2)],
      forfeits: [],
      config: CONFIG,
      lastRound: 1,
      matchFormat: QUALIF,
    });

    const points = pointsOf(standings);
    for (const teamId of [1, 2, 3, 4]) {
      expect(points.get(teamId)).toBe(CONFIG.startPoints);
    }
  });

  it("suit le barème quand il est asymétrique — c'est bien deux maps de chaque côté", () => {
    // +2 par map gagnée, −1 par map perdue : un 2-2 rapporte 2 × 2 − 2 × 1 = +2
    // à **chacune**. Le nul n'est pas un match blanc.
    const config: EnduranceConfig = { ...CONFIG, winDelta: 2, lossDelta: 1 };
    const standings = replayEndurance({
      teams: teams(2),
      matches: [draw(1, 1, 2, 2)],
      forfeits: [],
      config,
      lastRound: 1,
      matchFormat: QUALIF,
    });

    const points = pointsOf(standings);
    expect(points.get(1)).toBe(config.startPoints + 2);
    expect(points.get(2)).toBe(config.startPoints + 2);
  });

  it("peut éliminer sur un barème où la défaite pèse plus que la victoire", () => {
    // +1 / −2, capital de 2 : un 2-2 retire 2 points à chacune, donc les vide.
    const config: EnduranceConfig = { ...CONFIG, startPoints: 2, winDelta: 1, lossDelta: 2 };
    const standings = replayEndurance({
      teams: teams(2),
      matches: [draw(1, 1, 2, 2)],
      forfeits: [],
      config,
      lastRound: 1,
      matchFormat: QUALIF,
    });

    expect(standings.map((s) => s.status)).toEqual(["ELIMINATED", "ELIMINATED"]);
    expect(standings.every((s) => s.points === 0)).toBe(true);
  });

  it("compte le nul à part : ni victoire, ni défaite", () => {
    const standings = replayEndurance({
      teams: teams(2),
      matches: [draw(1, 1, 2, 2), draw(2, 1, 2, 1)],
      forfeits: [],
      config: CONFIG,
      lastRound: 2,
      matchFormat: QUALIF,
    });

    const one = standings.find((s) => s.teamId === 1)!;
    expect(one).toMatchObject({ wins: 0, losses: 0, draws: 2 });
  });

  it("laisse les victoires intactes à côté des nuls", () => {
    const standings = replayEndurance({
      teams: teams(4),
      matches: [win(1, 1, 2, 3, 0), draw(1, 3, 4, 2)],
      forfeits: [],
      config: CONFIG,
      lastRound: 1,
      matchFormat: QUALIF,
    });

    const points = pointsOf(standings);
    expect(points.get(1)).toBe(CONFIG.startPoints + 3);
    expect(points.get(2)).toBe(CONFIG.startPoints - 3);
    expect(points.get(3)).toBe(CONFIG.startPoints);
    expect(points.get(4)).toBe(CONFIG.startPoints);

    // Le classement reste départagé par l'ordre précédent, donc par le seed.
    expect(standings.map((s) => s.teamId)).toEqual([1, 3, 4, 2]);
  });

  it("ignore un nul dont un des deux camps est déjà sorti", () => {
    // Une correction de score peut faire apparaître ce cas : le moteur, lui,
    // n'apparie que des équipes actives.
    const config: EnduranceConfig = { ...CONFIG, startPoints: 3 };
    const standings = replayEndurance({
      teams: teams(3),
      matches: [win(1, 3, 1, 3, 0), draw(2, 1, 2, 2)],
      forfeits: [],
      config,
      lastRound: 2,
      matchFormat: QUALIF,
    });

    const points = pointsOf(standings);
    // 1 est tombée à 0 en manche 1 : le nul de la manche 2 ne la ressuscite pas
    // et ne compte pas pour 2 non plus.
    expect(points.get(1)).toBe(0);
    expect(standings.find((s) => s.teamId === 1)!.status).toBe("ELIMINATED");
    expect(points.get(2)).toBe(config.startPoints);
    expect(standings.find((s) => s.teamId === 2)!.draws).toBe(0);
  });

  it("traite un nul sans score enregistré comme un match qui ne déplace rien", () => {
    const standings = replayEndurance({
      teams: teams(2),
      matches: [{ round: 1, completed: true, winnerTeamId: null, loserTeamId: null, drawTeamIds: [1, 2] }],
      forfeits: [],
      config: CONFIG,
      lastRound: 1,
      matchFormat: QUALIF,
    });

    expect(pointsOf(standings).get(1)).toBe(CONFIG.startPoints);
    expect(standings.find((s) => s.teamId === 1)!.draws).toBe(1);
  });

  it("laisse la coupe mathématique inchangée : un nul tombe entre les deux bornes", () => {
    // Le meilleur cas d'une équipe reste de gagner trois maps, son pire cas
    // d'en perdre trois — un 2-2 est strictement à l'intérieur, l'ouverture des
    // égalités n'élargit donc aucune amplitude.
    const config: EnduranceConfig = { ...CONFIG, playoffSize: 2 };
    const standings = replayEndurance({
      teams: teams(4),
      matches: [draw(1, 1, 2, 2), win(1, 3, 4, 3, 0)],
      forfeits: [],
      config,
      lastRound: 1,
      matchFormat: QUALIF,
    });

    // Une seule manche restante : personne n'est encore hors d'atteinte.
    expect(enduranceEliminationCut(standings, config, 1, QUALIF)).toEqual([]);
  });
});

describe("rejeu d'endurance — ce qui n'est pas un nul", () => {
  /**
   * Le critère du nul doit être **celui de `playedMatchSql`**, mot pour mot :
   * clos, sans vainqueur, sans forfait, deux équipes, et deux scores égaux non
   * nuls. Sans les scores, une ligne abîmée comptait ici pour un nul 0-0 alors
   * que les fiches l'ignoraient — la même rencontre jouée d'un côté, inexistante
   * de l'autre.
   */
  it("ignore une manche close sans vainqueur ni score", () => {
    const standings = replayEndurance({
      teams: teams(2),
      matches: [
        { round: 1, completed: true, winnerTeamId: null, loserTeamId: null, drawTeamIds: null },
      ],
      forfeits: [],
      config: CONFIG,
      lastRound: 1,
      matchFormat: QUALIF,
    });

    expect(pointsOf(standings).get(1)).toBe(CONFIG.startPoints);
    expect(standings.every((s) => s.draws === 0)).toBe(true);
  });
});
