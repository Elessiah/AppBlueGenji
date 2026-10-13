import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/push-subscriptions");

import {
  announceMatchSchedule,
  announceMatchScheduleCleared,
  dispatchDueMatchReminders,
  resetMatchReminderThrottle,
} from "@/lib/server/tournaments/match-reminders";
import { pushDiscordDirectMessages } from "@/lib/server/bot-integration";
import { pushToUsers } from "@/lib/server/push-subscriptions";
import { type SqlMock, fakePool } from "../../helpers/sql-double";
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
 * Câble la base : `query` sert les quatre lectures (matchs, clés déjà posées,
 * joueurs des engagées, comptes), `execute` les réservations.
 */
async function mockDb(options: {
  matches?: unknown[];
  sent?: unknown[];
  recipients?: Recipient[];
  claimed?: boolean;
}) {
  const recipients = options.recipients ?? RECIPIENTS;
  const query = jest
    .fn<() => Promise<unknown>>()
    .mockResolvedValueOnce([options.matches ?? [MATCH]])
    .mockResolvedValueOnce([options.sent ?? SEEN])
    .mockResolvedValueOnce([recipients.map((r) => ({ team_id: r.team_id, user_id: r.id }))])
    .mockResolvedValueOnce([recipients.map((r) => ({ ...r, discord_verified_at: null }))]);
  const execute = jest
    .fn<() => Promise<unknown>>()
    .mockResolvedValue([{ affectedRows: options.claimed === false ? 0 : 1 }]);

  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ query, execute }));
  return { query, execute };
}

/** Clés réservées, dans l'ordre, pour une manche donnée. */
function claimedKeys(execute: SqlMock): string[] {
  return execute.mock.calls.map((call) => (call as [string, unknown[]])[1][1] as string);
}

function sentMessages(): string[] {
  return jest.mocked(pushDiscordDirectMessages).mock.calls.map(
    (call) => call[0],
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  resetMatchReminderThrottle();
  jest.mocked(pushToUsers).mockResolvedValue(0);
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
    expect(params).toEqual([31, "P1D"]);
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
    expect(resolvePush(content).title).toBe("Match dans 24 heures");
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
    expect(params).toEqual([2 * 24 * 60 * 60]);
    expect(sql).toMatch(/m\.status <> 'COMPLETED'/);
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

  it("n'annonce rien pour une manche encore hors de tout palier", async () => {
    const { execute } = await mockDb({ sent: [] });

    expect(await dispatchDueMatchReminders(TEN_DAYS_BEFORE)).toBe(0);
    // Seule la marque d'observation est posée : les paliers courent normalement.
    expect(claimedKeys(execute)).toEqual(["SEEN"]);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("laisse la manche au passage suivant si une autre requête l'observe d'abord", async () => {
    const { execute } = await mockDb({ sent: [], claimed: false });

    expect(await dispatchDueMatchReminders(FIVE_HOURS_BEFORE)).toBe(0);
    expect(claimedKeys(execute)).toEqual(["SEEN"]);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });
});

describe("announceMatchSchedule — horaire posé ou changé par l'arbitrage", () => {
  /** `query` : la manche, les joueurs des engagées, les comptes ; `execute` : les réservations. */
  async function mockAnnounceDb(options: { matches?: unknown[]; claimed?: boolean; recipients?: Recipient[] } = {}) {
    const recipients = options.recipients ?? RECIPIENTS;
    const query = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce([options.matches ?? [MATCH]])
      .mockResolvedValueOnce([recipients.map((r) => ({ team_id: r.team_id, user_id: r.id }))])
      .mockResolvedValueOnce([recipients.map((r) => ({ ...r, discord_verified_at: null }))]);
    const execute = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValue([{ affectedRows: options.claimed === false ? 0 : 1 }]);
    const { getDatabase } = await import("@/lib/server/database");
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query, execute }));
    return { query, execute };
  }

  it("annonce tout de suite une date posée au-delà de la fenêtre du balayage", async () => {
    const { query, execute } = await mockAnnounceDb();

    expect(await announceMatchSchedule(31, { rescheduled: false }, TEN_DAYS_BEFORE)).toBe(2);

    // La manche est lue par son numéro, sans borne de fenêtre.
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/m\.id = \?/);
    expect(sql).not.toMatch(/DATE_ADD/);
    expect(params).toEqual([31]);
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
      await announceMatchSchedule(31, { rescheduled: true, previousStartAt: "2026-09-08T18:00:00Z" }, FIVE_HOURS_BEFORE),
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

  it("prévient le joueur d'une entrée solo sans nommer personne, ni en push ni sur Discord", async () => {
    await mockAnnounceDb({
      matches: [{ ...MATCH, participant_type: "SOLO", team1_name: "Kiro", team2_name: "Nova" }],
      recipients: [
        { team_id: 101, id: 1, pseudo: "Kiro", discord_id: "555000111", discord_pseudo: "kiro" },
        { team_id: 102, id: 3, pseudo: "Nova", discord_id: "555000333", discord_pseudo: "nova" },
      ],
    });

    expect(await announceMatchSchedule(31, { rescheduled: false }, THREE_DAYS_BEFORE)).toBe(2);

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
    const { execute } = await mockAnnounceDb({ matches: [] });

    expect(await announceMatchSchedule(31, { rescheduled: false }, THREE_DAYS_BEFORE)).toBe(0);
    expect(execute).not.toHaveBeenCalled();
    expect(pushToUsers).not.toHaveBeenCalled();
  });

  it("se tait si un balayage concurrent a déjà envoyé le rappel ouvert, qui porte la nouvelle date", async () => {
    const { execute } = await mockAnnounceDb({ claimed: false });

    expect(await announceMatchSchedule(31, { rescheduled: true }, FIVE_HOURS_BEFORE)).toBe(0);
    expect(claimedKeys(execute)).toEqual(["P1D"]);
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    expect(pushToUsers).not.toHaveBeenCalled();
  });

  it("ne réserve pas la marque d'observation : `setMatchStartAt` l'a posée", async () => {
    const { execute } = await mockAnnounceDb();
    await announceMatchSchedule(31, { rescheduled: false }, THREE_DAYS_BEFORE);
    expect(claimedKeys(execute)).not.toContain("SEEN");
  });
});

