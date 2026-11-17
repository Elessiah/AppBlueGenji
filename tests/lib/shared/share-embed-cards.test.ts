import { describe, expect, it } from "@jest/globals";
import { messagesFor } from "@/lib/server/i18n-messages";
import {
  EMBED_MAX_MAPS,
  EMBED_TEAM_NAME_MAX_LENGTH,
  embedLongWhen,
  embedShortWhen,
  matchScheduledAt,
  embedShortDate,
  matchEmbedAlt,
  matchEmbedCard,
  matchEmbedDescription,
  matchEmbedTitle,
  tournamentEmbedAlt,
  tournamentEmbedCard,
} from "@/lib/shared/share-embed-cards";
import type { MatchShareSummary, ShareEntrantSide, ShareMapRow } from "@/lib/shared/share-embeds";
import { tournamentCard } from "../../helpers/tournament-card";

/**
 * Rédaction des cartes d'aperçu (`docs/features/SHARE_EMBEDS.md`) : textes dans
 * la langue de l'adresse, aucun pseudo, codes de replay des maps jouées (D74).
 */

const EN = messagesFor("en");
const FR = messagesFor("fr");

const ALPHA: ShareEntrantSide = { teamId: 10, name: "Alpha", logoUrl: "/uploads/teams/10.png", solo: false };
const BRAVO: ShareEntrantSide = { teamId: 20, name: "Bravo", logoUrl: null, solo: false };
const SOLO_1: ShareEntrantSide = { teamId: 10, name: null, logoUrl: null, solo: true };
const SOLO_2: ShareEntrantSide = { teamId: 20, name: null, logoUrl: null, solo: true };

function mapRow(mapNumber: number, overrides: Partial<ShareMapRow> = {}): ShareMapRow {
  return { mapNumber, mapName: null, team1Score: 2, team2Score: 1, replayCode: `CODE${mapNumber}`, ...overrides };
}

function summary(overrides: Partial<MatchShareSummary> = {}): MatchShareSummary {
  return {
    matchId: 7,
    bracket: "UPPER",
    roundNumber: 1,
    matchNumber: 1,
    round: null,
    startAt: null,
    status: "COMPLETED",
    team1: ALPHA,
    team2: BRAVO,
    score: { team1: 2, team2: 1 },
    winnerSide: 1,
    forfeitSide: null,
    doubleForfeit: false,
    maps: [],
    ...overrides,
  };
}

const CARD = tournamentCard({ name: "Spring Cup", state: "RUNNING", registeredTeams: 6, maxTeams: 8 });
const NOW = Date.parse("2026-05-13T10:00:00.000Z");

describe("tournamentEmbedCard", () => {
  it("tournamentEmbedCard_winner_subtitleAndLeaderMark", () => {
    const card = tournamentEmbedCard(
      { ...CARD, state: "FINISHED" },
      { kind: "WINNER", side: ALPHA },
      EN,
      "en",
      NOW,
    );

    expect(card.subtitle).toBe("Winner: Alpha");
    expect(card.leader).toEqual({ name: "Alpha", initial: "A", logoUrl: "/uploads/teams/10.png", winner: true });
  });

  it("tournamentEmbedCard_leader_saysLeading", () => {
    const card = tournamentEmbedCard(CARD, { kind: "LEADER", side: BRAVO }, EN, "en", NOW);

    expect(card.subtitle).toBe("Leading: Bravo");
    expect(card.leader?.winner).toBe(false);
  });

  it("tournamentEmbedCard_noLeader_usesDescription", () => {
    const card = tournamentEmbedCard({ ...CARD, description: "Open to all" }, null, EN, "en", NOW);

    expect(card.subtitle).toBe("Open to all");
    expect(card.leader).toBeNull();
  });

  it("tournamentEmbedCard_soloLeader_neverNamed", () => {
    const card = tournamentEmbedCard({ ...CARD, description: null }, { kind: "WINNER", side: SOLO_1 }, EN, "en", NOW);

    expect(card.subtitle).toBeUndefined();
    expect(card.leader).toBeNull();
  });

  it("tournamentEmbedCard_runningTeams_factsCountAndSchedule", () => {
    const card = tournamentEmbedCard(CARD, null, EN, "en", NOW);

    expect(card.facts.slice(1)).toEqual([
      { label: "Teams", value: "6/8" },
      { label: "Running since", value: embedShortDate(CARD.startAt, "en") },
    ]);
  });

  it("tournamentEmbedCard_soloTournament_countsPlayers", () => {
    const card = tournamentEmbedCard({ ...CARD, participantType: "SOLO" }, null, EN, "en", NOW);

    expect(card.facts[1].label).toBe("Players");
  });

  it("tournamentEmbedCard_upcomingBeforeOpening_showsOpeningDate", () => {
    const card = tournamentEmbedCard({ ...CARD, state: "UPCOMING" }, null, EN, "en", Date.parse("2026-05-01T00:00:00.000Z"));

    expect(card.facts[2]).toEqual({ label: "Registration from", value: embedShortDate(CARD.registrationOpenAt, "en") });
  });

  it("tournamentEmbedCard_invisibleOnlyName_fallsBackToGenericTitle", () => {
    const card = tournamentEmbedCard({ ...CARD, name: "​​" }, null, EN, "en", NOW);

    expect(card.title).toBe("Tournament");
  });

  it("tournamentEmbedCard_invalidDate_omitsScheduleFact", () => {
    const card = tournamentEmbedCard({ ...CARD, startAt: "not a date" }, null, EN, "en", NOW);

    expect(card.facts).toHaveLength(2);
  });
});

