import { afterEach, describe, expect, it, jest } from "@jest/globals";

/**
 * Lot 1 : la coquille rendue en anglais, comme sur une route traduite
 * (`/en/...`) — le middleware y pose `x-bg-locale: en`, la mise en page racine
 * fournit l'anglais aux composants client, `getTranslations` le donne aux
 * composants serveur.
 */
let mockPathname = "/en/regles";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("next-intl/server", () => {
  const { createTranslator } = jest.requireActual<typeof import("next-intl")>("next-intl");
  const { messagesFor } = jest.requireActual<typeof import("@/lib/server/i18n-messages")>("@/lib/server/i18n-messages");
  return {
    getTranslations: async (namespace?: "common.languageSwitcher" | "shell.header" | "shell.footer") =>
      createTranslator({ locale: "en", messages: messagesFor("en"), timeZone: "Europe/Paris", namespace }),
    getLocale: async () => "en",
  };
});
// En-tête et pied de page (asynchrones) sont rendus à part plus bas.
jest.mock("@/components/cyber/landing/PublicPageShell", () => ({
  PublicPageShell: ({ children }: { children: unknown }) => children,
}));
// `next/font/local` n'existe qu'au build de Next.
jest.mock("@/app/site-fonts", () => ({ FONT_VARIABLES: {} }));
jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => "en" }));
jest.mock("@/lib/server/auth", () => ({
  getCurrentUser: jest.fn(async () => null),
}));
jest.mock("@/lib/server/teams/roster", () => ({ getUserActiveTeam: jest.fn(async () => null) }));
jest.mock("@/lib/server/contact-service", () => ({
  getContactInfo: jest.fn(async () => ({ email: "", discordTag: "", discordUrl: "" })),
}));

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import GlobalError from "@/app/global-error";
import { GlobalErrorView, loadGlobalErrorShell } from "@/components/error-page/GlobalErrorView";
import NotFound, { generateMetadata } from "@/app/not-found";
import { AccessibilityPanel, accessibilityButtonLabel } from "@/components/accessibility/AccessibilityMenu";
import { SkipLink } from "@/components/accessibility/SkipLink";
import { AccountMenuPanel } from "@/components/account-menu";
import { ArenaNav } from "@/components/arena-nav";
import { FooterContact } from "@/components/cyber/landing/FooterContact";
import { PublicFooter } from "@/components/cyber/landing/PublicFooter";
import { PublicHeader } from "@/components/cyber/landing/PublicHeader";
import { PublicNavMenu } from "@/components/cyber/landing/PublicNavMenu";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { ShellTextProvider } from "@/components/i18n/shell-text";
import { SiteFooterBar } from "@/components/legal/SiteFooterBar";
import { ToastItem, ToastProvider } from "@/components/ui/toast";
import { messagesFor } from "@/lib/server/i18n-messages";
import { shellText } from "@/lib/shared/shell-text";
import { encodeContact } from "@/lib/shared/obfuscated-contact";

const noop = () => undefined;
const EN_SHELL = messagesFor("en").shell;

/** Comme la mise en page racine sous `/en/...`. */
function english(ui: ReactNode): string {
  return renderToStaticMarkup(
    <AppLocaleProvider locale="en">
      <ShellTextProvider locale="en" messages={EN_SHELL}>
        <ToastProvider>{ui}</ToastProvider>
      </ShellTextProvider>
    </AppLocaleProvider>,
  );
}

/** Mots de la coquille française qui ne doivent pas survivre en anglais. */
const FRENCH_LEFTOVERS =
  /Aller au contenu|Réglages|Accueil|Mon équipe|Mon profil|Déconnexion|Signaler|Mentions légales|Conditions d|Navigation principale|Fermer|Rejoindre|Réessayer|Référence|introuvable/;

