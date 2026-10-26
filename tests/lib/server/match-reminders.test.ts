import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/push-subscriptions");
jest.mock("@/lib/server/tournaments/referee-digest");

import {
  announceMatchSchedule,
  announceEntrantsWithdrawn,
  announceMatchScheduleCleared,
  dispatchDueMatchReminders,
  pendingRefereeDigest,
  resetMatchReminderThrottle,
  type MatchNotice,
} from "@/lib/server/tournaments/match-reminders";
import { pushDiscordDirectMessages } from "@/lib/server/bot-integration";
import { pushToUsers, usersReachableByPush } from "@/lib/server/push-subscriptions";
import { fakePool } from "../../helpers/sql-double";
import { resolvePush } from "../../helpers/push";
import { BILINGUAL_DM_SEPARATOR } from "@/lib/shared/dm-language";

const START = new Date("2026-09-10T18:00:00Z");
const TWELVE_HOURS_BEFORE = new Date("2026-09-10T06:00:00Z");
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
  /** `bg_users.match_dm_enabled` : absent = activé (défaut de la colonne). */
  match_dm_enabled?: number;
  /** `bg_users.discord_verified_at` : absent = certifié dès qu'il y a un tag. */
  discord_verified_at?: string | null;
};

/** Seul un tag certifié reçoit un message privé de match (portée `certified`). */
function certifiedAt(r: Recipient): string | null {
  if (r.discord_verified_at !== undefined) return r.discord_verified_at;
  return r.discord_pseudo ? "2026-09-01" : null;
}

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
  // Une manche dont le dernier palier (`PT10H`) est pris n'est pas lue (`NOT EXISTS`).
  const matches = ((options.matches ?? [MATCH]) as { id: number }[])
    .filter((match) => has(match.id, "PT10H") === 0)
    .map((match) => ({
    ...match,
    seen_mark: has(match.id, "SEEN"),
    told_mark: has(match.id, "TOLD"),
  }));
  const query = jest
    .fn<() => Promise<unknown>>()
    .mockResolvedValueOnce([matches])
    .mockResolvedValueOnce([recipients.map((r) => ({ team_id: r.team_id, user_id: r.id }))])
    .mockResolvedValueOnce([recipients.map((r) => ({ ...r, discord_verified_at: certifiedAt(r) }))]);
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
  // Tout joueur a un appareil abonné aux rappels, sauf mention contraire.
  jest.mocked(usersReachableByPush).mockImplementation(async (ids) => new Set(ids));
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

    expect(await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE)).toBe(2);
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

  it("termine chaque message privé de match par la ligne qui dit où les couper (LEGAL-FOLLOWUP-444)", async () => {
    await mockDb({});
    await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE);
    const messages = sentMessages();
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      // Langue du compte inconnue du double SQL : message bilingue, chaque partie
      // finit par la ligne de retrait.
      const [fr, en] = message.split(BILINGUAL_DM_SEPARATOR);
      expect(fr.split("\n").at(-1)).toMatch(/^Tu peux couper ces messages privés dans /);
      expect(en.split("\n").at(-1)).toMatch(/^You can turn off these direct messages in /);
    }
  });

  it("réserve le palier avant d'envoyer, puis marque l'horaire comme reçu", async () => {
    const { execute } = await mockDb({});

    await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE);

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

    expect(await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE)).toBe(2);
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

    await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE);

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

    expect(await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE)).toBe(2);

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

    const sweep = dispatchDueMatchReminders(TWELVE_HOURS_BEFORE);
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
    expect(await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE)).toBe(2);
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

    await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE);

    expect(error).toHaveBeenCalled();
    expect(claimedKeys(execute)).toEqual(["P1D", "TOLD"]);
    const writes = (execute.mock.calls as unknown as [string, unknown[]][]).filter(
      ([sql]) => sql.startsWith("DELETE") || sql.startsWith("UPDATE"),
    );
    expect(writes).toEqual([]);
  });

  it("n'envoie rien quand l'horaire a changé depuis la lecture du balayage", async () => {
    const { execute } = await mockDb({ current: new Date("2026-09-11T18:00:00Z") });

    expect(await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE)).toBe(0);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    expect(pushToUsers).not.toHaveBeenCalled();
    // Aucune marque d'horaire reçu posée pour un horaire périmé.
    expect(claimedKeys(execute)).toEqual(["P1D"]);
  });

  it("n'envoie rien quand une engagée a été remplacée depuis la lecture du balayage", async () => {
    const { execute } = await mockDb({ poster: [101, 999] });

    expect(await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE)).toBe(0);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    expect(pushToUsers).not.toHaveBeenCalled();
    expect(claimedKeys(execute)).toEqual(["P1D"]);
  });

  it("n'envoie rien ni ne rend rien quand la marque d'horaire reçu n'a pu être posée", async () => {
    // Prise par un envoi concurrent du même horaire, ou manche changée depuis
    // la lecture (la condition est dans l'écriture).
    const { execute } = await mockDb({ toldClaimed: false });

    expect(await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE)).toBe(0);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    const told = (execute.mock.calls as unknown as [string, unknown[]][]).find(([sql, params]) =>
      sql.includes("(match_id, offset_key, start_at)") && params[1] === "TOLD",
    );
    // Même réservation datée que les paliers : l'horaire recopié de la manche.
    expect(told?.[0]).toMatch(/SELECT \?, \?, start_at FROM bg_matches\s+WHERE id = \? AND start_at = \? AND team1_id = \? AND team2_id = \?/);
    expect(told?.[1]).toEqual([31, "TOLD", 31, START, 101, 102]);

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

    expect(await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE)).toBe(2);
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

    expect(await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE)).toBe(0);

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

    expect(await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE)).toBe(0);

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

    await expect(dispatchDueMatchReminders(TWELVE_HOURS_BEFORE)).rejects.toThrow("Too many connections");

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

    expect(await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE)).toBe(0);

    const messages = error.mock.calls.map((call) => String(call[0]));
    expect(messages).toContain("[match-reminders] marque d'horaire reçu non rendue");
    // L'échec de l'envoi remonte toujours jusqu'au balayage.
    expect(messages).toContain("[match-reminders] envoi de rappel en échec");
  });

  it("tient chacun pour atteignable si les abonnements ne peuvent être lus", async () => {
    jest.mocked(usersReachableByPush).mockRejectedValue(new Error("Lock wait timeout exceeded"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await mockDb({});

    // Les messages privés et les push partent comme avant le filtre.
    expect(await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE)).toBe(2);
    expect(jest.mocked(pushToUsers).mock.calls.map((call) => call[0])).toEqual([[1, 2], [3]]);
    expect(error).toHaveBeenCalled();
  });

  it("ne pose aucune marque d'horaire reçu pour des engagées que rien n'atteindrait", async () => {
    // Ni tag Discord exploitable… (les identités déclarées passent par le bot)
    const unreachable = RECIPIENTS.map((r) => ({ ...r, discord_id: null, discord_pseudo: null }));
    // … ni appareil abonné aux rappels.
    jest.mocked(usersReachableByPush).mockResolvedValue(new Set());
    const { execute } = await mockDb({ recipients: unreachable });

    expect(await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE)).toBe(0);

    expect(claimedKeys(execute)).toEqual(["P1D"]);
    expect(pushToUsers).not.toHaveBeenCalled();
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("réserve la marque d'horaire reçu avant l'envoi : une correction immédiate la lit déjà", async () => {
    const { execute } = await mockDb({});
    let toldBeforeSend = false;
    jest.mocked(pushDiscordDirectMessages).mockImplementation(async () => {
      toldBeforeSend = claimedKeys(execute).includes("TOLD");
      return { sent: 1, unresolved: [], failed: [] };
    });

    await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE);
    expect(toldBeforeSend).toBe(true);
  });

  it("retient dans la marque l'horaire envoyé, et le met à jour quand elle existait", async () => {
    // Marque absente : posée avec l'horaire envoyé.
    const fresh = await mockDb({});
    await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE);
    const reserve = (fresh.execute.mock.calls as unknown as [string, unknown[]][]).find(([sql, params]) =>
      sql.startsWith("INSERT IGNORE INTO bg_match_reminders (match_id, offset_key, start_at)") && params[1] === "TOLD",
    );
    expect(reserve?.[1]).toEqual([31, "TOLD", 31, START, 101, 102]);

    // Marque déjà là (un horaire reçu avant) : mise à jour avant l'envoi.
    resetMatchReminderThrottle();
    const held = await mockDb({ told: new Date("2026-09-09T18:00:00Z") });
    await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE);
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

    await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE);
    expect(claimedKeys(execute)).toEqual(["P1D", "TOLD"]);
  });

  it("ne marque rien comme reçu quand aucune engagée n'a de destinataire", async () => {
    const { execute } = await mockDb({ recipients: [] });

    expect(await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE)).toBe(0);
    expect(claimedKeys(execute)).toEqual(["P1D"]);
  });

  it("n'envoie rien quand une autre requête a déjà pris le palier", async () => {
    await mockDb({ claimed: false });

    expect(await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE)).toBe(0);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("saute un palier déjà envoyé sans même le réserver", async () => {
    const { execute } = await mockDb({
      sent: [...SEEN, { match_id: 31, offset_key: "P1D" }, { match_id: 31, offset_key: "PT10H" }],
    });

    expect(await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE)).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it("n'envoie plus de rappel « 1 h avant » : la dernière heure est silencieuse", async () => {
    // Les 24 h sont parties ; d'anciennes lignes `P7D` / `PT1H` peuvent rester en base.
    const { execute } = await mockDb({
      sent: [
        ...SEEN,
        { match_id: 31, offset_key: "P7D" },
        { match_id: 31, offset_key: "P1D" },
        { match_id: 31, offset_key: "PT10H" },
      ],
    });

    expect(await dispatchDueMatchReminders(new Date("2026-09-10T17:30:00Z"))).toBe(0);
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

    expect(await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE)).toBe(0);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("écarte de Discord un joueur sans identité, mais le garde pour le push", async () => {
    await mockDb({
      recipients: [
        { team_id: 101, id: 1, pseudo: "Kiro", discord_id: null, discord_pseudo: null },
        { team_id: 102, id: 3, pseudo: "Nova", discord_id: null, discord_pseudo: "nova" },
      ],
    });

    expect(await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE)).toBe(2);
    // Une seule engagée joignable sur Discord : un seul appel au bot.
    expect(pushDiscordDirectMessages).toHaveBeenCalledTimes(1);
    const [, recipients] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(recipients.map((r) => r.label)).toEqual(["Nova"]);
    // Le push, lui, part aux deux engagées — Kiro compris.
    expect(jest.mocked(pushToUsers).mock.calls.map((call) => call[0])).toEqual([[1], [3]]);
  });

  it("n'écrit qu'aux tags Discord certifiés : un tag saisi ou un identifiant non certifié n'a que le push", async () => {
    await mockDb({
      recipients: [
        { team_id: 101, id: 1, pseudo: "Kiro", discord_id: "555000111", discord_pseudo: "kiro", discord_verified_at: null },
        { team_id: 101, id: 2, pseudo: "Ayla", discord_id: null, discord_pseudo: "ayla_bg", discord_verified_at: null },
        { team_id: 102, id: 3, pseudo: "Nova", discord_id: "555000333", discord_pseudo: "nova" },
      ],
    });

    expect(await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE)).toBe(2);
    // Seule l'engagée de Nova (certifiée) reçoit un message privé.
    expect(pushDiscordDirectMessages).toHaveBeenCalledTimes(1);
    const [, recipients] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(recipients).toEqual([{ discordId: "555000333", handle: "nova", label: "Nova" }]);
    // Le push part à tous, certifiés ou non.
    expect(jest.mocked(pushToUsers).mock.calls.map((call) => call[0])).toEqual([[1, 2], [3]]);
  });

  it("un joueur certifié qui a coupé les messages de match n'en reçoit pas, mais garde son push", async () => {
    await mockDb({
      recipients: [
        { team_id: 101, id: 1, pseudo: "Kiro", discord_id: "555000111", discord_pseudo: "kiro", match_dm_enabled: 0 },
        { team_id: 102, id: 3, pseudo: "Nova", discord_id: "555000333", discord_pseudo: "nova" },
      ],
    });

    await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE);
    const labels = jest.mocked(pushDiscordDirectMessages).mock.calls.flatMap(([, list]) => list.map((r) => r.label));
    expect(labels).toEqual(["Nova"]);
    expect(jest.mocked(pushToUsers).mock.calls.map((call) => call[0])).toEqual([[1], [3]]);
  });

  it("pousse le rappel sous le sujet des rappels, vers le match", async () => {
    await mockDb({});

    await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE);

    const [userIds, topic, content] = jest.mocked(pushToUsers).mock.calls[0];
    expect(userIds).toEqual([1, 2]);
    expect(topic).toBe("MATCH_REMINDER");
    expect(resolvePush(content).title).toBe("Match dans moins de 24 heures");
    expect(resolvePush(content).body).toContain("Les Renards contre Team Nova");
    expect(resolvePush(content).url).toBe("/tournois/7#match-31");
  });

  it("ne borne le calendrier qu'aux manches programmées et non jouées", async () => {
    const { query } = await mockDb({});

    await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE);

    const [sql] = query.mock.calls[0] as unknown as [string];
    // Bornes calculées par le processus, jamais `NOW()` : une base sur un autre
    // fuseau que l'application décalerait l'ouverture des paliers.
    expect(sql).not.toMatch(/NOW\(\)/);
    expect(sql).toMatch(/m\.start_at > \?/);
    // Un tournoi clos ne se joue plus : aucun rappel pour ses manches restées ouvertes.
    expect(sql).toMatch(/AND t\.state <> 'FINISHED'/);
    // Fenêtre de lecture = horizon + une journée de marge, pour que la manche
    // soit observée avant que le palier 24 h ne s'ouvre.
    expect(sql).toMatch(/AND m\.start_at <= \?/);
    const [, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    // Marques lues dans la requête ; au-delà de 24 h, seule une manche jamais
    // observée est lue (`SEEN` absent, relu par sa colonne).
    // Une manche dont le rappel 24 h est pris n'est pas relue avant l'ouverture
    // du rappel 10 h (36 000 s) : sans cela, chaque passage la relirait et
    // re-tenterait sa marque « 24 h » pendant 14 heures.
    const at = (hours: number) => new Date(TWELVE_HOURS_BEFORE.getTime() + hours * 60 * 60 * 1000);
    expect(params).toEqual(["SEEN", "TOLD", TWELVE_HOURS_BEFORE, at(48), "PT10H", "P1D", at(10), at(24)]);
    expect(sql).toMatch(
      /NOT EXISTS \(SELECT 1 FROM bg_match_reminders sent\s+WHERE sent\.match_id = m\.id AND sent\.offset_key = \?\s+AND m\.start_at > \?\)/,
    );
    expect(sql).toMatch(/HAVING m\.start_at <= \? OR seen_mark = 0/);
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM bg_match_reminders sm WHERE sm\.match_id = m\.id AND sm\.offset_key = \?\) AS seen_mark/);
    // Une manche dont le rappel 10 h (le dernier) est déjà pris n'est plus relue.
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM bg_match_reminders done\s+WHERE done\.match_id = m\.id AND done\.offset_key = \?\)/);
    expect(sql).toMatch(/m\.status NOT IN \('COMPLETED', 'AWAITING_CONFIRMATION'\)/);
    // Jointure interne sur les deux engagées : un bye n'est pas un match.
    expect(sql).toMatch(/JOIN bg_teams t1/);
    expect(sql).toMatch(/JOIN bg_teams t2/);
  });

  it("s'étrangle : un second passage immédiat ne relit pas la base", async () => {
    await mockDb({});
    await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE);
    jest.mocked(pushDiscordDirectMessages).mockClear();

    expect(await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE)).toBe(0);
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
    // paliers déjà ouverts, puis la marque d'un horaire reçu.
    expect(claimedKeys(execute)).toEqual(["SEEN", "P1D", "PT10H", "TOLD"]);
  });

  it("consomme le palier pour une date posée à moins d'une heure", async () => {
    const { execute } = await mockDb({ sent: [] });

    expect(await dispatchDueMatchReminders(new Date("2026-09-10T17:30:00Z"))).toBe(2);

    expect(claimedKeys(execute)).toEqual(["SEEN", "P1D", "PT10H", "TOLD"]);
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
      .mockResolvedValueOnce([recipients.map((r) => ({ ...r, discord_verified_at: certifiedAt(r) }))]);
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

  it("dit le check-in déjà ouvert à une manche programmée moins de 15 minutes avant", async () => {
    await mockAnnounceDb();

    expect(await announceMatchSchedule(notice(), { rescheduled: false }, new Date("2026-09-10T17:50:00Z"))).toBe(2);

    for (const message of sentMessages()) {
      expect(message).toContain("le salon de check-in est déjà ouvert sur Discord");
      expect(message).not.toContain("ouvre 15 minutes avant");
    }
    const pushes = jest.mocked(pushToUsers).mock.calls;
    expect(resolvePush(pushes[0][2]).body).toContain("Check-in déjà ouvert sur Discord");
    expect(resolvePush(pushes[0][2], "en").body).toContain("Check-in already open on Discord");
  });

  it("juge l'ouverture du check-in à l'envoi, pas au début du passage", async () => {
    await mockAnnounceDb();
    // Passage commencé 15 min 30 s avant le coup d'envoi ; le message sort une
    // minute plus tard (bot lent, lots d'une ronde suisse) : le salon est ouvert.
    const base = Date.now();
    let calls = 0;
    const clock = jest.spyOn(Date, "now").mockImplementation(() => (calls++ === 0 ? base : base + 60_000));

    await announceMatchSchedule(notice(), { rescheduled: false }, new Date("2026-09-10T17:44:30Z"));
    clock.mockRestore();

    for (const message of sentMessages()) {
      expect(message).toContain("le salon de check-in est déjà ouvert sur Discord");
    }
  });

  it("dit l'ouverture du check-in à venir à une manche programmée 5 h avant", async () => {
    await mockAnnounceDb();

    expect(await announceMatchSchedule(notice(), { rescheduled: false }, FIVE_HOURS_BEFORE)).toBe(2);

    for (const message of sentMessages()) expect(message).toContain("le salon de check-in ouvre 15 minutes avant");
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

    expect(claimedKeys(execute)).toEqual(["P1D", "PT10H", "TOLD"]);
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
    // À 5 h du coup d'envoi, l'annonce porte le check-in : toucher le push
    // ouvre l'invitation (l'adresse écrite dans le texte ne se touche pas).
    expect(resolvePush(pushes[0][2], "en").body).toContain("Check-in on Discord");
    expect(resolvePush(pushes[0][2]).url).toBe("/check-in");
    expect(resolvePush(pushes[0][2], "en").url).toBe("/check-in");
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
      .mockResolvedValueOnce([recipients.map((r) => ({ ...r, discord_verified_at: certifiedAt(r) }))]);
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

describe("announceEntrantsWithdrawn — engagées retirées de leur manche", () => {
  // Après la correction : Les Renards (101) sont sortis ; Orion (109) a pris leur place.
  const CURRENT = {
    id: 31,
    tournament_id: 7,
    phase_id: 0,
    bracket: "UPPER",
    round_number: 2,
    team1_id: 109,
    team2_id: 102,
    start_at: START,
  };
  const MATCH = {
    tournamentId: 7,
    tournamentName: "Coupe BlueGenji",
    phaseId: 0,
    solo: false,
    refereeScheduling: true,
    bracket: "UPPER",
    roundNumber: 2,
    swiss: false,
  };
  // L'adversaire de l'horaire reçu, relevé avant le changement : Team Nova (102).
  const DEPARTED = { matchId: 31, teamId: 101, opponentId: 102, heldStartAt: START, match: MATCH };
  const NAMES = [
    { id: 101, name: "Les Renards" },
    { id: 102, name: "Team Nova" },
  ];

  /** `query` : manches d'avant et d'arrivée, noms (sortantes et adversaires), joueurs des engagées, comptes. */
  async function mockWithdrawnDb(
    current: object[] = [CURRENT],
    names: object[] = NAMES,
    recipients: Recipient[] = RECIPIENTS,
  ) {
    const query = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce([current])
      .mockResolvedValueOnce([names])
      .mockResolvedValueOnce([recipients.map((r) => ({ team_id: r.team_id, user_id: r.id }))])
      .mockResolvedValueOnce([recipients.map((r) => ({ ...r, discord_verified_at: certifiedAt(r) }))]);
    const { getDatabase } = await import("@/lib/server/database");
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query, execute: jest.fn() }));
    return query;
  }

  it("« Match retiré » : pas de message privé au joueur qui les a coupés, son push part", async () => {
    await mockWithdrawnDb([CURRENT], NAMES, RECIPIENTS.map((r) => (r.id === 2 ? { ...r, match_dm_enabled: 0 } : r)));
    expect(await announceEntrantsWithdrawn([DEPARTED])).toBe(1);
    const calls = jest.mocked(pushDiscordDirectMessages).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toBe("match-withdrawn");
    expect((calls[0][1] as { label: string }[]).map((r) => r.label)).toEqual(["Kiro"]);
    expect(jest.mocked(pushToUsers).mock.calls.map((call) => call[0])).toEqual([[1, 2]]);
  });

  it("« Match retiré » se termine par la ligne qui dit où couper ces messages (LEGAL-FOLLOWUP-444)", async () => {
    const previous = process.env.APP_URL;
    process.env.APP_URL = "https://bluegenji.test/";
    try {
      await mockWithdrawnDb();
      await announceEntrantsWithdrawn([DEPARTED]);
      const [fr, en] = jest.mocked(pushDiscordDirectMessages).mock.calls[0][0].split(BILINGUAL_DM_SEPARATOR);
      expect(fr.split("\n").at(-1)).toBe(
        "Tu peux couper ces messages privés dans ton profil, section Notifications : <https://bluegenji.test/profil#notifications>",
      );
      expect(en.split("\n").at(-1)).toBe(
        "You can turn off these direct messages in your profile, Notifications section: <https://bluegenji.test/en/profil#notifications>",
      );
    } finally {
      if (previous === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = previous;
    }
  });

  it("prévient les seuls joueurs de l'engagée retirée, par Discord et par push, dans la langue de chacun", async () => {
    const query = await mockWithdrawnDb();

    expect(await announceEntrantsWithdrawn([DEPARTED])).toBe(1);

    // Une lecture pour les manches (d'avant, et celles des sortantes dans le tournoi), une pour les noms.
    const [currentSql, currentParams] = query.mock.calls[0] as unknown as [string, unknown[]];
    // Trois branches réunies, chacune sur son index : la clé, puis le tournoi et chaque place.
    expect(currentSql.match(/UNION/g)).toHaveLength(2);
    expect(currentSql).not.toMatch(/\bOR\b/);
    expect(currentParams).toEqual([31, 7, 101, 7, 101]);
    expect((query.mock.calls[1] as unknown as [string, unknown[]])[1]).toEqual([101, 102]);
    const calls = jest.mocked(pushDiscordDirectMessages).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toBe("match-withdrawn");
    expect(calls[0][0]).toContain("**Match retiré de ton programme**");
    // L'adversaire de l'horaire reçu, pas l'occupant actuel de l'autre place.
    expect(calls[0][0]).toContain("**Les Renards** contre **Team Nova**");
    expect(calls[0][0]).toContain(
      "Le tournoi a été mis à jour et tu ne joues plus ce match : l'horaire du jeudi 10 septembre à 20:00 (heure de Paris) ne te concerne plus.",
    );

    const pushes = jest.mocked(pushToUsers).mock.calls;
    expect(pushes.map((call) => call[0])).toEqual([[1, 2]]);
    expect(pushes[0][1]).toBe("MATCH_REMINDER");
    expect(resolvePush(pushes[0][2]).title).toBe("Match retiré de ton programme");
    expect(resolvePush(pushes[0][2]).tag).toBe("rencontre-31-reminder");
    expect(resolvePush(pushes[0][2]).url).toBe("/tournois/7#match-31");
    expect(resolvePush(pushes[0][2], "en").title).toBe("Match removed from your schedule");
    expect(resolvePush(pushes[0][2], "en").url).toBe("/en/tournois/7#match-31");
  });

  it("nomme l'adversaire d'avant même quand il a lui aussi quitté la manche", async () => {
    // Les deux places ont changé : C (109) et D (110) y sont désormais.
    await mockWithdrawnDb([{ ...CURRENT, team2_id: 110 }]);
    await announceEntrantsWithdrawn([DEPARTED]);
    const [message] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(message).toContain("**Les Renards** contre **Team Nova**");
    expect(message).not.toMatch(/Orion/);
  });

  it("prévient l'engagée d'une manche supprimée, avec un lien vers la page du tournoi", async () => {
    await mockWithdrawnDb([]);
    expect(await announceEntrantsWithdrawn([DEPARTED])).toBe(1);
    expect(jest.mocked(pushDiscordDirectMessages).mock.calls[0][0]).toContain("Coupe BlueGenji · Manche 2");
    const content = jest.mocked(pushToUsers).mock.calls[0][2];
    // L'ancre de la rencontre n'existe plus ; l'étiquette remplace toujours l'annonce.
    expect(resolvePush(content).url).toBe("/tournois/7");
    expect(resolvePush(content, "en").url).toBe("/en/tournois/7");
    expect(resolvePush(content).tag).toBe("rencontre-31-reminder");
  });

  it("ne dit que « Horaire du match retiré » à l'engagée reposée contre le même adversaire dans la même manche", async () => {
    // Ronde réappariée : la manche 31 a disparu, Les Renards retrouvent Team Nova sur la 45, sans horaire.
    await mockWithdrawnDb([{ ...CURRENT, id: 45, team1_id: 102, team2_id: 101, start_at: null }]);
    expect(await announceEntrantsWithdrawn([DEPARTED])).toBe(1);
    const [message, , context] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(context).toBe("match-schedule-cleared");
    expect(message).toContain("**Horaire du match retiré**");
    expect(message).not.toContain("ne joues plus");
    const content = jest.mocked(pushToUsers).mock.calls[0][2];
    expect(resolvePush(content).title).toBe("Horaire du match retiré");
    // Lien vers la nouvelle rencontre, étiquette de l'ancienne.
    expect(resolvePush(content).url).toBe("/tournois/7#match-45");
    expect(resolvePush(content).tag).toBe("rencontre-31-reminder");
  });

  it("se tait quand la nouvelle rencontre tient le même horaire", async () => {
    await mockWithdrawnDb([{ ...CURRENT, id: 45, team1_id: 101, team2_id: 102, start_at: "2026-09-10 18:00:00" }]);
    expect(await announceEntrantsWithdrawn([{ ...DEPARTED, heldStartAt: "2026-09-10 18:00:00" }])).toBe(0);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("retire l'horaire reçu quand la nouvelle rencontre en a un autre (son annonce suivra)", async () => {
    await mockWithdrawnDb([{ ...CURRENT, id: 45, team1_id: 101, team2_id: 102, start_at: new Date("2026-09-12T18:00:00Z") }]);
    expect(await announceEntrantsWithdrawn([DEPARTED])).toBe(1);
    expect(jest.mocked(pushDiscordDirectMessages).mock.calls[0][2]).toBe("match-schedule-cleared");
  });

  it("se tait dans un tournoi sans horaires d'arbitrage dont la nouvelle rencontre n'a pas d'horaire", async () => {
    await mockWithdrawnDb([{ ...CURRENT, id: 45, team1_id: 101, team2_id: 102, start_at: null }]);
    expect(await announceEntrantsWithdrawn([{ ...DEPARTED, match: { ...MATCH, refereeScheduling: false } }])).toBe(0);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("dit « Match retiré » quand l'engagée est reposée contre un autre adversaire, ou dans une autre manche", async () => {
    for (const current of [
      { ...CURRENT, id: 45, team1_id: 101, team2_id: 110, start_at: null },
      { ...CURRENT, id: 45, round_number: 3, team1_id: 101, team2_id: 102, start_at: null },
      { ...CURRENT, id: 45, phase_id: 2, team1_id: 101, team2_id: 102, start_at: null },
    ]) {
      jest.mocked(pushDiscordDirectMessages).mockClear();
      await mockWithdrawnDb([current]);
      await announceEntrantsWithdrawn([DEPARTED]);
      expect(jest.mocked(pushDiscordDirectMessages).mock.calls[0][2]).toBe("match-withdrawn");
    }
  });

  it("ne nomme aucun joueur en tournoi individuel", async () => {
    await mockWithdrawnDb(
      [{ ...CURRENT, team1_id: 103 }],
      [
        { id: 101, name: "Kiro" },
        { id: 102, name: "Nova" },
      ],
    );

    await announceEntrantsWithdrawn([{ ...DEPARTED, match: { ...MATCH, solo: true } }]);

    const [message] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(message).toContain("**Ton match**");
    expect(message).not.toMatch(/Kiro|Nova|Orion/);
    for (const locale of ["fr", "en"] as const) {
      const { title, body } = resolvePush(jest.mocked(pushToUsers).mock.calls[0][2], locale);
      expect(`${title} ${body}`).not.toMatch(/Kiro|Nova|Orion/);
    }
  });

  it("dit « Ronde N » en ronde suisse, et « TBD » sans adversaire", async () => {
    const query = await mockWithdrawnDb([CURRENT], [{ id: 101, name: "Les Renards" }]);
    await announceEntrantsWithdrawn([{ ...DEPARTED, opponentId: null, match: { ...MATCH, swiss: true } }]);
    expect((query.mock.calls[1] as unknown as [string, unknown[]])[1]).toEqual([101]);
    const [message] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(message).toContain("Coupe BlueGenji · Ronde 2");
    expect(message).toContain("**Les Renards** contre **TBD**");
    expect(resolvePush(jest.mocked(pushToUsers).mock.calls[0][2], "en").body).toContain("Round 2");
  });

  it("ne prévient pas une engagée revenue sur la manche (seconde correction)", async () => {
    const query = await mockWithdrawnDb([{ ...CURRENT, team1_id: 101 }]);
    expect(await announceEntrantsWithdrawn([DEPARTED])).toBe(0);
    // Ni destinataires lus, ni message.
    expect(query).toHaveBeenCalledTimes(2);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("ne fait rien sans avis, pour une engagée disparue ou sans joueur à prévenir", async () => {
    expect(await announceEntrantsWithdrawn([])).toBe(0);
    await mockWithdrawnDb([CURRENT], []);
    expect(await announceEntrantsWithdrawn([DEPARTED])).toBe(0);
    await mockWithdrawnDb([CURRENT], NAMES, []);
    expect(await announceEntrantsWithdrawn([DEPARTED])).toBe(0);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    expect(pushToUsers).not.toHaveBeenCalled();
  });
});

describe("dispatchDueMatchReminders — rappel de check-in (10 h)", () => {
  const INVITE = "https://discord.gg/Sgdh3p4VhC";

  it("envoie le rappel 10 h avec le lien du check-in, les 24 h déjà parties", async () => {
    const { execute } = await mockDb({ sent: [...SEEN, { match_id: 31, offset_key: "P1D" }] });

    expect(await dispatchDueMatchReminders(FIVE_HOURS_BEFORE)).toBe(2);

    expect(claimedKeys(execute)).toEqual(["PT10H", "TOLD"]);
    for (const message of sentMessages()) {
      expect(message).toContain("**Rappel de match — dans moins de 10 heures**");
      expect(message).toContain("le salon de check-in ouvre 15 minutes avant le coup d'envoi");
      expect(message).toContain(INVITE);
    }
    const [, topic, content] = jest.mocked(pushToUsers).mock.calls[0];
    expect(topic).toBe("MATCH_REMINDER");
    expect(resolvePush(content).title).toBe("Match dans moins de 10 heures");
    expect(resolvePush(content).body).toContain(`Check-in sur Discord 15 min avant le match : ${INVITE}`);
    expect(resolvePush(content, "en").title).toBe("Match in less than 10 hours");
    expect(resolvePush(content, "en").body).toContain(`Check-in on Discord 15 min before the match: ${INVITE}`);
  });

  it("garde le rappel 24 h sans lien de check-in", async () => {
    await mockDb({});

    await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE);

    for (const message of sentMessages()) {
      expect(message).toContain("dans moins de 24 heures");
      expect(message).not.toContain(INVITE);
    }
    expect(resolvePush(jest.mocked(pushToUsers).mock.calls[0][2]).body).not.toContain(INVITE);
  });

  it("ne nomme aucun joueur d'un tournoi individuel dans le rappel 10 h", async () => {
    await mockDb({
      matches: [{ ...MATCH, participant_type: "SOLO", team1_name: "Kiro", team2_name: "Nova" }],
      sent: [...SEEN, { match_id: 31, offset_key: "P1D" }],
    });

    await dispatchDueMatchReminders(FIVE_HOURS_BEFORE);

    for (const message of sentMessages()) {
      expect(message).toContain("**Ton match**");
      expect(message).not.toMatch(/Kiro|Nova/);
      expect(message).toContain(INVITE);
    }
    expect(resolvePush(jest.mocked(pushToUsers).mock.calls[0][2]).body).not.toMatch(/Kiro|Nova/);
  });

  it("une manche découverte moins de 10 h avant reçoit le check-in dans son annonce", async () => {
    const { execute } = await mockDb({ sent: [] });

    await dispatchDueMatchReminders(FIVE_HOURS_BEFORE);

    expect(claimedKeys(execute)).toEqual(["SEEN", "P1D", "PT10H", "TOLD"]);
    for (const message of sentMessages()) {
      expect(message).toContain("**Match programmé**");
      expect(message).toContain(INVITE);
    }
    expect(resolvePush(jest.mocked(pushToUsers).mock.calls[0][2]).body).toContain(INVITE);
  });

  it("une manche découverte à vingt heures annonce le rappel 10 h, sans lien encore", async () => {
    const { execute } = await mockDb({ sent: [] });

    await dispatchDueMatchReminders(new Date("2026-09-09T22:00:00Z"));

    expect(claimedKeys(execute)).toEqual(["SEEN", "P1D", "TOLD"]);
    for (const message of sentMessages()) {
      expect(message).toContain("Prochain rappel : 10 heures avant le coup d'envoi.");
      expect(message).not.toContain(INVITE);
    }
  });

  /** Bot lent : les messages privés ne reviennent qu'à l'appel de la fonction rendue. */
  function holdDirectMessages(): () => void {
    let release: () => void = () => undefined;
    const slowBot = new Promise<void>((resolve) => {
      release = resolve;
    });
    jest.mocked(pushDiscordDirectMessages).mockImplementation(async () => {
      await slowBot;
      return { sent: 0, unresolved: [], failed: [] };
    });
    return () => release();
  }

  it("lance le programme d'arbitrage au même balayage, sans que son échec retienne les rappels", async () => {
    const { dispatchRefereeDigest } = await import("@/lib/server/tournaments/referee-digest");
    jest.mocked(dispatchRefereeDigest).mockRejectedValue(new Error("bot"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await mockDb({ sent: [...SEEN, { match_id: 31, offset_key: "P1D" }] });

    expect(await dispatchDueMatchReminders(FIVE_HOURS_BEFORE)).toBe(2);

    expect(dispatchRefereeDigest).toHaveBeenCalledWith(FIVE_HOURS_BEFORE);
    expect(error).toHaveBeenCalledWith("[match-reminders] programme d'arbitrage en échec", expect.any(Error));
  });

  it("lance le programme d'arbitrage de front : il n'attend pas les envois aux joueurs", async () => {
    const { dispatchRefereeDigest } = await import("@/lib/server/tournaments/referee-digest");
    jest.mocked(dispatchRefereeDigest).mockResolvedValue(0);
    await mockDb({ sent: [...SEEN, { match_id: 31, offset_key: "P1D" }] });
    // Un bot lent : les messages privés ne reviennent qu'au signal.
    const release = holdDirectMessages();

    const sweep = dispatchDueMatchReminders(FIVE_HOURS_BEFORE);
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(dispatchRefereeDigest).toHaveBeenCalledWith(FIVE_HOURS_BEFORE);
    release();
    await sweep;
  });

  it("ne retient pas le balayage sur le programme : son propre verrou, un seul à la fois", async () => {
    const { dispatchRefereeDigest } = await import("@/lib/server/tournaments/referee-digest");
    // Les appareils du staff tardent : le programme ne revient qu'au signal.
    let release: ((count: number) => void) | undefined;
    jest.mocked(dispatchRefereeDigest).mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          release = resolve;
        }),
    );
    await mockDb({ sent: [...SEEN, { match_id: 31, offset_key: "P1D" }] });

    // Le balayage des joueurs rend la main sans attendre le programme.
    expect(await dispatchDueMatchReminders(FIVE_HOURS_BEFORE)).toBe(2);
    expect(pendingRefereeDigest()).not.toBeNull();

    // Balayage suivant, programme toujours en cours : pas de second programme.
    await mockDb({ sent: [...SEEN, { match_id: 31, offset_key: "P1D" }, { match_id: 31, offset_key: "PT10H" }] });
    const later = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    await dispatchDueMatchReminders(FIVE_HOURS_BEFORE);
    later.mockRestore();
    expect(dispatchRefereeDigest).toHaveBeenCalledTimes(1);

    release?.(0);
    await pendingRefereeDigest();
    expect(pendingRefereeDigest()).toBeNull();
  });

  it("lance le programme même pendant un balayage long, sous son propre étranglement", async () => {
    const { dispatchRefereeDigest } = await import("@/lib/server/tournaments/referee-digest");
    jest.mocked(dispatchRefereeDigest).mockResolvedValue(0);
    await mockDb({ sent: [...SEEN, { match_id: 31, offset_key: "P1D" }] });
    // Le balayage des joueurs reste pendu sur le bot.
    const release = holdDirectMessages();
    const sweep = dispatchDueMatchReminders(FIVE_HOURS_BEFORE);
    await pendingRefereeDigest();
    expect(dispatchRefereeDigest).toHaveBeenCalledTimes(1);

    // Dans la minute : étranglé, même si le balayage tient encore son verrou.
    void dispatchDueMatchReminders(FIVE_HOURS_BEFORE);
    expect(dispatchRefereeDigest).toHaveBeenCalledTimes(1);

    // Une minute plus tard, balayage toujours en cours : le programme repart.
    const later = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    void dispatchDueMatchReminders(FIVE_HOURS_BEFORE);
    later.mockRestore();
    expect(dispatchRefereeDigest).toHaveBeenCalledTimes(2);

    await pendingRefereeDigest();
    release();
    await sweep;
  });

  it("tait l'absence de table au programme d'arbitrage, comme au balayage", async () => {
    const { dispatchRefereeDigest } = await import("@/lib/server/tournaments/referee-digest");
    jest.mocked(dispatchRefereeDigest).mockRejectedValue(Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE" }));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await mockDb({ sent: [...SEEN, { match_id: 31, offset_key: "P1D" }] });

    await dispatchDueMatchReminders(FIVE_HOURS_BEFORE);

    expect(error).not.toHaveBeenCalledWith("[match-reminders] programme d'arbitrage en échec", expect.anything());
  });
});

describe("messages privés de match coupés par le joueur (droit d'opposition)", () => {
  const OPTED_OUT = (ids: number[]) =>
    RECIPIENTS.map((r) => (ids.includes(r.id) ? { ...r, match_dm_enabled: 0 } : r));

  it("lit le réglage avec les comptes destinataires", async () => {
    const { query } = await mockDb({});
    await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE);
    expect((query.mock.calls[2] as unknown as [string])[0]).toMatch(/match_dm_enabled/);
  });

  it("rappel : le joueur opposé n'a pas de message privé, son coéquipier si, et le push part à tous", async () => {
    await mockDb({ recipients: OPTED_OUT([2]) });
    expect(await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE)).toBe(2);
    const calls = jest.mocked(pushDiscordDirectMessages).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][2]).toBe("match-reminder");
    expect((calls[0][1] as { label: string }[]).map((r) => r.label)).toEqual(["Kiro"]);
    expect((calls[1][1] as { label: string }[]).map((r) => r.label)).toEqual(["Nova"]);
    expect(jest.mocked(pushToUsers).mock.calls.map((call) => call[0])).toEqual([[1, 2], [3]]);
  });

  it("toute une engagée opposée : aucun appel au bot pour elle, ses appareils restent prévenus", async () => {
    await mockDb({ recipients: OPTED_OUT([3]) });
    await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE);
    const calls = jest.mocked(pushDiscordDirectMessages).mock.calls;
    expect(calls).toHaveLength(1);
    expect((calls[0][1] as { label: string }[]).map((r) => r.label)).toEqual(["Kiro", "Ayla"]);
    expect(jest.mocked(pushToUsers).mock.calls.map((call) => call[0])).toEqual([[1, 2], [3]]);
  });

  it("opposé et sans appareil abonné : plus un destinataire du tout", async () => {
    jest.mocked(usersReachableByPush).mockImplementation(async (ids) => new Set(ids.filter((id) => id !== 3)));
    await mockDb({ recipients: OPTED_OUT([3]) });
    expect(await dispatchDueMatchReminders(TWELVE_HOURS_BEFORE)).toBe(1);
    expect(jest.mocked(pushToUsers).mock.calls.map((call) => call[0])).toEqual([[1, 2]]);
  });

  it("annonce d'horaire posé par l'arbitrage : même règle", async () => {
    const recipients = OPTED_OUT([1, 2]);
    const query = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce([recipients.map((r) => ({ team_id: r.team_id, user_id: r.id }))])
      .mockResolvedValueOnce([recipients.map((r) => ({ ...r, discord_verified_at: certifiedAt(r) }))]);
    const { getDatabase } = await import("@/lib/server/database");
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query, execute: executeDouble({}) }));
    expect(await announceMatchSchedule(notice(), { rescheduled: false }, TEN_DAYS_BEFORE)).toBe(2);
    expect(jest.mocked(pushDiscordDirectMessages).mock.calls[0][2]).toBe("match-scheduled");
    const calls = jest.mocked(pushDiscordDirectMessages).mock.calls;
    expect(calls.every((call) => (call[1] as { label: string }[]).every((r) => r.label === "Nova"))).toBe(true);
    expect(jest.mocked(pushToUsers).mock.calls.map((call) => call[0])).toContainEqual([1, 2]);
  });
});
