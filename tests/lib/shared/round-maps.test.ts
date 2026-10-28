import { describe, expect, it } from "@jest/globals";
import {
  EMPTY_MAP_RULES,
  ROUND_MAP_CANDIDATES_MAX,
  ROUND_MAP_SLOTS_MAX,
  applyMapRules,
  canPickMatchMap,
  effectiveFirstMap,
  firstBanOrder,
  firstBanTeamFor,
  normalizeRoundMapSlots,
  parseFirstBanRule,
  parseMapPicks,
  parseNextBanRule,
  parseNextPickRule,
  parseStoredSlots,
  resolveMatchMaps,
  roundKeysOf,
  roundMapsOf,
  validateMapPick,
} from "@/lib/shared/round-maps";
import { bracketMatch } from "../../helpers/bracket-match";

/** Cartes par manche et règles de ban (`docs/features/ROUND_MAPS.md`), règles pures. */

const names = (count: number) => Array.from({ length: count }, (_, index) => `Map ${index + 1}`);

describe("normalizeRoundMapSlots", () => {
  it("nettoie : espaces, doublons sans casse, cartes et créneaux vides écartés", () => {
    expect(normalizeRoundMapSlots([["  Ilios ", "ilios", "", "Nepal"], [], ["   "], ["Busan"]])).toEqual([
      ["Ilios", "Nepal"],
      ["Busan"],
    ]);
  });

  it("une liste vide retire le réglage", () => {
    expect(normalizeRoundMapSlots([])).toEqual([]);
  });

  it("refuse une forme invalide", () => {
    expect(() => normalizeRoundMapSlots("Ilios")).toThrow("INVALID_ROUND_MAPS");
    expect(() => normalizeRoundMapSlots(["Ilios"])).toThrow("INVALID_ROUND_MAPS");
    expect(() => normalizeRoundMapSlots([[42]])).toThrow("INVALID_ROUND_MAPS");
  });

  it("accepte une carte de 64 caractères, refuse 65", () => {
    expect(normalizeRoundMapSlots([["a".repeat(64)]])).toEqual([["a".repeat(64)]]);
    expect(() => normalizeRoundMapSlots([["a".repeat(65)]])).toThrow("INVALID_ROUND_MAPS");
  });

  it(`accepte ${ROUND_MAP_SLOTS_MAX} créneaux, refuse un de plus`, () => {
    expect(normalizeRoundMapSlots(names(9).map((name) => [name]))).toHaveLength(9);
    expect(() => normalizeRoundMapSlots(names(10).map((name) => [name]))).toThrow("INVALID_ROUND_MAPS");
  });

  it(`accepte ${ROUND_MAP_CANDIDATES_MAX} cartes par pool, refuse une de plus`, () => {
    expect(normalizeRoundMapSlots([names(20)])[0]).toHaveLength(20);
    expect(() => normalizeRoundMapSlots([names(21)])).toThrow("INVALID_ROUND_MAPS");
  });
});

describe("parseStoredSlots / parseMapPicks", () => {
  it("relit les créneaux, une valeur illisible vaut « aucun réglage »", () => {
    expect(parseStoredSlots('[["Ilios"],["Busan","Nepal"]]')).toEqual([["Ilios"], ["Busan", "Nepal"]]);
    expect(parseStoredSlots(null)).toEqual([]);
    expect(parseStoredSlots("{oops")).toEqual([]);
    expect(parseStoredSlots('"Ilios"')).toEqual([]);
  });

  it("garde les choix des cartes 2 à 9 seulement", () => {
    expect(parseMapPicks('{"1":"Ilios","2":"Busan","9":"Nepal","10":"Oasis","3":4,"4":"  "}')).toEqual({
      "2": "Busan",
      "9": "Nepal",
    });
  });

  it("rend un objet vide sur une valeur illisible", () => {
    expect(parseMapPicks(null)).toEqual({});
    expect(parseMapPicks("{oops")).toEqual({});
    expect(parseMapPicks('["Busan"]')).toEqual({});
  });
});

