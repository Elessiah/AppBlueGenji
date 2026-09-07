import { describe, expect, it } from "@jest/globals";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  formatShareDate,
  formatShareDateShort,
  tournamentShareCard,
  tournamentShareDescription,
  tournamentShareState,
  tournamentShareTitle,
  truncateForShare,
} from "@/lib/shared/share-metadata";
import type { TournamentCard } from "@/lib/shared/types";

/**
 * Ce que raconte un lien du site quand on le colle ailleurs.
 *
 * Le module est pur pour être testable ici : c'est la rédaction qui se trompe —
 * un tournoi terminé qui annonce un « coup d'envoi », une description qui coupe
 * au milieu d'un nom d'équipe —, pas le fait de poser une balise `<meta>`.
 */

const NOW = Date.parse("2026-08-10T12:00:00.000Z");

function card(overrides: Partial<TournamentCard> = {}): TournamentCard {
  return {
    id: 42,
    name: "OW Open Cup",
    description: null,
    format: "SINGLE",
    game: "OW2",
    participantType: "TEAM",
    maxTeams: 16,
    registeredTeams: 5,
    state: "REGISTRATION",
    startVisibilityAt: "2026-08-01T10:00:00.000Z",
    registrationOpenAt: "2026-08-05T10:00:00.000Z",
    registrationCloseAt: "2026-08-20T18:00:00.000Z",
    startAt: "2026-08-25T18:00:00.000Z",
    hasThirdPlaceMatch: false,
    survivalRoundsBeforeFirstCut: null,
    survivalRoundsPerCut: null,
    phases: null,
    matchFormat: null,
    liveUrl: null,
    ...overrides,
  };
}

describe("Textes du site", () => {
  it("nomme les deux jeux, Overwatch d'abord", () => {
    // BlueGenji est d'abord une structure Overwatch : la racine annonçait
    // « l'esport amateur Marvel Rivals » tout court.
    expect(SITE_DESCRIPTION).toContain("Overwatch");
    expect(SITE_DESCRIPTION).toContain("Marvel Rivals");
    expect(SITE_DESCRIPTION.indexOf("Overwatch")).toBeLessThan(
      SITE_DESCRIPTION.indexOf("Marvel Rivals"),
    );
    expect(SITE_TAGLINE.indexOf("Overwatch")).toBeLessThan(SITE_TAGLINE.indexOf("Marvel Rivals"));
  });

  it("porte le nom du site tel qu'il doit apparaître dans un encart", () => {
    expect(SITE_NAME).toBe("BlueGenji Esport");
  });
});

describe("truncateForShare", () => {
  it("laisse un texte court intact, sans ellipse ni espace ajouté", () => {
    expect(truncateForShare("Coupe d'été", 50)).toBe("Coupe d'été");
  });

  it("aplatit les sauts de ligne : un encart est un paragraphe", () => {
    expect(truncateForShare("Deux\n\nlignes   espacées", 50)).toBe("Deux lignes espacées");
  });

  it("coupe sur un mot et n'excède jamais la limite annoncée", () => {
    const result = truncateForShare("alpha bravo charlie delta echo foxtrot", 20);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result.endsWith("…")).toBe(true);
    // Aucun mot n'est tronqué : le dernier morceau avant l'ellipse est entier.
    expect("alpha bravo charlie delta echo foxtrot").toContain(result.slice(0, -1));
  });

  it("tranche dans un mot unique trop long, faute d'espace où couper", () => {
    const result = truncateForShare("Supercalifragilisticexpialidocious", 12);
    expect(result).toBe("Supercalifr…");
    expect(result.length).toBe(12);
  });

  it("ne laisse pas de ponctuation orpheline devant l'ellipse", () => {
    expect(truncateForShare("Coupe d'été, saison six et suivantes", 18)).toBe("Coupe d'été…");
  });
});

describe("Dates rédigées", () => {
  it("écrit la date dans le fuseau du public visé, pas dans celui du serveur", () => {
    // 18:00 UTC en août = 20:00 à Paris. Le fuseau est figé : un encart est
    // rédigé une fois côté serveur pour tout le monde.
    expect(formatShareDate("2026-08-25T18:00:00.000Z")).toBe("25 août 2026 à 20:00");
    expect(formatShareDateShort("2026-08-25T18:00:00.000Z")).toBe("25 août 2026 · 20:00");
  });

  it("rend null sur une date illisible plutôt que « Invalid Date »", () => {
    expect(formatShareDate("pas une date")).toBeNull();
    expect(formatShareDateShort("")).toBeNull();
  });
});

describe("tournamentShareTitle", () => {
  it("porte le nom du tournoi puis son jeu", () => {
    expect(tournamentShareTitle(card())).toBe("OW Open Cup · Overwatch 2");
    expect(tournamentShareTitle(card({ game: "MR" }))).toBe("OW Open Cup · Marvel Rivals");
  });
});

