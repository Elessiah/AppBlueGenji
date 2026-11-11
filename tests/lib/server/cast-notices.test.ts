import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

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
  castLogCategory,
  castReleaseNotice,
  deliverCastChange,
  discardCastChanges,
  flushCastChanges,
  flushCastToggles,
  queueCastChange,
  queueDeletedMatchCasts,
  pairingStillCurrent,
  resetCastToggles,
  CAST_TOGGLE_WINDOW_MS,
  type CastChange,
} from "@/lib/server/tournaments/cast-notices";
import type { CastLogChange } from "@/lib/shared/bot-logs";
import type { CastReleaseReason } from "@/lib/shared/cast-notices";
import { flushBotLogs } from "@/lib/server/tournaments/bot-logs";
import { fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";
import { resolvePush } from "../../helpers/push";
import type { RowColumns } from "../../helpers/row-overrides";
import type { MatchLogRow } from "@/lib/server/tournaments/match-log-subject";

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

/** Le match lu avant sa suppression, que l'annonce ne relit plus. */
function deletedSubject(): MatchLogRow {
  const columns: RowColumns<MatchLogRow> = {
    id: 42,
    bracket: "UPPER",
    round_number: 2,
    swiss_round: 0,
    team1_name: "Renards",
    team2_name: "Nova",
    team1_id: 101,
    team2_id: 102,
    tournament_id: 7,
    tournament_name: "Coupe d'hiver",
    participant_type: "TEAM",
  };
  return columns as MatchLogRow;
}

const RECIPIENT = { userId: CASTER, discord: { discordId: "100000000000000009", handle: "caster", label: "CasterPseudo" } };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(sendBotLog).mockReturnValue(undefined);
  jest.mocked(loadNotificationRecipients).mockResolvedValue([RECIPIENT]);
  jest
    .mocked(notifyUsers)
    .mockResolvedValue({ discord: { sent: 1, unresolved: [], failed: [] }, discordUnreachedUserIds: [], pushed: 1 });
});

/** La première lecture des destinataires reste en suspens jusqu'à l'appel rendu. */
function slowFirstRecipientsRead(): () => void {
  let release: () => void = () => undefined;
  jest
    .mocked(loadNotificationRecipients)
    .mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve([RECIPIENT]))));
  return () => release();
}

function loggedLine(category = "casts"): string {
  expect(sendBotLog).toHaveBeenCalledTimes(1);
  expect(jest.mocked(sendBotLog).mock.calls[0][1]).toMatchObject({ category });
  return jest.mocked(sendBotLog).mock.calls[0][0];
}

function notification() {
  expect(notifyUsers).toHaveBeenCalledTimes(1);
  return jest.mocked(notifyUsers).mock.calls[0][1];
}

describe("castLogChange / castReleaseNotice", () => {
  it.each<[CastChange, CastLogChange, { casterId: number; reason: CastReleaseReason } | null]>([
    [{ kind: "CLAIMED", matchId: 1, casterId: 9, replacedCasterId: null }, "CLAIMED", null],
    [{ kind: "CLAIMED", matchId: 1, casterId: 9, replacedCasterId: 5 }, "REPLACED", { casterId: 5, reason: "REPLACED" }],
    [{ kind: "RELEASED", matchId: 1, casterId: 5, byStaff: false }, "RELEASED", null],
    [{ kind: "RELEASED", matchId: 1, casterId: 5, byStaff: true }, "RELEASED_BY_STAFF", { casterId: 5, reason: "STAFF" }],
    [{ kind: "AUTO_RELEASED", matchId: 1, casterId: 5, reason: "INELIGIBLE" }, "INELIGIBLE", { casterId: 5, reason: "INELIGIBLE" }],
    [{ kind: "AUTO_RELEASED", matchId: 1, casterId: 5, reason: "JOINED_TEAM" }, "JOINED_TEAM", { casterId: 5, reason: "JOINED_TEAM" }],
    [
      { kind: "MATCH_DELETED", matchId: 1, casterId: 5, subject: deletedSubject() },
      "MATCH_DELETED",
      { casterId: 5, reason: "MATCH_DELETED" },
    ],
  ])("%j → journal %s", (change, log, notice) => {
    expect(castLogChange(change)).toBe(log);
    expect(castReleaseNotice(change)).toEqual(notice);
  });
});

