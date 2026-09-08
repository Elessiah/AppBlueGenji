import { describe, expect, it } from "@jest/globals";

import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie";
import {
  compareRollbackStages,
  planRoundRollback,
  rollbackStageKey,
  rollbackStageLabel,
  rollbackStageLabelWithArticle,
  type RollbackMatch,
  type RollbackPlan,
} from "@/lib/shared/tournament-rollback";

/**
 * Une rencontre du plateau, telle que le module la reçoit.
 *
 * Les valeurs par défaut décrivent une rencontre **posée mais pas jouée** : deux
 * engagées, aucun score. C'est l'état dans lequel naît un plateau à élimination,
 * et celui auquel un retour en arrière ramène une manche.
 */
function match(seed: Partial<RollbackMatch> & { id: number; roundNumber: number }): RollbackMatch {
  return {
    bracket: "UPPER",
    team1Id: seed.id * 10,
    team2Id: seed.id * 10 + 1,
    team1Score: null,
    team2Score: null,
    winnerTeamId: null,
    forfeitTeamId: null,
    decided: false,
    hasPendingReport: false,
    nextWinnerMatchId: null,
    nextLoserMatchId: null,
    ...seed,
  };
}

/**
 * La même rencontre, jouée.
 *
 * Écrite comme une **surcouche** et non comme un second constructeur : appeler
 * `match({ ...source, team1Score: 3 })` marcherait, mais laisserait la porte
 * ouverte à un appel qui réétale les valeurs par défaut sur les liens du
 * plateau — et effacerait donc silencieusement la structure qu'on teste.
 */
function play(source: RollbackMatch): RollbackMatch {
  return { ...source, team1Score: 3, team2Score: 1, winnerTeamId: source.team1Id, decided: true };
}

/** Le plan, ou l'échec du test : les refus sont vérifiés à part. */
function plan(matches: readonly RollbackMatch[]): RollbackPlan {
  const result = planRoundRollback(matches);
  if (typeof result === "string") throw new Error(`refus inattendu : ${result}`);
  return result;
}

/** Manches d'un format à classement : `count` rencontres par manche, sans lien. */
function rankingRounds(rounds: number[], perRound = 2): RollbackMatch[] {
  const matches: RollbackMatch[] = [];
  let id = 1;
  for (const roundNumber of rounds) {
    for (let n = 0; n < perRound; n += 1) matches.push(match({ id: id++, roundNumber }));
  }
  return matches;
}

/**
 * Plateau à élimination simple pour quatre équipes, petite finale comprise.
 *
 * Reproduit ce qu'écrit `bracket-single.ts` : la petite finale porte le numéro
 * de **manche 1** (elle n'a pas de tour amont à numéroter) alors qu'elle se joue
 * avec la finale, et les deux demies y envoient leur perdant.
 */
function singleBracketOfFour(): {
  semi1: RollbackMatch;
  semi2: RollbackMatch;
  final: RollbackMatch;
  third: RollbackMatch;
  all: RollbackMatch[];
} {
  const final = match({ id: 3, roundNumber: 2 });
  const third = match({ id: 4, roundNumber: 1, bracket: "THIRD_PLACE" });
  const semi1 = match({ id: 1, roundNumber: 1, nextWinnerMatchId: 3, nextLoserMatchId: 4 });
  const semi2 = match({ id: 2, roundNumber: 1, nextWinnerMatchId: 3, nextLoserMatchId: 4 });
  return { semi1, semi2, final, third, all: [semi1, semi2, final, third] };
}

/**
 * Plateau à double élimination pour quatre équipes.
 *
 * Reproduit `bracket-double.ts` : deux manches de tableau principal, deux de
 * repêchage, une grande finale. Les numéros de manche des deux tableaux ne se
 * comparent pas — c'est tout l'intérêt du cas.
 */
function doubleBracketOfFour(): Record<
  "u1a" | "u1b" | "u2" | "lb1" | "lb2" | "grand",
  RollbackMatch
> & { all: RollbackMatch[] } {
  const grand = match({ id: 6, roundNumber: 1, bracket: "GRAND" });
  const lb2 = match({ id: 5, roundNumber: 2, bracket: "LOWER", nextWinnerMatchId: 6 });
  const lb1 = match({ id: 4, roundNumber: 1, bracket: "LOWER", nextWinnerMatchId: 5 });
  const u2 = match({ id: 3, roundNumber: 2, nextWinnerMatchId: 6, nextLoserMatchId: 5 });
  const u1a = match({ id: 1, roundNumber: 1, nextWinnerMatchId: 3, nextLoserMatchId: 4 });
  const u1b = match({ id: 2, roundNumber: 1, nextWinnerMatchId: 3, nextLoserMatchId: 4 });
  return { u1a, u1b, u2, lb1, lb2, grand, all: [u1a, u1b, u2, lb1, lb2, grand] };
}

