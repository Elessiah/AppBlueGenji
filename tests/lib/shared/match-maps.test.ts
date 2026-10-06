import { describe, expect, it } from "@jest/globals";
import {
  DRAWN_MAP_REPLAY_ALLOWANCE,
  FREE_FORMAT_MAP_LIMIT,
  canAddMap,
  checkMapList,
  deriveMatchScore,
  emptyMap,
  isMapTouched,
  isValidReplayCode,
  mapListLimit,
  mapListViolationMessage,
  MAP_LIST_ERROR_CODES,
  refusalOnTouchedRow,
  progressiveMapRows,
  trimTrailingBlankMaps,
  isMapComplete,
  mapWinnerSide,
  mapsMatchStoredScore,
  normalizeReplayCode,
  parseMapListBody,
  sameMapLists,
  type MatchMapInput,
} from "@/lib/shared/match-maps";
import type { MatchFormat } from "@/lib/shared/match-format";
import { mapsFor } from "../../helpers/match-maps";

const BO5: MatchFormat = { type: "BO", value: 5 };
const FT3: MatchFormat = { type: "FT", value: 3 };
const BO3: MatchFormat = { type: "BO", value: 3 };
const FT3_DRAWS: MatchFormat = { type: "FT", value: 3, drawsAllowed: true };
const FT3_DRAWS_CAP4: MatchFormat = { type: "FT", value: 3, drawsAllowed: true, maxMaps: 4 };

const decisive = { decisive: true };

describe("score dérivé des maps", () => {
  it("une map gagnée vaut un point, une map nulle n'en vaut à personne", () => {
    expect(deriveMatchScore([
      { team1Score: 2, team2Score: 1 },
      { team1Score: 1, team2Score: 1 },
      { team1Score: 0, team2Score: 3 },
    ])).toEqual({ team1: 1, team2: 1, drawnMaps: 1 });
    expect(mapWinnerSide({ team1Score: 0, team2Score: 0 })).toBeNull();
    expect(mapWinnerSide({ team1Score: 3, team2Score: 2 })).toBe(1);
    expect(mapWinnerSide({ team1Score: 2, team2Score: 3 })).toBe(2);
  });
});

describe("plafond de lignes (FT / BO → maps)", () => {
  it("BO N et FT ⌈N/2⌉ jouent le même nombre de maps décisives, + maps nulles rejouées", () => {
    expect(mapListLimit(BO5)).toBe(5 + DRAWN_MAP_REPLAY_ALLOWANCE);
    expect(mapListLimit(FT3)).toBe(5 + DRAWN_MAP_REPLAY_ALLOWANCE);
    expect(mapListLimit(BO3)).toBe(3 + DRAWN_MAP_REPLAY_ALLOWANCE);
  });

  it("sans tiebreaker (égalités ouvertes), une map nulle consomme une map du BO", () => {
    expect(mapListLimit(FT3_DRAWS)).toBe(5);
    expect(mapListLimit(FT3_DRAWS_CAP4)).toBe(4);
  });

  it("score libre : plafond fixe", () => {
    expect(mapListLimit(null)).toBe(FREE_FORMAT_MAP_LIMIT);
  });
});

describe("checkMapList — nominal", () => {
  it("accepte un 3-1 en BO5 et dérive le score", () => {
    const check = checkMapList(BO5, "OW", [
      { replayCode: "AAAAA1", team1Score: 2, team2Score: 0 },
      { replayCode: "AAAAA2", team1Score: 0, team2Score: 2 },
      { replayCode: "AAAAA3", team1Score: 3, team2Score: 2 },
      { replayCode: "aaaaa4", team1Score: 1, team2Score: 0 },
    ], decisive);
    expect(check).toEqual({ error: null, field: null, score: { team1: 3, team2: 1, drawnMaps: 0 } });
  });

  it("une map nulle rejouée ne compte pas : 3-2 avec une nulle en BO5", () => {
    expect(checkMapList(BO5, null, mapsFor(3, 2, 1), decisive).error).toBeNull();
  });

  it("garde le comportement d'aujourd'hui sur un format à égalités : 2-2 et 2-1 acceptés", () => {
    expect(checkMapList(FT3_DRAWS, null, mapsFor(2, 2, 1), decisive).error).toBeNull();
    expect(checkMapList(FT3_DRAWS, null, mapsFor(2, 1, 2), decisive).error).toBeNull();
  });

  it("une sauvegarde intermédiaire n'exige pas un match fini", () => {
    expect(checkMapList(BO5, null, mapsFor(1, 0), { decisive: false }).error).toBeNull();
    expect(checkMapList(BO5, null, [], { decisive: false }).error).toBeNull();
  });
});

