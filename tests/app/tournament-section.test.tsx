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
      <Section ix="01" title="EN COURS" count={2}>
        <div>contenu</div>
      </Section>,
    );
    expect(markup).toMatch(/<h2[^>]*><button[^>]*>/);
    // Aucun titre ne réapparaît hors du <h2> : un seul niveau de titre par section.
    expect((markup.match(/<h2/g) ?? []).length).toBe(1);
  });

  it("le nom accessible du titre se limite au titre, sans l'index ni le compte", () => {
    const markup = renderToStaticMarkup(
      <Section ix="01" title="EN COURS" count={46}>
        <div>contenu</div>
      </Section>,
    );
    // Le <h2> englobe le bouton entier (index, compte, chevron) : sans
    // aria-label, son nom accessible collerait « 01EN COURS46 ».
    const h2 = markup.match(/<h2[^>]*>/)?.[0] ?? "";
    expect(h2).toMatch(/aria-label="EN COURS"/);
  });

  it("l'accent (« · STAFF ») reste dans le nom accessible, pas seulement le titre", () => {
    const markup = renderToStaticMarkup(
      <Section ix="01" title="TOURNOIS INVISIBLES" accent="· STAFF" count={4}>
        <div>contenu</div>
      </Section>,
    );
    // Visible dans le bouton (span dédié) ET dans le nom accessible du titre :
    // sans lui, un parcours par titres ferait disparaître la mention « staff »
    // qui distingue cette section des autres.
    const h2 = markup.match(/<h2[^>]*>/)?.[0] ?? "";
    expect(h2).toMatch(/aria-label="TOURNOIS INVISIBLES · STAFF"/);
  });

  it("le bouton porte aria-expanded et aria-controls, qui désigne le corps affiché", () => {
    const markup = renderToStaticMarkup(
      <Section ix="01" title="EN COURS" count={2} defaultOpen={true}>
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
      <Section ix="04" title="TERMINÉS" count={3} defaultOpen={false}>
        <div>contenu qui ne doit pas apparaître replié</div>
      </Section>,
    );
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("contenu qui ne doit pas apparaître replié");
  });

  it("replié : aria-controls ne désigne plus un id absent du DOM", () => {
    const markup = renderToStaticMarkup(
      <Section ix="04" title="TERMINÉS" count={3} defaultOpen={false}>
        <div>contenu</div>
      </Section>,
    );
    // Rien n'est rendu replié : un aria-controls posé quand même pointerait
    // vers un id que le DOM ne porte pas.
    expect(markup).not.toContain("aria-controls");
  });

  it("porte l'ancre visée par le sommaire de la page", () => {
    const markup = renderToStaticMarkup(
      <Section id="tournois-running" ix="01" title="EN COURS" count={2}>
        <div>contenu</div>
      </Section>,
    );
    expect(markup).toMatch(/<section id="tournois-running"/);
  });

  it("ouverture pilotée : `open` l'emporte sur `defaultOpen`", () => {
    const closed = renderToStaticMarkup(
      <Section ix="04" title="TERMINÉS" count={3} defaultOpen={true} open={false}>
        <div>contenu piloté</div>
      </Section>,
    );
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain("contenu piloté");

    const opened = renderToStaticMarkup(
      <Section ix="04" title="TERMINÉS" count={3} defaultOpen={false} open={true}>
        <div>contenu piloté</div>
      </Section>,
    );
    expect(opened).toContain('aria-expanded="true"');
    expect(opened).toContain("contenu piloté");
  });

  it("n'a plus de cadre « Vide » : la page ne rend pas une section sans tournoi", () => {
    const markup = renderToStaticMarkup(
      <Section ix="02" title="INSCRIPTIONS" count={0}>
        {null}
      </Section>,
    );
    expect(markup).not.toContain(">Vide<");
  });

  it("la variante « mine » est posée sur la section, pour son en-tête distinct", () => {
    const markup = renderToStaticMarkup(
      <Section ix="01" title="MES TOURNOIS" count={1} tone="mine">
        <div>contenu</div>
      </Section>,
    );
    expect(markup).toContain('data-tone="mine"');
  });

  it("le chevron est décoratif", () => {
    const markup = renderToStaticMarkup(
      <Section ix="01" title="EN COURS" count={1}>
        <div>contenu</div>
      </Section>,
    );
    expect(markup).toMatch(/<svg[^>]*aria-hidden="true"/);
  });
});
