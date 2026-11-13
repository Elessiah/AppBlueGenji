import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/notify");
jest.mock("@/lib/server/site-url", () => ({ siteCanonicalBase: () => "https://site.test" }));

import { getDatabase } from "@/lib/server/database";
import { sendBotLog } from "@/lib/server/bot-integration";
import { loadNotificationRecipients, notifyUsers } from "@/lib/server/notify";
import {
  announceObjectionReleases,
  announceRefereeChange,
  deliverRefereeChange,
  discardRefereeChanges,
  flushRefereeChanges,
  queueRefereeChange,
  refereeLogChange,
  refereeLogCategory,
  refereeReleaseNotice,
  announceRefereeChanges,
  type RefereeChange,
} from "@/lib/server/tournaments/referee-notices";
import { discardBotLogs, flushBotLogs } from "@/lib/server/tournaments/bot-logs";
import type { RefereeLogChange } from "@/lib/shared/bot-logs";
import type { RefereeReleaseReason } from "@/lib/shared/push-messages";
import { fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";
import { resolvePush } from "../../helpers/push";

/**
 * Avis d'arbitrage (`lib/server/tournaments/referee-notices.ts`,
 * `docs/features/MATCH_REFEREE.md`) : une ligne de journal anonyme, et un push
 * `REFEREE_RELEASED` — jamais de message privé — à l'arbitre qu'un autre retire.
 */

const REFEREE = 950;

function matchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    bracket: "UPPER",
    round_number: 2,
    swiss_round: 0,
    team1_name: "Renards",
    team2_name: "Nova",
    tournament_id: 7,
    tournament_name: "Coupe d'hiver",
    participant_type: "TEAM",
    ...overrides,
  };
}

function mockMatch(row: Record<string, unknown> | null) {
  const execute = jest.fn<SqlQuery>(async () => [row === null ? [] : [row], []]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

const RECIPIENT = { userId: REFEREE, discord: { discordId: "100000000000000009", handle: "arbitre", label: "ArbitrePseudo" } };
const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(sendBotLog).mockReturnValue(undefined);
  jest.mocked(loadNotificationRecipients).mockResolvedValue([RECIPIENT]);
  jest
    .mocked(notifyUsers)
    .mockResolvedValue({ discord: { sent: 0, unresolved: [], failed: [] }, discordUnreachedUserIds: [], pushed: 1 });
});

function loggedLine(category = "referees"): string {
  expect(sendBotLog).toHaveBeenCalledTimes(1);
  expect(jest.mocked(sendBotLog).mock.calls[0][1]).toMatchObject({ category });
  return jest.mocked(sendBotLog).mock.calls[0][0];
}

function notification() {
  expect(notifyUsers).toHaveBeenCalledTimes(1);
  return jest.mocked(notifyUsers).mock.calls[0][1];
}

