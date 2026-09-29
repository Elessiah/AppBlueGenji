import { describe, expect, it } from "@jest/globals";
import {
  contentReportPush,
  matchReminderPush,
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
      { ...SIDE, roundLabel: "Tour 2", startAt: "2026-09-10T18:00:00Z" },
      "1 heure",
    );
    expect(content.title).toBe("Match dans 1 heure");
    expect(content.body).toContain("Tour 2");
    expect(content.body).toContain("20:00");
    expect(content.tag).not.toBe(matchStartPush(SIDE, "LOBBY").tag);
  });

  it("annonce un horaire sans délai", () => {
    expect(matchReminderPush({ ...SIDE, roundLabel: "Tour 1", startAt: new Date() }, null).title).toBe(
      "Match programmé",
    );
  });
});

describe("tournoi individuel", () => {
  const solo = { ...SIDE, teamName: "Kiro", opponentName: "Nova", solo: true };

  it("ne nomme aucun joueur : un engagé y est un pseudo", () => {
    for (const content of [
      matchStartPush(solo, "LOBBY"),
      matchStartPush(solo, "LAUNCHED"),
      scoreToConfirmPush(solo),
      matchReminderPush({ ...solo, roundLabel: "Tour 1", startAt: "2026-09-10T18:00:00Z" }, "1 heure"),
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

  it("arbitrage : reprend la ligne sans Markdown, et mène à son lien", () => {
    const content = refereeAlertPush("⚠️ **Conflit de score** — Coupe · https://site.test/tournois/4", "score_conflict-40");
    expect(content.body).toBe("⚠️ Conflit de score — Coupe ·");
    expect(content.url).toBe("https://site.test/tournois/4");
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
