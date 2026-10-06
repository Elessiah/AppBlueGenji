/**
 * Rendu des cartes de page et du podium (`components/og/`,
 * `docs/features/SHARE_METADATA.md` § « Une carte par page ») : motifs,
 * colonne de texte, marches du podium et leur contraste.
 *
 * Comme `share-card.test.tsx`, l'arbre React est rendu en HTML (Satori charge
 * un module WebAssembly que Jest n'exécute pas) ; le PNG lui-même est vérifié
 * au rendu sur `next dev`.
 */
import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { PODIUM_CARD_FILL_ALPHA, PODIUM_PLACE_COLORS, PodiumShareCard } from "@/components/og/podium-share-card";
import { SHARE_CARD_COLORS, SHARE_CARD_MOTIF_BOX, SHARE_CARD_MOTIF_TEXT_WIDTH, SHARE_CARD_PADDING, ShareCard } from "@/components/og/share-card";
import { SHARE_ACCENT_COLORS, ShareMotifIcon, motifShape } from "@/components/og/share-motifs";
import { contrastRatio } from "@/lib/shared/color-contrast";
import { PAGE_SHARE_CARD_STYLES, podiumShareEntries, type ShareMotif } from "@/lib/shared/page-share-cards";
import frShare from "@/messages/fr/share.json";

const MOTIFS = [
  ...new Set(Object.values(PAGE_SHARE_CARD_STYLES).flatMap((style) => (style.motif ? [style.motif] : []))),
  "bracket",
] as ShareMotif[];

function mix(base: string, top: string, alpha: number): string {
  const channel = (hex: string, index: number) => Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  return `#${[0, 1, 2]
    .map((index) => Math.round(channel(base, index) * (1 - alpha) + channel(top, index) * alpha).toString(16).padStart(2, "0"))
    .join("")}`;
}

describe("motifs", () => {
  it.each(MOTIFS)("le motif %s rend un tracé non vide (forme interne de Lucide)", (motif) => {
    const shape = motifShape(motif);
    expect(shape.length).toBeGreaterThan(0);
    for (const [tag] of shape) expect(["path", "circle", "rect", "line", "polyline", "polygon", "ellipse"]).toContain(tag);
  });

  it("écrit un <svg> simple, sans composant Lucide, au trait de la teinte", () => {
    const html = renderToStaticMarkup(<ShareMotifIcon motif="trophy" color={SHARE_ACCENT_COLORS.blue} />);
    expect(html).toMatch(/^<svg[^>]*stroke="#8fd5ff"/);
    expect(html).toContain("<path");
    expect(html).not.toContain("lucide");
  });

  it("n'emploie que des néons froids — ni ambre ni rouge", () => {
    const palette: string[] = Object.values(SHARE_CARD_COLORS);
    expect(Object.values(SHARE_ACCENT_COLORS).every((color) => palette.includes(color))).toBe(true);
  });
});

describe("carte d'une page", () => {
  it("réserve la colonne du motif : le texte s'arrête avant lui", () => {
    expect(SHARE_CARD_PADDING.left + SHARE_CARD_MOTIF_TEXT_WIDTH).toBeLessThan(SHARE_CARD_MOTIF_BOX.left);
    const html = renderToStaticMarkup(
      <ShareCard eyebrow="Règlement" title="Règles" subtitle="Accroche" motif={<ShareMotifIcon motif="book" color="#c4b5fd" />} />,
    );
    expect(html).toContain(`max-width:${SHARE_CARD_MOTIF_TEXT_WIDTH}px`);
    expect(html).toContain("<svg");
  });

  it("sans motif, aucune largeur bornée n'est écrite (Satori échoue sur une valeur absente)", () => {
    const html = renderToStaticMarkup(<ShareCard eyebrow="Overwatch" title="BlueGenji Esport" subtitle="Accroche" />);
    expect(html).not.toContain("max-width");
  });

  it("colore la pastille de la teinte de la carte et écrit la mention de pied dans la langue", () => {
    const html = renderToStaticMarkup(
      <ShareCard eyebrow="Recruitment" accent={SHARE_ACCENT_COLORS.teal} title="Join" footer="Nonprofit association" />,
    );
    expect(html).toContain(`color:${SHARE_ACCENT_COLORS.teal}`);
    expect(html).toContain("Nonprofit association");
    expect(html).not.toContain("loi 1901");
  });

  it("accorde deux lignes d'accroche à une carte sans faits", () => {
    const html = renderToStaticMarkup(<ShareCard eyebrow="X" title={"Titre long ".repeat(4)} subtitle="Accroche" />);
    expect(html).toContain("-webkit-line-clamp:2;text-overflow:ellipsis");
  });
});

describe("carte du podium", () => {
  const entries = podiumShareEntries(
    [
      { teamName: "Alpha", points: 1240, logoSrc: "data:image/png;base64,AAAA" },
      { teamName: "Bravo", points: 1180, logoSrc: null },
      { teamName: "Charlie", points: 1100, logoSrc: null },
    ],
    frShare,
  )!;

  it("dessine les trois marches dans l'ordre 2-1-3, avec nom, cote et marche", () => {
    const html = renderToStaticMarkup(
      <PodiumShareCard eyebrow="Classement" title="Le podium BlueGenji" footer="Association loi 1901" entries={entries} />,
    );
    const order = ["Bravo", "Alpha", "Charlie"].map((name) => html.indexOf(name));
    expect(order.every((position) => position > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain("1240 pts");
    expect(html).toContain("1re");
    expect(html).toContain("2e");
    expect(html).toContain("3e");
  });

  it("pose le logo de l'équipe, l'initiale à défaut", () => {
    const html = renderToStaticMarkup(
      <PodiumShareCard eyebrow="Classement" title="Podium" footer="Association loi 1901" entries={entries} />,
    );
    expect(html).toMatch(/<img[^>]*src="data:image\/png;base64,AAAA"[^>]*alt=""/);
    expect(html).toContain(">B</div>");
    expect(html).toContain(">C</div>");
  });

  it("garde les néons froids de la page : glacier, cyan, violet — ni or ni bronze", () => {
    expect(PODIUM_PLACE_COLORS).toEqual({ 1: SHARE_CARD_COLORS.blue, 2: SHARE_CARD_COLORS.cyan, 3: SHARE_CARD_COLORS.violetSoft });
  });

  it.each([1, 2, 3] as const)("la marche %s tient 4,5:1 pour son nom et son rang", (place) => {
    const color = PODIUM_PLACE_COLORS[place];
    const background = mix(SHARE_CARD_COLORS.background, color, PODIUM_CARD_FILL_ALPHA);
    expect(contrastRatio(SHARE_CARD_COLORS.ink, background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color, background)).toBeGreaterThanOrEqual(4.5);
  });
});
