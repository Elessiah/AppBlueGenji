import { describe, expect, it } from "@jest/globals";
import { parseAdminScoreBody } from "@/lib/shared/admin-score-body";
import { mapsFor } from "../../helpers/match-maps";

describe("parseAdminScoreBody", () => {
  it("lit le détail map par map, codes normalisés", () => {
    expect(
      parseAdminScoreBody({
        maps: [
          { replayCode: "abc123", team1Score: 2, team2Score: 0 },
          { replayCode: "DEF456", team1Score: 1, team2Score: 1 },
        ],
      }),
    ).toEqual({
      ok: true,
      value: {
        maps: [
          { replayCode: "ABC123", team1Score: 2, team2Score: 0 },
          { replayCode: "DEF456", team1Score: 1, team2Score: 1 },
        ],
      },
    });
  });

  it("accepte des maps qui dérivent une égalité : c'est au format de la manche d'en juger", () => {
    expect(parseAdminScoreBody({ maps: mapsFor(1, 1) }).ok).toBe(true);
  });

  it("lit un forfait nominatif, chaîne numérique comprise", () => {
    expect(parseAdminScoreBody({ forfeitTeamId: "5" })).toEqual({ ok: true, value: { forfeitTeamId: 5 } });
  });

  it("laisse le forfait l'emporter sur des maps, même mal formées", () => {
    expect(parseAdminScoreBody({ forfeitTeamId: 5, maps: mapsFor(2, 0) })).toEqual({
      ok: true,
      value: { forfeitTeamId: 5 },
    });
    expect(parseAdminScoreBody({ forfeitTeamId: 5, maps: "x" })).toEqual({ ok: true, value: { forfeitTeamId: 5 } });
  });

  it("refuse un forfait qui ne désigne pas un identifiant", () => {
    for (const forfeitTeamId of [0, -1, 2.5, "x"]) {
      expect(parseAdminScoreBody({ forfeitTeamId, maps: mapsFor(2, 0) })).toEqual({
        ok: false,
        error: "INVALID_FORFEIT_TEAM_ID",
      });
    }
  });

  it("traite `null` comme une absence", () => {
    expect(parseAdminScoreBody({ forfeitTeamId: null, maps: mapsFor(2, 1) })).toEqual({
      ok: true,
      value: { maps: mapsFor(2, 1) },
    });
    expect(parseAdminScoreBody({ forfeitTeamId: null, maps: null })).toEqual({ ok: false, error: "MAP_LIST_EMPTY" });
  });

  it("refuse un corps sans forfait ni maps, ou une liste vide, en MAP_LIST_EMPTY", () => {
    expect(parseAdminScoreBody({})).toEqual({ ok: false, error: "MAP_LIST_EMPTY" });
    expect(parseAdminScoreBody({ maps: [] })).toEqual({ ok: false, error: "MAP_LIST_EMPTY" });
  });

  it("refuse l'ancienne saisie à la main (deux scores sans maps) en MAP_LIST_EMPTY", () => {
    const legacy: Record<string, unknown> = { team1Score: 2, team2Score: 1 };
    expect(parseAdminScoreBody(legacy)).toEqual({ ok: false, error: "MAP_LIST_EMPTY" });
  });

  it("refuse un détail mal formé en INVALID_MAPS", () => {
    for (const maps of [
      "x",
      { replayCode: "AAA111", team1Score: 1, team2Score: 0 },
      [1],
      [null],
      [{ replayCode: 12, team1Score: 1, team2Score: 0 }],
      [{ replayCode: "AAA111", team1Score: "1", team2Score: 0 }],
      [{ replayCode: "A".repeat(65), team1Score: 1, team2Score: 0 }],
    ]) {
      expect(parseAdminScoreBody({ maps })).toEqual({ ok: false, error: "INVALID_MAPS" });
    }
  });
});
