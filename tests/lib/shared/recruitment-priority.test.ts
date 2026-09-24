import { describe, expect, it } from "@jest/globals";
import {
  RECRUITMENT_PRIORITIES,
  RECRUITMENT_PRIORITY_DESCRIPTIONS,
  RECRUITMENT_PRIORITY_EXPOSURE,
  RECRUITMENT_PRIORITY_LABELS,
  canMoveRecruitmentAd,
  placeRecruitmentAd,
  recruitmentOrderMixesPriorities,
  recruitmentPriorityRank,
  selectRecruitmentSpotlight,
  sortRecruitmentAds,
  splitRecruitmentAds,
  type RecruitmentPriority,
} from "@/lib/shared/recruitment";

/**
 * Statut d'importance d'une annonce de recrutement.
 *
 * Il remplace une mise en avant qui ne servait qu'**une** annonce à la fois :
 * trois annonces cochées « modale à l'arrivée », deux restaient lettre morte, et
 * c'était l'ordre d'une liste mêlant urgentes et facultatives qui décidait
 * laquelle passait. Ces tests tiennent les trois promesses du statut : où
 * l'annonce se montre, dans quel ordre, et qu'aucun geste ne mêle les groupes.
 */

/** Fabrique minimale : seuls les champs lus par ces fonctions comptent. */
function ad(id: number, priority: RecruitmentPriority, active = true) {
  return { id, priority, active };
}

const ids = (list: readonly { id: number }[]) => list.map((a) => a.id);

describe("registre des statuts", () => {
  it("range les statuts du plus important au moins important", () => {
    expect(RECRUITMENT_PRIORITIES).toEqual(["PRIORITY", "IMPORTANT", "OPTIONAL"]);
    expect(recruitmentPriorityRank("PRIORITY")).toBeLessThan(recruitmentPriorityRank("IMPORTANT"));
    expect(recruitmentPriorityRank("IMPORTANT")).toBeLessThan(recruitmentPriorityRank("OPTIONAL"));
  });

  it("nomme et décrit chaque statut", () => {
    expect(RECRUITMENT_PRIORITY_LABELS).toEqual({
      PRIORITY: "Prioritaire",
      IMPORTANT: "Importante",
      OPTIONAL: "Facultative",
    });
    for (const priority of RECRUITMENT_PRIORITIES) {
      expect(RECRUITMENT_PRIORITY_DESCRIPTIONS[priority]).toBeTruthy();
    }
  });

  it("tient la règle d'exposition demandée pour chaque statut", () => {
    // Prioritaire : pastille « Urgente », modale et banderole.
    expect(RECRUITMENT_PRIORITY_EXPOSURE.PRIORITY).toEqual({
      urgent: true,
      modal: true,
      banner: true,
      featured: true,
    });
    // Importante : banderole seulement, sans pastille.
    expect(RECRUITMENT_PRIORITY_EXPOSURE.IMPORTANT).toEqual({
      urgent: false,
      modal: false,
      banner: true,
      featured: true,
    });
    // Facultative : ni l'une ni l'autre, rangée à part.
    expect(RECRUITMENT_PRIORITY_EXPOSURE.OPTIONAL).toEqual({
      urgent: false,
      modal: false,
      banner: false,
      featured: false,
    });
  });
});

describe("sortRecruitmentAds", () => {
  it("fait passer chaque statut devant le suivant, quel que soit l'ordre reçu", () => {
    const list = [ad(1, "OPTIONAL"), ad(2, "IMPORTANT"), ad(3, "PRIORITY"), ad(4, "OPTIONAL")];
    expect(ids(sortRecruitmentAds(list))).toEqual([3, 2, 1, 4]);
  });

  it("garde l'ordre d'affichage à l'intérieur d'un statut (tri stable)", () => {
    const list = [ad(9, "PRIORITY"), ad(2, "IMPORTANT"), ad(5, "PRIORITY"), ad(1, "PRIORITY")];
    expect(ids(sortRecruitmentAds(list))).toEqual([9, 5, 1, 2]);
  });

  it("ne modifie pas la liste reçue", () => {
    const list = [ad(1, "OPTIONAL"), ad(2, "PRIORITY")];
    sortRecruitmentAds(list);
    expect(ids(list)).toEqual([1, 2]);
  });

  it("rend une liste vide pour une liste vide", () => {
    expect(sortRecruitmentAds([])).toEqual([]);
  });
});

