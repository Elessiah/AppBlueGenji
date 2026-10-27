import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/notify");
jest.mock("@/lib/server/site-url", () => ({ siteCanonicalBase: () => "https://site.test" }));

import { getDatabase } from "@/lib/server/database";
import { sendBotLog } from "@/lib/server/bot-integration";
import { loadNotificationRecipients, notifyUsers } from "@/lib/server/notify";
import {
  announceCastChange,
  castLogChange,
  castReleaseNotice,
  deliverCastChange,
  discardCastChanges,
  flushCastChanges,
  queueCastChange,
  type CastChange,
} from "@/lib/server/tournaments/cast-notices";
import type { CastLogChange } from "@/lib/shared/bot-logs";
import type { CastReleaseReason } from "@/lib/shared/cast-notices";
import { flushBotLogs } from "@/lib/server/tournaments/bot-logs";
import { fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";
import { resolvePush } from "../../helpers/push";

const CASTER = 900;

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
  return execute;
}

const RECIPIENT = { userId: CASTER, discord: { discordId: "100000000000000009", handle: "caster", label: "CasterPseudo" } };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(sendBotLog).mockResolvedValue();
  jest.mocked(loadNotificationRecipients).mockResolvedValue([RECIPIENT]);
  jest
    .mocked(notifyUsers)
    .mockResolvedValue({ discord: { sent: 1, unresolved: [], failed: [] }, discordUnreachedUserIds: [], pushed: 1 });
});

function loggedLine(): string {
  expect(sendBotLog).toHaveBeenCalledTimes(1);
  return jest.mocked(sendBotLog).mock.calls[0][0];
}

function notification() {
  expect(notifyUsers).toHaveBeenCalledTimes(1);
  return jest.mocked(notifyUsers).mock.calls[0][1];
}

describe("castLogChange / castReleaseNotice", () => {
  it.each<[CastChange, CastLogChange, { casterId: number; reason: CastReleaseReason } | null]>([
    [{ kind: "CLAIMED", matchId: 1, replacedCasterId: null }, "CLAIMED", null],
    [{ kind: "CLAIMED", matchId: 1, replacedCasterId: 5 }, "REPLACED", { casterId: 5, reason: "REPLACED" }],
    [{ kind: "RELEASED", matchId: 1, casterId: 5, byStaff: false }, "RELEASED", null],
    [{ kind: "RELEASED", matchId: 1, casterId: 5, byStaff: true }, "RELEASED_BY_STAFF", { casterId: 5, reason: "STAFF" }],
    [{ kind: "AUTO_RELEASED", matchId: 1, casterId: 5, reason: "INELIGIBLE" }, "INELIGIBLE", { casterId: 5, reason: "INELIGIBLE" }],
    [{ kind: "AUTO_RELEASED", matchId: 1, casterId: 5, reason: "JOINED_TEAM" }, "JOINED_TEAM", { casterId: 5, reason: "JOINED_TEAM" }],
  ])("%j → journal %s", (change, log, notice) => {
    expect(castLogChange(change)).toBe(log);
    expect(castReleaseNotice(change)).toEqual(notice);
  });
});