describe("planRoundRollback — élimination simple", () => {
  it("vise la dernière manche jouée, pas la dernière posée", () => {
    // Tout le plateau naît au lancement : la finale existe dès la première
    // rencontre. Viser la dernière manche *créée* ne défairait jamais rien.
    const { semi1, semi2, final, third } = singleBracketOfFour();
    const result = plan([play(semi1), semi2, final, third]);

    expect(result.roundNumber).toBe(1);
    expect(result.clearedMatchIds.sort()).toEqual([1, 2]);
  });

  it("détache ce qui suit au lieu de le supprimer", () => {
    // Un identifiant de match est une adresse publique : lien profond, horaire
    // annoncé, diffusion programmée. La structure du plateau reste debout.
    const { semi1, semi2, final, third } = singleBracketOfFour();
    const result = plan([play(semi1), semi2, final, third]);

    expect(result.detachedMatchIds.sort()).toEqual([3, 4]);
    expect(result.deletedMatchIds).toEqual([]);
  });

  it("range la petite finale au stade de la finale", () => {
    // Elle est créée en manche 1 mais se joue avec la finale : la ranger sur son
    // numéro l'effacerait en défaisant le premier tour, et la laisserait debout
    // en défaisant la finale.
    const { semi1, semi2, final, third } = singleBracketOfFour();
    const result = plan([semi1, semi2, play(final), play(third)]);

    expect(result.clearedMatchIds.sort()).toEqual([3, 4]);
    expect(result.roundNumber).toBe(2);
  });

  it("efface la petite finale avec la finale même si elle n'est pas jouée", () => {
    const { semi1, semi2, final, third } = singleBracketOfFour();
    const result = plan([semi1, semi2, play(final), third]);

    expect(result.clearedMatchIds.sort()).toEqual([3, 4]);
  });

  it("recule d'une manche à chaque appel, jusqu'au premier tour", () => {
    // Le geste est fait pour se répéter : on rattrape une erreur d'un cran ou
    // deux, on ne recommence pas le tournoi.
    const { semi1, semi2, final, third } = singleBracketOfFour();
    const played = [play(semi1), play(semi2), play(final), play(third)];

    const first = plan(played);
    expect(first.roundNumber).toBe(2);

    // Le stade effacé revient vierge, les suivants sont détachés.
    const afterFirst = [played[0], played[1], final, third];
    const second = plan(afterFirst);
    expect(second.roundNumber).toBe(1);
    expect(second.clearedMatchIds.sort()).toEqual([1, 2]);

    const afterSecond = [semi1, semi2, final, third];
    expect(planRoundRollback(afterSecond)).toBe("ROLLBACK_NOTHING_TO_UNDO");
  });

  it("ignore les byes, dont le score est posé par le moteur", () => {
    const bye = match({
      id: 1,
      roundNumber: 1,
      team2Id: null,
      team1Score: 1,
      team2Score: 0,
      nextWinnerMatchId: 3,
    });
    const real = match({ id: 2, roundNumber: 1, nextWinnerMatchId: 3 });
    const final = match({ id: 3, roundNumber: 2 });

    expect(planRoundRollback([bye, real, final])).toBe("ROLLBACK_NOTHING_TO_UNDO");

    // Une fois la manche réellement jouée, le bye est bien vidé avec elle : son
    // 1-0 sera reposé par `tryAutoResolveByes`.
    const result = plan([bye, play(real), final]);
    expect(result.clearedMatchIds.sort()).toEqual([1, 2]);
  });

  it("traite un plateau d'une seule manche sans lien", () => {
    // Deux équipes : la finale est le seul match, et il n'a rien à lier.
    const only = match({ id: 1, roundNumber: 1 });
    const result = plan([play(only)]);

    expect(result.clearedMatchIds).toEqual([1]);
    expect(result.roundNumber).toBe(1);
  });
});

