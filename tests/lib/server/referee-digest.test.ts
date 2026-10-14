import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/notify");
jest.mock("@/lib/server/bot-integration");

import { getDatabase } from "@/lib/server/database";
import { notifyStaff } from "@/lib/server/notify";
import { sendBotLog } from "@/lib/server/bot-integration";
import { dispatchRefereeDigest } from "@/lib/server/tournaments/referee-digest";
import { PUSH_TOPICS } from "@/lib/shared/push-notifications";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";
import { resolvePush } from "../../helpers/push";

const NOW = new Date("2026-09-10T08:00:00Z");
const HOUR = 60 * 60 * 1000;

function row(id: number, hoursAhead: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    tournament_id: 7,
    tournament_name: "Coupe BlueGenji",
    participant_type: "TEAM",
    start_at: new Date(NOW.getTime() + hoursAhead * HOUR),
    bracket: "UPPER",
    round_number: 1,
    swiss_round: 0,
    team1_id: 100 + id,
    team2_id: 200 + id,
    team1_name: `Renards ${id}`,
    team2_name: `Nova ${id}`,
    ...overrides,
  };
}

/** Base : `query` sert la lecture du programme, `execute` les réservations (refusées pour `refused`). */
function mockDb(rows: unknown[], refused: number[] = []) {
  const query = jest.fn<SqlQuery>().mockResolvedValue([rows]);
  const execute = jest.fn<SqlQuery>(async (_sql, params) => {
    const matchId = (params as unknown[])[0] as number;
    return [{ affectedRows: refused.includes(matchId) ? 0 : 1 }];
  });
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ query, execute }));
  return { query, execute };
}

/** Exécute l'envoi Discord câblé par le programme, et rend la ligne publiée. */
async function publishedLine(): Promise<string> {
  const notification = jest.mocked(notifyStaff).mock.calls[0][0];
  await notification.discord?.();
  return jest.mocked(sendBotLog).mock.calls[0][0];
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(notifyStaff).mockResolvedValue({ discord: null, pushed: 1 });
  jest.mocked(sendBotLog).mockResolvedValue(undefined);
});

