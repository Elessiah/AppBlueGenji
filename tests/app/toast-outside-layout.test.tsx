import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";

import { middleware } from "@/middleware";
import { EnsureToastProvider, ToastProvider, useToast } from "@/components/ui/toast";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";

jest.mock("next/navigation", () => ({ usePathname: () => "/" }));
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
});

describe("EnsureToastProvider et PublicPageShell hors mise en page racine", () => {
  it("useToast reste strict sans fournisseur", () => {
    const Bare = () => {
      useToast();
      return null;
    };
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderToStaticMarkup(<Bare />)).toThrow("useToast doit être utilisé dans ToastProvider");
    spy.mockRestore();
  });

  it("le gabarit des pages vitrine rend sans fournisseur racine", () => {
    const html = renderToStaticMarkup(
      <PublicPageShell>
        <h1>Introuvable</h1>
      </PublicPageShell>,
    );
    expect(html).toContain("<footer>pied</footer>");
    expect(html).toContain("<h1>Introuvable</h1>");
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
