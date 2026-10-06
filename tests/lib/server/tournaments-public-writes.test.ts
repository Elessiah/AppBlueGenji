import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/registration");
jest.mock("@/lib/server/tournaments/repository");
jest.mock("@/lib/server/tournaments/bot-logs");
jest.mock("@/lib/server/tournaments/list-cache");
jest.mock("@/lib/server/tournaments/finalization");
jest.mock("@/lib/server/tournaments/byes");
jest.mock("@/lib/server/tournaments/scoring");
jest.mock("@/lib/server/tournaments/player-pushes");
jest.mock("@/lib/server/tournaments/player-forfeit");
jest.mock("@/lib/server/tournaments/admin");
jest.mock("@/lib/server/tournaments/survival");
jest.mock("@/lib/server/tournaments/swiss");
jest.mock("@/lib/server/tournaments/bg-survie/reconcile");
jest.mock("@/lib/server/tournaments/bg-survie/forfeit");
jest.mock("@/lib/server/tournaments/bg-survie/penalties");
jest.mock("@/lib/server/tournaments/phases");
jest.mock("@/lib/server/tournaments/phases-repository");

import {
  adminResolveMatchPublic,
  adminSaveMatchScoresPublic,
  applyEndurancePenaltyPublic,
  createTournament,
  forfeitOwnMatchPublic,
  forfeitTournamentTeamPublic,
  getUserEntrant,
  liftEndurancePenaltyPublic,
  registerCurrentUserTeam,
  registerGhostTeams,
  reportMatchScorePublic,
} from "@/lib/server/tournaments";
import { getDatabase } from "@/lib/server/database";
import {
  publishScoreReportedEvent,
  publishScoreResolvedEvent,
  publishUpdatedEvent,
} from "@/lib/server/tournaments/notifications";
import {
  registerCurrentUserTeam as registerTeamInternal,
  registerTeamsByIds,
  resolveUserEntrant,
} from "@/lib/server/tournaments/registration";
import { loadTournamentRow } from "@/lib/server/tournaments/repository";
import { discardBotLogs, flushBotLogs, queueBotLog } from "@/lib/server/tournaments/bot-logs";
import { invalidateTournamentLists } from "@/lib/server/tournaments/list-cache";
import { finalizeTournamentIfDone, resolveExpiredScoreReports } from "@/lib/server/tournaments/finalization";
import { tryAutoResolveByes } from "@/lib/server/tournaments/byes";
import { reportMatchScore } from "@/lib/server/tournaments/scoring";
import { notifyScoreToConfirm } from "@/lib/server/tournaments/player-pushes";
import { forfeitOwnMatch } from "@/lib/server/tournaments/player-forfeit";
import { adminResolveMatch, adminSaveMatchScores } from "@/lib/server/tournaments/admin";
import { forfeitSurvivalTeam, reconcileSurvival } from "@/lib/server/tournaments/survival";
import { forfeitSwissTeam, reconcileSwiss } from "@/lib/server/tournaments/swiss";
import { forfeitEnduranceTeam } from "@/lib/server/tournaments/bg-survie/forfeit";
import {
  applyEndurancePenalty,
  liftEndurancePenalty,
} from "@/lib/server/tournaments/bg-survie/penalties";
import { reconcileEndurance } from "@/lib/server/tournaments/bg-survie/reconcile";
import { reconcilePhases } from "@/lib/server/tournaments/phases";
import { insertPhases } from "@/lib/server/tournaments/phases-repository";
import { connectionMock, fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";
import { tournamentRow } from "../../helpers/tournament-rows";
import { mapsFor } from "../../helpers/match-maps";

/**
 * Les écritures publiques du moteur de tournois (`lib/server/tournaments/index.ts`) :
 * ce que chacune **orchestre** autour du moteur, qui est simulé ici.
 *
 * Le moteur a ses propres tests ; ce qui ne se vérifiait nulle part, c'est la
 * chaîne autour de lui — une transaction ouverte, la réconciliation de chaque
 * mode à classement, la clôture, puis **après le commit seulement** le journal,
 * l'événement de flux et le cache de liste. Un maillon oublié ne casse aucun
 * test du moteur : la manche suivante reste non appariée, ou la liste publique
 * garde un tournoi terminé dans « En cours ».
 */

type Connection = ReturnType<typeof connectionMock>;
let connection: Connection;
/** Lectures faites hors transaction, sur le pool (état d'un tournoi). */
let poolExecute: jest.Mock<SqlQuery>;

beforeEach(() => {
  jest.clearAllMocks();
  connection = connectionMock();
  connection.execute.mockResolvedValue([[], undefined]);
  poolExecute = jest.fn<SqlQuery>().mockResolvedValue([[], undefined]);
  jest.mocked(getDatabase).mockResolvedValue(
    fakePool({ execute: poolExecute, getConnection: jest.fn(async () => fakeConnection(connection)) }),
  );
  jest.mocked(queueBotLog).mockReturnValue(true);
  jest.mocked(notifyScoreToConfirm).mockResolvedValue(0);
});

/** Ordre d'appel d'un double (premier appel), pour comparer deux étapes. */
function order(mock: { mock: { invocationCallOrder: number[] } }): number {
  const first = mock.mock.invocationCallOrder[0];
  if (first === undefined) throw new Error("jamais appelé");
  return first;
}

/** Une transaction qui a abouti : commit, puis journal, rien de défait. */
function expectCommitted(): void {
  expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
  expect(connection.commit).toHaveBeenCalledTimes(1);
  expect(connection.rollback).not.toHaveBeenCalled();
  expect(order(jest.mocked(flushBotLogs))).toBeGreaterThan(order(connection.commit));
  expect(connection.release).toHaveBeenCalledTimes(1);
  expect(discardBotLogs).toHaveBeenCalledTimes(1);
}

/** Une transaction défaite : rien de publié, la connexion rendue quand même. */
function expectRolledBack(): void {
  expect(connection.commit).not.toHaveBeenCalled();
  expect(connection.rollback).toHaveBeenCalledTimes(1);
  expect(flushBotLogs).not.toHaveBeenCalled();
  expect(publishUpdatedEvent).not.toHaveBeenCalled();
  expect(publishScoreReportedEvent).not.toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalledTimes(1);
  expect(discardBotLogs).toHaveBeenCalledTimes(1);
}

const DAY = 86_400_000;
type Milestones = Record<"startVisibilityAt" | "registrationOpenAt" | "registrationCloseAt" | "startAt", string>;
/** Jalons relatifs à maintenant (en jours), pour un état initial indépendant de l'horloge. */
function datesFrom(open: number): Milestones {
  const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();
  return {
    startVisibilityAt: at(open - 1),
    registrationOpenAt: at(open),
    registrationCloseAt: at(open + 1),
    startAt: at(open + 2),
  };
}
const DATES = datesFrom(10);

/** L'`INSERT` du tournoi, ses colonnes associées à leurs valeurs. */
function insertedTournament(): Record<string, unknown> {
  const call = connection.execute.mock.calls.find(([sql]) => sql.includes("INSERT INTO bg_tournaments"));
  if (!call) throw new Error("aucun INSERT");
  const [sql, params] = call;
  const columns = /\(([^)]*)\)\s*VALUES/.exec(sql)?.[1].split(",").map((c) => c.trim()) ?? [];
  const values = params as unknown[];
  expect(values).toHaveLength(columns.length);
  return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
}