describe("refereeLogChange / refereeReleaseNotice", () => {
  it.each<[RefereeChange, RefereeLogChange, { refereeId: number; reason: RefereeReleaseReason } | null]>([
    [{ kind: "TAKEN", matchId: 1 }, "TAKEN", null],
    [{ kind: "ASSIGNED", matchId: 1, replacedRefereeId: null }, "ASSIGNED", null],
    [{ kind: "ASSIGNED", matchId: 1, replacedRefereeId: 5 }, "SWAPPED", { refereeId: 5, reason: "REPLACED" }],
    [{ kind: "RELEASED", matchId: 1, refereeId: 5, byStaff: false }, "RELEASED", null],
    [{ kind: "RELEASED", matchId: 1, refereeId: 5, byStaff: true }, "RELEASED_BY_STAFF", { refereeId: 5, reason: "STAFF" }],
    [{ kind: "OBJECTION_RELEASED", matchId: 1, refereeId: 5 }, "RELEASED_BY_STAFF", { refereeId: 5, reason: "OBJECTION" }],
    [{ kind: "OBJECTION_RELEASED", matchId: 1, refereeId: 5, takenOver: true }, "INELIGIBLE", { refereeId: 5, reason: "OBJECTION" }],
    [{ kind: "AUTO_RELEASED", matchId: 1, refereeId: 5, reason: "INELIGIBLE" }, "INELIGIBLE", { refereeId: 5, reason: "INELIGIBLE" }],
    [{ kind: "AUTO_RELEASED", matchId: 1, refereeId: 5, reason: "JOINED_TEAM" }, "JOINED_TEAM", { refereeId: 5, reason: "JOINED_TEAM" }],
    // Compte en suppression : ligne anonyme pour le staff, aucun avis au compte parti.
    [{ kind: "ACCOUNT_WITHDRAWN", matchId: 1 }, "ACCOUNT_WITHDRAWN", null],
    [{ kind: "SELF_MANAGED", matchId: 1, enabled: true, replacedRefereeId: null }, "SELF_MANAGED_ON", null],
    [{ kind: "SELF_MANAGED", matchId: 1, enabled: true, replacedRefereeId: 5 }, "SELF_MANAGED_ON", { refereeId: 5, reason: "SELF_MANAGED" }],
    [{ kind: "SELF_MANAGED", matchId: 1, enabled: false, replacedRefereeId: null }, "SELF_MANAGED_OFF", null],
    [{ kind: "FIRST_MAP", matchId: 1, set: true }, "FIRST_MAP_SET", null],
    [{ kind: "FIRST_MAP", matchId: 1, set: false }, "FIRST_MAP_CLEARED", null],
  ])("%j → journal %s", (change, log, notice) => {
    expect(refereeLogChange(change)).toBe(log);
    expect(refereeReleaseNotice(change)).toEqual(notice);
  });
});

describe("refereeLogCategory — un retrait alerte, le reste reste une trace", () => {
  it.each<[RefereeChange, string]>([
    [{ kind: "TAKEN", matchId: 1 }, "referees"],
    // Reprise d'un match retiré à un arbitre inéligible : suit son retrait, même catégorie.
    [{ kind: "TAKEN", matchId: 1, afterRemoval: true }, "staff-removal"],
    [{ kind: "ASSIGNED", matchId: 1, replacedRefereeId: null }, "referees"],
    // Remplacement : le créneau est repourvu dans la même transaction, simple trace.
    [{ kind: "ASSIGNED", matchId: 1, replacedRefereeId: 5 }, "referees"],
    [{ kind: "RELEASED", matchId: 1, refereeId: 5, byStaff: false }, "staff-removal"],
    [{ kind: "RELEASED", matchId: 1, refereeId: 5, byStaff: true }, "staff-removal"],
    [{ kind: "OBJECTION_RELEASED", matchId: 1, refereeId: 5 }, "staff-removal"],
    [{ kind: "AUTO_RELEASED", matchId: 1, refereeId: 5, reason: "INELIGIBLE" }, "staff-removal"],
    [{ kind: "AUTO_RELEASED", matchId: 1, refereeId: 5, reason: "JOINED_TEAM" }, "staff-removal"],
    [{ kind: "ACCOUNT_WITHDRAWN", matchId: 1 }, "staff-removal"],
    [{ kind: "SELF_MANAGED", matchId: 1, enabled: true, replacedRefereeId: null }, "referees"],
    [{ kind: "SELF_MANAGED", matchId: 1, enabled: true, replacedRefereeId: 5 }, "staff-removal"],
    [{ kind: "SELF_MANAGED", matchId: 1, enabled: false, replacedRefereeId: null }, "referees"],
    [{ kind: "FIRST_MAP", matchId: 1, set: true }, "referees"],
    [{ kind: "MAP_PICK", matchId: 1, set: true, byTeam: false }, "referees"],
  ])("%j → %s", (change, category) => {
    expect(refereeLogCategory(change)).toBe(category);
  });

  it("refereeLogCategory_unknownKind_throws", () => {
    // Une ligne venue d'ailleurs (version plus récente) : jamais classée en silence.
    const unknown = JSON.parse('{"kind":"UNKNOWN","matchId":1}') as RefereeChange;

    expect(() => refereeLogCategory(unknown)).toThrow("changement d'arbitrage inconnu");
  });

  it.each<[RefereeChange]>([
    [{ kind: "RELEASED", matchId: 42, refereeId: REFEREE, byStaff: false }],
    [{ kind: "RELEASED", matchId: 42, refereeId: REFEREE, byStaff: true }],
    [{ kind: "AUTO_RELEASED", matchId: 42, refereeId: REFEREE, reason: "INELIGIBLE" }],
    [{ kind: "SELF_MANAGED", matchId: 42, enabled: true, replacedRefereeId: REFEREE }],
  ])("deliverRefereeChange %j envoie la ligne dans staff-removal, sans nom", async (change) => {
    mockMatch(matchRow());
    await deliverRefereeChange(change);
    expect(loggedLine("staff-removal")).not.toContain("ArbitrePseudo");
  });

  it("deliverRefereeChange_assignmentWithoutReplacement_staysInReferees", async () => {
    mockMatch(matchRow());
    await deliverRefereeChange({ kind: "ASSIGNED", matchId: 42, replacedRefereeId: null });
    loggedLine("referees");
  });

  it("deliverRefereeChange_assignedReplacingHolder_logsInReferees", async () => {
    // Le créneau est repourvu dans la même transaction : trace, pas d'alerte ; le titulaire est prévenu.
    mockMatch(matchRow());

    await deliverRefereeChange({ kind: "ASSIGNED", matchId: 42, replacedRefereeId: REFEREE });

    loggedLine("referees");
    expect(loadNotificationRecipients).toHaveBeenCalledWith([REFEREE], "certified");
  });
});

