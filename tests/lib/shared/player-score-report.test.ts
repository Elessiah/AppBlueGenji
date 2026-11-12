import { describe, expect, it } from "@jest/globals";
import {
  canOpenPlayerScoreDialog,
  confirmTheirsSend,
  entryComparison,
  mapListDifferences,
  opponentDetailKnown,
  reportBody,
  reportClosedMatch,
  seenOpponentReportAt,
  pendingReportNotice,
  pendingReportState,
  playerReportInitialScores,
  playerReportView,
  playerScoreButtonLabel,
  sameReportedScore,
  toReporterScores,
} from "@/lib/shared/player-score-report";
import type { MatchScoreReport } from "@/lib/shared/types";
import type { MatchMapInput } from "@/lib/shared/match-maps";
import { bracketMatch } from "../../helpers/bracket-match";
import { mapsFor } from "../../helpers/match-maps";

const report = (team1Score: number, team2Score: number): MatchScoreReport => ({
  team1Score,
  team2Score,
  reportedAt: "2026-09-28T20:00:00.000Z",
  maps: [],
});

const base = bracketMatch({
  status: "READY",
  team1Id: 10,
  team2Id: 20,
  team1Name: "Alpha",
  team2Name: "Bravo",
});

describe("playerReportView", () => {
  it("rend null à un spectateur ou à un lecteur sans engagé", () => {
    expect(playerReportView(base, null)).toBeNull();
    expect(playerReportView(base, 99)).toBeNull();
  });

  it("NONE tant que personne n'a proposé", () => {
    expect(playerReportView(base, 10)).toEqual({ phase: "NONE", mine: null, theirs: null });
  });

  it("MINE_PENDING pour qui a proposé, THEIRS_PENDING pour son adversaire", () => {
    const match = { ...base, team1Report: report(2, 1), status: "AWAITING_CONFIRMATION" as const };
    expect(playerReportView(match, 10)).toMatchObject({ phase: "MINE_PENDING", theirs: null });
    expect(playerReportView(match, 20)).toMatchObject({ phase: "THEIRS_PENDING", mine: null });
  });

  it("vu de l'équipe 2, sa proposition est la sienne", () => {
    const match = { ...base, team2Report: report(0, 2) };
    const view = playerReportView(match, 20)!;
    expect(view.mine).toEqual(report(0, 2));
    expect(view.theirs).toBeNull();
  });

  it("CONFLICT quand les deux propositions se contredisent", () => {
    const match = { ...base, team1Report: report(2, 0), team2Report: report(1, 2) };
    expect(playerReportView(match, 10)?.phase).toBe("CONFLICT");
    expect(playerReportView(match, 20)?.phase).toBe("CONFLICT");
  });

  it("deux propositions au même score sur un match ouvert se contredisent par leurs maps (MAP_SCORES.md)", () => {
    const match = { ...base, team1Report: report(2, 1), team2Report: report(2, 1) };
    // Concordantes, elles auraient clos le match dans la même transaction.
    expect(playerReportView(match, 10)?.phase).toBe("CONFLICT");
    expect(pendingReportNotice(match)).toBe("Score en litige · saisie verrouillée, arbitrage attendu");
  });
});

describe("playerReportInitialScores", () => {
  it("champs vides sans proposition — jamais un 0 – 0 inventé", () => {
    expect(playerReportInitialScores(null)).toEqual({ score1: "", score2: "" });
    expect(playerReportInitialScores(playerReportView(base, 10))).toEqual({ score1: "", score2: "" });
  });

  it("reprend sa propre proposition en priorité, sinon celle de l'adversaire", () => {
    const both = { ...base, team1Report: report(2, 0), team2Report: report(1, 2) };
    expect(playerReportInitialScores(playerReportView(both, 10))).toEqual({ score1: "2", score2: "0" });
    expect(playerReportInitialScores(playerReportView(both, 20))).toEqual({ score1: "1", score2: "2" });

    const theirs = { ...base, team1Report: report(2, 1) };
    expect(playerReportInitialScores(playerReportView(theirs, 20))).toEqual({ score1: "2", score2: "1" });
  });
});

describe("toReporterScores", () => {
  it("parle depuis l'engagé, quel que soit son côté", () => {
    expect(toReporterScores(true, 2, 1)).toEqual({ myScore: 2, opponentScore: 1 });
    expect(toReporterScores(false, 2, 1)).toEqual({ myScore: 1, opponentScore: 2 });
  });
});

