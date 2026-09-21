import { describe, expect, it } from "@jest/globals";
import {
  checkRegistrationFilters,
  DEFAULT_REGISTRATION_FILTERS,
  isPlayerRequirement,
  isRegistrationFilterError,
  isValidMinPlayers,
  MIN_PLAYERS_BOUNDS,
  parseRegistrationFilters,
  PLAYER_REQUIREMENTS,
  PLAYER_REQUIREMENT_LABELS,
  REGISTRATION_FILTER_ERRORS,
  registrationFiltersSummary,
  validateRegistrationFilters,
  type PlayerRequirement,
  type RegistrationFilters,
  type RosterMemberEligibility,
} from "@/lib/shared/registration-filters";

/**
 * Les conditions d'inscription d'un tournoi.
 *
 * Quatre propriétés à défendre, et ce sont celles dont l'oubli casse quelque
 * chose de visible : les **défauts** (tout tournoi d'avant la migration en
 * hérite — et le défaut Blizzard, `NONE`, est ce qui garantit qu'aucun tournoi
 * existant ne change de conditions), le **tournoi individuel** (où l'effectif
 * minimal n'a aucun sens et où le défaut à 5 interdirait toute inscription), le
 * **roster vide** (qu'un `every` laisserait passer), et l'**indépendance des
 * deux conditions de compte** — un tag Discord certifié ne dit rien d'un compte
 * Blizzard, et réciproquement. Voir `docs/features/REGISTRATION_FILTERS.md`.
 */

const filters = (overrides: Partial<RegistrationFilters> = {}): RegistrationFilters => ({
  ...DEFAULT_REGISTRATION_FILTERS,
  ...overrides,
});

/** Un roster où seule la certification Discord varie ; Blizzard partout rattaché. */
const roster = (...verified: boolean[]): RosterMemberEligibility[] =>
  verified.map((discordVerified) => ({ discordVerified, blizzardLinked: true }));

/** L'inverse : seul le rattachement Blizzard varie, tous les tags certifiés. */
const blizzardRoster = (...linked: boolean[]): RosterMemberEligibility[] =>
  linked.map((blizzardLinked) => ({ discordVerified: true, blizzardLinked }));

