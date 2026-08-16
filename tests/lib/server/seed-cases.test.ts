import { describe, expect, it } from "@jest/globals";
import { TOURNAMENTS, type SeedFormat, type TournamentDef } from "@/lib/server/seed-cases";

const FORMATS: SeedFormat[] = ["SINGLE", "DOUBLE", "SWISS", "SURVIVAL"];
const STATES: TournamentDef["state"][] = ["UPCOMING", "REGISTRATION", "RUNNING", "FINISHED"];

const formatOf = (t: TournamentDef): SeedFormat => t.format ?? "DOUBLE";
const withFormat = (format: SeedFormat) => TOURNAMENTS.filter((t) => formatOf(t) === format);
const withState = (state: TournamentDef["state"]) =>
  TOURNAMENTS.filter((t) => t.state === state);
const running = (format: SeedFormat) =>
  TOURNAMENTS.filter((t) => formatOf(t) === format && t.state === "RUNNING");

describe("seed — couverture de la matrice", () => {
  it("couvre les quatre états et les quatre formats", () => {
    for (const state of STATES) {
      expect(withState(state).length).toBeGreaterThan(0);
    }
    for (const format of FORMATS) {
      expect(withFormat(format).length).toBeGreaterThan(0);
    }
  });

  it("couvre chaque format à l'inscription, en cours et terminé", () => {
    for (const format of FORMATS) {
      const states = new Set(withFormat(format).map((t) => t.state));
      expect(states.has("REGISTRATION")).toBe(true);
      expect(states.has("RUNNING")).toBe(true);
      expect(states.has("FINISHED")).toBe(true);
    }
  });

  it("couvre les deux jeux", () => {
    expect(TOURNAMENTS.some((t) => t.game === "OW2")).toBe(true);
    expect(TOURNAMENTS.some((t) => t.game === "MR")).toBe(true);
  });

  it("couvre les bornes de remplissage des inscriptions", () => {
    const registration = withState("REGISTRATION");
    expect(registration.some((t) => t.teamCount === 0)).toBe(true); // vide
    expect(registration.some((t) => t.teamCount === 1)).toBe(true); // une seule
    expect(registration.some((t) => t.teamCount === t.maxTeams)).toBe(true); // complet
    expect(registration.some((t) => t.closesInHours !== undefined)).toBe(true); // clôture imminente
  });

  it("couvre les effectifs non puissances de deux (byes) et les gros brackets", () => {
    const elimination = TOURNAMENTS.filter(
      (t) => ["SINGLE", "DOUBLE"].includes(formatOf(t)) && t.state !== "UPCOMING",
    );
    const isPowerOfTwo = (n: number) => n >= 2 && (n & (n - 1)) === 0;

    expect(elimination.some((t) => !isPowerOfTwo(t.teamCount) && t.teamCount > 2)).toBe(true);
    expect(elimination.some((t) => isPowerOfTwo(t.teamCount))).toBe(true);
    expect(elimination.some((t) => t.teamCount === 2)).toBe(true); // finale sèche
    expect(elimination.some((t) => t.teamCount >= 64)).toBe(true);
    expect(elimination.some((t) => t.teamCount >= 128)).toBe(true);
  });

  it("couvre la petite finale dans les deux sens", () => {
    const single = withFormat("SINGLE");
    expect(single.some((t) => t.hasThirdPlaceMatch === true)).toBe(true);
    expect(single.some((t) => !t.hasThirdPlaceMatch)).toBe(true);
  });
});

describe("seed — couverture du mode Survie", () => {
  const survival = withFormat("SURVIVAL");

  it("couvre tous les effectifs impairs déclencheurs de barrage", () => {
    const odd = survival
      .filter((t) => t.teamCount % 2 === 1 && t.teamCount >= 3)
      .map((t) => t.teamCount);
    for (const count of [3, 5, 7, 9, 11, 15, 21]) {
      expect(odd).toContain(count);
    }
  });

  it("couvre aussi des effectifs pairs (aucun barrage attendu)", () => {
    const even = survival.filter((t) => t.teamCount > 0 && t.teamCount % 2 === 0);
    expect(even.length).toBeGreaterThanOrEqual(3);
  });

  it("couvre plusieurs cadences de coupe", () => {
    const cadences = new Set(survival.map((t) => t.survivalRoundsPerCut));
    for (const cadence of [1, 2, 3]) {
      expect(cadences.has(cadence)).toBe(true);
    }
  });

  it("couvre le forfait (rééquilibrage à la coupe suivante)", () => {
    expect(survival.some((t) => (t.forfeits ?? 0) === 1)).toBe(true);
    expect(survival.some((t) => (t.forfeits ?? 0) >= 2)).toBe(true);
  });

  it("termine au moins un tournoi à effectif impair", () => {
    expect(
      survival.some((t) => t.state === "FINISHED" && t.teamCount % 2 === 1),
    ).toBe(true);
  });
});