describe("sameReportedScore", () => {
  const withMaps = (team1Score: number, team2Score: number, maps = mapsFor(team1Score, team2Score)) => ({
    ...report(team1Score, team2Score),
    maps: maps.map((map, index) => ({ ...map, mapNumber: index + 1 })),
  });

  it("compare les scores et les maps, pas l'horodatage", () => {
    expect(sameReportedScore(withMaps(2, 1), { team1Score: 2, team2Score: 1, maps: mapsFor(2, 1) })).toBe(true);
    expect(sameReportedScore(withMaps(2, 1), withMaps(1, 2))).toBe(false);
  });

  it("deux 2-1 aux codes différents se contredisent, comme au serveur", () => {
    const other = mapsFor(2, 1).map((map) => ({ ...map, replayCode: `X${map.replayCode}` }));
    expect(sameReportedScore(withMaps(2, 1), withMaps(2, 1, other))).toBe(false);
  });

  it("un détail absent (en lecture ou introuvable) ne concorde avec rien", () => {
    expect(sameReportedScore(report(2, 1), withMaps(2, 1))).toBe(false);
    expect(sameReportedScore(withMaps(2, 1), report(2, 1))).toBe(false);
    expect(sameReportedScore(report(2, 1), report(2, 1))).toBe(false);
  });
});

describe("canOpenPlayerScoreDialog", () => {
  const input = {
    match: base,
    myTeamId: 10,
    canReportScore: true,
    canActForEntrant: false,
    frozen: false,
  };

  it("s'ouvre sur le match du lecteur une fois lancé", () => {
    expect(canOpenPlayerScoreDialog(input)).toBe(true);
  });

  it("s'ouvre avant le lancement pour qui peut déclarer forfait, et seulement lui", () => {
    expect(canOpenPlayerScoreDialog({ ...input, canReportScore: false })).toBe(false);
    expect(
      canOpenPlayerScoreDialog({ ...input, canReportScore: false, canActForEntrant: true }),
    ).toBe(true);
  });

  it("reste fermé hors de son match, sur une case vide, sur un match joué ou un plateau figé", () => {
    expect(canOpenPlayerScoreDialog({ ...input, myTeamId: 99 })).toBe(false);
    expect(canOpenPlayerScoreDialog({ ...input, myTeamId: null })).toBe(false);
    expect(canOpenPlayerScoreDialog({ ...input, match: { ...base, team2Id: null } })).toBe(false);
    expect(canOpenPlayerScoreDialog({ ...input, match: { ...base, status: "COMPLETED" } })).toBe(false);
    expect(canOpenPlayerScoreDialog({ ...input, frozen: true })).toBe(false);
  });

  it("reste ouvert pendant l'attente de confirmation", () => {
    expect(
      canOpenPlayerScoreDialog({ ...input, match: { ...base, status: "AWAITING_CONFIRMATION" } }),
    ).toBe(true);
  });
});

describe("playerScoreButtonLabel", () => {
  it("annonce le geste attendu du lecteur", () => {
    expect(playerScoreButtonLabel(playerReportView(base, 10), true)).toBe("Saisir le score");
    const pending = { ...base, team1Report: report(2, 1) };
    expect(playerScoreButtonLabel(playerReportView(pending, 10), true)).toBe("Modifier mon score");
    expect(playerScoreButtonLabel(playerReportView(pending, 20), true)).toBe("Confirmer le score");
    const conflict = { ...pending, team2Report: report(0, 2) };
    expect(playerScoreButtonLabel(playerReportView(conflict, 10), true)).toBe("Voir le litige");
  });

  it("n'offre que le forfait tant que le match n'est pas lancé", () => {
    expect(playerScoreButtonLabel(playerReportView(base, 10), false)).toBe("Déclarer forfait");
  });

  it("annonce le litige, pas le forfait, à qui ne peut pas reporter", () => {
    // En litige, la modale n'offre plus le forfait : le bouton ne doit pas le promettre.
    const conflict = { ...base, team1Report: report(2, 1), team2Report: report(0, 2) };
    expect(playerScoreButtonLabel(playerReportView(conflict, 10), false)).toBe("Voir le litige");
    expect(playerScoreButtonLabel(playerReportView(conflict, 20), false)).toBe("Voir le litige");
  });
});

