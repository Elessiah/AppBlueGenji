import { describe, expect, it } from "@jest/globals";
import {
  BLIZZARD_BATTLETAG_NOTICE,
  DISCORD_CERTIFICATION_UNDO,
  DISCORD_LOGIN_TAG_DETAILS,
  DISCORD_LOGIN_TAG_NOTICE,
  DISCORD_PLAYER_VISIBILITY_NO_TAG,
  DISCORD_PLAYER_VISIBILITY_NOTICE,
  DISCORD_PLAYER_VISIBILITY_PENDING,
  DISCORD_TAG_AUDIENCE,
  DISCORD_TAG_UNVERIFIED_CONSEQUENCE,
  DISCORD_TAG_UNVERIFIED_NOTICE,
  GAME_TAG_NOTICE,
  HIDDEN_BATTLETAG_AUDIENCE,
} from "@/lib/shared/identity-sharing";

/**
 * Ces phrases sont des **promesses** faites au joueur : qui lit son tag, ce que
 * Blizzard réécrit, à quoi servent ses identifiants de jeu. Raccourcies pour le
 * bouton « i » (`docs/features/INFO_HINTS.md`), elles gardent chacun des faits
 * que le code tient.
 */
const discord = [DISCORD_TAG_AUDIENCE.title, ...DISCORD_TAG_AUDIENCE.items, DISCORD_TAG_AUDIENCE.footer].join(" ");
const battletag = [HIDDEN_BATTLETAG_AUDIENCE.title, ...HIDDEN_BATTLETAG_AUDIENCE.items, HIDDEN_BATTLETAG_AUDIENCE.footer].join(" ");

describe("DISCORD_TAG_AUDIENCE", () => {
  it("nomme chaque public, un par ligne", () => {
    expect(DISCORD_TAG_AUDIENCE.items).toHaveLength(5);
    expect(DISCORD_TAG_AUDIENCE.items[0]).toMatch(/^les administrateurs, à tout moment/);
    expect(DISCORD_TAG_AUDIENCE.items[1]).toMatch(/^les arbitres/);
  });

  it("borne l'arbitrage au tournoi — le besoin naît du tournoi et s'éteint avec lui", () => {
    expect(discord).toContain("tant que tu es inscrit à un tournoi non terminé");
  });

  it("dit les parties d'un match, joué ou casté, et leurs moments", () => {
    expect(discord).toContain("les membres des deux équipes de ton match, dès que ses adversaires sont connus et jusqu'à sa fin, et son caster le temps du match");
    expect(discord).toContain("si tu castes un match : ses deux équipes le temps du match, et les arbitres dès que ses adversaires sont connus et jusqu'à sa fin");
  });

  it("nomme les autres joueurs comme un public choisi, pas acquis", () => {
    expect(discord).toContain("les autres joueurs, seulement si tu coches « Tag Discord »");
  });

  it("ferme la liste : le tag n'est jamais public", () => {
    expect(DISCORD_TAG_AUDIENCE.footer).toBe("Personne d'autre.");
  });
});

describe("HIDDEN_BATTLETAG_AUDIENCE", () => {
  it("nomme les deux fenêtres où se lit un BattleTag masqué", () => {
    expect(HIDDEN_BATTLETAG_AUDIENCE.title).toContain("fenêtre « Contacts »");
    expect(HIDDEN_BATTLETAG_AUDIENCE.title).toContain("fenêtre de lancement");
  });

  it("dit qui le lit, et quand, comme contact et comme caster", () => {
    expect(battletag).toContain("si tu y es présenté comme contact");
    expect(battletag).toContain("dès que les adversaires sont connus et jusqu'à la fin du match, et le caster le temps du match");
    expect(battletag).toContain("si tu castes un match : ses deux équipes le temps du match");
  });

  it("borne la fenêtre de lancement aux équipes et au caster", () => {
    expect(battletag).toContain("ne s'ouvre qu'aux deux équipes et au caster");
  });

  it("dit comment cesser de le partager, Battle.net compris", () => {
    expect(HIDDEN_BATTLETAG_AUDIENCE.footer).toContain("efface-le de ton profil");
    expect(HIDDEN_BATTLETAG_AUDIENCE.footer).toContain("après avoir ajouté un autre moyen de connexion si c'est le seul");
  });
});

