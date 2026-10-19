import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

/**
 * Lot 7b-1 : la fenêtre d'acceptation des conditions (`TermsAcceptanceModal`),
 * rendue sur toutes les pages, parle la langue de la page
 * (`shell.termsModal`). Sous `/en`, elle lie les conditions anglaises et dit
 * que c'est le texte français — la même `TERMS_VERSION` — que l'on accepte.
 */
const flags = { runEffects: false };

jest.mock("next/navigation", () => ({
  usePathname: () => "/en/tournois",
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));
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
      `Les conditions d'utilisation du site ont été mises à jour (version ${TERMS_VERSION}, en vigueur depuis le ${formatTermsDate()}) : accepte-les pour continuer à utiliser le site.`,
    );
    expect(text).toContain(`${TERMS_CHECKBOX_LABEL} (lire les conditions).`);
    expect(html).toContain('href="/conditions-utilisation"');
    expect(html).not.toContain("hrefLang");
    expect(html).not.toContain(TERMS_TRANSLATION_NOTE.text);
  });

  it("le français des messages est celui des constantes partagées", () => {
    expect(frShell.termsModal.checkbox.startsWith(`${TERMS_CHECKBOX_LABEL} (`)).toBe(true);
    expect(frShell.termsModal.titleFirst).toBe("Accepte les conditions d'utilisation");
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

  it("première acceptation : un titre valable pour tout compte, gérant d'équipe ou non", () => {
    expect(legalPageText(render("en"))).toContain("Accept the terms of use");
    expect(legalPageText(render("fr"))).toContain("Accepte les conditions d'utilisation");
    expect(legalPageText(render("fr", "UPDATED"))).not.toContain("gérant");
    expect(legalPageText(render("en", "UPDATED"))).not.toContain("manage a team");
  });

  it("bloquante : « Me déconnecter » à la place de « Plus tard » (FR et EN)", () => {
    const fr = legalPageText(render("fr"));
    expect(fr).toContain("Me déconnecter");
    expect(fr).not.toContain("Plus tard");
    const en = legalPageText(render("en"));
    expect(en).toContain("Log me out");
    expect(en).not.toContain("Later");
  });

  it("pendant l'enregistrement, les boutons gardent le focus : aria-disabled + aria-busy, jamais disabled natif", () => {
    const modal = readSource("components/legal/TermsAcceptanceModal.tsx");
    // Aucun bouton nativement désactivé pendant l'envoi (la case, elle, peut l'être).
    expect(modal).not.toMatch(/<CyberButton[^>]*[^-]disabled=\{busy/);
    expect(modal).not.toContain("disabled={busy || !checked}");
    expect(modal.match(/aria-disabled=\{busy \|\| undefined\}/g)).toHaveLength(1);
    expect(modal).toContain("aria-disabled={busy || leaving || undefined}");
    expect(modal).toContain("aria-busy={busy || undefined}");
    // La case (sans le focus, qui est sur « J'accepte ») est figée pendant l'envoi, avec l'aspect éteint
    // de `:disabled` : « J'accepte » ne peut pas devenir nativement désactivé sous le focus.
    expect(modal).toMatch(/type="checkbox"\s+checked=\{checked\}[\s\S]*?disabled=\{busy\}/);
    expect(modal).toContain("disabled={!checked}");
  });

  it("au repos, « J'accepte » reste désactivé tant que la case n'est pas cochée", () => {
    const html = render("fr");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>J(?:'|&#x27;)accepte<\/button>/);
    expect(html).not.toContain('aria-busy="true"');
  });
});
