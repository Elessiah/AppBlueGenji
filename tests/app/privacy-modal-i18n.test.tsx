import { describe, expect, it, jest } from "@jest/globals";

/**
 * Lot 7b-2 : la fenêtre des changements de confidentialité parle la langue de
 * la page. Son habillage vient de `shell.privacyModal` ; ses entrées arrivent
 * déjà traduites de la mise en page (`localizedPrivacyChanges`).
 */
jest.mock("next/navigation", () => ({ usePathname: () => "/en/tournois" }));

import { renderToStaticMarkup } from "react-dom/server";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { ShellTextProvider } from "@/components/i18n/shell-text";
import { PrivacyChangesModal } from "@/components/privacy/PrivacyChangesModal";
import { ToastProvider } from "@/components/ui/toast";
import type { Locale } from "@/lib/shared/locales";
import { PRIVACY_CHANGES, privacyChangesHeading } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN, localizedPrivacyChanges } from "@/lib/shared/privacy-changes-en";
import enShell from "@/messages/en/shell.json";
import { legalPageText } from "../helpers/legal-text";

function render(locale: Locale): string {
  return renderToStaticMarkup(
    <AppLocaleProvider locale={locale}>
      <ShellTextProvider locale={locale} messages={locale === "en" ? enShell : undefined}>
        <ToastProvider>
          <PrivacyChangesModal changes={localizedPrivacyChanges(PRIVACY_CHANGES, locale)} />
        </ToastProvider>
      </ShellTextProvider>
    </AppLocaleProvider>,
  );
}

describe("PrivacyChangesModal — langue de la page", () => {
  it("en français : le texte d'avant, entrées françaises", () => {
    const text = legalPageText(render("fr"));
    expect(text).toContain("PROTECTION DES DONNÉES · RGPD");
    expect(text).toContain(privacyChangesHeading(PRIVACY_CHANGES.length));
    expect(text).toContain("J'ai pris connaissance");
    expect(text).toContain(PRIVACY_CHANGES[0].title);
    expect(text).toContain("23 septembre 2026");
  });

  it("sous /en : habillage, titres, détails et dates en anglais ; politique anglaise liée", () => {
    const html = render("en");
    const text = legalPageText(html);
    expect(text).toContain(`${PRIVACY_CHANGES.length} changes to our privacy rules`);
    expect(text).toContain("I have read this");
    expect(text).toContain("September 23, 2026");
    for (const change of PRIVACY_CHANGES) expect(text).toContain(PRIVACY_CHANGES_EN[change.id].title);
    expect(text).not.toContain(PRIVACY_CHANGES[0].title);
    expect(html).toContain('href="/en/rgpd"');
    // Les liens d'action gardent leur cible ; les pages encore françaises (profil) gardent leur adresse.
    expect(html).toContain('href="/profil#identite"');
    expect(text).toContain("Change my username or avatar");
    expect(text).not.toMatch(/\b(tes|ton|aucun accord|J'ai pris)\b/);
  });

  it("un seul changement : titre au singulier dans chaque langue", () => {
    const one = [PRIVACY_CHANGES[0]];
    const markup = (locale: Locale) =>
      renderToStaticMarkup(
        <AppLocaleProvider locale={locale}>
          <ShellTextProvider locale={locale} messages={locale === "en" ? enShell : undefined}>
            <ToastProvider>
              <PrivacyChangesModal changes={localizedPrivacyChanges(one, locale)} />
            </ToastProvider>
          </ShellTextProvider>
        </AppLocaleProvider>,
      );
    expect(legalPageText(markup("en"))).toContain("Our privacy rules have changed");
    expect(legalPageText(markup("fr"))).toContain("Nos règles de confidentialité ont changé");
  });
});
