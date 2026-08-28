import { describe, expect, it } from "@jest/globals";
import {
  SEEDING_SOURCE_LABELS,
  buildTournamentPreview,
  type PreviewEntrant,
  type TournamentPreviewInput,
} from "@/lib/shared/tournament-preview";
import { generateSeedOrder } from "@/lib/shared/bracket-seeds";
import type { PhaseConfig } from "@/lib/shared/tournament-phases";

/** N engagés nommés E1..EN, déjà dans l'ordre de seeding. */
function entrants(count: number): PreviewEntrant[] {
  return Array.from({ length: count }, (_, index) => ({
    teamId: index + 1,
    teamName: `E${index + 1}`,
    seed: index + 1,
  }));
}

function build(overrides: Partial<TournamentPreviewInput> = {}) {
  return buildTournamentPreview({
    format: "SINGLE",
    entrants: entrants(8),
    seedingSource: "REGISTRATION",
    ...overrides,
  });
}

/** Paires (teamId, teamId) d'un aperçu, byes et repos compris (null côté droit). */
function pairIds(preview: ReturnType<typeof build>): Array<[number | null, number | null]> {
  return preview.pairings.map((pairing) => [
    pairing.teamA?.teamId ?? null,
    pairing.teamB?.teamId ?? null,
  ]);
}

function phase(overrides: Partial<PhaseConfig> = {}): PhaseConfig {
  return {
    position: 1,
    format: "SWISS",
    name: null,
    qualifierMode: "COUNT",
    qualifierValue: 4,
    hasThirdPlaceMatch: false,
    swissTotalRounds: null,
    survivalRoundsBeforeFirstCut: null,
    survivalRoundsPerCut: null,
    ...overrides,
  };
}

describe("buildTournamentPreview — effectifs dégénérés", () => {
  it("ne propose aucun appariement sans inscription", () => {
    const preview = build({ entrants: [] });

    expect(preview.pairings).toEqual([]);
    expect(preview.bracketSize).toBeNull();
    expect(preview.notes[0]).toContain("Aucune inscription");
  });

  it("ne propose aucun appariement avec une seule inscription", () => {
    const preview = build({ entrants: entrants(1) });

    expect(preview.pairings).toEqual([]);
    expect(preview.notes[0]).toContain("au moins deux");
  });

  it("conserve le format et la provenance de l'ordre même sans appariement", () => {
    const preview = build({ format: "SURVIVAL", entrants: [], seedingSource: "RANKING" });

    expect(preview.format).toBe("SURVIVAL");
    expect(preview.seedingSource).toBe("RANKING");
    expect(preview.entrants).toEqual([]);
  });
});

