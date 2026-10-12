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
    // Un seul chargement partagé, retenté après un échec, qui le dit.
    expect(button).toContain("dialogLoad ??= import(");
    expect(button).toContain("dialogLoad = null;");
    expect(button).toContain('toast?.showError(t("footer.reportLoadFailed"))');
    expect(button).not.toContain('from "next/dynamic"');
  });
});

describe("revue UI/UX, deuxième passe", () => {
  it("compteur de caractères manquants accordé au singulier", async () => {
    const { reportsText } = await import("@/components/reports/reports-text");
    expect(reportsText("fr").t("dialog.tooShort", { count: 1 })).toBe("Encore 1 caractère au moins.");
    expect(reportsText("fr").t("dialog.tooShort", { count: 4 })).toBe("Encore 4 caractères au moins.");
    expect(reportsText("en").t("dialog.tooShort", { count: 1 })).toBe("At least 1 more character.");
    expect(reportsText("en").t("dialog.tooShort", { count: 4 })).toBe("At least 4 more characters.");
  });

  it("lien d'invitation Discord : nouvel onglet annoncé aux lecteurs d'écran", () => {
    for (const dialog of ["DiscordBotHandleDialog", "DiscordVerificationDialog"]) {
      const text = source(`app/(secured)/profil/${dialog}.tsx`);
      expect(text).toMatch(/target="_blank"[\s\S]{0,600}<span className="sr-only">\{t\("verify\.newTab"\)\}<\/span>/);
    }
  });

  it("dates d'une image : heure de Paris, langue de la page, une seule fonction", async () => {
    const { formatQuarantineDate } = await import("@/lib/shared/logo-quarantine");
    // 23 h 30 UTC le 31 décembre = 1er janvier à Paris, quel que soit le fuseau du lecteur.
    const date = new Date("2026-12-31T23:30:00Z");
    expect(formatQuarantineDate(date)).toBe("1 janvier 2027");
    expect(formatQuarantineDate(date, "en-US")).toBe("January 1, 2027");
    const view = source("app/(secured)/signalements/[id]/_components/ConcernedReport.tsx");
    expect(view).not.toContain("formatPurgeDate");
    expect(view).not.toMatch(/formatDate\(quarantine\./);
  });

  it("identifiant d'un fournisseur : le registre décide, chaque libellé est traduit", async () => {
    const { OAUTH_PROVIDER_HANDLE_LABELS } = await import("@/lib/shared/oauth-providers");
    const enProfile = (await import("@/messages/en/profile.json")).default;
    const frProfile = (await import("@/messages/fr/profile.json")).default;
    const withHandle = Object.entries(OAUTH_PROVIDER_HANDLE_LABELS)
      .filter(([, label]) => label !== null)
      .map(([provider]) => provider)
      .sort((a, b) => a.localeCompare(b));
    expect(Object.keys(enProfile.connections.handleLabels).sort((a, b) => a.localeCompare(b))).toEqual(withHandle);
    expect(Object.keys(frProfile.connections.handleLabels).sort((a, b) => a.localeCompare(b))).toEqual(withHandle);
    expect(source("app/(secured)/profil/ConnectedAppsSection.tsx")).not.toContain('provider !== "GOOGLE"');
  });

  it("ligne du bot : chaque cas traduit depuis son code, sans redécider", async () => {
    const { discordBotRowText, FR_PROFILE } = await import("@/app/(secured)/profil/_lib/profile-text");
    const { scopedText } = await import("@/lib/shared/scoped-text");
    const enProfile = (await import("@/messages/en/profile.json")).default;
    const en = scopedText("en", enProfile);
    const codes = ["HANDLE", "LINKED_BY_CODE", "LINKED_BY_BUTTON", "LINKED_ELSEWHERE", "NOT_LINKED"] as const;
    const notes = codes.map((noteCode) => discordBotRowText(en, { noteCode, handle: "gamer", refusal: null }).note);
    expect(new Set(notes).size).toBe(codes.length);
    expect(notes[0]).toContain("gamer");
    expect(discordBotRowText(FR_PROFILE, { noteCode: "HANDLE", handle: "gamer", refusal: "x" }).refusal).toBe(
      FR_PROFILE.t("connections.bot.lastConnection"),
    );
    expect(source("app/(secured)/profil/_lib/profile-text.ts")).not.toContain("checkConnectionUnlink");
  });
});