describe("tournamentShareDescription", () => {
  it("annonce l'état, le format, l'effectif et la clôture des inscriptions", () => {
    expect(tournamentShareDescription(card(), NOW)).toBe(
      "Inscriptions ouvertes · Simple élimination · 5/16 équipes engagées · Inscriptions jusqu'au 20 août 2026 à 20:00.",
    );
  });

  it("met le texte de l'organisateur devant les faits", () => {
    const result = tournamentShareDescription(
      card({ description: "Le rendez-vous de la rentrée." }),
      NOW,
    );
    expect(result.startsWith("Le rendez-vous de la rentrée. — Inscriptions ouvertes")).toBe(true);
  });

  it("borne le texte libre pour que la date reste visible dans l'encart", () => {
    const result = tournamentShareDescription(card({ description: "mot ".repeat(200) }), NOW);
    expect(result.length).toBeLessThanOrEqual(300);
    expect(result).toContain("Inscriptions jusqu'au");
  });

  it("parle du vocabulaire individuel sur un tournoi solo", () => {
    expect(tournamentShareDescription(card({ participantType: "SOLO" }), NOW)).toContain(
      "5/16 joueurs engagés",
    );
  });

  describe("l'échéance dépend de l'état", () => {
    it("un tournoi terminé dit quand il a été joué, pas quand il commence", () => {
      const result = tournamentShareDescription(card({ state: "FINISHED" }), NOW);
      expect(result).toContain("Tournoi terminé");
      expect(result).toContain("Joué le 25 août 2026 à 20:00");
      expect(result).not.toContain("Coup d'envoi");
    });

    it("un tournoi en cours dit depuis quand", () => {
      expect(tournamentShareDescription(card({ state: "RUNNING" }), NOW)).toContain(
        "En cours depuis le 25 août 2026 à 20:00",
      );
    });

    it("avant l'ouverture des inscriptions, il annonce l'ouverture", () => {
      const before = Date.parse("2026-08-02T12:00:00.000Z");
      expect(tournamentShareDescription(card({ state: "UPCOMING" }), before)).toContain(
        "Inscriptions dès le 5 août 2026 à 12:00",
      );
    });

    it("après la clôture mais avant le lancement, il annonce le coup d'envoi", () => {
      const after = Date.parse("2026-08-21T12:00:00.000Z");
      expect(tournamentShareDescription(card({ state: "UPCOMING" }), after)).toContain(
        "Coup d'envoi le 25 août 2026 à 20:00",
      );
    });

    it("une date illisible retire l'échéance sans casser la phrase", () => {
      const result = tournamentShareDescription(card({ registrationCloseAt: "" }), NOW);
      expect(result).toBe("Inscriptions ouvertes · Simple élimination · 5/16 équipes engagées.");
    });
  });
});

describe("tournamentShareCard", () => {
  it("remonte le jeu dans le surtitre : le titre appartient au nom du tournoi", () => {
    const built = tournamentShareCard(card(), NOW);
    expect(built.eyebrow).toBe("Overwatch 2 · Inscriptions ouvertes");
    expect(built.title).toBe("OW Open Cup");
  });

  it("étiquette l'échéance et n'en garde que la date en valeur", () => {
    // « Calendrier : Inscriptions jusqu'au 20 août 2026 à 20:00 » répétait
    // l'information et débordait de sa case.
    expect(tournamentShareCard(card(), NOW).facts).toEqual([
      { label: "Format", value: "Simple élimination" },
      { label: "Équipes", value: "5/16" },
      { label: "Inscriptions jusqu'au", value: "20 août 2026 · 20:00" },
    ]);
  });

  it("nomme la case d'effectif d'après le type de participant", () => {
    const built = tournamentShareCard(card({ participantType: "SOLO" }), NOW);
    expect(built.facts[1]).toEqual({ label: "Joueurs", value: "5/16" });
  });

  it("laisse le sous-titre vide plutôt que d'inventer une ligne", () => {
    expect(tournamentShareCard(card(), NOW).subtitle).toBeUndefined();
    expect(tournamentShareCard(card({ description: "   " }), NOW).subtitle).toBeUndefined();
  });

  it("borne le sous-titre repris de la description", () => {
    const built = tournamentShareCard(card({ description: "mot ".repeat(200) }), NOW);
    expect(built.subtitle).toBeDefined();
    expect(built.subtitle!.length).toBeLessThanOrEqual(130);
  });

  it("omet la case d'échéance quand la date est illisible", () => {
    const built = tournamentShareCard(card({ registrationCloseAt: "n'importe quoi" }), NOW);
    expect(built.facts).toHaveLength(2);
  });
});

describe("tournamentShareState", () => {
  it("couvre les quatre états", () => {
    expect(tournamentShareState(card({ state: "UPCOMING" }))).toBe("Prochainement");
    expect(tournamentShareState(card({ state: "REGISTRATION" }))).toBe("Inscriptions ouvertes");
    expect(tournamentShareState(card({ state: "RUNNING" }))).toBe("Tournoi en cours");
    expect(tournamentShareState(card({ state: "FINISHED" }))).toBe("Tournoi terminé");
  });
});
