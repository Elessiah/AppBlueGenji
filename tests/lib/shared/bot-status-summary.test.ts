import { describe, expect, it } from "@jest/globals";
import {
  botStatusDisplay,
  botStatusOf,
  botStatusSummary,
  resolveBotStatusLabel,
} from "@/lib/shared/bot-status-summary";
import type { BotStatus } from "@/lib/shared/types";

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

  it("appelle « injoignable » l'absence de réponse, et elle seule", () => {
    for (const status of [null, undefined]) {
      expect(resolveBotStatusLabel(status)).toBe("UNREACHABLE");
    }
    // La chaîne vide est une **réponse** reçue dont l'état est illisible : la
    // ranger avec l'absence de réponse remettrait « le bot n'a pas répondu »
    // sous une case qui affiche, juste à côté, la version et la latence tirées
    // de cette réponse-là.
    expect(resolveBotStatusLabel("")).toBe("UNREADABLE");
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

describe("botStatusOf", () => {
  const payload = (overrides: Partial<BotStatus> = {}) =>
    ({ status: "OPERATIONAL", ...overrides }) as BotStatus;

  it("rend l'état quand le bot en a donné un", () => {
    expect(botStatusOf(payload())).toBe("OPERATIONAL");
    expect(botStatusOf(payload({ status: "DOWN" }))).toBe("DOWN");
  });

  it("ne rend `null` que faute de réponse", () => {
    expect(botStatusOf(null)).toBeNull();
    expect(botStatusOf(undefined)).toBeNull();
  });

  it("rend une chaîne vide sur une réponse sans état lisible", () => {
    // `fetchBotStatus` fait un `as BotStatus` sur du JSON reçu : le champ est
    // typé, il n'est pas garanti.
    for (const broken of [{}, { status: null }, { status: 42 }, { status: {} }]) {
      expect(botStatusOf(broken as unknown as BotStatus)).toBe("");
    }
  });

  it("sépare les deux silences jusqu'au sous-titre affiché", () => {
    // C'est tout l'objet de la fonction : une réponse amputée de son seul champ
    // `status` affichait « Le bot n'a pas répondu à la page » **à côté** de la
    // version et de la latence venues de cette même réponse.
    expect(botStatusSummary(botStatusOf(null))).toContain("n'a pas répondu");
    expect(botStatusSummary(botStatusOf({} as unknown as BotStatus))).toContain(
      "ne sait pas lire",
    );
  });
});
