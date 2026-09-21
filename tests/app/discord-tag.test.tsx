import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { DiscordTag, VerifiedBadge } from "@/components/discord-tag";

/**
 * Le tag Discord et sa pastille, à l'écran.
 *
 * **La pastille ne suit pas le tag.** Ce sont deux faits distincts
 * (`lib/shared/discord-identity.ts`) : le tag dit *comment* joindre le joueur et
 * se fait filtrer, la certification dit seulement *qu'il est joignable* et
 * s'affiche donc aussi à côté d'un « Masqué ». Le composant l'avait d'abord
 * ignoré — son repli sortait avant la pastille —, si bien que la fiche d'un
 * joueur certifié dont le tag était filtré n'annonçait rien du tout, et qu'un
 * capitaine restait sans moyen de voir qui de son roster devait certifier.
 *
 * C'est exactement ce que ces cas gardent.
 */

const render = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("DiscordTag", () => {
  it("rend le tag et sa pastille quand il est visible et certifié", () => {
    const html = render(<DiscordTag tag="keryan" verified />);

    expect(html).toContain("keryan");
    expect(html).toContain("badge-certifie");
  });

  it("rend le tag seul quand il n'est pas certifié", () => {
    const html = render(<DiscordTag tag="keryan" />);

    expect(html).toContain("keryan");
    expect(html).not.toContain("badge-certifie");
  });

  it("garde la pastille sur un tag masqué : « Masqué ✅ »", () => {
    // Le cas qui portait le défaut. L'état se lit, la coordonnée reste secrète.
    const html = render(<DiscordTag tag={null} verified fallback="Masqué" />);

    expect(html).toContain("Masqué");
    expect(html).toContain("badge-certifie");
  });

  it("n'invente pas de pastille sur un repli non certifié", () => {
    const html = render(<DiscordTag tag={null} fallback="Masqué" />);

    expect(html).toContain("Masqué");
    expect(html).not.toContain("badge-certifie");
  });

  it("n'affiche jamais le tag à la place du repli", () => {
    // Le repli couvre deux cas indiscernables — tag filtré, tag absent —, et
    // c'est ce qui le rend sûr : l'affichage ne dit rien de plus qu'il ne montre.
    for (const tag of [null, undefined, ""]) {
      expect(render(<DiscordTag tag={tag} fallback="Masqué" />)).toContain("Masqué");
    }
  });

  it("retombe sur un tiret quand l'appelant ne dit rien du repli", () => {
    expect(render(<DiscordTag tag={null} />)).toContain("—");
  });
});

describe("VerifiedBadge", () => {
  it("porte un nom accessible : « vérifié » n'existe nulle part ailleurs sur la ligne", () => {
    const html = render(<VerifiedBadge />);

    // `alt` non vide : la pastille n'est pas décorative, elle porte seule
    // l'information — un `alt=""` la rendrait muette au lecteur d'écran.
    expect(html).toMatch(/alt="[^"]*rifi[^"]*"/);
    expect(html).toMatch(/title="[^"]+"/);
  });

  it("passe par l'optimiseur d'images, comme toute image du dépôt", () => {
    // Une image de 360 px servie telle quelle pour en afficher 16 enverrait
    // 6 ko au visiteur ; `next/image` la redimensionne et la convertit.
    expect(render(<VerifiedBadge />)).toContain("/_next/image");
  });
});
