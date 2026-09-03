import { describe, expect, it } from "@jest/globals";
import {
  MATCH_ANCHOR_PREFIX,
  matchAnchorId,
  parseMatchAnchor,
  phaseRevealingMatch,
  tournamentMatchHref,
} from "@/lib/shared/match-anchor";

/**
 * Le lien profond vers un match est un **contrat entre deux pages** : l'accueil
 * l'écrit, la fiche du tournoi le lit. Les deux moitiés passent par ce module,
 * et ces cas gardent qu'elles restent réciproques — un lien qui ne se relit pas
 * ne casse rien de visible, il mène simplement en haut de la page.
 */
describe("matchAnchorId", () => {
  it("préfixe l'identifiant du match", () => {
    expect(matchAnchorId(42)).toBe("match-42");
    expect(matchAnchorId(1)).toBe("match-1");
  });

  it("découle du préfixe exporté, jamais d'une chaîne recopiée", () => {
    expect(matchAnchorId(7)).toBe(`${MATCH_ANCHOR_PREFIX}7`);
  });
});

describe("parseMatchAnchor", () => {
  it("relit ce que `matchAnchorId` a écrit, avec ou sans dièse", () => {
    for (const matchId of [1, 9, 42, 1234, Number.MAX_SAFE_INTEGER]) {
      expect(parseMatchAnchor(`#${matchAnchorId(matchId)}`)).toBe(matchId);
      expect(parseMatchAnchor(matchAnchorId(matchId))).toBe(matchId);
    }
  });

  it("ignore un fragment qui ne parle pas de match", () => {
    for (const hash of ["", "#", "#inscriptions", "#classement", "#matchs", "match", "#match"]) {
      expect(parseMatchAnchor(hash)).toBeNull();
    }
  });

  it("refuse les formes qui se convertiraient quand même", () => {
    // Toutes ces chaînes donneraient un nombre via `Number()`. Un identifiant de
    // match s'écrit en base 10 sans fioriture : tolérer ici, c'est accepter une
    // cible fantôme sur la fiche du tournoi.
    for (const hash of [
      "#match-0",
      "#match-01",
      "#match-1.5",
      "#match-+1",
      "#match--1",
      "#match-1e3",
      "#match-0x2a",
      "#match- 4",
      "#match-4 ",
      "#match-4a",
      "#match-Infinity",
    ]) {
      expect(parseMatchAnchor(hash)).toBeNull();
    }
  });

  it("refuse une entrée qui n'est pas une chaîne", () => {
    for (const value of [null, undefined, 42, {}, []] as unknown[]) {
      expect(parseMatchAnchor(value as string)).toBeNull();
    }
  });

  it("refuse un identifiant au-delà des entiers sûrs", () => {
    // `Number("9007199254740993")` rend 9007199254740992 : un identifiant qui
    // n'est plus celui qu'on a lu.
    expect(parseMatchAnchor("#match-9007199254740993")).toBeNull();
  });
});

describe("tournamentMatchHref", () => {
  it("ancre le chemin sur le match désigné", () => {
    expect(tournamentMatchHref(7, 42)).toBe("/tournois/7#match-42");
  });

  it("se réduit au tournoi sans match à désigner", () => {
    expect(tournamentMatchHref(7)).toBe("/tournois/7");
    expect(tournamentMatchHref(7, null)).toBe("/tournois/7");
    expect(tournamentMatchHref(7, undefined)).toBe("/tournois/7");
  });

  it("se réduit au tournoi plutôt que d'écrire une ancre morte", () => {
    // Mieux vaut une page ouverte en haut qu'un fragment que personne ne relira.
    for (const matchId of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(tournamentMatchHref(7, matchId)).toBe("/tournois/7");
    }
  });

  it("produit un chemin que `parseMatchAnchor` relit", () => {
    const href = tournamentMatchHref(12, 300);
    expect(parseMatchAnchor(href.slice(href.indexOf("#")))).toBe(300);
  });
});

describe("phaseRevealingMatch", () => {
  const matches = [
    { id: 1, phaseId: 0 },
    { id: 2, phaseId: 10 },
    { id: 3, phaseId: 20 },
  ];

  it("désigne la phase qui contient le match visé", () => {
    expect(phaseRevealingMatch(matches, 3, 10)).toBe(20);
  });

  it("ne demande rien quand la phase est déjà affichée", () => {
    expect(phaseRevealingMatch(matches, 2, 10)).toBeNull();
  });

  it("ne demande rien pour un tournoi sans phases", () => {
    // `phaseId === 0` : le plateau est rendu d'un seul tenant, il n'y a aucun
    // onglet à basculer.
    expect(phaseRevealingMatch(matches, 1, null)).toBeNull();
  });

  it("ne demande rien tant que le plateau n'est pas arrivé", () => {
    // Le flux SSE apporte les matchs après le premier rendu : on ne sait pas
    // encore dans quelle phase vit la cible, et deviner ferait basculer le
    // lecteur sur une phase au hasard.
    expect(phaseRevealingMatch(undefined, 3, null)).toBeNull();
    expect(phaseRevealingMatch(null, 3, null)).toBeNull();
    expect(phaseRevealingMatch([], 3, null)).toBeNull();
  });

  it("ne demande rien pour un match qui n'est pas de ce tournoi", () => {
    expect(phaseRevealingMatch(matches, 999, 10)).toBeNull();
  });

  it("ne demande rien sans cible", () => {
    expect(phaseRevealingMatch(matches, null, 10)).toBeNull();
  });

  it("bascule depuis une sélection encore indéterminée", () => {
    expect(phaseRevealingMatch(matches, 3, null)).toBe(20);
  });
});