describe("coquille en anglais — composants client", () => {
  afterEach(() => {
    mockPathname = "/en/regles";
  });

  it("lien d'évitement", () => {
    const html = english(<SkipLink />);
    expect(html).toContain('<a href="#contenu" class="skip-link">Skip to content</a>');
  });

  it("menu d'accessibilité : titre, réglages, nom du bouton au pluriel", () => {
    const html = english(
      <AccessibilityPanel id="p" titleId="t" settings={["focus"]} onToggle={noop} onReset={noop} onClose={noop} />,
    );
    expect(html).toContain(">Accessibility</p>");
    expect(html).toContain('aria-label="Close accessibility menu"');
    expect(html).toContain("Highly visible focus");
    expect(html).toContain("Accessibility statement");
    expect(html).toContain("Turn all off");
    expect(html).not.toMatch(FRENCH_LEFTOVERS);

    const en = shellText("en", EN_SHELL);
    expect(accessibilityButtonLabel(0, en)).toBe("Accessibility settings");
    expect(accessibilityButtonLabel(1, en)).toBe("Accessibility settings (1 active)");
    expect(accessibilityButtonLabel(3, en)).toBe("Accessibility settings (3 active)");
    // Le français garde son accord.
    expect(accessibilityButtonLabel(1)).toBe("Réglages d'accessibilité (1 actif)");
    expect(accessibilityButtonLabel(2)).toBe("Réglages d'accessibilité (2 actifs)");
  });

  it("barre des connectés : sections, signalements — liens sans préfixe vers des routes non traduites", () => {
    mockPathname = "/en/equipes/12";
    const html = english(
      <ArenaNav pseudo="Nova" avatarUrl={null} activeTeam={{ teamId: 7, teamName: "Les Ours" }} openReports={2} />,
    );
    expect(html).toContain('aria-label="Main navigation"');
    expect(html).toMatch(/aria-current="page"[^>]*>Teams<\/a>/);
    for (const label of ["Players", "Tournaments", "Ranking", "Home", "Reports"]) expect(html).toContain(label);
    expect(html).toContain('<span class="sr-only">, 2 to review</span>');
    expect(html).toContain('aria-label="Nova, account menu"');
    // « My team » vit dans le menu du compte (AccountMenuPanel), plus dans la barre.
    expect(html).not.toContain('href="/equipes/7"');
    expect(html).not.toMatch(FRENCH_LEFTOVERS);
  });

  it("coordonnées : bouton « Show email » en anglais (lot 7b) ; édition du staff marquée `lang=\"fr\"` (WCAG 3.1.2), muette en français", () => {
    const contact = { emailEncoded: encodeContact("asso@example.org"), discordTag: "", discordUrl: "" };
    const html = english(<FooterContact initialContact={contact} isAdmin />);
    expect(html).toContain('aria-label="Show email address of the association">Show email</button>');
    expect(html).not.toContain("Afficher");
    expect(html).toMatch(/<button[^>]*lang="fr"[^>]*>Modifier<\/button>/);
    const french = renderToStaticMarkup(
      <ToastProvider>
        <FooterContact initialContact={contact} isAdmin />
      </ToastProvider>,
    );
    expect(french).not.toContain('lang="fr"');
  });

  it("menu du compte", () => {
    const html = english(
      <AccountMenuPanel id="c" activeTeam={{ teamId: 7, teamName: "Les Ours" }} leaving onNavigate={noop} onLogout={noop} />,
    );
    expect(html).toContain("My profile");
    expect(html).toContain("Logging out…");
    expect(html).not.toMatch(FRENCH_LEFTOVERS);
  });

  it("menu burger de la vitrine", () => {
    const html = english(<PublicNavMenu />);
    expect(html).toContain('aria-label="Open menu"');
    expect(html).toContain(">MENU<");
  });

  it("pied de page léger", () => {
    const html = english(<SiteFooterBar authenticated={false} />);
    expect(html).toContain('aria-label="Legal information"');
    for (const label of ["Report a problem", "Terms of use", "Legal notice", "Privacy", "Source code", "© 2026 Bluegenji Esport"]) {
      expect(html).toContain(label);
    }
    expect(html).not.toMatch(FRENCH_LEFTOVERS);
  });

  it("notification : préfixe lu et boutons", () => {
    const html = english(<ToastItem toast={{ id: 1, message: "Saved.", type: "success" }} onDismiss={noop} />);
    expect(html).toContain('<span class="sr-only">Success: </span>');
    expect(html).toContain('aria-label="Pause notification"');
    expect(html).toContain('title="Pause"');
    expect(html).toContain('aria-label="Close notification"');
    expect(html).toContain('title="Close"');
    const error = english(<ToastItem toast={{ id: 2, message: "Nope.", type: "error" }} onDismiss={noop} />);
    expect(error).toContain('<span class="sr-only">Error: </span>');
  });

  it("notification : message resté en français marqué `lang`, rien sans l'option", () => {
    const marked = english(
      <ToastItem toast={{ id: 3, message: "Erreur réseau, réessaye.", type: "error", lang: "fr" }} onDismiss={noop} />,
    );
    expect(marked).toContain('<span class="sr-only">Error: </span><span lang="fr">Erreur réseau, réessaye.</span>');
    const plain = english(<ToastItem toast={{ id: 4, message: "Saved.", type: "success" }} onDismiss={noop} />);
    expect(plain).not.toContain("lang=");
  });

  it("notification : préfixe français inchangé hors fournisseur", () => {
    const html = renderToStaticMarkup(<ToastItem toast={{ id: 2, message: "Non.", type: "error" }} onDismiss={noop} />);
    expect(html).toContain('<span class="sr-only">Erreur : </span>');
    expect(html).toContain('aria-label="Mettre en pause la notification"');
  });
});

