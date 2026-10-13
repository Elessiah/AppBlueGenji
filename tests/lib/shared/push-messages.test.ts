import { describe, expect, it } from "@jest/globals";
import {
  contentReportPush,
  matchReminderPush,
  matchScheduleClearedPush,
  matchScheduledStaffPush,
  matchStartPush,
  moderationPush,
  privacyChangePush,
  refereeAlertPush,
  scoreToConfirmPush,
  staffReportPush,
  stripMarkdown,
  teamJoinRequestPush,
  tournamentStartPush,
} from "@/lib/shared/push-messages";

const SIDE = {
  tournamentId: 7,
  tournamentName: "Coupe BlueGenji",
  matchId: 31,
  teamName: "Les Renards",
  opponentName: "Team Nova",
};

describe("matchStartPush", () => {
  it("appelle les « Prêt » en lancement, et mène au match", () => {
    const content = matchStartPush(SIDE, "LOBBY");
    expect(content.title).toBe("Ton match commence");
    expect(content.body).toContain("Les Renards contre Team Nova");
    expect(content.body).toContain("Déclare-toi prêt");
    expect(content.url).toBe("/tournois/7#match-31");
  });

  it("annonce le départ sous la même étiquette, pour remplacer l'appel", () => {
    const lobby = matchStartPush(SIDE, "LOBBY");
    const launched = matchStartPush(SIDE, "LAUNCHED");
    expect(launched.title).toBe("Ton match est lancé");
    expect(launched.tag).toBe(lobby.tag);
  });
});

describe("matchReminderPush", () => {
  it("dit le délai, l'adversaire et l'heure de Paris", () => {
    const content = matchReminderPush(
      { ...SIDE, bracket: "UPPER", roundNumber: 2, startAt: "2026-09-10T18:00:00Z" },
      "P1D",
    );
    expect(content.title).toBe("Match dans 24 heures");
    expect(content.body).toContain("Manche 2");
    expect(content.body).toContain("20:00");
    expect(content.tag).not.toBe(matchStartPush(SIDE, "LOBBY").tag);
  });

  it("annonce un horaire sans délai", () => {
    expect(matchReminderPush({ ...SIDE, bracket: "UPPER", roundNumber: 1, startAt: new Date() }, null).title).toBe(
      "Match programmé",
    );
  });

  it("annonce un horaire changé, en français et en anglais", () => {
    const side = { ...SIDE, bracket: "UPPER", roundNumber: 1, startAt: "2026-09-10T18:00:00Z" };
    expect(matchReminderPush(side, null, "fr", { rescheduled: true }).title).toBe("Match reprogrammé");
    const en = matchReminderPush(side, null, "en", { rescheduled: true, previousStartAt: "2026-09-08T18:00:00Z" });
    expect(en.title).toBe("Match rescheduled");
    expect(en.body).toContain("Kickoff: Thursday, September 10 at 20:00 (Paris time), instead of Tuesday, September 8 at 20:00.");
    expect(en.url).toBe("/en/tournois/7#match-31");
    // Un palier garde son titre et son corps : le changement ne vaut que pour l'annonce.
    const reminder = matchReminderPush(side, "P1D", "fr", { rescheduled: true, previousStartAt: "2026-09-08T18:00:00Z" });
    expect(reminder.title).toBe("Match dans 24 heures");
    expect(reminder.body).not.toContain("au lieu du");
  });
});

describe("matchScheduleClearedPush", () => {
  const side = { ...SIDE, bracket: "LOWER", roundNumber: 2, startAt: "2026-09-10T18:00:00Z" };

  it("dit l'horaire retiré, en français, et remplace l'annonce sur l'appareil", () => {
    expect(matchScheduleClearedPush(side)).toEqual({
      title: "Horaire du match retiré",
      body: "Les Renards contre Team Nova · Coupe BlueGenji, Loser bracket · manche 2. Le coup d'envoi prévu jeudi 10 septembre à 20:00 (heure de Paris) est retiré : le nouvel horaire te sera annoncé.",
      url: "/tournois/7#match-31",
      tag: matchReminderPush(side, null).tag,
    });
  });

  it("se rédige en anglais et mène à la page anglaise", () => {
    const content = matchScheduleClearedPush(side, "en");
    expect(content.title).toBe("Match time removed");
    expect(content.body).toBe(
      "Les Renards vs Team Nova · Coupe BlueGenji, Lower bracket · round 2. The kickoff planned for Thursday, September 10 at 20:00 (Paris time) has been removed: you'll be told the new time.",
    );
    expect(content.url).toBe("/en/tournois/7#match-31");
  });

  it("ne nomme aucun joueur en tournoi individuel", () => {
    for (const locale of ["fr", "en"] as const) {
      const content = matchScheduleClearedPush({ ...side, teamName: "Kiro", opponentName: "Nova", solo: true }, locale);
      expect(`${content.title} ${content.body}`).not.toMatch(/Kiro|Nova/);
    }
  });
});

