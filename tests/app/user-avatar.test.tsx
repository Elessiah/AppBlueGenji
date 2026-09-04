import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { UserAvatar } from "@/components/user-avatar";

/**
 * Le repli d'avatar était un **fichier absent** : `/vercel.svg`, reste du
 * gabarit Next.js supprimé de `public/`. La panne était muette de bout en bout
 * — le `src` restait syntaxiquement valide, seul le navigateur voyait le 404.
 *
 * D'où deux gardes complémentaires, comme pour le logo d'équipe :
 *
 * 1. le composant **n'invente aucune source** quand le compte n'a pas d'avatar ;
 * 2. plus aucun écran ne référence un fichier de repli.
 */
describe("UserAvatar", () => {
  it("affiche l'avatar quand le compte en a un", () => {
    const html = renderToStaticMarkup(
      <UserAvatar src="/api/uploads/avatars/x.webp" pseudo="Nova" size={60} />,
    );
    expect(html).toContain("/api/uploads/avatars/x.webp");
    expect(html).toContain('alt="Nova"');
  });

  it("retombe sur l'initiale, sans aucune balise <img>", () => {
    const html = renderToStaticMarkup(<UserAvatar src={null} pseudo="Nova" size={60} />);
    expect(html).not.toContain("<img");
    expect(html).toContain(">N<");
  });

  it("traite une chaîne vide comme une absence d'avatar", () => {
    const html = renderToStaticMarkup(<UserAvatar src="" pseudo="Nova" size={30} />);
    expect(html).not.toContain("<img");
  });

  // Les deux rendus doivent exposer le **même** nom accessible : une pastille
  // annoncée d'un côté et muette de l'autre ferait changer de nom le contrôle
  // qui la contient, selon qu'un avatar a été téléversé.
  it("nomme le repli comme il nomme l'image", () => {
    const withImage = renderToStaticMarkup(<UserAvatar src="/a.webp" pseudo="Nova" size={30} />);
    const fallback = renderToStaticMarkup(<UserAvatar src={null} pseudo="Nova" size={30} />);
    expect(withImage).toContain('alt="Nova"');
    expect(fallback).toContain('aria-label="Nova"');
    expect(fallback).toContain('role="img"');
  });

  it("masque les deux rendus quand l'avatar est décoratif", () => {
    const withImage = renderToStaticMarkup(
      <UserAvatar src="/a.webp" pseudo="Nova" size={30} decorative />,
    );
    const fallback = renderToStaticMarkup(
      <UserAvatar src={null} pseudo="Nova" size={30} decorative />,
    );
    // Une image décorative porte un `alt` vide, pas un `alt` absent.
    expect(withImage).toContain('alt=""');
    expect(withImage).not.toContain('alt="Nova"');
    expect(fallback).toContain('aria-hidden="true"');
    expect(fallback).not.toContain('aria-label');
  });

  it("le halo n'est demandé que s'il y a une image à faire flotter", () => {
    const html = renderToStaticMarkup(<UserAvatar src={null} pseudo="Nova" size={64} glow />);
    expect(html).not.toContain("<img");
  });
});

describe("écrans qui affichent un avatar", () => {
  const screens = [
    "app/(secured)/joueurs/[id]/page.tsx",
    "app/(secured)/profil/page.tsx",
    "components/arena-nav.tsx",
    "components/cyber/landing/PublicHeader.tsx",
  ];

  it.each(screens)("%s ne référence aucun fichier de repli", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    expect(source).not.toContain("vercel.svg");
    expect(source).toContain("UserAvatar");
  });
});