describe("coquille en anglais — composants serveur", () => {
  it("en-tête de la vitrine (déconnecté)", async () => {
    const html = english(await PublicHeader());
    expect(html).toContain(">Join →</a>");
    expect(html).toContain('<span class="logotype">BlueGenji</span>');
    // Précision du sélecteur, déjà traduite au lot 0.
    expect(html).not.toMatch(FRENCH_LEFTOVERS);
  });

  it("pied de page de la vitrine", async () => {
    const html = english(await PublicFooter());
    for (const label of [
      "Nonprofit association (French law of 1901).",
      "COMPETITIONS",
      ">LEGAL<",
      "Manifesto",
      "Volunteers",
      "Partners",
      "Bylaws (in French)",
      "Internal rules (in French)",
      "Accessibility settings",
      "Accessibility: non-compliant",
      "Report a problem",
      "Source code",
    ]) {
      expect(html).toContain(label);
    }
    // Documents uniquement en français : signalés au lecteur d'écran.
    expect(html).toContain('href="/statuts.pdf" hrefLang="fr"');
    expect(html).not.toMatch(FRENCH_LEFTOVERS);
  });
});

describe("pages d'erreur en anglais", () => {
  it("404 : textes, liens de retour et titre d'onglet", async () => {
    const html = english(await NotFound());
    expect(html).toContain("ERROR 404");
    expect(html).toContain("Page not found");
    expect(html).toContain("Back to home");
    expect(html).toContain("See tournaments");
    expect(html).toContain("Read the rules");
    expect(html).not.toMatch(/introuvable|Retour à l/);
    await expect(generateMetadata()).resolves.toEqual({
      title: { absolute: "Page not found · BlueGenji Esport" },
      robots: { index: false, follow: false },
    });
  });

  it("dernier filet : langue relue dans l'adresse, anglais chargé à la demande, `<html lang>` compris", async () => {
    const error = Object.assign(new Error("boom"), { digest: "abc" });
    // Premier rendu : l'anglais n'est pas encore arrivé, la page le dit.
    const before = renderToStaticMarkup(<GlobalError error={error} />);
    expect(before).toMatch(/^<html lang="fr">/);
    const messages = await loadGlobalErrorShell("en");
    expect(messages).toEqual(EN_SHELL);
    expect(await loadGlobalErrorShell("fr")).toBeUndefined();
    const html = renderToStaticMarkup(<GlobalErrorView error={error} locale="en" messages={messages} onRetry={noop} />);
    expect(html).toMatch(/^<html lang="en">/);
    expect(html).toContain("<title>Something went wrong · BlueGenji Esport</title>");
    expect(html).toContain("Try again");
    expect(html).toContain('Reference: <span class="mono">abc</span>');
    expect(html).not.toContain("boom");
  });

  it("dernier filet : français sur une adresse sans préfixe", () => {
    mockPathname = "/tournois";
    const html = renderToStaticMarkup(<GlobalError error={new Error("boom")} />);
    expect(html).toMatch(/^<html lang="fr">/);
    expect(html).toContain("<title>Un problème est survenu · BlueGenji Esport</title>");
    expect(html).toContain("Réessayer");
    expect(html).toContain("Retour à l&#x27;accueil");
    mockPathname = "/en/regles";
  });
});