describe("castLogCategory — un retrait alerte, une inscription reste une trace", () => {
  it.each<[CastChange, string]>([
    [{ kind: "CLAIMED", matchId: 1, casterId: 9, replacedCasterId: null }, "casts"],
    // Place reprise : le créneau est repourvu dans la même transaction, simple trace.
    [{ kind: "CLAIMED", matchId: 1, casterId: 9, replacedCasterId: 5 }, "casts"],
    [{ kind: "RELEASED", matchId: 1, casterId: 5, byStaff: false }, "staff-removal"],
    [{ kind: "RELEASED", matchId: 1, casterId: 5, byStaff: true }, "staff-removal"],
    [{ kind: "AUTO_RELEASED", matchId: 1, casterId: 5, reason: "INELIGIBLE" }, "staff-removal"],
    [{ kind: "AUTO_RELEASED", matchId: 1, casterId: 5, reason: "JOINED_TEAM" }, "staff-removal"],
    // Match supprimé : plus de créneau à repourvoir, simple trace.
    [{ kind: "MATCH_DELETED", matchId: 1, casterId: 5, subject: deletedSubject() }, "casts"],
  ])("%j → %s", (change, category) => {
    expect(castLogCategory(change)).toBe(category);
  });

  it.each<[CastChange]>([
    [{ kind: "RELEASED", matchId: 42, casterId: CASTER, byStaff: false }],
    [{ kind: "RELEASED", matchId: 42, casterId: CASTER, byStaff: true }],
    [{ kind: "AUTO_RELEASED", matchId: 42, casterId: CASTER, reason: "JOINED_TEAM" }],
  ])("deliverCastChange %j envoie la ligne dans staff-removal, sans nom", async (change) => {
    mockMatch(matchRow());
    await deliverCastChange(change);
    const line = loggedLine("staff-removal");
    expect(line).not.toContain("CasterPseudo");
  });
});

