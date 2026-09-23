import { describe, expect, it } from "@jest/globals";
import {
  botStatusDisplay,
  botStatusOf,
  botStatusSummary,
  botUptimeLabel,
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

describe("botUptimeLabel — la case « Uptime » se teste enfin", () => {
  /**
   * Tout ce calcul vivait dans le `useEffect` de `BotStatusStrip`, donc hors
   * de portée des tests de rendu : `renderToStaticMarkup` n'exécute aucun
   * effet, et le cas « horodatages absents » n'observait jamais que l'état
   * initial de la case. La remise au tiret, la borne à zéro et le premier
   * affichage immédiat pouvaient tous être retirés sans qu'une assertion
   * bronche.
   */
  const startupTs = 1_700_000_000_000;
  const uptimeMs = 90_061_000; // 1j 01h 01m 01s

  it("compte depuis l'instant où la charge a été prise", () => {
    expect(botUptimeLabel({ startupTs, uptimeMs } as never, startupTs + uptimeMs)).toBe(
      "1j 1h 01m 01s",
    );
  });

  it("avance avec l'horloge du visiteur", () => {
    expect(
      botUptimeLabel({ startupTs, uptimeMs } as never, startupTs + uptimeMs + 59_000),
    ).toBe("1j 1h 02m 00s");
  });

  it("pose des zéros devant les minutes et les secondes", () => {
    const label = botUptimeLabel({ startupTs, uptimeMs: 5_000 } as never, startupTs + 5_000);
    expect(label).toBe("0j 0h 00m 05s");
  });

  it("rend `null` plutôt que « NaNj NaNh NaNm »", () => {
    // Les deux horodatages arrivent par un `as BotStatus` sur du JSON reçu :
    // sans eux, le calcul ne lève pas, il se propage.
    expect(botUptimeLabel(null, Date.now())).toBeNull();
    expect(botUptimeLabel({} as never, Date.now())).toBeNull();
    expect(botUptimeLabel({ startupTs } as never, Date.now())).toBeNull();
    expect(botUptimeLabel({ uptimeMs } as never, Date.now())).toBeNull();
    expect(botUptimeLabel({ startupTs: "hier", uptimeMs } as never, Date.now())).toBeNull();
    expect(
      botUptimeLabel({ startupTs, uptimeMs: Number.NaN } as never, Date.now()),
    ).toBeNull();
  });

  it("borne la dérive des horloges à zéro", () => {
    // L'horloge du visiteur et celle du bot n'ont aucune raison de concorder :
    // une avance de quelques secondes rendait « -1j 23h 59m ».
    const label = botUptimeLabel(
      { startupTs, uptimeMs: 1_000 } as never,
      startupTs - 3_600_000,
    );
    expect(label).toBe("0j 0h 00m 00s");
    expect(label).not.toContain("-");
  });

  it("ne compte que depuis `startupTs` — `uptimeMs` s'annule dans la formule", () => {
    // La forme héritée (`uptimeMs/1000 + (now − startupTs − uptimeMs)/1000`)
    // se lisait comme « la durée annoncée, plus le temps écoulé depuis » ;
    // `uptimeMs` s'y annule. Deux charges qui ne diffèrent que par lui rendent
    // donc la **même** durée, et le savoir évite d'aller chercher dans ce champ
    // une précision qu'il n'apporte pas.
    const now = 1_700_000_000_000;
    const base = now - 3_600_000;
    const court = botUptimeLabel({ startupTs: base, uptimeMs: 1 } as never, now);
    const long = botUptimeLabel({ startupTs: base, uptimeMs: 3_600_000 } as never, now);
    expect(court).toBe(long);
    expect(court).toBe("0j 1h 00m 00s");
  });

  it("exige tout de même `uptimeMs`, absent du calcul mais pas de la charge", () => {
    // Une charge à laquelle il manque un champ du type est une charge qu'on ne
    // sait pas lire : le panneau dit « — » plutôt que d'afficher un chiffre
    // tiré de la moitié qui reste. C'est un choix, pas une conséquence du
    // calcul — d'où ce cas, qui le fige.
    const now = 1_700_000_000_000;
    expect(botUptimeLabel({ startupTs: now - 3_600_000 } as never, now)).toBeNull();
  });

  it("ne rend jamais NaN quel que soit l'instant demandé", () => {
    for (const now of [0, startupTs, startupTs + 1e12, Number.MAX_SAFE_INTEGER]) {
      const label = botUptimeLabel({ startupTs, uptimeMs } as never, now);
      expect(label).not.toContain("NaN");
      expect(label).not.toContain("Infinity");
    }
  });
});