describe("deliverRefereeChange", () => {
  it("n'écrit aucune ligne Discord pour un retrait sur opposition retenue, mais prévient l'arbitre", async () => {
    mockMatch(matchRow());
    await deliverRefereeChange({ kind: "OBJECTION_RELEASED", matchId: 42, refereeId: REFEREE });
    expect(sendBotLog).not.toHaveBeenCalled();
    expect(loadNotificationRecipients).toHaveBeenCalledWith([REFEREE], "certified");
    expect(notification().topic).toBe("REFEREE_RELEASED");
  });

  it("deliverRefereeChange_objectionTakenOver_postsGenericStaffRemovalLineAndNotifies", async () => {
    mockMatch(matchRow());

    await deliverRefereeChange({ kind: "OBJECTION_RELEASED", matchId: 42, refereeId: REFEREE, takenOver: true });

    const line = loggedLine("staff-removal");
    expect(line).not.toContain("ArbitrePseudo");
    expect(line.toLowerCase()).not.toContain("opposition");
    expect(notification().topic).toBe("REFEREE_RELEASED");
  });

  it("tait aussi la ligne d'un retrait sur opposition quand l'appelant demande `log: true`", async () => {
    mockMatch(matchRow());
    await deliverRefereeChange({ kind: "OBJECTION_RELEASED", matchId: 42, refereeId: REFEREE }, { log: true });
    expect(sendBotLog).not.toHaveBeenCalled();
    expect(notifyUsers).toHaveBeenCalledTimes(1);
  });

  it("journalise une prise de match sans nommer l'arbitre ni prévenir personne", async () => {
    mockMatch(matchRow());
    await deliverRefereeChange({ kind: "TAKEN", matchId: 42 });
    const line = loggedLine();
    expect(line).toContain("Arbitre désigné");
    expect(line).toContain("Renards vs Nova (#42)");
    expect(line).toContain("un arbitre prend le match");
    expect(notifyUsers).not.toHaveBeenCalled();
    expect(loadNotificationRecipients).not.toHaveBeenCalled();
  });

  it("prévient par push seul, avec le motif, l'arbitre retiré par le staff", async () => {
    mockMatch(matchRow());
    await deliverRefereeChange({ kind: "RELEASED", matchId: 42, refereeId: REFEREE, byStaff: true });
    const line = loggedLine("staff-removal");
    expect(line).toContain("Arbitre retiré");
    expect(line).toContain("le staff");
    expect(line).not.toContain("ArbitrePseudo");
    expect(loadNotificationRecipients).toHaveBeenCalledWith([REFEREE], "certified");
    const sent = notification();
    expect(sent.topic).toBe("REFEREE_RELEASED");
    expect(sent.discord).toBeUndefined();
    const fr = resolvePush(sent.push, "fr");
    expect(fr.title).toBe("Arbitrage retiré");
    expect(fr.body).toContain("décision du staff");
    expect(fr.body).toContain("Renards contre Nova");
    const en = resolvePush(sent.push, "en");
    expect(en.title).toBe("Refereeing removed");
    expect(en.body).toContain("staff decision");
  });

  it("autogestion d'une manche : `log: false` tait la ligne, l'avis à l'arbitre part", async () => {
    mockMatch(matchRow());
    await deliverRefereeChange({ kind: "SELF_MANAGED", matchId: 42, enabled: true, replacedRefereeId: REFEREE }, { log: false });
    expect(sendBotLog).not.toHaveBeenCalled();
    expect(resolvePush(notification().push, "fr").body).toContain("autogestion");
  });

  it("en tournoi individuel, aucun pseudo de joueur, ni au journal ni dans l'avis", async () => {
    mockMatch(matchRow({ participant_type: "SOLO", team1_name: "PseudoA", team2_name: "PseudoB" }));
    await deliverRefereeChange({ kind: "AUTO_RELEASED", matchId: 42, refereeId: REFEREE, reason: "JOINED_TEAM" });
    const sent = notification();
    for (const text of [loggedLine("staff-removal"), resolvePush(sent.push, "fr").body, resolvePush(sent.push, "en").body]) {
      expect(text).not.toContain("PseudoA");
      expect(text).not.toContain("PseudoB");
    }
  });

  it("se tait sur un match disparu", async () => {
    mockMatch(null);
    await deliverRefereeChange({ kind: "RELEASED", matchId: 42, refereeId: REFEREE, byStaff: true });
    expect(sendBotLog).not.toHaveBeenCalled();
    expect(notifyUsers).not.toHaveBeenCalled();
  });
});