describe("planRoundRollback — double élimination", () => {
  it("ordonne les deux tableaux par le graphe, pas par leurs numéros", () => {
    // « Manche 2 » désigne ici deux stades sans rapport : la finale du tableau
    // principal et le dernier tour du repêchage, qui se joue après elle.
    const board = doubleBracketOfFour();
    const played = board.all.map((entry) => (entry.id === 6 ? entry : play(entry)));

    const result = plan(played);
    expect(result.clearedMatchIds).toEqual([5]);
    expect(result.detachedMatchIds).toEqual([6]);
  });

  it("groupe les rencontres contemporaines des deux tableaux", () => {
    // Le premier tour de repêchage se joue en même temps que la seconde manche
    // du tableau principal : ni l'un ni l'autre ne dépend de l'autre.
    const board = doubleBracketOfFour();
    const played = [
      play(board.u1a),
      play(board.u1b),
      play(board.u2),
      play(board.lb1),
      board.lb2,
      board.grand,
    ];

    const result = plan(played);
    expect(result.clearedMatchIds.sort()).toEqual([3, 4]);
    expect(result.detachedMatchIds.sort()).toEqual([5, 6]);
  });

  it("remonte jusqu'au premier tour, un stade à la fois", () => {
    const board = doubleBracketOfFour();
    const stages: number[][] = [];
    let current = board.all.map(play);

    for (let step = 0; step < 4; step += 1) {
      const result = plan(current);
      stages.push([...result.clearedMatchIds].sort());
      const cleared = new Set(result.clearedMatchIds);
      current = current.map((entry) =>
        cleared.has(entry.id) ? board.all.find((m) => m.id === entry.id)! : entry,
      );
    }

    expect(stages).toEqual([[6], [5], [3, 4], [1, 2]]);
    expect(planRoundRollback(current)).toBe("ROLLBACK_NOTHING_TO_UNDO");
  });
});

describe("planRoundRollback — formats à classement", () => {
  it("vise la dernière manche saisie", () => {
    const matches = rankingRounds([1, 2, 3]);
    const played = matches.map((entry) => (entry.roundNumber <= 2 ? play(entry) : entry));

    const result = plan(played);
    expect(result.roundNumber).toBe(2);
    expect(result.clearedMatchIds.sort()).toEqual([3, 4]);
  });

  it("supprime les manches suivantes au lieu de les détacher", () => {
    // Le moteur les pose une à une depuis un classement que le retour en arrière
    // vient de défaire : leurs appariements sont périmés, il les reposera.
    const matches = rankingRounds([1, 2, 3]);
    const played = matches.map((entry) => (entry.roundNumber <= 2 ? play(entry) : entry));

    const result = plan(played);
    expect(result.deletedMatchIds.sort()).toEqual([5, 6]);
    expect(result.detachedMatchIds).toEqual([]);
  });

  it("refuse quand plus rien n'est saisi", () => {
    expect(planRoundRollback(rankingRounds([1, 2]))).toBe("ROLLBACK_NOTHING_TO_UNDO");
    expect(planRoundRollback([])).toBe("ROLLBACK_NOTHING_TO_UNDO");
  });

  it("compte un report en attente comme une saisie", () => {
    const [first, second] = rankingRounds([1], 2);
    const result = plan([{ ...first, hasPendingReport: true }, second]);

    expect(result.roundNumber).toBe(1);
  });
});

describe("planRoundRollback — BlueGenji Survie", () => {
  const qualification = rankingRounds([1, 2], 2);
  const semis = [
    match({ id: 10, roundNumber: PLAYOFF_ROUND_OFFSET }),
    match({ id: 11, roundNumber: PLAYOFF_ROUND_OFFSET }),
  ];
  const finals = [
    match({ id: 12, roundNumber: PLAYOFF_ROUND_OFFSET + 1 }),
    match({ id: 13, roundNumber: PLAYOFF_ROUND_OFFSET + 1, bracket: "THIRD_PLACE" }),
  ];

  it("défait un tour d'arbre final sans toucher à la qualification", () => {
    const board = [...qualification.map(play), ...semis.map(play), ...finals];
    const result = plan(board);

    expect(result.playoffRound).toBe(true);
    expect(result.roundNumber).toBe(PLAYOFF_ROUND_OFFSET);
    expect(result.clearedMatchIds.sort()).toEqual([10, 11]);
    expect(result.deletedMatchIds.sort()).toEqual([12, 13]);
  });

  it("efface la petite finale avec la finale, elles partagent leur manche", () => {
    const board = [...qualification.map(play), ...semis.map(play), ...finals.map(play)];
    const result = plan(board);

    expect(result.clearedMatchIds.sort()).toEqual([12, 13]);
  });

  it("rend la main à la qualification une fois l'arbre vierge", () => {
    // Deux pas et non un seul : le premier vide le tour d'arbre, le second vise
    // la dernière manche qualificative et emporte l'arbre entier. C'est ce qui
    // rend le geste stable — la qualification achevée reposerait sinon l'arbre
    // dans la foulée.
    const board = [...qualification.map(play), ...semis, ...finals];
    const result = plan(board);

    expect(result.playoffRound).toBe(false);
    expect(result.roundNumber).toBe(2);
    expect(result.clearedMatchIds.sort()).toEqual([3, 4]);
    expect(result.deletedMatchIds.sort()).toEqual([10, 11, 12, 13]);
  });
});