describe("DISCORD_PLAYER_VISIBILITY_NOTICE", () => {
  it("dit que la case ne vaut que pour un tag certifié, et qu'un tag non certifié reste masqué", () => {
    expect(DISCORD_PLAYER_VISIBILITY_NOTICE).toContain("« Tag Discord » ne vaut que pour un tag certifié");
    expect(DISCORD_PLAYER_VISIBILITY_NOTICE).toMatch(/non certifié reste masqué, case cochée ou non/);
    expect(DISCORD_PLAYER_VISIBILITY_PENDING).toMatch(/pas certifié/i);
  });

  it("dit que la certification ouvre déjà le tag à l'organisation et aux contacts de match", () => {
    expect(DISCORD_PLAYER_VISIBILITY_NOTICE).toContain("déjà visible de l'organisation et des contacts de tes matchs");
  });

  it("sans tag, nomme d'abord l'enregistrement — pas une certification sans objet", () => {
    expect(DISCORD_PLAYER_VISIBILITY_NO_TAG).toMatch(/pas encore de tag/i);
    expect(DISCORD_PLAYER_VISIBILITY_NO_TAG).toMatch(/enregistre-le puis certifie-le/i);
  });
});

describe("tag non certifié", () => {
  it("dit que personne ne le voit, administrateurs compris", () => {
    expect(DISCORD_TAG_UNVERIFIED_NOTICE).toMatch(/pas même les administrateurs/i);
  });

  it("dit ce qu'on y perd, pas seulement ce qu'on y gagne", () => {
    expect(DISCORD_TAG_UNVERIFIED_CONSEQUENCE).toMatch(/ne peut donc pas te joindre/i);
  });
});

describe("connexion par Discord", () => {
  it("dit qu'elle enregistre sans certifier, et où certifier", () => {
    expect(DISCORD_LOGIN_TAG_NOTICE).toMatch(/sans le certifier/);
    expect(DISCORD_LOGIN_TAG_NOTICE).toMatch(/personne ne le voit/);
    expect(DISCORD_LOGIN_TAG_DETAILS).toContain("« Mon profil »");
  });
});

describe("DISCORD_CERTIFICATION_UNDO", () => {
  it("nomme le seul geste qui défait la certification", () => {
    // Il n'existe aucune route de décertification, et le champ d'un tag
    // certifié est en lecture seule : le geste offert est le retrait.
    expect(DISCORD_CERTIFICATION_UNDO).toMatch(/retire ton tag/i);
    expect(DISCORD_CERTIFICATION_UNDO).toMatch(/mon profil/i);
    expect(DISCORD_CERTIFICATION_UNDO).not.toMatch(/modifier ton tag/i);
  });
});

describe("Le module n'expose que des phrases", () => {
  it("ne garde ni assembleur ni fonction : des chaînes et des listes de lecteurs", async () => {
    // Une aide que personne n'appelle n'unifie rien : elle donne seulement à
    // croire que la promesse est écrite une fois, pendant que les écrans la
    // composent ailleurs. L'assemblage par langue vit dans `identity-audience.ts`.
    const module = await import("@/lib/shared/identity-sharing");
    for (const value of Object.values(module)) {
      if (typeof value === "string") continue;
      expect(value).toEqual({ title: expect.any(String), items: expect.any(Array), footer: expect.any(String) });
    }
  });
});

describe("BLIZZARD_BATTLETAG_NOTICE", () => {
  it("prévient que la saisie sera remplacée — sinon le champ change tout seul", () => {
    expect(BLIZZARD_BATTLETAG_NOTICE).toMatch(/à chaque connexion/i);
    expect(BLIZZARD_BATTLETAG_NOTICE).toMatch(/à la place de ta saisie/i);
  });
});

describe("GAME_TAG_NOTICE", () => {
  it("dit à quoi les tags de jeu ne servent pas", () => {
    expect(GAME_TAG_NOTICE).toMatch(/jamais pour des statistiques/i);
  });
});
