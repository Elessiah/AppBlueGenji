import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { EmphasisText } from "@/components/rules/EmphasisText";

/**
 * Le registre des règles est rédigé avec le gras Markdown, mais `/regles`
 * rendait ses paragraphes en texte brut : les astérisques s'affichaient telles
 * quelles au visiteur.
 *
 * Deux gardes, comme pour tout rendu qui pouvait échouer en silence :
 *
 * 1. le composant **monte** l'emphase en éléments React, jamais en HTML injecté ;
 * 2. les deux pages qui affichent des règles passent bien par lui — sans quoi
 *    la panne reviendrait sans qu'un test du module pur s'en aperçoive.
 */

describe("EmphasisText", () => {
  it("monte le gras en <strong>", () => {
    const html = renderToStaticMarkup(
      <EmphasisText text="La finale se joue en **un seul match** ici." />,
    );
    expect(html).toBe("La finale se joue en <strong>un seul match</strong> ici.");
  });

  it("ne laisse aucune astérisque visible", () => {
    const html = renderToStaticMarkup(<EmphasisText text="**Nombre fixe** (ex. 64 équipes)" />);
    expect(html).not.toContain("**");
  });

  it("rend tel quel un texte sans marque", () => {
    const html = renderToStaticMarkup(<EmphasisText text="Trois manches à gagner." />);
    expect(html).toBe("Trois manches à gagner.");
  });

  // Le registre est du contenu de confiance, mais il n'y a aucune raison de lui
  // ouvrir `dangerouslySetInnerHTML` pour du gras.
  it("échappe le balisage plutôt que de l'interpréter", () => {
    const html = renderToStaticMarkup(<EmphasisText text="<script>alert(1)</script>" />);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("pages de règles", () => {
  const pages = ["app/regles/page.tsx", "app/regles/[slug]/page.tsx"];

  it.each(pages)("%s rend l'emphase de ses règles", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    expect(source).toContain("EmphasisText");
    // Plus aucun paragraphe ni point de liste rendu en texte brut.
    expect(source).not.toMatch(/>\s*\{paragraph\}\s*</);
    expect(source).not.toMatch(/>\s*\{bullet\}\s*</);
  });
});
