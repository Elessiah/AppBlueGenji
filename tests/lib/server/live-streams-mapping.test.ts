import { describe, expect, it } from "@jest/globals";
import { mapCard, mapMatch } from "@/lib/server/tournaments/_internal";

/**
 * Revalidation des liens de diffusion à la lecture.
 *
 * Les routes d'écriture normalisent déjà, mais une ligne posée avant la liste
 * blanche — ou éditée à la main en base — ne doit jamais ressortir en `href`.
 * Le piège le plus concret est l'URL sans schéma : rendue telle quelle, elle
 * devient un lien **relatif** qui renvoie le visiteur dans le site au lieu de
 * la chaîne de diffusion.
 */

function tournamentRow(liveUrl: string | null) {
  return {
    id: 1,
    name: "Coupe",
    description: null,
    format: "SINGLE",
    game: "OW2",
    max_teams: 8,
    registered_teams: 8,
    state: "RUNNING",
    start_visibility_at: new Date("2026-08-01T00:00:00Z"),
    registration_open_at: new Date("2026-08-01T00:00:00Z"),
    registration_close_at: new Date("2026-08-10T00:00:00Z"),
    start_at: new Date("2026-08-20T00:00:00Z"),
    bracket_size: 8,
    created_at: new Date("2026-08-01T00:00:00Z"),
    organizer_user_id: 1,
    finished_at: null,
    has_third_place_match: 0,
    survival_rounds_before_first_cut: null,
    survival_rounds_per_cut: null,
    survival_current_round: 0,
    current_phase_id: null,
    manual_seeding: 0,
    participant_type: "TEAM",
    match_format_type: null,
    match_format_value: null,
    live_url: liveUrl,
  } as never;
}

function matchRow(liveUrl: string | null, startAt: Date | null = null) {
  return {
    id: 5,
    tournament_id: 1,
    bracket: "UPPER",
    round_number: 1,
    match_number: 1,
    status: "READY",
    team1_id: 1,
    team2_id: 2,
    team1_name: "Alpha",
    team2_name: "Bravo",
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
    updated_at: new Date("2026-08-20T00:00:00Z"),
    phase_id: 0,
    phase_position: null,
    start_at: startAt,
    live_trigger: "AUTO",
    live_url: liveUrl,
    live_started_at: null,
  } as never;
}

describe("mapCard — chaîne officielle", () => {
  it("laisse passer un lien déjà normalisé", () => {
    expect(mapCard(tournamentRow("https://twitch.tv/bg")).liveUrl).toBe("https://twitch.tv/bg");
  });

  it("normalise une URL sans schéma plutôt que d'en faire un lien relatif", () => {
    expect(mapCard(tournamentRow("twitch.tv/bg")).liveUrl).toBe("https://twitch.tv/bg");
  });

  it("écarte une URL hors liste blanche laissée en base", () => {
    expect(mapCard(tournamentRow("https://exemple.com/live")).liveUrl).toBeNull();
    expect(mapCard(tournamentRow("javascript:alert(1)")).liveUrl).toBeNull();
  });

  it("garde null quand aucune chaîne n'est renseignée", () => {
    expect(mapCard(tournamentRow(null)).liveUrl).toBeNull();
  });
});

describe("mapMatch — chaîne du match", () => {
  it("normalise et filtre de la même façon", () => {
    expect(mapMatch(matchRow("kick.com/bg")).liveUrl).toBe("https://kick.com/bg");
    expect(mapMatch(matchRow("https://exemple.com/live")).liveUrl).toBeNull();
    expect(mapMatch(matchRow(null)).liveUrl).toBeNull();
  });

  it("expose le mode et l'antenne tels quels", () => {
    const match = mapMatch(matchRow("https://twitch.tv/bg"));
    expect(match.liveTrigger).toBe("AUTO");
    expect(match.liveStartedAt).toBeNull();
  });
});

describe("mapMatch — date de début", () => {
  it("sérialise l'horaire en ISO", () => {
    const startAt = new Date("2026-08-29T18:30:00Z");
    expect(mapMatch(matchRow(null, startAt)).startAt).toBe("2026-08-29T18:30:00.000Z");
  });

  it("garde null quand aucun horaire n'est annoncé", () => {
    expect(mapMatch(matchRow(null)).startAt).toBeNull();
  });

  it("tolère une ligne antérieure à la colonne", () => {
    // La migration ajoute la colonne, mais un appelant qui construit une ligne
    // sans elle (test, cache d'un ancien format) ne doit pas produire `undefined`
    // dans la charge utile poussée par le flux.
    const row = matchRow(null) as unknown as Record<string, unknown>;
    delete row.start_at;
    expect(mapMatch(row as never).startAt).toBeNull();
  });
});
