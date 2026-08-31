import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");

import {
  dispatchDueMatchReminders,
  resetMatchReminderThrottle,
} from "@/lib/server/tournaments/match-reminders";
import { pushDiscordDirectMessages } from "@/lib/server/bot-integration";

const START = new Date("2026-09-10T18:00:00Z");
const ONE_HOUR_BEFORE = new Date("2026-09-10T17:00:00Z");
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

const RECIPIENTS = [
  { team_id: 101, pseudo: "Kiro", discord_id: "555000111", discord_pseudo: "kiro" },
  { team_id: 101, pseudo: "Ayla", discord_id: null, discord_pseudo: "ayla_bg" },
  { team_id: 102, pseudo: "Nova", discord_id: null, discord_pseudo: "nova" },
];

/** La manche a déjà été observée : le cycle normal des paliers s'applique. */
const SEEN = [{ match_id: 31, offset_key: "SEEN" }];

/**
 * Câble la base : `query` sert les trois lectures (matchs, clés déjà posées,
 * destinataires), `execute` les réservations.
 */
async function mockDb(options: {
  matches?: unknown[];
  sent?: unknown[];
  recipients?: unknown[];
  claimed?: boolean;
}) {
  const query = jest
    .fn<() => Promise<unknown>>()
    .mockResolvedValueOnce([options.matches ?? [MATCH]])
    .mockResolvedValueOnce([options.sent ?? SEEN])
    .mockResolvedValueOnce([options.recipients ?? RECIPIENTS]);
  const execute = jest
    .fn<() => Promise<unknown>>()
    .mockResolvedValue([{ affectedRows: options.claimed === false ? 0 : 1 }]);

  const { getDatabase } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({ query, execute });
  return { query, execute };
}

/** Clés réservées, dans l'ordre, pour une manche donnée. */
function claimedKeys(execute: jest.Mock): string[] {
  return execute.mock.calls.map((call) => (call as [string, unknown[]])[1][1] as string);
}

