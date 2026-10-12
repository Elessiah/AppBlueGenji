/**
 * Lot 9-2, revue UI/UX — le formulaire de signalement parle anglais sous
 * `/en` : les textes anglais qui y renvoient nomment ses catégories telles
 * qu'il les affiche, l'heure d'un code suit la langue de la page, la
 * suppression du compte ramène à l'accueil de la même langue, et le bouton du
 * formulaire (chargé au clic) se dit occupé tant que son morceau n'est pas là.
 */
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import enReports from "@/messages/en/reports.json";
import enLogin from "@/messages/en/login.json";
import frLogin from "@/messages/fr/login.json";
import { ReportProblemButton } from "@/components/reports/ReportProblemButton";

const ROOT = join(__dirname, "..", "..");
const source = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** Textes anglais qui renvoient au formulaire (les annonces passées de `privacy-changes-en.ts` restent telles quelles). */
const ENGLISH_REFERRERS = [
  "app/rgpd/RgpdEn.tsx",
  "app/mentions-legales/MentionsLegalesEn.tsx",
  "app/accessibilite/AccessibilityStatementEn.tsx",
  "lib/shared/legal-text-en.ts",
  "lib/shared/processing-register-en.ts",
  "lib/shared/terms-of-use-en.ts",
  "messages/en/login.json",
];
const FRENCH_CATEGORY_NAMES = ["Droit d'auteur", "Droit d&apos;auteur", "Modération", "Hébergeur", "Autre", "Contestation", "« RGPD »"];

describe("catégories du formulaire citées en anglais", () => {
  it.each(ENGLISH_REFERRERS)("%s ne cite plus l'intitulé français", (path) => {
    const text = source(path);
    for (const name of FRENCH_CATEGORY_NAMES) expect(text).not.toContain(name);
  });

  it("les intitulés cités existent dans le formulaire anglais", () => {
    const labels = Object.values(enReports.categories).map((category) => category.label);
    expect(labels).toEqual(expect.arrayContaining(["Copyright", "Moderation", "Bug", "GDPR", "Host", "Other", "Appeal"]));
    for (const path of ENGLISH_REFERRERS) {
      for (const [, quoted] of source(path).matchAll(/“(\w+)” category/g)) expect(labels).toContain(quoted);
    }
    expect(enReports.privacy.followUp).toContain("“Appeal” category");
  });

  it("l'exposé de suspension : même phrase française, catégorie anglaise sous /en", () => {
    expect(frLogin.suspension.appealText).toContain("catégorie « Autre » (sans connexion)");
    expect(enLogin.suspension.appealText).toContain("category “Other” (no login needed)");
    expect(enLogin.suspension.appealText).not.toContain("<fr>");
  });
});

describe("langue de la page dans les gestes du profil", () => {
  it("l'heure d'expiration d'un code suit la langue de la page, français compris", () => {
    for (const dialog of ["DiscordBotHandleDialog", "DiscordVerificationDialog"]) {
      const text = source(`app/(secured)/profil/${dialog}.tsx`);
      expect(text).toContain("toLocaleTimeString(INTL_LOCALE[text.locale])");
      expect(text).not.toContain("toLocaleTimeString(undefined");
    }
  });

  it("la suppression du compte ramène à l'accueil de la langue de la page", () => {
    const page = source("app/(secured)/profil/page.tsx");
    expect(page).toContain('window.location.href = localeHref("/", text.locale);');
    expect(page).not.toContain('window.location.href = "/";');
  });
});

describe("bouton du formulaire de signalement", () => {
  it("rendu initial : ni occupé ni curseur d'attente", () => {
    const html = renderToStaticMarkup(<ReportProblemButton authenticated={false} label="Report a problem" />);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain("aria-busy");
    expect(html).not.toContain("progress");
  });

  it("précharge au survol et au focus, se dit occupé pendant le chargement", () => {
    const button = source("components/reports/ReportProblemButton.tsx");
    expect(button).toContain("onPointerEnter: preloadDialog");
    expect(button).toContain("onFocus: preloadDialog");
    expect(button).toContain('"aria-busy": pending || undefined');
    // Un seul chargement partagé, retenté après un échec.
    expect(button).toContain("dialogLoad ??= loadDialogModule()");
    expect(button).toContain("dialogLoad = null;");
  });
});