describe("les défauts", () => {
  it("exigent un interlocuteur et un roster complet, et rien du côté Blizzard", () => {
    // `blizzardRequirement: "NONE"` n'est pas une prudence de migration mais le
    // défaut du réglage : la moitié du site joue à Marvel Rivals, où un compte
    // Battle.net ne veut rien dire. C'est aussi ce qui garantit qu'aucun tournoi
    // d'avant ce réglage ne voit ses conditions changer.
    expect(DEFAULT_REGISTRATION_FILTERS).toEqual({
      discordRequirement: "ANY_PLAYER",
      blizzardRequirement: "NONE",
      minPlayers: 5,
    });
  });

  it("laissent passer une équipe de cinq dont un joueur est certifié", () => {
    expect(
      checkRegistrationFilters(filters(), roster(true, false, false, false, false)),
    ).toBeNull();
  });

  it("ne regardent aucun compte Blizzard", () => {
    expect(
      checkRegistrationFilters(filters(), [
        { discordVerified: true, blizzardLinked: false },
        { discordVerified: false, blizzardLinked: false },
        { discordVerified: false, blizzardLinked: false },
        { discordVerified: false, blizzardLinked: false },
        { discordVerified: false, blizzardLinked: false },
      ]),
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

describe("condition Blizzard", () => {
  const any = filters({ discordRequirement: "NONE", blizzardRequirement: "ANY_PLAYER" });
  const all = filters({ discordRequirement: "NONE", blizzardRequirement: "ALL_PLAYERS" });

  it("NONE ne regarde aucun compte", () => {
    expect(
      checkRegistrationFilters(
        filters({ discordRequirement: "NONE" }),
        blizzardRoster(false, false, false, false, false),
      ),
    ).toBeNull();
  });

  it("ANY_PLAYER exige un compte rattaché, un seul", () => {
    expect(checkRegistrationFilters(any, blizzardRoster(false, false, false, false, false))).toBe(
      "TEAM_NEEDS_LINKED_BLIZZARD",
    );
    expect(
      checkRegistrationFilters(any, blizzardRoster(false, false, false, false, true)),
    ).toBeNull();
  });

  it("ALL_PLAYERS refuse dès un seul compte non rattaché", () => {
    expect(checkRegistrationFilters(all, blizzardRoster(true, true, true, true, false))).toBe(
      "TEAM_NEEDS_ALL_LINKED_BLIZZARD",
    );
    expect(checkRegistrationFilters(all, blizzardRoster(true, true, true, true, true))).toBeNull();
  });

  it("refuse un roster vide sous ALL_PLAYERS, comme la condition Discord", () => {
    expect(checkRegistrationFilters(all, [], true)).toBe("TEAM_NEEDS_ALL_LINKED_BLIZZARD");
  });

  it("est indépendante de la certification Discord", () => {
    // Le cas qui compte : une équipe entièrement certifiée côté Discord et sans
    // aucun compte Blizzard. Si les deux conditions lisaient le même drapeau —
    // ou si l'une écrasait l'autre — ce refus n'arriverait jamais.
    expect(
      checkRegistrationFilters(
        filters({ discordRequirement: "ALL_PLAYERS", blizzardRequirement: "ALL_PLAYERS" }),
        blizzardRoster(true, true, true, true, false),
      ),
    ).toBe("TEAM_NEEDS_ALL_LINKED_BLIZZARD");
    // Et la réciproque : Blizzard partout, Discord nulle part.
    expect(
      checkRegistrationFilters(
        filters({ discordRequirement: "ALL_PLAYERS", blizzardRequirement: "ALL_PLAYERS" }),
        roster(true, true, true, true, false),
      ),
    ).toBe("TEAM_NEEDS_ALL_VERIFIED_DISCORD");
  });

  it("passe après la condition Discord : c'est la moins urgente des deux", () => {
    // Les deux manquent en même temps. Le refus annoncé est celui sans lequel
    // l'arbitrage ne peut joindre personne, pas celui de l'éligibilité au jeu.
    expect(
      checkRegistrationFilters(
        filters({ discordRequirement: "ANY_PLAYER", blizzardRequirement: "ANY_PLAYER" }),
        [
          { discordVerified: false, blizzardLinked: false },
          { discordVerified: false, blizzardLinked: false },
          { discordVerified: false, blizzardLinked: false },
          { discordVerified: false, blizzardLinked: false },
          { discordVerified: false, blizzardLinked: false },
        ],
      ),
    ).toBe("TEAM_NEEDS_VERIFIED_DISCORD");
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

  it("applique la condition Blizzard telle quelle", () => {
    const solo = filters({ discordRequirement: "NONE", blizzardRequirement: "ANY_PLAYER" });
    expect(checkRegistrationFilters(solo, blizzardRoster(false), true)).toBe(
      "TEAM_NEEDS_LINKED_BLIZZARD",
    );
    expect(checkRegistrationFilters(solo, blizzardRoster(true), true)).toBeNull();
  });

  it("refuse un joueur introuvable (roster vide) dès qu'un tag est exigé", () => {
    expect(checkRegistrationFilters(filters(), [], true)).toBe("TEAM_NEEDS_VERIFIED_DISCORD");
  });
});

describe("lecture d'une ligne SQL", () => {
  it("retombe sur les défauts pour une valeur illisible", () => {
    // Tolérance voulue : une ligne écrite avant ces colonnes ne doit pas rendre
    // un tournoi inscriptible par personne.
    expect(parseRegistrationFilters(undefined, undefined, undefined)).toEqual(
      DEFAULT_REGISTRATION_FILTERS,
    );
    expect(parseRegistrationFilters("SOMETHING_ELSE", "nope", "NEVER")).toEqual(
      DEFAULT_REGISTRATION_FILTERS,
    );
    expect(parseRegistrationFilters(null, 0, null)).toEqual(DEFAULT_REGISTRATION_FILTERS);
  });

  it("garde les valeurs valides, y compris les bords", () => {
    expect(parseRegistrationFilters("NONE", MIN_PLAYERS_BOUNDS.min, "ANY_PLAYER")).toEqual({
      discordRequirement: "NONE",
      blizzardRequirement: "ANY_PLAYER",
      minPlayers: MIN_PLAYERS_BOUNDS.min,
    });
    expect(parseRegistrationFilters("ALL_PLAYERS", MIN_PLAYERS_BOUNDS.max, "ALL_PLAYERS")).toEqual({
      discordRequirement: "ALL_PLAYERS",
      blizzardRequirement: "ALL_PLAYERS",
      minPlayers: MIN_PLAYERS_BOUNDS.max,
    });
  });

  it("lit un nombre transmis en chaîne, comme mysql2 peut le rendre", () => {
    expect(parseRegistrationFilters("NONE", "7", "NONE").minPlayers).toBe(7);
  });

  it("ne confond pas les deux exigences : chacune lit son argument", () => {
    // Les deux partagent leur type et leurs trois valeurs : une inversion
    // d'arguments passerait tous les contrôles de forme sans rien dire.
    expect(parseRegistrationFilters("ALL_PLAYERS", 5, "NONE")).toEqual({
      discordRequirement: "ALL_PLAYERS",
      blizzardRequirement: "NONE",
      minPlayers: 5,
    });
  });
});

describe("validation d'une saisie", () => {
  it("accepte l'absence : le défaut s'appliquera", () => {
    expect(validateRegistrationFilters(undefined, undefined, undefined)).toBeNull();
    expect(validateRegistrationFilters(null, null, null)).toBeNull();
  });

  it("refuse une exigence inconnue, de chaque côté", () => {
    expect(validateRegistrationFilters("MOST_PLAYERS", 5, "NONE")).toBe(
      "INVALID_DISCORD_REQUIREMENT",
    );
    expect(validateRegistrationFilters("NONE", 5, "MOST_PLAYERS")).toBe(
      "INVALID_BLIZZARD_REQUIREMENT",
    );
  });

  it("refuse un effectif hors bornes ou non entier", () => {
    for (const value of [0, -1, MIN_PLAYERS_BOUNDS.max + 1, 2.5, "cinq"]) {
      expect(validateRegistrationFilters("NONE", value, "NONE")).toBe("INVALID_MIN_PLAYERS");
    }
  });

  it("refuse d'abord l'exigence, puis l'effectif", () => {
    // Trois erreurs à la fois : la première signalée est celle du premier champ
    // du formulaire, pour ne pas envoyer corriger en remontant.
    expect(validateRegistrationFilters("NOPE", 0, "NOPE")).toBe("INVALID_DISCORD_REQUIREMENT");
    expect(validateRegistrationFilters("NONE", 0, "NOPE")).toBe("INVALID_BLIZZARD_REQUIREMENT");
  });

  it("isValidMinPlayers et isPlayerRequirement se tiennent d'accord avec elle", () => {
    expect(isValidMinPlayers(5)).toBe(true);
    expect(isValidMinPlayers(0)).toBe(false);
    expect(isPlayerRequirement("ANY_PLAYER")).toBe(true);
    expect(isPlayerRequirement("any_player")).toBe(false);
    expect(isPlayerRequirement(3)).toBe(false);
  });
});

describe("résumé lisible", () => {
  it("rend null quand rien n'est exigé", () => {
    expect(
      registrationFiltersSummary({
        discordRequirement: "NONE",
        blizzardRequirement: "NONE",
        minPlayers: 1,
      }),
    ).toBeNull();
  });

  it("nomme l'effectif et la condition Discord", () => {
    const summary = registrationFiltersSummary(filters());
    expect(summary).toContain("5 joueurs minimum");
    expect(summary).toContain("Discord vérifié");
  });

  it("nomme la condition Blizzard, et ne l'invente pas quand elle est NONE", () => {
    expect(
      registrationFiltersSummary(filters({ blizzardRequirement: "ALL_PLAYERS" })),
    ).toContain("comptes Blizzard liés");
    expect(registrationFiltersSummary(filters())).not.toContain("Blizzard");
  });

  it("retire l'effectif en individuel : l'annoncer serait faux", () => {
    const summary = registrationFiltersSummary(
      filters({ blizzardRequirement: "ANY_PLAYER" }),
      true,
    );
    expect(summary).not.toContain("joueurs minimum");
    expect(summary).toContain("Discord vérifié");
    // Au singulier : « au moins un » n'a pas de sens sur un engagé qui est une
    // personne.
    expect(summary).toContain("compte Blizzard lié");
    expect(summary).not.toContain("au moins un");
  });

  it("ne mentionne pas un plancher qui n'exige rien", () => {
    expect(
      registrationFiltersSummary({
        discordRequirement: "ANY_PLAYER",
        blizzardRequirement: "NONE",
        minPlayers: 1,
      }),
    ).not.toContain("minimum");
  });

  it("distingue « au moins un » de « tous », des deux côtés", () => {
    expect(registrationFiltersSummary(filters({ discordRequirement: "ANY_PLAYER" }))).toContain(
      "au moins un",
    );
    expect(registrationFiltersSummary(filters({ discordRequirement: "ALL_PLAYERS" }))).toContain(
      "tous",
    );
    expect(
      registrationFiltersSummary(
        filters({ discordRequirement: "NONE", blizzardRequirement: "ANY_PLAYER" }),
      ),
    ).toContain("au moins un compte Blizzard");
    expect(
      registrationFiltersSummary(
        filters({ discordRequirement: "NONE", blizzardRequirement: "ALL_PLAYERS" }),
      ),
    ).toContain("tous les comptes Blizzard");
  });

  it("énumère les trois conditions quand elles sont toutes posées", () => {
    const summary = registrationFiltersSummary(
      filters({ discordRequirement: "ALL_PLAYERS", blizzardRequirement: "ALL_PLAYERS" }),
    );
    expect(summary).toBe(
      "5 joueurs minimum · tous les Discord vérifiés · tous les comptes Blizzard liés",
    );
  });
});

describe("libellés", () => {
  it("couvrent les trois exigences, sans trou", () => {
    for (const requirement of PLAYER_REQUIREMENTS) {
      expect(PLAYER_REQUIREMENT_LABELS[requirement].length).toBeGreaterThan(0);
    }
  });

  it("proposent les trois valeurs, et seulement elles", () => {
    expect([...PLAYER_REQUIREMENTS].sort()).toEqual(
      (["ALL_PLAYERS", "ANY_PLAYER", "NONE"] as PlayerRequirement[]).sort(),
    );
  });
});

describe("les refus, énumérés", () => {
  it("reconnaissent chacun des codes du module", () => {
    // La route d'inscription rend un 409 sur ce prédicat, et plus sur une liste
    // recopiée : un code ajouté au module sans l'être là-bas serait ressorti en
    // 500, sur un refus parfaitement prévu.
    for (const code of REGISTRATION_FILTER_ERRORS) {
      expect(isRegistrationFilterError(code)).toBe(true);
    }
  });

  it("ne reconnaissent rien d'autre", () => {
    for (const value of ["NO_ACTIVE_TEAM", "TEAM_TOO_FEW", "", 42, null, undefined]) {
      expect(isRegistrationFilterError(value)).toBe(false);
    }
  });

  it("contiennent tout ce que `checkRegistrationFilters` peut rendre", () => {
    // Chaque refus produit réellement par la règle doit figurer dans la liste :
    // c'est elle qui décide du statut HTTP.
    const produced = [
      checkRegistrationFilters(filters(), roster(true)),
      checkRegistrationFilters(filters(), roster(false, false, false, false, false)),
      checkRegistrationFilters(
        filters({ discordRequirement: "ALL_PLAYERS", minPlayers: 1 }),
        roster(false),
      ),
      checkRegistrationFilters(
        filters({ discordRequirement: "NONE", blizzardRequirement: "ANY_PLAYER", minPlayers: 1 }),
        blizzardRoster(false),
      ),
      checkRegistrationFilters(
        filters({ discordRequirement: "NONE", blizzardRequirement: "ALL_PLAYERS", minPlayers: 1 }),
        blizzardRoster(false),
      ),
    ].filter((code): code is NonNullable<typeof code> => code !== null);

    expect([...new Set(produced)].sort()).toEqual([...REGISTRATION_FILTER_ERRORS].sort());
  });
});