describe("checkMapList — limites et erreurs", () => {
  it("liste vide sur une saisie décisive", () => {
    expect(checkMapList(BO5, null, [], decisive)).toMatchObject({
      error: "MAP_LIST_EMPTY",
      field: { index: 0, field: "replayCode" },
    });
  });

  it("trop de maps", () => {
    const maps = mapsFor(0, 0, mapListLimit(FT3_DRAWS) + 1);
    expect(checkMapList(FT3_DRAWS, null, maps, decisive).error).toBe("MAP_COUNT_EXCEEDED");
  });

  it("code manquant, invalide ou en double — rattaché à la bonne map", () => {
    const base = mapsFor(3, 0);
    expect(checkMapList(BO5, null, base.map((m, i) => (i === 1 ? { ...m, replayCode: "  " } : m)), decisive))
      .toMatchObject({ error: "MAP_REPLAY_CODE_REQUIRED", field: { index: 1, field: "replayCode" } });
    expect(checkMapList(BO5, "OW", base.map((m, i) => (i === 2 ? { ...m, replayCode: "ABC12" } : m)), decisive))
      .toMatchObject({ error: "MAP_REPLAY_CODE_INVALID", field: { index: 2 } });
    expect(checkMapList(BO5, null, base.map((m, i) => (i === 2 ? { ...m, replayCode: "map001" } : m)), decisive))
      .toMatchObject({ error: "MAP_REPLAY_CODE_DUPLICATE", field: { index: 2 } });
  });

  it("score de map négatif, non entier ou au-delà de 99", () => {
    for (const bad of [-1, 1.5, 100, Number.NaN]) {
      const maps = mapsFor(3, 0).map((m, i) => (i === 0 ? { ...m, team2Score: bad } : m));
      expect(checkMapList(BO5, null, maps, decisive)).toMatchObject({
        error: "MAP_SCORE_INVALID",
        field: { index: 0, field: "team2Score" },
      });
    }
  });

  it("une map après la victoire acquise est refusée", () => {
    expect(checkMapList(BO5, null, mapsFor(4, 1), decisive)).toMatchObject({
      error: "MAP_AFTER_DECISION",
      field: { index: 4 },
    });
  });

  it("le score dérivé suit les refus d'aujourd'hui (checkMatchScores)", () => {
    expect(checkMapList(BO5, null, mapsFor(2, 1), decisive).error).toBe("SCORE_BELOW_MATCH_FORMAT");
    expect(checkMapList(BO5, null, mapsFor(2, 2), decisive).error).toBe("SCORE_BELOW_MATCH_FORMAT");
    expect(checkMapList(null, null, mapsFor(1, 1), decisive).error).toBe("DRAW_NOT_ALLOWED");
    expect(checkMapList(null, null, mapsFor(1, 1, 1), decisive).error).toBe("DRAW_NOT_ALLOWED");
  });
});

describe("codes de replay", () => {
  it("Overwatch : six caractères alphanumériques ; ailleurs, motif permissif", () => {
    expect(isValidReplayCode("A1B2C3", "OW")).toBe(true);
    expect(isValidReplayCode("A1B2C", "OW")).toBe(false);
    expect(isValidReplayCode("A1-B2C3", "OW")).toBe(false);
    expect(isValidReplayCode("1234567890123", "MR")).toBe(true);
    expect(isValidReplayCode("AB-12", null)).toBe(true);
    expect(isValidReplayCode("AB1", "MR")).toBe(false);
    expect(isValidReplayCode("A".repeat(33), "MR")).toBe(false);
  });

  it("normalise : sans espaces, en majuscules", () => {
    expect(normalizeReplayCode("  ab c12 ")).toBe("ABC12");
    expect(normalizeReplayCode(42)).toBe("");
  });
});

