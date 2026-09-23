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

describe("champ Discord — la référence suit toute écriture du tag", () => {
  /**
   * Trois chemins écrivent `discord_pseudo` depuis cet écran : la sauvegarde du
   * profil, la certification et le retrait. Chacun doit réaligner
   * `savedDiscordPseudo`, qui décide si la **prochaine** sauvegarde parle de ce
   * champ — laissée en arrière, elle resoumet un tag déjà écrit, et un tag
   * déplacé entre-temps fait alors mourir tout le `PATCH` en 409.
   */
  it("réaligne après une certification, pas seulement après une sauvegarde", () => {
    const onVerified = page.slice(page.indexOf("onVerified={(tag) =>"));
    expect(onVerified.slice(0, 700)).toContain("setSavedDiscordPseudo(tag);");
  });

  it("couvre les trois chemins d'écriture", () => {
    expect([...page.matchAll(/setSavedDiscordPseudo\(/g)].length).toBeGreaterThanOrEqual(4);
  });

  it("réaligne le champ **en même temps** que sa référence", () => {
    // Les deux doivent bouger ensemble : réaligner la seule référence les
    // faisait diverger dès que le tag avait bougé ailleurs, et la sauvegarde
    // suivante resoumettait celui du montage — 409, sans issue puisque le champ
    // est en lecture seule.
    const field = [...page.matchAll(/setDiscordPseudo\(payload\.profile\.discordPseudo/g)];
    const ref = [...page.matchAll(/setSavedDiscordPseudo\(payload\.profile\.discordPseudo/g)];
    expect(field.length).toBe(ref.length);
    expect(field.length).toBeGreaterThanOrEqual(2);
  });
});

describe("champ Discord — un retrait ne laisse pas la pastille mentir", () => {
  it("pose l'état depuis la réponse, sans attendre une seconde lecture", () => {
    // `loadDiscordState` se tait quand elle échoue : l'écran gardait alors la
    // pastille et « ce pseudo est certifié » à côté d'un champ qu'on vient de
    // vider. La réponse du `PATCH` porte déjà la vérité.
    const removal = page.slice(page.indexOf("const onDiscordTagRemove"));
    const posted = removal.indexOf("setDiscordState((prev) => ({ ...prev, tag: null, verified: false }))");
    const reload = removal.indexOf("await loadDiscordState()");
    expect(posted).toBeGreaterThanOrEqual(0);
    expect(posted).toBeLessThan(reload);
  });
});

describe("profil — un échec de lecture ne s'annonce pas comme un échec de sauvegarde", () => {
  it("le chargement a son propre repli", () => {
    expect(page).toContain("profileLoadErrorMessage((e as Error).message)");
  });

  it("et les écritures gardent le leur", () => {
    expect([...page.matchAll(/profileErrorMessage\(/g)].length).toBeGreaterThanOrEqual(3);
  });
});

describe("champ Discord — l'attente ne se dit pas comme une panne", () => {
  it("part en lecture dès le premier rendu", () => {
    // Partir de `false` laissait une fenêtre — entre le premier rendu et
    // l'effet — où l'écran annonçait une panne avant d'avoir essayé.
    expect(page).toContain("useState(true);");
    const declaration = page.slice(page.indexOf("const [discordStateBusy"));
    expect(declaration.slice(0, 80)).toContain("useState(true)");
  });

  it("passe l'attente à la phrase, qui ne la devine pas", () => {
    expect(page).toContain("discordTagLockNotice({ ...discordState, pending: discordStateBusy })");
  });
});

describe("champ Discord — deux lectures en vol ne se marchent pas dessus", () => {
  /**
   * Sauvegarder puis retirer son tag dans la foulée lance deux lectures, et
   * rien ne garantit qu'elles reviennent dans l'ordre. Celle du `PATCH`,
   * revenue après celle du retrait, reposait `{tag, verified: true}` : la
   * pastille et « les administrateurs le voient » à côté d'un champ vidé.
   */
  it("numérote les lectures et jette celles qui sont dépassées", () => {
    expect(page).toContain("const discordReadSeq = useRef(0)");
    expect(page).toContain("const seq = (discordReadSeq.current += 1)");
    expect(page).toContain("if (seq !== discordReadSeq.current) return;");
  });

  it("ne lève l'attente que sur la dernière — sinon « Réessayer » rouvre trop tôt", () => {
    expect(page).toContain("if (seq === discordReadSeq.current) setDiscordStateBusy(false)");
  });
});
