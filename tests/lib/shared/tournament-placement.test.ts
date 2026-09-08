import { describe, expect, it } from "@jest/globals";
import {
  MIN_PLACEMENT_ENTRANTS,
  PLACEMENT_AMPLITUDE,
  PLACEMENT_MAX_DIFFICULTY,
  PLACEMENT_MIN_DIFFICULTY,
  placementDeltas,
  placementDifficulty,
  placementPositionWeight,
  placementPot,
  placementShares,
  type PlacementEntrant,
} from "@/lib/shared/tournament-placement";

/**
 * Le calcul des points de parcours, pris seul et sans base.
 *
 * Trois propriétés portent tout le reste — somme nulle, part décroissante avec
 * le rang, enjeu croissant avec la difficulté — et ce fichier ne teste rien
 * d'autre tant qu'elles ne sont pas tenues.
 */

const BASE = 500;

/** Un plateau à la cote de départ, classé 1, 2, 3… */
function evenField(count: number, rating = BASE): PlacementEntrant[] {
  return Array.from({ length: count }, (_, index) => ({
    teamId: index + 1,
    rank: index + 1,
    rating,
  }));
}

function sumOf(deltas: Map<number, number>): number {
  return [...deltas.values()].reduce((total, value) => total + value, 0);
}

describe("placementPositionWeight", () => {
  it("décroît en inverse de la place", () => {
    expect(placementPositionWeight(1)).toBe(1);
    expect(placementPositionWeight(2)).toBe(0.5);
    expect(placementPositionWeight(4)).toBe(0.25);
  });
});

describe("placementShares", () => {
  it("répartit une part entière entre les engagées", () => {
    for (const count of [2, 3, 8, 16, 64]) {
      const shares = placementShares(evenField(count).map((entrant) => entrant.rank));
      expect(shares.reduce((total, share) => total + share, 0)).toBeCloseTo(1, 10);
    }
  });

  it("donne plus à qui va plus loin, sans jamais rien donner de négatif", () => {
    const shares = placementShares([1, 2, 3, 4, 5, 6, 7, 8]);
    for (let index = 1; index < shares.length; index += 1) {
      expect(shares[index]).toBeLessThan(shares[index - 1]);
      expect(shares[index]).toBeGreaterThan(0);
    }
  });

  it("rend les parts dans l'ordre reçu, pas dans l'ordre du classement", () => {
    const sorted = placementShares([1, 2, 3]);
    const shuffled = placementShares([3, 1, 2]);

    expect(shuffled[0]).toBeCloseTo(sorted[2], 12);
    expect(shuffled[1]).toBeCloseTo(sorted[0], 12);
    expect(shuffled[2]).toBeCloseTo(sorted[1], 12);
  });

  // Un rang stocké n'est qu'un ordre : le classement d'un mode qui saute des
  // numéros doit se lire exactement comme 1, 2, 3…
  it("ne lit que l'ordre des rangs, pas leur valeur", () => {
    expect(placementShares([10, 20, 30])).toEqual(placementShares([1, 2, 3]));
  });

  it("partage entre ex æquo les places qu'ils occupent ensemble", () => {
    const shares = placementShares([1, 2, 2, 4]);
    const reference = placementShares([1, 2, 3, 4]);

    // Les deux deuxièmes se partagent les 2ᵉ et 3ᵉ places…
    expect(shares[1]).toBeCloseTo((reference[1] + reference[2]) / 2, 12);
    expect(shares[2]).toBeCloseTo(shares[1], 12);
    // …et la suivante garde la 4ᵉ, qui n'a été prise par personne.
    expect(shares[3]).toBeCloseTo(reference[3], 12);
    // La somme reste entière : c'est elle qui garantit la somme nulle.
    expect(shares.reduce((total, share) => total + share, 0)).toBeCloseTo(1, 10);
  });

  it("partage tout également quand tout le monde est ex æquo", () => {
    const shares = placementShares([1, 1, 1, 1]);
    for (const share of shares) expect(share).toBeCloseTo(0.25, 12);
  });

  it("ne rend rien pour un plateau vide", () => {
    expect(placementShares([])).toEqual([]);
  });
});

describe("placementDifficulty", () => {
  it("vaut 1 pour un plateau à la cote de départ", () => {
    expect(placementDifficulty([BASE, BASE, BASE], BASE)).toBe(1);
  });

  it("suit la cote moyenne du plateau", () => {
    expect(placementDifficulty([600, 800], BASE)).toBeCloseTo(1.4, 10);
    expect(placementDifficulty([300, 500], BASE)).toBeCloseTo(0.8, 10);
  });

  // Sans plafond, un tournoi entre les huit meilleures équipes pèserait plus
  // que toute une saison ; sans plancher, un tournoi de remplissage ne vaudrait
  // plus rien.
  it("borne l'enjeu des deux côtés", () => {
    expect(placementDifficulty([5000, 5000], BASE)).toBe(PLACEMENT_MAX_DIFFICULTY);
    expect(placementDifficulty([100, 100], BASE)).toBe(PLACEMENT_MIN_DIFFICULTY);
  });

  it("reste neutre sur une entrée qui n'a aucun sens", () => {
    expect(placementDifficulty([], BASE)).toBe(1);
    expect(placementDifficulty([500], 0)).toBe(1);
  });
});

