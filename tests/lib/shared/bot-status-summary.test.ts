import { describe, expect, it } from "@jest/globals";
import {
  botStatusDisplay,
  botStatusSummary,
  resolveBotStatusLabel,
} from "@/lib/shared/bot-status-summary";

/**
 * La case « Status » de `/bot` annonçait une phrase fixe (« Tous les modules
 * nominaux ») sous une valeur qui, elle, varie — jusqu'à dire « nominaux » sous
 * un `DOWN`, et à parler de modules après le retrait de la grille qui les
 * montrait.
 */
describe("botStatusSummary", () => {
  it("décrit chacun des trois états du bot", () => {
    expect(botStatusSummary("OPERATIONAL")).toContain("répondent");
    expect(botStatusSummary("DEGRADED")).toContain("dégradé");
    expect(botStatusSummary("DOWN")).toContain("ne répond plus");
  });

  it("ne parle plus de modules — la page n'en montre aucun", () => {
    for (const status of ["OPERATIONAL", "DEGRADED", "DOWN", null, "?"]) {
      expect(botStatusSummary(status)).not.toMatch(/module/i);
    }
  });

  it("n'est jamais vide, quoi que le bot réponde", () => {
    // `fetchBotStatus` fait un simple `as BotStatus` : un état ajouté côté bot,
    // ou une minuscule, rendait `undefined` — une ligne blanche sans erreur.
    for (const status of ["MAINTENANCE", "operational", "", null, undefined, "toString"]) {
      expect(botStatusSummary(status).length).toBeGreaterThan(0);
    }
  });

  it("distingue « rien dit » de « dit quelque chose d'illisible »", () => {
    // La case montre la valeur reçue en gros : sous un `MAINTENANCE` affiché,
    // « le bot n'a pas répondu » serait la phrase fixe qui contredit sa valeur,
    // c'est-à-dire exactement le défaut que ce module retire.
    expect(botStatusSummary("MAINTENANCE")).not.toBe(botStatusSummary(null));
    expect(botStatusSummary(null)).toContain("n'a pas répondu");
    expect(botStatusSummary("MAINTENANCE")).toContain("ne sait pas lire");
    expect(botStatusSummary("MAINTENANCE")).not.toBe(botStatusSummary("OPERATIONAL"));
  });
});

describe("resolveBotStatusLabel", () => {
  it("laisse passer les trois valeurs connues", () => {
    expect(resolveBotStatusLabel("OPERATIONAL")).toBe("OPERATIONAL");
    expect(resolveBotStatusLabel("DEGRADED")).toBe("DEGRADED");
    expect(resolveBotStatusLabel("DOWN")).toBe("DOWN");
  });

  it("appelle « injoignable » l'absence de réponse", () => {
    for (const status of ["", null, undefined]) {
      expect(resolveBotStatusLabel(status)).toBe("UNREACHABLE");
    }
  });

  it("appelle « illisible » une réponse qu'elle ne sait pas lire, prototype compris", () => {
    for (const status of ["operational", "MAINTENANCE", "constructor", "toString"]) {
      expect(resolveBotStatusLabel(status)).toBe("UNREADABLE");
    }
  });
});

describe("botStatusDisplay", () => {
  it("montre un tiret quand le bot n'a pas répondu", () => {
    expect(botStatusDisplay(null)).toBe("—");
    expect(botStatusDisplay(undefined)).toBe("—");
  });

  it("montre l'état reçu tel quel, même inconnu — c'est une information", () => {
    expect(botStatusDisplay("OPERATIONAL")).toBe("OPERATIONAL");
    expect(botStatusDisplay("MAINTENANCE")).toBe("MAINTENANCE");
  });
});
