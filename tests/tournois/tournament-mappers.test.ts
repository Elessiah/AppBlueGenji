import { describe, it, expect } from "@jest/globals";
import { mapCard, mapMatch } from "@/lib/server/tournaments/_internal";
import type { MatchRow, TournamentListRow } from "@/lib/server/tournaments/_internal";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const cardRow = (overrides: Partial<TournamentListRow> = {}): TournamentListRow =>
  ({
    id: 1,
    name: "Cup",
    description: null,
    format: "SINGLE",
    game: "OW2",
    max_teams: 8,
    registered_teams: 4,
    state: "RUNNING",
    start_visibility_at: new Date("2026-05-01T08:00:00.000Z"),
    registration_open_at: new Date("2026-05-02T08:00:00.000Z"),
    registration_close_at: new Date("2026-05-10T08:00:00.000Z"),
    start_at: new Date("2026-05-20T10:00:00.000Z"),
    bracket_size: 8,
    created_at: new Date("2026-04-01T08:00:00.000Z"),
    organizer_user_id: 1,
    finished_at: null,
    has_third_place_match: 0,
    ...overrides,
  }) as unknown as TournamentListRow;

const matchRow = (overrides: Partial<MatchRow> = {}): MatchRow =>
  ({
    id: 1,
    tournament_id: 1,
    bracket: "UPPER",
    round_number: 1,
    match_number: 1,
    status: "READY",
    team1_id: 1,
    team2_id: 2,
    team1_name: "A",
    team2_name: "B",
    team1_placeholder: null,
    team2_placeholder: null,
    team1_score: null,
    team2_score: null,
    winner_team_id: null,
    loser_team_id: null,
    forfeit_team_id: null,
    next_winner_match_id: null,
    next_winner_slot: null,
    next_loser_match_id: null,
    next_loser_slot: null,
    team1_report_score: null,
    team1_report_opponent_score: null,
    team1_reported_at: null,
    team2_report_score: null,
    team2_report_opponent_score: null,
    team2_reported_at: null,
    score_deadline_at: null,
    updated_at: new Date("2026-05-20T10:00:00.000Z"),
    ...overrides,
  }) as unknown as MatchRow;

describe("mapCard — dates", () => {
  it("sérialise des objets Date en ISO 8601 exact", () => {
    const card = mapCard(cardRow());
    expect(card.startVisibilityAt).toBe("2026-05-01T08:00:00.000Z");
    expect(card.startAt).toBe("2026-05-20T10:00:00.000Z");
  });

  // Régression dateStrings:true — la pool renvoie les dates en `string`, ce qui
  // faisait planter `row.start_visibility_at.toISOString()` (TypeError).
  it("ne plante pas et produit de l'ISO quand les dates arrivent en string", () => {
    const row = cardRow({
      start_visibility_at: "2026-05-01 08:00:00" as unknown as Date,
      registration_open_at: "2026-05-02 08:00:00" as unknown as Date,
      registration_close_at: "2026-05-10 08:00:00" as unknown as Date,
      start_at: "2026-05-20 10:00:00" as unknown as Date,
      created_at: "2026-04-01 08:00:00" as unknown as Date,
    });
    expect(() => mapCard(row)).not.toThrow();
    const card = mapCard(row);
    expect(card.startVisibilityAt).toMatch(ISO);
    expect(card.registrationOpenAt).toMatch(ISO);
    expect(card.registrationCloseAt).toMatch(ISO);
    expect(card.startAt).toMatch(ISO);
  });
});

describe("mapMatch — dates", () => {
  it("sérialise updatedAt et garde scoreDeadlineAt nul", () => {
    const match = mapMatch(matchRow());
    expect(match.updatedAt).toBe("2026-05-20T10:00:00.000Z");
    expect(match.scoreDeadlineAt).toBeNull();
  });

  it("ne plante pas sur un updated_at/score_deadline_at en string", () => {
    const row = matchRow({
      updated_at: "2026-05-20 10:00:00" as unknown as Date,
      score_deadline_at: "2026-05-21 10:00:00" as unknown as Date,
    });
    expect(() => mapMatch(row)).not.toThrow();
    const match = mapMatch(row);
    expect(match.updatedAt).toMatch(ISO);
    expect(match.scoreDeadlineAt).toMatch(ISO);
  });
});