describe("parseMapListBody", () => {
  it("lit une liste bien formée et normalise les codes", () => {
    expect(parseMapListBody([{ replayCode: " xyz123", team1Score: 1, team2Score: 0 }])).toEqual([
      { replayCode: "XYZ123", team1Score: 1, team2Score: 0 },
    ]);
    expect(parseMapListBody([])).toEqual([]);
  });

  it("refuse toute autre forme", () => {
    expect(parseMapListBody("3-1")).toBeNull();
    expect(parseMapListBody([null])).toBeNull();
    expect(parseMapListBody([{ replayCode: 1, team1Score: 1, team2Score: 0 }])).toBeNull();
    expect(parseMapListBody([{ replayCode: "A", team1Score: "1", team2Score: 0 }])).toBeNull();
    expect(parseMapListBody([{ replayCode: "A".repeat(65), team1Score: 1, team2Score: 0 }])).toBeNull();
    expect(parseMapListBody(Array.from({ length: 40 }, emptyMap))).toBeNull();
  });
});

describe("saisie et affichage", () => {
  it("ajout de map : bloqué au plafond et une fois le match acquis", () => {
    expect(canAddMap(BO5, [])).toBe(true);
    expect(canAddMap(BO5, mapsFor(2, 1))).toBe(true);
    expect(canAddMap(BO5, mapsFor(3, 1))).toBe(false);
    expect(canAddMap(FT3_DRAWS, mapsFor(1, 1, 3))).toBe(false);
    expect(canAddMap(null, mapsFor(0, 0, FREE_FORMAT_MAP_LIMIT))).toBe(false);
  });

  it("le détail ne s'affiche que s'il explique le score stocké (match d'avant les maps, score corrigé)", () => {
    const maps = mapsFor(3, 1);
    expect(mapsMatchStoredScore(maps, 3, 1)).toBe(true);
    expect(mapsMatchStoredScore(maps, 3, 0)).toBe(false);
    expect(mapsMatchStoredScore([], null, null)).toBe(false);
  });

  it("compare deux listes au code normalisé près", () => {
    const a: MatchMapInput[] = [{ replayCode: "abc123", team1Score: 1, team2Score: 0 }];
    expect(sameMapLists(a, [{ replayCode: "ABC123", team1Score: 1, team2Score: 0 }])).toBe(true);
    expect(sameMapLists(a, [{ replayCode: "ABC124", team1Score: 1, team2Score: 0 }])).toBe(false);
    expect(sameMapLists(a, [])).toBe(false);
  });

  it("chaque refus a sa phrase", () => {
    for (const code of [
      "MAP_LIST_EMPTY",
      "MAP_COUNT_EXCEEDED",
      "MAP_REPLAY_CODE_REQUIRED",
      "MAP_REPLAY_CODE_INVALID",
      "MAP_REPLAY_CODE_DUPLICATE",
      "MAP_SCORE_INVALID",
      "MAP_AFTER_DECISION",
      "MAP_LIST_INCOMPLETE",
      "DRAW_NOT_ALLOWED",
      "SCORE_EXCEEDS_MATCH_FORMAT",
      "SCORE_BELOW_MATCH_FORMAT",
    ] as const) {
      expect(mapListViolationMessage(code, BO5, "OW").length).toBeGreaterThan(5);
    }
    expect(mapListViolationMessage("SCORE_BELOW_MATCH_FORMAT", null)).toBe("Score incomplet.");
  });
});

describe("ligne vierge : jamais un 0 – 0 inventé", () => {
  it("s'ouvre sur des scores vides, qui ne désignent personne", () => {
    const blank = emptyMap();
    expect(Number.isNaN(blank.team1Score) && Number.isNaN(blank.team2Score)).toBe(true);
    expect(mapWinnerSide(blank)).toBeNull();
    expect(isMapTouched(blank)).toBe(false);
    expect(isMapTouched({ ...blank, replayCode: "A" })).toBe(true);
    expect(isMapTouched({ ...blank, team2Score: 0 })).toBe(true);
  });

  it("une map oubliée est refusée, rattachée à son score, et non comptée nulle", () => {
    const won = mapsFor(2, 0);
    const maps = [won[0], { ...emptyMap(), replayCode: "FORGOT" }, won[1]];
    expect(checkMapList(BO3, null, maps, decisive)).toMatchObject({
      error: "MAP_SCORE_INVALID",
      field: { index: 1, field: "team1Score" },
    });
  });
});

