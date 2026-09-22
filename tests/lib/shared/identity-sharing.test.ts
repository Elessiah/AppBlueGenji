import { describe, expect, it } from "@jest/globals";
import {
  BLIZZARD_BATTLETAG_NOTICE,
  DISCORD_CERTIFICATION_UNDO,
  DISCORD_TAG_AUDIENCE,
  DISCORD_TAG_UNVERIFIED_AUDIENCE,
  GAME_TAG_NOTICE,
  discordCertifiedNotice,
} from "@/lib/shared/identity-sharing";

/**
 * Ces phrases sont des **promesses** faites au joueur : qui lit son tag, ce que
 * Blizzard réécrit, à quoi servent ses identifiants de jeu. Deux copies auraient
 * divergé au premier ajustement, et la divergence porterait sur ce que le site
 * s'engage à faire — un écart qu'aucun test d'intégration ne rattrape et qu'un
 * joueur découvre en constatant le contraire.
 */
describe("DISCORD_TAG_AUDIENCE", () => {
  it("nomme les deux publics", () => {
    expect(DISCORD_TAG_AUDIENCE).toMatch(/administrateurs/i);
    expect(DISCORD_TAG_AUDIENCE).toMatch(/arbitres/i);
  });

  it("borne l'arbitrage au tournoi — le besoin naît du tournoi et s'éteint avec lui", () => {
    expect(DISCORD_TAG_AUDIENCE).toMatch(/tant que tu es engagé/i);
  });

  it("ferme la liste : le tag n'est jamais public", () => {
    expect(DISCORD_TAG_AUDIENCE).toMatch(/jamais personne d'autre/i);
  });
});

describe("DISCORD_TAG_UNVERIFIED_AUDIENCE", () => {
  it("dit que personne ne le voit, administrateurs compris", () => {
    expect(DISCORD_TAG_UNVERIFIED_AUDIENCE).toMatch(/pas même les administrateurs/i);
  });

  it("dit ce qu'on y perd, pas seulement ce qu'on y gagne", () => {
    expect(DISCORD_TAG_UNVERIFIED_AUDIENCE).toMatch(/ne peut donc pas te joindre/i);
  });
});

describe("DISCORD_CERTIFICATION_UNDO", () => {
  it("nomme le seul geste qui défait la certification", () => {
    // Il n'existe aucune route de décertification : modifier le tag *est* le
    // geste, et le taire laisserait le lecteur sans issue.
    expect(DISCORD_CERTIFICATION_UNDO).toMatch(/modifier ton tag/i);
    expect(DISCORD_CERTIFICATION_UNDO).toMatch(/annule la certification/i);
  });
});

describe("discordCertifiedNotice", () => {
  it("laisse l'entrée en matière à l'écran, et jamais la promesse", () => {
    const login = discordCertifiedNotice("Te connecter par Discord certifie ce tag");
    const profile = discordCertifiedNotice("Tag certifié");

    expect(login.startsWith("Te connecter par Discord certifie ce tag :")).toBe(true);
    expect(profile.startsWith("Tag certifié :")).toBe(true);
    for (const notice of [login, profile]) {
      expect(notice).toContain(DISCORD_TAG_AUDIENCE);
      expect(notice).toContain(DISCORD_CERTIFICATION_UNDO);
    }
  });
});

describe("BLIZZARD_BATTLETAG_NOTICE", () => {
  it("prévient que la saisie sera remplacée — sinon le champ change tout seul", () => {
    expect(BLIZZARD_BATTLETAG_NOTICE).toMatch(/à chaque connexion/i);
    expect(BLIZZARD_BATTLETAG_NOTICE).toMatch(/remplacée/i);
  });
});

describe("GAME_TAG_NOTICE", () => {
  it("dit à quoi les tags de jeu ne servent pas", () => {
    expect(GAME_TAG_NOTICE).toMatch(/jamais pour des statistiques/i);
  });
});
