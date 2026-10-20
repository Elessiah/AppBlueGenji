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

  it("bloquante : « Supprimer mon compte » à la place de « Me déconnecter » (FR et EN), en bouton de danger", () => {
    const frHtml = render("fr");
    const fr = legalPageText(frHtml);
    expect(frHtml).toMatch(/<button class="[^"]*deleteButton[^"]*" type="button">Supprimer mon compte<\/button>/);
    expect(fr).not.toContain("Me déconnecter");
    expect(fr).not.toContain("Plus tard");
    const enHtml = render("en");
    const en = legalPageText(enHtml);
    expect(enHtml).toMatch(/<button[^>]*class="[^"]*deleteButton[^"]*"[^>]*>Delete my account<\/button>/);
    expect(en).not.toContain("Log me out");
    expect(en).not.toContain("Later");
    // Au repos, la suppression n'est ni lancée ni montée.
    expect(frHtml).not.toContain('aria-busy="true"');
    expect(frHtml).not.toContain("alertdialog");
    // Destructeur : le rouge de danger, jamais l'ambre (réservé aux avertissements).
    const css = readSource("components/legal/TermsAcceptanceModal.module.css");
    expect(css).toMatch(/\.actions \.deleteButton \{\s*color: var\(--danger\);/);
    expect(css).not.toContain("--amber");
  });

  it("dit comment partir sans accepter : supprimer d'ici, se déconnecter (lien-bouton), la politique et le profil liés, dans la langue de la page", () => {
    const fr = render("fr");
    expect(legalPageText(fr)).toContain("Tu ne veux pas les accepter ? Tu peux supprimer ton compte directement d'ici, te déconnecter, lire la politique de confidentialité ou ouvrir ton profil pour exporter tes données.");
    expect(fr).toMatch(/<button type="button" class="[^"]*textButton[^"]*">te déconnecter<\/button>/);
    expect(fr).toContain('href="/rgpd"');
    expect(fr).toContain('href="/profil"');
    const en = render("en");
    expect(legalPageText(en)).toContain("Don't want to accept them? You can delete your account right here, log out, read the privacy policy or open your profile to export your data.");
    expect(en).toMatch(/<button type="button" class="[^"]*textButton[^"]*">log out<\/button>/);
    expect(en).toContain('href="/en/rgpd"');
    expect(en).toContain('href="/en/profil"');
  });

  it("la déconnexion garde `useLogout` ; la suppression ouvre celle du profil, empilée, et rend le focus à son bouton à l'annulation", () => {
    const modal = readSource("components/legal/TermsAcceptanceModal.tsx");
    expect(modal).toContain("const { leaving, logout } = useLogout();");
    expect(modal).toMatch(/if \(!busy && !deletionOpen\) void logout\(\);/);
    expect(modal).toMatch(/if \(!busy && !leaving\) setDeletionOpen\(true\);/);
    expect(modal).toMatch(/\{deletionOpen \? \(\s*<TermsAccountDeletion\s+onClose=\{\(\) => \{\s*setDeletionOpen\(false\);\s*requestAnimationFrame\(\(\) => deleteButtonRef\.current\?\.focus\(\)\);/);
    // Chargée au clic seulement : ni son code ni l'espace `profile` dans chaque page.
    expect(modal).toContain('dynamic(\n  () => orReload(import("./TermsAccountDeletion")');
    expect(modal).not.toMatch(/^import .*use-account-deletion/m);
    // La fenêtre reste bloquante pendant la confirmation : Échap ne ferme que celle-ci (pile des modales).
    expect(modal).toContain("onClose: KEEP_OPEN");
    const flow = readSource("components/legal/TermsAccountDeletion.tsx");
    expect(flow).toContain('useAccountDeletion({ text, onCancel: onClose, layer: "overBlocking" })');
    expect(flow).toContain("useEnglishMessagesUntilRemount(locale, englishProfile)");
  });

  it("les textes légaux disent que le compte se supprime directement depuis la fenêtre (FR et EN)", () => {
    expect(readSource("lib/shared/terms-of-use.ts")).toContain("il peut toujours supprimer son compte directement depuis la fenêtre d'acceptation, se déconnecter,");
    expect(readSource("lib/shared/terms-of-use.ts")).toContain("il peut supprimer son compte depuis la fenêtre d'acceptation ou depuis son profil.");
    expect(readSource("lib/shared/terms-of-use-en.ts")).toContain("it can still delete its account directly from the acceptance window, log out,");
    expect(readSource("lib/shared/terms-of-use-en.ts")).toContain("it can delete its account from the acceptance window or from its profile.");
    expect(readSource("lib/shared/privacy-changes.ts")).toContain("Sans accepter, tu peux supprimer ton compte directement depuis cette fenêtre, te déconnecter,");
    expect(readSource("lib/shared/privacy-changes-en.ts")).toContain("Without accepting, you can delete your account directly from that window, log out,");
  });

  it("aucun texte de la fenêtre n'est perdu : FR et EN ont les mêmes clés, sans « logout » orphelin", () => {
    expect(Object.keys(enShell.termsModal).sort()).toEqual(Object.keys(frShell.termsModal).sort());
    expect(frShell.termsModal).not.toHaveProperty("logout");
    expect(frShell.termsModal.deleteAccount).toBe("Supprimer mon compte");
    expect(enShell.termsModal.deleteAccount).toBe("Delete my account");
  });

  it("pendant l'enregistrement, les boutons gardent le focus : aria-disabled + aria-busy, jamais disabled natif", () => {
    const modal = readSource("components/legal/TermsAcceptanceModal.tsx");
    // Aucun bouton nativement désactivé pendant l'envoi (la case, elle, peut l'être).
    expect(modal).not.toMatch(/<CyberButton[^>]*[^-]disabled=\{busy/);
    expect(modal).not.toContain("disabled={busy || !checked}");
    expect(modal).not.toMatch(/aria-disabled=\{busy \|\| undefined\}/);
    // Les trois gestes s'excluent : ni envoi pendant une déconnexion ou une suppression, ni l'inverse.
    expect(modal.match(/aria-disabled=\{busy \|\| leaving \|\| deletionOpen \|\| undefined\}/g)).toHaveLength(3);
    expect(modal).toContain("if (busy || leaving || deletionOpen || !checked) return;");
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
