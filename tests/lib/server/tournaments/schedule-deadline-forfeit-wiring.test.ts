import { describe, expect, it } from "@jest/globals";
import { readSource } from "../../../helpers/read-source";

/**
 * Double forfait d'une date butoir passée (`SCHEDULE_DEADLINE.md` § Échéance) :
 * aucune règle neuve par format. Le forfait passe par la chaîne d'un forfait
 * d'arbitrage (`adminResolveMatch`, `doubleForfeit`), dont chaque moteur est
 * testé (`admin-double-forfeit.test.ts`, `DOUBLE_FORFEIT.md`) ; ce qui se
 * vérifie ici, c'est que le chemin y mène bien, réconciliations comprises.
 */

const index = readSource("lib/server/tournaments/index.ts");
const service = readSource("lib/server/tournaments/schedule-deadline.ts");

function body(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf("\nexport ", start + signature.length);
  return source.slice(start, next === -1 ? undefined : next);
}

describe("forfeitMissedScheduleDeadlinePublic", () => {
  it("forfeitMissedScheduleDeadlinePublic_wrapper_runsResolvedPlayerMatchWriteUnderDeadlockRetry", () => {
    const wrapper = body(index, "export async function forfeitMissedScheduleDeadlinePublic(");

    expect(wrapper).toContain("retryOnDeadlock(");
    expect(wrapper).toContain("runPlayerMatchWrite(");
    expect(wrapper).toContain("forfeitMissedScheduleDeadline(connection, tournamentId, matchId, deadlineAt, now)");
    expect(wrapper).toContain('"resolved"');
  });

  it("runPlayerMatchWrite_afterWrite_reconcilesEveryRankedFormatAndFinalizes", () => {
    const write = body(index, "async function runPlayerMatchWrite(");

    expect(write).toContain("reconcileSurvival(tournamentId, connection)");
    expect(write).toContain("reconcileSwiss(tournamentId, connection)");
    // BG_SURVIE : la qualification rejouée depuis l'historique des matchs.
    expect(write).toContain("reconcileEndurance(tournamentId, connection)");
    expect(write).toContain("reconcileMultiPhases(tournamentId, connection)");
    expect(write).toContain("finalizeTournamentIfDone(connection, tournamentId)");
  });

  it("forfeitMissedScheduleDeadline_decision_usesAdminDoubleForfeit", () => {
    expect(body(service, "export async function forfeitMissedScheduleDeadline(")).toContain(
      "adminResolveMatch(connection, matchId, { doubleForfeit: true })",
    );
  });
});
