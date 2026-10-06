import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * Lot 6 : la connexion (`/connexion`, `/en/connexion`) en français et en
 * anglais — page, boutons OAuth, refus, exposé de suspension, modale d'entrée
 * (`docs/features/I18N.md` § Connexion). La langue vient de `x-bg-locale`
 * (`requestLocale()`), simulée ici. L'aller-retour OAuth et la garde des
 * redirections ont leurs propres tests (`oauth-flow.test.ts`,
 * `safe-redirect.test.ts`).
 */
let mockLocale: "fr" | "en" = "en";
const mockUser = { current: null as null | { id: number } };
const flags = { flipFalseState: false, runEffects: false };

jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => mockLocale }));
jest.mock("@/lib/server/auth", () => ({ getCurrentUser: jest.fn(async () => mockUser.current) }));
jest.mock("next/headers", () => ({ headers: async () => new Headers() }));
jest.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  usePathname: () => "/en/connexion",
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("react-dom", () => {
  const actual = jest.requireActual<typeof import("react-dom")>("react-dom");
  return { ...actual, createPortal: (node: unknown) => node };
});
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    // Second écran du formulaire (code demandé) : les états booléens partent à `true`.
    useState: (initial: unknown) => actual.useState(flags.flipFalseState && initial === false ? true : initial),
    // Montage de l'exposé de suspension (portail posé après le premier rendu).
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

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import LoginPage from "@/app/connexion/page";
import { generateMetadata } from "@/app/connexion/layout";
import { LoginForm } from "@/app/connexion/_components/LoginForm";
import { OAuthButtons } from "@/app/connexion/_components/OAuthButtons";
import { SuspensionNoticeDialog } from "@/app/connexion/_components/SuspensionNoticeDialog";
import { loginErrorMessage, oauthErrorMessage } from "@/app/connexion/_lib/login-errors";
import { RgpdConsentModal } from "@/components/cyber/RgpdConsentModal";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { LoginTextProvider } from "@/components/i18n/login-text";
import { messagesFor } from "@/lib/server/i18n-messages";
import {
  SUSPENSION_GROUND_DEFINITIONS,
  SUSPENSION_GROUNDS,
  suspendedLoginMessage,
  suspensionContestText,
  suspensionSpan,
  type SuspensionNotice,
} from "@/lib/shared/account-suspension";
import { MIGRATED_ROUTES } from "@/lib/shared/i18n-routes";
import { DISCORD_LOGIN_TAG_NOTICE, DISCORD_TAG_AUDIENCE } from "@/lib/shared/identity-sharing";
import { loginEnvironmentAdvice, loginEnvironmentNotice } from "@/lib/shared/login-environment";
import { loginText, suspendedLoginText, suspensionEndText, suspensionSpanText } from "@/lib/shared/login-text";
import { LOCALES, SITE_TIME_ZONE, isMigratedRoute, localeHref, type Locale } from "@/lib/shared/locales";
import { formatMessage, formatMessageParts } from "@/lib/shared/message-format";
import { oauthStartPath } from "@/lib/shared/oauth-providers";
import { localizedSitemapEntries, publicSitemapRoutes } from "@/lib/shared/sitemap";
import { SITE_MINIMUM_AGE, TERMS_AGE_DECLARATION, TERMS_CHECKBOX_LABEL } from "@/lib/shared/terms-of-use";
import { readSource } from "../helpers/read-source";

const FR = messagesFor("fr").login;
const EN = messagesFor("en").login;
const EN_TEXT = loginText("en", EN);
const FR_TEXT = loginText("fr");

const globalWithDocument = globalThis as { document?: unknown };
const hadDocument = "document" in globalWithDocument;
beforeAll(() => {
  if (!hadDocument) globalWithDocument.document = { body: {} };
});
afterAll(() => {
  if (!hadDocument) delete globalWithDocument.document;
});

beforeEach(() => {
  mockLocale = "en";
  mockUser.current = null;
  flags.flipFalseState = false;
  flags.runEffects = false;
});

function render(ui: ReactElement, locale: Locale): string {
  return renderToStaticMarkup(
    <AppLocaleProvider locale={locale}>
      <LoginTextProvider locale={locale} messages={locale === "fr" ? undefined : messagesFor(locale).login}>
        {ui}
      </LoginTextProvider>
    </AppLocaleProvider>,
  );
}

