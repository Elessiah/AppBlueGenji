import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { OAuthButtons } from "@/app/connexion/_components/OAuthButtons";
import { loginEnvironmentNotice } from "@/lib/shared/login-environment";

/**
 * Dans l'app iOS installée, la page d'erreur s'ouvre dans une feuille Safari
 * qui ne se sait plus installée : l'avertissement n'a qu'une chance d'être lu,
 * au-dessus des boutons, avant le départ.
 */

const NOTICE = loginEnvironmentNotice("IOS_INSTALLED_APP") ?? "";

function render(environmentNotice?: string | null): string {
  return renderToStaticMarkup(
    <OAuthButtons redirect="/tournois" termsAccepted environmentNotice={environmentNotice} />,
  );
}

describe("OAuthButtons — avertissement de contexte", () => {
  it("n'affiche rien dans un navigateur ordinaire", () => {
    const html = render(null);
    expect(html).not.toContain('role="note"');
    expect(html).not.toContain("oauth-environment-notice");
  });

  it("affiche l'avertissement en note, jamais en alerte : rien n'a encore échoué", () => {
    const html = render(NOTICE);
    expect(html).toContain('role="note"');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain("écran d&#x27;accueil");
  });

  it("le place avant le premier bouton, pour qu'il soit lu avant le clic", () => {
    const html = render(NOTICE);
    expect(html.indexOf("oauth-environment-notice")).toBeLessThan(html.indexOf("Continuer avec"));
  });

  it("le relie à chaque bouton, en plus de la note propre au fournisseur", () => {
    const html = render(NOTICE);
    const describedBy = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((match) => match[1]);
    expect(describedBy).toEqual([
      "oauth-environment-notice oauth-note-discord",
      "oauth-environment-notice",
      "oauth-environment-notice oauth-note-blizzard",
    ]);
  });

  it("garde les notes des fournisseurs seules sans avertissement", () => {
    const html = render(null);
    const describedBy = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((match) => match[1]);
    expect(describedBy).toEqual(["oauth-note-discord", "oauth-note-blizzard"]);
  });
});
