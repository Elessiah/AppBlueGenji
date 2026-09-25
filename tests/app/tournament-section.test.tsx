import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { Section } from "@/app/(secured)/tournois/Section";

/**
 * En-tête de section de `/tournois` : un `<h2>` n'est pas du contenu phrasé,
 * il ne pouvait donc pas vivre à l'intérieur du `<button>` qui bascule
 * l'ouverture — c'est le bouton qui va dans le titre, jamais l'inverse. Le
 * bouton porte aussi `aria-controls`, absent jusque-là.
 */
describe("Section — en-tête accessible", () => {
  it("pose le bouton dans un <h2>, jamais l'inverse", () => {
    const markup = renderToStaticMarkup(
      <Section ix="01" title="EN COURS" count={2} emptyMsg="Vide">
        <div>contenu</div>
      </Section>,
    );
    expect(markup).toMatch(/<h2[^>]*><button[^>]*>/);
    // Aucun titre ne réapparaît hors du <h2> : un seul niveau de titre par section.
    expect((markup.match(/<h2/g) ?? []).length).toBe(1);
  });

  it("le bouton porte aria-expanded et aria-controls, qui désigne le corps affiché", () => {
    const markup = renderToStaticMarkup(
      <Section ix="01" title="EN COURS" count={2} defaultOpen={true} emptyMsg="Vide">
        <div>contenu</div>
      </Section>,
    );
    const controlsId = markup.match(/aria-controls="([^"]+)"/)?.[1];
    expect(controlsId).toBeTruthy();
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain(`id="${controlsId}"`);
  });

  it("replié par défaut : aria-expanded le dit, le corps ne rend rien", () => {
    const markup = renderToStaticMarkup(
      <Section ix="04" title="TERMINÉS" count={3} defaultOpen={false} emptyMsg="Vide">
        <div>contenu qui ne doit pas apparaître replié</div>
      </Section>,
    );
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("contenu qui ne doit pas apparaître replié");
  });

  it("section vide : titre « Vide » et message dédié, sous le même id référencé", () => {
    const markup = renderToStaticMarkup(
      <Section ix="02" title="INSCRIPTIONS" count={0} defaultOpen={true} emptyMsg="Rien à inscrire ici.">
        <div>jamais rendu à zéro</div>
      </Section>,
    );
    const controlsId = markup.match(/aria-controls="([^"]+)"/)?.[1];
    expect(markup).toContain(`id="${controlsId}"`);
    expect(markup).toContain("Rien à inscrire ici.");
    expect(markup).not.toContain("jamais rendu à zéro");
  });
});