describe("announceRefereeChange et file d'après commit", () => {
  it("ne lève jamais, même base indisponible", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(getDatabase).mockRejectedValue(new Error("DB_DOWN"));
    expect(() => announceRefereeChange({ kind: "TAKEN", matchId: 42 })).not.toThrow();
    await settle();
    expect(error).toHaveBeenCalledWith("[referee] changement d'arbitrage non annoncé", expect.any(Error));
    error.mockRestore();
  });

  it("annonce après le commit (direct ou par `flushBotLogs`), rien après un rollback", async () => {
    mockMatch(matchRow());
    const connection = fakeConnection({});
    queueRefereeChange(connection, { kind: "TAKEN", matchId: 42 });
    expect(sendBotLog).not.toHaveBeenCalled();
    flushRefereeChanges(connection);
    await settle();
    expect(sendBotLog).toHaveBeenCalledTimes(1);

    queueRefereeChange(connection, { kind: "TAKEN", matchId: 42 });
    flushBotLogs(connection);
    await settle();
    expect(sendBotLog).toHaveBeenCalledTimes(2);

    queueRefereeChange(connection, { kind: "TAKEN", matchId: 42 });
    discardBotLogs(connection);
    flushRefereeChanges(connection);
    queueRefereeChange(connection, { kind: "TAKEN", matchId: 42 });
    discardRefereeChanges(connection);
    flushRefereeChanges(connection);
    await settle();
    expect(sendBotLog).toHaveBeenCalledTimes(2);
  });
});

