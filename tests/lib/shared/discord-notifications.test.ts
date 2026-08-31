import { describe, expect, it } from "@jest/globals";
import {
  ISSUE_REPORT_MAX_LENGTH,
  ISSUE_REPORT_MIN_LENGTH,
  MATCH_REMINDER_HORIZON_MS,
  MATCH_REMINDER_LOOKAHEAD_MS,
  MATCH_REMINDER_OFFSETS,
  MATCH_SEEN_KEY,
  buildIssueReportMessage,
  buildMatchReminderMessage,
  buildMatchScheduleAnnouncement,
  dueMatchReminders,
  formatMatchStart,
  matchRoundLabel,
  normalizeIssueReportMessage,
  openedMatchReminders,
} from "@/lib/shared/discord-notifications";

const START = new Date("2026-09-10T18:00:00Z");
const MINUTE = 60_000;

/** Instant situé `minutes` avant le coup d'envoi. */
function before(minutes: number): Date {
  return new Date(START.getTime() - minutes * MINUTE);
}

describe("dueMatchReminders", () => {
  it("ne déclenche rien hors de toute fenêtre", () => {
    expect(dueMatchReminders(START, before(8 * 24 * 60))).toEqual([]);
  });

  it("déclenche le palier « une semaine » à son ouverture", () => {
    expect(dueMatchReminders(START, before(7 * 24 * 60)).map((o) => o.key)).toEqual(["P7D"]);
  });

  it("déclenche le palier 24 h quand la semaine est passée", () => {
    expect(dueMatchReminders(START, before(24 * 60)).map((o) => o.key)).toEqual(["P1D"]);
    expect(dueMatchReminders(START, before(5 * 60)).map((o) => o.key)).toEqual(["P1D"]);
  });

  it("déclenche le palier 1 h jusqu'au coup d'envoi", () => {
    expect(dueMatchReminders(START, before(60)).map((o) => o.key)).toEqual(["PT1H"]);
    expect(dueMatchReminders(START, before(1)).map((o) => o.key)).toEqual(["PT1H"]);
  });

  it("n'envoie qu'un seul rappel pour un match programmé à la dernière minute", () => {
    // Le piège : sans fenêtres, les trois paliers seraient dus d'un coup.
    expect(dueMatchReminders(START, before(30)).map((o) => o.key)).toEqual(["PT1H"]);
  });

  it("ne déclenche plus rien une fois le match commencé", () => {
    expect(dueMatchReminders(START, START)).toEqual([]);
    expect(dueMatchReminders(START, new Date(START.getTime() + MINUTE))).toEqual([]);
  });

  it("saute un palier déjà envoyé", () => {
    expect(dueMatchReminders(START, before(24 * 60), ["P1D"])).toEqual([]);
  });

  it("ignore un palier envoyé qui ne concerne pas la fenêtre courante", () => {
    expect(dueMatchReminders(START, before(30), ["P7D", "P1D"]).map((o) => o.key)).toEqual([
      "PT1H",
    ]);
  });

  it("accepte une date sous forme de chaîne", () => {
    expect(dueMatchReminders(START.toISOString(), before(60)).map((o) => o.key)).toEqual(["PT1H"]);
  });

  it("ne déclenche rien sans horaire ni sur une date illisible", () => {
    expect(dueMatchReminders(null, before(60))).toEqual([]);
    expect(dueMatchReminders("pas une date", before(60))).toEqual([]);
  });

  it("expose un horizon égal au plus grand palier", () => {
    expect(MATCH_REMINDER_HORIZON_MS).toBe(7 * 24 * 60 * MINUTE);
  });

  it("lit une journée plus loin que l'horizon, pour que le premier palier soit atteignable", () => {
    // Une fenêtre de lecture égale à l'horizon ferait découvrir chaque manche à
    // la seconde où le palier « une semaine » s'ouvre : il ne partirait jamais.
    expect(MATCH_REMINDER_LOOKAHEAD_MS).toBeGreaterThan(MATCH_REMINDER_HORIZON_MS);
    expect(MATCH_REMINDER_LOOKAHEAD_MS).toBe(8 * 24 * 60 * MINUTE);
  });

  it("garde les paliers ordonnés du plus lointain au plus proche", () => {
    const minutes = MATCH_REMINDER_OFFSETS.map((o) => o.minutesBefore);
    expect([...minutes].sort((a, b) => b - a)).toEqual(minutes);
  });
});

describe("openedMatchReminders", () => {
  it("ne retient rien tant qu'aucune fenêtre n'est ouverte", () => {
    expect(openedMatchReminders(START, before(8 * 24 * 60))).toEqual([]);
  });

  it("retient le palier « une semaine » dès son ouverture", () => {
    expect(openedMatchReminders(START, before(7 * 24 * 60)).map((o) => o.key)).toEqual(["P7D"]);
  });

  it("retient tout ce qui est dépassé pour une date posée à trois jours", () => {
    expect(openedMatchReminders(START, before(3 * 24 * 60)).map((o) => o.key)).toEqual(["P7D"]);
  });

  it("retient la semaine et les 24 h pour une date posée à cinq heures", () => {
    expect(openedMatchReminders(START, before(5 * 60)).map((o) => o.key)).toEqual(["P7D", "P1D"]);
  });

  it("retient les trois paliers pour une date posée à trente minutes", () => {
    expect(openedMatchReminders(START, before(30)).map((o) => o.key)).toEqual([
      "P7D",
      "P1D",
      "PT1H",
    ]);
  });

  it("ne retient rien sans horaire ni sur une date illisible", () => {
    expect(openedMatchReminders(null, before(60))).toEqual([]);
    expect(openedMatchReminders("pas une date", before(60))).toEqual([]);
  });

  it("expose une marque d'observation distincte des paliers", () => {
    expect(MATCH_REMINDER_OFFSETS.map((o) => o.key as string)).not.toContain(MATCH_SEEN_KEY);
  });
});