describe("deliverCastChange", () => {
  it("journalise une inscription sans prévenir personne, sans nommer le caster", async () => {
    mockMatch(matchRow());
    await deliverCastChange({ kind: "CLAIMED", matchId: 42, casterId: 9, replacedCasterId: null });
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
    expect(loggedLine("staff-removal")).toContain("Cast libéré");
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("prévient le caster retiré par le staff, en message privé et en push, avec le motif", async () => {
    mockMatch(matchRow());
    await deliverCastChange({ kind: "RELEASED", matchId: 42, casterId: CASTER, byStaff: true });
    const line = loggedLine("staff-removal");
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

  it("deliverCastChange_recipientsReadFails_journalLineStillSent", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockMatch(matchRow());
    jest.mocked(loadNotificationRecipients).mockRejectedValue(new Error("POOL_TIMEOUT"));
    await deliverCastChange({ kind: "RELEASED", matchId: 42, casterId: CASTER, byStaff: true });
    expect(sendBotLog).toHaveBeenCalledTimes(1);
    expect(notifyUsers).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("[cast] destinataire de l'avis non lu : POOL_TIMEOUT");
    error.mockRestore();
  });

  it("deliverCastChange_recipientsReadFailsWithCodedError_logsCodeOnly", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockMatch(matchRow());
    jest
      .mocked(loadNotificationRecipients)
      .mockRejectedValue(Object.assign(new Error("Duplicate entry 'Renards' for key 'name'"), { code: "ER_DUP_ENTRY" }));
    await deliverCastChange({ kind: "RELEASED", matchId: 42, casterId: CASTER, byStaff: true });
    expect(error).toHaveBeenCalledWith("[cast] destinataire de l'avis non lu : ER_DUP_ENTRY");
    expect(JSON.stringify(error.mock.calls)).not.toContain("Renards");
    error.mockRestore();
  });

  it("prévient le titulaire évincé par un autre caster", async () => {
    mockMatch(matchRow());
    await deliverCastChange({ kind: "CLAIMED", matchId: 42, casterId: 9, replacedCasterId: 901 });
    expect(loggedLine("casts")).toContain("Cast repris");
    expect(loadNotificationRecipients).toHaveBeenCalledWith([901], "certified", { matchDm: true });
    expect(notification().discord?.message("fr")).toContain("un autre caster a pris le match");
  });

  it("en tournoi individuel, ne nomme aucun joueur, ni au journal ni au caster", async () => {
    mockMatch(matchRow({ participant_type: "SOLO", team1_name: "PseudoA", team2_name: "PseudoB" }));
    await deliverCastChange({ kind: "AUTO_RELEASED", matchId: 42, casterId: CASTER, reason: "JOINED_TEAM" });
    const line = loggedLine("staff-removal");
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
    expect(loggedLine("staff-removal")).toContain("Renards vs TBD");
    expect(notification().discord?.message("fr")).toContain("« Renards » contre TBD");
  });

  it("deliverCastChange_joinedTeamPairingChanged_silencesLogAndNotice", async () => {
    // Un retour arrière a vidé le match après l'entretien : « tu joues ce match » serait faux.
    mockMatch(matchRow({ team1_id: null, team2_id: null, team1_name: null, team2_name: null }));

    await deliverCastChange({
      kind: "AUTO_RELEASED",
      matchId: 42,
      casterId: CASTER,
      reason: "JOINED_TEAM",
      pairing: { team1Id: 10, team2Id: 20 },
    });

    expect(sendBotLog).not.toHaveBeenCalled();
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("deliverCastChange_staffReleasePairingChanged_namesMatchWithoutTeams", async () => {
    // Réinitialisé entre le geste et l'annonce : les équipes relues ne sont pas celles du geste.
    mockMatch(matchRow({ team1_id: 30, team2_id: 40, team1_name: "Orques", team2_name: "Lynx" }));

    await deliverCastChange({ kind: "RELEASED", matchId: 42, casterId: CASTER, byStaff: true, pairing: { team1Id: 10, team2Id: 20 } });

    const line = loggedLine("staff-removal");
    expect(line).toContain("TBD vs TBD (#42)");
    expect(line).not.toContain("Orques");
    expect(notification().discord?.message("fr")).not.toContain("Orques");
  });

  it("deliverCastChange_samePairing_namesTeams", async () => {
    mockMatch(matchRow({ team1_id: 10, team2_id: 20 }));

    await deliverCastChange({ kind: "RELEASED", matchId: 42, casterId: CASTER, byStaff: true, pairing: { team1Id: 10, team2Id: 20 } });

    expect(loggedLine("staff-removal")).toContain("Renards vs Nova (#42)");
  });

  it("pairingStillCurrent_noPairing_trustsRow", () => {
    const change: CastChange = { kind: "RELEASED", matchId: 42, casterId: CASTER, byStaff: true };

    expect(pairingStillCurrent(change, { team1_id: 30, team2_id: 40 })).toBe(true);
  });

  it("se tait sur un match disparu", async () => {
    mockMatch(null);
    await deliverCastChange({ kind: "RELEASED", matchId: 42, casterId: CASTER, byStaff: true });
    expect(sendBotLog).not.toHaveBeenCalled();
    expect(notifyUsers).not.toHaveBeenCalled();
  });
});

describe("announceCastChange", () => {
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const claimed: CastChange = { kind: "CLAIMED", matchId: 42, casterId: 9, replacedCasterId: null };
  const released: CastChange = { kind: "RELEASED", matchId: 42, casterId: 9, byStaff: false };

  beforeEach(() => resetCastToggles());

  it("ne lève jamais, même base indisponible, et ne vide que le message d'erreur", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(getDatabase).mockRejectedValue(new Error("DB_DOWN"));
    expect(() => announceCastChange({ kind: "RELEASED", matchId: 42, casterId: 9, byStaff: true })).not.toThrow();
    await settle();
    expect(error).toHaveBeenCalledWith("[cast] changement d'inscription non annoncé : DB_DOWN");
    error.mockRestore();
  });

  it("announceCastChange_deliveryFailsWithCodedError_logsCodeOnly", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest
      .mocked(getDatabase)
      .mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:3306"), { code: "ECONNREFUSED" }));
    announceCastChange({ kind: "RELEASED", matchId: 42, casterId: 9, byStaff: true });
    await settle();
    expect(error).toHaveBeenCalledWith("[cast] changement d'inscription non annoncé : ECONNREFUSED");
    error.mockRestore();
  });

  it("un geste du staff part aussitôt, sans attendre de rafale", async () => {
    mockMatch(matchRow());
    announceCastChange({ kind: "RELEASED", matchId: 42, casterId: 9, byStaff: true });
    await settle();
    expect(sendBotLog).toHaveBeenCalledTimes(1);
  });

  it("announceCastChange_noPendingBurst_startsDeliveryInTheSameTick", () => {
    mockMatch(matchRow());
    announceCastChange({ kind: "RELEASED", matchId: 42, casterId: 9, byStaff: true });
    expect(getDatabase).toHaveBeenCalled();
  });

  describe("gestes volontaires du caster", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it("announceCastChange_singleClaim_postsBeforeWindowElapses", async () => {
      mockMatch(matchRow());
      announceCastChange(claimed);
      jest.useRealTimers();
      await settle();
      expect(loggedLine()).toContain("inscrit");
    });

    it("announceCastChange_claimedThenReleasedBurst_postsBothLinesInOrder", async () => {
      mockMatch(matchRow());
      for (let i = 0; i < 10; i++) announceCastChange(i % 2 === 0 ? claimed : released);
      jest.advanceTimersByTime(CAST_TOGGLE_WINDOW_MS);
      jest.useRealTimers();
      await settle();
      await settle();
      expect(sendBotLog).toHaveBeenCalledTimes(2);
      expect(jest.mocked(sendBotLog).mock.calls[0][0]).toContain("Cast réservé");
      expect(jest.mocked(sendBotLog).mock.calls[1][0]).toContain("Cast libéré");
    });

    it("announceCastChange_releasedThenClaimedBurst_postsReleaseThenClaim", async () => {
      mockMatch(matchRow());
      announceCastChange(released);
      announceCastChange(claimed);
      jest.advanceTimersByTime(CAST_TOGGLE_WINDOW_MS);
      jest.useRealTimers();
      await settle();
      await settle();
      expect(sendBotLog).toHaveBeenCalledTimes(2);
      expect(jest.mocked(sendBotLog).mock.calls[0][0]).toContain("Cast libéré");
      expect(jest.mocked(sendBotLog).mock.calls[1][0]).toContain("Cast réservé");
    });

    it("announceCastChange_matchGoneBeforeWindowEnds_claimStillLogged", async () => {
      const execute = jest
        .fn<SqlQuery>()
        .mockResolvedValueOnce([[matchRow()], []])
        .mockResolvedValue([[], []]);
      jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
      announceCastChange(claimed);
      jest.useRealTimers();
      await settle();
      announceCastChange(released);
      await flushCastToggles();
      await settle();
      expect(loggedLine()).toContain("Cast réservé");
    });

    it("announceCastChange_newBurstRightAfterClosing_leadingAfterClosing", async () => {
      // `sendBotLog` range la ligne sans rien attendre : la fermeture de la
      // rafale est faite dès que sa ligne est au lot, et la rafale suivante
      // s'écrit après elle.
      mockMatch(matchRow());
      announceCastChange(claimed);
      announceCastChange(released);
      jest.useRealTimers();
      await settle();
      const closing = flushCastToggles();
      await settle();
      announceCastChange(claimed);
      await closing;
      await settle();
      await settle();
      expect(lines()).toHaveLength(3);
      expect(lines()[1]).toContain("Cast libéré");
      expect(lines()[2]).toContain("Cast réservé");
    });

    it("une rafale qui finit inscrite ne fait qu'une ligne", async () => {
      mockMatch(matchRow());
      for (let i = 0; i < 9; i++) announceCastChange(i % 2 === 0 ? claimed : released);
      flushCastToggles();
      jest.useRealTimers();
      await settle();
      expect(sendBotLog).toHaveBeenCalledTimes(1);
    });

    it("deux casters, ou deux matchs, sont deux rafales", async () => {
      mockMatch(matchRow());
      announceCastChange(claimed);
      announceCastChange({ ...claimed, casterId: 10 });
      announceCastChange({ ...claimed, matchId: 43 });
      flushCastToggles();
      jest.useRealTimers();
      await settle();
      expect(sendBotLog).toHaveBeenCalledTimes(3);
    });

    /** Laisse partir la rafale forcée puis le geste qui la suit (chaînés). */
    async function settleChain(): Promise<void> {
      jest.useRealTimers();
      for (let i = 0; i < 5; i++) await settle();
    }
    const lines = () => jest.mocked(sendBotLog).mock.calls.map((call) => String(call[0]));

    it("announceCastChange_staffReleaseAfterPendingClaim_claimLoggedFirst", async () => {
      mockMatch(matchRow());
      announceCastChange(claimed);
      announceCastChange({ ...released, byStaff: true });
      await settleChain();
      expect(lines()).toHaveLength(2);
      expect(lines()[0]).toContain("inscrit");
      expect(lines()[1]).toContain("par le staff");
    });

    it("announceCastChange_autoReleaseAfterPendingClaim_claimLoggedFirst", async () => {
      mockMatch(matchRow());
      announceCastChange(claimed);
      announceCastChange({ kind: "AUTO_RELEASED", matchId: 42, casterId: 9, reason: "JOINED_TEAM" });
      await settleChain();
      expect(lines()).toHaveLength(2);
      expect(lines()[0]).toContain("inscrit");
      expect(lines()[1]).toContain("le caster joue désormais ce match");
    });

    it("announceCastChange_takeoverAfterReplacedCasterToggle_toggleFlushedFirst", async () => {
      mockMatch(matchRow());
      announceCastChange(claimed);
      announceCastChange({ kind: "CLAIMED", matchId: 42, casterId: 10, replacedCasterId: 9 });
      await settleChain();
      expect(lines()).toHaveLength(2);
      expect(lines()[0]).toContain("inscrit");
      expect(lines()[1]).toContain("repris");
    });

    it("announceCastChange_staffReleaseThenImmediateReclaim_staffLineFirst", async () => {
      mockMatch(matchRow());
      const finishRead = slowFirstRecipientsRead();
      announceCastChange({ ...released, byStaff: true });
      announceCastChange(claimed);
      await settleChain();
      expect(lines()).toHaveLength(0);
      finishRead();
      await settleChain();
      expect(lines()).toHaveLength(2);
      expect(lines()[0]).toContain("par le staff");
      expect(lines()[1]).toContain("Cast réservé");
    });

    it("announceCastChange_staffReleaseClaimStaffReleaseWhileFirstSlow_allLinesPosted", async () => {
      mockMatch(matchRow());
      const finishRead = slowFirstRecipientsRead();
      announceCastChange({ ...released, byStaff: true });
      announceCastChange(claimed);
      announceCastChange({ ...released, byStaff: true });
      await settleChain();
      finishRead();
      await settleChain();
      await settleChain();
      expect(lines()).toHaveLength(3);
      expect(lines()[0]).toContain("par le staff");
      expect(lines()[1]).toContain("Cast réservé");
      expect(lines()[2]).toContain("par le staff");
    });

    it("announceCastChange_gestureAfterStaffFlush_opensNewBurst", async () => {
      mockMatch(matchRow());
      announceCastChange(released);
      announceCastChange({ ...released, byStaff: true });
      announceCastChange(claimed);
      await settleChain();
      await flushCastToggles();
      await settle();
      expect(lines()).toHaveLength(3);
      expect(lines()[0]).toContain("Cast libéré");
      expect(lines()[1]).toContain("par le staff");
      expect(lines()[2]).toContain("Cast réservé");
    });

    it("announceCastChange_staffReleaseOtherCaster_otherClaimPostedAtOnce", async () => {
      mockMatch(matchRow());
      announceCastChange({ ...claimed, casterId: 10 });
      announceCastChange({ ...released, byStaff: true });
      await settleChain();
      expect(lines()).toHaveLength(2);
      expect(lines().some((line) => line.includes("par le staff"))).toBe(true);
      await flushCastToggles();
      await settle();
      expect(lines()).toHaveLength(2);
    });
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
    expect(loggedLine("staff-removal")).toContain("le caster joue désormais ce match");
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

describe("match supprimé — l'inscription part avec lui", () => {
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  /** Connexion de transaction : les casters des manches, puis leurs lignes de journal. */
  function deletingConnection(casters: { match_id: number; user_id: number }[]) {
    const execute = jest.fn<SqlQuery>(async (sql) => {
      if (sql.startsWith("SELECT match_id, user_id FROM bg_match_casters")) return [casters, []];
      return [[deletedSubject()], []];
    });
    return { execute, connection: fakeConnection({ execute }) };
  }

  it("deliverCastChange_matchDeleted_usesSubjectWithoutRereadingMatch", async () => {
    const reread = mockMatch(null);

    await deliverCastChange({ kind: "MATCH_DELETED", matchId: 42, casterId: CASTER, subject: deletedSubject() });

    expect(reread).not.toHaveBeenCalled();
    const line = loggedLine("casts");
    expect(line).toContain("Cast retiré");
    expect(line).toContain("le match supprimé emporte l'inscription du caster");
    expect(line).toContain("Renards vs Nova (#42)");
    expect(line).not.toContain("CasterPseudo");
    const sent = notification();
    expect(sent.topic).toBe("CAST_RELEASED");
    expect(sent.discord?.message("fr")).toContain("le match a été supprimé");
    expect(sent.discord?.message("en")).toContain("the match was deleted");
    expect(resolvePush(sent.push, "fr").body).toContain("le match a été supprimé");
    expect(resolvePush(sent.push, "en").body).toContain("the match was deleted");
  });

  it("queueDeletedMatchCasts_openMatchWithTwoCasters_queuesOneChangeEach", async () => {
    mockMatch(null);
    const { execute, connection } = deletingConnection([
      { match_id: 42, user_id: CASTER },
      { match_id: 42, user_id: 901 },
    ]);

    await queueDeletedMatchCasts(connection, [{ id: 42, status: "READY" }]);
    expect(sendBotLog).not.toHaveBeenCalled();
    flushCastChanges(connection);
    await settle();

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][1]).toEqual([42]);
    expect(sendBotLog).toHaveBeenCalledTimes(2);
    expect(jest.mocked(loadNotificationRecipients).mock.calls.map((call) => call[0])).toEqual([[CASTER], [901]]);
  });

  it("queueDeletedMatchCasts_onlyPlayedMatches_readsNothing", async () => {
    const { execute, connection } = deletingConnection([{ match_id: 42, user_id: CASTER }]);

    await queueDeletedMatchCasts(connection, [{ id: 42, status: "COMPLETED" }]);
    flushCastChanges(connection);
    await settle();

    expect(execute).not.toHaveBeenCalled();
    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("queueDeletedMatchCasts_noCasters_skipsSubjectReadAndQueuesNothing", async () => {
    const { execute, connection } = deletingConnection([]);

    await queueDeletedMatchCasts(connection, [{ id: 42, status: "PENDING" }]);
    flushCastChanges(connection);
    await settle();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(sendBotLog).not.toHaveBeenCalled();
  });
});