describe("placementPot", () => {
  it("croît en racine de l'effectif", () => {
    expect(placementPot(4, 1)).toBeCloseTo(PLACEMENT_AMPLITUDE * 2, 10);
    expect(placementPot(16, 1)).toBeCloseTo(PLACEMENT_AMPLITUDE * 4, 10);
    // Quatre fois plus d'équipes, deux fois plus d'enjeu — jamais quatre.
    expect(placementPot(16, 1)).toBeCloseTo(placementPot(4, 1) * 2, 10);
  });

  it("suit la difficulté", () => {
    expect(placementPot(16, 2)).toBeCloseTo(placementPot(16, 1) * 2, 10);
  });

  it("ne met rien en jeu sous le seuil d'engagées", () => {
    expect(placementPot(MIN_PLACEMENT_ENTRANTS - 1, 1)).toBe(0);
    expect(placementPot(0, 1)).toBe(0);
  });
});

describe("placementDeltas — somme nulle", () => {
  it("ne crée ni ne détruit de point, quel que soit l'effectif", () => {
    for (const count of [2, 3, 5, 8, 13, 16, 31, 64, 128]) {
      expect(sumOf(placementDeltas(evenField(count), BASE))).toBe(0);
    }
  });

  it("reste à somme nulle sur un plateau aux cotes hétérogènes", () => {
    const entrants = Array.from({ length: 17 }, (_, index) => ({
      teamId: index + 1,
      rank: index + 1,
      rating: 200 + index * 47,
    }));

    expect(sumOf(placementDeltas(entrants, BASE))).toBe(0);
  });

  it("reste à somme nulle avec des ex æquo", () => {
    const ranks = [1, 2, 2, 2, 5, 6, 6, 8];
    const entrants = ranks.map((rank, index) => ({ teamId: index + 1, rank, rating: BASE }));

    expect(sumOf(placementDeltas(entrants, BASE))).toBe(0);
  });

  it("ne rend que des entiers", () => {
    for (const delta of placementDeltas(evenField(13), BASE).values()) {
      expect(Number.isInteger(delta)).toBe(true);
    }
  });
});

describe("placementDeltas — le rang paie", () => {
  it("paie strictement plus haut on finit", () => {
    const deltas = placementDeltas(evenField(16), BASE);
    for (let rank = 2; rank <= 16; rank += 1) {
      expect(deltas.get(rank)!).toBeLessThanOrEqual(deltas.get(rank - 1)!);
    }
    expect(deltas.get(1)!).toBeGreaterThan(0);
    expect(deltas.get(16)!).toBeLessThan(0);
  });

  it("donne la même chose à deux ex æquo", () => {
    const entrants = [1, 2, 2, 4].map((rank, index) => ({
      teamId: index + 1,
      rank,
      rating: BASE,
    }));
    const deltas = placementDeltas(entrants, BASE);

    expect(deltas.get(2)).toBe(deltas.get(3));
  });

  // C'est la différence revendiquée avec le transfert de match : l'espérance a
  // déjà eu son mot à dire, rencontre par rencontre.
  it("ne regarde pas la cote de la championne, seulement son rang", () => {
    const favourite = placementDeltas(
      [
        { teamId: 1, rank: 1, rating: 700 },
        { teamId: 2, rank: 2, rating: 300 },
        { teamId: 3, rank: 3, rating: 500 },
        { teamId: 4, rank: 4, rating: 500 },
      ],
      BASE,
    );
    const underdog = placementDeltas(
      [
        { teamId: 1, rank: 4, rating: 700 },
        { teamId: 2, rank: 1, rating: 300 },
        { teamId: 3, rank: 2, rating: 500 },
        { teamId: 4, rank: 3, rating: 500 },
      ],
      BASE,
    );

    // Le plateau est le même — même cagnotte — et la première prend la même
    // part, qu'elle ait été favorite ou non.
    expect(underdog.get(2)).toBe(favourite.get(1));
  });
});

describe("placementDeltas — la difficulté fixe l'enjeu", () => {
  it("paie davantage sur un plateau relevé", () => {
    const easy = placementDeltas(evenField(16, 300), BASE);
    const hard = placementDeltas(evenField(16, 900), BASE);

    expect(hard.get(1)!).toBeGreaterThan(easy.get(1)!);
    // Bornes obligent : au plus le double d'un plateau moyen, au moins la
    // moitié — donc au plus quatre fois d'un extrême à l'autre.
    expect(hard.get(1)!).toBeLessThanOrEqual(easy.get(1)! * 4);
  });

  it("paie davantage sur un plateau plus grand", () => {
    const small = placementDeltas(evenField(8), BASE);
    const large = placementDeltas(evenField(64), BASE);

    expect(large.get(1)!).toBeGreaterThan(small.get(1)!);
  });
});

describe("placementDeltas — cas limites", () => {
  it("ne redistribue rien sous le seuil d'engagées", () => {
    expect(placementDeltas([], BASE).size).toBe(0);
    expect(placementDeltas([{ teamId: 1, rank: 1, rating: BASE }], BASE).size).toBe(0);
  });

  it("nomme toutes les engagées, y compris celles qui ne bougent pas", () => {
    const deltas = placementDeltas(evenField(9), BASE);
    expect(deltas.size).toBe(9);
  });

  it("rend deux fois le même tableau pour le même plateau", () => {
    const entrants = evenField(23, 640);
    expect([...placementDeltas(entrants, BASE)]).toEqual([...placementDeltas(entrants, BASE)]);
  });

  // L'ordre du tableau reçu est celui du SQL : il ne doit rien décider.
  it("ne dépend pas de l'ordre dans lequel les engagées arrivent", () => {
    const entrants = evenField(11, 610);
    const reversed = [...entrants].reverse();

    for (const entrant of entrants) {
      expect(placementDeltas(reversed, BASE).get(entrant.teamId)).toBe(
        placementDeltas(entrants, BASE).get(entrant.teamId),
      );
    }
  });

  it("gagner un tournoi rapporte plus qu'un match gagné", () => {
    // 32, l'amplitude maximale d'une rencontre.
    expect(placementDeltas(evenField(8), BASE).get(1)!).toBeGreaterThan(32);
  });
});