describe("dispatchRefereeDigest", () => {
  it("lit les manches non citées des 12 prochaines heures, jouables, deux engagées connues", async () => {
    const { query } = mockDb([]);

    expect(await dispatchRefereeDigest(NOW)).toBe(0);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([NOW, new Date(NOW.getTime() + 12 * HOUR), "REFS"]);
    expect(sql).toMatch(/m\.status NOT IN \('COMPLETED', 'AWAITING_CONFIRMATION'\)/);
    expect(sql).toMatch(/t\.state <> 'FINISHED'/);
    expect(sql).toMatch(/JOIN bg_teams t1/);
    expect(sql).toMatch(/JOIN bg_teams t2/);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM bg_match_reminders r WHERE r\.match_id = m\.id AND r\.offset_key = \?\)/);
    expect(sql).toMatch(/ORDER BY m\.start_at, m\.id/);
    expect(notifyStaff).not.toHaveBeenCalled();
  });

  it("attend qu'une manche entre dans ses 10 dernières heures", async () => {
    const { execute } = mockDb([row(1, 11), row(2, 11.5)]);

    expect(await dispatchRefereeDigest(NOW)).toBe(0);
    expect(execute).not.toHaveBeenCalled();
    expect(notifyStaff).not.toHaveBeenCalled();
  });

  it("envoie un seul message qui cite chaque manche réservée, marge de regroupement comprise", async () => {
    const { execute } = mockDb([row(1, 9), row(2, 9.5), row(3, 11)]);

    expect(await dispatchRefereeDigest(NOW)).toBe(3);

    // Chaque citation réservée pour l'horaire et l'affiche lus, avant l'envoi.
    expect(execute).toHaveBeenCalledTimes(3);
    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/INSERT IGNORE INTO bg_match_reminders/);
    expect(sql).toMatch(/WHERE id = \? AND start_at = \? AND team1_id = \? AND team2_id = \?/);
    expect(params).toEqual([1, "REFS", 1, row(1, 9).start_at, 101, 201]);

    expect(notifyStaff).toHaveBeenCalledTimes(1);
    const notification = jest.mocked(notifyStaff).mock.calls[0][0];
    expect(notification.topic).toBe("REFEREE_DIGEST");
    expect(notification.excludeUserIds).toBeUndefined();
    const push = resolvePush(notification.push);
    expect(push.title).toBe("Programme d'arbitrage : 3 matchs à venir");
    expect(push.body.split("\n")).toHaveLength(4);
    expect(push.body.split("\n").at(-1)).toBe("Heure de Paris");
    expect(push.body).toContain("Renards 1 contre Nova 1 (Coupe BlueGenji, Manche 1)");
    // Un seul tournoi cité : le lien mène à sa fiche.
    expect(push.url).toBe("/tournois/7");
    expect(push.tag).toBe("referee-digest-1-2-3");
    expect(resolvePush(notification.push, "en").title).toBe("Refereeing schedule: 3 upcoming matches");
    expect(resolvePush(notification.push, "en").body).toContain("Renards 1 vs Nova 1 (Coupe BlueGenji, Round 1)");
    expect(resolvePush(notification.push, "en").url).toBe("/en/tournois/7");

    const line = await publishedLine();
    expect(line).toContain("Programme d'arbitrage");
    expect(line).toContain("3 matchs");
    expect(line.match(/match #1\)/g)).toHaveLength(1);
    expect(line).toContain("Renards 3 vs Nova 3");
  });

  it("nomme la manche (ronde suisse comprise) et mène à la liste quand plusieurs tournois sont cités", async () => {
    const { query } = mockDb([
      row(1, 9, { swiss_round: 1, round_number: 3 }),
      row(2, 9.5, { tournament_id: 8, tournament_name: "Ligue", bracket: "LOWER", round_number: 2 }),
    ]);

    await dispatchRefereeDigest(NOW);

    expect(query.mock.calls[0][0]).toMatch(/AS swiss_round/);
    const notification = jest.mocked(notifyStaff).mock.calls[0][0];
    const push = resolvePush(notification.push);
    expect(push.body).toContain("(Coupe BlueGenji, Ronde 3)");
    expect(push.body).toContain("(Ligue, Tableau perdants · manche 2)");
    expect(push.url).toBe("/tournois");
    expect(resolvePush(notification.push, "en").url).toBe("/en/tournois");
  });

  it("ne cite pas une manche dont la réservation a été prise ailleurs (ou déplacée depuis)", async () => {
    mockDb([row(1, 9), row(2, 9.5)], [1]);

    expect(await dispatchRefereeDigest(NOW)).toBe(1);

    const push = resolvePush(jest.mocked(notifyStaff).mock.calls[0][0].push);
    expect(push.title).toBe("Programme d'arbitrage : 1 match à venir");
    expect(push.body).not.toContain("Renards 1");
    expect(push.body).toContain("Renards 2");
  });

  it("n'envoie rien quand toutes les réservations sont refusées", async () => {
    mockDb([row(1, 9)], [1]);

    expect(await dispatchRefereeDigest(NOW)).toBe(0);
    expect(notifyStaff).not.toHaveBeenCalled();
  });

  it("ne nomme aucun joueur d'un tournoi individuel, ni sur Discord ni en push", async () => {
    mockDb([row(1, 9, { participant_type: "SOLO", team1_name: "Kiro", team2_name: "Ayla" })]);

    await dispatchRefereeDigest(NOW);

    const notification = jest.mocked(notifyStaff).mock.calls[0][0];
    for (const locale of ["fr", "en"] as const) {
      const push = resolvePush(notification.push, locale);
      expect(push.body).not.toMatch(/Kiro|Ayla/);
    }
    expect(resolvePush(notification.push).body).toContain("Un match");
    const line = await publishedLine();
    expect(line).not.toMatch(/Kiro|Ayla/);
    expect(line).toContain("un joueur vs un joueur");
  });

  it("protège les noms d'équipe du balisage Discord", async () => {
    mockDb([row(1, 9, { team1_name: "**Gras**" })]);

    await dispatchRefereeDigest(NOW);

    expect(await publishedLine()).not.toContain("**Gras**");
  });

  it("est réservé au staff qui détient la permission des tournois", () => {
    expect(PUSH_TOPICS.REFEREE_DIGEST.audience).toBe("tournaments");
  });
});