describe("createTournament", () => {
  beforeEach(() => {
    connection.execute.mockResolvedValue([{ insertId: 41 }, undefined]);
  });

  const base = {
    name: "  Coupe d'automne  ",
    description: null,
    format: "SINGLE" as const,
    maxTeams: 16,
    ...DATES,
  };

  it("écrit le tournoi, journalise et vide les listes après le commit", async () => {
    await expect(createTournament(9, base)).resolves.toBe(41);

    const row = insertedTournament();
    expect(row).toMatchObject({
      organizer_user_id: 9,
      name: "Coupe d'automne",
      game: "OW",
      participant_type: "TEAM",
      max_teams: 16,
      has_third_place_match: 0,
      survival_rounds_per_cut: null,
      swiss_total_rounds: null,
      match_format_type: null,
      match_format_draws: 0,
      endurance_playoff_format_type: null,
      referee_scheduling: 0,
    });
    expect(row.start_at).toEqual(new Date(DATES.startAt));
    expectCommitted();
    expect(queueBotLog).toHaveBeenCalledWith(expect.anything(), { kind: "tournament_created", tournamentId: 41 });
    expect(order(jest.mocked(invalidateTournamentLists))).toBeGreaterThan(order(connection.commit));
  });

  it("naît « à venir » quand les inscriptions ne sont pas ouvertes", async () => {
    await createTournament(9, base);
    expect(insertedTournament().state).toBe("UPCOMING");
  });

  it("naît inscriptions ouvertes quand leur fenêtre est déjà commencée", async () => {
    await createTournament(9, { ...base, ...datesFrom(-0.5) });
    expect(insertedTournament().state).toBe("REGISTRATION");
  });

  it("borne la cadence des coupes en Survie, et retombe sur l'intervalle", async () => {
    await createTournament(9, { ...base, format: "SURVIVAL", survivalRoundsPerCut: 0.4 });

    expect(insertedTournament()).toMatchObject({
      survival_rounds_per_cut: 1,
      survival_rounds_before_first_cut: 1,
    });
  });

  it("garde le délai de première coupe choisi en Survie", async () => {
    await createTournament(9, {
      ...base,
      format: "SURVIVAL",
      survivalRoundsPerCut: 2,
      survivalRoundsBeforeFirstCut: 4.8,
    });

    expect(insertedTournament()).toMatchObject({
      survival_rounds_per_cut: 2,
      survival_rounds_before_first_cut: 4,
    });
  });

  it("applique le barème suisse, et vaut au bye ce que vaut une victoire", async () => {
    await createTournament(9, {
      ...base,
      format: "SWISS",
      swissTotalRounds: 0,
      swissPointsWin: 2,
      swissPointsDraw: -3,
      swissPointsLoss: null,
    });

    expect(insertedTournament()).toMatchObject({
      swiss_total_rounds: 1,
      swiss_points_win: 2,
      swiss_points_draw: 0,
      swiss_points_loss: 0,
      swiss_points_bye: 2,
    });
  });

  it("ignore le barème suisse hors Ronde suisse", async () => {
    await createTournament(9, { ...base, swissTotalRounds: 7, swissPointsWin: 9 });

    expect(insertedTournament()).toMatchObject({
      swiss_total_rounds: null,
      swiss_points_win: 3,
      swiss_points_draw: 1,
      swiss_points_loss: 0,
      swiss_points_bye: 3,
    });
  });

  it("écrit le format des matchs et celui de l'arbre final en BG Survie", async () => {
    await createTournament(9, {
      ...base,
      format: "BG_SURVIE",
      matchFormat: { type: "FT", value: 3, maxMaps: null, drawsAllowed: false },
      endurancePlayoffFormat: { type: "BO", value: 5, maxMaps: null, drawsAllowed: false },
      endurancePoints: 7,
      refereeScheduling: true,
    });

    expect(insertedTournament()).toMatchObject({
      match_format_type: "FT",
      match_format_value: 3,
      endurance_playoff_format_type: "BO",
      endurance_playoff_format_value: 5,
      endurance_start_points: 7,
      referee_scheduling: 1,
    });
  });

  it("n'écrit pas de format d'arbre final hors BG Survie", async () => {
    await createTournament(9, {
      ...base,
      endurancePlayoffFormat: { type: "BO", value: 5, maxMaps: null, drawsAllowed: false },
    });

    expect(insertedTournament().endurance_playoff_format_type).toBeNull();
  });

  it("refuse des jalons dans le désordre, sans rien écrire", async () => {
    await expect(
      createTournament(9, { ...base, startAt: DATES.startVisibilityAt, startVisibilityAt: DATES.startAt }),
    ).rejects.toThrow("INVALID_DATE_ORDER");

    expect(connection.execute).not.toHaveBeenCalled();
    expectRolledBack();
    expect(invalidateTournamentLists).not.toHaveBeenCalled();
  });

  it("insère les phases d'un tournoi multi-phases, numérotées dans l'ordre", async () => {
    await createTournament(9, {
      ...base,
      format: "MULTI",
      phases: [{ format: "SWISS", qualifierMode: "COUNT", qualifierValue: 8 }, { format: "SINGLE" }],
    });

    expect(insertPhases).toHaveBeenCalledWith(
      expect.anything(),
      41,
      [
        expect.objectContaining({ position: 1, format: "SWISS", qualifierValue: 8 }),
        expect.objectContaining({ position: 2, format: "SINGLE" }),
      ],
    );
    expectCommitted();
  });

  it("défait la création quand les phases sont invalides", async () => {
    await expect(
      createTournament(9, {
        ...base,
        format: "MULTI",
        phases: [{ format: "SWISS", qualifierMode: "COUNT", qualifierValue: 0 }, { format: "SINGLE" }],
      }),
    ).rejects.toThrow();

    expect(insertPhases).not.toHaveBeenCalled();
    expectRolledBack();
  });
});