describe("matchEmbedCard", () => {
  it("matchEmbedCard_teams_scoreCenterAndWinner", () => {
    const card = matchEmbedCard(CARD, summary(), "Round 1 · Match 1", EN, "en");

    expect(card.center).toEqual({ kind: "score", team1: "2", team2: "1" });
    expect(card.team1).toEqual({ name: "Alpha", initial: "A", logoUrl: "/uploads/teams/10.png", winner: true });
    expect(card.team2.winner).toBe(false);
    expect(card.state).toEqual({ label: "Match over", tone: "success" });
  });

  it("matchEmbedCard_soloSides_genericPlayerNames", () => {
    const card = matchEmbedCard(CARD, summary({ team1: SOLO_1, team2: SOLO_2 }), "Match 1", FR, "fr");

    expect([card.team1.name, card.team2.name]).toEqual(["Joueur 1", "Joueur 2"]);
    expect(card.team1.logoUrl).toBeNull();
  });

  it("matchEmbedCard_emptySlot_toBeDecided", () => {
    const side: ShareEntrantSide = { teamId: null, name: null, logoUrl: null, solo: false };

    const card = matchEmbedCard(CARD, summary({ team2: side, score: null, status: "PENDING" }), "Match 1", EN, "en");

    expect(card.team2.name).toBe("To be decided");
    expect(card.center).toEqual({ kind: "none", text: "VS" });
    expect(card.state.label).toBe("Upcoming");
  });

  it("matchEmbedCard_blankTeamName_fallsBackToTeamNumber", () => {
    const card = matchEmbedCard(CARD, summary({ team2: { ...BRAVO, name: "  " } }), "Match 1", EN, "en");

    expect(card.team2.name).toBe("Team #20");
  });

  it("matchEmbedCard_mapsWithAndWithoutCode_cellsCarryCodeOrNull", () => {
    const maps = [mapRow(1, { mapName: "Ilios" }), mapRow(2, { replayCode: " ", team1Score: 0, team2Score: 2 })];

    const card = matchEmbedCard(CARD, summary({ maps }), "Match 1", EN, "en");

    expect(card.maps).toEqual([
      { label: "Map 1 · Ilios", score: "2 – 1", code: "CODE1", winnerSide: 1 },
      { label: "Map 2", score: "0 – 2", code: null, winnerSide: 2 },
    ]);
  });

  it("matchEmbedCard_drawnMap_noWinnerSide", () => {
    const card = matchEmbedCard(CARD, summary({ maps: [mapRow(1, { team1Score: 1, team2Score: 1 })] }), "Match 1", EN, "en");

    expect(card.maps[0].winnerSide).toBeNull();
  });

  it("matchEmbedCard_moreThanMaxMaps_countsExtra", () => {
    const maps = Array.from({ length: EMBED_MAX_MAPS + 2 }, (_, index) => mapRow(index + 1));

    const card = matchEmbedCard(CARD, summary({ maps }), "Match 1", EN, "en");

    expect(card.maps).toHaveLength(EMBED_MAX_MAPS);
    expect(card.moreMaps).toBe("+2 maps");
  });

  it("matchEmbedCard_forfeitWithoutScore_labelCenter", () => {
    const card = matchEmbedCard(CARD, summary({ score: null, forfeitSide: 2 }), "Match 1", EN, "en");

    expect(card.center).toEqual({ kind: "label", text: "Forfeit: Bravo" });
  });

  it("matchEmbedCard_forfeitWithFullScore_forfeitLabelNotScore", () => {
    const card = matchEmbedCard(CARD, summary({ score: { team1: 2, team2: 0 }, forfeitSide: 2 }), "Match 1", FR, "fr");

    expect(card.center).toEqual({ kind: "label", text: "Forfait : Bravo" });
  });

  it("matchEmbedCard_readyWithMaps_inProgress", () => {
    const match = summary({ status: "READY", score: null, winnerSide: null, maps: [mapRow(1)] });

    const card = matchEmbedCard(CARD, match, "Match 1", EN, "en");

    expect(card.state).toEqual({ label: "Match in progress", tone: "info" });
  });

  it("matchEmbedCard_pendingWithScore_inProgress", () => {
    const card = matchEmbedCard(CARD, summary({ status: "PENDING", winnerSide: null }), "Match 1", FR, "fr");

    expect(card.state).toEqual({ label: "Match en cours", tone: "info" });
  });

  it("matchEmbedCard_readyWithoutScoreOrMaps_upcoming", () => {
    const card = matchEmbedCard(CARD, summary({ status: "READY", score: null, winnerSide: null }), "Match 1", EN, "en");

    expect(card.state).toEqual({ label: "Upcoming", tone: "accent" });
  });

  it("matchEmbedAlt_soloSides_noPseudo", () => {
    expect(matchEmbedAlt(summary({ team1: SOLO_1, team2: SOLO_2 }), EN)).toBe("Preview of the match Player 1 vs Player 2");
  });

  it("tournamentEmbedAlt_invisibleOnlyName_fallsBackToGenericTitle", () => {
    expect(tournamentEmbedAlt({ ...CARD, name: "​" }, FR)).toBe("Aperçu du tournoi Tournoi");
  });

  it("matchEmbedCard_doubleForfeit_labelCenter", () => {
    const card = matchEmbedCard(CARD, summary({ score: null, doubleForfeit: true, winnerSide: null }), "Match 1", EN, "en");

    expect(card.center).toEqual({ kind: "label", text: "Double forfeit" });
  });

  it("matchEmbedCard_awaitingConfirmation_resultPending", () => {
    const card = matchEmbedCard(CARD, summary({ status: "AWAITING_CONFIRMATION" }), "Match 1", EN, "en");

    expect(card.state).toEqual({ label: "Result pending", tone: "info" });
  });
});

