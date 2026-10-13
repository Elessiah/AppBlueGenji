import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/push-subscriptions");

import {
  announceMatchSchedule,
  announceEntrantsWithdrawn,
  announceMatchScheduleCleared,
  dispatchDueMatchReminders,
  resetMatchReminderThrottle,
  type MatchNotice,
} from "@/lib/server/tournaments/match-reminders";
import { pushDiscordDirectMessages } from "@/lib/server/bot-integration";
import { pushToUsers } from "@/lib/server/push-subscriptions";
import { fakePool } from "../../helpers/sql-double";
import { resolvePush } from "../../helpers/push";

const START = new Date("2026-09-10T18:00:00Z");
const ONE_HOUR_BEFORE = new Date("2026-09-10T17:00:00Z");
const FIVE_HOURS_BEFORE = new Date("2026-09-10T13:00:00Z");
const THREE_DAYS_BEFORE = new Date("2026-09-07T18:00:00Z");
const TEN_DAYS_BEFORE = new Date("2026-08-31T18:00:00Z");

const MATCH = {
  id: 31,
  tournament_id: 7,
  tournament_name: "Coupe BlueGenji",
  bracket: "UPPER",
  round_number: 2,
  start_at: START,
  team1_id: 101,
  team2_id: 102,
  team1_name: "Les Renards",
  team2_name: "Team Nova",
};

/** La manche telle que `schedule-notices` la lit une fois et la passe aux annonces. */
function notice(overrides: Partial<MatchNotice> = {}): MatchNotice {
  return { ...MATCH, participant_type: "TEAM", swiss_round: 0, status: "READY", ...overrides };
}

type Recipient = {
  team_id: number;
  id: number;
  pseudo: string;
  discord_id: string | null;
  discord_pseudo: string | null;
};

const RECIPIENTS: Recipient[] = [
  { team_id: 101, id: 1, pseudo: "Kiro", discord_id: "555000111", discord_pseudo: "kiro" },
  { team_id: 101, id: 2, pseudo: "Ayla", discord_id: null, discord_pseudo: "ayla_bg" },
  { team_id: 102, id: 3, pseudo: "Nova", discord_id: null, discord_pseudo: "nova" },
];

/** La manche a déjà été observée : le cycle normal des paliers s'applique. */
const SEEN = [{ match_id: 31, offset_key: "SEEN" }];

/**
 * Câble la base : `query` sert les trois lectures (matchs avec leurs marques,
 * joueurs des engagées, comptes), `execute` les réservations.
 */
async function mockDb(options: {
  matches?: unknown[];
  sent?: unknown[];
  recipients?: Recipient[];
  claimed?: boolean;
  toldClaimed?: boolean;
  told?: Date | null;
  current?: Date | null;
  poster?: [number | null, number | null];
}) {
  const recipients = options.recipients ?? RECIPIENTS;
  // Les marques posées arrivent avec chaque manche (colonnes de la requête du balayage).
  const sent = (options.sent ?? SEEN) as { match_id: number; offset_key: string }[];
  const has = (matchId: number, key: string) => (sent.some((r) => r.match_id === matchId && r.offset_key === key) ? 1 : 0);
  // Une manche dont le dernier palier (`P1D`) est pris n'est pas lue (`NOT EXISTS`).
  const matches = ((options.matches ?? [MATCH]) as { id: number }[])
    .filter((match) => has(match.id, "P1D") === 0)
    .map((match) => ({
    ...match,
    seen_mark: has(match.id, "SEEN"),
    told_mark: has(match.id, "TOLD"),
  }));
  const query = jest
    .fn<() => Promise<unknown>>()
    .mockResolvedValueOnce([matches])
    .mockResolvedValueOnce([recipients.map((r) => ({ team_id: r.team_id, user_id: r.id }))])
    .mockResolvedValueOnce([recipients.map((r) => ({ ...r, discord_verified_at: null }))]);
  const execute = executeDouble(options);

  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ query, execute }));
  return { query, execute };
}

/**
 * Double de `execute` : réservations (`affectedRows` selon `claimed`, et
 * `toldClaimed` pour la marque d'horaire reçu), et la relecture avant l'envoi
 * — horaire actuel de la manche (`current`, par défaut celui lu) et marque
 * d'horaire reçu (`told` : son horaire, `undefined` : absente).
 */
function executeDouble(options: {
  claimed?: boolean;
  toldClaimed?: boolean;
  told?: Date | null;
  current?: Date | null;
  /** Engagées actuelles de la manche (par défaut celles de l'envoi). */
  poster?: [number | null, number | null];
}) {
  return jest.fn(async (sql: string, params?: unknown[]) => {
    if (sql.startsWith("SELECT m.start_at AS match_start_at")) {
      const told = options.told === undefined ? { told_id: null, start_at: null } : { told_id: 1, start_at: options.told };
      const [team1, team2] = options.poster ?? [101, 102];
      return [
        [
          {
            match_start_at: options.current === undefined ? START : options.current,
            match_team1_id: team1,
            match_team2_id: team2,
            ...told,
          },
        ],
      ];
    }
    if (sql.startsWith("INSERT IGNORE") && params?.[1] === "TOLD" && options.toldClaimed === false) {
      return [{ affectedRows: 0 }];
    }
    return [{ affectedRows: options.claimed === false ? 0 : 1 }];
  });
}

/** Clés réservées, dans l'ordre, pour une manche donnée. */
function claimedKeys(execute: { mock: { calls: unknown[][] } }): string[] {
  return execute.mock.calls
    .map((call) => call as [string, unknown[]])
    .filter(([sql]) => sql.startsWith("INSERT IGNORE"))
    .map(([, params]) => params[1] as string);
}

