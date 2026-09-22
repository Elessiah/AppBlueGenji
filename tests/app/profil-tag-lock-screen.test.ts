import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * L'écran du verrou, contrôlé **au niveau de la source** : la page est un
 * composant client à états multiples que ces tests ne peuvent pas monter, et
 * les propriétés qui comptent ici sont des propriétés de structure.
 */
const page = readFileSync(
  join(process.cwd(), "app/(secured)/profil/page.tsx"),
  "utf8",
);

describe("champ Discord — ce que le formulaire soumet", () => {
  it("ne soumet le tag que s'il a changé", () => {
    // Renvoyer l'instantané de montage à chaque sauvegarde faisait refuser tout
    // le `PATCH` en 409 dès que le tag avait été réécrit ailleurs.
    expect(page).toContain(
      "const touchesDiscordTag = discordPseudo.trim() !== savedDiscordPseudo.trim();",
    );
    expect(page).toContain("...(touchesDiscordTag");
  });

  it("décide sur la valeur, jamais sur le verrou", () => {
    // Le verrou se lit sur un état que l'écran peut avoir périmé : un onglet
    // ouvert avant le rattachement porte encore `linked: false`, et c'est
    // exactement le cas où le refus tombe.
    const submit = page.slice(page.indexOf("const onSubmit"), page.indexOf("const onDiscordTagRemove"));
    expect(submit).not.toContain("isDiscordTagLocked");
  });

  it("réaligne sa référence après chaque écriture réussie", () => {
    // Sans cela, une seconde sauvegarde resoumettrait un tag déjà écrit.
    expect([...page.matchAll(/setSavedDiscordPseudo\(/g)].length).toBeGreaterThanOrEqual(3);
  });
});

describe("champ Discord — un état illisible garde une sortie", () => {
  it("offre « Réessayer » plutôt que d'exiger un rechargement", () => {
    // Le verrou reste (on n'écrase pas un pseudo que Discord aurait nommé),
    // mais faire disparaître tous les gestes ferait disparaître « Retirer mon
    // tag » — la seule annulation d'exposition que le site offre.
    expect(page).toContain("discordState.linked !== true ?");
    expect(page).toContain('aria-label="Réessayer la lecture de l\'état Discord"');
    expect(page).toContain("onClick={() => void loadDiscordState()}");
  });

  it("désarme le bouton pendant la lecture", () => {
    expect(page).toContain("disabled={discordStateBusy}");
  });

  it("ne propose jamais un geste sur un état inconnu", () => {
    // Ni certifier, ni retirer : on ignore s'ils auraient un objet.
    const unknown = page.slice(
      page.indexOf("discordState.linked !== true ?"),
      page.indexOf("Réessayer la lecture"),
    );
    expect(unknown).not.toContain("onDiscordTagRemove");
    expect(unknown).not.toContain("setVerifyOpen(true)");
  });
});