describe("inscriptions", () => {
  it("inscrit l'équipe du joueur puis publie après le commit", async () => {
    await registerCurrentUserTeam(5, 12);

    expect(registerTeamInternal).toHaveBeenCalledWith(expect.anything(), 5, 12);
    expectCommitted();
    expect(order(jest.mocked(publishUpdatedEvent))).toBeGreaterThan(order(connection.commit));
  });

  it("défait l'inscription refusée et la laisse remonter", async () => {
    jest.mocked(registerTeamInternal).mockRejectedValue(new Error("TOURNAMENT_FULL"));

    await expect(registerCurrentUserTeam(5, 12)).rejects.toThrow("TOURNAMENT_FULL");
    expectRolledBack();
  });

  it("inscrit un lot de fantômes en une seule transaction et un seul événement", async () => {
    await registerGhostTeams(5, [1, 2, 3]);

    expect(registerTeamsByIds).toHaveBeenCalledWith(expect.anything(), 5, [1, 2, 3]);
    expectCommitted();
    expect(publishUpdatedEvent).toHaveBeenCalledTimes(1);
  });

  it("n'inscrit aucun fantôme quand le lot échoue", async () => {
    jest.mocked(registerTeamsByIds).mockRejectedValue(new Error("TOURNAMENT_FULL"));

    await expect(registerGhostTeams(5, [1, 2])).rejects.toThrow("TOURNAMENT_FULL");
    expectRolledBack();
  });
});