function sentMessages(): string[] {
  return jest.mocked(pushDiscordDirectMessages).mock.calls.map(
    (call) => call[0],
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  resetMatchReminderThrottle();
  // Un appareil atteint par push : l'horaire est reçu (marque `TOLD`).
  jest.mocked(pushToUsers).mockResolvedValue(1);
  jest.mocked(pushDiscordDirectMessages).mockResolvedValue({
    sent: 0,
    unresolved: [],
    failed: [],
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("dispatchDueMatchReminders — cycle normal", () => {
  it("envoie un message par engagée, chacune vue de son côté", async () => {
    await mockDb({});

    expect(await dispatchDueMatchReminders(ONE_HOUR_BEFORE)).toBe(2);
    expect(pushDiscordDirectMessages).toHaveBeenCalledTimes(2);

    const [messageA, recipientsA, context] = jest.mocked(pushDiscordDirectMessages).mock
      .calls[0] as [string, { label: string }[], string];
    expect(context).toBe("match-reminder");
    expect(messageA).toContain("**Les Renards** contre **Team Nova**");
    expect(recipientsA.map((r) => r.label)).toEqual(["Kiro", "Ayla"]);

    const [messageB, recipientsB] = jest.mocked(pushDiscordDirectMessages).mock.calls[1];
    expect(messageB).toContain("**Team Nova** contre **Les Renards**");
    expect(recipientsB.map((r) => r.label)).toEqual(["Nova"]);
  });

  it("réserve le palier avant d'envoyer, puis marque l'horaire comme reçu", async () => {
    const { execute } = await mockDb({});

    await dispatchDueMatchReminders(ONE_HOUR_BEFORE);

    const [sql, params] = execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/INSERT IGNORE INTO bg_match_reminders/);
    // Réservé pour l'horaire lu : un horaire déplacé entre-temps fait échouer
    // la réservation, et l'annonce du nouveau garde son palier.
    // et les engagées aussi : une affiche changée a vu ses marques effacées. La
    // ligne retient l'horaire pour lequel elle est prise.
    expect(sql).toMatch(/SELECT \?, \?, start_at FROM bg_matches\s+WHERE id = \? AND start_at = \? AND team1_id = \? AND team2_id = \?/);
    expect(params).toEqual([31, "P1D", 31, START, 101, 102]);
    expect(claimedKeys(execute)).toEqual(["P1D", "TOLD"]);
  });

  it("ne marque rien comme reçu quand rien n'a abouti (bot injoignable, aucun appareil)", async () => {
    jest.mocked(pushToUsers).mockResolvedValue(0);
    jest.mocked(pushDiscordDirectMessages).mockResolvedValue(null);
    const { execute } = await mockDb({});

    expect(await dispatchDueMatchReminders(ONE_HOUR_BEFORE)).toBe(2);
    // Réservée avant l'envoi, la marque est rendue : rien n'a abouti.
    expect(claimedKeys(execute)).toEqual(["P1D", "TOLD"]);
    const release = (execute.mock.calls as unknown as [string, unknown[]][]).find(([sql]) => sql.startsWith("DELETE"));
    // Rendue seulement si elle porte encore l'horaire de cet envoi.
    expect(release?.[0]).toMatch(/^DELETE FROM bg_match_reminders WHERE match_id = \? AND offset_key = \? AND start_at <=> \?/);
    expect(release?.[1]).toEqual([31, "TOLD", START]);
  });

  it("rend à une marque déjà là son horaire d'avant quand rien n'a abouti", async () => {
    jest.mocked(pushToUsers).mockResolvedValue(0);
    jest.mocked(pushDiscordDirectMessages).mockResolvedValue(null);
    const before = new Date("2026-09-09T18:00:00Z");
    const { execute } = await mockDb({ told: before });

    await dispatchDueMatchReminders(ONE_HOUR_BEFORE);

    const updates = (execute.mock.calls as unknown as [string, unknown[]][])
      .filter(([sql]) => sql.startsWith("UPDATE bg_match_reminders") || sql.includes("ON DUPLICATE KEY UPDATE"))
      .map(([, params]) => params);
    // Posé avant l'envoi — si la manche porte encore cet horaire et ces
    // engagées, la manche lue avant la marque —, puis rendu.
    expect(updates).toEqual([
      [31, "TOLD", START, 31, START, 101, 102, START],
      // Rendu à condition de porter encore l'horaire écrit par cet envoi : un
      // changement plus récent, remis entre-temps, garde le sien.
      [before, 31, "TOLD", START],
    ]);
  });

  it("n'écrit rien dans une marque qui tient déjà l'horaire du rappel, ni ne la rend", async () => {
    jest.mocked(pushToUsers).mockResolvedValue(0);
    jest.mocked(pushDiscordDirectMessages).mockResolvedValue(null);
    const { execute } = await mockDb({ told: START });

    expect(await dispatchDueMatchReminders(ONE_HOUR_BEFORE)).toBe(2);

    const writes = (execute.mock.calls as unknown as [string, unknown[]][]).filter(
      ([sql]) => sql.startsWith("UPDATE") || sql.startsWith("DELETE"),
    );
    expect(writes).toEqual([]);
    expect(claimedKeys(execute)).toEqual(["P1D"]);
  });

  it("envoie plusieurs manches à la fois : une manche lente ne retient pas les autres", async () => {
    await mockDb({
      matches: [MATCH, { ...MATCH, id: 32 }],
      sent: [...SEEN, { match_id: 32, offset_key: "SEEN" }],
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    jest.mocked(pushDiscordDirectMessages).mockImplementation(async () => {
      calls += 1;
      // Le premier message privé (manche 31) attend : la manche 32 part quand même.
      if (calls === 1) await gate;
      return { sent: 1, unresolved: [], failed: [] };
    });

    const sweep = dispatchDueMatchReminders(ONE_HOUR_BEFORE);
    for (let tick = 0; tick < 100 && calls < 4; tick += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    // Les deux engagées de la manche 31 (l'une bloquée) et celles de la 32.
    expect(calls).toBe(4);
    release();

    // Chaque envoi compte, même terminé en même temps qu'un autre.
    expect(await sweep).toBe(4);
  });

  it("un envoi en échec n'arrête pas le balayage, et sa marque d'horaire reçu est rendue", async () => {
    // Mêmes engagées (mêmes destinataires), noms distincts pour reconnaître la manche.
    const { execute } = await mockDb({
      matches: [MATCH, { ...MATCH, id: 32, team1_name: "Les Loups", team2_name: "Orion" }],
      sent: [...SEEN, { match_id: 32, offset_key: "SEEN" }],
    });
    jest.mocked(pushDiscordDirectMessages).mockImplementation(async (message) => {
      if (message.includes("Les Renards")) throw new Error("bot en panne");
      return { sent: 1, unresolved: [], failed: [] };
    });
    jest.mocked(pushToUsers).mockResolvedValue(0);
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    // La manche 31 échoue ; la 32 part quand même.
    expect(await dispatchDueMatchReminders(ONE_HOUR_BEFORE)).toBe(2);
    expect(error).toHaveBeenCalled();
    // La marque réservée pour la 31 est rendue : rien n'y est arrivé.
    const releases = (execute.mock.calls as unknown as [string, unknown[]][])
      .filter(([sql]) => sql.startsWith("DELETE FROM bg_match_reminders"))
      .map(([, params]) => params);
    expect(releases).toEqual([[31, "TOLD", START]]);
  });

  it("garde la marque d'horaire reçu quand une seule engagée a été atteinte", async () => {
    const { execute } = await mockDb({});
    jest.mocked(pushDiscordDirectMessages).mockImplementation(async (message) => {
      if (message.includes("**Team Nova** contre")) throw new Error("bot en panne");
      return { sent: 1, unresolved: [], failed: [] };
    });
    jest.mocked(pushToUsers).mockResolvedValue(0);
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await dispatchDueMatchReminders(ONE_HOUR_BEFORE);

    expect(error).toHaveBeenCalled();
    expect(claimedKeys(execute)).toEqual(["P1D", "TOLD"]);
    const writes = (execute.mock.calls as unknown as [string, unknown[]][]).filter(
      ([sql]) => sql.startsWith("DELETE") || sql.startsWith("UPDATE"),
    );
    expect(writes).toEqual([]);
  });

  it("n'envoie rien quand l'horaire a changé depuis la lecture du balayage", async () => {
    const { execute } = await mockDb({ current: new Date("2026-09-11T18:00:00Z") });

    expect(await dispatchDueMatchReminders(ONE_HOUR_BEFORE)).toBe(0);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    expect(pushToUsers).not.toHaveBeenCalled();
    // Aucune marque d'horaire reçu posée pour un horaire périmé.
    expect(claimedKeys(execute)).toEqual(["P1D"]);
  });

  it("n'envoie rien quand une engagée a été remplacée depuis la lecture du balayage", async () => {
    const { execute } = await mockDb({ poster: [101, 999] });

    expect(await dispatchDueMatchReminders(ONE_HOUR_BEFORE)).toBe(0);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    expect(pushToUsers).not.toHaveBeenCalled();
    expect(claimedKeys(execute)).toEqual(["P1D"]);
  });

  it("n'envoie rien ni ne rend rien quand la marque d'horaire reçu n'a pu être posée", async () => {
    // Prise par un envoi concurrent du même horaire, ou manche changée depuis
    // la lecture (la condition est dans l'écriture).
    const { execute } = await mockDb({ toldClaimed: false });

    expect(await dispatchDueMatchReminders(ONE_HOUR_BEFORE)).toBe(0);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    const told = (execute.mock.calls as unknown as [string, unknown[]][]).find(([sql, params]) =>
      sql.includes("(match_id, offset_key, start_at)") && params[1] === "TOLD",
    );
    expect(told?.[0]).toMatch(/SELECT \?, \?, \? FROM bg_matches\s+WHERE id = \? AND start_at = \? AND team1_id = \? AND team2_id = \?/);
    expect(told?.[1]).toEqual([31, "TOLD", START, 31, START, 101, 102]);

    // Rien n'est à rendre : la marque n'est pas celle de cet envoi.
    const writes = (execute.mock.calls as unknown as [string, unknown[]][]).filter(
      ([sql]) => sql.startsWith("DELETE") || sql.startsWith("UPDATE"),
    );
    expect(writes).toEqual([]);
  });

  it("une réservation en échec n'empêche pas les autres manches de partir", async () => {
    const { execute } = await mockDb({
      matches: [MATCH, { ...MATCH, id: 32, team1_name: "Les Loups", team2_name: "Orion" }],
      sent: [...SEEN, { match_id: 32, offset_key: "SEEN" }],
    });
    const base = execute.getMockImplementation();
    execute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("INSERT IGNORE") && params?.[0] === 31 && params?.[1] === "P1D") {
        throw new Error("Lock wait timeout exceeded");
      }
      return base!(sql, params);
    });
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await dispatchDueMatchReminders(ONE_HOUR_BEFORE)).toBe(2);
    expect(error).toHaveBeenCalled();
    for (const message of sentMessages()) expect(message).toContain("Les Loups");
  });

  it("rend l'observation quand un palier ne peut être réservé : l'annonce repartira", async () => {
    const { execute } = await mockDb({ sent: [], matches: [{ ...MATCH, start_at: START }] });
    const base = execute.getMockImplementation();
    execute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("INSERT IGNORE") && params?.[1] === "P1D") throw new Error("Deadlock found");
      return base!(sql, params);
    });
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await dispatchDueMatchReminders(ONE_HOUR_BEFORE)).toBe(0);

    const release = (execute.mock.calls as unknown as [string, unknown[]][]).find(([sql]) => sql.startsWith("DELETE"));
    // Seulement l'observation prise pour cet horaire (un changement plus récent garde la sienne).
    expect(release?.[0]).toMatch(/AND start_at <=> \?$/);
    expect(release?.[1]).toEqual([31, "SEEN", START]);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it("rend le palier réservé quand la marque d'horaire reçu ne peut être lue (verrou)", async () => {
    const { execute } = await mockDb({});
    const base = execute.getMockImplementation();
    execute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("SELECT m.start_at AS match_start_at")) throw new Error("Lock wait timeout exceeded");
      return base!(sql, params);
    });
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await dispatchDueMatchReminders(ONE_HOUR_BEFORE)).toBe(0);

    const releases = (execute.mock.calls as unknown as [string, unknown[]][]).filter(([sql]) => sql.startsWith("DELETE"));
    // Rendu seulement s'il porte encore l'horaire de cet envoi.
    expect(releases).toEqual([[expect.stringMatching(/offset_key IN \(\?\) AND start_at <=> \?$/), [31, "P1D", START]]]);
    expect(error).toHaveBeenCalled();
  });

  it("rend toutes les réservations du passage quand ses destinataires ne peuvent être lus", async () => {
    const { query, execute } = await mockDb({ sent: [] });
    query.mockReset();
    query
      .mockResolvedValueOnce([[{ ...MATCH, seen_mark: 0, told_mark: 0 }]])
      .mockRejectedValueOnce(new Error("Too many connections"));

    await expect(dispatchDueMatchReminders(ONE_HOUR_BEFORE)).rejects.toThrow("Too many connections");

    const releases = (execute.mock.calls as unknown as [string, unknown[]][]).filter(([sql]) => sql.startsWith("DELETE"));
    // L'observation et le palier consommé : l'annonce repartira au passage suivant.
    expect(releases.map(([, params]) => params)).toEqual([[31, "SEEN", "P1D", START]]);
  });

  it("dit dans pm2 une marque d'horaire reçu qui n'a pu être rendue, sans masquer l'échec de l'envoi", async () => {
    jest.mocked(pushToUsers).mockResolvedValue(0);
    jest.mocked(pushDiscordDirectMessages).mockRejectedValue(new Error("bot en panne"));
    const { execute } = await mockDb({});
    const base = execute.getMockImplementation();
    execute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("DELETE FROM bg_match_reminders WHERE match_id = ? AND offset_key = ? AND start_at <=> ?")) {
        throw new Error("Lost connection");
      }
      return base!(sql, params);
    });
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await dispatchDueMatchReminders(ONE_HOUR_BEFORE)).toBe(0);

    const messages = error.mock.calls.map((call) => String(call[0]));
    expect(messages).toContain("[match-reminders] marque d'horaire reçu non rendue");
    // L'échec de l'envoi remonte toujours jusqu'au balayage.
    expect(messages).toContain("[match-reminders] envoi de rappel en échec");
  });

  it("réserve la marque d'horaire reçu avant l'envoi : une correction immédiate la lit déjà", async () => {
    const { execute } = await mockDb({});
    let toldBeforeSend = false;
    jest.mocked(pushDiscordDirectMessages).mockImplementation(async () => {
      toldBeforeSend = claimedKeys(execute).includes("TOLD");
      return { sent: 1, unresolved: [], failed: [] };
    });

    await dispatchDueMatchReminders(ONE_HOUR_BEFORE);
    expect(toldBeforeSend).toBe(true);
  });

  it("retient dans la marque l'horaire envoyé, et le met à jour quand elle existait", async () => {
    // Marque absente : posée avec l'horaire envoyé.
    const fresh = await mockDb({});
    await dispatchDueMatchReminders(ONE_HOUR_BEFORE);
    const reserve = (fresh.execute.mock.calls as unknown as [string, unknown[]][]).find(([sql, params]) =>
      sql.startsWith("INSERT IGNORE INTO bg_match_reminders (match_id, offset_key, start_at)") && params[1] === "TOLD",
    );
    expect(reserve?.[1]).toEqual([31, "TOLD", START, 31, START, 101, 102]);

    // Marque déjà là (un horaire reçu avant) : mise à jour avant l'envoi.
    resetMatchReminderThrottle();
    const held = await mockDb({ told: new Date("2026-09-09T18:00:00Z") });
    await dispatchDueMatchReminders(ONE_HOUR_BEFORE);
    const update = (held.execute.mock.calls as unknown as [string, unknown[]][]).find(([sql]) =>
      sql.includes("ON DUPLICATE KEY UPDATE"),
    );
    // La manche est lue avant la marque : l'ordre de verrouillage du moteur.
    expect(update?.[0]).toMatch(/^INSERT INTO bg_match_reminders \(match_id, offset_key, start_at\)\s+SELECT \?, \?, \? FROM bg_matches/);
    expect(update?.[0]).toMatch(/WHERE id = \? AND start_at <=> \? AND team1_id = \? AND team2_id = \?\s+ON DUPLICATE KEY UPDATE start_at = \?/);
    expect(update?.[1]).toEqual([31, "TOLD", START, 31, START, 101, 102, START]);
  });

  it("marque l'horaire reçu dès qu'un seul message privé a abouti", async () => {
    jest.mocked(pushToUsers).mockResolvedValue(0);
    jest.mocked(pushDiscordDirectMessages).mockResolvedValue({ sent: 1, unresolved: [], failed: [] });
    const { execute } = await mockDb({});

    await dispatchDueMatchReminders(ONE_HOUR_BEFORE);
    expect(claimedKeys(execute)).toEqual(["P1D", "TOLD"]);
  });

  it("ne marque rien comme reçu quand aucune engagée n'a de destinataire", async () => {
    const { execute } = await mockDb({ recipients: [] });

    expect(await dispatchDueMatchReminders(ONE_HOUR_BEFORE)).toBe(0);
    expect(claimedKeys(execute)).toEqual(["P1D"]);
  });

  it("n'envoie rien quand une autre requête a déjà pris le palier", async () => {
    await mockDb({ claimed: false });

    expect(await dispatchDueMatchReminders(ONE_HOUR_BEFORE)).toBe(0);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("saute un palier déjà envoyé sans même le réserver", async () => {
    const { execute } = await mockDb({
      sent: [...SEEN, { match_id: 31, offset_key: "P1D" }],
    });

    expect(await dispatchDueMatchReminders(ONE_HOUR_BEFORE)).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it("n'envoie plus de rappel « 1 h avant » : la dernière heure est silencieuse", async () => {
    // Les 24 h sont parties ; d'anciennes lignes `P7D` / `PT1H` peuvent rester en base.
    const { execute } = await mockDb({
      sent: [
        ...SEEN,
        { match_id: 31, offset_key: "P7D" },
        { match_id: 31, offset_key: "P1D" },
      ],
    });

    expect(await dispatchDueMatchReminders(ONE_HOUR_BEFORE)).toBe(0);
    expect(execute).not.toHaveBeenCalled();
    expect(pushToUsers).not.toHaveBeenCalled();
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("n'envoie plus de rappel « une semaine » : rien avant les 24 h", async () => {
    const { execute } = await mockDb({});

    expect(await dispatchDueMatchReminders(new Date("2026-09-03T18:00:00Z"))).toBe(0);
    expect(execute).not.toHaveBeenCalled();
    expect(pushToUsers).not.toHaveBeenCalled();
  });

  it("ne fait rien quand aucune manche n'est dans l'horizon", async () => {
    await mockDb({ matches: [] });

    expect(await dispatchDueMatchReminders(ONE_HOUR_BEFORE)).toBe(0);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("écarte de Discord un joueur sans identité, mais le garde pour le push", async () => {
    await mockDb({
      recipients: [
        { team_id: 101, id: 1, pseudo: "Kiro", discord_id: null, discord_pseudo: null },
        { team_id: 102, id: 3, pseudo: "Nova", discord_id: null, discord_pseudo: "nova" },
      ],
    });

    expect(await dispatchDueMatchReminders(ONE_HOUR_BEFORE)).toBe(2);
    // Une seule engagée joignable sur Discord : un seul appel au bot.
    expect(pushDiscordDirectMessages).toHaveBeenCalledTimes(1);
    const [, recipients] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(recipients.map((r) => r.label)).toEqual(["Nova"]);
    // Le push, lui, part aux deux engagées — Kiro compris.
    expect(jest.mocked(pushToUsers).mock.calls.map((call) => call[0])).toEqual([[1], [3]]);
  });

  it("pousse le rappel sous le sujet des rappels, vers le match", async () => {
    await mockDb({});

    await dispatchDueMatchReminders(ONE_HOUR_BEFORE);

    const [userIds, topic, content] = jest.mocked(pushToUsers).mock.calls[0];
    expect(userIds).toEqual([1, 2]);
    expect(topic).toBe("MATCH_REMINDER");
    expect(resolvePush(content).title).toBe("Match dans moins de 24 heures");
    expect(resolvePush(content).body).toContain("Les Renards contre Team Nova");
    expect(resolvePush(content).url).toBe("/tournois/7#match-31");
  });

  it("ne borne le calendrier qu'aux manches programmées et non jouées", async () => {
    const { query } = await mockDb({});

    await dispatchDueMatchReminders(ONE_HOUR_BEFORE);

    const [sql] = query.mock.calls[0] as unknown as [string];
    expect(sql).toMatch(/m\.start_at > NOW\(\)/);
    // Fenêtre de lecture = horizon + une journée de marge, pour que la manche
    // soit observée avant que le palier 24 h ne s'ouvre.
    expect(sql).toMatch(/DATE_ADD\(NOW\(\), INTERVAL \? SECOND\)/);
    const [, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    // Marques lues dans la requête ; au-delà de 24 h, seule une manche jamais
    // observée est lue (`SEEN` absent, relu par sa colonne).
    expect(params).toEqual(["SEEN", "TOLD", 2 * 24 * 60 * 60, "P1D", 24 * 60 * 60]);
    expect(sql).toMatch(/HAVING m\.start_at <= DATE_ADD\(NOW\(\), INTERVAL \? SECOND\) OR seen_mark = 0/);
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM bg_match_reminders sm WHERE sm\.match_id = m\.id AND sm\.offset_key = \?\) AS seen_mark/);
    // Une manche dont le rappel 24 h est déjà pris n'est plus relue.
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM bg_match_reminders done\s+WHERE done\.match_id = m\.id AND done\.offset_key = \?\)/);
    expect(sql).toMatch(/m\.status NOT IN \('COMPLETED', 'AWAITING_CONFIRMATION'\)/);
    // Jointure interne sur les deux engagées : un bye n'est pas un match.
    expect(sql).toMatch(/JOIN bg_teams t1/);
    expect(sql).toMatch(/JOIN bg_teams t2/);
  });

  it("s'étrangle : un second passage immédiat ne relit pas la base", async () => {
    await mockDb({});
    await dispatchDueMatchReminders(ONE_HOUR_BEFORE);
    jest.mocked(pushDiscordDirectMessages).mockClear();

    expect(await dispatchDueMatchReminders(ONE_HOUR_BEFORE)).toBe(0);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });
});

describe("dispatchDueMatchReminders — date posée tardivement", () => {
  it("annonce la date au lieu d'un « dans 24 heures » mensonger", async () => {
    // Manche découverte à cinq heures : la fenêtre du palier 24 h est ouverte,
    // mais ce qu'il annoncerait est faux.
    await mockDb({ sent: [] });

    expect(await dispatchDueMatchReminders(FIVE_HOURS_BEFORE)).toBe(2);

    const [, , context] = jest.mocked(pushDiscordDirectMessages).mock.calls[0] as [
      string,
      unknown,
      string,
    ];
    expect(context).toBe("match-scheduled");
    for (const message of sentMessages()) {
      expect(message).toContain("**Match programmé**");
      expect(message).not.toContain("dans 24 heures");
      expect(message).not.toContain("Prochain rappel");
    }
  });

  it("consomme le palier dépassé en même temps qu'elle annonce", async () => {
    const { execute } = await mockDb({ sent: [] });

    await dispatchDueMatchReminders(FIVE_HOURS_BEFORE);

    // La marque d'observation d'abord — c'est elle qui fait verrou —, puis le
    // palier déjà ouvert, puis la marque d'un horaire reçu.
    expect(claimedKeys(execute)).toEqual(["SEEN", "P1D", "TOLD"]);
  });

  it("consomme le palier pour une date posée à moins d'une heure", async () => {
    const { execute } = await mockDb({ sent: [] });

    expect(await dispatchDueMatchReminders(new Date("2026-09-10T17:30:00Z"))).toBe(2);

    expect(claimedKeys(execute)).toEqual(["SEEN", "P1D", "TOLD"]);
    for (const message of sentMessages()) {
      expect(message).toContain("**Match programmé**");
      expect(message).not.toContain("Prochain rappel");
    }
  });

  it("dit « reprogrammé » quand les joueurs avaient reçu un autre horaire", async () => {
    // `SEEN` absente mais `TOLD` présente (les preuves héritées y sont
    // recopiées au démarrage).
    for (const key of ["TOLD"]) {
      jest.mocked(pushDiscordDirectMessages).mockClear();
      resetMatchReminderThrottle();
      await mockDb({ sent: [{ match_id: 31, offset_key: key }] });

      expect(await dispatchDueMatchReminders(FIVE_HOURS_BEFORE)).toBe(2);
      for (const message of sentMessages()) {
        expect(message).toContain("**Match reprogrammé**");
        expect(message).not.toContain("au lieu du");
      }
    }
  });

  it("annonce une manche découverte avant l'ouverture du rappel, qui reste devant", async () => {
    // Une engagée manquait quand l'arbitre a posé la date : personne n'a été
    // prévenu, la première observation annonce.
    const { execute } = await mockDb({ sent: [] });

    expect(await dispatchDueMatchReminders(THREE_DAYS_BEFORE)).toBe(2);
    expect(claimedKeys(execute)).toEqual(["SEEN", "TOLD"]);
    for (const message of sentMessages()) {
      expect(message).toContain("**Match programmé**");
      expect(message).toContain("Prochain rappel : 24 heures avant le coup d'envoi.");
    }
  });

  it("laisse la manche au passage suivant si une autre requête l'observe d'abord", async () => {
    const { execute } = await mockDb({ sent: [], claimed: false });

    expect(await dispatchDueMatchReminders(FIVE_HOURS_BEFORE)).toBe(0);
    expect(claimedKeys(execute)).toEqual(["SEEN"]);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });
});

describe("announceMatchSchedule — horaire posé ou changé par l'arbitrage", () => {
  /**
   * `query` : les joueurs des engagées, les comptes (la manche est passée par
   * l'appelant, jamais relue) ; `execute` : les réservations.
   */
  async function mockAnnounceDb(options: { claimed?: boolean; recipients?: Recipient[] } = {}) {
    const recipients = options.recipients ?? RECIPIENTS;
    const query = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce([recipients.map((r) => ({ team_id: r.team_id, user_id: r.id }))])
      .mockResolvedValueOnce([recipients.map((r) => ({ ...r, discord_verified_at: null }))]);
    const execute = executeDouble(options);
    const { getDatabase } = await import("@/lib/server/database");
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query, execute }));
    return { query, execute };
  }

  it("annonce tout de suite une date posée au-delà de la fenêtre du balayage", async () => {
    const { query, execute } = await mockAnnounceDb();

    expect(await announceMatchSchedule(notice(), { rescheduled: false }, TEN_DAYS_BEFORE)).toBe(2);

    // La manche vient de l'appelant : aucune relecture, seuls les destinataires.
    const [sql] = query.mock.calls[0] as unknown as [string];
    expect(sql).not.toMatch(/FROM bg_matches/);
    // La marque d'observation est posée par `setMatchStartAt` : seule celle de
    // l'horaire reçu ici, le rappel 24 h reste devant.
    expect(claimedKeys(execute)).toEqual(["TOLD"]);
    for (const message of sentMessages()) {
      expect(message).toContain("**Match programmé**");
      expect(message).toContain("Prochain rappel : 24 heures");
    }
    expect(jest.mocked(pushDiscordDirectMessages).mock.calls[0][2]).toBe("match-scheduled");
  });

  it("dit « reprogrammé » aux deux engagées, par Discord et par push, dans la langue de chacun", async () => {
    const { execute } = await mockAnnounceDb();

    expect(
      await announceMatchSchedule(
        notice(),
        { rescheduled: true, previousStartAt: "2026-09-08T18:00:00Z" },
        FIVE_HOURS_BEFORE,
      ),
    ).toBe(2);

    expect(claimedKeys(execute)).toEqual(["P1D", "TOLD"]);
    expect(sentMessages()).toHaveLength(2);
    for (const message of sentMessages()) {
      expect(message).toContain("**Match reprogrammé**");
      expect(message).toContain("(heure de Paris), au lieu du mardi 8 septembre à 20:00");
    }
    const pushes = jest.mocked(pushToUsers).mock.calls;
    expect(pushes.map((call) => call[0])).toEqual([[1, 2], [3]]);
    expect(pushes.map((call) => call[1])).toEqual(["MATCH_REMINDER", "MATCH_REMINDER"]);
    expect(resolvePush(pushes[0][2]).title).toBe("Match reprogrammé");
    expect(resolvePush(pushes[0][2]).body).toContain("Les Renards contre Team Nova");
    expect(resolvePush(pushes[1][2]).body).toContain("Team Nova contre Les Renards");
    expect(resolvePush(pushes[0][2]).body).toContain("au lieu du mardi 8 septembre à 20:00");
    expect(resolvePush(pushes[0][2], "en").title).toBe("Match rescheduled");
    expect(resolvePush(pushes[0][2], "en").body).toContain("instead of Tuesday, September 8 at 20:00");
    expect(resolvePush(pushes[0][2], "en").url).toBe("/en/tournois/7#match-31");
  });

  it("nomme une ronde suisse « Ronde N » dans le message privé et le push, \"Round N\" en anglais", async () => {
    await mockAnnounceDb();

    expect(await announceMatchSchedule(notice({ swiss_round: 1 }), { rescheduled: false }, TEN_DAYS_BEFORE)).toBe(2);

    for (const message of sentMessages()) {
      expect(message).toContain("Ronde 2");
      expect(message).not.toContain("Manche 2");
    }
    const [, , content] = jest.mocked(pushToUsers).mock.calls[0];
    expect(resolvePush(content).body).toContain("Coupe BlueGenji, Ronde 2");
    expect(resolvePush(content, "en").body).toContain("Coupe BlueGenji, Round 2");
  });

  it("prévient le joueur d'une entrée solo sans nommer personne, ni en push ni sur Discord", async () => {
    await mockAnnounceDb({
      recipients: [
        { team_id: 101, id: 1, pseudo: "Kiro", discord_id: "555000111", discord_pseudo: "kiro" },
        { team_id: 102, id: 3, pseudo: "Nova", discord_id: "555000333", discord_pseudo: "nova" },
      ],
    });

    const solo = notice({ participant_type: "SOLO", team1_name: "Kiro", team2_name: "Nova" });
    expect(await announceMatchSchedule(solo, { rescheduled: false }, THREE_DAYS_BEFORE)).toBe(2);

    // Le message privé Discord ne porte pas plus de pseudo que le push.
    const directMessages = jest.mocked(pushDiscordDirectMessages).mock.calls.map((call) => call[0]);
    expect(directMessages).toHaveLength(2);
    for (const message of directMessages) {
      expect(message).toContain("**Ton match**");
      expect(message).not.toMatch(/Kiro|Nova/);
    }

    const pushes = jest.mocked(pushToUsers).mock.calls;
    expect(pushes.map((call) => call[0])).toEqual([[1], [3]]);
    for (const [, , content] of pushes) {
      for (const locale of ["fr", "en"] as const) {
        const { title, body } = resolvePush(content, locale);
        expect(`${title} ${body}`).not.toMatch(/Kiro|Nova/);
      }
    }
  });

  it("ne fait rien pour une manche passée, jouée ou sans ses deux engagées", async () => {
    const { query, execute } = await mockAnnounceDb();

    for (const skipped of [
      notice({ start_at: THREE_DAYS_BEFORE }),
      notice({ start_at: null }),
      notice({ status: "COMPLETED" }),
      notice({ status: "AWAITING_CONFIRMATION" }),
      notice({ team2_id: null, team2_name: null }),
    ]) {
      expect(await announceMatchSchedule(skipped, { rescheduled: false }, THREE_DAYS_BEFORE)).toBe(0);
    }
    expect(query).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(pushToUsers).not.toHaveBeenCalled();
  });

  it("se tait si un balayage concurrent a déjà envoyé le rappel ouvert, qui porte la nouvelle date", async () => {
    const { execute } = await mockAnnounceDb({ claimed: false });

    expect(await announceMatchSchedule(notice(), { rescheduled: true }, FIVE_HOURS_BEFORE)).toBe(0);
    expect(claimedKeys(execute)).toEqual(["P1D"]);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    expect(pushToUsers).not.toHaveBeenCalled();
  });

  it("rend l'observation de `setMatchStartAt` quand un palier ne peut être réservé", async () => {
    const { execute } = await mockAnnounceDb();
    const base = execute.getMockImplementation();
    execute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("INSERT IGNORE") && params?.[1] === "P1D") throw new Error("Lock wait timeout exceeded");
      return base!(sql, params);
    });

    await expect(announceMatchSchedule(notice(), { rescheduled: false }, FIVE_HOURS_BEFORE)).rejects.toThrow(
      "Lock wait timeout",
    );

    const release = (execute.mock.calls as unknown as [string, unknown[]][]).find(([sql]) => sql.startsWith("DELETE"));
    // Le balayage, qui ne lit que les manches sans observation, l'annoncera.
    expect(release?.[1]).toEqual([31, "SEEN", START]);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("ne réserve pas la marque d'observation : `setMatchStartAt` l'a posée", async () => {
    const { execute } = await mockAnnounceDb();
    await announceMatchSchedule(notice(), { rescheduled: false }, THREE_DAYS_BEFORE);
    expect(claimedKeys(execute)).not.toContain("SEEN");
  });
});