describe("roundMapsOf / resolveMatchMaps / effectiveFirstMap", () => {
  const rounds = [{ phaseId: 0, bracket: "UPPER", roundNumber: 2, slots: [["Ilios"]] }];

  it("trouve la manche du match, rien pour une autre", () => {
    expect(roundMapsOf(rounds, { phaseId: 0, bracket: "UPPER", roundNumber: 2 })).toBe(rounds[0]);
    expect(roundMapsOf(rounds, { phaseId: 0, bracket: "LOWER", roundNumber: 2 })).toBeNull();
    expect(roundMapsOf(rounds, { phaseId: 3, bracket: "UPPER", roundNumber: 2 })).toBeNull();
  });

  it("résout imposée, pool choisi (carte 1 = first_map) et pool à choisir", () => {
    expect(resolveMatchMaps([["Ilios", "Nepal"], ["Busan"], ["Oasis", "Numbani"]], "Nepal", { "3": "Oasis" })).toEqual([
      { number: 1, kind: "POOL", map: "Nepal", candidates: ["Ilios", "Nepal"] },
      { number: 2, kind: "IMPOSED", map: "Busan", candidates: ["Busan"] },
      { number: 3, kind: "POOL", map: "Oasis", candidates: ["Oasis", "Numbani"] },
    ]);
    expect(resolveMatchMaps([["Ilios", "Nepal"], ["Oasis", "Numbani"]], null, {})).toEqual([
      { number: 1, kind: "POOL", map: null, candidates: ["Ilios", "Nepal"] },
      { number: 2, kind: "POOL", map: null, candidates: ["Oasis", "Numbani"] },
    ]);
  });

  it("sans réglage, aucune carte résolue", () => {
    expect(resolveMatchMaps([], "Ilios", {})).toEqual([]);
  });

  it("la carte 1 imposée l'emporte sur la saisie du match", () => {
    expect(effectiveFirstMap([["Busan"]], "Ilios")).toBe("Busan");
    expect(effectiveFirstMap([["Busan", "Nepal"]], "Ilios")).toBe("Ilios");
    expect(effectiveFirstMap([], "Ilios")).toBe("Ilios");
  });
});

describe("validateMapPick", () => {
  const slots = [["Ilios", "Nepal"], ["Busan"]];

  it("retient la graphie du pool, comparée sans casse", () => {
    expect(validateMapPick(slots, 1, " nepal ")).toBe("Nepal");
  });

  it("null ou vide retire le choix", () => {
    expect(validateMapPick(slots, 1, null)).toBeNull();
    expect(validateMapPick(slots, 1, "")).toBeNull();
  });

  it("refuse un créneau absent, non entier ou imposé", () => {
    expect(() => validateMapPick(slots, 0, "Ilios")).toThrow("INVALID_MAP_PICK");
    expect(() => validateMapPick(slots, 3, "Ilios")).toThrow("INVALID_MAP_PICK");
    expect(() => validateMapPick(slots, 1.5, "Ilios")).toThrow("INVALID_MAP_PICK");
    expect(() => validateMapPick(slots, "1", "Ilios")).toThrow("INVALID_MAP_PICK");
    expect(() => validateMapPick(slots, 2, "Busan")).toThrow("INVALID_MAP_PICK");
  });

  it("refuse une carte hors du pool", () => {
    expect(() => validateMapPick(slots, 1, "Oasis")).toThrow("INVALID_MAP_PICK");
  });
});

describe("règles de ban", () => {
  it("par défaut, l'équipe qui n'héberge pas bannit la première", () => {
    expect(firstBanTeamFor("NON_HOST", 10, 10, 20)).toBe(20);
    expect(firstBanTeamFor("NON_HOST", 20, 10, 20)).toBe(10);
  });

  it("règle HOST : l'hôte bannit le premier", () => {
    expect(firstBanTeamFor("HOST", 20, 10, 20)).toBe(20);
  });

  it("rien tant qu'un adversaire ou l'hôte manque", () => {
    expect(firstBanTeamFor("NON_HOST", null, 10, 20)).toBeNull();
    expect(firstBanTeamFor("NON_HOST", 10, 10, null)).toBeNull();
    expect(firstBanOrder("NON_HOST", 10, null, 20)).toBeNull();
  });

  it("ordre des bans : la première équipe, puis l'autre", () => {
    expect(firstBanOrder("NON_HOST", 10, 10, 20)).toEqual([20, 10]);
    expect(firstBanOrder("HOST", 10, 10, 20)).toEqual([10, 20]);
  });

  it("une valeur inconnue rend la règle par défaut", () => {
    expect(parseFirstBanRule("HOST")).toBe("HOST");
    expect(parseFirstBanRule("nope")).toBe("NON_HOST");
    expect(parseNextBanRule("WINNER")).toBe("WINNER");
    expect(parseNextBanRule(null)).toBe("LOSER");
    expect(parseNextPickRule("FREE")).toBe("FREE");
    expect(parseNextPickRule(undefined)).toBe("LOSER");
  });
});