describe("matchScheduledStaffPush", () => {
  const FIRST = { rescheduled: false };
  const input = {
    tournamentId: 7,
    tournamentName: "Coupe BlueGenji",
    matchId: 31,
    team1Name: "Les Renards",
    team2Name: "Team Nova",
    solo: false,
    bracket: "LOWER",
    roundNumber: 2,
    startAt: "2026-09-10T18:00:00Z",
  };

  it("nomme les deux équipes, la manche et l'heure de Paris, et mène au match", () => {
    const content = matchScheduledStaffPush(input, FIRST);
    expect(content).toEqual({
      title: "Match programmé",
      body: "Les Renards contre Team Nova · Coupe BlueGenji, Loser bracket · manche 2. Coup d'envoi jeudi 10 septembre à 20:00 (heure de Paris).",
      url: "/tournois/7#match-31",
      tag: "rencontre-31-reminder",
    });
    // Un arbitre engagé dans le match ne garde qu'une notification : même étiquette.
    expect(content.tag).toBe(matchReminderPush({ ...SIDE, ...input }, null).tag);
  });

  it("dit « reprogrammé » quand la date en remplace une autre", () => {
    expect(matchScheduledStaffPush(input, { rescheduled: true }).title).toBe("Match reprogrammé");
  });

  it("se rédige en anglais", () => {
    const content = matchScheduledStaffPush(input, { rescheduled: true, previousStartAt: "2026-09-08T18:00:00Z" }, "en");
    expect(content.title).toBe("Match rescheduled");
    expect(content.body).toBe(
      "Les Renards vs Team Nova · Coupe BlueGenji, Lower bracket · round 2. Kickoff: Thursday, September 10 at 20:00 (Paris time), instead of Tuesday, September 8 at 20:00.",
    );
    expect(content.url).toBe("/en/tournois/7#match-31");
    expect(matchScheduledStaffPush(input, FIRST, "en").title).toBe("Match scheduled");
  });

  it("écrit « TBD » pour une place encore vide, comme le plateau et le journal", () => {
    expect(matchScheduledStaffPush({ ...input, team2Name: null }, FIRST).body).toContain("Les Renards contre TBD");
    expect(matchScheduledStaffPush({ ...input, team1Name: null }, FIRST, "en").body).toContain("TBD vs Team Nova");
  });

  it("ne nomme aucun joueur en tournoi individuel", () => {
    for (const locale of ["fr", "en"] as const) {
      const content = matchScheduledStaffPush({ ...input, team1Name: "Kiro", team2Name: "Nova", solo: true }, FIRST, locale);
      expect(`${content.title} ${content.body}`).not.toMatch(/Kiro|Nova/);
    }
    expect(matchScheduledStaffPush({ ...input, solo: true }, FIRST).body).toMatch(/^Un match · /);
    expect(matchScheduledStaffPush({ ...input, solo: true }, FIRST, "en").body).toMatch(/^A match · /);
  });
});

describe("tournoi individuel", () => {
  const solo = { ...SIDE, teamName: "Kiro", opponentName: "Nova", solo: true };

  it("ne nomme aucun joueur : un engagé y est un pseudo", () => {
    for (const content of [
      matchStartPush(solo, "LOBBY"),
      matchStartPush(solo, "LAUNCHED"),
      scoreToConfirmPush(solo),
      matchReminderPush({ ...solo, bracket: "UPPER", roundNumber: 1, startAt: "2026-09-10T18:00:00Z" }, "P1D"),
      matchReminderPush({ ...solo, bracket: "UPPER", roundNumber: 1, startAt: "2026-09-10T18:00:00Z" }, null, "fr", { rescheduled: true }),
      matchScheduledStaffPush(
        { ...solo, team1Name: "Kiro", team2Name: "Nova", bracket: "UPPER", roundNumber: 1, startAt: "2026-09-10T18:00:00Z" },
        { rescheduled: true },
      ),
    ]) {
      expect(content.body).not.toContain("Kiro");
      expect(content.body).not.toContain("Nova");
      expect(content.title).not.toContain("Nova");
    }
    expect(scoreToConfirmPush(solo).body).toContain("Ton adversaire a saisi");
    expect(matchStartPush(solo, "LOBBY").body).toContain("Ton match · Coupe BlueGenji");
  });
});

