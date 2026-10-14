import { describe, expect, it } from "@jest/globals";
import { formatRefereeDigestLog, REFEREE_DIGEST_LOG_ENTRIES } from "@/lib/shared/bot-logs";
import { matchReminderPush, refereeDigestPush, REFEREE_DIGEST_PUSH_LINES } from "@/lib/shared/push-messages";
import { PUSH_TOPICS } from "@/lib/shared/push-notifications";
import enPush from "@/messages/en/push.json";
import frPush from "@/messages/fr/push.json";

const START = new Date("2026-09-10T18:00:00Z");

function match(id: number, overrides: Partial<Parameters<typeof refereeDigestPush>[0][number]> = {}) {
  return {
    matchId: id,
    tournamentName: "Coupe",
    team1Name: `Renards ${id}`,
    team2Name: `Nova ${id}`,
    solo: false,
    startAt: START,
    ...overrides,
  };
}

describe("refereeDigestPush", () => {
  it("liste les matchs, heure de Paris, en français et en anglais", () => {
    const fr = refereeDigestPush([match(1), match(2)], "fr");
    expect(fr.title).toBe("Matchs des 10 prochaines heures");
    expect(fr.body).toBe("jeu. 20:00 · Renards 1 contre Nova 1 (Coupe)\njeu. 20:00 · Renards 2 contre Nova 2 (Coupe)");
    expect(fr.url).toBe("/tournois");
    expect(fr.tag).toBe("referee-digest-1");

    const en = refereeDigestPush([match(1)], "en");
    expect(en.title).toBe("Match in the next 10 hours");
    expect(en.body).toBe("Thu 20:00 · Renards 1 vs Nova 1 (Coupe)");
    expect(en.url).toBe("/en/tournois");
  });

  it("borne la liste et dit combien restent", () => {
    const many = Array.from({ length: REFEREE_DIGEST_PUSH_LINES + 3 }, (_, index) => match(index + 1));
    const lines = refereeDigestPush(many).body.split("\n");
    expect(lines).toHaveLength(REFEREE_DIGEST_PUSH_LINES + 1);
    expect(lines.at(-1)).toBe("… et 3 autres");
    expect(refereeDigestPush(many, "en").body.split("\n").at(-1)).toBe("… and 3 more");
  });

  it("dit « Un match » en tournoi individuel", () => {
    const body = refereeDigestPush([match(1, { solo: true, team1Name: "Kiro", team2Name: "Ayla" })]).body;
    expect(body).toContain("Un match");
    expect(body).not.toMatch(/Kiro|Ayla/);
  });
});

describe("matchReminderPush — check-in", () => {
  const SIDE = {
    tournamentId: 7,
    tournamentName: "Coupe",
    matchId: 31,
    teamName: "Renards",
    opponentName: "Nova",
    bracket: "UPPER",
    roundNumber: 1,
    startAt: START,
  };

  it("ajoute le lien au rappel 10 h, dans les deux langues", () => {
    expect(matchReminderPush(SIDE, "PT10H", "fr").body).toMatch(/Check-in sur Discord 15 min avant le match : https:\/\/discord\.gg\/Sgdh3p4VhC$/);
    expect(matchReminderPush(SIDE, "PT10H", "en").body).toMatch(/Check-in on Discord 15 min before the match: https:\/\/discord\.gg\/Sgdh3p4VhC$/);
    expect(matchReminderPush(SIDE, "PT10H", "en").title).toBe("Match in less than 10 hours");
  });

  it("ne l'ajoute ni au rappel 24 h ni à une annonce qui ne l'a pas consommé", () => {
    expect(matchReminderPush(SIDE, "P1D").body).not.toContain("discord.gg");
    expect(matchReminderPush(SIDE, null).body).not.toContain("discord.gg");
    expect(matchReminderPush({ ...SIDE, checkIn: true }, null).body).toContain("discord.gg");
  });
});

describe("formatRefereeDigestLog", () => {
  const entry = (id: number, participantType: "TEAM" | "SOLO" = "TEAM") => ({
    matchId: id,
    tournament: { id: 7, name: "Coupe" },
    team1: { name: `Renards ${id}`, participantType },
    team2: { name: `Nova ${id}`, participantType },
    startAt: START,
  });

  it("tient en une ligne, sans auteur", () => {
    const line = formatRefereeDigestLog([entry(1), entry(2)]);
    expect(line).not.toContain("\n");
    expect(line).toBe(
      "📋 Programme d'arbitrage — 2 matchs dans les 10 prochaines heures (heure de Paris) : " +
        "jeu. 20:00 Renards 1 vs Nova 1 (« Coupe » (#7), match #1) ; jeu. 20:00 Renards 2 vs Nova 2 (« Coupe » (#7), match #2).",
    );
    expect(line).not.toContain("staff");
  });

  it("borne les manches citées", () => {
    const many = Array.from({ length: REFEREE_DIGEST_LOG_ENTRIES + 2 }, (_, index) => entry(index + 1));
    expect(formatRefereeDigestLog(many)).toContain("… et 2 autres.");
    expect(formatRefereeDigestLog([entry(1)])).toContain("1 match dans");
  });

  it("écrit « un joueur » en tournoi individuel", () => {
    const line = formatRefereeDigestLog([entry(1, "SOLO")]);
    expect(line).toContain("un joueur vs un joueur");
    expect(line).not.toMatch(/Renards|Nova/);
  });
});

describe("sujet REFEREE_DIGEST", () => {
  it("est libellé en français et en anglais sur /profil", () => {
    expect(PUSH_TOPICS.REFEREE_DIGEST.label).toBe(frPush.topics.REFEREE_DIGEST.label);
    expect(enPush.topics.REFEREE_DIGEST.label).toBe("Refereeing schedule");
    expect(PUSH_TOPICS.MATCH_REMINDER.description).toBe(frPush.topics.MATCH_REMINDER.description);
    expect(enPush.topics.MATCH_REMINDER.description).toContain("10 h");
  });
});
