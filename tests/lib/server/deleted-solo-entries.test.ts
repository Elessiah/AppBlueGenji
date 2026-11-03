import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/registration");
jest.mock("@/lib/server/tournaments/seeding");
jest.mock("@/lib/server/tournaments-service", () => ({
  adminSaveMatchScores: jest.fn(),
  forfeitTournamentTeam: jest.fn(),
}));

import { getDatabase } from "@/lib/server/database";
import { sendBotLog } from "@/lib/server/bot-integration";
import { adminSaveMatchScores, forfeitTournamentTeam } from "@/lib/server/tournaments-service";
import {
  forfeitSoloEntriesAfterCommit,
  forfeitUnplayedSoloEntry,
  settleDeletedSoloEntries,
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
};

function fakeDb(options: Options) {
  const open = [...(options.openMatches ?? [])];
  const execute = jest.fn(async (sql: string) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT t.format, p.format AS phase_format")) {
      return [[{ format: options.format ?? "SINGLE", phase_format: options.phaseFormat ?? null }]];
    }
    if (q.startsWith("SELECT id FROM bg_matches")) return [open.length > 0 ? [{ id: open.shift() }] : []];
    if (q.startsWith("SELECT t.name, t.max_teams, t.participant_type")) {
      return [[{ name: "Coupe solo", max_teams: 16, participant_type: "SOLO", registered: 9 }]];
    }
    if (q.startsWith("SELECT DISTINCT u.id")) return [(options.candidates ?? []).map((id) => ({ id }))];
    if (q.startsWith("SELECT DISTINCT r.tournament_id, s.id AS team_id")) return [options.forfeitable ?? []];
    return [[]];
  });
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute, getConnection: jest.fn() }));
  return execute;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(sendBotLog).mockResolvedValue(undefined);
});

describe("forfeitUnplayedSoloEntry", () => {
  it("forfeitUnplayedSoloEntry_rankingFormat_callsForfeitTournamentTeam", async () => {
    fakeDb({ format: "SWISS" });

    expect(await forfeitUnplayedSoloEntry(4, 40)).toBe(1);
    expect(forfeitTournamentTeam).toHaveBeenCalledWith(4, 40, null);
    expect(adminSaveMatchScores).not.toHaveBeenCalled();
  });

  it("forfeitUnplayedSoloEntry_multiPhaseRanking_usesPhaseFormat", async () => {
    fakeDb({ format: "MULTI", phaseFormat: "BG_SURVIE" });

    await forfeitUnplayedSoloEntry(4, 40);

    expect(forfeitTournamentTeam).toHaveBeenCalledWith(4, 40, null);
  });

  it("forfeitUnplayedSoloEntry_bracket_savesForfeitPerReadyMatch", async () => {
    fakeDb({ format: "DOUBLE", openMatches: [101, 102] });

    expect(await forfeitUnplayedSoloEntry(4, 40)).toBe(2);
    expect(jest.mocked(adminSaveMatchScores).mock.calls).toEqual([
      [101, { forfeitTeamId: 40 }],
      [102, { forfeitTeamId: 40 }],
    ]);
    expect(forfeitTournamentTeam).not.toHaveBeenCalled();
  });

  it("forfeitUnplayedSoloEntry_bracketNothingOpen_zero", async () => {
    fakeDb({ format: "SINGLE", openMatches: [] });

    expect(await forfeitUnplayedSoloEntry(4, 40)).toBe(0);
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
    expect(forfeitTournamentTeam).toHaveBeenCalledWith(4, 40, null);
    expect(sendBotLog).toHaveBeenCalledTimes(1);
  });

  it("settleDeletedSoloEntries_alreadyForfeited_secondPassNoop", async () => {
    // Une fois forfait, l'entrée n'a plus de match ouvert : le relevé ne la rend plus.
    fakeDb({ candidates: [7], forfeitable: [] });

    expect(await settleDeletedSoloEntries()).toEqual({ withdrawn: 0, forfeited: 0 });
    expect(forfeitTournamentTeam).not.toHaveBeenCalled();
  });
});