describe("announceMatchScheduleCleared — horaire retiré par l'arbitrage", () => {
  async function mockClearedDb(options: { recipients?: Recipient[]; told?: Date | null } = {}) {
    const recipients = options.recipients ?? RECIPIENTS;
    const query = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce([recipients.map((r) => ({ team_id: r.team_id, user_id: r.id }))])
      .mockResolvedValueOnce([recipients.map((r) => ({ ...r, discord_verified_at: null }))]);
    const execute = executeDouble({ told: options.told === undefined ? START : options.told, current: null });
    const { getDatabase } = await import("@/lib/server/database");
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query, execute }));
    return { query, execute };
  }

  it("prévient les deux engagées, par Discord et par push, dans la langue de chacun", async () => {
    const { query, execute } = await mockClearedDb();

    // La manche n'a plus d'horaire : il vient d'être effacé.
    expect(await announceMatchScheduleCleared(notice({ start_at: null }), "2026-09-10T18:00:00.000Z")).toBe(2);

    // La manche vient de l'appelant : aucune relecture, seuls les destinataires.
    const [sql] = query.mock.calls[0] as unknown as [string];
    expect(sql).not.toMatch(/FROM bg_matches/);
    // Les marques restent ; l'horaire tenu est oublié avant l'envoi (rien à citer ensuite).
    const updates = (execute.mock.calls as unknown as [string, unknown[]][]).filter(([sql]) => sql.startsWith("UPDATE") || sql.includes("ON DUPLICATE KEY UPDATE"));
    expect(updates).toEqual([
      [expect.stringMatching(/ON DUPLICATE KEY UPDATE start_at = \?$/), [31, "TOLD", null, 31, null, 101, 102, null]],
    ]);

    const calls = jest.mocked(pushDiscordDirectMessages).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][2]).toBe("match-schedule-cleared");
    expect(calls[0][0]).toContain("**Horaire du match retiré**");
    expect(calls[0][0]).toContain("**Les Renards** contre **Team Nova**");
    expect(calls[0][0]).toContain("L'horaire du jeudi 10 septembre à 20:00 (heure de Paris) est retiré : un nouvel horaire te sera annoncé.");
    // Un avis de retrait ne pose aucune marque : `TOLD` est déjà là.

    const pushes = jest.mocked(pushToUsers).mock.calls;
    expect(pushes.map((call) => call[0])).toEqual([[1, 2], [3]]);
    expect(pushes.map((call) => call[1])).toEqual(["MATCH_REMINDER", "MATCH_REMINDER"]);
    expect(resolvePush(pushes[0][2]).title).toBe("Horaire du match retiré");
    expect(resolvePush(pushes[1][2]).body).toContain("Team Nova contre Les Renards");
    expect(resolvePush(pushes[0][2], "en").title).toBe("Match time removed");
    expect(resolvePush(pushes[0][2], "en").url).toBe("/en/tournois/7#match-31");
  });

  it("ne nomme aucun joueur en tournoi individuel", async () => {
    await mockClearedDb({
      recipients: [
        { team_id: 101, id: 1, pseudo: "Kiro", discord_id: "555000111", discord_pseudo: "kiro" },
        { team_id: 102, id: 3, pseudo: "Nova", discord_id: "555000333", discord_pseudo: "nova" },
      ],
    });

    const solo = notice({ start_at: null, participant_type: "SOLO", team1_name: "Kiro", team2_name: "Nova" });
    expect(await announceMatchScheduleCleared(solo, "2026-09-10T18:00:00.000Z")).toBe(2);

    for (const [message] of jest.mocked(pushDiscordDirectMessages).mock.calls) {
      expect(message).toContain("**Ton match**");
      expect(message).not.toMatch(/Kiro|Nova/);
    }
    for (const [, , content] of jest.mocked(pushToUsers).mock.calls) {
      for (const locale of ["fr", "en"] as const) {
        const { title, body } = resolvePush(content, locale);
        expect(`${title} ${body}`).not.toMatch(/Kiro|Nova/);
      }
    }
  });

  it("ne prévient de rien quand la marque d'horaire reçu a disparu entre-temps", async () => {
    const { query } = await mockClearedDb();
    const { getDatabase } = await import("@/lib/server/database");
    const execute = executeDouble({ current: null });
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query, execute }));

    expect(await announceMatchScheduleCleared(notice({ start_at: null }), "2026-09-10T18:00:00.000Z")).toBe(0);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    expect(pushToUsers).not.toHaveBeenCalled();
  });

  it("ne fait rien pour une manche jouée ou sans ses deux engagées", async () => {
    await mockClearedDb();
    for (const skipped of [
      notice({ start_at: null, status: "COMPLETED" }),
      notice({ start_at: null, status: "AWAITING_CONFIRMATION" }),
      notice({ start_at: null, team1_id: null, team1_name: null }),
    ]) {
      expect(await announceMatchScheduleCleared(skipped, "2026-09-10T18:00:00.000Z")).toBe(0);
    }
    expect(pushToUsers).not.toHaveBeenCalled();
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });
});

