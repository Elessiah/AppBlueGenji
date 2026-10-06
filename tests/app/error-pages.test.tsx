import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import ErrorBoundary from "@/app/error";
import { ErrorPanel } from "@/components/error-page/ErrorPanel";
import { ShellTextProvider } from "@/components/i18n/shell-text";
import { messagesFor } from "@/lib/server/i18n-messages";
import {
  NOT_FOUND_LINKS,
  errorPageTitle,
  errorReference,
  notFoundCopy,
  runtimeErrorCopy,
} from "@/lib/shared/error-pages";
import { shellText } from "@/lib/shared/shell-text";
import { readSource } from "../helpers/read-source";

const NOT_FOUND_COPY = notFoundCopy();
const RUNTIME_ERROR_COPY = runtimeErrorCopy(null);
const RETRY_LABEL = "Réessayer";
const english = shellText("en", messagesFor("en").shell).t;

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn(), prefetch: jest.fn() }),
}));

describe("runtimeErrorCopy", () => {
  it("ne renvoie à une référence que s'il y en a une", () => {
    expect(runtimeErrorCopy(null).message).not.toContain("référence");
    expect(runtimeErrorCopy("abc").message).toContain("la référence ci-dessous");
    expect(runtimeErrorCopy("abc").title).toBe(RUNTIME_ERROR_COPY.title);
  });

  it("se rédige en anglais avec les textes anglais", () => {
    expect(runtimeErrorCopy(null, english)).toEqual({
      eyebrow: "ERROR",
      title: "Something went wrong",
      message: "The page couldn't be displayed. Try again in a moment; if the problem persists, report it.",
    });
    expect(runtimeErrorCopy("abc", english).message).toContain("the reference below");
    expect(notFoundCopy(english).title).toBe("Page not found");
    expect(errorPageTitle(notFoundCopy(english), english)).toBe("Page not found · BlueGenji Esport");
  });
});

describe("errorReference", () => {
  it("rend l'empreinte de Next telle quelle", () => {
    expect(errorReference("1234567890")).toBe("1234567890");
    expect(errorReference("  abc_DEF-9  ")).toBe("abc_DEF-9");
  });

  it("rend null sans empreinte exploitable", () => {
    expect(errorReference(undefined)).toBeNull();
    expect(errorReference(null)).toBeNull();
    expect(errorReference("")).toBeNull();
    expect(errorReference("   ")).toBeNull();
    expect(errorReference("<script>")).toBeNull();
    expect(errorReference("a".repeat(65))).toBeNull();
  });
});

describe("textes des pages d'erreur", () => {
  it("sont en français, jamais les textes par défaut de Next", () => {
    for (const copy of [NOT_FOUND_COPY, RUNTIME_ERROR_COPY]) {
      expect(`${copy.title} ${copy.message}`).not.toMatch(/could not be found|Application error/i);
    }
    expect(NOT_FOUND_COPY.title).toBe("Page introuvable");
  });

  it("proposent d'abord l'accueil, et seulement des chemins du site", () => {
    expect(NOT_FOUND_LINKS[0]).toEqual({ href: "/", labelKey: "errorPages.links.home" });
    expect(NOT_FOUND_LINKS.map((link) => shellText("fr").t(link.labelKey))).toEqual([
      "Retour à l'accueil",
      "Voir les tournois",
      "Lire les règles",
    ]);
    for (const link of NOT_FOUND_LINKS) expect(link.href).toMatch(/^\/(?!\/)/);
  });

  it("titrent l'onglet au gabarit du site", () => {
    expect(errorPageTitle(RUNTIME_ERROR_COPY)).toBe("Un problème est survenu · BlueGenji Esport");
  });
});

describe("ErrorPanel", () => {
  it("nomme sa section par son titre de niveau 1 et rend les actions", () => {
    const html = renderToStaticMarkup(
      <ErrorPanel copy={NOT_FOUND_COPY} referenceLabel="Référence :">
        <button type="button">Accueil</button>
      </ErrorPanel>,
    );
    expect(html).toContain('aria-labelledby="error-page-title"');
    expect(html).toContain('<h1 id="error-page-title"');
    expect(html).toContain("Page introuvable");
    expect(html).toContain('<button type="button">Accueil</button>');
    expect(html).not.toContain("Référence");
  });

  it("affiche la référence quand il y en a une", () => {
    const html = renderToStaticMarkup(
      <ErrorPanel copy={RUNTIME_ERROR_COPY} reference="42abc" referenceLabel="Référence :">
        <span />
      </ErrorPanel>,
    );
    expect(html).toContain('Référence : <span class="mono">42abc</span>');
  });
});

describe("app/error.tsx", () => {
  const render = (digest?: string) =>
    renderToStaticMarkup(
      <ErrorBoundary error={Object.assign(new Error("boom"), { digest })} reset={jest.fn()} />,
    );

  it("rend le contenu dans <main>, en français, avec « Réessayer » et le retour", () => {
    const html = render("d1g3st");
    expect(html).toMatch(/^<main/);
    expect(html).toContain(RETRY_LABEL);
    expect(html).toContain('href="/"');
    expect(html).toContain("d1g3st");
    expect(html).toContain(`<title>${errorPageTitle(RUNTIME_ERROR_COPY)}</title>`);
    // Le message brut d'une erreur ne s'affiche jamais.
    expect(html).not.toContain("boom");
  });

  it("se rend en anglais sous le fournisseur anglais de la coquille", () => {
    const html = renderToStaticMarkup(
      <ShellTextProvider locale="en" messages={messagesFor("en").shell}>
        <ErrorBoundary error={Object.assign(new Error("boom"), { digest: "d1g3st" })} reset={jest.fn()} />
      </ShellTextProvider>,
    );
    expect(html).toContain("<title>Something went wrong · BlueGenji Esport</title>");
    expect(html).toContain("Try again");
    expect(html).toContain("Back to home");
    expect(html).toContain('Reference: <span class="mono">d1g3st</span>');
    expect(html).not.toMatch(/Réessayer|Référence/);
  });

  it("n'annonce aucune référence sans empreinte", () => {
    const html = render();
    expect(html).not.toContain("Référence");
    expect(html).not.toContain("référence ci-dessous");
  });

  it("« Réessayer » redemande la page au serveur avant de relancer le rendu", () => {
    const source = readSource("app/error.tsx");
    expect(source).toMatch(/startTransition\(\(\) => \{\s*router\.refresh\(\);\s*reset\(\);/);
  });
});

describe("app/not-found.tsx et app/global-error.tsx", () => {
  it("la 404 passe par le gabarit de la vitrine et n'est pas indexée", () => {
    const source = readSource("app/not-found.tsx");
    expect(source).toContain("<PublicPageShell>");
    expect(source).toContain("NOT_FOUND_LINKS");
    expect(source).toMatch(/robots:\s*\{\s*index:\s*false/);
    // Même segment que la mise en page racine : son gabarit ne s'y applique
    // pas, le titre complet est donc posé en `absolute`.
    expect(source).toContain("title: { absolute: errorPageTitle(notFoundCopy(t), t) }");
  });

  it("le dernier filet rend un document complet dans la langue de l'adresse", () => {
    const source = readSource("app/global-error.tsx");
    expect(source).toContain("<html lang={locale}>");
    expect(source).toContain("splitLocalePrefix(usePathname()");
    expect(source).toContain("<body");
    // `reset()` rejouerait la réponse fautive : on recharge.
    expect(source).toContain("window.location.reload()");
  });
});
