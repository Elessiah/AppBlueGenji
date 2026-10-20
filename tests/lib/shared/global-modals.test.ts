import { describe, expect, it } from "@jest/globals";
import {
  LOGIN_PATH,
  recruitmentModalSilenced,
  termsModalDueOnLoad,
  termsModalSilencedOn,
} from "@/lib/shared/global-modals";
import { TERMS_PATH } from "@/lib/shared/terms-of-use";
import { readSource } from "../../helpers/read-source";

describe("termsModalSilencedOn", () => {
  it("se tait sur la page des conditions et sur la connexion", () => {
    expect(termsModalSilencedOn(TERMS_PATH)).toBe(true);
    expect(termsModalSilencedOn(LOGIN_PATH)).toBe(true);
  });

  it("conditions v6 : laisse lire les pages légales, exporter ou supprimer son compte sans accepter", () => {
    for (const path of [
      "/rgpd",
      "/rgpd/registre",
      "/mentions-legales",
      "/accessibilite",
      "/privacy-policy-bot",
      "/terms-of-service-bot",
      "/regles",
      "/regles/marvel-rivals",
      "/signalements",
      "/signalements/12",
      "/profil",
    ]) {
      expect(termsModalSilencedOn(path)).toBe(true);
    }
    // Préfixe exact : une autre page qui commencerait pareil reste bloquée.
    expect(termsModalSilencedOn("/profilage")).toBe(false);
    expect(termsModalSilencedOn("/rgpdx")).toBe(false);
  });

  it("s'affiche ailleurs, chemin inconnu compris", () => {
    expect(termsModalSilencedOn("/")).toBe(false);
    expect(termsModalSilencedOn("/equipes/12")).toBe(false);
    expect(termsModalSilencedOn(null)).toBe(false);
    expect(termsModalSilencedOn(undefined)).toBe(false);
  });
});

describe("termsModalDueOnLoad", () => {
  const base = { termsRequired: true, pathname: "/" };

  it("s'ouvre quand les conditions sont dues (aucun report possible)", () => {
    expect(termsModalDueOnLoad(base)).toBe(true);
  });

  it("ne s'ouvre pas sans conditions dues", () => {
    expect(termsModalDueOnLoad({ ...base, termsRequired: false })).toBe(false);
  });

  it("ne s'ouvre pas sur les pages où elle se tait", () => {
    expect(termsModalDueOnLoad({ ...base, pathname: LOGIN_PATH })).toBe(false);
    expect(termsModalDueOnLoad({ ...base, pathname: TERMS_PATH })).toBe(false);
  });
});

describe("recruitmentModalSilenced", () => {
  const base = { privacyPending: false, termsModalDue: false, pathname: "/" };

  it("laisse passer la modale quand rien n'attend de réponse", () => {
    expect(recruitmentModalSilenced(base)).toBe(false);
  });

  it("se tait devant un choix de confidentialité", () => {
    expect(recruitmentModalSilenced({ ...base, privacyPending: true })).toBe(true);
  });

  it("se tait devant les conditions qui s'ouvrent au chargement", () => {
    expect(recruitmentModalSilenced({ ...base, termsModalDue: true })).toBe(true);
  });

  it("se tait sur la connexion, dont la modale de consentement passe d'abord", () => {
    expect(recruitmentModalSilenced({ ...base, pathname: LOGIN_PATH })).toBe(true);
  });
});

describe("câblage des modales globales", () => {
  const layout = readSource("app/layout.tsx");
  const terms = readSource("components/legal/TermsAcceptanceModal.tsx");

  it("la mise en page fait taire le recrutement par la règle partagée", () => {
    expect(layout).toContain("modalSilenced={recruitmentModalSilenced(");
    expect(layout).toContain("termsModalDue: termsDueOnLoad");
  });

  it("conditions v6 : la mise en page ouvre la fenêtre à tout compte en retard, sans report", () => {
    expect(layout).toContain("initiallyRequired={termsRequired}");
    expect(layout).toContain("needsTermsAcceptance(userId)");
    expect(layout).not.toContain("isTermsPostponed");
  });

  it("la fenêtre est bloquante : ni « Plus tard », ni Échap, ni voile — accepter, supprimer son compte ou se déconnecter", () => {
    expect(terms).not.toContain("writePostponedCookie");
    expect(terms).not.toContain("useBackdropDismiss");
    expect(terms).not.toContain('t("termsModal.later")');
    expect(terms).toContain("onClose: KEEP_OPEN");
    expect(terms).toContain('t("termsModal.deleteAccount")');
    expect(terms).not.toContain('t("termsModal.logout")');
    // La déconnexion reste, en lien de la phrase des issues.
    expect(terms).toContain("useLogout()");
    expect(terms).toMatch(/logout: \(children\) => \(\s*<button\s+type="button"/);
  });

  it("un ancien cookie de report tombe à l'ouverture et à la fermeture d'une session", () => {
    const auth = readSource("lib/server/auth.ts");
    const create = auth.match(/export async function createSession[\s\S]*?\n\}/)?.[0] ?? "";
    const clear = auth.match(/export async function clearSession[\s\S]*?\n\}/)?.[0] ?? "";
    expect(create).toContain("forgetTermsPostponement(cookieStore)");
    expect(clear).toContain("forgetTermsPostponement(cookieStore)");
    expect(auth).toMatch(/cookieStore\.set\(TERMS_POSTPONED_COOKIE, "", \{[^}]*maxAge: 0/);
  });

  it("la modale des conditions se tait par la règle partagée", () => {
    expect(terms).toContain("!termsModalSilencedOn(pathname)");
  });

  it("la modale de confidentialité défile sur un écran bas", () => {
    const css = readSource("components/privacy/PrivacyChangesModal.module.css");
    const modal = css.match(/\.modal \{[^}]*\}/)?.[0] ?? "";
    expect(modal).toContain("overflow-y: auto");
  });
});
