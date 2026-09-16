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
    expect(html).toContain(encodeURIComponent("/api/uploads/avatars/x.webp"));
    expect(html).toContain('alt="Nova"');
  });

  /**
   * L'avatar passait en `unoptimized`, drapeau posé pour qu'une URL Google ne
   * fasse pas lever `next/image` faute de `remotePatterns` — donc en
   * contournant aussi tout ce que cette vérification protège. La source étant
   * désormais toujours un fichier du site, le drapeau est parti, et ce test
   * garde la porte : c'est l'optimiseur qui doit servir l'image, avec ses
   * variantes de taille.
   */
  it("passe par l'optimiseur d'images, et non par la source brute", () => {
    const html = renderToStaticMarkup(
      <UserAvatar src="/api/uploads/avatars/x.webp" pseudo="Nova" size={60} />,
    );
    expect(html).toContain("/_next/image?url=");
    expect(html).toContain("srcSet=");
    expect(html).not.toContain('src="/api/uploads/avatars/x.webp"');
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

/**
 * **Le drapeau qui cachait la fuite.**
 *
 * `unoptimized` a été posé sur chaque avatar parce qu'un compte Google en
 * portait une URL distante : `next/image` lève au rendu sur une origine absente
 * de `remotePatterns`, et le drapeau contournait la vérification — donc aussi
 * tout ce qu'elle protège. Le site rendait ainsi des images de
 * `lh3.googleusercontent.com` alors qu'aucune origine n'était déclarée, ce que
 * seul le mode rapport de la CSP a fini par montrer.
 *
 * La source étant désormais toujours un fichier du site, le drapeau doit rester
 * parti. Ce test le garde pour les **sept** rendus d'avatar — les quatre qui
 * passent par `UserAvatar` et les trois qui appellent `<Image>` directement, que
 * la première passe de correction avait manqués.
 */
describe("aucun avatar ne contourne la vérification d'origine", () => {
  // Les trois écrans qui appellent `<Image>` directement, sans passer par
  // `UserAvatar` — ceux que la première passe de correction avait manqués.
  const directRenders = [
    "app/(secured)/equipes/cards/TeamCard.tsx",
    "app/(secured)/equipes/[id]/_components/MembersSection.tsx",
    "app/(secured)/joueurs/cards/PlayerCard.tsx",
  ];

  it.each(directRenders)("%s : aucun <Image> d'avatar en `unoptimized`", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");

    // On ne regarde que les balises dont la source **est** un avatar : la carte
    // d'équipe rend aussi un logo, dont l'origine est tenue par un autre chemin
    // (`localUploadUrl`, posé à l'émission) et gardée par son propre test. La
    // visée étroite de ce test-ci est délibérée : ce qu'il surveille, c'est que
    // **l'avatar** ne reprenne pas le drapeau, pas l'absence du mot dans le
    // fichier — un jour où la carte rendrait une image légitimement non
    // optimisée, un test écrit sur le fichier entier s'éteindrait en silence.
    const avatarTags = [...source.matchAll(/src=\{[^}]*avatarUrl\}([\s\S]{0,400}?)\/>/g)];
    expect(avatarTags.length).toBeGreaterThan(0);
    for (const [, attributes] of avatarTags) {
      expect(attributes).not.toContain("unoptimized");
    }
  });

  /**
   * La seconde porte, et celle qui aurait fait le plus de dégâts : le compte
   * voit **son** avatar sans passer par la visibilité, donc sans passer par
   * `visibleAvatarUrl`. Sans la même règle d'origine ici, une URL Google restée
   * en base ne fuirait plus — elle **casserait** la barre de navigation et
   * l'en-tête public, c'est-à-dire toutes les pages de ce compte.
   */
  it("le compte de session ne sort jamais avec un avatar d'une autre origine", () => {
    const source = readFileSync(join(process.cwd(), "lib/server/auth.ts"), "utf8");
    expect(source).toContain("avatarUrl: localAvatarUrl(row.avatar_url)");
  });
});
