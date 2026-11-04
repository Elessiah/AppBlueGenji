import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/registration");
jest.mock("@/lib/server/tournaments/seeding");
jest.mock("@/lib/server/tournaments-service", () => ({
  forfeitDeletedEntryMatch: jest.fn(),
  forfeitTournamentTeam: jest.fn(),
}));

import { getDatabase } from "@/lib/server/database";
import { sendBotLog } from "@/lib/server/bot-integration";
import { forfeitDeletedEntryMatch, forfeitTournamentTeam } from "@/lib/server/tournaments-service";
import {
  forfeitSoloEntriesAfterCommit,
  forfeitUnplayedSoloEntry,
  settleDeletedSoloEntries,
  soloEntryNeverPlayedSql,
} from "@/lib/server/users/deleted-solo-entries";
import { fakePool } from "../../helpers/sql-double";

/*
 * E1 / E2 — l'entrée solo d'un compte supprimé, jamais jouée dans un tournoi en
 * cours, perd ses matchs restants par forfait ; le rattrapage rejoue la règle
 * sur les comptes déjà supprimés, sans rien refaire au second passage. E5 : le
 * journal dit « un joueur », jamais son pseudo.
 */

type Options = {
  format?: string;
  phaseFormat?: string | null;
  openMatches?: number[];
  candidates?: number[];
  forfeitable?: { tournament_id: number; team_id: number }[];
  /** Relectures successives de `is_deleted` du compte de l'entrée ; au-delà, 1. */
  deletedReads?: number[];
};

function fakeDb(options: Options) {
  const open = [...(options.openMatches ?? [])];
  const deletedReads = [...(options.deletedReads ?? [])];
  const execute = jest.fn(async (sql: string) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT u.is_deleted FROM bg_teams s")) return [[{ is_deleted: deletedReads.shift() ?? 1 }]];
    if (q.startsWith("SELECT t.format, p.format AS phase_format")) {
      return [[{ format: options.format ?? "SINGLE", phase_format: options.phaseFormat ?? null }]];
    }
    if (q.startsWith("SELECT t.name, t.max_teams, t.participant_type")) {
      return [[{ name: "Coupe solo", max_teams: 16, participant_type: "SOLO", registered: 9 }]];
    }
    if (q.startsWith("SELECT DISTINCT u.id")) return [(options.candidates ?? []).map((id) => ({ id }))];
    if (q.startsWith("SELECT DISTINCT r.tournament_id, s.id AS team_id")) return [options.forfeitable ?? []];
    return [[]];
  });
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute, getConnection: jest.fn() }));
  // Le prochain match ouvert, forfaité sous verrou (`deleted-entry-forfeit.ts`), puis plus rien.
  jest.mocked(forfeitDeletedEntryMatch).mockImplementation(async () => open.shift() ?? null);
  return execute;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(sendBotLog).mockReturnValue(undefined);
});

describe("forfeitUnplayedSoloEntry", () => {
  it("forfeitUnplayedSoloEntry_rankingFormat_callsForfeitTournamentTeam", async () => {
    fakeDb({ format: "SWISS" });

    expect(await forfeitUnplayedSoloEntry(4, 40)).toBe(1);
    expect(forfeitTournamentTeam).toHaveBeenCalledWith(4, 40, null, undefined, { skipForfeitLog: true });
    expect(forfeitDeletedEntryMatch).not.toHaveBeenCalled();
  });

  it("forfeitUnplayedSoloEntry_multiPhaseRanking_usesPhaseFormat", async () => {
    fakeDb({ format: "MULTI", phaseFormat: "BG_SURVIE" });

    await forfeitUnplayedSoloEntry(4, 40);

    expect(forfeitTournamentTeam).toHaveBeenCalledWith(4, 40, null, undefined, { skipForfeitLog: true });
  });

  it("forfeitUnplayedSoloEntry_bracket_savesForfeitPerReadyMatch", async () => {
    fakeDb({ format: "DOUBLE", openMatches: [101, 102] });

    expect(await forfeitUnplayedSoloEntry(4, 40)).toBe(2);
    expect(forfeitDeletedEntryMatch).toHaveBeenCalledTimes(3);
    expect(forfeitDeletedEntryMatch).toHaveBeenCalledWith(4, 40);
    expect(forfeitTournamentTeam).not.toHaveBeenCalled();
  });

  it("forfeitUnplayedSoloEntry_bracketNothingOpen_zero", async () => {
    fakeDb({ format: "SINGLE", openMatches: [] });

    expect(await forfeitUnplayedSoloEntry(4, 40)).toBe(0);
  });
});

describe("soloEntryNeverPlayedSql", () => {
  it("soloEntryNeverPlayedSql_default_filtersOnRegistrationTournament", () => {
    // Une seule entrée solo par compte : un match joué dans un autre tournoi ne compte pas.
    expect(soloEntryNeverPlayedSql()).toContain("pm.tournament_id = r.tournament_id");
  });

  it("soloEntryNeverPlayedSql_customAliases_usesThem", () => {
    const sql = soloEntryNeverPlayedSql("x.id", "y.tid");

    expect(sql).toContain("pm.tournament_id = y.tid");
    expect(sql).toContain("pm.team1_id = x.id");
  });
});

