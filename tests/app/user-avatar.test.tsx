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

  // L'initiale double le pseudo déjà écrit à côté sur les quatre écrans.
  it("masque l'initiale aux lecteurs d'écran", () => {
    const html = renderToStaticMarkup(<UserAvatar src={null} pseudo="Nova" size={30} />);
    expect(html).toContain('aria-hidden="true"');
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
