import { describe, expect, it } from "@jest/globals";
import {
  BLIZZARD_BATTLETAG_NOTICE,
  DISCORD_CERTIFICATION_UNDO,
  DISCORD_PLAYER_VISIBILITY_NOTICE,
  DISCORD_PLAYER_VISIBILITY_PENDING,
  DISCORD_TAG_AUDIENCE,
  DISCORD_TAG_UNVERIFIED_AUDIENCE,
  GAME_TAG_NOTICE,
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

  it("nomme les autres joueurs comme un public choisi, pas acquis", () => {
    expect(DISCORD_TAG_AUDIENCE).toMatch(/les autres joueurs, seulement si tu le rends visible/i);
  });
});

describe("DISCORD_PLAYER_VISIBILITY_NOTICE", () => {
  it("dit que la certification ouvre le tag à l'organisation, pas aux joueurs", () => {
    // C'est la phrase qui manquait : l'ancienne renvoyait le tag à « ses propres
    // réglages », comme si la certification décidait aussi pour les joueurs.
    expect(DISCORD_PLAYER_VISIBILITY_NOTICE).toMatch(/à l'organisation/i);
    expect(DISCORD_PLAYER_VISIBILITY_NOTICE).toMatch(/pas aux autres joueurs/i);
  });

  it("nomme la case qui ouvre le tag aux joueurs", () => {
    expect(DISCORD_PLAYER_VISIBILITY_NOTICE).toContain("« Tag Discord »");
  });

  it("dit qu'un tag non certifié reste masqué, case cochée ou non", () => {
    expect(DISCORD_PLAYER_VISIBILITY_NOTICE).toMatch(/non certifié reste masqué/i);
    expect(DISCORD_PLAYER_VISIBILITY_PENDING).toMatch(/pas certifié/i);
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
    // Le geste nommé doit **exister à l'écran** : un tag certifié appartient à
    // un compte rattaché, dont `/profil` rend le champ en lecture seule. « Le
    // modifier » n'est donc plus à la portée du joueur, « le retirer » l'est.
    expect(DISCORD_CERTIFICATION_UNDO).toMatch(/retire ton tag/i);
    expect(DISCORD_CERTIFICATION_UNDO).toMatch(/mon profil/i);
    expect(DISCORD_CERTIFICATION_UNDO).not.toMatch(/modifier ton tag/i);
  });
});

describe("Le module n'expose que des chaînes", () => {
  it("ne garde aucun assembleur sans appelant", async () => {
    // Un `discordCertifiedNotice(lead)` a existé ici, pour coller une entrée en
    // matière devant la promesse. Aucun des deux écrans n'a pu s'en servir : la
    // connexion met du `<strong>` dans son entrée en matière (une fonction qui
    // rend une chaîne ne peut pas la porter), et le profil énonce le cas
    // certifié par la **phrase du verrou**, qui dit en plus le rattachement.
    // Une aide que personne n'appelle n'unifie rien : elle donne seulement à
    // croire que la promesse est écrite une fois, pendant que les écrans la
    // composent ailleurs.
    const module = await import("@/lib/shared/identity-sharing");
    for (const value of Object.values(module)) {
      expect(typeof value).toBe("string");
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