describe("pendingReportNotice", () => {
  it("se tait sans proposition, et sur un match joué", () => {
    expect(pendingReportNotice(base)).toBeNull();
    expect(
      pendingReportNotice({ ...base, status: "COMPLETED", team1Report: report(2, 1) }),
    ).toBeNull();
  });

  it("nomme le score et l'équipe qui l'a proposé", () => {
    expect(pendingReportNotice({ ...base, team2Report: report(0, 2) })).toBe(
      "0 – 2 proposé par Bravo · à confirmer",
    );
  });

  it("retombe sur « Équipe N » sans nom", () => {
    expect(pendingReportNotice({ ...base, team1Name: null, team1Report: report(2, 1) })).toBe(
      "2 – 1 proposé par Équipe 1 · à confirmer",
    );
  });

  // Validation d'office (`SCORE_DISPUTE_LOCK.md`) : l'heure, à l'heure de Paris, pour tous.
  it("annonce l'heure de la validation d'office quand l'échéance est connue", () => {
    expect(
      pendingReportNotice({ ...base, scoreDeadlineAt: "2026-10-20T18:05:00.000Z", team2Report: report(0, 2) }),
    ).toBe("0 – 2 proposé par Bravo · validation automatique à 20:05 (heure de Paris) sans réponse");
  });

  // Suspendue par un « Enregistrer » d'arbitrage : l'heure ne vaut plus, elle n'est pas dite.
  it("dit la validation d'office suspendue à la place de l'heure", () => {
    const paused = { ...base, scoreDeadlineAt: "2026-10-20T18:05:00.000Z", scoreAutoValidationPaused: true, team2Report: report(0, 2) };
    expect(pendingReportNotice(paused)).toBe("0 – 2 proposé par Bravo · validation automatique suspendue par l'arbitrage");
    expect(pendingReportState(paused)).toMatchObject({ kind: "proposed", paused: true });
    expect(pendingReportState({ ...paused, scoreAutoValidationPaused: false })).toMatchObject({ paused: false });
  });

  it("une suspension ne change rien à un litige", () => {
    expect(
      pendingReportNotice({ ...base, scoreAutoValidationPaused: true, team1Report: report(2, 0), team2Report: report(0, 2) }),
    ).toBe("Score en litige · saisie verrouillée, arbitrage attendu");
  });

  it("annonce un désaccord sans prendre parti", () => {
    expect(
      pendingReportNotice({ ...base, team1Report: report(2, 0), team2Report: report(0, 2) }),
    ).toBe("Score en litige · saisie verrouillée, arbitrage attendu");
  });
});

describe("mapListDifferences (déclaration adverse arrivée pendant la saisie, MAP_SCORES.md)", () => {
  const map = (team1Score: number, team2Score: number, replayCode = "ABC123"): MatchMapInput => ({
    replayCode,
    team1Score,
    team2Score,
  });

  it("mapListDifferences_identicalListsWithNormalizedCodes_returnsEmpty", () => {
    expect(mapListDifferences([map(2, 1, " abc123 ")], [map(2, 1, "ABC123")])).toEqual([]);
  });

  it("mapListDifferences_otherWinner_reportsWinnerOnly", () => {
    expect(mapListDifferences([map(2, 1)], [map(1, 2)])).toEqual([
      { mapNumber: 1, mine: map(2, 1), theirs: map(1, 2), kinds: ["WINNER"] },
    ]);
  });

  it("mapListDifferences_drawAgainstWin_reportsWinner", () => {
    expect(mapListDifferences([map(1, 1)], [map(2, 1)])[0].kinds).toEqual(["WINNER"]);
  });

  it("mapListDifferences_unreadScoreAgainstDraw_sameRuleAsMapWinnerSide", () => {
    // Score illisible et map nulle : ni l'un ni l'autre ne désigne de vainqueur (`mapWinnerSide`).
    expect(mapListDifferences([map(Number.NaN, 1)], [map(1, 1)])[0].kinds).toEqual(["SCORE"]);
  });

  it("mapListDifferences_infiniteScoreAgainstDraw_reportsScoreNotWinner", () => {
    // Score non fini : `mapWinnerSide` n'y voit aucun vainqueur, comme dans la
    // map nulle — l'écart est de score, pas de vainqueur.
    expect(mapListDifferences([map(Number.POSITIVE_INFINITY, 1)], [map(1, 1)])[0].kinds).toEqual(["SCORE"]);
  });

  it("mapListDifferences_sameWinnerOtherScore_reportsScore", () => {
    expect(mapListDifferences([map(3, 1)], [map(2, 1)])[0].kinds).toEqual(["SCORE"]);
  });

  it("mapListDifferences_otherReplayCode_reportsReplayCode", () => {
    expect(mapListDifferences([map(2, 1, "ABC123")], [map(2, 1, "ABC124")])[0].kinds).toEqual(["REPLAY_CODE"]);
  });

  it("mapListDifferences_otherScoreAndCode_reportsBoth", () => {
    expect(mapListDifferences([map(3, 1, "ABC123")], [map(2, 1, "ABC124")])[0].kinds).toEqual(["SCORE", "REPLAY_CODE"]);
  });

  it("mapListDifferences_extraMapInMine_reportsMissingTheirs", () => {
    expect(mapListDifferences([map(2, 1), map(2, 0)], [map(2, 1)])).toEqual([
      { mapNumber: 2, mine: map(2, 0), theirs: null, kinds: ["MISSING_THEIRS"] },
    ]);
  });

  it("mapListDifferences_extraMapInTheirs_reportsMissingMine", () => {
    expect(mapListDifferences([map(2, 1)], [map(2, 1), map(0, 2)])).toEqual([
      { mapNumber: 2, mine: null, theirs: map(0, 2), kinds: ["MISSING_MINE"] },
    ]);
  });
});

