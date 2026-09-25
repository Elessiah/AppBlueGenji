import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";
import {
  ERROR_MESSAGES,
  mapBatchError,
  mapEntrantError,
  mapError,
  UNKNOWN_ERROR_MESSAGE,
} from "@/app/(secured)/tournois/[id]/_lib/error-map";
import { phaseErrorMessage } from "@/app/(secured)/tournois/creer/phase-form";
import { PHASE_ERROR_CODES } from "@/lib/server/tournaments/validation";
import { REGISTRATION_FILTER_ERRORS } from "@/lib/shared/registration-filters";
import { PHASE_ERROR_MESSAGES } from "@/lib/shared/tournament-phases";

/**
 * Les codes que le serveur renvoie réellement doivent tous avoir une phrase
 * française : `mapError` retombe sinon sur le code brut, qui finit tel quel
 * dans le toast.
 */
describe("mapError — inscription", () => {
  it.each([
    ["ALREADY_REGISTERED"],
    ["REGISTRATION_CLOSED"],
    ["TOURNAMENT_FULL"],
    ["NO_ACTIVE_TEAM"],
    ["SOLO_ENTRY_NAME_UNAVAILABLE"],
    ["USER_NOT_FOUND"],
  ])("traduit %s", (code) => {
    const message = mapError(code);
    expect(message).not.toBe(code);
    expect(message).toMatch(/[a-zà-ÿ]/);
  });

});

/**
 * Le repli. Un code que la table ignore s'affichait **tel quel** dans la
 * notification : c'est ce qui a laissé passer des refus de la création d'un
 * tournoi en capitales. Il retombe désormais sur une phrase générique — mais
 * seulement un code : les appelants passent `error.message`, qui porte parfois
 * déjà une phrase.
 */
describe("mapError — repli", () => {
  it.each([["WAT"], ["SOME_NEW_REFUSAL"], ["ERR_42"]])(
    "rend une phrase générique pour le code inconnu %s",
    (code) => {
      expect(mapError(code)).toBe(UNKNOWN_ERROR_MESSAGE);
      expect(mapError(code)).not.toContain(code);
    },
  );

  it.each([["constructor"], ["toString"], ["__proto__"], ["hasOwnProperty"]])(
    "ne remonte pas la chaîne de prototypes pour %s",
    (key) => {
      expect(typeof mapError(key)).toBe("string");
      expect(mapError(key)).toBe(key);
      expect(phaseErrorMessage(key)).toBe("Erreur de configuration des phases.");
    },
  );

  it("laisse passer une phrase déjà rédigée", () => {
    const sentence = "Tournoi créé, mais son image n'a pas été enregistrée.";
    expect(mapError(sentence)).toBe(sentence);
  });

  it("laisse passer un échec réseau du navigateur, qui n'est pas un code", () => {
    expect(mapError("Failed to fetch")).toBe("Failed to fetch");
  });

  it("ne transforme pas une chaîne vide en phrase d'erreur", () => {
    // `page.tsx` rend `mapError(rollbackRefusal ?? "")` dans un paragraphe
    // d'aide : sans refus, rien ne doit s'y écrire.
    expect(mapError("")).toBe("");
  });

  it("ne confond pas un code minuscule avec un code du serveur", () => {
    expect(mapError("invalid_format")).toBe("invalid_format");
  });

  it("ne promet pas qu'un nouvel essai aboutira", () => {
    // Un code inconnu peut être un refus déterministe : « réessaie » enverrait
    // refaire le même geste pour le même refus.
    expect(UNKNOWN_ERROR_MESSAGE).not.toMatch(/réessaie/i);
  });

  it("est rédigée en français et ne ressemble à aucun code", () => {
    expect(UNKNOWN_ERROR_MESSAGE).toMatch(/[a-zà-ÿ]/);
    expect(Object.values(ERROR_MESSAGES)).not.toContain(UNKNOWN_ERROR_MESSAGE);
  });
});

/**
 * Refus de la création et de l'édition d'un tournoi.
 *
 * Les codes sont relevés **dans les sources** de la validation plutôt que
 * recopiés ici : un refus ajouté demain à `validateTournamentInput`, à
 * `validatePhases` ou aux conditions d'inscription sans sa phrase fait échouer
 * ce test, au lieu de retomber sur la formule générique.
 */