describe("applyMapRules", () => {
  const match = bracketMatch({ team1Id: 10, team2Id: 20, hostTeamId: 10, firstBanTeamId: 20, firstMap: "Ilios" });

  it("sans réglage et règle par défaut, le plateau est inchangé", () => {
    const [out] = applyMapRules([match], EMPTY_MAP_RULES);
    expect(out).toBe(match);
  });

  it("la carte 1 imposée de la manche devient la première carte affichée", () => {
    const rules = {
      ...EMPTY_MAP_RULES,
      rounds: [{ phaseId: match.phaseId, bracket: match.bracket, roundNumber: match.roundNumber, slots: [["Busan"]] }],
    };
    expect(applyMapRules([match], rules)[0].firstMap).toBe("Busan");
  });

  it("règle HOST : le premier ban passe à l'hôte", () => {
    expect(applyMapRules([match], { ...EMPTY_MAP_RULES, firstBan: "HOST" })[0].firstBanTeamId).toBe(10);
  });
});

describe("roundKeysOf", () => {
  it("manches distinctes, dans l'ordre phase, tableau, numéro", () => {
    expect(
      roundKeysOf([
        { phaseId: 0, bracket: "LOWER", roundNumber: 1 },
        { phaseId: 0, bracket: "UPPER", roundNumber: 2 },
        { phaseId: 0, bracket: "UPPER", roundNumber: 1 },
        { phaseId: 0, bracket: "UPPER", roundNumber: 1 },
        { phaseId: 0, bracket: "GRAND", roundNumber: 1 },
      ]),
    ).toEqual([
      { phaseId: 0, bracket: "UPPER", roundNumber: 1 },
      { phaseId: 0, bracket: "UPPER", roundNumber: 2 },
      { phaseId: 0, bracket: "LOWER", roundNumber: 1 },
      { phaseId: 0, bracket: "GRAND", roundNumber: 1 },
    ]);
  });
});

describe("canPickMatchMap", () => {
  const match = { status: "READY", selfManaged: true, team1Id: 10, team2Id: 20 };

  it("le staff choisit toujours, tant que le match n'est pas joué", () => {
    expect(canPickMatchMap({ staff: true, myTeamId: null, canDeclareReady: false }, { ...match, selfManaged: false })).toBe(true);
    expect(canPickMatchMap({ staff: true, myTeamId: null, canDeclareReady: false }, { ...match, status: "COMPLETED" })).toBe(false);
  });

  it("une équipe du match choisit en autogestion seulement", () => {
    expect(canPickMatchMap({ staff: false, myTeamId: 20, canDeclareReady: true }, match)).toBe(true);
    expect(canPickMatchMap({ staff: false, myTeamId: 20, canDeclareReady: true }, { ...match, selfManaged: false })).toBe(false);
  });

  it("un joueur de roster qui ne déclare pas « Prêt » ne choisit pas, comme au serveur", () => {
    expect(canPickMatchMap({ staff: false, myTeamId: 20, canDeclareReady: false }, match)).toBe(false);
  });

  it("refuse une autre équipe ou un lecteur sans équipe", () => {
    expect(canPickMatchMap({ staff: false, myTeamId: 30, canDeclareReady: true }, match)).toBe(false);
    expect(canPickMatchMap({ staff: false, myTeamId: null, canDeclareReady: true }, match)).toBe(false);
  });
});
