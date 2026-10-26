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

/**
 * Base : `query` sert la sonde (`LIMIT 1` : une manche à ≤ sa borne haute ?),
 * la lecture du programme et la relecture avant envoi (`current`, les lignes
 * telles qu'elles sont alors en base — par défaut inchangées), `execute` les
 * réservations (refusées pour `refused`).
 */
function mockDb(
  rows: ReturnType<typeof row>[],
  refused: number[] = [],
  current: ReturnType<typeof row>[] | Error = rows,
) {
  const query = jest.fn<SqlQuery>(async (sql, params) => {
    if (/AS tournament_state/.test(sql)) {
      if (current instanceof Error) throw current;
      // Par défaut, la marque tient l'horaire lu (celui de `rows`).
      return [
        current.map((match) => ({
          status: "READY",
          tournament_state: "RUNNING",
          mark_at: rows.find((read) => read.id === match.id)?.start_at ?? null,
          ...match,
        })),
      ];
    }
    if (!/LIMIT 1/.test(sql)) return [rows];
    const until = ((params as unknown[])[1] as Date).getTime();
    return [rows.filter((candidate) => candidate.start_at.getTime() <= until).slice(0, 1).map(() => ({ due: 1 }))];
  });
  const execute = jest.fn<SqlQuery>(async (sql, params) => {
    if (sql.startsWith("DELETE")) return [{ affectedRows: 1 }];
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
  jest.mocked(notifyStaff).mockResolvedValue({ discord: null, pushed: 1, discordUnreachedUserIds: [] });
  jest.mocked(sendBotLog).mockResolvedValue(undefined);
});

describe("dispatchRefereeDigest", () => {
  it("sonde d'abord, en une ligne, une manche non citée dans ses 10 dernières heures", async () => {
    const { query } = mockDb([]);

    expect(await dispatchRefereeDigest(NOW)).toBe(0);

    // Rien de dû : la marge de regroupement n'est ni lue ni jointe.
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/SELECT 1 AS due FROM bg_matches m/);
    expect(sql).toMatch(/LIMIT 1$/);
    expect(params).toEqual([NOW, new Date(NOW.getTime() + 10 * HOUR), "REFS"]);
    expect(notifyStaff).not.toHaveBeenCalled();
  });

  it("lit les manches non citées des 12 prochaines heures, jouables, deux engagées connues", async () => {
    const { query } = mockDb([row(1, 9)]);

    await dispatchRefereeDigest(NOW);

    // Sonde, lecture, relecture avant envoi.
    expect(query).toHaveBeenCalledTimes(3);
    const [sql, params] = query.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual([NOW, new Date(NOW.getTime() + 12 * HOUR), "REFS"]);
    expect(sql).toMatch(/m\.status NOT IN \('COMPLETED', 'AWAITING_CONFIRMATION'\)/);
    expect(sql).toMatch(/t\.state <> 'FINISHED'/);
    expect(sql).toMatch(/JOIN bg_teams t1/);
    expect(sql).toMatch(/JOIN bg_teams t2/);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM bg_match_reminders r WHERE r\.match_id = m\.id AND r\.offset_key = \?\)/);
    expect(sql).toMatch(/ORDER BY m\.start_at, m\.id/);
  });

  it("attend qu'une manche entre dans ses 10 dernières heures", async () => {
    const { query, execute } = mockDb([row(1, 11), row(2, 11.5)]);

    expect(await dispatchRefereeDigest(NOW)).toBe(0);
    expect(query).toHaveBeenCalledTimes(1);
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
    expect(push.tag).toMatch(/^referee-digest-1-3-[0-9a-z]+$/);
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

    expect(query.mock.calls[1][0]).toMatch(/AS swiss_round/);
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

  it("réserve plusieurs manches de front, et cite dans l'ordre du coup d'envoi", async () => {
    const rows = Array.from({ length: 8 }, (_, index) => row(index + 1, 9 + index * 0.1));
    let inFlight = 0;
    let peak = 0;
    const execute = jest.fn<SqlQuery>(async (_sql, params) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      // La première réservation est la plus lente : les autres n'attendent pas.
      const matchId = (params as unknown[])[0] as number;
      await new Promise((resolve) => setTimeout(resolve, matchId === 1 ? 20 : 1));
      inFlight -= 1;
      return [{ affectedRows: 1 }];
    });
    const { query } = mockDb(rows);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query, execute }));

    expect(await dispatchRefereeDigest(NOW)).toBe(8);

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
    const body = resolvePush(jest.mocked(notifyStaff).mock.calls[0][0].push).body;
    expect(body.indexOf("Renards 1 ")).toBeLessThan(body.indexOf("Renards 2 "));
  });

  it("une réservation en échec ne retient pas les autres manches", async () => {
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { query } = mockDb([row(1, 9), row(2, 9.5)]);
    const execute = jest.fn<SqlQuery>(async (_sql, params) => {
      if ((params as unknown[])[0] === 1) throw new Error("Lock wait timeout");
      return [{ affectedRows: 1 }];
    });
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query, execute }));

    expect(await dispatchRefereeDigest(NOW)).toBe(1);

    const push = resolvePush(jest.mocked(notifyStaff).mock.calls[0][0].push);
    expect(push.body).not.toContain("Renards 1 ");
    expect(push.body).toContain("Renards 2 ");
    expect(errors).toHaveBeenCalledWith("[referee-digest] réservation en échec", expect.any(Error));
    errors.mockRestore();
  });

  it("ne part pas avec la marge seule quand la manche due n'a pas été prise, et rend ses marques", async () => {
    // M1 (due) déplacée entre la lecture et la réservation ; M2 et M3 ne sont que dans la marge.
    const { execute } = mockDb([row(1, 9), row(2, 11.5), row(3, 11.8)], [1]);

    expect(await dispatchRefereeDigest(NOW)).toBe(0);

    expect(notifyStaff).not.toHaveBeenCalled();
    // Une seule instruction rend toutes les marques prises, chacune pour l'horaire lu.
    const releases = execute.mock.calls.filter(([sql]) => /DELETE FROM bg_match_reminders/.test(sql));
    expect(releases).toHaveLength(1);
    const [sql, params] = releases[0] as [string, unknown[]];
    // La liste de manches en tête : la clé unique (match_id, offset_key) sert l'effacement.
    expect(sql).toMatch(/WHERE match_id IN \(\?, \?\) AND offset_key = \?\s+AND \(match_id, start_at\) IN \(\(\?, \?\), \(\?, \?\)\)/);
    expect(params).toEqual([2, 3, "REFS", 2, row(2, 11.5).start_at, 3, row(3, 11.8).start_at]);
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

  it("ne nomme aucun joueur d'une entrée solo, même si le type du tournoi est illisible", async () => {
    mockDb([row(1, 9, { participant_type: null, team1_name: "Kiro", team2_name: "Ayla", team1_solo_user_id: 11, team2_solo_user_id: 12 })]);

    await dispatchRefereeDigest(NOW);

    const push = resolvePush(jest.mocked(notifyStaff).mock.calls[0][0].push);
    expect(push.body).not.toMatch(/Kiro|Ayla/);
    const line = await publishedLine();
    expect(line).not.toMatch(/Kiro|Ayla/);
    expect(line).toContain("un joueur vs un joueur");
  });

  it("protège les noms d'équipe du balisage Discord", async () => {
    mockDb([row(1, 9, { team1_name: "**Gras**" })]);

    await dispatchRefereeDigest(NOW);

    expect(await publishedLine()).not.toContain("**Gras**");
  });

  it("relit les manches réservées en une instruction juste avant l'envoi", async () => {
    const { query } = mockDb([row(1, 9), row(2, 11)]);

    expect(await dispatchRefereeDigest(NOW)).toBe(2);

    const [sql, params] = query.mock.calls[2] as [string, unknown[]];
    expect(sql).toMatch(/FROM bg_matches m JOIN bg_tournaments t ON t\.id = m\.tournament_id\s+WHERE m\.id IN \(\?, \?\)$/);
    expect(sql).toMatch(/m\.status, t\.state AS tournament_state/);
    expect(sql).toMatch(/WHERE r\.match_id = m\.id AND r\.offset_key = \? LIMIT 1\) AS mark_at/);
    expect(params).toEqual(["REFS", 1, 2]);
  });

  it("ne cite pas une manche reprogrammée après sa réservation", async () => {
    // L'arbitre déplace la manche 2 de 9 h 30 à 10 h 30 juste après la
    // réservation : son nouvel horaire lui est poussé, le programme ne doit
    // pas lui renvoyer l'ancien.
    mockDb([row(1, 9), row(2, 9.5)], [], [row(1, 9), row(2, 10.5)]);

    expect(await dispatchRefereeDigest(NOW)).toBe(1);

    const line = await publishedLine();
    expect(line).toContain("Renards 1");
    expect(line).not.toContain("Renards 2");
  });

  it("ne cite pas une manche changée, retirée, jouée ou d'un tournoi clos après sa réservation, et rend sa marque", async () => {
    const { execute } = mockDb(
      [row(1, 9), row(2, 9.5), row(3, 9.8), row(4, 9.9), row(5, 9.95)],
      [],
      [
        row(1, 9),
        // Affiche changée, horaire retiré : leur marque est déjà effacée.
        row(2, 9.5, { team2_id: 999, mark_at: null }),
        row(3, 9.8, { start_at: null, mark_at: null }),
        // Jouée, tournoi clos : la marque reste, elle est rendue.
        row(4, 9.9, { status: "AWAITING_CONFIRMATION" }),
        row(5, 9.95, { tournament_state: "FINISHED" }),
      ] as ReturnType<typeof row>[],
    );

    expect(await dispatchRefereeDigest(NOW)).toBe(1);

    const release = execute.mock.calls.find(([sql]) => sql.startsWith("DELETE")) as [string, unknown[]];
    expect(release[1]).toEqual([4, 5, "REFS", 4, row(4, 9.9).start_at, 5, row(5, 9.95).start_at]);
  });

  it("rend les marques de la marge quand la manche due a été déplacée après sa réservation", async () => {
    // Reprogrammée : sa marque est effacée par la reprogrammation.
    const { execute } = mockDb([row(1, 9), row(2, 11)], [], [row(1, 13, { mark_at: null }), row(2, 11)]);

    expect(await dispatchRefereeDigest(NOW)).toBe(0);

    expect(notifyStaff).not.toHaveBeenCalled();
    // Seule la marge laissée seule est rendue : la marque de la manche
    // déplacée n'est plus là.
    const releases = execute.mock.calls.filter(([sql]) => sql.startsWith("DELETE")) as [string, unknown[]][];
    expect(releases.map(([, params]) => params)).toEqual([[2, "REFS", 2, row(2, 11).start_at]]);
  });

  it("ne cite pas une manche dont la marque a été effacée pendant le programme, même revenue à son horaire", async () => {
    // Horaire retiré puis reposé à l'identique pendant les réservations : la
    // marque n'est plus là, le programme suivant citera la manche — une fois.
    const { execute } = mockDb([row(1, 9), row(2, 9.5)], [], [row(1, 9), row(2, 9.5, { mark_at: null })]);

    expect(await dispatchRefereeDigest(NOW)).toBe(1);

    expect(await publishedLine()).not.toContain("Renards 2");
    // Rien à rendre : la marque n'est plus là.
    expect(execute.mock.calls.some(([sql]) => sql.startsWith("DELETE"))).toBe(false);
  });

  it("rend la marque d'une manche déplacée dans le passé : reposée à son horaire, elle sera citée", async () => {
    // Une date passée n'efface aucune marque : REFS tient encore l'horaire lu.
    const past = new Date(NOW.getTime() - 2 * HOUR);
    const { execute } = mockDb([row(1, 9), row(2, 9.5)], [], [row(1, 9), row(2, 9.5, { start_at: past })]);

    expect(await dispatchRefereeDigest(NOW)).toBe(1);

    const release = execute.mock.calls.find(([sql]) => sql.startsWith("DELETE")) as [string, unknown[]];
    expect(release[1]).toEqual([2, "REFS", 2, row(2, 9.5).start_at]);
  });

  it("envoie quand même si la relecture échoue : les marques sont prises", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockDb([row(1, 9)], [], new Error("connexion perdue"));

    expect(await dispatchRefereeDigest(NOW)).toBe(1);
    expect(notifyStaff).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("[referee-digest] relecture avant envoi en échec", expect.any(Error));
    error.mockRestore();
  });

  it("est réservé au staff qui détient la permission des tournois", () => {
    expect(PUSH_TOPICS.REFEREE_DIGEST.audience).toBe("tournaments");
  });
});