describe("splitRecruitmentAds", () => {
  it("sépare la liste principale des « Autres recrutements »", () => {
    const list = sortRecruitmentAds([
      ad(1, "OPTIONAL"),
      ad(2, "IMPORTANT"),
      ad(3, "PRIORITY"),
      ad(4, "OPTIONAL"),
    ]);
    const { featured, others } = splitRecruitmentAds(list);
    expect(ids(featured)).toEqual([3, 2]);
    expect(ids(others)).toEqual([1, 4]);
  });

  it("partage sans re-trier : l'ordre reçu est gardé tel quel", () => {
    // La liste de la page est tenue triée à l'écriture ; la re-trier à chaque
    // rendu ne ferait que redire cet invariant.
    const { featured } = splitRecruitmentAds([ad(2, "IMPORTANT"), ad(3, "PRIORITY")]);
    expect(ids(featured)).toEqual([2, 3]);
  });

  it("laisse la liste principale vide s'il n'y a que des facultatives", () => {
    const { featured, others } = splitRecruitmentAds([ad(1, "OPTIONAL")]);
    expect(featured).toEqual([]);
    expect(ids(others)).toEqual([1]);
  });

  it("n'écarte pas les brouillons : la gestion les voit à leur place", () => {
    const { featured } = splitRecruitmentAds([ad(1, "PRIORITY", false)]);
    expect(ids(featured)).toEqual([1]);
  });
});

describe("selectRecruitmentSpotlight", () => {
  it("met toutes les prioritaires dans la modale, et non plus la seule première", () => {
    const list = [ad(1, "PRIORITY"), ad(2, "PRIORITY"), ad(3, "PRIORITY")];
    expect(ids(selectRecruitmentSpotlight(list).modal)).toEqual([1, 2, 3]);
  });

  it("fait défiler prioritaires puis importantes dans la banderole", () => {
    const list = [ad(1, "IMPORTANT"), ad(2, "OPTIONAL"), ad(3, "PRIORITY"), ad(4, "IMPORTANT")];
    const spotlight = selectRecruitmentSpotlight(list);
    expect(ids(spotlight.banner)).toEqual([3, 1, 4]);
    expect(ids(spotlight.modal)).toEqual([3]);
  });

  it("ne met jamais une facultative en avant", () => {
    const spotlight = selectRecruitmentSpotlight([ad(1, "OPTIONAL"), ad(2, "OPTIONAL")]);
    expect(spotlight).toEqual({ modal: [], banner: [] });
  });

  it("ne met jamais un brouillon en avant, même prioritaire", () => {
    const spotlight = selectRecruitmentSpotlight([ad(1, "PRIORITY", false), ad(2, "IMPORTANT", false)]);
    expect(spotlight).toEqual({ modal: [], banner: [] });
  });

  it("rend des listes vides sans annonce", () => {
    expect(selectRecruitmentSpotlight([])).toEqual({ modal: [], banner: [] });
  });
});

