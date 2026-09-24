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

  it("revient sur toute autre page, sous-pages de /rgpd comprises", () => {
    for (const path of ["/", "/profil", "/rgpd/autre", "/regles"]) {
      mockPathname = path;
      expect(render([...PRIVACY_CHANGES])).toMatch(/role="dialog"/);
    }
  });
  it("ne rend rien quand tout est accepté", () => {
    expect(render([])).not.toMatch(/role="dialog"/);
  });

  it("présente tous les changements dus d'un coup, avec leur date et leur détail", () => {
    const markup = render([...PRIVACY_CHANGES]);
    expect(markup).toMatch(/role="dialog"/);
    expect(markup).toMatch(/aria-modal="true"/);
    expect(markup).toContain(`${PRIVACY_CHANGES.length} changements de nos règles de confidentialité`);
    for (const change of PRIVACY_CHANGES) {
      expect(markup).toContain(change.title);
      expect(markup).toContain(`dateTime="${change.publishedAt}"`);
    }
    expect(markup).toContain(PRIVACY_CHANGES[0].details[0].slice(0, 40).replace(/'/g, "&#x27;"));
  });

  it("offre les deux issues, et elles seules", () => {
    const markup = render([PRIVACY_CHANGES[0]]);
    expect(markup).toContain("J&#x27;accepte");
    expect(markup).toContain("Je refuse, je supprime mon compte");
    expect(markup).not.toMatch(/Plus tard|Fermer/);
    expect(markup).toContain('href="/rgpd"');
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
    expect(source).toContain("changeIds: changes.map((change) => change.id)");
  });

  it("supprime le compte par la route ordinaire, après aperçu du plan", () => {
    expect(source).toContain('fetch("/api/profile/deletion"');
    expect(source).toContain('fetch("/api/profile", { method: "DELETE" })');
    expect(source).toContain("accountDeletionConfirmation(subject)");
    expect(source).toContain("Supprimer définitivement mon compte");
  });

  it("n'est pas refermable par Échap ni par un clic à côté", () => {
    expect(source).toMatch(/if \(step === "CONFIRM_DELETE"\) setStep\("REVIEW"\)/);
    expect(source).not.toMatch(/overlay[^>]*onClick/);
  });

  it("ne pose jamais le focus sur le bouton de refus", () => {
    // Au montage, rien : la liste reçoit le focus. En confirmation, le premier
    // bouton est « Retour » ; au retour en lecture, c'est la liste.
    expect(source).toContain("mountedStep.current === step");
    expect(source).toContain(`querySelector<HTMLElement>('[role="region"]')`);
    const confirmStep = source.slice(source.indexOf("SUPPRESSION DÉFINITIVE"));
    expect(confirmStep.indexOf("Retour")).toBeGreaterThan(-1);
    expect(confirmStep.indexOf("Retour")).toBeLessThan(confirmStep.indexOf("Supprimer définitivement mon compte"));
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
    expect(layout).toMatch(/modalStart=\{privacyChanges\.length > 0 \? null : modalStart\}/);
    expect(layout).not.toMatch(/bannerDismissed=\{[^}]*privacyChanges/);
  });
});
