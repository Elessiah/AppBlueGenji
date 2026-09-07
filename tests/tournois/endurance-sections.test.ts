import { describe, it, expect } from "@jest/globals";
import type { BracketMatch, MatchStatus } from "@/lib/shared/types";
import {
  PLAYOFF_ROUND_OFFSET,
  defaultOpenEnduranceRound,
  endurancePlayoffLinks,
  endurancePlayoffRoundCount,
  enduranceMatchCountLabel,
  enduranceProgressLabel,
  enduranceRoundOfMatch,
  enduranceRoundRegionLabel,
  enduranceRoundSections,
  PLAYOFF_ROUND_OFFSET,
  splitEnduranceMatches,
  splitPlayoffBrackets,
} from "@/app/(secured)/tournois/[id]/_lib/endurance-sections";
import { PLAYOFF_ROUND_OFFSET as ENGINE_PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie";

const mockMatch = (overrides: Partial<BracketMatch>): BracketMatch => ({
  id: 1,
  tournamentId: 1,
  bracket: "UPPER",
  roundNumber: 1,
  matchNumber: 1,
  // « Jouée » se lit désormais sur le **statut**, plus sur la présence d'un
  // vainqueur : un match nul n'en a pas et est pourtant terminé
  // (`lib/shared/match-outcome.ts`). Le défaut dérive donc le statut du
  // vainqueur, pour que les cas écrits avant disent exactement la même chose ;
  // un cas qui vise le nul pose `status: "COMPLETED"` sans vainqueur.
  status: (overrides.winnerTeamId != null ? "COMPLETED" : "PENDING") as MatchStatus,
  team1Id: null,
  team2Id: null,
  team1Name: null,
  team2Name: null,
  team1Placeholder: null,
  team2Placeholder: null,
  team1Score: null,
  team2Score: null,
  winnerTeamId: null,
  loserTeamId: null,
  forfeitTeamId: null,
  nextWinnerMatchId: null,
  nextWinnerSlot: null,
  nextLoserMatchId: null,
  nextLoserSlot: null,
  scoreDeadlineAt: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

/** Manche qualificative : deux équipes, vainqueur optionnel. */
const round = (
  id: number,
  roundNumber: number,
  matchNumber: number,
  winner: number | null = null,
): BracketMatch =>
  mockMatch({
    id,
    roundNumber,
    matchNumber,
    team1Id: id * 10,
    team2Id: id * 10 + 1,
    winnerTeamId: winner,
  });

describe("splitEnduranceMatches", () => {
  it("sépare la phase qualificative de l'arbre final sur le seuil du moteur", () => {
    const matches = [
      round(1, 1, 1),
      round(2, 2, 1),
      mockMatch({ id: 3, roundNumber: PLAYOFF_ROUND_OFFSET, matchNumber: 1 }),
      mockMatch({ id: 4, roundNumber: PLAYOFF_ROUND_OFFSET + 2, matchNumber: 1 }),
    ];

    const { qualification, playoffs } = splitEnduranceMatches(matches);
    expect(qualification.map((m) => m.id)).toEqual([1, 2]);
    expect(playoffs.map((m) => m.id)).toEqual([3, 4]);
  });

  it("rend deux listes vides sur un plateau encore sans rencontre", () => {
    expect(splitEnduranceMatches([])).toEqual({ qualification: [], playoffs: [] });
  });
});

describe("enduranceRoundSections", () => {
  it("fait un volet par manche, dans l'ordre chronologique", () => {
    // Volontairement mélangées : l'ordre du volet ne doit rien devoir à celui
    // dans lequel le flux livre les matchs.
    const sections = enduranceRoundSections([round(3, 2, 1), round(1, 1, 1), round(2, 1, 2)]);

    expect(sections.map((s) => s.round)).toEqual([1, 2]);
    expect(sections.map((s) => s.title)).toEqual(["Manche 1", "Manche 2"]);
    expect(sections.map((s) => s.key)).toEqual(["manche-1", "manche-2"]);
  });

  it("ordonne les rencontres d'une manche par leur numéro de match", () => {
    const [section] = enduranceRoundSections([round(9, 1, 3), round(7, 1, 1), round(8, 1, 2)]);
    expect(section.matches.map((m) => m.id)).toEqual([7, 8, 9]);
  });

  it("compte l'avancement d'une manche sur les rencontres tranchées", () => {
    const sections = enduranceRoundSections([
      round(1, 1, 1, 10),
      round(2, 1, 2, 20),
      round(3, 2, 1, 30),
      round(4, 2, 2),
    ]);

    expect(sections[0]).toMatchObject({ playedCount: 2, totalCount: 2, isComplete: true });
    expect(sections[1]).toMatchObject({ playedCount: 1, totalCount: 2, isComplete: false });
  });

  it("ne déclare pas complète une manche vide", () => {
    // `isComplete` se lit « tout est joué » : sur zéro rencontre, l'égalité
    // 0 === 0 rendrait vrai une manche qui n'a rien à montrer.
    expect(enduranceRoundSections([])).toEqual([]);
  });
});

describe("defaultOpenEnduranceRound", () => {
  const sections = enduranceRoundSections([
    round(1, 1, 1, 10),
    round(2, 1, 2, 20),
    round(3, 2, 1),
    round(4, 2, 2),
  ]);

  it("ouvre la manche où le lecteur a une rencontre à jouer", () => {
    // L'équipe 40 joue le match 4, dans la manche 2 : c'est celle-là.
    expect(defaultOpenEnduranceRound(sections, 40, false)).toBe(2);
  });

  it("préfère une rencontre à jouer à une rencontre déjà tranchée", () => {
    // L'équipe 10 a joué la manche 1 (tranchée) et rien d'autre : aucune
    // rencontre en attente, on retombe donc sur la manche courante.
    expect(defaultOpenEnduranceRound(sections, 10, false)).toBe(2);
  });

  it("ouvre sinon la première manche inachevée — celle qui bouge", () => {
    expect(defaultOpenEnduranceRound(sections, null, false)).toBe(2);
  });

  it("ouvre la dernière manche quand tout est joué et que l'arbre n'a pas commencé", () => {
    const played = enduranceRoundSections([round(1, 1, 1, 10), round(3, 2, 1, 30)]);
    expect(defaultOpenEnduranceRound(played, null, false)).toBe(2);
  });

  it("ne déplie rien une fois les play-offs lancés", () => {
    // C'est l'arbre qui porte l'action : déplier par-dessus une manche close le
    // repousserait sous la ligne de flottaison.
    const played = enduranceRoundSections([round(1, 1, 1, 10), round(3, 2, 1, 30)]);
    expect(defaultOpenEnduranceRound(played, null, true)).toBeNull();
  });

  it("ouvre malgré tout la manche du lecteur si elle reste à jouer", () => {
    // Cas limite : l'arbre est lancé mais une rencontre du lecteur traîne. Elle
    // prime — c'est la seule chose qu'il ait à faire.
    expect(defaultOpenEnduranceRound(sections, 40, true)).toBe(2);
  });

  it("ne rend rien sur un plateau sans manche", () => {
    expect(defaultOpenEnduranceRound([], 40, false)).toBeNull();
  });
});

describe("enduranceRoundOfMatch", () => {
  const sections = enduranceRoundSections([round(1, 1, 1), round(2, 2, 1)]);

  it("retrouve la manche d'un match", () => {
    expect(enduranceRoundOfMatch(sections, 2)).toBe(2);
  });

  it("rend null pour un match qui n'est pas en phase qualificative", () => {
    // Le cas d'une ancre visant une rencontre de play-offs : c'est l'arbre qui
    // s'en charge, pas les volets de manche.
    expect(enduranceRoundOfMatch(sections, 999)).toBeNull();
  });
});

describe("splitPlayoffBrackets", () => {
  it("isole la petite finale, posée dans la même manche que la finale", () => {
    const final = mockMatch({ id: 1, roundNumber: PLAYOFF_ROUND_OFFSET + 2, matchNumber: 1 });
    const third = mockMatch({
      id: 2,
      bracket: "THIRD_PLACE",
      roundNumber: PLAYOFF_ROUND_OFFSET + 2,
      matchNumber: 2,
    });

    const { decisive, thirdPlace } = splitPlayoffBrackets([final, third]);
    expect(decisive.map((m) => m.id)).toEqual([1]);
    expect(thirdPlace.map((m) => m.id)).toEqual([2]);
  });
});

describe("endurancePlayoffLinks", () => {
  /** Un tour de l'arbre : `count` rencontres numérotées à partir de 1. */
  const playoffRound = (roundNumber: number, ids: number[]): BracketMatch[] =>
    ids.map((id, index) =>
      mockMatch({ id, roundNumber, matchNumber: index + 1, team1Id: id, team2Id: id + 100 }),
    );

  it("apparie les vainqueurs deux à deux, comme le moteur", () => {
    // Quarts (1..4) → demies (5, 6) → finale (7), la règle de
    // `finalizePlayoffsIfDone` : winners[2i] et winners[2i+1] forment le match
    // i+1 du tour suivant.
    const matches = [
      ...playoffRound(PLAYOFF_ROUND_OFFSET, [1, 2, 3, 4]),
      ...playoffRound(PLAYOFF_ROUND_OFFSET + 1, [5, 6]),
      ...playoffRound(PLAYOFF_ROUND_OFFSET + 2, [7]),
    ];

    const links = endurancePlayoffLinks(matches);
    expect([...links.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [1, 5],
      [2, 5],
      [3, 6],
      [4, 6],
      [5, 7],
      [6, 7],
    ]);
  });

  it("ne lie rien depuis le dernier tour créé", () => {
    // Le tour suivant n'existe pas encore : le trait doit s'arrêter là, et non
    // pointer sur une rencontre inventée.
    const links = endurancePlayoffLinks(playoffRound(PLAYOFF_ROUND_OFFSET, [1, 2, 3, 4]));
    expect(links.size).toBe(0);
  });

  it("suit l'ordre des numéros de match, pas celui de la liste", () => {
    const first = playoffRound(PLAYOFF_ROUND_OFFSET, [1, 2, 3, 4]);
    const second = playoffRound(PLAYOFF_ROUND_OFFSET + 1, [5, 6]);
    const links = endurancePlayoffLinks([...second, ...first.reverse()]);
    expect(links.get(1)).toBe(5);
    expect(links.get(4)).toBe(6);
  });

  it("laisse sans cible le vainqueur surnuméraire d'un tour impair", () => {
    // Plateau qui n'est pas une puissance de deux : le moteur crée deux matchs
    // pour trois vainqueurs (le dernier passe le tour, dans le second). Le
    // troisième match du tour amont vise donc bien le second match aval.
    const links = endurancePlayoffLinks([
      ...playoffRound(PLAYOFF_ROUND_OFFSET, [1, 2, 3]),
      ...playoffRound(PLAYOFF_ROUND_OFFSET + 1, [4, 5]),
    ]);
    expect(links.get(1)).toBe(4);
    expect(links.get(2)).toBe(4);
    expect(links.get(3)).toBe(5);
  });

  it("ne rend aucun lien pour l'unique rencontre d'un arbre à deux", () => {
    expect(endurancePlayoffLinks(playoffRound(PLAYOFF_ROUND_OFFSET, [1])).size).toBe(0);
  });
});

describe("endurancePlayoffRoundCount", () => {
  const playoffRound = (roundNumber: number, count: number): BracketMatch[] =>
    Array.from({ length: count }, (_, index) =>
      mockMatch({
        id: roundNumber * 10 + index,
        roundNumber,
        matchNumber: index + 1,
        team1Id: index + 1,
        team2Id: index + 100,
      }),
    );

  it("annonce les trois tours d'un plateau à huit dès les seuls quarts", () => {
    // Le cœur du problème : à l'ouverture des play-offs, seul le premier tour
    // existe. Le compter naïvement nommait les quarts « Finale ».
    expect(endurancePlayoffRoundCount(playoffRound(PLAYOFF_ROUND_OFFSET, 4))).toBe(3);
  });

  it("tient le même compte à mesure que les tours arrivent", () => {
    const quarters = playoffRound(PLAYOFF_ROUND_OFFSET, 4);
    const semis = playoffRound(PLAYOFF_ROUND_OFFSET + 1, 2);
    const final = playoffRound(PLAYOFF_ROUND_OFFSET + 2, 1);

    expect(endurancePlayoffRoundCount([...quarters, ...semis])).toBe(3);
    expect(endurancePlayoffRoundCount([...quarters, ...semis, ...final])).toBe(3);
  });

  it("arrondit vers le haut sur un plateau qui n'est pas une puissance de deux", () => {
    // Cinq qualifiées → trois rencontres au premier tour (dont une exemption),
    // puis deux, puis une : trois tours.
    expect(endurancePlayoffRoundCount(playoffRound(PLAYOFF_ROUND_OFFSET, 3))).toBe(3);
  });

  it("compte deux tours pour un demi-finales / finale, un pour une finale sèche", () => {
    expect(endurancePlayoffRoundCount(playoffRound(PLAYOFF_ROUND_OFFSET, 2))).toBe(2);
    expect(endurancePlayoffRoundCount(playoffRound(PLAYOFF_ROUND_OFFSET, 1))).toBe(1);
  });

  it("ne rend rien tant que l'arbre n'a pas commencé", () => {
    expect(endurancePlayoffRoundCount([])).toBe(0);
  });

  it("ne sous-estime jamais le nombre de tours réellement posés", () => {
    // Filet de sécurité : si le moteur créait un tour de plus que la déduction
    // ne le prévoit, c'est le réel qui gagne — un tour posé doit être nommé.
    expect(
      endurancePlayoffRoundCount([
        ...playoffRound(PLAYOFF_ROUND_OFFSET, 1),
        ...playoffRound(PLAYOFF_ROUND_OFFSET + 1, 1),
      ]),
    ).toBe(2);
  });
});

describe("libellés d'un volet de manche", () => {
  const sectionOf = (total: number, played: number) => {
    const matches = Array.from({ length: total }, (_, index) =>
      round(index + 1, 1, index + 1, index < played ? 10 : null),
    );
    return enduranceRoundSections(matches)[0];
  };

  it("accorde le nombre de rencontres", () => {
    // Un effectif actif impair fait chômer une équipe : à trois équipes en
    // lice, la manche n'en porte qu'une. Le singulier est un cas courant.
    expect(enduranceMatchCountLabel(1)).toBe("1 match");
    expect(enduranceMatchCountLabel(4)).toBe("4 matchs");
  });

  it("accorde aussi l'avancement, sur le total et non sur le joué", () => {
    expect(enduranceProgressLabel(sectionOf(1, 0))).toBe("0/1 jouée");
    expect(enduranceProgressLabel(sectionOf(4, 1))).toBe("1/4 jouées");
    expect(enduranceProgressLabel(sectionOf(4, 0))).toBe("0/4 jouées");
  });

  it("énonce le volet en toutes lettres pour un lecteur d'écran", () => {
    // Ni barre oblique (« zéro barre oblique un ») ni pastille muette : le
    // titre seul ne porte ni la taille de la manche ni son avancement.
    expect(enduranceRoundRegionLabel(sectionOf(1, 0))).toBe("Manche 1, 1 match, 0 sur 1 jouée");
    expect(enduranceRoundRegionLabel(sectionOf(4, 2))).toBe("Manche 1, 4 matchs, 2 sur 4 jouées");
  });

  it("dit d'un mot qu'une manche est close, sans compter", () => {
    expect(enduranceRoundRegionLabel(sectionOf(4, 4))).toBe("Manche 1, 4 matchs, terminée");
  });
});

describe("enduranceRoundSections — matchs nuls", () => {
  it("compte un match nul parmi les rencontres jouées", () => {
    // `winnerTeamId !== null` faisait annoncer « 1/2 jouées » à une manche
    // complète, et `isComplete` restait faux : la manche ne se refermait jamais.
    const sections = enduranceRoundSections([
      mockMatch({ id: 1, roundNumber: 1, status: "COMPLETED", winnerTeamId: 1 }),
      mockMatch({ id: 2, roundNumber: 1, status: "COMPLETED", team1Score: 2, team2Score: 2 }),
    ]);

    expect(sections[0].playedCount).toBe(2);
    expect(sections[0].isComplete).toBe(true);
  });

  it("n'ouvre pas d'office une manche où le lecteur n'a plus rien à jouer", () => {
    const sections = enduranceRoundSections([
      mockMatch({
        id: 1,
        roundNumber: 1,
        status: "COMPLETED",
        team1Id: 7,
        team2Id: 8,
        team1Score: 2,
        team2Score: 2,
      }),
      mockMatch({ id: 2, roundNumber: 2, team1Id: 7, team2Id: 9 }),
    ]);

    // Sa manche 1 s'est close sur un nul : c'est la 2 qui l'attend.
    expect(defaultOpenEnduranceRound(sections, 7, false)).toBe(2);
  });
});

describe("frontière des play-offs — une seule source", () => {
  it("réexporte la constante du moteur au lieu d'en tenir une copie", () => {
    // Trois lectures partagent ce palier : le moteur qui numérote l'arbre, cette
    // vue qui le découpe, et la résolution du format de match (le mode en joue
    // deux). Une copie locale les laisserait diverger — remonter le palier côté
    // moteur afficherait des manches qualificatives à l'intérieur de l'arbre.
    expect(PLAYOFF_ROUND_OFFSET).toBe(ENGINE_PLAYOFF_ROUND_OFFSET);
  });

  it("découpe bien sur cette frontière, et pas une autre", () => {
    const { qualification, playoffs } = splitEnduranceMatches([
      mockMatch({ id: 1, roundNumber: ENGINE_PLAYOFF_ROUND_OFFSET - 1 }),
      mockMatch({ id: 2, roundNumber: ENGINE_PLAYOFF_ROUND_OFFSET }),
    ]);

    expect(qualification.map((m) => m.id)).toEqual([1]);
    expect(playoffs.map((m) => m.id)).toEqual([2]);
  });
});
