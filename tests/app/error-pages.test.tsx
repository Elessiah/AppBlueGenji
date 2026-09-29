import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import ErrorBoundary from "@/app/error";
import { ErrorPanel } from "@/components/error-page/ErrorPanel";
import {
  NOT_FOUND_COPY,
  NOT_FOUND_LINKS,
  RETRY_LABEL,
  RUNTIME_ERROR_COPY,
  errorPageTitle,
  errorReference,
} from "@/lib/shared/error-pages";
import { readSource } from "../helpers/read-source";

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
    expect(NOT_FOUND_LINKS[0]).toEqual({ href: "/", label: "Retour à l'accueil" });
    for (const link of NOT_FOUND_LINKS) expect(link.href).toMatch(/^\/(?!\/)/);
  });

  it("titrent l'onglet au gabarit du site", () => {
    expect(errorPageTitle(RUNTIME_ERROR_COPY)).toBe("Un problème est survenu · BlueGenji Esport");
  });
});

describe("ErrorPanel", () => {
  it("nomme sa section par son titre de niveau 1 et rend les actions", () => {
    const html = renderToStaticMarkup(
      <ErrorPanel copy={NOT_FOUND_COPY}>
        <a href="/">Accueil</a>
      </ErrorPanel>,
    );
    expect(html).toContain('aria-labelledby="error-page-title"');
    expect(html).toContain('<h1 id="error-page-title"');
    expect(html).toContain("Page introuvable");
    expect(html).toContain('<a href="/">Accueil</a>');
    expect(html).not.toContain("Référence");
  });

  it("affiche la référence quand il y en a une", () => {
    const html = renderToStaticMarkup(
      <ErrorPanel copy={RUNTIME_ERROR_COPY} reference="42abc">
        <span />
      </ErrorPanel>,
    );
    expect(html).toContain("Référence");
    expect(html).toContain("42abc");
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

  it("n'annonce aucune référence sans empreinte", () => {
    expect(render()).not.toContain("Référence");
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
    expect(source).toContain("title: { absolute: errorPageTitle(NOT_FOUND_COPY) }");
  });

  it("le dernier filet rend un document complet en français", () => {
    const source = readSource("app/global-error.tsx");
    expect(source).toContain('<html lang="fr">');
    expect(source).toContain("<body");
    expect(source).toContain("onClick={reset}");
  });
});
