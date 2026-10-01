import { describe, expect, it } from "@jest/globals";
import { ADMIN_SCORE_MAX, parseAdminScoreBody } from "@/lib/shared/admin-score-body";

describe("parseAdminScoreBody", () => {
  it("lit deux scores, chaînes numériques comprises", () => {
    expect(parseAdminScoreBody({ team1Score: "2", team2Score: 1 })).toEqual({
      ok: true,
      value: { team1Score: 2, team2Score: 1, forfeitTeamId: undefined },
    });
  });

  it("accepte l'égalité : c'est au format de la manche d'en juger", () => {
    expect(parseAdminScoreBody({ team1Score: 2, team2Score: 2 }).ok).toBe(true);
  });

  it("laisse le forfait l'emporter sans juger les scores", () => {
    expect(parseAdminScoreBody({ forfeitTeamId: 5, team1Score: -4 })).toEqual({
      ok: true,
      value: { team1Score: -4, team2Score: undefined, forfeitTeamId: 5 },
    });
  });

  it("refuse un forfait qui ne désigne pas un identifiant", () => {
    for (const forfeitTeamId of [0, -1, 2.5, "x"]) {
      expect(parseAdminScoreBody({ forfeitTeamId })).toEqual({ ok: false, error: "INVALID_FORFEIT_TEAM_ID" });
    }
  });

  it("traite `null` comme une absence", () => {
    expect(parseAdminScoreBody({ forfeitTeamId: null, team1Score: null, team2Score: 1 })).toEqual({
      ok: false,
      error: "MISSING_SCORES_OR_FORFEIT",
    });
  });

  it("borne les scores entre 0 et le maximum, entiers seulement", () => {
    expect(parseAdminScoreBody({ team1Score: 0, team2Score: ADMIN_SCORE_MAX }).ok).toBe(true);
    for (const [team1Score, team2Score] of [
      [-1, 0],
      [0, ADMIN_SCORE_MAX + 1],
      [0.5, 1],
      [Number.NaN, 1],
      [Infinity, 1],
    ]) {
      expect(parseAdminScoreBody({ team1Score, team2Score })).toEqual({ ok: false, error: "INVALID_SCORES" });
    }
  });
});
