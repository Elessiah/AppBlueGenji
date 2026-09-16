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
    domain: "STAFF",
    roles: "Coach",
    body: "Description de l'annonce.",
    highlight: "MODAL",
    contactUrl: null,
    contactDiscord: null,
    contactChannel: "AUTO",
    active: true,
    displayOrder: 0,
    ...overrides,
  } as unknown as RecruitmentAd;
}

const render = (props: Parameters<typeof RecruitmentHighlight>[0]) =>
  renderToStaticMarkup(<RecruitmentHighlight {...props} />);

describe("RecruitmentHighlight — rendu serveur", () => {
  it("place la modale dans le HTML initial", () => {
    // L'assertion qui porte la correction du LCP : le titre de l'annonce est
    // dans la réponse, pas dans un rendu ultérieur.
    const markup = render({ ad: ad(), dismissed: false, onAdPage: false });
    expect(markup).toContain("Cherche coach Overwatch");
    expect(markup).toMatch(/role="dialog"/);
  });

  it("place aussi la banderole dans le HTML initial", () => {
    const markup = render({ ad: ad({ highlight: "BANNER" }), dismissed: false, onAdPage: false });
    expect(markup).toContain("Cherche coach Overwatch");
    expect(markup).toMatch(/role="region"/);
  });

  it("ne rend rien quand le cookie dit que le visiteur l'a écartée", () => {
    // Décidé par le serveur, donc **sans clignotement** : l'ancienne version
    // ne pouvait le savoir qu'après avoir monté le composant.
    expect(render({ ad: ad(), dismissed: true, onAdPage: false })).toBe("");
  });

  it("se tait sur la page de recrutement, où le visiteur lit déjà les annonces", () => {
    expect(render({ ad: ad(), dismissed: false, onAdPage: true })).toBe("");
  });

  it("laisse la banderole sur la page de recrutement", () => {
    // Elle n'est pas modale : elle ne recouvre rien et ne se superpose pas à la
    // lecture d'une annonce ouverte par lien profond.
    const markup = render({ ad: ad({ highlight: "BANNER" }), dismissed: false, onAdPage: true });
    expect(markup).toContain("Cherche coach Overwatch");
  });

  it("ne rend rien sans annonce, ni sur une annonce non mise en avant", () => {
    expect(render({ ad: null, dismissed: false, onAdPage: false })).toBe("");
    expect(render({ ad: ad({ highlight: "NONE" }), dismissed: false, onAdPage: false })).toBe("");
  });

  it("mène à la lecture complète plutôt que de tout déverser", () => {
    const markup = render({ ad: ad(), dismissed: false, onAdPage: false });
    expect(markup).toContain("/recrutement#");
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
});