describe("buildMatchScheduleAnnouncement", () => {
  const context = {
    tournamentName: "Coupe BlueGenji",
    tournamentUrl: "https://bluegenji.fr/tournois/7",
    teamName: "Les Renards",
    opponentName: "Team Nova",
    roundLabel: "Manche 2",
    startAt: START,
  };

  it("porte la date plutôt qu'un délai, et annonce le prochain rappel", () => {
    const message = buildMatchScheduleAnnouncement(context, [
      MATCH_REMINDER_OFFSETS[1],
      MATCH_REMINDER_OFFSETS[2],
    ]);
    expect(message).toContain("**Match programmé**");
    expect(message).toContain("20:00");
    // Le prochain rappel est le plus lointain des paliers restants, pas le plus proche.
    expect(message).toContain("Prochain rappel : 24 heures");
    expect(message).not.toContain("dans une semaine");
  });

  it("ne promet aucun rappel quand il n'en reste plus", () => {
    const message = buildMatchScheduleAnnouncement(context, []);
    expect(message).not.toContain("Prochain rappel");
    expect(message).toContain("**Les Renards** contre **Team Nova**");
  });
});

describe("buildMatchReminderMessage", () => {
  const context = {
    tournamentName: "Coupe BlueGenji",
    tournamentUrl: "https://bluegenji.fr/tournois/7",
    teamName: "Les Renards",
    opponentName: "Team Nova",
    roundLabel: "Manche 2",
    startAt: START,
  };

  it("nomme le palier, les deux engagées et l'horaire", () => {
    const message = buildMatchReminderMessage(MATCH_REMINDER_OFFSETS[2], context);
    expect(message).toContain("dans 1 heure");
    expect(message).toContain("Coupe BlueGenji · Manche 2");
    expect(message).toContain("**Les Renards** contre **Team Nova**");
    expect(message).toContain("https://bluegenji.fr/tournois/7");
  });

  it("omet le lien quand l'app ignore son URL publique", () => {
    const message = buildMatchReminderMessage(MATCH_REMINDER_OFFSETS[0], {
      ...context,
      tournamentUrl: null,
    });
    expect(message).not.toContain("http");
    expect(message).toContain("dans une semaine");
  });
});

describe("formatMatchStart", () => {
  it("rend l'heure de Paris, pas celle du serveur", () => {
    // 18:00 UTC en septembre = 20:00 à Paris.
    expect(formatMatchStart(START)).toContain("20:00");
  });
});

describe("matchRoundLabel", () => {
  it("distingue les parties de plateau", () => {
    expect(matchRoundLabel("UPPER", 3)).toBe("Manche 3");
    expect(matchRoundLabel("LOWER", 2)).toBe("Loser bracket · manche 2");
    expect(matchRoundLabel("GRAND", 1)).toBe("Grande finale");
    expect(matchRoundLabel("THIRD_PLACE", 4)).toBe("Petite finale");
  });

  it("retombe sur la manche pour un plateau inconnu", () => {
    expect(matchRoundLabel("AUTRE", 5)).toBe("Manche 5");
  });
});

describe("normalizeIssueReportMessage", () => {
  it("rogne les bords d'un message valide", () => {
    expect(normalizeIssueReportMessage("  adversaire absent depuis 20 min  ")).toBe(
      "adversaire absent depuis 20 min",
    );
  });

  it("refuse un message trop court, une fois rogné", () => {
    expect(normalizeIssueReportMessage("???")).toBeNull();
    expect(normalizeIssueReportMessage(`  ${"a".repeat(ISSUE_REPORT_MIN_LENGTH - 1)}  `)).toBeNull();
  });

  it("accepte pile la longueur minimale", () => {
    const message = "a".repeat(ISSUE_REPORT_MIN_LENGTH);
    expect(normalizeIssueReportMessage(message)).toBe(message);
  });

  it("refuse un message trop long", () => {
    expect(normalizeIssueReportMessage("a".repeat(ISSUE_REPORT_MAX_LENGTH + 1))).toBeNull();
  });

  it("refuse ce qui n'est pas une chaîne", () => {
    expect(normalizeIssueReportMessage(null)).toBeNull();
    expect(normalizeIssueReportMessage(42)).toBeNull();
    expect(normalizeIssueReportMessage(undefined)).toBeNull();
  });
});

describe("buildIssueReportMessage", () => {
  const context = {
    tournamentName: "Coupe BlueGenji",
    tournamentUrl: "https://bluegenji.fr/tournois/7",
    reporterPseudo: "Kiro",
    entrantName: "Les Renards",
    matchLabel: "Manche 2 — Les Renards vs Team Nova (#31)",
    message: "adversaire absent depuis 20 minutes",
  };

  it("situe le signalement, son auteur et sa manche", () => {
    const message = buildIssueReportMessage(context);
    expect(message).toContain("Tournoi : Coupe BlueGenji");
    expect(message).toContain("Match : Manche 2 — Les Renards vs Team Nova (#31)");
    expect(message).toContain("Auteur : Kiro (Les Renards)");
    expect(message).toContain("adversaire absent depuis 20 minutes");
  });

  it("annonce une portée « tournoi entier » sans manche", () => {
    const message = buildIssueReportMessage({ ...context, matchLabel: null });
    expect(message).toContain("Portée : tournoi entier");
    expect(message).not.toContain("Match :");
  });

  it("omet le lien sans URL publique", () => {
    expect(buildIssueReportMessage({ ...context, tournamentUrl: null })).not.toContain("http");
  });
});
