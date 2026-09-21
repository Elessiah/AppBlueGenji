import { describe, expect, it } from "@jest/globals";
import { contactsPanelView } from "@/app/(secured)/tournois/[id]/_lib/contacts-panel-view";

/**
 * La vue du panneau de contacts, cas par cas.
 *
 * Le défaut que ces cas gardent : écrite en ternaires imbriqués dans le JSX, la
 * règle avait un état où **les trois branches étaient fausses à la fois** —
 * chargement retombé, liste encore `null` après un échec. Le panneau restait
 * déplié et parfaitement vide, le toast d'erreur s'étant effacé entre-temps, et
 * l'arbitre n'avait aucun moyen de comprendre qu'il devait replier le panneau
 * pour relancer la lecture.
 */
describe("contactsPanelView", () => {
  it("annonce le chargement à la première ouverture", () => {
    expect(contactsPanelView({ loading: true, entrants: null, failure: null })).toBe("LOADING");
  });

  it("montre l'échec plutôt qu'un vide — le cas qui portait le défaut", () => {
    expect(contactsPanelView({ loading: false, entrants: null, failure: "Tournoi terminé." })).toBe(
      "ERROR",
    );
  });

  it("ne rend jamais « rien » : un état sans liste ni échec attend encore", () => {
    // Inatteignable en pratique, et c'est la raison de le trancher : c'est de
    // cet état-là que naissait le panneau vide.
    expect(contactsPanelView({ loading: false, entrants: null, failure: null })).toBe("LOADING");
  });

  it("préfère l'échec à une liste déjà reçue", () => {
    // « Tournoi terminé » ferme l'accès : laisser les tags déjà affichés serait
    // montrer ce que la route vient de refuser.
    expect(
      contactsPanelView({ loading: false, entrants: [{}, {}], failure: "Tournoi terminé." }),
    ).toBe("ERROR");
  });

  it("garde la liste pendant un rechargement", () => {
    // Périmée d'une seconde, pas fausse : la faire clignoter en « Chargement… »
    // à chaque réouverture n'apprendrait rien.
    expect(contactsPanelView({ loading: true, entrants: [{}], failure: null })).toBe("LIST");
  });

  it("distingue le plateau vide de la liste", () => {
    expect(contactsPanelView({ loading: false, entrants: [], failure: null })).toBe("EMPTY");
    expect(contactsPanelView({ loading: false, entrants: [{}], failure: null })).toBe("LIST");
  });
});