describe("buildTournamentPreview — élimination", () => {
  it("apparie 1 contre 8, 4 contre 5… sur un plateau plein", () => {
    const preview = build({ entrants: entrants(8) });

    expect(preview.bracketSize).toBe(8);
    expect(preview.rounds).toBe(3);
    expect(preview.byeCount).toBe(0);
    expect(pairIds(preview)).toEqual([
      [1, 8],
      [4, 5],
      [2, 7],
      [3, 6],
    ]);
  });

  it("reproduit exactement le placement du moteur (même ordre de seeds)", () => {
    const preview = build({ entrants: entrants(16) });
    const expected = generateSeedOrder(16);

    // Les emplacements lus deux par deux doivent redonner l'ordre du moteur.
    const flat = preview.pairings.flatMap((pairing) => [
      pairing.teamA?.seed ?? null,
      pairing.teamB?.seed ?? null,
    ]);
    expect(flat).toEqual(expected);
  });

  it("laisse des emplacements vides et les compte comme exemptions", () => {
    const preview = build({ entrants: entrants(5) });

    expect(preview.bracketSize).toBe(8);
    expect(preview.byeCount).toBe(3);
    expect(pairIds(preview)).toEqual([
      [1, null],
      [4, 5],
      [2, null],
      [3, null],
    ]);
    expect(preview.pairings.filter((p) => p.kind === "BYE")).toHaveLength(3);
    expect(preview.notes.join(" ")).toContain("3 exemptions");
  });

  it("accorde le singulier à une exemption unique", () => {
    const preview = build({ entrants: entrants(3) });

    expect(preview.byeCount).toBe(1);
    expect(preview.notes.join(" ")).toContain("1 exemption ");
  });

  it("prévient que le tableau des perdants n'a pas d'appariement d'avance", () => {
    const preview = build({ format: "DOUBLE", entrants: entrants(4) });

    expect(preview.format).toBe("DOUBLE");
    expect(preview.bracketSize).toBe(4);
    expect(preview.notes.join(" ")).toContain("tableau des perdants");
  });

  it("n'annonce aucun nombre de manches en double élimination", () => {
    // Tableau principal + tableau des perdants + grande finale : la profondeur
    // du seul tableau principal en promettrait la moitié.
    expect(build({ format: "DOUBLE", entrants: entrants(8) }).rounds).toBeNull();
    expect(build({ format: "SINGLE", entrants: entrants(8) }).rounds).toBe(3);
  });

  it("compte les tours réellement joués d'un plateau tronqué", () => {
    const preview = build({ format: "SINGLE", entrants: entrants(32), maxRounds: 2 });

    expect(preview.bracketSize).toBe(32);
    expect(preview.rounds).toBe(2);
    expect(preview.notes.join(" ")).toContain("Plateau tronqué : 2 tours joués");
  });

  it("ignore un plafond de tours plus large que le plateau", () => {
    const preview = build({ format: "SINGLE", entrants: entrants(8), maxRounds: 9 });

    expect(preview.rounds).toBe(3);
    expect(preview.notes.join(" ")).not.toContain("tronqué");
  });
});

describe("buildTournamentPreview — ronde suisse", () => {
  it("oppose la moitié haute à la moitié basse", () => {
    const preview = build({ format: "SWISS", entrants: entrants(8), seedingSource: "RANKING" });

    expect(preview.roundLabel).toBe("Ronde 1");
    expect(pairIds(preview)).toEqual([
      [1, 5],
      [2, 6],
      [3, 7],
      [4, 8],
    ]);
    expect(preview.bracketSize).toBeNull();
  });

  it("donne la victoire d'office à la dernière sur effectif impair", () => {
    const preview = build({ format: "SWISS", entrants: entrants(5) });

    expect(preview.byeCount).toBe(1);
    const bye = preview.pairings[preview.pairings.length - 1];
    expect(bye.kind).toBe("BYE");
    expect(bye.teamA?.teamId).toBe(5);
    expect(bye.teamB).toBeNull();
    expect(preview.notes.join(" ")).toContain("E5");
  });

  it("retient le nombre de rondes du tournoi, sinon le recommandé", () => {
    expect(build({ format: "SWISS", entrants: entrants(8), swissTotalRounds: 5 }).rounds).toBe(5);
    // ⌈log₂(8)⌉ + 1
    expect(build({ format: "SWISS", entrants: entrants(8) }).rounds).toBe(4);
  });
});

describe("buildTournamentPreview — survie", () => {
  it("apparie les couples adjacents du classement", () => {
    const preview = build({ format: "SURVIVAL", entrants: entrants(6), seedingSource: "RANKING" });

    expect(preview.roundLabel).toBe("Round 1");
    expect(pairIds(preview)).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
  });

  it("ouvre par un barrage entre les deux dernières sur effectif impair", () => {
    const preview = build({ format: "SURVIVAL", entrants: entrants(7) });

    expect(preview.roundLabel).toBe("Barrage (round 1)");
    expect(pairIds(preview)).toEqual([[6, 7]]);
    expect(preview.pairings[0].kind).toBe("BARRAGE");
    expect(preview.notes.join(" ")).toContain("barrage");
  });

  it("annonce la cadence des coupes, défauts compris", () => {
    const custom = build({
      format: "SURVIVAL",
      entrants: entrants(4),
      survivalRoundsBeforeFirstCut: 1,
      survivalRoundsPerCut: 2,
    });
    expect(custom.notes.join(" ")).toContain("après 1 manche, puis toutes les 2 manches");

    const fallback = build({ format: "SURVIVAL", entrants: entrants(4) });
    expect(fallback.notes.join(" ")).toContain("après 3 manches, puis toutes les 3 manches");
  });
});

