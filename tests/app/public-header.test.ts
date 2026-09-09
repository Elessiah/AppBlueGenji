import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const source = readFileSync(
  join(ROOT, "components/cyber/landing/PublicHeader.tsx"),
  "utf8",
);

// Le composant est un server component async (lecture session + DB) : on vérifie
// le câblage au niveau source, comme pour les autres pages (cf. legal-page.test).
describe("PublicHeader — bouton « partie compétitive »", () => {
  it("affiche le CTA compétitif pour l'utilisateur connecté", () => {
    expect(source).toContain("Accéder à la partie compétitive");
  });

  it("pointe le CTA vers l'espace sécurisé /tournois", () => {
    expect(source).toMatch(/href="\/tournois"/);
  });

  it("réserve le CTA à la branche connectée (après `user ?`)", () => {
    const connectedBranch = source.slice(source.indexOf("{user ?"));
    const elseSplit = connectedBranch.indexOf(") : (");
    const connectedJsx = connectedBranch.slice(0, elseSplit);
    const loggedOutJsx = connectedBranch.slice(elseSplit);

    expect(connectedJsx).toContain("Accéder à la partie compétitive");
    // Pas de fuite du CTA côté déconnecté (qui ne propose que Connexion/Rejoindre).
    expect(loggedOutJsx).not.toContain("Accéder à la partie compétitive");
    expect(loggedOutJsx).toContain("/connexion");
  });

  it("conserve l'avatar cliquable vers le profil à côté du CTA", () => {
    expect(source).toMatch(/href="\/profil"/);
    expect(source).toContain("user.pseudo");
  });
});

// Le nom accessible d'un lien doit **contenir** son texte visible (WCAG 2.5.3) :
// un `aria-label` posé à la main le remplace, et la commande vocale ne répond
// alors plus à ce qu'on lit sur le lien. Ces deux liens l'avaient perdu, chacun
// à sa façon — audit Lighthouse `label-content-name-mismatch`.
describe("nom accessible des liens de la vitrine", () => {
  it("laisse le lien de marque tirer son nom de son contenu visible", () => {
    const brand = source.slice(source.indexOf("className={styles.brand}"));
    const link = brand.slice(0, brand.indexOf("</Link>"));
    expect(link).not.toContain("aria-label");
    // L'emblème est décoratif : à côté du mot-symbole, son `alt` ferait lire
    // « BlueGenji BlueGenji ESPORT ».
    expect(link).toContain('alt=""');
  });

  it("fait commencer le libellé du bouton de direct par son texte affiché", () => {
    const hero = readFileSync(join(ROOT, "components/cyber/landing/Hero.tsx"), "utf8");
    expect(hero).toContain("Regarder le live");
    expect(hero).toMatch(/aria-label=\{`Regarder le live/);
  });
});
