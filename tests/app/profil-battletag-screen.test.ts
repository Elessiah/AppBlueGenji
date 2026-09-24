import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Le BattleTag sur `/profil` : le verrou, et la modale qui dit ce que
 * « masqué » ne fait pas.
 *
 * Contrôle au **niveau de la source** : la page est un composant client à états
 * multiples que ces tests ne peuvent pas monter, et les propriétés qui comptent
 * ici sont des propriétés de structure.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const page = read("app/(secured)/profil/page.tsx");
const modal = read("app/(secured)/profil/BattletagVisibilityNotice.tsx");
const section = read("app/(secured)/profil/ConnectedAppsSection.tsx");
const hook = read("app/(secured)/profil/useAccountConnections.ts");

describe("champ BattleTag — ce que le formulaire soumet", () => {
  it("ne le soumet que s'il a changé", () => {
    // Renvoyer l'instantané du montage à chaque sauvegarde ferait refuser tout
    // le `PATCH` en 409 dès que Blizzard l'aurait réécrit entre-temps — une
    // connexion Battle.net depuis un autre appareil suffit.
    expect(page).toContain(
      "overwatchBattletag.trim() !== savedOverwatchBattletag.trim()",
    );
    expect(page).toContain("...(touchesBattletag");
  });

  it("décide sur la valeur, jamais sur le verrou", () => {
    // Le verrou se lit sur un état que l'écran peut avoir périmé : un onglet
    // ouvert avant le rattachement porte encore « non rattaché », et c'est
    // exactement le cas où le refus tombe.
    const submit = page.slice(page.indexOf("const onSubmit"), page.indexOf("const onDiscordTagRemove"));
    expect(submit).not.toContain("isBattletagLocked");
    expect(submit).not.toContain("battletagLocked");
  });

  it("réaligne le champ **et** sa référence après chaque écriture réussie", () => {
    // Les deux doivent bouger ensemble : réaligner la seule référence les
    // ferait diverger dès que la valeur a bougé ailleurs, et la sauvegarde
    // suivante resoumettrait celle du montage — 409, sans issue puisque le champ
    // est en lecture seule.
    const field = [...page.matchAll(/setOverwatchBattletag\(payload\.profile\.overwatchBattletag/g)];
    const ref = [...page.matchAll(/setSavedOverwatchBattletag\(payload\.profile\.overwatchBattletag/g)];
    expect(field.length).toBe(ref.length);
    // **Deux, et exactement deux** : le chargement et la sauvegarde. Compter
    // « au moins deux » laissait le doublon d'un seul chemin tenir lieu des
    // deux, si bien que perdre le réalignement de la sauvegarde — le seul qui
    // protège de quelque chose — n'aurait rien fait rougir.
    expect(field).toHaveLength(2);
  });

  it("réaligne **dans la sauvegarde**, et pas seulement au chargement", () => {
    // C'est là que le réalignement compte : sans lui, la sauvegarde suivante
    // resoumet la valeur du montage, et un BattleTag réécrit par Blizzard
    // entre-temps fait mourir tout le `PATCH` en 409.
    const submit = page.slice(page.indexOf("const onSubmit"), page.indexOf("const onDiscordTagRemove"));
    expect(submit).toContain("setOverwatchBattletag(payload.profile.overwatchBattletag");
    expect(submit).toContain("setSavedOverwatchBattletag(payload.profile.overwatchBattletag");
  });
});

describe("champ BattleTag — le verrou à l'écran", () => {
  it("met le champ en lecture seule, jamais désactivé", () => {
    // `readOnly` garde la valeur lisible au lecteur d'écran et atteignable au
    // clavier, ce qu'un champ désactivé perd.
    expect(page).toContain("readOnly={battletagLocked}");
    expect(page).not.toContain("disabled={battletagLocked}");
  });

  it("remplace l'annonce par la phrase du verrou", () => {
    // L'annonce prévient de ce qui arrivera si un compte Blizzard est rattaché.
    // Il l'est : la garder à côté du verrou ferait lire un avertissement au
    // futur sur un fait déjà accompli.
    expect(page).toContain("battletagLockNotice({");
    expect(page).toContain("pending: connectionsPending");
  });

  it("lit le rattachement sur un état à **trois** valeurs", () => {
    // `null` n'est pas « aucun rattachement » mais « pas encore lue » : les
    // confondre ouvrirait le champ pendant l'aller-retour, donc au moment
    // précis où la sauvegarde partirait vers un 409.
    expect(page).toContain("connections === null");
    expect(page).toContain("isBattletagLocked({ linked: blizzardLinked })");
  });
});

describe("la liste des rattachements n'a qu'une source", () => {
  it("est chargée par la page et passée à la section", () => {
    // Deux `fetch` pour la même donnée en feraient deux vérités : le temps d'un
    // retrait, la section dirait « Rattacher » pendant que le champ d'en haut
    // resterait fermé.
    expect(page).toContain("useAccountConnections()");
    expect(page).toContain("connections={connections}");
    expect(page).toContain("reload={reloadConnections}");
  });

  it("la section ne va plus la chercher elle-même", () => {
    expect(section).not.toContain('fetch("/api/profile/connections"');
    expect(hook).toContain('fetch("/api/profile/connections"');
  });

  it("le hook distingue « pas encore lue » de « lecture échouée »", () => {
    expect(hook).toContain("const [pending, setPending] = useState(true)");
  });
});

describe("« Applications connectées » — la porte du rattachement Discord", () => {
  it("affiche le geste quand le module a quelque chose à en dire", () => {
    expect(section).toContain("connectionMethodLabel(connection)");
    expect(section).toContain("{methodLabel ? (");
  });

  it("ne le rend jamais sur une porte détachée", () => {
    expect(section).toContain(
      "connection.linked ? connectionMethodLabel(connection) : null",
    );
  });

  it("le fait lire par le bouton « Retirer », pas seulement par l'œil", () => {
    // Un lecteur d'écran qui parcourt les contrôles ne rencontre jamais le
    // texte voisin : la porte doit entrer dans la description du bouton.
    expect(section).toContain(
      "aria-describedby={methodLabel ? `${detailsId} ${methodId}` : detailsId}",
    );
  });

  it("n'écrit aucune des deux phrases en dur — elles vivent avec la règle", () => {
    // Recopiées ici, elles cesseraient de décrire la règle au premier
    // ajustement. Le contrôle porte sur les **libellés entiers** : la section
    // parle par ailleurs légitimement de message privé, dans ce que Discord
    // apporte au compte.
    expect(section).not.toContain("Rattaché par le bouton Discord");
    expect(section).not.toContain("Rattaché par code en message privé");
  });
});

describe("modale de visibilité du BattleTag", () => {
  it("ne s'ouvre qu'à la bascule vers « masqué », et sur ce réglage seul", () => {
    // Rendre public ne surprend personne ; c'est masquer qui promet plus que le
    // site ne tient. `value` est l'état **avant** la bascule : vrai = on masque.
    expect(page).toContain('if (key === "overwatch" && value) setBattletagNoticeOpen(true);');
  });

  it("bascule le réglage **sans condition** — elle informe, elle ne demande rien", () => {
    const handler = page.slice(page.indexOf("onChange={() => {"));
    const toggle = handler.indexOf("setVisibility((prev)");
    const notice = handler.indexOf("setBattletagNoticeOpen(true)");
    expect(toggle).toBeGreaterThanOrEqual(0);
    expect(toggle).toBeLessThan(notice);
  });

  it("n'a qu'un bouton : il n'y a rien à accepter ni à refuser", () => {
    expect([...modal.matchAll(/<CyberButton/g)]).toHaveLength(1);
    expect(modal).toContain("J&apos;ai compris");
  });

  it("nomme les deux publics qui continuent de lire le tag", () => {
    expect(modal).toContain("de chaque match que tu disputes");
    expect(modal).toContain("arbitres");
    expect(modal).toContain("administrateurs");
  });

  it("prend le focus et se ferme par Échap, par la pile commune des modales", () => {
    // Sans cela, un lecteur d'écran resterait sur la case à cocher et le clavier
    // n'aurait aucun moyen de refermer ce qu'il vient d'ouvrir.
    expect(modal).toContain("useDialogBehavior({ open: true, onClose })");
    expect(modal).toContain("ref={dialogRef}");
    expect(modal).toContain('role="dialog"');
    expect(modal).toContain('aria-modal="true"');
  });

  it("est portée dans document.body, hors de la section animée de /profil", () => {
    // Le `transform` laissé par `.fade-in` faisait de la section la référence
    // de `position: fixed` : la notice se centrait hors de l'écran.
    expect(modal).toMatch(/createPortal\([\s\S]*document\.body\s*,?\s*\)/);
  });
});
