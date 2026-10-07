import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

/**
 * Lot 7b-1 : la fenêtre d'acceptation des conditions (`TermsAcceptanceModal`),
 * rendue sur toutes les pages, parle la langue de la page
 * (`shell.termsModal`). Sous `/en`, elle lie les conditions anglaises et dit
 * que c'est le texte français — la même `TERMS_VERSION` — que l'on accepte.
 */
const flags = { runEffects: false };

jest.mock("next/navigation", () => ({ usePathname: () => "/en/tournois" }));
jest.mock("react-dom", () => {
  const actual = jest.requireActual<typeof import("react-dom")>("react-dom");
  return { ...actual, createPortal: (node: unknown) => node };
});
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    // Montage : seul le premier effet (`setMounted(true)`) est joué.
    useEffect: (effect: () => void) => {
      if (flags.runEffects) {
        flags.runEffects = false;
        effect();
      }
    },
  };
});
jest.mock("@/lib/shared/hooks/useDialogBehavior", () => ({ useDialogBehavior: () => ({ current: null }) }));
jest.mock("@/components/ui/toast", () => ({ useToast: () => ({ showError: () => undefined, showSuccess: () => undefined }) }));

import { renderToStaticMarkup } from "react-dom/server";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { ShellTextProvider } from "@/components/i18n/shell-text";
import { TermsAcceptanceModal } from "@/components/legal/TermsAcceptanceModal";
import { TERMS_TRANSLATION_NOTE } from "@/lib/shared/french-version-prevails";
import type { Locale } from "@/lib/shared/locales";
import type { TermsRequest } from "@/lib/shared/terms-of-use";
import { TERMS_CHECKBOX_LABEL, TERMS_VERSION, formatTermsDate, formatTermsDateIn } from "@/lib/shared/terms-of-use";
import enShell from "@/messages/en/shell.json";
import frShell from "@/messages/fr/shell.json";
import { legalPageText } from "../helpers/legal-text";
import { readSource } from "../helpers/read-source";

const globalWithDocument = globalThis as { document?: unknown };
const hadDocument = "document" in globalWithDocument;
beforeAll(() => {
  if (!hadDocument) globalWithDocument.document = { body: {} };
});
afterAll(() => {
  if (!hadDocument) delete globalWithDocument.document;
});

function render(locale: Locale, request: TermsRequest | null = null): string {
  flags.runEffects = true;
  return renderToStaticMarkup(
    <AppLocaleProvider locale={locale}>
      <ShellTextProvider locale={locale} messages={locale === "en" ? enShell : undefined}>
        <TermsAcceptanceModal
          initiallyRequired
          request={request}
          privacyPending={false}
          translationNote={locale === "en" ? TERMS_TRANSLATION_NOTE : null}
        />
      </ShellTextProvider>
    </AppLocaleProvider>,
  );
}

describe("TermsAcceptanceModal — langue de la page", () => {
  it("en français : le texte d'avant le lot 7b, sans note de traduction", () => {
    const html = render("fr", "UPDATED");
    const text = legalPageText(html);
    expect(text).toContain("CONDITIONS D'UTILISATION");
    expect(text).toContain("Les conditions d'utilisation ont changé");
    expect(text).toContain(
      `Tu es propriétaire ou gérant d'une équipe. Les conditions d'utilisation du site ont été mises à jour (version ${TERMS_VERSION}, en vigueur depuis le ${formatTermsDate()}) : accepte-les pour continuer à gérer ton équipe — logo, membres, invitations.`,
    );
    expect(text).toContain(`${TERMS_CHECKBOX_LABEL} (lire les conditions).`);
    expect(html).toContain('href="/conditions-utilisation"');
    expect(html).not.toContain("hrefLang");
    expect(html).not.toContain(TERMS_TRANSLATION_NOTE.text);
  });

  it("le français des messages est celui des constantes partagées", () => {
    expect(frShell.termsModal.checkbox.startsWith(`${TERMS_CHECKBOX_LABEL} (`)).toBe(true);
    expect(frShell.termsModal.titleFirst).toBe("Tu gères désormais une équipe");
  });

  it("sous /en : anglais, conditions anglaises liées, note « French text prevails » vers la page française", () => {
    const html = render("en", "UPDATED");
    const text = legalPageText(html);
    expect(text).toContain("The terms of use have changed");
    expect(text).toContain(`version ${TERMS_VERSION}, in force since ${formatTermsDateIn("en")}`);
    expect(text).toContain("I have read and accept the terms of use (read the terms).");
    expect(html).toContain('href="/en/conditions-utilisation"');
    expect(text).toContain(TERMS_TRANSLATION_NOTE.text);
    expect(html).toContain(`href="/conditions-utilisation" target="_blank" rel="noreferrer" hrefLang="fr">${TERMS_TRANSLATION_NOTE.link}</a>`);
    expect(text).not.toMatch(/\b(Tu|les|conditions|équipe)\b/);
  });

  it("la note anglaise n'est pas importée par la fenêtre : la mise en page la passe sous /en seulement", () => {
    const modal = readSource("components/legal/TermsAcceptanceModal.tsx");
    expect(modal).toContain("import type { TermsTranslationNote }");
    expect(modal).not.toMatch(/^import \{[^}]*\bTERMS_TRANSLATION_NOTE\b/m);
    expect(readSource("app/layout.tsx")).toContain("translationNote={locale === DEFAULT_LOCALE ? null : TERMS_TRANSLATION_NOTE}");
  });

  it("première acceptation : le titre de qui reçoit la main sur une équipe", () => {
    expect(legalPageText(render("en"))).toContain("You now manage a team");
    expect(legalPageText(render("fr"))).toContain("Tu gères désormais une équipe");
  });
});
