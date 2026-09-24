import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { RecruitmentHighlight } from "@/components/recruitment-highlight";
import type { RecruitmentAd } from "@/lib/shared/recruitment";

/**
 * La mise en avant se rend **côté serveur**, et c'est tout l'objet de ces tests.
 *
 * Elle allait chercher son annonce elle-même (`fetch` dans un `useEffect`) puis
 * lisait `localStorage` pour décider : elle ne peignait donc rien avant
 * l'hydratation. La modale étant le plus gros bloc de l'accueil sur mobile, elle
 * en **était** le LCP — 4,4 s, dont 3,8 s de seul délai de rendu.
 *
 * `renderToStaticMarkup` est exactement le bon instrument pour le vérifier : il
 * rend ce que le serveur envoie, sans hydratation, sans effet, sans navigateur.
 * Ce qui apparaît ici est ce que le visiteur voit à la première peinture ; ce
 * qui n'y apparaît pas ne pourrait arriver qu'après, c'est-à-dire trop tard.
 */
function ad(overrides: Partial<RecruitmentAd> = {}): RecruitmentAd {
  return {
    id: 42,
    title: "Cherche coach Overwatch",
    teamName: "Test - Eclipse",
    domain: "AUTRE",
    roles: "Coach",
    body: "Description de l'annonce.",
    contactUrl: null,
    contactDiscord: null,
    contactDiscordId: null,
    contactPreferred: "AUTO",
    priority: "PRIORITY",
    active: true,
    ...overrides,
  };
}

const urgent = ad();
const second = ad({ id: 43, title: "Cherche arbitre" });
const important = ad({ id: 44, title: "Cherche graphiste", priority: "IMPORTANT" });

type Props = Parameters<typeof RecruitmentHighlight>[0];

const render = (props: Partial<Props>) =>
  renderToStaticMarkup(
    <RecruitmentHighlight
      modalAds={[]}
      modalStart={null}
      bannerAds={[]}
      bannerDismissed={false}
      onAdPage={false}
      {...props}
    />,
  );

/** Nombre d'occurrences d'un motif dans le balisage. */
const count = (markup: string, pattern: RegExp) => (markup.match(pattern) ?? []).length;

describe("RecruitmentHighlight — modale d'arrivée", () => {
  it("place la modale dans le HTML initial", () => {
    // L'assertion qui porte la correction du LCP : le titre de l'annonce est
    // dans la réponse, pas dans un rendu ultérieur.
    const markup = render({ modalAds: [urgent], modalStart: 0 });
    expect(markup).toContain("Cherche coach Overwatch");
    expect(markup).toMatch(/role="dialog"/);
  });

  it("porte la pastille « Urgente » des prioritaires", () => {
    const markup = render({ modalAds: [urgent], modalStart: 0 });
    expect(markup).toContain("Urgente");
    expect(markup).toContain("pill-urgent");
  });

  it("réunit plusieurs prioritaires dans une seule modale qui se feuillette", () => {
    const markup = render({ modalAds: [urgent, second], modalStart: 0 });
    expect(count(markup, /role="dialog"/g)).toBe(1);
    expect(markup).toContain("Annonce 1 sur 2");
    expect(markup).toContain("Suivante");
    expect(markup).toContain("Précédente");
  });

  it("s'ouvre sur la page que le serveur désigne — la première jamais vue", () => {
    const markup = render({ modalAds: [urgent, second], modalStart: 1 });
    expect(markup).toContain("Cherche arbitre");
    expect(markup).not.toContain("Cherche coach Overwatch");
    expect(markup).toContain("Annonce 2 sur 2");
  });

  it("borne une page d'ouverture hors de la liste plutôt que de ne rien montrer", () => {
    const markup = render({ modalAds: [urgent, second], modalStart: 9 });
    expect(markup).toContain("Cherche arbitre");
  });

  it("n'affiche pas de pagination pour une seule prioritaire", () => {
    const markup = render({ modalAds: [urgent], modalStart: 0 });
    expect(markup).not.toContain("Suivante");
  });

  it("ne rend rien quand le cookie dit que le visiteur les a toutes vues", () => {
    // Décidé par le serveur, donc **sans clignotement** : l'ancienne version
    // ne pouvait le savoir qu'après avoir monté le composant.
    expect(render({ modalAds: [urgent], modalStart: null })).toBe("");
  });

  it("se tait sur la page de recrutement, où le visiteur lit déjà les annonces", () => {
    expect(render({ modalAds: [urgent], modalStart: 0, onAdPage: true })).toBe("");
  });

  it("mène à la lecture complète plutôt que de tout déverser", () => {
    const markup = render({ modalAds: [urgent], modalStart: 0 });
    expect(markup).toContain("/recrutement#annonce-42");
  });
});