describe("checkMapList — la map nulle consomme une map du BO (décision du 2026-10-06)", () => {
  const BO5_DRAWS: MatchFormat = { type: "BO", value: 5, drawsAllowed: true };
  const decisive = { decisive: true };

  it("accepte un 2-2 en BO5 justifié par une cinquième map nulle", () => {
    const check = checkMapList(BO5_DRAWS, null, mapsFor(2, 2, 1), decisive);
    expect(check.error).toBeNull();
    expect(check.score).toMatchObject({ team1: 2, team2: 2, drawnMaps: 1 });
  });

  it("refuse un 2-2 en BO5 sur quatre maps, en désignant la dernière", () => {
    expect(checkMapList(BO5_DRAWS, null, mapsFor(2, 2), decisive)).toMatchObject({
      error: "MAP_LIST_INCOMPLETE",
      field: { index: 3, field: "team1Score" },
    });
    expect(mapListViolationMessage("MAP_LIST_INCOMPLETE", BO5_DRAWS)).toContain("les 5 maps");
  });

  it("n'exige rien d'un match gagné, ni d'un enregistrement intermédiaire", () => {
    expect(checkMapList(BO5_DRAWS, null, mapsFor(3, 1), decisive).error).toBeNull();
    expect(checkMapList(BO5_DRAWS, null, mapsFor(2, 2), { decisive: false }).error).toBeNull();
  });

  it("vaut aussi sous un plafond abaissé : 2-2 en FT3 plafonné à 4", () => {
    expect(checkMapList(FT3_DRAWS_CAP4, null, mapsFor(2, 2), decisive).error).toBeNull();
    expect(checkMapList(FT3_DRAWS_CAP4, null, mapsFor(1, 2), decisive).error).toBe("MAP_LIST_INCOMPLETE");
  });

  it("est un refus de règle des routes (400)", () => {
    expect(MAP_LIST_ERROR_CODES.has("MAP_LIST_INCOMPLETE")).toBe(true);
  });
});

describe("refusalOnTouchedRow — une ligne vierge n'appelle pas de reproche", () => {
  const filled = { replayCode: "ABC123", team1Score: 2, team2Score: 0 };

  it("tait le refus qui désigne la ligne vierge ajoutée après une map renseignée", () => {
    const maps = [filled, emptyMap()];
    const check = checkMapList({ type: "BO", value: 3 }, "OW", maps, { decisive: true });
    expect(check.field?.index).toBe(1);
    expect(refusalOnTouchedRow(check, maps)).toBe(false);
  });

  it("garde le refus d'une ligne renseignée, et celui qui ne désigne aucune ligne", () => {
    const maps = [{ ...filled, replayCode: "" }];
    expect(refusalOnTouchedRow(checkMapList(null, "OW", maps, { decisive: true }), maps)).toBe(true);
    expect(refusalOnTouchedRow({ field: null }, maps)).toBe(true);
    expect(refusalOnTouchedRow({ field: { index: 0, field: "replayCode" } }, [])).toBe(true);
  });

  it("borne un index hors liste (plafond dépassé) à la dernière ligne", () => {
    expect(refusalOnTouchedRow({ field: { index: 9, field: "replayCode" } }, [filled])).toBe(true);
  });
});

