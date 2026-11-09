import { describe, expect, it } from "@jest/globals";
import { formatNewMatchDm } from "@/lib/server/tournaments/new-match-dm";
import { newMatchPush, type NewMatchSide } from "@/lib/shared/push-messages";

const SIDE: NewMatchSide = {
  tournamentId: 4,
  tournamentName: "Coupe",
  matchId: 40,
  teamName: "Renards",
  opponentName: "Nova",
  bracket: "UPPER",
  roundNumber: 2,
  startAt: null,
};

const URL = "https://bluegenji.test/tournois/4/matchs/40";

describe("formatNewMatchDm", () => {
  it("format_teamFrench_quotesTeamAndOpponentAndLinksMatch", () => {
    const text = formatNewMatchDm(SIDE, URL, "fr");

    expect(text).toContain("# Nouveau match");
    expect(text).toContain("Ton équipe « Renards » affronte « Nova ».");
    expect(text).toContain(`Page du match : ${URL}`);
  });

  it("format_scheduled_givesKickoffInParisTime", () => {
    const text = formatNewMatchDm({ ...SIDE, startAt: "2026-11-14T19:00:00.000Z" }, URL, "fr");

    expect(text).toContain("**Coup d'envoi : samedi 14 novembre à 20:00** (heure de Paris).");
  });

  it("format_noStart_saysNoTimeYet", () => {
    expect(formatNewMatchDm(SIDE, URL, "fr")).toContain("Pas encore d'horaire");
  });

  it("format_english_linkUnderEnPrefix", () => {
    const text = formatNewMatchDm(SIDE, URL, "en");

    expect(text).toContain("Your team “Renards” faces “Nova”.");
    expect(text).toContain("Match page: https://bluegenji.test/en/tournois/4/matchs/40");
  });

  it("format_solo_namesNobody", () => {
    const text = formatNewMatchDm({ ...SIDE, solo: true, teamName: "Pseudo1", opponentName: "Pseudo2" }, URL, "fr");

    expect(text).toContain("L'adversaire de ton prochain match est connu.");
    expect(text).not.toContain("Pseudo1");
    expect(text).not.toContain("Pseudo2");
  });

  it("format_unknownSiteRoot_omitsLinkLine", () => {
    expect(formatNewMatchDm(SIDE, null, "fr")).not.toContain("Page du match");
  });

  it("format_markdownInTeamName_isNeutralised", () => {
    const text = formatNewMatchDm({ ...SIDE, opponentName: "**Nova** @everyone" }, URL, "fr");

    expect(text).not.toContain("**Nova**");
    expect(text).not.toContain("@everyone");
  });
});

describe("newMatchPush", () => {
  it("push_scheduled_bodyHasKickoffAndUrlIsMatchPage", () => {
    const push = newMatchPush({ ...SIDE, startAt: "2026-11-14T19:00:00.000Z" }, "fr");

    expect(push.title).toBe("Nouveau match");
    expect(push.body).toContain("Renards contre Nova · Coupe");
    expect(push.body).toContain("Coup d'envoi samedi 14 novembre à 20:00 (heure de Paris).");
    expect(push.url).toBe("/tournois/4/matchs/40");
  });

  it("push_unscheduledTeam_asksToOrganise", () => {
    expect(newMatchPush(SIDE, "fr").body).toContain("organise-toi avec ton équipe");
  });

  it("push_unscheduledSolo_namesNobody", () => {
    const push = newMatchPush({ ...SIDE, solo: true, teamName: "Pseudo1", opponentName: "Pseudo2" }, "fr");

    expect(push.body).toContain("Ton match · Coupe");
    expect(push.body).not.toContain("Pseudo1");
  });

  it("push_english_urlUnderEnPrefix", () => {
    const push = newMatchPush(SIDE, "en");

    expect(push.title).toBe("New match");
    expect(push.url).toBe("/en/tournois/4/matchs/40");
  });

  it("push_tag_ownPerMatchTag", () => {
    expect(newMatchPush(SIDE, "fr").tag).toBe("rencontre-40-new");
  });
});