describe("deliverCastChange", () => {
  it("journalise une inscription sans prévenir personne, sans nommer le caster", async () => {
    mockMatch(matchRow());
    await deliverCastChange({ kind: "CLAIMED", matchId: 42, replacedCasterId: null });
    const line = loggedLine();
    expect(line).toContain("Cast réservé");
    expect(line).toContain("« Coupe d'hiver » (#7)");
    expect(line).toContain("Renards vs Nova (#42)");
    expect(line).toContain("un caster");
    expect(notifyUsers).not.toHaveBeenCalled();
    expect(loadNotificationRecipients).not.toHaveBeenCalled();
  });

  it("journalise un retrait volontaire sans avis au caster", async () => {
    mockMatch(matchRow());
    await deliverCastChange({ kind: "RELEASED", matchId: 42, casterId: CASTER, byStaff: false });
    expect(loggedLine()).toContain("Cast libéré");
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("prévient le caster retiré par le staff, en message privé et en push, avec le motif", async () => {
    mockMatch(matchRow());
    await deliverCastChange({ kind: "RELEASED", matchId: 42, casterId: CASTER, byStaff: true });
    const line = loggedLine();
    expect(line).toContain("Cast retiré");
    expect(line).toContain("par le staff");
    expect(line).not.toContain("CasterPseudo");

    // Message de match : l'interrupteur de « Mon profil » est respecté.
    expect(loadNotificationRecipients).toHaveBeenCalledWith([CASTER], "certified", { matchDm: true });
    expect(jest.mocked(notifyUsers).mock.calls[0][0]).toEqual([RECIPIENT]);
    const sent = notification();
    expect(sent.topic).toBe("CAST_RELEASED");
    expect(sent.discord?.context).toBe("cast-released");
    const fr = sent.discord?.message("fr") ?? "";
    expect(fr).toContain("décision du staff");
    expect(fr).toContain("« Renards » contre « Nova »");
    expect(fr).toContain("https://site.test/tournois/7#");
    const en = sent.discord?.message("en") ?? "";
    expect(en).toContain("staff decision");
    expect(en).toContain("“Renards” vs “Nova”");
    expect(en).toContain("https://site.test/en/tournois/7#");
    const push = resolvePush(sent.push, "fr");
    expect(push.title).toBe("Cast retiré");
    expect(push.body).toContain("décision du staff");
    expect(push.body).toContain("Renards contre Nova");
    expect(resolvePush(sent.push, "en").body).toContain("staff decision");
  });

  it("prévient le titulaire évincé par un autre caster", async () => {
    mockMatch(matchRow());
    await deliverCastChange({ kind: "CLAIMED", matchId: 42, replacedCasterId: 901 });
    expect(loggedLine()).toContain("Cast repris");
    expect(loadNotificationRecipients).toHaveBeenCalledWith([901], "certified", { matchDm: true });
    expect(notification().discord?.message("fr")).toContain("un autre caster a pris le match");
  });

  it("en tournoi individuel, ne nomme aucun joueur, ni au journal ni au caster", async () => {
    mockMatch(matchRow({ participant_type: "SOLO", team1_name: "PseudoA", team2_name: "PseudoB" }));
    await deliverCastChange({ kind: "AUTO_RELEASED", matchId: 42, casterId: CASTER, reason: "JOINED_TEAM" });
    const line = loggedLine();
    expect(line).toContain("un joueur vs un joueur");
    expect(line).toContain("le caster joue désormais ce match");
    const sent = notification();
    const texts = [
      line,
      sent.discord?.message("fr") ?? "",
      sent.discord?.message("en") ?? "",
      resolvePush(sent.push, "fr").body,
      resolvePush(sent.push, "en").body,
    ];
    for (const text of texts) {
      expect(text).not.toContain("PseudoA");
      expect(text).not.toContain("PseudoB");
    }
    expect(sent.discord?.message("fr")).toContain("d'un match");
    expect(resolvePush(sent.push, "fr").body).toContain("Un match");
  });

  it("une place encore vide se lit « TBD »", async () => {
    mockMatch(matchRow({ team2_name: null }));
    await deliverCastChange({ kind: "AUTO_RELEASED", matchId: 42, casterId: CASTER, reason: "INELIGIBLE" });
    expect(loggedLine()).toContain("Renards vs TBD");
    expect(notification().discord?.message("fr")).toContain("« Renards » contre TBD");
  });

  it("se tait sur un match disparu", async () => {
    mockMatch(null);
    await deliverCastChange({ kind: "RELEASED", matchId: 42, casterId: CASTER, byStaff: true });
    expect(sendBotLog).not.toHaveBeenCalled();
    expect(notifyUsers).not.toHaveBeenCalled();
  });
});

describe("announceCastChange", () => {
  it("ne lève jamais, même base indisponible", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(getDatabase).mockRejectedValue(new Error("DB_DOWN"));
    expect(() => announceCastChange({ kind: "CLAIMED", matchId: 42, replacedCasterId: null })).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(error).toHaveBeenCalledWith("[cast] changement d'inscription non annoncé", expect.any(Error));
    error.mockRestore();
  });
});

describe("queueCastChange — annonce après le commit", () => {
  const RELEASE: CastChange = { kind: "AUTO_RELEASED", matchId: 42, casterId: CASTER, reason: "JOINED_TEAM" };
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  it("annonce les changements notés une fois la transaction aboutie", async () => {
    mockMatch(matchRow());
    const connection = fakeConnection({});
    queueCastChange(connection, RELEASE);
    expect(sendBotLog).not.toHaveBeenCalled();
    flushCastChanges(connection);
    await settle();
    expect(loggedLine()).toContain("le caster joue désormais ce match");
    expect(notification().topic).toBe("CAST_RELEASED");
    // La file est vidée : un second flush ne répète rien.
    flushCastChanges(connection);
    await settle();
    expect(sendBotLog).toHaveBeenCalledTimes(1);
  });

  it("n'annonce rien d'une transaction annulée", async () => {
    mockMatch(matchRow());
    const connection = fakeConnection({});
    queueCastChange(connection, RELEASE);
    discardCastChanges(connection);
    flushCastChanges(connection);
    await settle();
    expect(sendBotLog).not.toHaveBeenCalled();
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("part avec le journal du staff après l'entretien (flushBotLogs)", async () => {
    mockMatch(matchRow());
    const connection = fakeConnection({});
    queueCastChange(connection, RELEASE);
    flushBotLogs(connection);
    await settle();
    expect(notifyUsers).toHaveBeenCalledTimes(1);
  });
});
