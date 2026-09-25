import { describe, expect, it } from "@jest/globals";
import {
  formatLabel,
  gameLabel,
  runningTournamentActionLabel,
  tournamentStateLabel,
} from "@/lib/shared/tournament-labels";

describe("tournamentStateLabel", () => {
  it("traduit chaque état en français", () => {
    expect(tournamentStateLabel("UPCOMING")).toBe("Prochainement");
    expect(tournamentStateLabel("REGISTRATION")).toBe("Inscriptions ouvertes");
    expect(tournamentStateLabel("RUNNING")).toBe("En cours");
    expect(tournamentStateLabel("FINISHED")).toBe("Terminé");
  });

  it("retombe sur la valeur brute pour un état inconnu", () => {
    expect(tournamentStateLabel("WHATEVER")).toBe("WHATEVER");
  });
});

describe("runningTournamentActionLabel", () => {
  it("propose le bracket pour les formats à élimination", () => {
    expect(runningTournamentActionLabel("SINGLE")).toBe("Voir le bracket");
    expect(runningTournamentActionLabel("DOUBLE")).toBe("Voir le bracket");
  });

  it("propose le classement pour les formats sans arbre", () => {
    expect(runningTournamentActionLabel("SWISS")).toBe("Voir le classement");
    expect(runningTournamentActionLabel("SURVIVAL")).toBe("Voir le classement");
    expect(runningTournamentActionLabel("BG_SURVIE")).toBe("Voir le classement");
  });

  it("reste neutre pour le multi-phases", () => {
    expect(runningTournamentActionLabel("MULTI")).toBe("Voir le tournoi");
  });
});

describe("formatLabel / gameLabel", () => {
  it("traduisent format et jeu", () => {
    expect(formatLabel("DOUBLE")).toBe("Double élimination");
    expect(gameLabel("MR")).toBe("Marvel Rivals");
  });

  it("retombent sur la valeur brute pour une entrée inconnue", () => {
    expect(formatLabel("EXOTIQUE")).toBe("EXOTIQUE");
    expect(gameLabel("XX")).toBe("XX");
  });
});
