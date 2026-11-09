import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";

import { middleware } from "@/middleware";
import { EnsureToastProvider, ToastProvider, useToast } from "@/components/ui/toast";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import NotFound from "@/app/not-found";

jest.mock("next/navigation", () => ({ usePathname: () => "/" }));
jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => "fr" }));
// Doublure du pied de page : comme le vrai (`FooterContact`), elle appelle `useToast()`.
jest.mock("@/components/cyber/landing/PublicHeader", () => ({ PublicHeader: () => <header>en-tête</header> }));
jest.mock("@/components/cyber/landing/PublicFooter", () => ({
  PublicFooter: function Footer() {
    useToast();
    return <footer>pied</footer>;
  },
}));

const SITE = "https://bluegenji.example";
const passedThrough = (r: Response) => r.headers.get("x-middleware-next") === "1";
const call = (path: string, method: string, headers: Record<string, string> = {}) =>
  middleware(new NextRequest(`${SITE}${path}`, { method, headers }));

describe("middleware — requêtes d'action inconnues", () => {
  it.each([["x"], [""], ["0123456789abcdef0123456789abcdef01234567"]])("POST avec Next-Action %p : 404 sans corps", (id) => {
    for (const path of ["/", "/en", "/tournois", "/en/regles", "/api/tournaments/1/register"]) {
      const response = call(path, "POST", { "next-action": id });
      expect(response.status).toBe(404);
      expect(passedThrough(response)).toBe(false);
    }
  });

  it("laisse passer un GET portant l'en-tête et un POST sans lui", () => {
    expect(passedThrough(call("/", "GET", { "next-action": "x" }))).toBe(true);
    expect(passedThrough(call("/", "POST"))).toBe(true);
  });

  it("garde le 403 de provenance des écritures /api/ réelles", () => {
    const response = call("/api/tournaments/1/register", "POST", {
      "sec-fetch-site": "same-site",
      origin: "https://voisin.bluegenji.example",
    });
    expect(response.status).toBe(403);
  });

  it("refuse en 404, sans la laisser passer, une écriture /api/ inter-sites portant Next-Action", () => {
    const response = call("/api/tournaments/1/register", "POST", {
      "next-action": "x",
      "sec-fetch-site": "cross-site",
      origin: "https://evil.example",
    });
    expect(response.status).toBe(404);
    expect(passedThrough(response)).toBe(false);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });
});

describe("EnsureToastProvider et page d'introuvable hors mise en page racine", () => {
  it("useToast reste strict sans fournisseur", () => {
    const Bare = () => {
      useToast();
      return null;
    };
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderToStaticMarkup(<Bare />)).toThrow("useToast doit être utilisé dans ToastProvider");
    spy.mockRestore();
  });

  it("la page d'introuvable rend sans fournisseur racine", async () => {
    const html = renderToStaticMarkup(await NotFound());
    expect(html).toContain("<footer>pied</footer>");
    expect(html).toContain("Page introuvable");
  });

  it("la page d'introuvable sous le fournisseur racine n'ajoute pas de seconde zone d'annonce", async () => {
    const html = renderToStaticMarkup(<ToastProvider>{await NotFound()}</ToastProvider>);
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });

  it("le gabarit partagé ne masque pas l'absence du fournisseur racine", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() =>
      renderToStaticMarkup(
        <PublicPageShell>
          <h1>Contenu</h1>
        </PublicPageShell>,
      ),
    ).toThrow("useToast doit être utilisé dans ToastProvider");
    spy.mockRestore();
  });

  it("n'ajoute pas de second fournisseur sous celui de la page", () => {
    const Probe = () => <>{String(Boolean(useToast()))}</>;
    const nested = renderToStaticMarkup(
      <ToastProvider>
        <EnsureToastProvider>
          <Probe />
        </EnsureToastProvider>
      </ToastProvider>,
    );
    const alone = renderToStaticMarkup(
      <ToastProvider>
        <Probe />
      </ToastProvider>,
    );
    expect(nested).toBe(alone);
  });
});
