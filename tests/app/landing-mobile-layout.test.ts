import { describe, expect, it } from "@jest/globals";
import { blockFor, stripComments } from "./_lib/style-sweep";
import { readSource } from "../helpers/read-source";

/**
 * Mise en page mobile de l'accueil. Le navigateur est le seul juge d'un
 * débordement, et Jest n'en a pas : on tient donc les **déclarations** qui
 * l'empêchent, chacune liée à la panne qu'elle ferme (vérifiées en direct à
 * 375 px et 1366 px au moment de l'écriture).
 */

const hero = readSource("components/cyber/landing/Hero.module.css");
const countdown = readSource("components/cyber/CountdownStrip.module.css");
const aboutStats = readSource("components/cyber/landing/AboutStats.module.css");

/** Le contenu d'une requête média, accolades imbriquées comprises. */
function mediaBlock(source: string, query: string): string {
  const css = stripComments(source);
  const at = css.indexOf(`@media ${query}`);
  if (at < 0) throw new Error(`Requête média introuvable : ${query}`);
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") depth -= 1;
    if (depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`Requête média non refermée : ${query}`);
}

/** Toutes les requêtes `max-width` d'une feuille, en pixels. */
function maxWidthQueries(source: string): number[] {
  return [...stripComments(source).matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)].map((m) => Number(m[1]));
}

describe("hero de l'accueil", () => {
  it("laisse ses deux colonnes rétrécir sous la largeur de leur contenu", () => {
    // Un élément de grille vaut au moins son contenu : le compte à rebours
    // imposait 376 px à la piste `1fr`, pour 351 px disponibles à 375 px.
    expect(blockFor(/\.left\s*\{/, hero)).toMatch(/min-width:\s*0\s*;/);
    expect(blockFor(/\.right\s*\{/, hero)).toMatch(/min-width:\s*0\s*;/);
  });

  it("range ses trois chiffres en trois colonnes, sans séparateur, en mobile", () => {
    const mobile = mediaBlock(hero, "(max-width: 720px)");
    const stats = blockFor(/\.stats\s*\{/, mobile);
    expect(stats).toMatch(/display:\s*grid\s*;/);
    expect(stats).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)\s*;/);
    // Un intitulé sur une ligne à côté de deux sur deux lignes : sans cet
    // alignement en tête, le chiffre du milieu descendait de quelques pixels.
    expect(stats).toMatch(/align-items:\s*start\s*;/);
    expect(blockFor(/\.sep\s*\{/, mobile)).toMatch(/display:\s*none\s*;/);
  });

  it("garde la ligne de chiffres et ses séparateurs au-delà de 720 px", () => {
    expect(blockFor(/\.stats\s*\{/, hero)).toMatch(/display:\s*flex\s*;/);
    expect(blockFor(/\.sep\s*\{/, hero)).not.toMatch(/display:\s*none/);
  });
});

describe("compte à rebours", () => {
  it("passe l'étiquette au-dessus des cases quand la place manque", () => {
    const root = blockFor(/\.root\s*\{/, countdown);
    expect(root).toMatch(/flex-wrap:\s*wrap\s*;/);
    const label = blockFor(/\.label\s*\{/, countdown);
    // Une base propre : l'étiquette réclame sa place avant de partager la
    // ligne, au lieu de s'écraser sur quatre lignes à côté des cases.
    expect(label).toMatch(/flex:\s*1\s+1\s+\d+px\s*;/);
    expect(label).toMatch(/min-width:\s*0\s*;/);
  });

  it("ne comprime jamais les cases elles-mêmes", () => {
    expect(blockFor(/\.countdown\s*\{/, countdown)).toMatch(/flex-shrink:\s*0\s*;/);
  });

  it("bascule sans requête média, sur la place réellement disponible", () => {
    // Une requête sur la largeur d'écran ignorerait la colonne qui l'accueille.
    expect(maxWidthQueries(countdown)).toEqual([]);
  });
});

describe("chiffres de l'association", () => {
  it("restent sur deux colonnes en mobile", () => {
    expect(blockFor(/\.stats\s*\{/, aboutStats)).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)\s*;/);
    // Une seule colonne ne vaut que pour les écrans les plus étroits.
    expect(maxWidthQueries(aboutStats)).toEqual([340]);
    expect(blockFor(/\.stats\s*\{/, mediaBlock(aboutStats, "(max-width: 340px)"))).toMatch(
      /grid-template-columns:\s*1fr\s*;/,
    );
  });

  it("laissent leurs boutons d'édition passer à la ligne dans une demi-largeur", () => {
    expect(blockFor(/\.statActions\s*\{/, aboutStats)).toMatch(/flex-wrap:\s*wrap\s*;/);
  });
});
