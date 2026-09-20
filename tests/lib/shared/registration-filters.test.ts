import { describe, expect, it } from "@jest/globals";
import {
  checkRegistrationFilters,
  DEFAULT_REGISTRATION_FILTERS,
  DISCORD_REQUIREMENT_LABELS,
  isDiscordRequirement,
  isValidMinPlayers,
  MIN_PLAYERS_BOUNDS,
  parseRegistrationFilters,
  registrationFiltersSummary,
  validateRegistrationFilters,
  type RegistrationFilters,
  type RosterMemberEligibility,
} from "@/lib/shared/registration-filters";

/**
 * Les conditions d'inscription d'un tournoi.
 *
 * Trois propriétés à défendre, et ce sont celles dont l'oubli casse quelque
 * chose de visible : le **défaut** (tout tournoi d'avant la migration en hérite),
 * le **tournoi individuel** (où l'effectif minimal n'a aucun sens et où le défaut
 * à 5 interdirait toute inscription), et le **roster vide** (qu'un `every`
 * laisserait passer). Voir `docs/features/REGISTRATION_FILTERS.md`.
 */

const filters = (overrides: Partial<RegistrationFilters> = {}): RegistrationFilters => ({
  ...DEFAULT_REGISTRATION_FILTERS,
  ...overrides,
});

const roster = (...verified: boolean[]): RosterMemberEligibility[] =>
  verified.map((discordVerified) => ({ discordVerified }));

describe("les défauts", () => {
  it("exigent un interlocuteur et un roster complet", () => {
    expect(DEFAULT_REGISTRATION_FILTERS).toEqual({
      discordRequirement: "ANY_PLAYER",
      minPlayers: 5,
    });
  });

  it("laissent passer une équipe de cinq dont un joueur est certifié", () => {
    expect(
      checkRegistrationFilters(filters(), roster(true, false, false, false, false)),
    ).toBeNull();
  });
});

describe("effectif minimal", () => {
  it("refuse en dessous, et nomme l'effectif", () => {
    expect(checkRegistrationFilters(filters(), roster(true, true, true, true))).toBe(
      "TEAM_TOO_FEW_PLAYERS",
    );
  });

  it("passe avant la condition Discord : c'est le plus urgent des deux", () => {
    // Reprocher un tag manquant à une équipe de deux joueurs enverrait corriger
    // le moins urgent des deux problèmes.
    expect(checkRegistrationFilters(filters(), roster(false, false))).toBe(
      "TEAM_TOO_FEW_PLAYERS",
    );
  });

  it("ne refuse rien à son plancher : « au moins un joueur » n'exclut personne", () => {
    expect(
      checkRegistrationFilters(
        filters({ discordRequirement: "NONE", minPlayers: MIN_PLAYERS_BOUNDS.min }),
        roster(false),
      ),
    ).toBeNull();
  });
});

describe("condition Discord", () => {
  it("NONE ne regarde aucun tag", () => {
    expect(
      checkRegistrationFilters(
        filters({ discordRequirement: "NONE" }),
        roster(false, false, false, false, false),
      ),
    ).toBeNull();
  });

  it("ANY_PLAYER exige un interlocuteur, un seul", () => {
    expect(
      checkRegistrationFilters(filters(), roster(false, false, false, false, false)),
    ).toBe("TEAM_NEEDS_VERIFIED_DISCORD");
    expect(
      checkRegistrationFilters(filters(), roster(false, false, false, false, true)),
    ).toBeNull();
  });

  it("ALL_PLAYERS refuse dès un seul tag non certifié", () => {
    const all = filters({ discordRequirement: "ALL_PLAYERS" });
    expect(checkRegistrationFilters(all, roster(true, true, true, true, false))).toBe(
      "TEAM_NEEDS_ALL_VERIFIED_DISCORD",
    );
    expect(checkRegistrationFilters(all, roster(true, true, true, true, true))).toBeNull();
  });

  it("refuse un roster vide sous ALL_PLAYERS, qu'un `every` laisserait passer", () => {
    // Un tableau vide satisfait `every` : sans la garde, un engagé sans personne
    // serait déclaré « tous certifiés ». En tournoi **par équipes** l'effectif
    // minimal l'écarte de toute façon — il est contrôlé en premier, et son
    // plancher vaut 1 —, si bien que le seul chemin qui atteint la garde est
    // l'engagé **solo** dont le joueur est introuvable.
    expect(
      checkRegistrationFilters(
        filters({ discordRequirement: "ALL_PLAYERS", minPlayers: 1 }),
        [],
      ),
    ).toBe("TEAM_TOO_FEW_PLAYERS");
    expect(
      checkRegistrationFilters(filters({ discordRequirement: "ALL_PLAYERS" }), [], true),
    ).toBe("TEAM_NEEDS_ALL_VERIFIED_DISCORD");
  });
});