describe("buildTournamentPreview — BlueGenji Survie", () => {
  it("apparie les couples adjacents, mieux classée à gauche", () => {
    const preview = build({ format: "BG_SURVIE", entrants: entrants(4) });

    expect(preview.roundLabel).toBe("Manche 1");
    expect(pairIds(preview)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("fait reposer la dernière sur effectif impair, sans victoire d'office", () => {
    const preview = build({ format: "BG_SURVIE", entrants: entrants(5) });

    const last = preview.pairings[preview.pairings.length - 1];
    expect(last.kind).toBe("REST");
    expect(last.teamA?.teamId).toBe(5);
    // Un repos n'est pas une exemption : rien n'est gagné.
    expect(preview.byeCount).toBe(0);
    expect(preview.notes.join(" ")).toContain("ne joue pas la première manche");
  });

  it("annonce l'effectif de la phase éliminatoire", () => {
    expect(
      build({ format: "BG_SURVIE", entrants: entrants(4), endurancePlayoffSize: 6 }).notes.join(" "),
    ).toContain("s'arrête à 6 équipes");
    expect(build({ format: "BG_SURVIE", entrants: entrants(4) }).notes.join(" ")).toContain(
      "s'arrête à 8 équipes",
    );
  });

  it("normalise un effectif de play-offs absurde comme le fait le moteur", () => {
    // `resolveEnduranceConfig` refuse tout ce qui est < 2 : l'aperçu doit
    // annoncer la valeur que le moteur appliquera, pas celle de la colonne.
    for (const playoffSize of [1, 0, -4]) {
      expect(
        build({ format: "BG_SURVIE", entrants: entrants(4), endurancePlayoffSize: playoffSize })
          .notes.join(" "),
      ).toContain("s'arrête à 8 équipes");
    }
  });
});

describe("buildTournamentPreview — multi-phases", () => {
  const twoPhases = [
    phase({ position: 1, format: "SWISS", name: "Qualifs", qualifierValue: 4 }),
    phase({ position: 2, format: "SINGLE", qualifierValue: 1 }),
  ];

  it("prévisualise la première phase et décrit le plan complet", () => {
    const preview = build({ format: "MULTI", entrants: entrants(8), phases: twoPhases });

    expect(preview.format).toBe("SWISS");
    expect(preview.roundLabel).toBe("Ronde 1");
    expect(preview.phasePlan).toHaveLength(2);
    expect(preview.phasePlan?.[0]).toContain("Ronde suisse");
    expect(preview.notes[0]).toBe("Aperçu de la phase 1 — Qualifs.");
  });

  it("saute une première phase sans élimination et prévisualise la suivante", () => {
    // 4 inscrites pour une cible fixe de 8 : la phase 1 n'élimine personne.
    const phases = [
      phase({ position: 1, format: "SWISS", qualifierMode: "COUNT", qualifierValue: 8 }),
      phase({ position: 2, format: "SINGLE", qualifierValue: 1 }),
    ];
    const preview = build({ format: "MULTI", entrants: entrants(4), phases });

    expect(preview.format).toBe("SINGLE");
    expect(preview.bracketSize).toBe(4);
    expect(preview.notes[0]).toBe("Aperçu de la phase 2.");
    expect(preview.notes[1]).toContain("La phase 1 serait sautée");
  });

  it("compte les tours d'une phase d'élimination tronquée", () => {
    const phases = [
      phase({ position: 1, format: "SINGLE", qualifierMode: "COUNT", qualifierValue: 8 }),
      phase({ position: 2, format: "DOUBLE", qualifierValue: 1 }),
    ];
    const preview = build({ format: "MULTI", entrants: entrants(32), phases });

    expect(preview.format).toBe("SINGLE");
    expect(preview.bracketSize).toBe(32);
    // 32 → 8 qualifiées : deux tours joués, pas les cinq du plateau complet.
    expect(preview.rounds).toBe(2);
    expect(preview.notes.join(" ")).toContain("Plateau tronqué");
  });

  it("reprend les réglages de la phase prévisualisée", () => {
    const phases = [
      phase({
        position: 1,
        format: "SURVIVAL",
        qualifierValue: 2,
        survivalRoundsBeforeFirstCut: 1,
        survivalRoundsPerCut: 2,
      }),
      phase({ position: 2, format: "SINGLE", qualifierValue: 1 }),
    ];
    const preview = build({
      format: "MULTI",
      entrants: entrants(6),
      phases,
      // Réglages du tournoi : ils ne doivent pas primer sur ceux de la phase.
      survivalRoundsBeforeFirstCut: 9,
      survivalRoundsPerCut: 9,
    });

    expect(preview.format).toBe("SURVIVAL");
    expect(preview.notes.join(" ")).toContain("après 1 manche, puis toutes les 2 manches");
  });

  it("signale un tournoi sans phase configurée", () => {
    const preview = build({ format: "MULTI", entrants: entrants(4), phases: [] });

    expect(preview.format).toBe("MULTI");
    expect(preview.pairings).toEqual([]);
    expect(preview.notes[0]).toContain("Aucune phase configurée");
  });

  it("ne prétend pas prévisualiser un tournoi sous-rempli", () => {
    const phases = [
      phase({ position: 1, format: "SWISS", qualifierMode: "COUNT", qualifierValue: 50 }),
      phase({ position: 2, format: "SWISS", qualifierMode: "COUNT", qualifierValue: 50 }),
    ];
    // Des cibles fixes hors de portée sautent les phases intermédiaires, mais la
    // dernière couronne toujours une championne : seul un effectif trop faible
    // laisse l'aperçu sans appariement.
    const preview = build({ format: "MULTI", entrants: entrants(1), phases });

    expect(preview.pairings).toEqual([]);
    expect(preview.notes[0]).toContain("au moins deux");
  });

  it("saute toutes les phases intermédiaires sans cut et prévisualise la finale", () => {
    const phases = [
      phase({ position: 1, format: "SWISS", qualifierMode: "COUNT", qualifierValue: 50 }),
      phase({ position: 2, format: "SURVIVAL", qualifierMode: "COUNT", qualifierValue: 50 }),
      phase({ position: 3, format: "DOUBLE", qualifierValue: 1 }),
    ];
    const preview = build({ format: "MULTI", entrants: entrants(4), phases });

    expect(preview.format).toBe("DOUBLE");
    expect(preview.notes[0]).toBe("Aperçu de la phase 3.");
    expect(preview.notes.slice(1, 3)).toEqual([
      "La phase 1 serait sautée avec l'effectif actuel.",
      "La phase 2 serait sautée avec l'effectif actuel.",
    ]);
  });
});

describe("métadonnées", () => {
  it("a un libellé pour chaque provenance d'ordre", () => {
    expect(Object.keys(SEEDING_SOURCE_LABELS).sort()).toEqual([
      "MANUAL",
      "RANKING",
      "REGISTRATION",
    ]);
  });

  it("numérote les appariements à partir de 1, sans trou", () => {
    const preview = build({ entrants: entrants(7) });

    expect(preview.pairings.map((pairing) => pairing.position)).toEqual([1, 2, 3, 4]);
  });
});
