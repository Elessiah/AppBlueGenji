import { describe, expect, it } from "@jest/globals";
import {
  DEFAULT_OPEN_SECTIONS,
  PAGE_SECTION_ORDER,
  pageSectionAnchor,
  pageSections,
  parsePageSectionAnchor,
  splitMyTournaments,
  type PageSectionKey,
} from "@/app/(secured)/tournois/_lib/page-sections";
import type { TournamentBuckets } from "@/lib/shared/types";
import { tournamentCard } from "../helpers/tournament-card";

function buckets(): TournamentBuckets {
  return {
    running: [tournamentCard({ id: 1, state: "RUNNING" }), tournamentCard({ id: 2, state: "RUNNING" })],
    registration: [
      tournamentCard({ id: 3, state: "REGISTRATION" }),
      tournamentCard({ id: 4, state: "REGISTRATION" }),
    ],
    upcoming: [tournamentCard({ id: 5 }), tournamentCard({ id: 6 })],
    finished: [tournamentCard({ id: 7, state: "FINISHED" })],
  };
}

const ids = (list: { id: number }[]) => list.map((t) => t.id);

describe("splitMyTournaments", () => {
  it("regroupe les tournois du lecteur en tête : en cours, inscriptions, à venir", () => {
    const { mine } = splitMyTournaments(buckets(), new Set([6, 3, 2]));
    expect(ids(mine)).toEqual([2, 3, 6]);
  });

  it("les retire de leur panier d'origine : aucun tournoi n'apparaît deux fois", () => {
    const { mine, others } = splitMyTournaments(buckets(), new Set([1, 4, 5]));
    expect(ids(others.running)).toEqual([2]);
    expect(ids(others.registration)).toEqual([3]);
    expect(ids(others.upcoming)).toEqual([6]);
    const all = [...mine, ...others.running, ...others.registration, ...others.upcoming, ...others.finished];
    expect(new Set(ids(all)).size).toBe(all.length);
  });

  it("laisse les terminés sous « Terminés », même joués par le lecteur", () => {
    const { mine, others } = splitMyTournaments(buckets(), new Set([7]));
    expect(mine).toEqual([]);
    expect(ids(others.finished)).toEqual([7]);
  });

  it("sans tournoi du lecteur, rend les paniers tels quels (même référence)", () => {
    const source = buckets();
    const { mine, others } = splitMyTournaments(source, new Set());
    expect(mine).toEqual([]);
    expect(others).toBe(source);
  });

  it("ignore un identifiant absent des paniers (tournoi filtré ou pas encore relu)", () => {
    const { mine } = splitMyTournaments(buckets(), new Set([999, 1]));
    expect(ids(mine)).toEqual([1]);
  });
});

describe("pageSections", () => {
  const counts: Record<PageSectionKey, number> = {
    hidden: 2,
    mine: 1,
    running: 0,
    registration: 3,
    upcoming: 0,
    finished: 9,
  };

  it("met « Mes tournois » en tête, seulement devancé par la section du staff", () => {
    const keys = pageSections(counts, { hidden: true, mine: true }).map((e) => e.key);
    expect(keys).toEqual(["hidden", "mine", "running", "registration", "upcoming", "finished"]);
  });

  it("n'annonce « Mes tournois » qu'à un joueur engagé, les invisibles qu'au staff", () => {
    const keys = pageSections(counts, { hidden: false, mine: false }).map((e) => e.key);
    expect(keys).toEqual(["running", "registration", "upcoming", "finished"]);
  });

  it("garde les sections vides avec leur zéro : le sommaire dit ce qui n'existe pas", () => {
    const entries = pageSections(counts, { hidden: false, mine: true });
    expect(entries.find((e) => e.key === "running")?.count).toBe(0);
    expect(entries.find((e) => e.key === "mine")).toMatchObject({
      title: "MES TOURNOIS",
      navLabel: "Mes tournois",
      count: 1,
    });
  });

  it("une section du lecteur vidée par un filtre reste au sommaire, à zéro", () => {
    const entries = pageSections({ ...counts, mine: 0 }, { hidden: false, mine: true });
    expect(entries.find((e) => e.key === "mine")?.count).toBe(0);
  });
});

describe("repères de la page", () => {
  it("chaque section a une ancre distincte", () => {
    const anchors = PAGE_SECTION_ORDER.map(pageSectionAnchor);
    expect(new Set(anchors).size).toBe(anchors.length);
    expect(pageSectionAnchor("mine")).toBe("tournois-mine");
  });

  it("seule l'archive des terminés est repliée à l'arrivée", () => {
    expect(PAGE_SECTION_ORDER.filter((key) => !DEFAULT_OPEN_SECTIONS.includes(key))).toEqual([
      "finished",
    ]);
  });
});

describe("parsePageSectionAnchor", () => {
  it("retrouve la section d'une ancre du sommaire, avec ou sans « # »", () => {
    expect(parsePageSectionAnchor("#tournois-finished")).toBe("finished");
    expect(parsePageSectionAnchor("tournois-mine")).toBe("mine");
  });

  it("refuse tout fragment qui ne nomme pas une section connue", () => {
    expect(parsePageSectionAnchor("")).toBeNull();
    expect(parsePageSectionAnchor("#match-42")).toBeNull();
    expect(parsePageSectionAnchor("#tournois-")).toBeNull();
    expect(parsePageSectionAnchor("#tournois-finished-x")).toBeNull();
  });

  it("chaque ancre produite se relit en sa propre section", () => {
    for (const key of PAGE_SECTION_ORDER) {
      expect(parsePageSectionAnchor(`#${pageSectionAnchor(key)}`)).toBe(key);
    }
  });
});