/** Texte lu par le visiteur, attributs lus par un lecteur d'écran compris, sans balisage. */
function visibleText(html: string): string {
  const attributes = [...html.matchAll(/(?:aria-label|title|alt|placeholder)="([^"]*)"/g)].map((m) => m[1]);
  return [html.replace(/<[^>]+>/g, " "), ...attributes]
    .join(" ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

type Tree = { [key: string]: string | Tree };
function leaves(tree: unknown, prefix = ""): Array<{ key: string; source: string }> {
  if (typeof tree === "string") return [{ key: prefix, source: tree }];
  return Object.entries(tree as Tree).flatMap(([key, value]) => leaves(value, prefix ? `${prefix}.${key}` : key));
}

/**
 * Les morceaux de phrases françaises de la page (balises et arguments retirés),
 * assez longs pour ne pas être un nom propre. Seul « Autre » reste cité sous
 * `/en` : c'est l'intitulé, encore français, de la catégorie du formulaire de
 * signalement (lot 9), entre guillemets anglais et suivi de sa traduction.
 */
const FRENCH_FRAGMENTS = (() => {
  const en = new Set(leaves(EN).map((leaf) => leaf.source));
  return leaves(FR)
    .map((leaf) => leaf.source)
    .filter((text) => !en.has(text))
    .flatMap((text) => text.replace(/<\/?\w+>/g, "").split(/\{[^}]*\}/))
    .map((text) => text.trim())
    .filter((text) => text.length >= 12);
})();

/** Lettres accentuées du français ; « Autre » et un motif saisi par la modération mis à part. */
const ACCENTED = /[àâçéèêëîïôûùüÿœÀÂÇÉÈÊËÎÏÔÛÙÜŸŒ«»]/;

function expectNoFrench(text: string) {
  for (const fragment of FRENCH_FRAGMENTS) expect(text).not.toContain(fragment);
  expect(text).not.toMatch(ACCENTED);
}

describe("liste blanche — la connexion est traduite", () => {
  it("ouvre /en/connexion, requête comprise", () => {
    expect(MIGRATED_ROUTES).toContain("/connexion");
    expect(isMigratedRoute("/connexion")).toBe(true);
    expect(localeHref("/connexion?redirect=%2Fen%2Fregles", "en")).toBe("/en/connexion?redirect=%2Fen%2Fregles");
    expect(localeHref("/connexion", "fr")).toBe("/connexion");
  });

  it("la carte « Connexion requise » mène à la connexion de la langue lue, destination préfixe compris", () => {
    const gate = readSource("app/(secured)/_shared/AuthGate.tsx");
    expect(gate).toContain("<LocaleLink href={loginHref}>");
    expect(gate).toMatch(/const destination = `\$\{pathname\}\$\{search\}`/);
    expect(gate).toContain("const pathname = usePathname();");
  });

  it("reste hors du sitemap dans les deux langues (noindex)", () => {
    const paths = localizedSitemapEntries(publicSitemapRoutes()).map((entry) => entry.path);
    expect(paths).not.toContain("/connexion");
    expect(paths).not.toContain("/en/connexion");
  });
});

describe("métadonnées par langue", () => {
  it("anglais : titre, description, canonique, hreflang, toujours noindex", async () => {
    mockLocale = "en";
    const metadata = await generateMetadata();
    expect(metadata.title).toBe("Log in");
    expectNoFrench(String(metadata.description));
    expect(metadata.alternates?.canonical).toBe("/en/connexion");
    expect(metadata.alternates?.languages).toEqual({ fr: "/connexion", en: "/en/connexion", "x-default": "/connexion" });
    expect(metadata.openGraph).toEqual(expect.objectContaining({ locale: "en_US" }));
    expect(metadata.robots).toEqual({ index: false, follow: true });
  });

  it("français : inchangé", async () => {
    mockLocale = "fr";
    const metadata = await generateMetadata();
    expect(metadata.title).toBe("Connexion");
    expect(metadata.description).toBe("Connexion à l'espace membre BlueGenji Esport, par compte Google ou par code Discord.");
    expect(metadata.alternates?.canonical).toBe("/connexion");
    expect(metadata.openGraph).toEqual(expect.objectContaining({ locale: "fr_FR" }));
    expect(metadata.robots).toEqual({ index: false, follow: true });
  });
});

describe("page — la langue de la requête", () => {
  it("sous /en, sert l'anglais (seul dictionnaire sérialisé)", async () => {
    mockLocale = "en";
    const html = renderToStaticMarkup(
      <AppLocaleProvider locale="en">{await LoginPage({ searchParams: Promise.resolve({}) })}</AppLocaleProvider>,
    );
    expect(html).toContain(">Log in<");
    expectNoFrench(visibleText(html));
  });

  it("en français, rend les textes d'avant le lot 6", async () => {
    mockLocale = "fr";
    const html = renderToStaticMarkup(
      <AppLocaleProvider locale="fr">{await LoginPage({ searchParams: Promise.resolve({}) })}</AppLocaleProvider>,
    );
    const text = visibleText(html);
    for (const phrase of [
      "← Retour à l'accueil",
      "BLUEGENJI · ACCÈS MEMBRE",
      "OU CODE PAR MESSAGE PRIVÉ",
      "Tag Discord ou ID",
      "ton_pseudo ou 123456789012345678",
      "Recevoir un code →",
      "Continuer avec Discord",
      "Continuer avec Google",
      "Continuer avec Blizzard",
      "Renseigne ton BattleTag automatiquement.",
      DISCORD_LOGIN_TAG_NOTICE,
    ]) {
      expect(text).toContain(phrase);
    }
    expect(html).toContain('href="/"');
  });

  it("renvoie un visiteur déjà connecté vers sa destination, dans la langue de la page", async () => {
    mockUser.current = { id: 7 };
    mockLocale = "en";
    await expect(LoginPage({ searchParams: Promise.resolve({ redirect: "/regles" }) })).rejects.toThrow("NEXT_REDIRECT /en/regles");
    await expect(LoginPage({ searchParams: Promise.resolve({ redirect: "/en/connexion" }) })).rejects.toThrow("NEXT_REDIRECT /tournois");
    await expect(LoginPage({ searchParams: Promise.resolve({ redirect: "/en//exemple.invalid" }) })).rejects.toThrow("NEXT_REDIRECT /tournois");
    mockLocale = "fr";
    await expect(LoginPage({ searchParams: Promise.resolve({ redirect: "/en/regles" }) })).rejects.toThrow("NEXT_REDIRECT /regles");
  });
});

describe("formulaire — /en/connexion sans un mot de français", () => {
  it("premier écran : boutons, séparateur, champ, aide, retour à l'accueil anglais", () => {
    const html = render(<LoginForm />, "en");
    const text = visibleText(html);
    for (const phrase of ["← Back to home", "Log in", "Continue with Discord", "Get a code →", "Discord tag or ID", "Join us"]) {
      expect(text).toContain(phrase);
    }
    // Retour à l'accueil anglais, départ OAuth qui emporte la langue.
    expect(html).toContain('href="/en"');
    expect(html).toContain("/api/auth/discord/start?redirect=%2Ftournois&amp;lang=en");
    expectNoFrench(text);
  });

  it("second écran (code demandé) : anglais aussi", () => {
    flags.flipFalseState = true;
    const html = render(<LoginForm />, "en");
    const text = visibleText(html);
    for (const phrase of ["Discord account", "Code received by DM (6 digits)", "Site username", "← USE ANOTHER ACCOUNT", "Checking..."]) {
      expect(text).toContain(phrase);
    }
    expectNoFrench(text);
  });

  it("second écran en français : inchangé", () => {
    flags.flipFalseState = true;
    const text = visibleText(render(<LoginForm />, "fr"));
    for (const phrase of ["Compte Discord", "Code reçu en DM (6 chiffres)", "(facultatif, première connexion)", "← CHANGER DE COMPTE"]) {
      expect(text).toContain(phrase);
    }
  });

  it("avertissement de contexte (app iOS, navigateur intégré) en anglais", () => {
    for (const environment of ["IOS_INSTALLED_APP", "IN_APP_BROWSER"] as const) {
      const notice = loginEnvironmentNotice(environment, EN_TEXT);
      const html = render(<OAuthButtons redirect="/en/regles" termsAccepted environmentNotice={notice} />, "en");
      expectNoFrench(visibleText(html));
      expect(html).toContain("/api/auth/google/start?redirect=%2Fen%2Fregles&amp;lang=en&amp;terms=1");
    }
  });

  it("départ OAuth français : aucune langue écrite, adresse de rappel inchangée", () => {
    expect(oauthStartPath("GOOGLE", { redirect: "/regles", locale: "fr" })).toBe("/api/auth/google/start?redirect=%2Fregles");
    expect(oauthStartPath("BLIZZARD", { locale: "en" })).toBe("/api/auth/blizzard/start?lang=en");
  });
});

describe("modale d'entrée (information RGPD, conditions)", () => {
  it("en anglais, documents liés annoncés en français (hreflang)", () => {
    const html = render(<RgpdConsentModal onAccept={() => undefined} onRefuse={() => undefined} />, "en");
    const text = visibleText(html);
    expect(text).toContain("Before you continue");
    expect(text).toContain(`I declare that I am at least ${SITE_MINIMUM_AGE} years old`);
    expect(html).toContain('hrefLang="fr"');
    expectNoFrench(text);
  });

  it("en français : la case reprend les phrases partagées, aucun hreflang", () => {
    const html = render(<RgpdConsentModal onAccept={() => undefined} onRefuse={() => undefined} />, "fr");
    const text = visibleText(html);
    expect(text).toContain(TERMS_CHECKBOX_LABEL);
    expect(text).toContain(TERMS_AGE_DECLARATION);
    expect(text).toContain("Avant de continuer");
    expect(text).toContain("seule la mesure d'audience du site a pu compter ta visite");
    expect(html).not.toContain("hrefLang");
  });
});

describe("exposé de suspension", () => {
  const notice: SuspensionNotice = { reference: "S-12", reason: "Cheating", ground: "BEHAVIOR", endsAt: "2026-10-15T08:00:00.000Z" };
  const renderDialog = (locale: Locale, value: SuspensionNotice = notice) => {
    flags.runEffects = true;
    return render(<SuspensionNoticeDialog notice={value} onClose={() => undefined} />, locale);
  };

  it("sous /en/connexion : anglais, motif saisi annoncé en français", () => {
    const html = renderDialog("en", { ...notice, reason: "Triche avérée" });
    const text = visibleText(html);
    expect(text).toContain("Account suspended");
    expect(text).toContain("This account is suspended until October 15, 2026 at 10:00 (Paris time) (decision S-12)");
    expect(text).toContain("“Behavior”");
    expect(html).toContain('lang="fr">Triche avérée<');
    expectNoFrench(text.replace("Triche avérée", ""));
  });

  it("durée indéterminée, chaque clause", () => {
    for (const ground of SUSPENSION_GROUNDS) {
      const text = visibleText(renderDialog("en", { ...notice, ground, endsAt: null }));
      expect(text).toContain("suspended indefinitely (decision S-12)");
      expect(text).toContain(`“${EN.suspension.clauses[ground]}”`);
      expectNoFrench(text);
    }
  });

  it("en français : le texte d'avant le lot 6", () => {
    const text = visibleText(renderDialog("fr"));
    expect(text).toContain(
      `Ce compte est suspendu ${suspensionSpan(notice.endsAt)} (décision S-12) : aucune connexion n'est possible tant que la suspension court.`,
    );
    expect(text).toContain(`« ${SUSPENSION_GROUND_DEFINITIONS.BEHAVIOR.clause} »`);
    expect(text).toContain(`${suspensionContestText("S-12")}. Tu peux ensuite porter la décision devant le juge compétent.`);
    expect(text).toContain("Fermer");
  });

  it("le français des messages égale les phrases partagées avec Discord et le journal", () => {
    expect(suspendedLoginText(FR_TEXT, null)).toBe(suspendedLoginMessage(null));
    expect(suspendedLoginText(FR_TEXT, notice.endsAt)).toBe(suspendedLoginMessage(notice.endsAt));
    expect(suspendedLoginText(FR_TEXT, "pas une date")).toBe(suspendedLoginMessage("pas une date"));
    expect(suspensionSpanText(FR_TEXT, null, "S-1")).toBe(
      `Ce compte est suspendu ${suspensionSpan(null)} (décision S-1) : aucune connexion n'est possible tant que la suspension court.`,
    );
    for (const ground of SUSPENSION_GROUNDS) expect(FR.suspension.clauses[ground]).toBe(SUSPENSION_GROUND_DEFINITIONS[ground].clause);
  });

  it("fin de suspension : heure de Paris dans les deux langues", () => {
    expect(suspensionEndText(EN_TEXT, "2026-01-05T20:30:00.000Z")).toBe("January 5, 2026 at 21:30 (Paris time)");
    expect(suspensionEndText(FR_TEXT, "2026-01-05T20:30:00.000Z")).toBe("5 janvier 2026 à 21:30 (heure de Paris)");
  });
});

describe("refus — codes traduits à l'affichage", () => {
  const LOGIN_CODES = Object.keys(FR.errors).filter((code) => code !== "fallback");

  it("chaque refus de la connexion par code a son anglais, aucun code ne sort tel quel", () => {
    for (const code of [...LOGIN_CODES, "ACCOUNT_SUSPENDED", "UNKNOWN_CODE", null]) {
      const en = loginErrorMessage(code, EN_TEXT);
      expectNoFrench(en);
      if (code) expect(en).not.toContain(code);
      expect(loginErrorMessage(code)).toBe(loginErrorMessage(code, FR_TEXT));
    }
    expect(loginErrorMessage("UNKNOWN_CODE", EN_TEXT)).toBe("An internal error occurred.");
  });

  it("chaque refus OAuth a son anglais, conseil de navigateur compris", () => {
    for (const kind of ["not_configured", "unavailable", "params", "state", "oauth", "session", "terms", "suspended"]) {
      for (const environment of ["BROWSER", "IOS_INSTALLED_APP", "IN_APP_BROWSER"] as const) {
        const en = oauthErrorMessage(kind, "discord", environment, EN_TEXT);
        expect(en).not.toBeNull();
        expectNoFrench(en ?? "");
      }
    }
    expect(oauthErrorMessage("params", "google", "IN_APP_BROWSER", EN_TEXT)).toBe(
      `Google login interrupted. Start the login again from this page. ${loginEnvironmentAdvice("IN_APP_BROWSER", EN_TEXT)}`,
    );
    expect(oauthErrorMessage("oauth", null, "BROWSER", EN_TEXT)).toBe("OAuth login failed. Try again in a moment.");
    expect(oauthErrorMessage("nope", "google", "BROWSER", EN_TEXT)).toBeNull();
  });

  it("le français reste celui d'avant le lot 6", () => {
    expect(oauthErrorMessage("not_configured", "blizzard")).toBe(
      "Connexion Blizzard indisponible : configuration manquante. Essaie un autre moyen de connexion.",
    );
    expect(oauthErrorMessage("suspended", "google")).toBe(suspendedLoginMessage(null));
    expect(loginErrorMessage("ACCOUNT_SUSPENDED")).toBe(suspendedLoginMessage(null));
  });
});

describe("messages `login`", () => {
  it("le français reprend les phrases partagées (tag Discord)", () => {
    expect(FR.oauth.tagAudience).toBe(DISCORD_TAG_AUDIENCE);
    expect(formatMessage("fr", FR.oauth.discordNote, { audience: FR.oauth.tagAudience })).toBe(DISCORD_LOGIN_TAG_NOTICE);
  });

  it("l'anglais suit le glossaire et la coquille", () => {
    const en = JSON.stringify(EN);
    expect(EN.suspension.appealText).toContain(`“${messagesFor("en").shell.footer.reportProblem}”`);
    expect(EN.page.title).toBe("Log in");
    // Même verbe que « Log out » du menu du compte.
    expect(messagesFor("en").shell.account.logout).toBe("Log out");
    expect(en).not.toMatch(/sign[ -]?in/i);
    expect(en).not.toMatch(/Please kindly/);
    expect(en).toContain("BlueGenji");
  });

  it.each(LOCALES.map((locale) => [locale]))("%s : même texte que next-intl, message par message", (locale) => {
    const tags = ["strong", "join", "terms", "policy"];
    for (const { key, source } of leaves(messagesFor(locale).login)) {
      const values = { audience: "A", provider: "P", time: "T", end: "E", reference: "S-1", day: "D", clause: "C", age: 15 };
      const reference = createTranslator({ locale, messages: { m: source }, timeZone: SITE_TIME_ZONE });
      const expected = reference.markup("m", {
        ...values,
        ...Object.fromEntries(tags.map((tag) => [tag, (chunks: string) => `<${tag}>${chunks}</${tag}>`])),
      });
      const actual = formatMessageParts<string>(
        locale,
        source,
        values,
        Object.fromEntries(tags.map((tag) => [tag, (children: Array<string>) => `<${tag}>${children.join("")}</${tag}>`])),
      ).join("");
      expect(`${key}: ${actual}`).toBe(`${key}: ${expected}`);
    }
  });
});
