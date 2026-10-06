import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FR_SHELL_MESSAGES } from "@/lib/shared/shell-text";

const ROOT = join(__dirname, "..", "..");
const source = readFileSync(
  join(ROOT, "components/cyber/landing/PublicHeader.tsx"),
  "utf8",
);

// Le composant est un server component async (lecture session + DB) : on vérifie
// le câblage au niveau source, comme pour les autres pages (cf. legal-page.test).
describe("PublicHeader — bouton « partie compétitive »", () => {
  it("affiche le CTA compétitif pour l'utilisateur connecté", () => {
    expect(source).toContain('{t("competitionFull")}');
    expect(FR_SHELL_MESSAGES.header.competitionFull).toBe("Accéder à la partie compétitive →");
  });

  it("pointe le CTA vers l'espace sécurisé /tournois", () => {
    expect(source).toMatch(/href="\/tournois"/);
  });

  it("réserve le CTA à la branche connectée (après `user ?`)", () => {
    const connectedBranch = source.slice(source.indexOf("{user ?"));
    const elseSplit = connectedBranch.indexOf(") : (");
    const connectedJsx = connectedBranch.slice(0, elseSplit);
    const loggedOutJsx = connectedBranch.slice(elseSplit);

    expect(connectedJsx).toContain('t("competitionFull")');
    // Pas de fuite du CTA côté déconnecté (qui ne propose que Connexion/Rejoindre).
    expect(loggedOutJsx).not.toContain('t("competition');
    expect(loggedOutJsx).toContain("/connexion");
  });

  it("pose le menu du compte (profil, équipe, déconnexion) à côté du CTA", () => {
    expect(source).toContain("<AccountMenu pseudo={user.pseudo}");
    expect(source).toContain("activeTeam={activeTeam}");
  });

  it("ne transmet au client que l'identité de l'équipe, pas ses rôles", () => {
    expect(source).toContain("{ teamId: team.teamId, teamName: team.teamName }");
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
    // Accueil traduit (lot 2) : texte et libellé viennent de `landing.json`, et
    // chaque libellé commence par le texte du bouton, dans les deux langues.
    const hero = readFileSync(join(ROOT, "components/cyber/landing/Hero.tsx"), "utf8");
    expect(hero).toContain('t("common.watchLive")');
    expect(hero).toContain('t("hero.watchLiveLabelOn"');
    expect(hero).toContain('t("hero.watchLiveLabel"');
    for (const locale of ["fr", "en"] as const) {
      const messages = JSON.parse(readFileSync(join(ROOT, `messages/${locale}/landing.json`), "utf8"));
      expect(messages.hero.watchLiveLabel.startsWith(messages.common.watchLive)).toBe(true);
      expect(messages.hero.watchLiveLabelOn.startsWith(messages.common.watchLive)).toBe(true);
    }
    expect(JSON.parse(readFileSync(join(ROOT, "messages/fr/landing.json"), "utf8")).common.watchLive).toBe("Regarder le live");
  });
});
