import { describe, expect, it } from "@jest/globals";
import {
  LOGIN_PATH,
  TERMS_POSTPONED_MAX_AGE_SECONDS,
  TERMS_POSTPONED_VALUE,
  isTermsPostponed,
  recruitmentModalSilenced,
  termsModalDueOnLoad,
  termsModalSilencedOn,
} from "@/lib/shared/global-modals";
import { TERMS_PATH } from "@/lib/shared/terms-of-use";
import { readSource } from "../../helpers/read-source";

describe("isTermsPostponed", () => {
  it("ne reconnaît que la valeur posée par « Plus tard »", () => {
    expect(isTermsPostponed(TERMS_POSTPONED_VALUE)).toBe(true);
    expect(isTermsPostponed(undefined)).toBe(false);
    expect(isTermsPostponed("")).toBe(false);
    expect(isTermsPostponed("0")).toBe(false);
  });
});

describe("termsModalSilencedOn", () => {
  it("se tait sur la page des conditions et sur la connexion", () => {
    expect(termsModalSilencedOn(TERMS_PATH)).toBe(true);
    expect(termsModalSilencedOn(LOGIN_PATH)).toBe(true);
  });

  it("s'affiche ailleurs, chemin inconnu compris", () => {
    expect(termsModalSilencedOn("/")).toBe(false);
    expect(termsModalSilencedOn("/equipes/12")).toBe(false);
    expect(termsModalSilencedOn(null)).toBe(false);
    expect(termsModalSilencedOn(undefined)).toBe(false);
  });
});

describe("termsModalDueOnLoad", () => {
  const base = { termsRequired: true, postponed: false, pathname: "/" };

  it("s'ouvre quand les conditions sont dues et non reportées", () => {
    expect(termsModalDueOnLoad(base)).toBe(true);
  });

  it("ne s'ouvre pas sans conditions dues", () => {
    expect(termsModalDueOnLoad({ ...base, termsRequired: false })).toBe(false);
  });

  it("ne s'ouvre pas une fois reportée pour la session", () => {
    expect(termsModalDueOnLoad({ ...base, postponed: true })).toBe(false);
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

  it("la mise en page n'ouvre pas les conditions reportées pour la session", () => {
    expect(layout).toContain("initiallyRequired={termsRequired && !termsPostponed}");
  });

  it("« Plus tard » pose le cookie de session, l'acceptation l'efface", () => {
    expect(terms).toMatch(/const later = \(\) => \{[\s\S]*?writePostponedCookie\(true\)/);
    expect(terms).toContain("writePostponedCookie(false)");
    expect(terms).toContain("max-age=${TERMS_POSTPONED_MAX_AGE_SECONDS}");
  });

  it("borne le report à douze heures (la restauration de session garde un cookie sans durée)", () => {
    expect(TERMS_POSTPONED_MAX_AGE_SECONDS).toBe(12 * 60 * 60);
  });

  it("le report survit à un lien ouvert depuis un autre site (lax, jamais strict)", () => {
    expect(terms).toContain("samesite=lax");
    expect(terms).not.toContain("samesite=strict");
  });

  it("le report tombe à l'ouverture et à la fermeture d'une session", () => {
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