describe("tournoi individuel", () => {
  it("ignore l'effectif minimal : un engagé y est une personne", () => {
    // Le cas qui casse tout si on l'oublie : le défaut à 5 interdirait toute
    // inscription à tout tournoi solo, sur un réglage que le formulaire ne
    // montre même pas.
    expect(checkRegistrationFilters(filters(), roster(true), true)).toBeNull();
  });

  it("applique la condition Discord telle quelle", () => {
    expect(checkRegistrationFilters(filters(), roster(false), true)).toBe(
      "TEAM_NEEDS_VERIFIED_DISCORD",
    );
    expect(
      checkRegistrationFilters(filters({ discordRequirement: "ALL_PLAYERS" }), roster(false), true),
    ).toBe("TEAM_NEEDS_ALL_VERIFIED_DISCORD");
  });

  it("refuse un joueur introuvable (roster vide) dès qu'un tag est exigé", () => {
    expect(checkRegistrationFilters(filters(), [], true)).toBe("TEAM_NEEDS_VERIFIED_DISCORD");
  });
});

describe("lecture d'une ligne SQL", () => {
  it("retombe sur les défauts pour une valeur illisible", () => {
    // Tolérance voulue : une ligne écrite avant ces colonnes ne doit pas rendre
    // un tournoi inscriptible par personne.
    expect(parseRegistrationFilters(undefined, undefined)).toEqual(DEFAULT_REGISTRATION_FILTERS);
    expect(parseRegistrationFilters("SOMETHING_ELSE", "nope")).toEqual(
      DEFAULT_REGISTRATION_FILTERS,
    );
    expect(parseRegistrationFilters(null, 0)).toEqual(DEFAULT_REGISTRATION_FILTERS);
  });

  it("garde les valeurs valides, y compris les bords", () => {
    expect(parseRegistrationFilters("NONE", MIN_PLAYERS_BOUNDS.min)).toEqual({
      discordRequirement: "NONE",
      minPlayers: MIN_PLAYERS_BOUNDS.min,
    });
    expect(parseRegistrationFilters("ALL_PLAYERS", MIN_PLAYERS_BOUNDS.max)).toEqual({
      discordRequirement: "ALL_PLAYERS",
      minPlayers: MIN_PLAYERS_BOUNDS.max,
    });
  });

  it("lit un nombre transmis en chaîne, comme mysql2 peut le rendre", () => {
    expect(parseRegistrationFilters("NONE", "7").minPlayers).toBe(7);
  });
});

describe("validation d'une saisie", () => {
  it("accepte l'absence : le défaut s'appliquera", () => {
    expect(validateRegistrationFilters(undefined, undefined)).toBeNull();
    expect(validateRegistrationFilters(null, null)).toBeNull();
  });

  it("refuse une exigence inconnue", () => {
    expect(validateRegistrationFilters("MOST_PLAYERS", 5)).toBe("INVALID_DISCORD_REQUIREMENT");
  });

  it("refuse un effectif hors bornes ou non entier", () => {
    for (const value of [0, -1, MIN_PLAYERS_BOUNDS.max + 1, 2.5, "cinq"]) {
      expect(validateRegistrationFilters("NONE", value)).toBe("INVALID_MIN_PLAYERS");
    }
  });

  it("refuse d'abord l'exigence, puis l'effectif", () => {
    // Deux erreurs à la fois : la première signalée est celle du premier champ
    // du formulaire, pour ne pas envoyer corriger en remontant.
    expect(validateRegistrationFilters("NOPE", 0)).toBe("INVALID_DISCORD_REQUIREMENT");
  });

  it("isValidMinPlayers et isDiscordRequirement se tiennent d'accord avec elle", () => {
    expect(isValidMinPlayers(5)).toBe(true);
    expect(isValidMinPlayers(0)).toBe(false);
    expect(isDiscordRequirement("ANY_PLAYER")).toBe(true);
    expect(isDiscordRequirement("any_player")).toBe(false);
    expect(isDiscordRequirement(3)).toBe(false);
  });
});

describe("résumé lisible", () => {
  it("rend null quand rien n'est exigé", () => {
    expect(
      registrationFiltersSummary({ discordRequirement: "NONE", minPlayers: 1 }),
    ).toBeNull();
  });

  it("nomme l'effectif et la condition Discord", () => {
    const summary = registrationFiltersSummary(filters());
    expect(summary).toContain("5 joueurs minimum");
    expect(summary).toContain("Discord vérifié");
  });

  it("retire l'effectif en individuel : l'annoncer serait faux", () => {
    const summary = registrationFiltersSummary(filters(), true);
    expect(summary).not.toContain("joueurs minimum");
    expect(summary).toContain("Discord vérifié");
  });

  it("ne mentionne pas un plancher qui n'exige rien", () => {
    expect(
      registrationFiltersSummary({ discordRequirement: "ANY_PLAYER", minPlayers: 1 }),
    ).not.toContain("minimum");
  });

  it("distingue « au moins un » de « tous »", () => {
    expect(registrationFiltersSummary(filters({ discordRequirement: "ANY_PLAYER" }))).toContain(
      "au moins un",
    );
    expect(registrationFiltersSummary(filters({ discordRequirement: "ALL_PLAYERS" }))).toContain(
      "tous",
    );
  });
});

describe("libellés", () => {
  it("couvrent les trois exigences, sans trou", () => {
    for (const requirement of ["NONE", "ANY_PLAYER", "ALL_PLAYERS"] as const) {
      expect(DISCORD_REQUIREMENT_LABELS[requirement].length).toBeGreaterThan(0);
    }
  });
});