describe("avis à l'arbitre remplacé par lui-même, annonces d'une manche (EF-31)", () => {
  it("refereeReleaseNotice_assignedByReplacedReferee_returnsNull", () => {
    expect(refereeReleaseNotice({ kind: "ASSIGNED", matchId: 1, replacedRefereeId: 5, actorId: 5 })).toBeNull();
  });

  it("refereeReleaseNotice_assignedByOtherStaff_notifiesReplaced", () => {
    expect(refereeReleaseNotice({ kind: "ASSIGNED", matchId: 1, replacedRefereeId: 5, actorId: 6 })).toEqual({
      refereeId: 5,
      reason: "REPLACED",
    });
  });

  it("refereeReleaseNotice_selfManagedByReplacedReferee_returnsNull", () => {
    expect(
      refereeReleaseNotice({ kind: "SELF_MANAGED", matchId: 1, enabled: true, replacedRefereeId: 5, actorId: 5 }),
    ).toBeNull();
  });

  it("announceRefereeChanges_severalChanges_readsOneMatchAtATime", async () => {
    let inFlight = 0;
    let peak = 0;
    const execute = jest.fn<SqlQuery>(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await settle();
      inFlight -= 1;
      return [[matchRow()], []];
    });
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    announceRefereeChanges(
      [
        { kind: "SELF_MANAGED", matchId: 42, enabled: true, replacedRefereeId: REFEREE },
        { kind: "SELF_MANAGED", matchId: 43, enabled: true, replacedRefereeId: REFEREE },
      ],
      { log: false },
    );
    for (let tick = 0; tick < 10; tick += 1) await settle();

    expect(peak).toBe(1);
    expect(notifyUsers).toHaveBeenCalledTimes(2);
    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("flushRefereeChanges_removalThenTakeover_logsTheRemovalFirst", async () => {
    let reads = 0;
    const execute = jest.fn<SqlQuery>(async () => {
      reads += 1;
      // La première lecture est la plus lente : en parallèle, la reprise partirait avant le retrait.
      if (reads === 1) for (let tick = 0; tick < 3; tick += 1) await settle();
      return [[matchRow()], []];
    });
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    const connection = fakeConnection({});
    queueRefereeChange(connection, { kind: "AUTO_RELEASED", matchId: 42, refereeId: REFEREE, reason: "INELIGIBLE" });
    queueRefereeChange(connection, { kind: "TAKEN", matchId: 42, afterRemoval: true });

    flushRefereeChanges(connection);
    for (let tick = 0; tick < 12; tick += 1) await settle();

    const calls = jest.mocked(sendBotLog).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).not.toContain("un arbitre prend le match");
    expect(calls[1][0]).toContain("un arbitre prend le match");
    expect(calls[1][1]).toMatchObject({ category: "staff-removal" });
  });

  it("announceRefereeChanges_emptyList_readsNothing", async () => {
    announceRefereeChanges([]);
    await settle();

    expect(getDatabase).not.toHaveBeenCalled();
  });
});

describe("announceObjectionReleases", () => {
  it("announceObjectionReleases_count_sendsOneRefereeReleasedPush", async () => {
    await announceObjectionReleases(REFEREE, 3, [7]);

    expect(loadNotificationRecipients).toHaveBeenCalledWith([REFEREE], "certified");
    const sent = notification();
    expect(sent.topic).toBe("REFEREE_RELEASED");
    expect(resolvePush(sent.push).body).toContain("3 matchs");
    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("announceObjectionReleases_zero_sendsNothing", async () => {
    await announceObjectionReleases(REFEREE, 0, []);

    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("announceObjectionReleases_notifyFails_doesNotThrow", async () => {
    jest.mocked(notifyUsers).mockRejectedValueOnce(new Error("push down"));
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(announceObjectionReleases(REFEREE, 2, [7])).resolves.toBeUndefined();
  });
});
