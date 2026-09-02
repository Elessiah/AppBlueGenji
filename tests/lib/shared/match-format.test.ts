import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_MATCH_FORMAT,
  checkMatchScores,
  isValidMatchFormat,
  matchFormatDescription,
  matchFormatLabel,
  MATCH_FORMAT_BOUNDS,
  matchMaxMaps,
  matchScoreViolationMessage,
  matchWinsRequired,
  parseMatchFormat,
  type MatchFormat,
} from "@/lib/shared/match-format";

const BO5: MatchFormat = { type: "BO", value: 5 };
const FT3: MatchFormat = { type: "FT", value: 3 };

describe("match-format — validation d'un format", () => {
  it("accepte les Best of impairs et les First to", () => {
    expect(isValidMatchFormat("BO", 1)).toBe(true);
    expect(isValidMatchFormat("BO", 5)).toBe(true);
    expect(isValidMatchFormat("FT", 3)).toBe(true);
    expect(isValidMatchFormat("FT", 4)).toBe(true);
  });

  it("refuse un Best of pair — 2-2 ne désignerait aucun vainqueur", () => {
    expect(isValidMatchFormat("BO", 4)).toBe(false);
    expect(isValidMatchFormat("BO", 2)).toBe(false);
  });

  it("refuse les valeurs hors bornes, non entières ou d'un type inconnu", () => {
    expect(isValidMatchFormat("BO", 0)).toBe(false);
    expect(isValidMatchFormat("BO", 17)).toBe(false);
    expect(isValidMatchFormat("FT", 11)).toBe(false);
    expect(isValidMatchFormat("FT", 2.5)).toBe(false);
    expect(isValidMatchFormat("RACE", 3)).toBe(false);
  });

  it("valide le format proposé par défaut à la création", () => {
    expect(isValidMatchFormat(DEFAULT_MATCH_FORMAT.type, DEFAULT_MATCH_FORMAT.value)).toBe(true);
  });

  it("refuse ce qui n'est pas un nombre, sans le coercer", () => {
    expect(isValidMatchFormat("BO", true)).toBe(false);
    expect(isValidMatchFormat("BO", [3])).toBe(false);
    expect(isValidMatchFormat("BO", {})).toBe(false);
    expect(isValidMatchFormat("BO", "")).toBe(false);
    expect(isValidMatchFormat("BO", "  ")).toBe(false);
    // Une colonne de base peut renvoyer la valeur en chaîne : elle reste valide.
    expect(isValidMatchFormat("BO", "5")).toBe(true);
  });
});

describe("match-format — parseMatchFormat", () => {
  it("relit un couple valide", () => {
    expect(parseMatchFormat("BO", 5)).toEqual(BO5);
    expect(parseMatchFormat("FT", "3")).toEqual(FT3);
  });

  it("retombe sur la saisie libre quand une des deux colonnes manque", () => {
    expect(parseMatchFormat(null, null)).toBeNull();
    expect(parseMatchFormat("BO", null)).toBeNull();
    expect(parseMatchFormat(null, 5)).toBeNull();
    expect(parseMatchFormat(undefined, undefined)).toBeNull();
  });

  it("retombe sur la saisie libre plutôt que d'accepter un format incohérent", () => {
    expect(parseMatchFormat("BO", 4)).toBeNull();
    expect(parseMatchFormat("BO", 99)).toBeNull();
  });
});

describe("match-format — grandeurs dérivées", () => {
  it("BO5 et FT3 décrivent la même course : 3 manches à gagner, 5 au maximum", () => {
    expect(matchWinsRequired(BO5)).toBe(3);
    expect(matchWinsRequired(FT3)).toBe(3);
    expect(matchMaxMaps(BO5)).toBe(5);
    expect(matchMaxMaps(FT3)).toBe(5);
  });

  it("calcule l'objectif des autres cadences", () => {
    expect(matchWinsRequired({ type: "BO", value: 1 })).toBe(1);
    expect(matchWinsRequired({ type: "BO", value: 3 })).toBe(2);
    expect(matchWinsRequired({ type: "BO", value: 7 })).toBe(4);
    expect(matchWinsRequired({ type: "FT", value: 2 })).toBe(2);
    expect(matchMaxMaps({ type: "BO", value: 7 })).toBe(7);
    expect(matchMaxMaps({ type: "FT", value: 2 })).toBe(3);
  });

  it("étiquette les formats et la saisie libre", () => {
    expect(matchFormatLabel(BO5)).toBe("BO5");
    expect(matchFormatLabel(FT3)).toBe("FT3");
    expect(matchFormatLabel(null)).toBe("Score libre");
  });

  it("décrit la course sans répéter la notation — identique en BO5 et FT3", () => {
    expect(matchFormatDescription(BO5)).toContain("3 manches");
    expect(matchFormatDescription(BO5)).toContain("5 au maximum");
    expect(matchFormatDescription(FT3)).toBe(matchFormatDescription(BO5));
    expect(matchFormatDescription({ type: "BO", value: 1 })).toContain("1 manche gagnée");
    expect(matchFormatDescription(null)).toBe("Aucune limite de score.");
  });
});

