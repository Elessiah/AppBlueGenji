import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROCESSING_ACTIVITIES } from "@/lib/shared/processing-register";
import { publicSitemapRoutes } from "@/lib/shared/sitemap";

/**
 * Les écrans du signalement et des conditions d'utilisation. Le harnais tourne
 * en environnement `node` : ces invariants se gardent sur la **source**. Chacun
 * répond à une exigence : le moyen de signaler doit être sur **toutes** les
 * pages, et les textes qui engagent l'association doivent dire la même chose
 * que le code.
 */
const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("« Signaler un problème » sur toutes les pages", () => {
  it("dans le pied de page de la vitrine", () => {
    const footer = read("components/cyber/landing/PublicFooter.tsx");
    expect(footer).toContain("<ReportProblemButton");
    expect(footer).toContain("href={TERMS_PATH}");
  });

  it("dans l'espace connecté, connecté ou non", () => {
    const layout = read("app/(secured)/layout.tsx");
    expect(layout).toContain("<SiteFooterBar authenticated={false} />");
    expect(layout).toContain("<SiteFooterBar authenticated />");
  });

  it("sur la page de connexion", () => {
    expect(read("app/connexion/layout.tsx")).toContain("<SiteFooterBar");
  });

  it("le pied de page léger porte aussi les textes qui engagent l'association", () => {
    const bar = read("components/legal/SiteFooterBar.tsx");
    expect(bar).toContain("<ReportProblemButton");
    expect(bar).toContain("href={TERMS_PATH}");
    expect(bar).toContain('href="/mentions-legales"');
    expect(bar).toContain('href="/rgpd"');
  });
});

describe("conditions d'utilisation à la création du compte", () => {
  it("la modale d'entrée de /connexion ne se valide qu'une fois la case cochée", () => {
    const modal = read("components/cyber/RgpdConsentModal.tsx");
    expect(modal).toContain("TERMS_CHECKBOX_LABEL");
    expect(modal).toMatch(/disabled=\{!termsChecked\}/);
  });

  it("la version acceptée est retenue, pour redemander à la suivante", () => {
    const login = read("app/connexion/_components/LoginForm.tsx");
    expect(login).toContain("String(TERMS_VERSION)");
    // Les trois portes transmettent l'acceptation.
    expect(login).toContain("termsAccepted={termsAccepted}");
    expect(login).toMatch(/termsAccepted,\s*\}\)/);
    expect(read("app/connexion/_components/OAuthButtons.tsx")).toContain("oauthStartPath(provider, { redirect, termsAccepted })");
  });

  it("les gérants d'équipe les acceptent depuis n'importe quelle page", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain("<TermsAcceptanceModal");
    expect(layout).toContain("needsTermsForTeamManagement");
  });

  it("la création d'une équipe et l'envoi d'un logo portent leur case", () => {
    const create = read("app/(secured)/equipes/creer/page.tsx");
    expect(create).toContain("acceptTerms");
    expect(create).toContain("LOGO_RIGHTS_FIELD");
    expect(read("app/(secured)/equipes/[id]/_components/TeamSettings.tsx")).toContain("LOGO_RIGHTS_FIELD");
  });

  it("la page des conditions est au plan du site", () => {
    expect(publicSitemapRoutes().map((page) => page.path)).toContain("/conditions-utilisation");
  });
});

describe("mentions légales", () => {
  const legal = read("app/mentions-legales/page.tsx");

  it("ne revendique plus la propriété des contenus des membres ni des marques des jeux", () => {
    expect(legal).not.toMatch(/est la propriété exclusive de l&apos;association Bluegenji Esport, sauf/);
    expect(legal).toContain("Ne lui appartiennent pas");
    expect(legal).toMatch(/Overwatch \(Blizzard\s+Entertainment\)/);
  });

  it("dit la qualité d'hébergeur et le moyen de signaler", () => {
    expect(legal).toContain("hébergeur");
    expect(legal).toContain("« Signaler un");
    expect(legal).toContain("href={TERMS_PATH}");
  });

  it("ne prétend plus n'utiliser qu'un seul cookie", () => {
    expect(legal).not.toContain("uniquement un cookie de session");
    expect(legal).toContain('href="/rgpd#cookies"');
  });
});

describe("politique de confidentialité et registre", () => {
  it("explique le parcours de réclamation et de contestation", () => {
    const rgpd = read("app/rgpd/page.tsx");
    expect(rgpd).toContain('id="signalements"');
    expect(rgpd).toContain("Le droit de contestation");
    expect(rgpd).toContain("LOGO_QUARANTINE_DAYS");
    expect(rgpd).toContain("REPORT_RETENTION_DAYS_AFTER_RESOLUTION");
  });

  it("tient la fiche du traitement au registre", () => {
    const fiche = PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T11");
    expect(fiche?.name).toMatch(/Signalements/);
    expect(fiche?.legalBasis).toContain("2022/2065");
  });
});

describe("dossier du panneau", () => {
  const detail = read("app/(secured)/admin/signalements/_components/ReportDetail.tsx");

  it("referme la boîte d'archivage une fois le dossier archivé", () => {
    // Laissée ouverte, elle offrait « Archiver » sur un dossier archivé : un 409.
    expect(detail).toContain("{resolving && !archived && (");
    expect(detail).toMatch(/if \(!archived\) return;\s*setResolving\(false\);/);
  });

  it("annonce la durée de conservation par la constante, pas par un nombre écrit", () => {
    expect(detail).toContain("{REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours plus tard");
    expect(detail).not.toMatch(/effacé 30 jours/);
  });
});

describe("stockage déclaré sur /rgpd", () => {
  const rgpd = read("app/rgpd/page.tsx");

  it("déclare la valeur locale des conditions acceptées, et ce que porte bg_oauth", () => {
    // `LoginForm` la pose à côté du consentement RGPD.
    expect(read("app/connexion/_components/LoginForm.tsx")).toContain('TERMS_STORAGE_KEY = "bg_terms_consent"');
    expect(rgpd).toContain("<strong>bg_terms_consent</strong>");
    expect(rgpd).toMatch(/bg_oauth[\s\S]*?conditions\s+d&apos;utilisation/);
  });
});