describe("progressiveMapRows — lignes une à une au fil du format (demande du 2026-10-06)", () => {
  const FT2: MatchFormat = { type: "FT", value: 2 };
  const BO5_DRAWS: MatchFormat = { type: "BO", value: 5, drawsAllowed: true };
  let n = 0;
  const win = (side: 1 | 2) => {
    n += 1;
    return { replayCode: `CODE${String(n).padStart(2, "0")}`, team1Score: side === 1 ? 2 : 0, team2Score: side === 1 ? 0 : 2 };
  };
  const drawn = () => {
    n += 1;
    return { replayCode: `CODE${String(n).padStart(2, "0")}`, team1Score: 1, team2Score: 1 };
  };
  /** Rejoue une saisie ligne à ligne : chaque map remplit la dernière ligne affichée. */
  const play = (format: MatchFormat, results: Array<() => ReturnType<typeof win>>) => {
    let rows = progressiveMapRows(format, "OW", [], 1);
    for (const next of results) {
      expect(isMapTouched(rows[rows.length - 1])).toBe(false);
      rows = progressiveMapRows(format, "OW", [...rows.slice(0, -1), next()], 1);
    }
    return rows;
  };

  it("commence par une seule ligne vierge (engagé), aucune pour l'arbitrage", () => {
    expect(progressiveMapRows(FT2, "OW", [], 1)).toEqual([emptyMap()]);
    expect(progressiveMapRows(FT2, "OW", [], 0)).toEqual([]);
  });

  it("FT2 2-0 : deux lignes, pas de troisième", () => {
    const rows = play(FT2, [() => win(1), () => win(1)]);
    expect(rows).toHaveLength(2);
    expect(rows.every(isMapTouched)).toBe(true);
  });

  it("FT2 1-1 ouvre une troisième ligne ; 2-1 s'arrête à trois", () => {
    const rows = play(FT2, [() => win(1), () => win(2), () => win(1)]);
    expect(rows).toHaveLength(3);
    expect(deriveMatchScore(rows)).toMatchObject({ team1: 2, team2: 1 });
  });

  it("BO5 3-0 : arrêt dès que l'équipe ne peut plus être rattrapée", () => {
    expect(play({ type: "BO", value: 5 }, [() => win(1), () => win(1), () => win(1)])).toHaveLength(3);
  });

  it("BO5 à égalités ouvertes, 2-2 : la cinquième ligne apparaît, une map nulle la clôt", () => {
    const four = play(BO5_DRAWS, [() => win(1), () => win(2), () => win(1), () => win(2)]);
    expect(four).toHaveLength(5);
    expect(isMapTouched(four[4])).toBe(false);
    const five = progressiveMapRows(BO5_DRAWS, "OW", [...four.slice(0, -1), drawn()], 1);
    expect(five).toHaveLength(5);
    expect(checkMapList(BO5_DRAWS, "OW", five, { decisive: true }).error).toBeNull();
  });

  it("une ligne incomplète n'ouvre pas la suivante", () => {
    const partial = { replayCode: "ABC123", team1Score: 2, team2Score: Number.NaN };
    expect(progressiveMapRows(FT2, "OW", [partial], 1)).toEqual([partial]);
    expect(isMapComplete(partial, "OW")).toBe(false);
    expect(isMapComplete({ ...partial, replayCode: "AB", team2Score: 0 }, "OW")).toBe(false);
  });

  it("une retouche qui tranche plus tôt retire les lignes vierges, garde les renseignées", () => {
    const [a, b] = [win(1), win(2)];
    // 1-1 en FT2 : la troisième ligne est vierge.
    const open = progressiveMapRows(FT2, "OW", [a, b], 1);
    expect(open).toHaveLength(3);
    // La map 2 corrigée en victoire de l'équipe 1 : 2-0, la ligne vierge s'en va.
    const fixed = progressiveMapRows(FT2, "OW", [a, { ...b, team1Score: 2, team2Score: 0 }, open[2]], 1);
    expect(fixed).toHaveLength(2);
    // Une troisième ligne renseignée reste, et la validation la désigne.
    const c = win(2);
    const kept = progressiveMapRows(FT2, "OW", [a, { ...b, team1Score: 2, team2Score: 0 }, c], 1);
    expect(kept).toHaveLength(3);
    expect(checkMapList(FT2, "OW", kept, { decisive: true })).toMatchObject({
      error: "MAP_AFTER_DECISION",
      field: { index: 2 },
    });
  });

  it("une proposition adverse pré-remplie s'affiche telle quelle, sans ligne de plus", () => {
    const theirs = [win(1), win(2), win(1)];
    expect(progressiveMapRows(FT2, "OW", theirs, 1)).toEqual(theirs);
  });

  it("ce qui part retire la ligne vierge de fin, mais jamais la seule ligne", () => {
    const a = win(1);
    expect(trimTrailingBlankMaps([a, emptyMap()])).toEqual([a]);
    expect(trimTrailingBlankMaps([emptyMap()])).toEqual([emptyMap()]);
    expect(trimTrailingBlankMaps([])).toEqual([]);
  });
});