describe("getUserEntrant", () => {
  it("résout l'engagé du joueur sur le tournoi lu", async () => {
    const tournament = tournamentRow({ id: 5 });
    jest.mocked(loadTournamentRow).mockResolvedValue(tournament);
    const entrant = { teamId: 3, canActForEntrant: true, canConductMatch: true };
    jest.mocked(resolveUserEntrant).mockResolvedValue(entrant);

    await expect(getUserEntrant(5, 12)).resolves.toBe(entrant);
    expect(resolveUserEntrant).toHaveBeenCalledWith(expect.anything(), tournament, 12);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("lève TOURNAMENT_NOT_FOUND sur un tournoi inconnu, et rend la connexion", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValue(null);

    await expect(getUserEntrant(5, 12)).rejects.toThrow("TOURNAMENT_NOT_FOUND");
    expect(resolveUserEntrant).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });
});

describe("écritures d'un engagé — report de score, forfait sur sa manche", () => {
  /** État du tournoi lu avant puis après la transaction. */
  function statesBeforeAfter(before: string | null, after: string | null): void {
    poolExecute
      .mockResolvedValueOnce([before ? [{ state: before }] : [], undefined])
      .mockResolvedValueOnce([after ? [{ state: after }] : [], undefined]);
  }

  it("rejoue un report annulé par un interblocage, et seulement celui-là (MAP_SCORES.md)", async () => {
    poolExecute.mockResolvedValue([[{ state: "RUNNING" }], undefined]);
    const deadlock = Object.assign(new Error("Deadlock found when trying to get lock"), { code: "ER_LOCK_DEADLOCK" });
    jest.mocked(reportMatchScore).mockRejectedValueOnce(deadlock).mockResolvedValueOnce(undefined);

    await reportMatchScorePublic(5, 70, 12, mapsFor(3, 1));
    expect(reportMatchScore).toHaveBeenCalledTimes(2);

    jest.mocked(reportMatchScore).mockReset();
    jest.mocked(reportMatchScore).mockRejectedValue(new Error("NOT_IN_MATCH"));
    await expect(reportMatchScorePublic(5, 70, 12, mapsFor(3, 1))).rejects.toThrow("NOT_IN_MATCH");
    expect(reportMatchScore).toHaveBeenCalledTimes(1);
    jest.mocked(reportMatchScore).mockReset();
  });

  it("réconcilie chaque mode, clôt, puis publie et prévient l'adversaire", async () => {
    statesBeforeAfter("RUNNING", "RUNNING");

    await reportMatchScorePublic(5, 70, 12, mapsFor(3, 1));

    expect(reportMatchScore).toHaveBeenCalledWith(expect.anything(), 5, 70, 12, mapsFor(3, 1), undefined);
    const chain = [
      reportMatchScore,
      resolveExpiredScoreReports,
      tryAutoResolveByes,
      reconcileSurvival,
      reconcileSwiss,
      reconcileEndurance,
      reconcilePhases,
      finalizeTournamentIfDone,
    ].map((fn) => order(jest.mocked(fn)));
    expect([...chain].sort((a, b) => a - b)).toEqual(chain);
    expect(order(connection.commit)).toBeGreaterThan(chain.at(-1) ?? 0);
    expectCommitted();
    expect(publishScoreReportedEvent).toHaveBeenCalledWith(5, 70);
    expect(notifyScoreToConfirm).toHaveBeenCalledWith(70);
  });

  it("ne vide pas la liste quand l'état n'a pas bougé", async () => {
    statesBeforeAfter("RUNNING", "RUNNING");

    await reportMatchScorePublic(5, 70, 12, mapsFor(3, 1));

    expect(invalidateTournamentLists).not.toHaveBeenCalled();
  });

  it("vide la liste quand le score a clos le tournoi", async () => {
    statesBeforeAfter("RUNNING", "FINISHED");

    await reportMatchScorePublic(5, 70, 12, mapsFor(3, 1));

    expect(invalidateTournamentLists).toHaveBeenCalledTimes(1);
  });

  it("ne fait pas échouer un score enregistré quand l'état ne se relit pas", async () => {
    poolExecute
      .mockResolvedValueOnce([[{ state: "RUNNING" }], undefined])
      .mockRejectedValueOnce(new Error("DB_DOWN"));

    await expect(reportMatchScorePublic(5, 70, 12, mapsFor(3, 1))).resolves.toBeUndefined();
    expect(invalidateTournamentLists).not.toHaveBeenCalled();
  });

  it("défait tout et ne publie rien quand le report est refusé", async () => {
    jest.mocked(reportMatchScore).mockRejectedValue(new Error("NOT_TEAM_MATCH_LEADER"));

    await expect(reportMatchScorePublic(5, 70, 12, mapsFor(3, 1))).rejects.toThrow("NOT_TEAM_MATCH_LEADER");

    expect(finalizeTournamentIfDone).not.toHaveBeenCalled();
    expect(notifyScoreToConfirm).not.toHaveBeenCalled();
    expectRolledBack();
  });

  it("passe le forfait d'un engagé par la même chaîne", async () => {
    jest.mocked(forfeitOwnMatch).mockResolvedValue({ forfeitTeamId: 3 });

    await forfeitOwnMatchPublic(5, 70, 12);

    expect(forfeitOwnMatch).toHaveBeenCalledWith(expect.anything(), 5, 70, 12);
    expect(order(jest.mocked(finalizeTournamentIfDone))).toBeGreaterThan(order(jest.mocked(forfeitOwnMatch)));
    expectCommitted();
    expect(publishScoreReportedEvent).toHaveBeenCalledWith(5, 70);
  });
});

describe("adminSaveMatchScoresPublic", () => {
  it("réconcilie le tournoi du match et rafraîchit sans condition", async () => {
    connection.execute.mockResolvedValue([[{ tournament_id: "8" }], undefined]);

    await adminSaveMatchScoresPublic(70, 2, 1, undefined);

    expect(adminSaveMatchScores).toHaveBeenCalledWith(expect.anything(), 70, 2, 1, undefined, undefined);
    for (const fn of [reconcileSurvival, reconcileSwiss, reconcileEndurance, reconcilePhases]) {
      expect(fn).toHaveBeenCalledWith(8, expect.anything());
    }
    expectCommitted();
    expect(publishScoreResolvedEvent).toHaveBeenCalledWith(8, 70);
    expect(invalidateTournamentLists).toHaveBeenCalledTimes(1);
  });

  it("ne réconcilie ni ne publie rien quand le match a disparu", async () => {
    await adminSaveMatchScoresPublic(70, 2, 1);

    expect(reconcileSurvival).not.toHaveBeenCalled();
    expect(publishScoreResolvedEvent).not.toHaveBeenCalled();
    expect(invalidateTournamentLists).not.toHaveBeenCalled();
    expectCommitted();
  });

  it("défait la sauvegarde refusée", async () => {
    jest.mocked(adminSaveMatchScores).mockRejectedValue(new Error("DOWNSTREAM_SCORES"));

    await expect(adminSaveMatchScoresPublic(70, 2, 1)).rejects.toThrow("DOWNSTREAM_SCORES");
    expectRolledBack();
  });
});

describe("adminResolveMatchPublic", () => {
  it("tranche le match, enchaîne la chaîne entière puis publie", async () => {
    connection.execute.mockResolvedValue([[{ tournament_id: 8 }], undefined]);

    await adminResolveMatchPublic(70, undefined, undefined, 3, false);

    expect(adminResolveMatch).toHaveBeenCalledWith(expect.anything(), 70, undefined, undefined, 3, false, undefined);
    expect(tryAutoResolveByes).toHaveBeenCalledWith(expect.anything(), 8);
    expect(finalizeTournamentIfDone).toHaveBeenCalledWith(expect.anything(), 8);
    expect(order(jest.mocked(finalizeTournamentIfDone))).toBeGreaterThan(order(jest.mocked(reconcilePhases)));
    expectCommitted();
    expect(publishScoreReportedEvent).toHaveBeenCalledWith(8, 70);
    expect(invalidateTournamentLists).toHaveBeenCalledTimes(1);
  });

  it("transmet le double forfait au moteur", async () => {
    connection.execute.mockResolvedValue([[{ tournament_id: 8 }], undefined]);

    await adminResolveMatchPublic(70, undefined, undefined, undefined, true);

    expect(adminResolveMatch).toHaveBeenCalledWith(expect.anything(), 70, undefined, undefined, undefined, true, undefined);
  });

  it("rejoue un arbitrage annulé par un interblocage (MAP_SCORES.md)", async () => {
    connection.execute.mockResolvedValue([[{ tournament_id: 8 }], undefined]);
    const deadlock = Object.assign(new Error("Deadlock found when trying to get lock"), { code: "ER_LOCK_DEADLOCK" });
    jest.mocked(adminResolveMatch).mockRejectedValueOnce(deadlock).mockResolvedValueOnce(undefined);

    await adminResolveMatchPublic(70, 2, 1);

    expect(adminResolveMatch).toHaveBeenCalledTimes(2);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  it("lève MATCH_NOT_FOUND sans rien trancher", async () => {
    await expect(adminResolveMatchPublic(70, 1, 0)).rejects.toThrow("MATCH_NOT_FOUND");

    expect(adminResolveMatch).not.toHaveBeenCalled();
    expectRolledBack();
  });
});

describe("forfeitTournamentTeamPublic — aiguillage par format", () => {
  /** Réponses successives : format du tournoi, puis phase courante éventuelle. */
  function formats(format: string, phase?: { id: number; format: string } | null): void {
    connection.execute.mockResolvedValueOnce([[{ format }], undefined]);
    if (phase !== undefined) connection.execute.mockResolvedValueOnce([phase ? [phase] : [], undefined]);
  }

  it("confie l'abandon au moteur de Survie, hors phase", async () => {
    formats("SURVIVAL");

    await forfeitTournamentTeamPublic(5, 3);

    expect(forfeitSurvivalTeam).toHaveBeenCalledWith(5, 3, expect.anything(), 0);
    expect(reconcilePhases).not.toHaveBeenCalled();
    expect(queueBotLog).toHaveBeenCalledWith(expect.anything(), { kind: "forfeit", tournamentId: 5, teamId: 3 });
    expectCommitted();
    expect(publishUpdatedEvent).toHaveBeenCalledWith(5);
  });

  it("confie l'abandon au moteur suisse", async () => {
    formats("SWISS");

    await forfeitTournamentTeamPublic(5, 3);

    expect(forfeitSwissTeam).toHaveBeenCalledWith(5, 3, expect.anything(), 0);
  });

  it("suit le format de la phase courante d'un tournoi multi-phases, puis réconcilie", async () => {
    formats("MULTI", { id: 22, format: "SWISS" });

    await forfeitTournamentTeamPublic(5, 3);

    expect(forfeitSwissTeam).toHaveBeenCalledWith(5, 3, expect.anything(), 22);
    expect(order(jest.mocked(reconcilePhases))).toBeGreaterThan(order(jest.mocked(forfeitSwissTeam)));
    expectCommitted();
  });

  it("passe en Survie la phase courante qui l'est", async () => {
    formats("MULTI", { id: 23, format: "SURVIVAL" });

    await forfeitTournamentTeamPublic(5, 3);

    expect(forfeitSurvivalTeam).toHaveBeenCalledWith(5, 3, expect.anything(), 23);
  });

  it("refuse l'abandon pendant une phase à élimination", async () => {
    formats("MULTI", { id: 24, format: "SINGLE" });

    await expect(forfeitTournamentTeamPublic(5, 3)).rejects.toThrow("FORMAT_WITHOUT_FORFEIT");
    expectRolledBack();
    expect(queueBotLog).not.toHaveBeenCalled();
  });

  it("refuse l'abandon d'un tournoi multi-phases sans phase courante", async () => {
    formats("MULTI", null);

    await expect(forfeitTournamentTeamPublic(5, 3)).rejects.toThrow("FORMAT_WITHOUT_FORFEIT");
  });

  it("refuse l'abandon en élimination directe", async () => {
    formats("DOUBLE");

    await expect(forfeitTournamentTeamPublic(5, 3)).rejects.toThrow("FORMAT_WITHOUT_FORFEIT");
    expect(forfeitSurvivalTeam).not.toHaveBeenCalled();
    expect(forfeitSwissTeam).not.toHaveBeenCalled();
    expect(forfeitEnduranceTeam).not.toHaveBeenCalled();
  });

  it("refuse l'abandon d'un tournoi introuvable", async () => {
    await expect(forfeitTournamentTeamPublic(5, 3)).rejects.toThrow("FORMAT_WITHOUT_FORFEIT");
    expectRolledBack();
  });
});

describe("pénalités d'endurance", () => {
  it("journalise le motif tel que le moteur l'a stocké", async () => {
    jest.mocked(applyEndurancePenalty).mockResolvedValue({ reason: "Retard" });

    await applyEndurancePenaltyPublic(5, 3, 2, "  Retard  ", 99);

    expect(applyEndurancePenalty).toHaveBeenCalledWith(5, 3, 2, "  Retard  ", 99, expect.anything());
    expect(queueBotLog).toHaveBeenCalledWith(expect.anything(), {
      kind: "endurance_penalty",
      tournamentId: 5,
      teamId: 3,
      points: 2,
      reason: "Retard",
    });
    expectCommitted();
    expect(publishUpdatedEvent).toHaveBeenCalledWith(5);
  });

  it("défait une pénalité refusée par le moteur", async () => {
    jest.mocked(applyEndurancePenalty).mockRejectedValue(new Error("ENDURANCE_PLAYOFFS_STARTED"));

    await expect(applyEndurancePenaltyPublic(5, 3, 2, "Retard", 99)).rejects.toThrow("ENDURANCE_PLAYOFFS_STARTED");
    expect(queueBotLog).not.toHaveBeenCalled();
    expectRolledBack();
  });

  it("journalise le retrait avec l'engagé et le montant relus avant l'effacement", async () => {
    jest.mocked(liftEndurancePenalty).mockResolvedValue({ teamId: 3, points: 2 });

    await liftEndurancePenaltyPublic(5, 61);

    expect(liftEndurancePenalty).toHaveBeenCalledWith(5, 61, expect.anything());
    expect(queueBotLog).toHaveBeenCalledWith(expect.anything(), {
      kind: "endurance_penalty_lifted",
      tournamentId: 5,
      teamId: 3,
      points: 2,
    });
    expectCommitted();
  });

  it("défait un retrait refusé", async () => {
    jest.mocked(liftEndurancePenalty).mockRejectedValue(new Error("PENALTY_NOT_FOUND"));

    await expect(liftEndurancePenaltyPublic(5, 61)).rejects.toThrow("PENALTY_NOT_FOUND");
    expectRolledBack();
  });
});
