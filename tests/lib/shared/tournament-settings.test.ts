import { describe, expect, it } from "@jest/globals";
import {
  matchFormatSettingLabel,
  parseRulesTournamentParam,
  rulesHrefWithTournament,
  tournamentSettingsGroups,
  type TournamentSettingsGroup,
  type TournamentSettingsInput,
} from "@/lib/shared/tournament-settings";
import type { TournamentPhase } from "@/lib/shared/types";
import { tournamentCard } from "../../helpers/tournament-card";

function input(overrides: Partial<TournamentSettingsInput> = {}): TournamentSettingsInput {
  return {
    card: tournamentCard(),
    phases: null,
    swiss: null,
    endurance: null,
    seedingSource: "REGISTRATION",
    ...overrides,
  };
}

function group(groups: TournamentSettingsGroup[], title: string): Record<string, string> {
  const found = groups.find((g) => g.title === title);
  if (!found) throw new Error(`groupe absent : ${title}`);
  return Object.fromEntries(found.settings.map((s) => [s.label, s.value]));
}

function phase(overrides: Partial<TournamentPhase>): TournamentPhase {
  return {
    id: 1,
    position: 1,
    name: null,
    format: "SWISS",
    qualifierMode: "COUNT",
    qualifierValue: 8,
    hasThirdPlaceMatch: false,
    swissTotalRounds: null,
    survivalRoundsBeforeFirstCut: null,
    survivalRoundsPerCut: null,
    state: "PENDING",
    entrants: null,
    qualifiers: null,
    maxRounds: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

describe("tournamentSettingsGroups — réglages généraux", () => {
  it("rend jeu, mode, participants, effectif, format des matchs et ordre de départ", () => {
    const groups = tournamentSettingsGroups(
      input({
        card: tournamentCard({
          game: "MR",
          format: "SINGLE",
          maxTeams: 16,
          matchFormat: { type: "FT", value: 3 },
        }),
        seedingSource: "MANUAL",
      }),
    );
    expect(group(groups, "Tournoi")).toEqual({
      Jeu: "Marvel Rivals",
      Mode: "Simple élimination",
      Participants: "Équipes",
      "Effectif maximal": "16 équipes",
      "Format des matchs": "FT3",
      "Ordre de départ": "Fixé par l'arbitrage",
    });
  });

  it("parle de joueurs en individuel et n'y annonce pas d'effectif minimal", () => {
    const groups = tournamentSettingsGroups(
      input({ card: tournamentCard({ participantType: "SOLO", maxTeams: 1 }) }),
    );
    expect(group(groups, "Tournoi").Participants).toBe("Joueurs (tournoi individuel)");
    expect(group(groups, "Tournoi")["Effectif maximal"]).toBe("1 joueur");
    expect(group(groups, "Conditions d'inscription")).not.toHaveProperty("Effectif minimal du roster");
  });

  it("dit « score libre » sans format, et signale le nul quand il est permis", () => {
    expect(matchFormatSettingLabel(null)).toBe("Score libre");
    expect(matchFormatSettingLabel({ type: "BO", value: 5, drawsAllowed: true })).toBe(
      "BO5 · match nul possible",
    );
  });

  it("rend les conditions d'inscription, « Aucun » pour un effectif minimal de 1", () => {
    const groups = tournamentSettingsGroups(
      input({
        card: tournamentCard({
          registrationFilters: { discordRequirement: "ALL_PLAYERS", blizzardRequirement: "NONE", minPlayers: 1 },
        }),
      }),
    );
    expect(group(groups, "Conditions d'inscription")).toEqual({
      "Effectif minimal du roster": "Aucun",
      "Tag Discord certifié": "Tous les joueurs",
      "Compte Battle.net rattaché": "Aucun joueur",
    });
  });
});

describe("tournamentSettingsGroups — réglages du mode", () => {
  it("élimination simple : la petite finale", () => {
    const groups = tournamentSettingsGroups(
      input({ card: tournamentCard({ format: "SINGLE", hasThirdPlaceMatch: true }) }),
    );
    expect(group(groups, "Simple élimination")).toEqual({ "Petite finale": "Oui" });
  });

  it("double élimination : aucun groupe vide n'est rendu", () => {
    const groups = tournamentSettingsGroups(input({ card: tournamentCard({ format: "DOUBLE" }) }));
    expect(groups.map((g) => g.title)).toEqual(["Tournoi", "Conditions d'inscription"]);
  });

  it("survie par coupes : la cadence des coupes", () => {
    const groups = tournamentSettingsGroups(
      input({
        card: tournamentCard({ format: "SURVIVAL", survivalRoundsBeforeFirstCut: 3, survivalRoundsPerCut: 2 }),
      }),
    );
    expect(group(groups, "Survie par coupes")).toEqual({
      "Manches avant la 1ʳᵉ coupe": "3",
      "Manches entre deux coupes": "2",
    });
  });

  it("ronde suisse : rondes et barème, rondes « fixées au lancement » tant qu'elles valent 0", () => {
    const swiss = { totalRounds: 0, pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0, pointsForBye: 3 };
    const before = tournamentSettingsGroups(input({ card: tournamentCard({ format: "SWISS" }), swiss }));
    expect(group(before, "Ronde suisse")).toEqual({
      "Nombre de rondes": "Fixé au lancement",
      Barème: "Victoire 3 · nul 1 · défaite 0 · exemption 3",
    });
    const after = tournamentSettingsGroups(
      input({ card: tournamentCard({ format: "SWISS" }), swiss: { ...swiss, totalRounds: 5 } }),
    );
    expect(group(after, "Ronde suisse")["Nombre de rondes"]).toBe("5");
  });

  it("BlueGenji Survie : capital, barème, qualifiées, plafond et format des play-offs", () => {
    const groups = tournamentSettingsGroups(
      input({
        card: tournamentCard({
          format: "BG_SURVIE",
          matchFormat: { type: "BO", value: 5, drawsAllowed: true, maxMaps: 4 },
          endurancePlayoffFormat: null,
        }),
        endurance: { startPoints: 7, winDelta: 1, lossDelta: 1, playoffSize: 8, maxRounds: null },
      }),
    );
    const settings = group(groups, "BlueGenji Survie");
    expect(settings).toMatchObject({
      "Capital de départ": "7 points",
      Barème: "+1 par map gagnée · −1 par map perdue",
      "Qualifiées pour les play-offs": "8",
      "Plafond de manches qualificatives": "Aucun",
    });
    // Sans format propre, l'arbre rejoue celui du tournoi, égalités fermées.
    expect(settings["Format des play-offs"]).not.toContain("nul");
    expect(group(groups, "Tournoi")["Format des matchs"]).toContain("match nul possible");
  });

  it("BlueGenji Survie : le plafond de manches et un format de play-offs propre", () => {
    const groups = tournamentSettingsGroups(
      input({
        card: tournamentCard({
          format: "BG_SURVIE",
          matchFormat: { type: "BO", value: 5 },
          endurancePlayoffFormat: { type: "FT", value: 3 },
        }),
        endurance: { startPoints: 9, winDelta: 1, lossDelta: 1, playoffSize: 8, maxRounds: 6 },
      }),
    );
    expect(group(groups, "BlueGenji Survie")).toMatchObject({
      "Plafond de manches qualificatives": "6",
      "Format des play-offs": "FT3",
    });
  });

  it("multi-phases : une ligne par phase, dans l'ordre, la dernière désignant la championne", () => {
    const groups = tournamentSettingsGroups(
      input({
        card: tournamentCard({ format: "MULTI" }),
        phases: [
          phase({ id: 3, position: 3, format: "SINGLE", hasThirdPlaceMatch: true }),
          phase({ id: 1, position: 1, format: "SWISS", swissTotalRounds: 5, qualifierMode: "PERCENT", qualifierValue: 50 }),
          phase({
            id: 2,
            position: 2,
            name: "Coupes",
            format: "SURVIVAL",
            survivalRoundsBeforeFirstCut: 2,
            survivalRoundsPerCut: 1,
            qualifierValue: 1,
          }),
        ],
      }),
    );
    expect(group(groups, "Multi-phases")).toEqual({
      "Phase 1": "Ronde suisse · 5 rondes · 50 % qualifiées",
      "Phase 2 — Coupes": "Survie par coupes · 1ʳᵉ coupe après 2 manches · puis à chaque manche · 1 qualifiée",
      "Phase 3": "Simple élimination · petite finale · Désigne la championne",
    });
  });
});

describe("paramètre ?tournoi= des règles", () => {
  it("n'accepte qu'un entier positif en base 10", () => {
    expect(parseRulesTournamentParam("12")).toBe(12);
    expect(parseRulesTournamentParam(["7", "8"])).toBe(7);
    for (const bad of [undefined, "", "0", "-3", "1.5", "012", "1e3", "abc", "99999999999999999"]) {
      expect(parseRulesTournamentParam(bad)).toBeNull();
    }
  });

  it("construit le lien des règles portant le tournoi", () => {
    expect(rulesHrefWithTournament("/regles/survie", 42)).toBe("/regles/survie?tournoi=42");
  });
});