describe("planRoundRollback — multi-phases", () => {
  /** Ronde suisse en phase 1, élimination simple en phase 2. */
  function twoPhases() {
    const swiss = rankingRounds([1, 2], 2).map((entry) => ({
      ...entry,
      phaseId: 30,
      phasePosition: 1,
    }));
    const final = match({ id: 20, roundNumber: 2, phaseId: 31, phasePosition: 2 });
    const semis = [
      match({ id: 21, roundNumber: 1, phaseId: 31, phasePosition: 2, nextWinnerMatchId: 20 }),
      match({ id: 22, roundNumber: 1, phaseId: 31, phasePosition: 2, nextWinnerMatchId: 20 }),
    ];
    return { swiss, final, semis };
  }

  it("classe une phase ultérieure après la précédente, quels que soient les numéros", () => {
    const { swiss, final, semis } = twoPhases();
    const result = plan([...swiss.map(play), ...semis.map(play), final]);

    expect(result.stage).toEqual({ phaseRank: 2, index: 0 });
    expect(result.clearedMatchIds.sort()).toEqual([21, 22]);
    expect(result.detachedMatchIds).toEqual([20]);
  });

  it("supprime toute phase ultérieure quand on rouvre celle d'avant", () => {
    // Son plateau a été posé avec les qualifiées de la phase qu'on rouvre : le
    // moteur le reposera avec les nouvelles.
    const { swiss, final, semis } = twoPhases();
    const result = plan([...swiss.map(play), ...semis, final]);

    expect(result.stage).toEqual({ phaseRank: 1, index: 2 });
    expect(result.clearedMatchIds.sort()).toEqual([3, 4]);
    expect(result.deletedMatchIds.sort()).toEqual([20, 21, 22]);
  });

  it("retombe sur l'identifiant de phase quand la position manque", () => {
    const early = rankingRounds([1], 1).map((entry) => ({ ...entry, phaseId: 30 }));
    const late = [match({ id: 9, roundNumber: 1, phaseId: 31 })];
    const result = plan([...early.map(play), ...late.map(play)]);

    expect(result.stage.phaseRank).toBe(31);
  });
});

describe("stades", () => {
  it("ordonne la phase avant l'index", () => {
    expect(compareRollbackStages({ phaseRank: 1, index: 9 }, { phaseRank: 2, index: 0 })).toBeLessThan(0);
    expect(compareRollbackStages({ phaseRank: 2, index: 1 }, { phaseRank: 2, index: 1 })).toBe(0);
  });

  it("porte une clé lisible et stable", () => {
    expect(rollbackStageKey({ phaseRank: 0, index: 3 })).toBe("0:3");
    expect(plan(rankingRounds([1, 2]).map(play)).stageKey).toBe("0:2");
  });
});

describe("libellés", () => {
  const stage = (phaseRank: number) => ({ phaseRank, index: 0 });

  it("nomme une manche ordinaire", () => {
    expect(rollbackStageLabel({ stage: stage(0), roundNumber: 4, playoffRound: false })).toBe(
      "manche 4",
    );
  });

  it("ramène les tours de l'arbre final à leur rang", () => {
    // Sans cela, le premier tour s'annoncerait « manche 1000 ».
    expect(
      rollbackStageLabel({
        stage: stage(0),
        roundNumber: PLAYOFF_ROUND_OFFSET,
        playoffRound: true,
      }),
    ).toBe("tour 1 des play-offs");
    expect(
      rollbackStageLabel({
        stage: stage(0),
        roundNumber: PLAYOFF_ROUND_OFFSET + 2,
        playoffRound: true,
      }),
    ).toBe("tour 3 des play-offs");
  });

  it("nomme la phase quand il y en a une", () => {
    expect(rollbackStageLabel({ stage: stage(2), roundNumber: 3, playoffRound: false })).toBe(
      "manche 3 de la phase 2",
    );
  });

  it("accorde l'article au genre du libellé", () => {
    // Une manche est féminine, un tour masculin : une seule forme se tromperait
    // une fois sur deux, sur un texte affiché à l'arbitre juste avant le geste.
    expect(
      rollbackStageLabelWithArticle({ stage: stage(0), roundNumber: 4, playoffRound: false }),
    ).toBe("la manche 4");
    expect(
      rollbackStageLabelWithArticle({
        stage: stage(0),
        roundNumber: PLAYOFF_ROUND_OFFSET,
        playoffRound: true,
      }),
    ).toBe("le tour 1 des play-offs");
  });
});