describe("forfeitUnplayedSoloEntry — compte réactivé", () => {
  it("forfeitUnplayedSoloEntry_accountReactivated_noForfeit", async () => {
    fakeDb({ format: "SWISS", deletedReads: [0] });

    expect(await forfeitUnplayedSoloEntry(4, 40)).toBe(0);
    expect(forfeitTournamentTeam).not.toHaveBeenCalled();
  });

  it("forfeitUnplayedSoloEntry_alreadyOut_zeroWithoutError", async () => {
    fakeDb({ format: "SURVIVAL" });
    jest.mocked(forfeitTournamentTeam).mockRejectedValueOnce(new Error("TEAM_ALREADY_OUT"));

    expect(await forfeitUnplayedSoloEntry(4, 40)).toBe(0);
  });

  it("forfeitUnplayedSoloEntry_otherEngineError_rethrown", async () => {
    fakeDb({ format: "SWISS" });
    jest.mocked(forfeitTournamentTeam).mockRejectedValueOnce(new Error("FORMAT_WITHOUT_FORFEIT"));

    await expect(forfeitUnplayedSoloEntry(4, 40)).rejects.toThrow("FORMAT_WITHOUT_FORFEIT");
  });
});

describe("forfeitUnplayedSoloEntry — match non tranché", () => {
  it("forfeitUnplayedSoloEntry_sameMatchStillOpen_stopsAfterOne", async () => {
    fakeDb({ format: "SINGLE", openMatches: [101, 101, 101] });

    expect(await forfeitUnplayedSoloEntry(4, 40)).toBe(1);
    expect(forfeitDeletedEntryMatch).toHaveBeenCalledTimes(2);
  });
});

describe("forfeitSoloEntriesAfterCommit", () => {
  it("forfeitSoloEntriesAfterCommit_forfeitDone_logsUnJoueurWithoutPseudo", async () => {
    fakeDb({ format: "SURVIVAL" });

    await forfeitSoloEntriesAfterCommit([{ tournamentId: 4, teamId: 40 }]);

    const [message, options] = jest.mocked(sendBotLog).mock.calls[0];
    expect(message).toContain("Forfait (compte supprimé)");
    expect(message).toContain("un joueur");
    expect(options).toEqual({ tournamentId: 4, category: "registrations" });
  });

  it("forfeitSoloEntriesAfterCommit_engineFails_swallowedAndNotLogged", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    fakeDb({ format: "SWISS" });
    jest.mocked(forfeitTournamentTeam).mockRejectedValueOnce(new Error("ENGINE_DOWN"));

    await expect(forfeitSoloEntriesAfterCommit([{ tournamentId: 4, teamId: 40 }])).resolves.toBeUndefined();
    expect(sendBotLog).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("settleDeletedSoloEntries", () => {
  it("settleDeletedSoloEntries_noCandidates_zero", async () => {
    fakeDb({ candidates: [] });

    expect(await settleDeletedSoloEntries()).toEqual({ withdrawn: 0, forfeited: 0 });
    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("settleDeletedSoloEntries_deletedAccountUnplayedInRunning_forfeitsAndLogs", async () => {
    fakeDb({ candidates: [7], forfeitable: [{ tournament_id: 4, team_id: 40 }], format: "SWISS" });

    expect(await settleDeletedSoloEntries()).toEqual({ withdrawn: 0, forfeited: 1 });
    expect(forfeitTournamentTeam).toHaveBeenCalledWith(4, 40, null, undefined, { skipForfeitLog: true });
    expect(sendBotLog).toHaveBeenCalledTimes(1);
  });

  it("settleDeletedSoloEntries_firstTournamentFails_secondStillForfeited", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    fakeDb({
      candidates: [7],
      forfeitable: [
        { tournament_id: 4, team_id: 40 },
        { tournament_id: 5, team_id: 40 },
      ],
      format: "SWISS",
    });
    jest.mocked(forfeitTournamentTeam).mockRejectedValueOnce(new Error("TEAM_ALREADY_OUT"));

    expect(await settleDeletedSoloEntries()).toEqual({ withdrawn: 0, forfeited: 1 });
    expect(forfeitTournamentTeam).toHaveBeenLastCalledWith(5, 40, null, undefined, { skipForfeitLog: true });
    log.mockRestore();
  });

  it("settleDeletedSoloEntries_alreadyForfeited_secondPassNoop", async () => {
    // Une fois forfait, l'entrée n'a plus de match ouvert : le relevé ne la rend plus.
    fakeDb({ candidates: [7], forfeitable: [] });

    expect(await settleDeletedSoloEntries()).toEqual({ withdrawn: 0, forfeited: 0 });
    expect(forfeitTournamentTeam).not.toHaveBeenCalled();
  });
});