describe("RecruitmentHighlight — banderole", () => {
  it("place la banderole dans le HTML initial", () => {
    const markup = render({ bannerAds: [important] });
    expect(markup).toContain("Cherche graphiste");
    expect(markup).toMatch(/role="region"/);
  });

  it("n'accorde la pastille « Urgente » qu'aux prioritaires", () => {
    expect(render({ bannerAds: [important] })).not.toContain("Urgente");
    expect(render({ bannerAds: [urgent] })).toContain("Urgente");
  });

  it("montre une annonce à la fois, la première d'abord", () => {
    const markup = render({ bannerAds: [urgent, important] });
    expect(markup).toContain("Cherche coach Overwatch");
    expect(markup).not.toContain("Cherche graphiste");
  });

  it("offre de parcourir et de mettre en pause quand plusieurs annonces défilent", () => {
    const markup = render({ bannerAds: [urgent, important] });
    expect(markup).toContain("Annonce précédente");
    expect(markup).toContain("Annonce suivante");
    expect(markup).toContain("Mettre en pause le défilement des annonces");
    expect(markup).toContain("Annonce 1 sur 2");
  });

  it("n'encombre pas une banderole à une seule annonce de commandes inutiles", () => {
    const markup = render({ bannerAds: [important] });
    expect(markup).not.toContain("Annonce suivante");
    expect(markup).not.toContain("Mettre en pause");
  });

  it("ne rend rien quand le visiteur l'a fermée pour sa visite", () => {
    expect(render({ bannerAds: [important], bannerDismissed: true })).toBe("");
  });

  it("reste sur la page de recrutement, par une ancre native", () => {
    // Elle n'est pas modale : elle ne recouvre rien. Et l'ancre native déclenche
    // `hashchange`, que la page écoute pour ouvrir l'annonce.
    const markup = render({ bannerAds: [important], onAdPage: true });
    expect(markup).toContain("Cherche graphiste");
    expect(markup).toContain('href="#annonce-44"');
  });

  it("se montre avec la modale : les deux ne s'excluent plus", () => {
    const markup = render({ modalAds: [urgent], modalStart: 0, bannerAds: [urgent, important] });
    expect(markup).toMatch(/role="region"/);
    expect(markup).toMatch(/role="dialog"/);
  });
});

describe("RecruitmentHighlight — rien à montrer", () => {
  it("ne rend rien sans annonce mise en avant", () => {
    expect(render({})).toBe("");
  });
});

describe("RecruitmentHighlight — ce qui ne doit plus exister", () => {
  const source = require("fs").readFileSync(
    require("path").join(__dirname, "..", "..", "components", "recruitment-highlight.tsx"),
    "utf8",
  );
  /** Les commentaires racontent le défaut corrigé : ils citent donc ce qu'on interdit. */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("ne va plus chercher son annonce lui-même", () => {
    // C'est l'aller-retour qui partait de **chaque page** du site, à chaque
    // visiteur, pour ne presque jamais rien rapporter.
    expect(code).not.toMatch(/fetch\(/);
    expect(code).not.toContain("/api/recruitment/highlight");
  });

  it("ne lit plus le stockage local, que le serveur ne peut pas voir", () => {
    expect(code).not.toMatch(/localStorage|sessionStorage/);
  });

  it("fait tourner la banderole sous le régime de charge, pas pour son compte", () => {
    // Une banderole qui tourne derrière un jeu est une image prise au jeu : la
    // rotation lit `useClientPower`, comme toute boucle d'affichage du site.
    expect(code).toContain("useClientPower()");
    expect(code).not.toMatch(/visibilitychange|setInterval\(/);
  });
});