describe("entryComparison (saisie face à la déclaration adverse)", () => {
  const theirMaps = mapsFor(2, 1).map((m, i) => ({ ...m, mapNumber: i + 1 }));
  const theirs: MatchScoreReport = { team1Score: 2, team2Score: 1, reportedAt: "2026-09-28T20:00:00.000Z", maps: theirMaps };
  const theirsPending = { phase: "THEIRS_PENDING" as const, mine: null, theirs };
  const form = {
    canEnterScore: true,
    arrivedDuringEntry: false,
    confirmsAsIs: false,
    opensDispute: false,
    nothingEntered: false,
  };

  it("entryComparison_noOpponentDetail_returnsStableEmptyList", () => {
    const first = entryComparison(null, mapsFor(2, 1), form);
    const second = entryComparison(null, mapsFor(2, 1), form);

    expect(first.theirMaps).toEqual([]);
    expect(second.theirMaps).toBe(first.theirMaps);
  });

  it("entryComparison_arrivedAndIdentical_showsSameScoreBanner", () => {
    const result = entryComparison(theirsPending, mapsFor(2, 1), { ...form, arrivedDuringEntry: true, confirmsAsIs: true });

    expect(result.sameScoreArrived).toBe(true);
    expect(result.offerConfirmTheirs).toBe(false);
  });

  it("entryComparison_identicalButPrefilled_noBanner", () => {
    expect(entryComparison(theirsPending, mapsFor(2, 1), { ...form, confirmsAsIs: true }).sameScoreArrived).toBe(false);
  });

  it("entryComparison_draftOpensDispute_listsDifferencesAndOffersConfirm", () => {
    const result = entryComparison(theirsPending, mapsFor(2, 0), { ...form, opensDispute: true });

    expect(result.differences.length).toBeGreaterThan(0);
    expect(result.offerConfirmTheirs).toBe(true);
  });

  it("entryComparison_incompleteDraft_offersConfirmWithoutDifferences", () => {
    const result = entryComparison(theirsPending, mapsFor(1, 0), form);

    expect(result.differences).toEqual([]);
    expect(result.offerConfirmTheirs).toBe(true);
  });

  it("entryComparison_theirMapsStillLoading_offersNothing", () => {
    const loading = { ...theirsPending, theirs: { ...theirs, maps: [] } };

    const result = entryComparison(loading, mapsFor(2, 0), { ...form, opensDispute: true });

    expect(result.differences).toEqual([]);
    expect(result.offerConfirmTheirs).toBe(false);
  });

  it("entryComparison_conflictPhase_hasNoPendingTheirs", () => {
    const conflict = { phase: "CONFLICT" as const, mine: theirs, theirs };

    expect(entryComparison(conflict, mapsFor(2, 0), form)).toMatchObject({ theirs: null, offerConfirmTheirs: false });
  });

  it("entryComparison_nothingEntered_offersNothing", () => {
    expect(entryComparison(theirsPending, [], { ...form, nothingEntered: true }).offerConfirmTheirs).toBe(false);
  });

  it("entryComparison_cannotEnterScore_offersNothing", () => {
    const result = entryComparison(theirsPending, mapsFor(2, 1), {
      ...form,
      canEnterScore: false,
      arrivedDuringEntry: true,
      confirmsAsIs: true,
    });

    expect(result).toMatchObject({ sameScoreArrived: false, offerConfirmTheirs: false, differences: [] });
  });
});

