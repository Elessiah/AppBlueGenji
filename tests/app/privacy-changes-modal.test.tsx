import { afterEach, describe, expect, it, jest } from "@jest/globals";

let mockPathname: string | null = "/tournois";
jest.mock("next/navigation", () => ({ usePathname: () => mockPathname }));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { PrivacyChangesModal } from "@/components/privacy/PrivacyChangesModal";
import { ToastProvider } from "@/components/ui/toast";
import { PRIVACY_CHANGES, type PrivacyChange } from "@/lib/shared/privacy-changes";

/**
 * La modale se rend **côté serveur**, depuis la mise en page racine : ce que
 * `renderToStaticMarkup` produit ici est ce que le joueur voit à la première
 * peinture, sans attendre l'hydratation.
 */
const render = (changes: PrivacyChange[]) =>
  renderToStaticMarkup(
    <ToastProvider>
      <PrivacyChangesModal changes={changes} />
    </ToastProvider>,
  );

describe("PrivacyChangesModal — rendu serveur", () => {
  afterEach(() => {
    mockPathname = "/tournois";
  });

  it("se tait sur /rgpd, seule page où elle couvrirait ce qu'elle invite à lire", () => {
    mockPathname = "/rgpd";
    expect(render([...PRIVACY_CHANGES])).not.toMatch(/role="dialog"/);
  });

  it("se tait aussi sur /en/rgpd : la route compte, pas le préfixe de langue", () => {
    mockPathname = "/en/rgpd";
    expect(render([...PRIVACY_CHANGES])).not.toMatch(/role="dialog"/);
  });

  it("revient sur toute autre page, sous-pages de /rgpd comprises", () => {
    for (const path of ["/", "/profil", "/rgpd/autre", "/regles"]) {
      mockPathname = path;
      expect(render([...PRIVACY_CHANGES])).toMatch(/role="dialog"/);
    }
  });
  it("ne rend rien quand tout a été lu", () => {
    expect(render([])).not.toMatch(/role="dialog"/);
  });

  it("présente tous les changements dus d'un coup, avec leur date et leur détail", () => {
    const markup = render([...PRIVACY_CHANGES]);
    expect(markup).toMatch(/role="dialog"/);
    expect(markup).toMatch(/aria-modal="true"/);
    expect(markup).toContain(`${PRIVACY_CHANGES.length} changements de nos règles de confidentialité`);
    for (const change of PRIVACY_CHANGES) {
      expect(markup).toContain(change.title.replace(/'/g, "&#x27;"));
      expect(markup).toContain(`dateTime="${change.publishedAt}"`);
    }
    expect(markup).toContain(PRIVACY_CHANGES[0].details[0].slice(0, 40).replace(/'/g, "&#x27;"));
  });

  it("informe sans rien faire accepter : un seul bouton, aucune suppression", () => {
    const markup = render([PRIVACY_CHANGES[0]]);
    expect(markup).toContain("J&#x27;ai pris connaissance");
    expect(markup).toContain("aucun accord ne t&#x27;est demandé");
    // Ni acceptation, ni refus qui coûterait le compte (RGPD, art. 7.4 et 21).
    expect(markup).not.toMatch(/J&#x27;accepte|Je refuse|supprime mon compte|Supprimer définitivement/);
    expect(markup).not.toMatch(/Plus tard|Fermer/);
    expect(markup.match(/<button/g)).toHaveLength(1);
    // L'opposition et les autres droits : la politique, ouverte à côté.
    expect(markup).toContain('href="/rgpd"');
    expect(markup).toMatch(/t&#x27;opposer à un traitement/);
  });

  it("rend les liens d'action d'une entrée, et aucun pour une entrée qui n'en a pas", () => {
    const withLinks: PrivacyChange = {
      ...PRIVACY_CHANGES[0],
      links: [{ href: "/profil#identite", label: "Changer mon pseudo" }],
    };
    expect(render([withLinks])).toContain('href="/profil#identite"');
    expect(render([withLinks])).toContain("Changer mon pseudo");
    expect(render([{ ...PRIVACY_CHANGES[0], links: undefined }])).not.toContain("/profil#");
  });

  it("parle au singulier pour un seul changement", () => {
    expect(render([PRIVACY_CHANGES[0]])).toContain("Nos règles de confidentialité ont changé");
  });
});

/**
 * Le comportement client ne se monte pas sans navigateur ; ses contrats se
 * lisent sur la source, où une régression se verrait d'abord.
 */
describe("PrivacyChangesModal — contrats du geste", () => {
  const source = readFileSync(join(__dirname, "..", "..", "components", "privacy", "PrivacyChangesModal.tsx"), "utf8");

  it("envoie les identifiants montrés, pas « tout ce qui est dû »", () => {
    expect(source).toContain('fetch("/api/profile/privacy-changes"');
    expect(source).toContain("await record(changes.map((change) => change.id));");
  });

  it("garde l'écriture en vol quand un lien d'action charge un nouveau document (changement de langue)", () => {
    expect(source).toMatch(/fetch\("\/api\/profile\/privacy-changes", \{[\s\S]*?keepalive: true,[\s\S]*?\}\)/);
  });

  it("suivre un lien d'action vaut prise de connaissance et ferme la modale sans attendre", () => {
    expect(source).toContain("onClick={() => followLink(change.id)}");
    const body = source.slice(source.indexOf("const followLink = (changeId: string) => {"));
    // Fermée avant l'envoi : elle ne doit pas rester sur l'écran où elle envoie.
    expect(body.indexOf("close();")).toBeGreaterThan(-1);
    expect(body.indexOf("close();")).toBeLessThan(body.indexOf("record("));
    // Seul le changement du lien est acquitté, pas ses voisins.
    expect(body).toContain("record([changeId])");
    // Pas de second enregistrement si le bouton en a déjà lancé un, et sa
    // réponse ne parle plus d'une modale refermée.
    expect(body.indexOf("if (busy) {")).toBeLessThan(body.indexOf("record("));
    expect(body).toContain("leftByLink.current = true;");
    expect(source).toContain("if (!leftByLink.current) showSuccess(");
    expect(source).toContain("showError(leftByLink.current ? REPLAY_NOTICE");
  });

  it("ne touche jamais au compte : ni aperçu ni route de suppression", () => {
    expect(source).not.toContain("/api/profile/deletion");
    expect(source).not.toMatch(/method: "DELETE"/);
    expect(source).not.toContain("account-deletion");
  });

  it("n'est pas refermable par Échap ni par un clic à côté", () => {
    expect(source).toContain("onClose: () => {}");
    expect(source).not.toMatch(/overlay[^>]*onClick/);
  });

  it("passe par useToast pour les retours, jamais un message en ligne", () => {
    expect(source).toContain("useToast()");
    expect(source).toContain("showError(");
  });
});

describe("mise en page racine", () => {
  const layout = readFileSync(join(__dirname, "..", "..", "app", "layout.tsx"), "utf8");

  it("monte la modale et déclenche l'annonce Discord", () => {
    expect(layout).toContain("<PrivacyChangesModal changes={privacyChanges} />");
    expect(layout).toContain("void dispatchPrivacyChangeNotifications().catch(");
  });

  it("lit les changements sur toutes les pages et fait taire la modale de recrutement", () => {
    // Le silence de `/rgpd` est décidé côté client : décidé ici, il suivrait le
    // joueur d'un lien à l'autre (la mise en page n'est pas re-rendue).
    expect(layout).toContain("const privacyChanges = await pendingChangesFor(user?.id);");
    expect(layout).not.toContain("PRIVACY_POLICY_PAGE");
    // Seule la modale d'arrivée se tait : la banderole n'est pas modale et reste.
    expect(layout).toMatch(
      /modalSilenced=\{recruitmentModalSilenced\(\{\s*privacyPending: privacyChanges\.length > 0,/,
    );
    expect(layout).not.toMatch(/bannerDismissed=\{[^}]*privacyChanges/);
  });
});
