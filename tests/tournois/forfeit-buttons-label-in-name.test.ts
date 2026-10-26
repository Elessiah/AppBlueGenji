import { describe, expect, it } from "@jest/globals";
import frActions from "@/messages/fr/tournamentActions.json";
import enActions from "@/messages/en/tournamentActions.json";

/**
 * Nom accessible des boutons « Abandonner » / « Annuler l'abandon » des
 * classements (WCAG 2.5.3, CLAUDE.md « Nom accessible = contient son texte
 * visible ») : un utilisateur de commande vocale dit le texte qu'il voit — le
 * nom doit le contenir d'un seul tenant, dans les deux langues.
 */
const LOCALES = [
  ["fr", frActions],
  ["en", enActions],
] as const;

const withName = (template: string) => template.replace("{name}", "Frost Alliance");

describe("nom accessible des boutons d'abandon", () => {
  for (const [locale, actions] of LOCALES) {
    const visibleForfeit = actions.forfeit.button.label;
    const visibleCancel = actions.forfeitCancel.button;

    it(`${locale} : le nom de « Annuler l'abandon » contient son texte visible`, () => {
      expect(withName(actions.forfeitCancel.buttonAria)).toContain(visibleCancel);
    });

    it(`${locale} : le nom d'« Abandonner » contient son texte visible, en Survie comme en suisse`, () => {
      expect(withName(actions.forfeit.button.otherAriaSurvival)).toContain(visibleForfeit);
      expect(withName(actions.forfeit.button.otherAriaSwiss)).toContain(visibleForfeit);
      expect(withName(actions.forfeit.button.selfAria)).toContain(visibleForfeit);
    });
  }
});

describe("confirmation de l'annulation d'un abandon", () => {
  for (const [locale, actions] of LOCALES) {
    it(`${locale} : ne promet pas l'appariement sans réserve — le rejeu peut éliminer l'engagé`, () => {
      for (const body of [actions.forfeitCancel.body.TEAM, actions.forfeitCancel.body.SOLO]) {
        expect(body).toMatch(locale === "fr" ? /sauf si/ : /unless/);
      }
    });
  }
});