describe("announceEntrantsWithdrawn — engagées retirées par une correction de score", () => {
  const MATCH_ROW = {
    id: 31,
    tournament_id: 7,
    tournament_name: "Coupe BlueGenji",
    participant_type: "TEAM",
    bracket: "UPPER",
    round_number: 2,
    swiss_round: 0,
    // Après la correction : Les Renards (101) sont sortis de la place 1.
    team1_id: 109,
    team2_id: 102,
    team1_name: "Orion",
    team2_name: "Team Nova",
  };
  const DEPARTED = { matchId: 31, teamId: 101, slot: 1 as const, heldStartAt: START };

  /** `query` : manches, noms des sortantes, joueurs des engagées, comptes. */
  async function mockWithdrawnDb(
    rows: object[] = [MATCH_ROW],
    names: object[] = [{ id: 101, name: "Les Renards" }],
    recipients: Recipient[] = RECIPIENTS,
  ) {
    const query = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce([rows])
      .mockResolvedValueOnce([names])
      .mockResolvedValueOnce([recipients.map((r) => ({ team_id: r.team_id, user_id: r.id }))])
      .mockResolvedValueOnce([recipients.map((r) => ({ ...r, discord_verified_at: null }))]);
    const { getDatabase } = await import("@/lib/server/database");
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query, execute: jest.fn() }));
    return query;
  }

  it("prévient les seuls joueurs de l'engagée retirée, par Discord et par push, dans la langue de chacun", async () => {
    const query = await mockWithdrawnDb();

    expect(await announceEntrantsWithdrawn([DEPARTED])).toBe(1);

    // Une lecture pour toutes les manches, une pour tous les noms.
    expect((query.mock.calls[0] as unknown as [string, unknown[]])[1]).toEqual([31]);
    expect((query.mock.calls[1] as unknown as [string, unknown[]])[1]).toEqual([101]);
    const calls = jest.mocked(pushDiscordDirectMessages).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toBe("match-withdrawn");
    expect(calls[0][0]).toContain("**Match retiré de ton programme**");
    // L'ancien adversaire : l'occupant de l'autre place.
    expect(calls[0][0]).toContain("**Les Renards** contre **Team Nova**");
    expect(calls[0][0]).toContain("l'horaire du jeudi 10 septembre à 20:00 (heure de Paris) ne te concerne plus.");

    const pushes = jest.mocked(pushToUsers).mock.calls;
    expect(pushes.map((call) => call[0])).toEqual([[1, 2]]);
    expect(pushes[0][1]).toBe("MATCH_REMINDER");
    expect(resolvePush(pushes[0][2]).title).toBe("Match retiré de ton programme");
    expect(resolvePush(pushes[0][2]).tag).toBe("rencontre-31-reminder");
    expect(resolvePush(pushes[0][2], "en").title).toBe("Match removed from your schedule");
    expect(resolvePush(pushes[0][2], "en").url).toBe("/en/tournois/7#match-31");
  });

  it("ne nomme aucun joueur en tournoi individuel, et lit l'autre place pour une sortante en place 2", async () => {
    await mockWithdrawnDb(
      [{ ...MATCH_ROW, participant_type: "SOLO", team1_id: 103, team1_name: "Nova", team2_id: 109, team2_name: "Orion" }],
      [{ id: 101, name: "Kiro" }],
    );

    await announceEntrantsWithdrawn([{ ...DEPARTED, slot: 2 }]);

    const [message] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(message).toContain("**Ton match**");
    expect(message).not.toMatch(/Kiro|Nova|Orion/);
    for (const locale of ["fr", "en"] as const) {
      const { title, body } = resolvePush(jest.mocked(pushToUsers).mock.calls[0][2], locale);
      expect(`${title} ${body}`).not.toMatch(/Kiro|Nova|Orion/);
    }
  });

  it("dit « Ronde N » en ronde suisse, et « TBD » quand l'autre place est vide", async () => {
    await mockWithdrawnDb([{ ...MATCH_ROW, swiss_round: 1, team2_id: null, team2_name: null }]);
    await announceEntrantsWithdrawn([DEPARTED]);
    const [message] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(message).toContain("Coupe BlueGenji · Ronde 2");
    expect(message).toContain("**Les Renards** contre **TBD**");
    expect(resolvePush(jest.mocked(pushToUsers).mock.calls[0][2], "en").body).toContain("Round 2");
  });

  it("ne prévient pas une engagée revenue sur la manche (seconde correction)", async () => {
    const query = await mockWithdrawnDb([{ ...MATCH_ROW, team1_id: 101, team1_name: "Les Renards" }]);
    expect(await announceEntrantsWithdrawn([DEPARTED])).toBe(0);
    // Ni destinataires lus, ni message.
    expect(query).toHaveBeenCalledTimes(2);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("ne fait rien sans avis, pour une manche disparue ou une engagée sans joueur à prévenir", async () => {
    expect(await announceEntrantsWithdrawn([])).toBe(0);
    await mockWithdrawnDb([]);
    expect(await announceEntrantsWithdrawn([DEPARTED])).toBe(0);
    await mockWithdrawnDb([MATCH_ROW], [{ id: 101, name: "Les Renards" }], []);
    expect(await announceEntrantsWithdrawn([DEPARTED])).toBe(0);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    expect(pushToUsers).not.toHaveBeenCalled();
  });
});
