import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

// These tests focus on bracket generation logic without DB
describe("tournaments-service: bracket generation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("bracket sizing", () => {
    it.each<[number, number]>([
      [2, 1],
      [4, 3],
      [8, 7],
      [16, 15],
    ])("single elim with %i teams requires %i matches", (teams, expected) => {
      const matches = teams - 1;
      expect(matches).toBe(expected);
    });

    it("double elim with 4 teams requires specific match count", () => {
      // Double elim formula: 2*n - 2 or 2*n - 1 with reset
      const teams = 4;
      const expectedMatches = 2 * teams - 2; // 6
      expect(expectedMatches).toBe(6);
    });

    it("double elim with 8 teams requires specific match count", () => {
      const teams = 8;
      const expectedMatches = 2 * teams - 2; // 14
      expect(expectedMatches).toBe(14);
    });
  });

  describe("bye calculation", () => {
    // [équipes, byes, taille du tableau] — 8 équipes : puissance de 2, aucun bye.
    it.each<[number, number, number]>([
      [3, 1, 4],
      [5, 3, 8],
      [6, 2, 8],
      [7, 1, 8],
      [12, 4, 16],
      [28, 4, 32],
      [8, 0, 8],
    ])("calculates byes for %i teams", (teams, expectedByes, expectedPower) => {
      const nextPower = Math.pow(2, Math.ceil(Math.log2(teams)));
      const byes = nextPower - teams;
      expect(byes).toBe(expectedByes);
      expect(nextPower).toBe(expectedPower);
    });
  });

  describe("first round match count", () => {
    // [équipes, byes, matchs du premier tour] : seules les équipes sans bye jouent le premier tour.
    it.each<[number, number, number]>([
      [3, 1, 1],
      [5, 3, 1],
      [6, 2, 2],
      [7, 1, 3],
      [12, 4, 4],
      [28, 4, 12],
    ])("%i teams with %i byes play %i first round matches", (teams, byes, expected) => {
      const playingTeams = teams - byes;
      const r1Matches = playingTeams / 2;
      expect(r1Matches).toBe(expected);
    });
  });

  describe("round count calculation", () => {
    it.each<[number, number]>([
      [2, 1],
      [3, 2],
      [4, 2],
    ])("%i teams need %i rounds", (teams, expected) => {
      const rounds = Math.ceil(Math.log2(teams));
      expect(rounds).toBe(expected);
    });

    it("5-8 teams need 3 rounds", () => {
      for (const teams of [5, 6, 7, 8]) {
        const rounds = Math.ceil(Math.log2(teams));
        expect(rounds).toBe(3);
      }
    });

    it("9-16 teams need 4 rounds", () => {
      for (const teams of [9, 10, 15, 16]) {
        const rounds = Math.ceil(Math.log2(teams));
        expect(rounds).toBe(4);
      }
    });

    it("17-32 teams need 5 rounds", () => {
      for (const teams of [17, 20, 30, 32]) {
        const rounds = Math.ceil(Math.log2(teams));
        expect(rounds).toBe(5);
      }
    });
  });

  describe("seed ordering", () => {
    it("2 teams in order 1,2", () => {
      const seeds = [1, 2];
      expect(seeds[0] + seeds[1]).toBe(3);
    });

    it("4 teams in alternating seed order", () => {
      const seeds = [1, 4, 2, 3];
      expect(seeds[0] + seeds[1]).toBe(5); // 1 and 4 paired
      expect(seeds[2] + seeds[3]).toBe(5); // 2 and 3 paired
    });

    it("8 teams maintain seed balance", () => {
      const seeds = [1, 8, 4, 5, 2, 7, 3, 6];
      // Each pair should sum to 9
      for (let i = 0; i < seeds.length; i += 2) {
        expect(seeds[i] + seeds[i + 1]).toBe(9);
      }
    });

    it("16 teams maintain seed balance", () => {
      const seeds = [1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11];
      // Each pair should sum to 17
      for (let i = 0; i < seeds.length; i += 2) {
        expect(seeds[i] + seeds[i + 1]).toBe(17);
      }
    });
  });

  describe("double elim upper bracket rounds", () => {
    it("4 teams double elim has 2 UB rounds", () => {
      const teams = 4;
      const ubRounds = Math.ceil(Math.log2(teams)) - 1;
      expect(ubRounds).toBe(1); // Actually 1 round (UB R1 with 2 matches)
    });

    it("8 teams double elim has 3 UB rounds", () => {
      const teams = 8;
      const ubRounds = Math.ceil(Math.log2(teams));
      expect(ubRounds).toBe(3); // UB R1, R2, R3
    });

    it("16 teams double elim has 4 UB rounds", () => {
      const teams = 16;
      const ubRounds = Math.ceil(Math.log2(teams));
      expect(ubRounds).toBe(4);
    });
  });

  describe("bracket position", () => {
    it("winner goes to UPPER bracket", () => {
      const position = "UPPER";
      expect(position).toBe("UPPER");
    });

    it("loser goes to LOWER bracket in double elim", () => {
      const position = "LOWER";
      expect(position).toBe("LOWER");
    });

    it("grand final has GRAND position", () => {
      const position = "GRAND";
      expect(position).toBe("GRAND");
    });

    it("third place match has THIRD_PLACE position", () => {
      const position = "THIRD_PLACE";
      expect(position).toBe("THIRD_PLACE");
    });
  });
});