describe("mapError — refus du formulaire de tournoi", () => {
  const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

  // `issue(` : `findPhaseIssue` rend ses refus situés par un constructeur.
  const REFUSAL_PATTERN = /(?:error: |code: |return |issue\(|fail\(|new Error\(\s*)"([A-Z][A-Z0-9_]+)"/g;

  function codesIn(source: string, pattern: RegExp = REFUSAL_PATTERN): string[] {
    const found = new Set<string>();
    for (const match of source.matchAll(pattern)) {
      found.add(match[1]);
    }
    return [...found];
  }

  const validation = codesIn(read("lib/server/tournaments/validation.ts"));
  const phases = codesIn(read("lib/shared/tournament-phases.ts"));
  const filters = codesIn(read("lib/shared/registration-filters.ts")).filter((code) =>
    code.startsWith("INVALID_"),
  );
  // Ce que l'édition et les deux routes ajoutent au-dessus de la validation :
  // fenêtre d'édition, identifiant, session, échec générique.
  const routes = [
    ...[
      "lib/server/tournaments/edit.ts",
      "app/api/tournaments/route.ts",
      "app/api/tournaments/[id]/edit/route.ts",
    ].flatMap((file) => codesIn(read(file))),
    // Le module pur rend aussi des **noms de fenêtre** (`return "LOCKED"`), qui
    // ne sortent jamais vers l'interface : seuls ses `code:` sont des refus.
    ...codesIn(read("lib/shared/tournament-edit.ts"), /code: "([A-Z][A-Z0-9_]+)"/g),
  ];

  it("relève bien des codes dans chaque source", () => {
    // Garde du balayage lui-même : une expression qui ne trouverait plus rien
    // rendrait les assertions suivantes vides, donc vertes.
    expect(validation).toEqual(
      expect.arrayContaining(["MISSING_NAME", "INVALID_FORMAT", "INVALID_SWISS_POINTS"]),
    );
    expect(phases).toEqual(expect.arrayContaining(["INVALID_PHASE_COUNT"]));
    expect(filters).toEqual(expect.arrayContaining(["INVALID_MIN_PLAYERS"]));
    expect(routes).toEqual(
      expect.arrayContaining(["TOURNAMENT_LOCKED", "EMPTY_PATCH", "MAX_TEAMS_CANNOT_DECREASE"]),
    );
  });

  it.each([...new Set([...validation, ...phases, ...filters, ...routes, ...PHASE_ERROR_CODES])].map((c) => [c]))(
    "traduit %s",
    (code) => {
      const message = mapError(code);
      expect(message).not.toBe(UNKNOWN_ERROR_MESSAGE);
      expect(message).not.toContain(code);
    },
  );

  it("nomme les deux jeux proposés", () => {
    expect(mapError("INVALID_GAME")).toMatch(/Overwatch/);
    expect(mapError("INVALID_GAME")).toMatch(/Marvel Rivals/);
  });

  it("dit la règle du barème suisse, et non un simple « invalide »", () => {
    expect(mapError("INVALID_SWISS_POINTS")).toMatch(/victoire/);
    expect(mapError("INVALID_SWISS_POINTS")).toMatch(/nul/);
  });

  it("dit la règle telle qu'elle s'applique : nombre fixe seulement, jamais le pourcentage", () => {
    // Le pourcentage n'est jamais comparé (son assiette rétrécit d'une phase à
    // l'autre — 80 % après 50 % qualifie moins d'engagés, pas plus), ni la
    // dernière phase (sa cible n'est jamais lue) : la phrase ne doit donc plus
    // parler de pourcentage, et coïncide avec celle du contrôle strict.
    const message = mapError("INVALID_QUALIFIER_COUNT");
    expect(message).not.toMatch(/pourcentage/);
    expect(message).toBe(mapError("NON_DECREASING_PHASE_QUALIFIERS"));
  });

  it("nomme la première coupe dans la cadence de survie, que le code couvre aussi en phase", () => {
    expect(mapError("INVALID_SURVIVAL_ROUNDS")).toMatch(/première/);
  });

  it("distingue la cadence de survie de sa première coupe", () => {
    expect(mapError("INVALID_SURVIVAL_ROUNDS")).not.toBe(mapError("INVALID_SURVIVAL_FIRST_CUT"));
  });

  it("formule les codes partagés tournoi / phase sans parler d'une phase", () => {
    // `INVALID_SWISS_ROUNDS` et `INVALID_SURVIVAL_ROUNDS` sortent aussi pour un
    // tournoi sans phases : une phrase qui parlerait de phase y serait fausse.
    expect(mapError("INVALID_SWISS_ROUNDS")).not.toMatch(/phase/i);
    expect(mapError("INVALID_SURVIVAL_ROUNDS")).not.toMatch(/phase/i);
  });
});

/**
 * Une phrase par code : le formulaire (`phaseErrorMessage`, contrôle local) et
 * la notification (`mapError`, refus du serveur) lisent la même table.
 */
describe("plan de phases — une seule table", () => {
  it.each(Object.keys(PHASE_ERROR_MESSAGES).map((code) => [code]))(
    "donne la même phrase au formulaire et à la notification pour %s",
    (code) => {
      expect(mapError(code)).toBe(phaseErrorMessage(code));
    },
  );
});

/**
 * Régression : une fusion mal résolue avait transformé les entrées
 * `TOURNAMENT_DELETE_FAILED` / `INVALID_TOURNAMENT_ID` / `INVALID_ID` en
 * commentaire, les faisant disparaître silencieusement de la table sans
 * qu'aucun test ni le typage ne s'en aperçoive.
 */
describe("mapError — suppression et identifiants invalides", () => {
  it.each([
    ["TOURNAMENT_DELETE_FAILED"],
    ["INVALID_TOURNAMENT_ID"],
    ["INVALID_ID"],
  ])("traduit %s", (code) => {
    const message = mapError(code);
    expect(message).not.toBe(code);
    expect(message.length).toBeGreaterThan(0);
  });
});

/**
 * Garde-fou générique : le bug ci-dessus n'était pas propre à ces trois
 * codes — n'importe quelle entrée peut être avalée par un commentaire lors
 * d'une future fusion. On vérifie donc que chaque clé réellement exposée par
 * le module se traduit bien (aucune clé ne « retombe » sur elle-même) et que
 * le nombre d'entrées n'a pas chuté.
 */
describe("mapError — intégrité de la table", () => {
  const codes = Object.keys(ERROR_MESSAGES);

  it("ne contient pas moins d'entrées qu'attendu", () => {
    expect(codes.length).toBeGreaterThanOrEqual(45);
  });

  it.each(codes.map((code) => [code]))("traduit %s sans le renvoyer tel quel", (code) => {
    expect(mapError(code)).not.toBe(code);
  });
});

describe("mapError — inscription en lot d'engagés sans compte", () => {
  it.each([
    ["EMPTY_TEAM_SELECTION"],
    ["INVALID_TEAM_IDS"],
    ["TOO_MANY_TEAMS"],
    ["NOT_A_GHOST_TEAM"],
    ["TEAM_ALREADY_DELETED"],
    ["TEAM_NOT_FOUND"],
    ["GHOST_TEAMS_LOAD_FAILED"],
    ["GHOST_TEAM_CREATE_FAILED"],
    ["GHOST_REGISTRATION_FAILED"],
  ])("traduit %s", (code) => {
    expect(mapError(code)).not.toBe(code);
  });

});

describe("mapBatchError", () => {
  it("dit qu'un lot refusé n'a rien enregistré", () => {
    // Le tout-ou-rien doit se lire dans la phrase : sans cette précision, le
    // staff ne sait pas s'il doit reprendre toute sa sélection ou seulement la
    // fin. Ces mêmes codes servent aussi à l'inscription d'un seul, d'où la
    // précision ajoutée ici et non dans la table.
    for (const code of ["TOURNAMENT_FULL", "ALREADY_REGISTERED", "REGISTRATION_CLOSED"]) {
      expect(mapBatchError(code, null, 25)).toBe(`${mapError(code)} Rien n'a été enregistré.`);
    }
  });

  it("se tait sur un lot d'un seul, où la précision n'apprend rien", () => {
    expect(mapBatchError("TOURNAMENT_FULL", null, 1)).toBe(mapError("TOURNAMENT_FULL"));
    expect(mapBatchError("TOURNAMENT_FULL", null, 0)).toBe(mapError("TOURNAMENT_FULL"));
  });

  it("nomme l'engagé et précise, quand le refus fait les deux", () => {
    expect(mapBatchError("ALREADY_REGISTERED", "Alpha", 4)).toBe(
      `Alpha — ${mapError("ALREADY_REGISTERED")} Rien n'a été enregistré.`,
    );
  });
});

describe("mapEntrantError", () => {
  it("met le nom de l'engagé en tête du message", () => {
    expect(mapEntrantError("ALREADY_REGISTERED", "Les Fantômes")).toBe(
      `Les Fantômes — ${mapError("ALREADY_REGISTERED")}`,
    );
  });

  it("retombe sur le message seul quand le refus ne nomme personne", () => {
    expect(mapEntrantError("TOURNAMENT_FULL", null)).toBe(mapError("TOURNAMENT_FULL"));
  });

  it("traduit toujours le code, nom ou pas", () => {
    expect(mapEntrantError("REGISTRATION_CLOSED", "Alpha")).not.toContain("REGISTRATION_CLOSED");
  });
});

/**
 * Les refus des conditions d'inscription.
 *
 * Cinq codes, cinq messages distincts : chacun doit nommer **le geste qui le
 * lève** (recruter, certifier un tag, rattacher un compte Blizzard), faute de
 * quoi le capitaine ne sait pas laquelle des trois conditions a bloqué.
 *
 * `mapError` rend le code lui-même quand il ne le connaît pas : un refus oublié
 * ici ne casse rien, il s'affiche en capitales dans un toast. D'où le balayage
 * de `REGISTRATION_FILTER_ERRORS`, qui ferme le cas pour tout refus ajouté
 * demain.
 */
describe("conditions d'inscription", () => {
  it("dit de recruter quand l'effectif manque", () => {
    expect(mapError("TEAM_TOO_FEW_PLAYERS")).toMatch(/recrute/i);
  });

  it("distingue « au moins un » de « tous », et renvoie au profil", () => {
    const any = mapError("TEAM_NEEDS_VERIFIED_DISCORD");
    const all = mapError("TEAM_NEEDS_ALL_VERIFIED_DISCORD");

    expect(any).toMatch(/au moins un/i);
    expect(all).toMatch(/tous/i);
    expect(any).not.toBe(all);
    for (const message of [any, all]) {
      // Le geste se fait sur sa fiche de profil : le message doit y mener.
      expect(message).toMatch(/profil/i);
    }
  });

  it("distingue les deux refus Blizzard, et renvoie au profil", () => {
    const any = mapError("TEAM_NEEDS_LINKED_BLIZZARD");
    const all = mapError("TEAM_NEEDS_ALL_LINKED_BLIZZARD");

    expect(any).toMatch(/au moins un/i);
    expect(all).toMatch(/tous/i);
    expect(any).not.toBe(all);
    for (const message of [any, all]) {
      expect(message).toMatch(/blizzard/i);
      expect(message).toMatch(/profil/i);
    }
  });

  it("ne confond pas un refus Discord avec un refus Blizzard", () => {
    // Les quatre messages se ressemblent par construction (« au moins un » /
    // « tous ») : ce qui les sépare est le geste, et il doit se lire.
    expect(mapError("TEAM_NEEDS_VERIFIED_DISCORD")).not.toMatch(/blizzard/i);
    expect(mapError("TEAM_NEEDS_ALL_VERIFIED_DISCORD")).not.toMatch(/blizzard/i);
    expect(mapError("TEAM_NEEDS_LINKED_BLIZZARD")).not.toMatch(/discord/i);
    expect(mapError("TEAM_NEEDS_ALL_LINKED_BLIZZARD")).not.toMatch(/discord/i);
  });

  it("traduit chaque refus que le module pur peut rendre", () => {
    for (const code of REGISTRATION_FILTER_ERRORS) {
      expect(mapError(code)).not.toContain(code);
    }
  });

  it("ne laisse sortir aucun code brut", () => {
    for (const code of [
      "TEAM_TOO_FEW_PLAYERS",
      "TEAM_NEEDS_VERIFIED_DISCORD",
      "TEAM_NEEDS_ALL_VERIFIED_DISCORD",
      "TEAM_NEEDS_LINKED_BLIZZARD",
      "TEAM_NEEDS_ALL_LINKED_BLIZZARD",
      "INVALID_DISCORD_REQUIREMENT",
      "INVALID_BLIZZARD_REQUIREMENT",
      "INVALID_MIN_PLAYERS",
    ]) {
      expect(mapError(code)).not.toContain(code);
    }
  });
});

/**
 * Les deux refus du panneau de contacts.
 *
 * `mapError` rend le code lui-même quand il ne le connaît pas, si bien qu'un
 * refus oublié ici ne casse rien : il s'affiche en capitales dans un toast. Les
 * **deux** refus de `GET /api/admin/tournaments/[id]/contacts` doivent donc y
 * figurer — le second (`TOURNAMENT_FINISHED`) est atteignable même si le panneau
 * n'est pas rendu sur un tournoi clos, la clôture pouvant tomber entre le rendu
 * et le clic.
 */
describe("contacts d'un plateau", () => {
  it("traduit les deux refus de la route, sans laisser sortir leur code", () => {
    for (const code of ["CONTACTS_LOAD_FAILED", "TOURNAMENT_FINISHED"]) {
      const message = mapError(code);
      expect(message).not.toContain(code);
      expect(message).not.toBe(code);
    }
  });

  it("dit que le tournoi est terminé, et non qu'un droit manque", () => {
    // Le refus n'est pas une question de permission : l'arbitre a bien le droit,
    // c'est la fenêtre qui s'est fermée. Un « tu n'as pas les droits » l'enverrait
    // demander un rôle qu'il détient déjà.
    expect(mapError("TOURNAMENT_FINISHED")).toMatch(/termin/i);
    expect(mapError("TOURNAMENT_FINISHED")).not.toMatch(/droit/i);
  });
});