describe("matchEmbedTitle / matchEmbedDescription", () => {
  it("matchEmbedTitle_teams_versusThenPosition", () => {
    expect(matchEmbedTitle(summary(), "Round 2 · Match 3", EN, "en")).toBe("Alpha vs Bravo · Round 2 · Match 3");
  });

  it("matchEmbedTitle_solo_noPseudo", () => {
    expect(matchEmbedTitle(summary({ team1: SOLO_1, team2: SOLO_2 }), "Match 1", EN, "en")).toBe("Player 1 vs Player 2 · Match 1");
  });

  it("matchEmbedDescription_noScoreNoMaps_returnsNull", () => {
    expect(matchEmbedDescription(summary({ score: null, status: "PENDING" }), EN, "en")).toBeNull();
  });

  it("matchEmbedDescription_scoreAndMaps_listsScoresAndCodes", () => {
    const maps = [mapRow(1, { mapName: "Ilios" }), mapRow(2, { replayCode: "" })];

    expect(matchEmbedDescription(summary({ maps }), EN, "en")).toBe(
      "Alpha 2 – 1 Bravo · Map 1 (Ilios): 2–1, code CODE1 · Map 2: 2–1",
    );
  });

  it("matchEmbedDescription_forfeitWithFullScore_saysForfeitNotScore", () => {
    const description = matchEmbedDescription(summary({ score: { team1: 2, team2: 0 }, forfeitSide: 2 }), EN, "en");

    expect(description).toBe("Forfeit: Bravo");
  });

  it("matchEmbedDescription_doubleForfeit_saysSo", () => {
    expect(matchEmbedDescription(summary({ score: null, doubleForfeit: true }), EN, "en")).toBe("Double forfeit");
  });
});

describe("embedShortDate", () => {
  it("embedShortDate_invalid_returnsNull", () => {
    expect(embedShortDate("nope", "fr")).toBeNull();
  });

  it("embedShortDate_valid_parisTime", () => {
    expect(embedShortDate("2026-05-12T10:00:00.000Z", "en")).toMatch(/12:00$/u);
  });
});