describe("seed — couverture du cycle de report des scores", () => {
  it("couvre report en attente, conflit et délai dépassé", () => {
    expect(TOURNAMENTS.some((t) => (t.pendingReports ?? 0) > 0)).toBe(true);
    expect(TOURNAMENTS.some((t) => (t.conflicts ?? 0) > 0)).toBe(true);
    expect(TOURNAMENTS.some((t) => (t.expiredReports ?? 0) > 0)).toBe(true);
  });

  it("place ces états sur des tournois en cours uniquement", () => {
    const withReports = TOURNAMENTS.filter(
      (t) => (t.pendingReports ?? 0) + (t.conflicts ?? 0) + (t.expiredReports ?? 0) > 0,
    );
    expect(withReports.length).toBeGreaterThan(0);
    for (const t of withReports) {
      expect(t.state).toBe("RUNNING");
      // Il faut des matchs prêts à basculer : au moins une vague jouée et un
      // effectif suffisant pour que le bracket ait plus d'un match.
      expect(t.teamCount).toBeGreaterThanOrEqual(4);
    }
  });

  it("couvre les reports sur chaque famille de format jouable", () => {
    const familles = new Set(
      TOURNAMENTS.filter(
        (t) => (t.pendingReports ?? 0) + (t.conflicts ?? 0) + (t.expiredReports ?? 0) > 0,
      ).map(formatOf),
    );
    expect(familles.has("SINGLE")).toBe(true);
    expect(familles.has("DOUBLE")).toBe(true);
    expect(familles.has("SWISS")).toBe(true);
    expect(familles.has("SURVIVAL")).toBe(true);
  });
});

describe("seed — cohérence des définitions", () => {
  it("nomme chaque tournoi de façon unique", () => {
    const names = TOURNAMENTS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("n'inscrit jamais plus d'équipes que la capacité", () => {
    for (const t of TOURNAMENTS) {
      expect(t.teamCount).toBeLessThanOrEqual(t.maxTeams);
      expect(t.teamCount).toBeGreaterThanOrEqual(0);
    }
  });

  it("réserve les options de format à leur format", () => {
    for (const t of TOURNAMENTS) {
      if (t.survivalRoundsPerCut !== undefined) {
        expect(formatOf(t)).toBe("SURVIVAL");
        expect(t.survivalRoundsPerCut).toBeGreaterThan(0);
      }
      if (t.swissTotalRounds !== undefined) {
        expect(formatOf(t)).toBe("SWISS");
        expect(t.swissTotalRounds).toBeGreaterThan(0);
      }
      if (t.hasThirdPlaceMatch) {
        expect(formatOf(t)).toBe("SINGLE");
      }
      if ((t.forfeits ?? 0) > 0) {
        expect(formatOf(t)).toBe("SURVIVAL");
      }
    }
  });

  it("garde les tournois jouables jouables (≥ 2 équipes en cours / terminé)", () => {
    for (const t of TOURNAMENTS) {
      if (t.state === "RUNNING" || t.state === "FINISHED") {
        expect(t.teamCount).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("laisse les tournois à venir et en inscription sans simulation", () => {
    for (const t of TOURNAMENTS) {
      if (t.state === "UPCOMING" || t.state === "REGISTRATION") {
        expect(t.playWaves).toBeUndefined();
        expect(t.forfeits).toBeUndefined();
      }
      if (t.state === "UPCOMING") {
        expect(t.teamCount).toBe(0);
        expect(t.daysOffset).toBeGreaterThan(0);
      }
    }
  });

  it("date les tournois dans le bon sens", () => {
    for (const t of TOURNAMENTS) {
      if (t.state === "FINISHED" || t.state === "RUNNING") {
        expect(t.daysOffset).toBeLessThan(0);
      }
      if (t.state === "REGISTRATION") {
        expect(t.daysOffset).toBeGreaterThan(0);
      }
    }
  });

  it("ne rejoue jamais un tournoi terminé partiellement", () => {
    for (const t of withState("FINISHED")) {
      expect((t.pendingReports ?? 0) + (t.conflicts ?? 0) + (t.expiredReports ?? 0)).toBe(0);
    }
  });

  it("garde des vagues de simulation plausibles pour les tournois en cours", () => {
    for (const t of withState("RUNNING")) {
      if (t.playWaves !== undefined) {
        expect(t.playWaves).toBeGreaterThanOrEqual(0);
        expect(t.playWaves).toBeLessThanOrEqual(10);
      }
    }
  });

  it("fournit assez de tournois en cours par format pour peupler les vues", () => {
    expect(running("SINGLE").length).toBeGreaterThanOrEqual(3);
    expect(running("DOUBLE").length).toBeGreaterThanOrEqual(3);
    expect(running("SWISS").length).toBeGreaterThanOrEqual(2);
    expect(running("SURVIVAL").length).toBeGreaterThanOrEqual(5);
  });
});