describe("match-format — contrôle des scores", () => {
  it("laisse tout passer quand le tournoi est en saisie libre", () => {
    expect(checkMatchScores(null, 42, 7, { decisive: true })).toBeNull();
  });

  it("accepte un score complet en BO5", () => {
    for (const [a, b] of [
      [3, 0],
      [3, 1],
      [3, 2],
      [0, 3],
      [2, 3],
    ]) {
      expect(checkMatchScores(BO5, a, b, { decisive: true })).toBeNull();
    }
  });

  it("refuse un score au-dessus de l'objectif", () => {
    expect(checkMatchScores(BO5, 4, 1, { decisive: true })).toBe("SCORE_EXCEEDS_MATCH_FORMAT");
    expect(checkMatchScores(BO5, 1, 5, { decisive: false })).toBe("SCORE_EXCEEDS_MATCH_FORMAT");
    expect(checkMatchScores(FT3, 4, 0, { decisive: true })).toBe("SCORE_EXCEEDS_MATCH_FORMAT");
  });

  it("refuse deux vainqueurs (3-3 en BO5 : 6 manches pour 5 jouables)", () => {
    expect(checkMatchScores(BO5, 3, 3, { decisive: false })).toBe("SCORE_EXCEEDS_MATCH_FORMAT");
    expect(checkMatchScores(FT3, 3, 3, { decisive: true })).toBe("SCORE_EXCEEDS_MATCH_FORMAT");
  });

  it("refuse un score qui ne désigne personne quand il doit trancher", () => {
    expect(checkMatchScores(BO5, 2, 1, { decisive: true })).toBe("SCORE_BELOW_MATCH_FORMAT");
    expect(checkMatchScores(FT3, 0, 0, { decisive: true })).toBe("SCORE_BELOW_MATCH_FORMAT");
  });

  it("accepte un score partiel tant qu'il ne tranche pas — l'arbitrage note un match en cours", () => {
    expect(checkMatchScores(BO5, 2, 1, { decisive: false })).toBeNull();
    expect(checkMatchScores(BO5, 0, 0, { decisive: false })).toBeNull();
  });

  it("traite le BO1 comme une manche unique", () => {
    const bo1: MatchFormat = { type: "BO", value: 1 };
    expect(checkMatchScores(bo1, 1, 0, { decisive: true })).toBeNull();
    expect(checkMatchScores(bo1, 1, 1, { decisive: true })).toBe("SCORE_EXCEEDS_MATCH_FORMAT");
    expect(checkMatchScores(bo1, 0, 0, { decisive: true })).toBe("SCORE_BELOW_MATCH_FORMAT");
  });
});

describe("match-format — message d'erreur", () => {
  it("chiffre le plafond et l'objectif du tournoi", () => {
    expect(matchScoreViolationMessage(BO5, "SCORE_EXCEEDS_MATCH_FORMAT")).toContain("BO5");
    expect(matchScoreViolationMessage(BO5, "SCORE_BELOW_MATCH_FORMAT")).toContain("3 manches");
    expect(matchScoreViolationMessage(FT3, "SCORE_BELOW_MATCH_FORMAT")).toContain("FT3");
  });

  it("reste générique en saisie libre", () => {
    expect(matchScoreViolationMessage(null, "SCORE_EXCEEDS_MATCH_FORMAT")).toBe("Score invalide.");
  });
});

/**
 * `matchFormatLabel` est la **seule** fonction du dépôt qui écrive « BO5 » ou
 * « FT3 ». Ce garde-fou balaye tout `app/`, `components/` et `lib/`, parce que
 * la régression qu'il existe pour attraper est l'apparition d'un second
 * assembleur *ailleurs* : c'était `toBestOfLabel`, dans un module de la vitrine
 * que personne ne relisait en pensant « format de match ». Il devinait « BO5 »
 * en finale et « BO3 » sinon, et affichait donc « BO3 » sur un tournoi FT3.
 *
 * Deux signaux seulement, pour rester tolérant aux refactorings :
 *
 * 1. une chaîne qui **est** une notation (`"BO3"`, `'FT5'`) — le libellé qu'on
 *    recopie au lieu de l'appeler ;
 * 2. l'assemblage d'un type et d'un nombre, par interpolation ou concaténation.
 *
 * Ce qui reste permis : citer la notation **en prose** (« un Best of se joue en
 * nombre impair : BO1, BO3, BO5… ») dans une phrase d'aide ou un commentaire,
 * et nommer un jeu d'essai « BO5 Élimination ». On explique la règle, on ne
 * l'affiche pas.
 */