function sentMessages(): string[] {
  return (pushDiscordDirectMessages as jest.Mock).mock.calls.map(
    (call) => (call as [string])[0],
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  resetMatchReminderThrottle();
  (pushDiscordDirectMessages as jest.Mock).mockResolvedValue({
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

    const [messageA, recipientsA, context] = (pushDiscordDirectMessages as jest.Mock).mock
      .calls[0] as [string, { label: string }[], string];
    expect(context).toBe("match-reminder");
    expect(messageA).toContain("**Les Renards** contre **Team Nova**");
    expect(recipientsA.map((r) => r.label)).toEqual(["Kiro", "Ayla"]);

    const [messageB, recipientsB] = (pushDiscordDirectMessages as jest.Mock).mock.calls[1] as [
      string,
      { label: string }[],
    ];
    expect(messageB).toContain("**Team Nova** contre **Les Renards**");
    expect(recipientsB.map((r) => r.label)).toEqual(["Nova"]);
  });

  it("réserve le palier avant d'envoyer", async () => {
    const { execute } = await mockDb({});

    await dispatchDueMatchReminders(ONE_HOUR_BEFORE);

    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/INSERT IGNORE INTO bg_match_reminders/);
    expect(params).toEqual([31, "PT1H"]);
  });

  it("n'envoie rien quand une autre requête a déjà pris le palier", async () => {
    await mockDb({ claimed: false });

    expect(await dispatchDueMatchReminders(ONE_HOUR_BEFORE)).toBe(0);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("saute un palier déjà envoyé sans même le réserver", async () => {
    const { execute } = await mockDb({
      sent: [...SEEN, { match_id: 31, offset_key: "PT1H" }],
    });

    expect(await dispatchDueMatchReminders(ONE_HOUR_BEFORE)).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it("ne fait rien quand aucune manche n'est dans l'horizon", async () => {
    await mockDb({ matches: [] });

    expect(await dispatchDueMatchReminders(ONE_HOUR_BEFORE)).toBe(0);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("écarte un joueur sans identité Discord", async () => {
    await mockDb({
      recipients: [
        { team_id: 101, pseudo: "Kiro", discord_id: null, discord_pseudo: null },
        { team_id: 102, pseudo: "Nova", discord_id: null, discord_pseudo: "nova" },
      ],
    });

    // Une seule engagée reste joignable : un seul envoi.
    expect(await dispatchDueMatchReminders(ONE_HOUR_BEFORE)).toBe(1);
    const [, recipients] = (pushDiscordDirectMessages as jest.Mock).mock.calls[0] as [
      string,
      { label: string }[],
    ];
    expect(recipients.map((r) => r.label)).toEqual(["Nova"]);
  });

  it("ne borne le calendrier qu'aux manches programmées et non jouées", async () => {
    const { query } = await mockDb({});

    await dispatchDueMatchReminders(ONE_HOUR_BEFORE);

    const [sql] = query.mock.calls[0] as [string];
    expect(sql).toMatch(/m\.start_at > NOW\(\)/);
    expect(sql).toMatch(/DATE_ADD\(NOW\(\), INTERVAL 7 DAY\)/);
    expect(sql).toMatch(/m\.status <> 'COMPLETED'/);
    // Jointure interne sur les deux engagées : un bye n'est pas un match.
    expect(sql).toMatch(/JOIN bg_teams t1/);
    expect(sql).toMatch(/JOIN bg_teams t2/);
  });

  it("s'étrangle : un second passage immédiat ne relit pas la base", async () => {
    await mockDb({});
    await dispatchDueMatchReminders(ONE_HOUR_BEFORE);
    (pushDiscordDirectMessages as jest.Mock).mockClear();

    expect(await dispatchDueMatchReminders(ONE_HOUR_BEFORE)).toBe(0);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });
});

describe("dispatchDueMatchReminders — date posée tardivement", () => {
  it("annonce la date au lieu d'un « dans une semaine » mensonger", async () => {
    // Manche découverte à J-3 : la fenêtre du palier « une semaine » est ouverte,
    // mais ce qu'il annoncerait est faux.
    await mockDb({ sent: [] });

    expect(await dispatchDueMatchReminders(THREE_DAYS_BEFORE)).toBe(2);

    const [, , context] = (pushDiscordDirectMessages as jest.Mock).mock.calls[0] as [
      string,
      unknown,
      string,
    ];
    expect(context).toBe("match-scheduled");
    for (const message of sentMessages()) {
      expect(message).toContain("**Match programmé**");
      expect(message).not.toContain("dans une semaine");
      expect(message).toContain("Prochain rappel : 24 heures");
    }
  });

  it("consomme les paliers dépassés en même temps qu'elle annonce", async () => {
    const { execute } = await mockDb({ sent: [] });

    await dispatchDueMatchReminders(THREE_DAYS_BEFORE);

    // La marque d'observation d'abord — c'est elle qui fait verrou —, puis le
    // seul palier déjà ouvert. Les deux autres restent devant.
    expect(claimedKeys(execute)).toEqual(["SEEN", "P7D"]);
  });

  it("consomme tous les paliers pour une date posée à moins d'une heure", async () => {
    const { execute } = await mockDb({ sent: [] });

    expect(await dispatchDueMatchReminders(new Date("2026-09-10T17:30:00Z"))).toBe(2);

    expect(claimedKeys(execute)).toEqual(["SEEN", "P7D", "P1D", "PT1H"]);
    for (const message of sentMessages()) {
      expect(message).toContain("**Match programmé**");
      expect(message).not.toContain("Prochain rappel");
    }
  });

  it("n'annonce rien pour une manche encore hors de tout palier", async () => {
    const { execute } = await mockDb({ sent: [] });

    expect(await dispatchDueMatchReminders(TEN_DAYS_BEFORE)).toBe(0);
    // Seule la marque d'observation est posée : les paliers courent normalement.
    expect(claimedKeys(execute)).toEqual(["SEEN"]);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("laisse la manche au passage suivant si une autre requête l'observe d'abord", async () => {
    const { execute } = await mockDb({ sent: [], claimed: false });

    expect(await dispatchDueMatchReminders(THREE_DAYS_BEFORE)).toBe(0);
    expect(claimedKeys(execute)).toEqual(["SEEN"]);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });
});
