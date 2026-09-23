import { describe, expect, it } from "@jest/globals";
import {
  botRelayAccessibleLabel,
  resolveBotRelayState,
} from "@/lib/shared/bot-relay-status";

/**
 * La colonne d'état du tableau des serveurs de `/bot` rendait `OK` / `LAG` /
 * `OFF` — le vocabulaire du bot, pas celui du lecteur. La traduction vit
 * désormais dans un module pur, donc elle se teste sans rendu.
 */
describe("resolveBotRelayState", () => {
  it("dit les trois états connus en français", () => {
    expect(resolveBotRelayState("ok").label).toBe("● À jour");
    expect(resolveBotRelayState("lag").label).toBe("● Retard");
    expect(resolveBotRelayState("off").label).toBe("○ Hors ligne");
  });

  it("n'emploie plus le vocabulaire du bot", () => {
    for (const status of ["ok", "lag", "off"]) {
      const { label, hint } = resolveBotRelayState(status);
      expect(label).not.toMatch(/OK|LAG|OFF/);
      expect(hint.length).toBeGreaterThan(0);
    }
  });

  it("garde un ton par état connu, pris au registre et jamais à la chaîne reçue", () => {
    expect(resolveBotRelayState("ok").tone).toBe("ok");
    expect(resolveBotRelayState("lag").tone).toBe("lag");
    expect(resolveBotRelayState("off").tone).toBe("off");
  });

  it("nomme un état inconnu plutôt que de rendre une cellule vide", () => {
    // `fetchBotServers` fait un simple `as` sur du JSON reçu par le réseau :
    // rien ne garantit à l'exécution que `status` vaut l'une des trois valeurs.
    for (const unknown of ["degraded", "starting", "OK", "", " ", "toString"]) {
      const state = resolveBotRelayState(unknown);
      expect(state.label).toBe("● Inconnu");
      expect(state.tone).toBe("unknown");
    }
  });

  it("ne ment pas en « Hors ligne » sur un état qu'elle ne connaît pas", () => {
    // Le bot a répondu ; c'est la page qui ne sait pas lire.
    expect(resolveBotRelayState("degraded").tone).not.toBe("off");
  });

  it("traite l'absence de valeur comme un état inconnu", () => {
    expect(resolveBotRelayState(null).tone).toBe("unknown");
    expect(resolveBotRelayState(undefined).tone).toBe("unknown");
  });

  it("ne se laisse pas contaminer par le prototype d'objet", () => {
    expect(resolveBotRelayState("constructor").label).toBe("● Inconnu");
  });
});

describe("botRelayAccessibleLabel", () => {
  it("commence par le texte visible — un `aria-label` le remplace (WCAG 2.5.3)", () => {
    for (const status of ["ok", "lag", "off", "inconnu"]) {
      const state = resolveBotRelayState(status);
      const visible = state.label.replace(/^[●○]\s*/u, "");
      expect(botRelayAccessibleLabel(state).startsWith(visible)).toBe(true);
    }
  });

  it("porte la définition, que le `title` seul n'apporte ni au doigt ni au clavier", () => {
    const state = resolveBotRelayState("lag");
    expect(botRelayAccessibleLabel(state)).toContain(state.hint);
  });

  it("laisse la puce au dessin", () => {
    expect(botRelayAccessibleLabel(resolveBotRelayState("ok"))).not.toMatch(/[●○]/);
  });
});