describe("announceMatchScheduleCleared — horaire retiré par l'arbitrage", () => {
  async function mockClearedDb(options: { matches?: unknown[]; recipients?: Recipient[] } = {}) {
    const recipients = options.recipients ?? RECIPIENTS;
    const query = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce([options.matches ?? [{ ...MATCH, start_at: null }]])
      .mockResolvedValueOnce([recipients.map((r) => ({ team_id: r.team_id, user_id: r.id }))])
      .mockResolvedValueOnce([recipients.map((r) => ({ ...r, discord_verified_at: null }))]);
    const execute = jest.fn<() => Promise<unknown>>().mockResolvedValue([{ affectedRows: 1 }]);
    const { getDatabase } = await import("@/lib/server/database");
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query, execute }));
    return { query, execute };
  }

  it("prévient les deux engagées, par Discord et par push, dans la langue de chacun", async () => {
    const { query, execute } = await mockClearedDb();

    expect(await announceMatchScheduleCleared(31, "2026-09-10T18:00:00.000Z")).toBe(2);

    // La manche se lit sans horaire : il vient d'être effacé.
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).not.toMatch(/start_at IS NOT NULL/);
    expect(sql).toMatch(/m\.status <> 'COMPLETED'/);
    expect(params).toEqual([31]);
    // Les marques restent : aucune écriture.
    expect(execute).not.toHaveBeenCalled();

    const calls = jest.mocked(pushDiscordDirectMessages).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][2]).toBe("match-scheduled");
    expect(calls[0][0]).toContain("**Horaire du match retiré**");
    expect(calls[0][0]).toContain("**Les Renards** contre **Team Nova**");
    expect(calls[0][0]).toContain("jeudi 10 septembre à 20:00 (heure de Paris) est retiré");

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
      matches: [{ ...MATCH, start_at: null, participant_type: "SOLO", team1_name: "Kiro", team2_name: "Nova" }],
      recipients: [
        { team_id: 101, id: 1, pseudo: "Kiro", discord_id: "555000111", discord_pseudo: "kiro" },
        { team_id: 102, id: 3, pseudo: "Nova", discord_id: "555000333", discord_pseudo: "nova" },
      ],
    });

    expect(await announceMatchScheduleCleared(31, "2026-09-10T18:00:00.000Z")).toBe(2);

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

  it("ne fait rien pour une manche jouée ou sans ses deux engagées", async () => {
    await mockClearedDb({ matches: [] });
    expect(await announceMatchScheduleCleared(31, "2026-09-10T18:00:00.000Z")).toBe(0);
    expect(pushToUsers).not.toHaveBeenCalled();
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });
});