describe("canMoveRecruitmentAd", () => {
  const list = sortRecruitmentAds([
    ad(1, "PRIORITY"),
    ad(2, "PRIORITY"),
    ad(3, "IMPORTANT"),
    ad(4, "OPTIONAL"),
    ad(5, "OPTIONAL"),
  ]);

  it("déplace dans son statut", () => {
    expect(canMoveRecruitmentAd(list, 0, 1)).toBe(true);
    expect(canMoveRecruitmentAd(list, 1, -1)).toBe(true);
    expect(canMoveRecruitmentAd(list, 4, -1)).toBe(true);
  });

  it("refuse de franchir la limite d'un statut, dans les deux sens", () => {
    // La dernière prioritaire ne descend pas chez les importantes…
    expect(canMoveRecruitmentAd(list, 1, 1)).toBe(false);
    // … et la seule importante ne monte ni ne descend.
    expect(canMoveRecruitmentAd(list, 2, -1)).toBe(false);
    expect(canMoveRecruitmentAd(list, 2, 1)).toBe(false);
    // La première facultative ne remonte pas.
    expect(canMoveRecruitmentAd(list, 3, -1)).toBe(false);
  });

  it("refuse de sortir de la liste", () => {
    expect(canMoveRecruitmentAd(list, 0, -1)).toBe(false);
    expect(canMoveRecruitmentAd(list, 4, 1)).toBe(false);
    expect(canMoveRecruitmentAd(list, -1, 1)).toBe(false);
    expect(canMoveRecruitmentAd(list, 99, -1)).toBe(false);
    expect(canMoveRecruitmentAd([], 0, 1)).toBe(false);
  });
});

describe("recruitmentOrderMixesPriorities", () => {
  const priorities = new Map<number, RecruitmentPriority>([
    [1, "PRIORITY"],
    [2, "PRIORITY"],
    [3, "IMPORTANT"],
    [4, "OPTIONAL"],
  ]);

  it("accepte un ordre groupé par statut, quel que soit l'ordre dans chaque groupe", () => {
    expect(recruitmentOrderMixesPriorities([1, 2, 3, 4], priorities)).toBe(false);
    expect(recruitmentOrderMixesPriorities([2, 1, 3, 4], priorities)).toBe(false);
  });

  it("refuse une annonce placée devant une plus importante", () => {
    expect(recruitmentOrderMixesPriorities([1, 3, 2, 4], priorities)).toBe(true);
    expect(recruitmentOrderMixesPriorities([4, 1, 2, 3], priorities)).toBe(true);
  });

  it("ignore les identifiants inconnus, sans les laisser masquer un mélange", () => {
    expect(recruitmentOrderMixesPriorities([1, 99, 3, 4], priorities)).toBe(false);
    expect(recruitmentOrderMixesPriorities([3, 99, 1], priorities)).toBe(true);
  });

  it("accepte une liste vide ou partielle", () => {
    expect(recruitmentOrderMixesPriorities([], priorities)).toBe(false);
    expect(recruitmentOrderMixesPriorities([3], priorities)).toBe(false);
  });
});

describe("placeRecruitmentAd", () => {
  const list = [ad(1, "PRIORITY"), ad(2, "PRIORITY"), ad(3, "IMPORTANT"), ad(4, "OPTIONAL")];

  it("laisse à sa place une annonce qui garde son statut", () => {
    const edited = { ...ad(1, "PRIORITY"), active: false };
    const placed = placeRecruitmentAd(list, edited);
    expect(ids(placed)).toEqual([1, 2, 3, 4]);
    expect(placed[0]).toBe(edited);
  });

  it("met en fin de son nouveau groupe une annonce qui change de statut", () => {
    // Comme le serveur, qui lui donne alors le plus grand rang d'affichage.
    expect(ids(placeRecruitmentAd(list, ad(4, "PRIORITY")))).toEqual([1, 2, 4, 3]);
    expect(ids(placeRecruitmentAd(list, ad(1, "OPTIONAL")))).toEqual([2, 3, 4, 1]);
    expect(ids(placeRecruitmentAd(list, ad(1, "IMPORTANT")))).toEqual([2, 3, 1, 4]);
  });

  it("met une annonce neuve en fin de son groupe", () => {
    expect(ids(placeRecruitmentAd(list, ad(5, "IMPORTANT")))).toEqual([1, 2, 3, 5, 4]);
    expect(ids(placeRecruitmentAd([], ad(5, "OPTIONAL")))).toEqual([5]);
  });
});