describe("match a venir : horaire programme", () => {
  // Mardi 17 novembre 2026, 20:00 UTC = 21:00 a Paris.
  const START = "2026-11-17T20:00:00.000Z";
  const scheduled = (overrides: Partial<MatchShareSummary> = {}) =>
    summary({ status: "READY", score: null, winnerSide: null, startAt: START, ...overrides });

  it("matchScheduledAt_pendingWithStart_returnsStart", () => {
    expect(matchScheduledAt(scheduled())).toBe(START);
    expect(matchScheduledAt(scheduled({ status: "PENDING" }))).toBe(START);
  });

  it("matchScheduledAt_noStart_returnsNull", () => {
    expect(matchScheduledAt(scheduled({ startAt: null }))).toBeNull();
  });

  it("matchScheduledAt_unreadableStart_returnsNull", () => {
    expect(matchScheduledAt(scheduled({ startAt: "nope" }))).toBeNull();
  });

  it("matchScheduledAt_playedOrInProgress_returnsNull", () => {
    expect(matchScheduledAt(scheduled({ status: "COMPLETED" }))).toBeNull();
    expect(matchScheduledAt(scheduled({ status: "AWAITING_CONFIRMATION" }))).toBeNull();
    expect(matchScheduledAt(scheduled({ score: { team1: 1, team2: 0 } }))).toBeNull();
    expect(matchScheduledAt(scheduled({ maps: [mapRow(1)] }))).toBeNull();
    expect(matchScheduledAt(scheduled({ forfeitSide: 1 }))).toBeNull();
    expect(matchScheduledAt(scheduled({ doubleForfeit: true }))).toBeNull();
  });

  it("embedLongWhen_french_capitalisedParisTime", () => {
    expect(embedLongWhen(START, "fr")).toBe("Mardi 17 novembre · 21:00");
  });

  it("embedLongWhen_english_weekdayMonthDay", () => {
    expect(embedLongWhen(START, "en")).toBe("Tuesday, November 17 · 21:00");
  });

  it("embedShortWhen_bothLocales", () => {
    expect(embedShortWhen(START, "fr")).toBe("mar. 17 nov. 21:00");
    expect(embedShortWhen(START, "en")).toBe("Tue, Nov 17 21:00");
  });

  it("embedLongWhen_invalid_returnsNull", () => {
    expect(embedLongWhen("nope", "fr")).toBeNull();
    expect(embedShortWhen("nope", "en")).toBeNull();
  });

  it("matchEmbedCard_scheduled_carriesLargeScheduleWithZone", () => {
    expect(matchEmbedCard(CARD, scheduled(), "Quart de finale 2", FR, "fr").schedule).toEqual({
      when: "Mardi 17 novembre · 21:00",
      zone: "heure de Paris",
    });
    expect(matchEmbedCard(CARD, scheduled(), "Quarterfinal 2", EN, "en").schedule).toEqual({
      when: "Tuesday, November 17 · 21:00",
      zone: "Paris time",
    });
  });

  it("matchEmbedCard_playedOrNoDate_hasNoSchedule", () => {
    expect(matchEmbedCard(CARD, summary({ startAt: START }), "Final", EN, "en").schedule).toBeNull();
    expect(matchEmbedCard(CARD, scheduled({ startAt: null }), "Final", EN, "en").schedule).toBeNull();
  });

  it("matchEmbedTitle_scheduled_putsRoundThenDate", () => {
    expect(matchEmbedTitle(scheduled(), "Quart de finale 2", FR, "fr")).toBe(
      "Alpha contre Bravo · Quart de finale 2 · mar. 17 nov. 21:00",
    );
    expect(matchEmbedTitle(scheduled(), "Quarterfinal 2", EN, "en")).toBe(
      "Alpha vs Bravo · Quarterfinal 2 · Tue, Nov 17 21:00",
    );
  });

  it("matchEmbedTitle_played_hasNoDate", () => {
    expect(matchEmbedTitle(summary({ startAt: START }), "Final", EN, "en")).toBe("Alpha vs Bravo · Final");
  });

  it("matchEmbedDescription_scheduled_opensOnDateAndZone", () => {
    expect(matchEmbedDescription(scheduled(), FR, "fr")).toBe("Mardi 17 novembre · 21:00 (heure de Paris)");
    expect(matchEmbedDescription(scheduled(), EN, "en")).toBe("Tuesday, November 17 · 21:00 (Paris time)");
  });

  it("matchEmbedDescription_scheduledWithoutDate_staysNull", () => {
    expect(matchEmbedDescription(scheduled({ startAt: null }), EN, "en")).toBeNull();
  });

  it("matchEmbedCard_longTeamNames_areBoundedAndScheduleKept", () => {
    const long = { ...ALPHA, name: "A".repeat(80) };
    const card = matchEmbedCard(CARD, scheduled({ team1: long }), "Final", EN, "en");

    expect(card.team1.name.length).toBeLessThanOrEqual(EMBED_TEAM_NAME_MAX_LENGTH);
    expect(card.schedule?.when).toBe("Tuesday, November 17 · 21:00");
  });
});
