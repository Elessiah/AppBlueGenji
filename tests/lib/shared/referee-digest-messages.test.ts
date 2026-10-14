import { describe, expect, it } from "@jest/globals";
import { formatRefereeDigestLog, REFEREE_DIGEST_LOG_ENTRIES, REFEREE_DIGEST_LOG_MAX_LENGTH } from "@/lib/shared/bot-logs";
import { matchReminderPush, refereeDigestPush, REFEREE_DIGEST_PUSH_LINES } from "@/lib/shared/push-messages";
import { PUSH_TOPICS } from "@/lib/shared/push-notifications";
import enPush from "@/messages/en/push.json";
import frPush from "@/messages/fr/push.json";

const START = new Date("2026-09-10T18:00:00Z");

function match(id: number, overrides: Partial<Parameters<typeof refereeDigestPush>[0][number]> = {}) {
  return {
    matchId: id,
    tournamentId: 7,
    tournamentName: "Coupe",
    bracket: "UPPER",
    roundNumber: 1,
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
    expect(fr.title).toBe("Programme d'arbitrage : 2 matchs à venir");
    expect(fr.body).toBe(
      "jeu. 20:00 · Renards 1 contre Nova 1 (Coupe, Manche 1)\njeu. 20:00 · Renards 2 contre Nova 2 (Coupe, Manche 1)",
    );
    expect(fr.url).toBe("/tournois/7");
    expect(fr.tag).toBe("referee-digest-1-2");

    const en = refereeDigestPush([match(1)], "en");
    expect(en.title).toBe("Refereeing schedule: 1 upcoming match");
    expect(refereeDigestPush([match(1)], "fr").title).toBe("Programme d'arbitrage : 1 match à venir");
    expect(refereeDigestPush([match(1), match(2)], "en").title).toBe("Refereeing schedule: 2 upcoming matches");
    expect(en.body).toBe("Thu 20:00 · Renards 1 vs Nova 1 (Coupe, Round 1)");
    expect(en.url).toBe("/en/tournois/7");
  });

  it("mène à la liste des tournois quand le programme en cite plusieurs", () => {
    const push = refereeDigestPush([match(1), match(2, { tournamentId: 8 })], "en");
    expect(push.url).toBe("/en/tournois");
    expect(refereeDigestPush([match(1), match(2, { tournamentId: 8 })]).url).toBe("/tournois");
  });

  it("étiquette chaque programme par toutes ses manches : un programme suivant ne remplace pas le précédent", () => {
    // A cite 5, 6, 7 ; 5 reprogrammée repart seule dans B — B ne doit pas effacer A.
    const first = refereeDigestPush([match(5), match(6), match(7)]);
    const second = refereeDigestPush([match(5)]);
    expect(first.tag).not.toBe(second.tag);
  });

  it("borne la liste et dit combien restent", () => {
    const many = Array.from({ length: REFEREE_DIGEST_PUSH_LINES + 3 }, (_, index) => match(index + 1));
    const lines = refereeDigestPush(many).body.split("\n");
    expect(lines).toHaveLength(REFEREE_DIGEST_PUSH_LINES + 1);
    expect(lines.at(-1)).toBe("… et 3 autres");
    expect(refereeDigestPush(many, "en").body.split("\n").at(-1)).toBe("… and 3 more");
    // Un seul match au-delà de la borne : singulier (« 1 autre », pas « 1 autres »).
    const oneMore = Array.from({ length: REFEREE_DIGEST_PUSH_LINES + 1 }, (_, index) => match(index + 1));
    expect(refereeDigestPush(oneMore).body.split("\n").at(-1)).toBe("… et 1 autre");
    expect(refereeDigestPush(oneMore, "en").body.split("\n").at(-1)).toBe("… and 1 more");
  });

  it("dit « Un match » en tournoi individuel, la manche distinguant les lignes", () => {
    const solo = { solo: true, team1Name: "Kiro", team2Name: "Ayla" };
    const body = refereeDigestPush([match(1, solo), match(2, { ...solo, roundNumber: 2 })]).body;
    expect(body).toBe("jeu. 20:00 · Un match (Coupe, Manche 1)\njeu. 20:00 · Un match (Coupe, Manche 2)");
    expect(body).not.toMatch(/Kiro|Ayla/);
    expect(refereeDigestPush([match(1, solo)], "en").body).toBe("Thu 20:00 · A match (Coupe, Round 1)");
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

  it("ouvre l'invitation au toucher quand il porte le check-in, la fiche du match sinon", () => {
    // Une notification n'ouvre que des adresses du site : `/check-in` renvoie à l'invitation.
    expect(matchReminderPush(SIDE, "PT10H", "fr").url).toBe("/check-in");
    expect(matchReminderPush(SIDE, "PT10H", "en").url).toBe("/check-in");
    expect(matchReminderPush({ ...SIDE, checkIn: true }, null, "en").url).toBe("/check-in");
    expect(matchReminderPush(SIDE, "P1D", "fr").url).toBe("/tournois/7#match-31");
    expect(matchReminderPush(SIDE, "P1D", "en").url).toBe("/en/tournois/7#match-31");
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
      "📋 Programme d'arbitrage — 2 matchs à venir (heure de Paris) : " +
        "jeu. 20:00 Renards 1 vs Nova 1 (« Coupe » (#7), match #1) ; jeu. 20:00 Renards 2 vs Nova 2 (« Coupe » (#7), match #2).",
    );
    expect(line).not.toContain("staff");
  });

  it("ne dépasse jamais la longueur d'un message Discord, noms longs compris", () => {
    const long = (id: number) => ({
      ...entry(id),
      tournament: { id: 7, name: "T".repeat(120) },
      team1: { name: `${"R".repeat(56)} ${id}`, participantType: "TEAM" as const },
      team2: { name: `${"N".repeat(56)} ${id}`, participantType: "TEAM" as const },
    });
    const many = Array.from({ length: REFEREE_DIGEST_LOG_ENTRIES }, (_, index) => long(index + 1));
    const line = formatRefereeDigestLog(many);
    expect(line.length).toBeLessThanOrEqual(REFEREE_DIGEST_LOG_MAX_LENGTH);
    // Les manches qui ne tiennent pas sont comptées, pas perdues en silence.
    expect(line).toMatch(/… et \d+ autres\.$/);
    expect(line).toContain("12 matchs à venir");
    // Une seule manche plus longue que la borne : coupée, jamais refusée.
    const huge = { ...long(1), team1: { name: "😀".repeat(1500), participantType: "TEAM" as const } };
    const cut = formatRefereeDigestLog([huge]);
    expect(cut.length).toBeLessThanOrEqual(REFEREE_DIGEST_LOG_MAX_LENGTH);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("borne les manches citées", () => {
    const many = Array.from({ length: REFEREE_DIGEST_LOG_ENTRIES + 2 }, (_, index) => entry(index + 1));
    expect(formatRefereeDigestLog(many)).toContain("… et 2 autres.");
    expect(formatRefereeDigestLog([entry(1)])).toContain("1 match à venir");
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