describe("rédacteurs", () => {
  it("score à confirmer : nomme l'adversaire qui a saisi", () => {
    const content = scoreToConfirmPush(SIDE);
    expect(content.body).toContain("Team Nova a saisi");
    expect(content.url).toBe("/tournois/7#match-31");
  });

  it("coup d'envoi : mène au tournoi", () => {
    expect(tournamentStartPush({ tournamentId: 7, tournamentName: "Coupe" }).url).toBe("/tournois/7");
  });

  it("demande d'adhésion : mène à la fiche, sans nommer le joueur", () => {
    const content = teamJoinRequestPush({ teamId: 5, teamName: "Les Glaciers" });
    expect(content.url).toBe("/equipes/5");
    expect(content.body).toContain("Un joueur");
  });

  it("signalement : mène à la page des personnes visées", () => {
    const content = contentReportPush({ reportId: 12, category: "COPYRIGHT" });
    expect(content.url).toBe("/signalements/12");
  });

  it("modération : dit l'objet, la décision et le recours", () => {
    const hidden = moderationPush({ kind: "HIDDEN", teamName: "Les Glaciers", teamId: 5, reportId: 12 });
    expect(hidden.body).toContain("Le logo de Les Glaciers a été masqué");
    expect(hidden.body).toContain("contester");
    expect(hidden.url).toBe("/signalements/12");

    const removed = moderationPush({ kind: "REMOVED", reportId: null });
    expect(removed.body).toContain("Ton avatar a été supprimé");
    expect(removed.url).toBe("/profil");

    const restored = moderationPush({ kind: "RESTORED", teamName: "X", teamId: 5, reportId: null });
    expect(restored.body).toContain("rétabli");
    expect(restored.url).toBe("/equipes/5");
  });

  it("données : nomme le premier changement et compte les autres", () => {
    expect(privacyChangePush(["A"]).body).toMatch(/^A\. /);
    expect(privacyChangePush(["A", "B"]).body).toContain("(et 1 autre)");
    // Une information : la notification ne demande ni réponse ni accord.
    expect(privacyChangePush(["A"]).body).not.toMatch(/réponse|accept|accord/);
    expect(privacyChangePush(["A", "B", "C"]).body).toContain("(et 2 autres)");
    expect(privacyChangePush([]).url).toBe("/rgpd");
  });

  it("arbitrage : reprend la ligne sans Markdown, sans jamais en tirer le lien", () => {
    const content = refereeAlertPush("⚠️ **Conflit de score** — Coupe · https://site.test/tournois/4", "score_conflict-40");
    expect(content.body).toBe("⚠️ Conflit de score — Coupe ·");
    expect(content.url).toBe("/tournois");
    expect(refereeAlertPush("sans lien", "k").url).toBe("/tournois");
  });

  it("arbitrage : une étiquette par alerte, pour que deux conflits d'un même tournoi ne se remplacent pas", () => {
    const line = "⚠️ **Conflit de score** — Coupe BlueGenji · https://site.test/tournois/4";
    expect(refereeAlertPush(line, "score_conflict-40").tag).not.toBe(refereeAlertPush(line, "score_conflict-41").tag);
    expect(refereeAlertPush(line, "score_conflict-40").tag).toBe(refereeAlertPush(line, "score_conflict-40").tag);
  });

  it("modération reçue : distingue signalement et contestation", () => {
    expect(staffReportPush({ reportId: 1, contest: false }).title).toBe("Nouveau signalement");
    expect(staffReportPush({ reportId: 1, contest: true }).title).toBe("Contestation reçue");
  });
});

describe("stripMarkdown", () => {
  it("retire gras, code, citations et liens", () => {
    expect(stripMarkdown("**a** `b` > c _d_ https://x.test/y")).toBe("a b c d");
  });
});