describe("déclaration adverse vue, confirmée, close (MAP_SCORES.md — modale périmée)", () => {
  const AT = "2026-09-28T20:00:00.000Z";
  const theirMap = { mapNumber: 1, replayCode: "ABC123", team1Score: 2, team2Score: 1 };
  const withDetail: MatchScoreReport = { team1Score: 1, team2Score: 0, reportedAt: AT, maps: [theirMap] };
  const withoutDetail: MatchScoreReport = { team1Score: 1, team2Score: 0, reportedAt: AT, maps: [] };

  it("opponentDetailKnown_mapsPresent_returnsTrue", () => {
    expect(opponentDetailKnown(withDetail)).toBe(true);
  });

  it("opponentDetailKnown_noMapsOrNoReport_returnsFalse", () => {
    expect(opponentDetailKnown(withoutDetail)).toBe(false);
    expect(opponentDetailKnown(null)).toBe(false);
  });

  it("seenOpponentReportAt_detailKnown_returnsReportedAt", () => {
    expect(seenOpponentReportAt(withDetail, { team1Score: 1, team2Score: 0 })).toBe(AT);
  });

  it("seenOpponentReportAt_detailUnknownScoreDiffers_returnsReportedAt", () => {
    // Score différent : le litige se sait sans le détail (même règle que la confirmation du litige).
    expect(seenOpponentReportAt(withoutDetail, { team1Score: 0, team2Score: 1 })).toBe(AT);
  });

  it("seenOpponentReportAt_detailUnknownSameScore_returnsNull", () => {
    expect(seenOpponentReportAt(withoutDetail, { team1Score: 1, team2Score: 0 })).toBeNull();
  });

  it("seenOpponentReportAt_detailUnknownNothingEntered_returnsNull", () => {
    expect(seenOpponentReportAt(withoutDetail, null)).toBeNull();
  });

  it("seenOpponentReportAt_noOpponent_returnsNull", () => {
    expect(seenOpponentReportAt(null, { team1Score: 1, team2Score: 0 })).toBeNull();
    expect(seenOpponentReportAt(undefined, null)).toBeNull();
  });

  it("confirmTheirsSend_detailKnown_returnsTheirPlainMapsAndInstant", () => {
    expect(confirmTheirsSend(withDetail)).toEqual({
      maps: [{ replayCode: "ABC123", team1Score: 2, team2Score: 1 }],
      confirmTheirs: true,
      seenAt: AT,
    });
  });

  it("confirmTheirsSend_detailUnknown_returnsNull", () => {
    expect(confirmTheirsSend(withoutDetail)).toBeNull();
    expect(confirmTheirsSend(null)).toBeNull();
  });

  it("reportClosedMatch_confirmTheirs_returnsTrue", () => {
    expect(reportClosedMatch(true, {})).toBe(true);
  });

  it("reportClosedMatch_completedTrue_returnsTrue", () => {
    expect(reportClosedMatch(false, { success: true, completed: true })).toBe(true);
  });

  it("reportClosedMatch_completedFalseMissingOrMalformed_returnsFalse", () => {
    expect(reportClosedMatch(false, { success: true, completed: false })).toBe(false);
    expect(reportClosedMatch(false, { success: true })).toBe(false);
    expect(reportClosedMatch(false, { completed: "true" })).toBe(false);
    expect(reportClosedMatch(false, null)).toBe(false);
  });
});

describe("reportBody (MAP_SCORES.md)", () => {
  const maps: MatchMapInput[] = [{ replayCode: "ABC123", team1Score: 2, team2Score: 1 }];

  it("reportBody_confirmTheirsWithSeenAt_sendsConfirmWithCapturedInstant", () => {
    const body = reportBody({ maps, confirmTheirs: true, seenAt: "2026-10-05T20:00:00.000Z" });

    expect(JSON.parse(body)).toEqual({ maps, confirm: { reportedAt: "2026-10-05T20:00:00.000Z" } });
  });

  it("reportBody_confirmTheirsSeenNull_sendsPlainBodyWithNullSeen", () => {
    const body = reportBody({ maps, confirmTheirs: true, seenAt: null });

    expect(JSON.parse(body)).toEqual({ maps, seenOpponentReportAt: null });
  });

  it("reportBody_plainSend_sendsSeenOpponentReportAt", () => {
    const body = reportBody({ maps, confirmTheirs: false, seenAt: "2026-10-05T20:00:00.000Z" });

    expect(JSON.parse(body)).toEqual({ maps, seenOpponentReportAt: "2026-10-05T20:00:00.000Z" });
  });
});