const ROOT = join(__dirname, "..", "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** Le seul module autorisé à écrire la notation. */
const SOURCE_OF_TRUTH = join("lib", "shared", "match-format.ts");

/**
 * Retire les commentaires : ils citent « BO5 » en prose, et un commentaire de
 * **fin de ligne** compte autant qu'un commentaire de pleine ligne — une seule
 * note « // renvoie "BO5" » suffirait sinon à rendre la suite rouge sans
 * qu'aucun libellé n'ait été recopié.
 *
 * Le `[^:]` devant `//` épargne les protocoles (`https://…`), la seule paire de
 * barres qui traverse ce dépôt hors commentaire.
 */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, (_match, before: string) => before);
}

/** Tous les fichiers TypeScript du produit (hors tests, hors dépendances). */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(rel);
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push(rel);
      }
    }
  };
  for (const root of ["app", "components", "lib"]) walk(root);
  return out.filter((file) => file !== SOURCE_OF_TRUTH);
}

/** Une chaîne dont le contenu **entier** est une notation : « "BO3" », « 'FT5' ». */
const NOTATION_LITERAL = /"(?:BO|FT)\d+"|'(?:BO|FT)\d+'|`(?:BO|FT)\d+`/g;

/**
 * Un type et un nombre accolés : `` `${f.type}${f.value}` `` ou `type + value`.
 * C'est la forme qu'aurait une seconde implémentation de `matchFormatLabel`.
 */
const NOTATION_ASSEMBLY =
  /\$\{[^}]*\btype\b[^}]*\}\s*\$\{[^}]*\bvalue\b[^}]*\}|\btype\s*\+\s*[\w.]*\bvalue\b/g;

describe("match-format — une seule écriture de la notation", () => {
  it("le balayage voit ce qu'il interdit", () => {
    // Garde-fou du garde-fou : sans ça, un motif cassé rendrait la suite verte.
    expect('const label = "BO3";'.match(NOTATION_LITERAL)).toHaveLength(1);
    expect("return `${format.type}${format.value}`;".match(NOTATION_ASSEMBLY)).toHaveLength(1);
    expect("return type + format.value;".match(NOTATION_ASSEMBLY)).toHaveLength(1);
    // …et laisse passer la prose, qui cite la notation sans l'afficher.
    expect('"Un Best of se joue en nombre impair (BO1, BO3, BO5…)."'.match(NOTATION_LITERAL))
      .toBeNull();
    expect('{ name: "BO5 Élimination" }'.match(NOTATION_LITERAL)).toBeNull();
    expect(stripComments('const x = 1; // renvoie "BO5"')).toBe("const x = 1; ");
    expect(stripComments('const u = "https://x.dev/a"; // note')).toBe('const u = "https://x.dev/a"; ');
  });

  it("balaye un ensemble de fichiers non vide", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(join("components", "cyber", "landing", "LiveCard.tsx"));
    expect(files).not.toContain(SOURCE_OF_TRUTH);
  });

  it("aucun fichier ne recopie ni n'assemble la notation hors du module partagé", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const code = stripComments(read(file));
      for (const pattern of [NOTATION_LITERAL, NOTATION_ASSEMBLY]) {
        pattern.lastIndex = 0;
        for (const hit of code.match(pattern) ?? []) offenders.push(`${file} → ${hit}`);
      }
    }

    if (offenders.length > 0) {
      throw new Error(
        [
          "Une notation de format de match (« BO5 », « FT3 ») est écrite hors de",
          `${SOURCE_OF_TRUTH} :`,
          ...offenders.map((offender) => `  · ${offender}`),
          "",
          "Appelle `matchFormatLabel(format)` — et garde la pastille derrière un",
          "`format && …`, un tournoi en score libre n'ayant pas de notation.",
          "C'est cette duplication qui a fait afficher « BO3 » sur un tournoi FT3",
          "(voir docs/features/MATCH_FORMAT.md). Citer la notation en prose reste",
          "permis : c'est une chaîne *égale* à la notation qui est refusée.",
        ].join("\n"),
      );
    }
  });

  it("`lib/shared/landing.ts` n'écrit plus de notation de format", () => {
    const code = stripComments(read(join("lib", "shared", "landing.ts")));
    expect(code).not.toMatch(/BO\d|FT\d/);
    expect(code).not.toContain("toBestOfLabel");
  });

  it("la carte de l'accueil lit le réglage du tournoi et passe par le module partagé", () => {
    const code = stripComments(read(join("components", "cyber", "landing", "LiveCard.tsx")));
    expect(code).toContain("matchFormatLabel");
    expect(code).toContain("tournament.matchFormat");
  });

  it("rend bien type + nombre, sur tout le domaine de saisie", () => {
    for (const type of ["BO", "FT"] as const) {
      const { min, max } = MATCH_FORMAT_BOUNDS[type];
      for (let value = min; value <= max; value += 1) {
        expect(matchFormatLabel({ type, value })).toBe(`${type}${value}`);
      }
    }
  });
});
