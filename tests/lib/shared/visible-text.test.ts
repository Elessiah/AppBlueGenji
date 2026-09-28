import { describe, expect, it } from "@jest/globals";
import { visibleText } from "@/lib/shared/visible-text";
import { checkTeamName } from "@/lib/shared/team-name";
import { normalizePseudo } from "@/lib/server/serialization";

// Écrits par leur point de code : un caractère invisible dans le source ne se
// relit pas, et un test qui le contient littéralement ne dit pas ce qu'il teste.
const cp = (code: number) => String.fromCodePoint(code);
const ZERO_WIDTH_SPACE = cp(0x200b);
const WORD_JOINER = cp(0x2060);
const BOM = cp(0xfeff);
const RIGHT_TO_LEFT_OVERRIDE = cp(0x202e);
const RIGHT_TO_LEFT_ISOLATE = cp(0x2067);
const SOFT_HYPHEN = cp(0x00ad);
const HANGUL_FILLER = cp(0x3164);
const ZERO_WIDTH_JOINER = cp(0x200d);
const VARIATION_16 = cp(0xfe0f);

describe("visibleText", () => {
  it("retire les caractères de largeur nulle, qui font passer un sosie pour l'original", () => {
    expect(visibleText(`Adm${ZERO_WIDTH_SPACE}in`)).toBe("Admin");
    expect(visibleText(`Adm${WORD_JOINER}in`)).toBe("Admin");
    expect(visibleText(`${BOM}Admin`)).toBe("Admin");
    expect(visibleText(`Ad${SOFT_HYPHEN}min`)).toBe("Admin");
  });

  it("retire les commandes de direction, qui retournent l'affichage", () => {
    expect(visibleText(`Team ${RIGHT_TO_LEFT_OVERRIDE}lanif`)).toBe("Team lanif");
    expect(visibleText(`${RIGHT_TO_LEFT_ISOLATE}Nova`)).toBe("Nova");
  });

  it("retire les remplissages hangul, lettres sans dessin", () => {
    expect(visibleText(HANGUL_FILLER)).toBe("");
    expect(visibleText(`Nova${HANGUL_FILLER}`)).toBe("Nova");
  });

  it("ramène un nom sur une ligne : contrôles et sauts de ligne deviennent des espaces", () => {
    expect(visibleText("Les\nLoups")).toBe("Les Loups");
    expect(visibleText("Les\r\n\tLoups")).toBe("Les Loups");
    expect(visibleText(`Les${cp(0x0007)}Loups`)).toBe("Les Loups");
  });

  it("normalise en NFKC : pleine chasse et lettres mathématiques rejoignent la forme courante", () => {
    const fullWidthAdmin = [0xff21, 0xff24, 0xff2d, 0xff29, 0xff2e].map(cp).join("");
    expect(visibleText(fullWidthAdmin)).toBe("ADMIN");
    expect(visibleText(`${cp(0x1d400)}dmin`)).toBe("Admin");
  });

  it("réduit les espaces, y compris insécables, et retire ceux des bordures", () => {
    expect(visibleText(`  Les${cp(0x00a0)}${cp(0x3000)}Loups  `)).toBe("Les Loups");
  });

  it("garde le liant d'un emoji composé, sans quoi la famille se défait", () => {
    const family = [cp(0x1f468), cp(0x1f469), cp(0x1f467)].join(ZERO_WIDTH_JOINER);
    expect(visibleText(`Clan ${family}`)).toBe(`Clan ${family}`);
    const rainbowFlag = `${cp(0x1f3f3)}${VARIATION_16}${ZERO_WIDTH_JOINER}${cp(0x1f308)}`;
    expect(visibleText(rainbowFlag)).toBe(rainbowFlag);
  });

  it("retire le liant hors d'un emoji, où il n'est qu'un invisible de plus", () => {
    expect(visibleText(`Adm${ZERO_WIDTH_JOINER}in`)).toBe("Admin");
  });

  it("laisse intacts accents et écritures non latines", () => {
    expect(visibleText("Éléonore")).toBe("Éléonore");
    expect(visibleText("Łukasz")).toBe("Łukasz");
    expect(visibleText("Дракон")).toBe("Дракон");
  });
});

describe("normalizePseudo", () => {
  it("passe par visibleText, à l'écriture comme à la recherche", () => {
    expect(normalizePseudo(`Adm${ZERO_WIDTH_SPACE}in`)).toBe("Admin");
    expect(normalizePseudo("  Nova   Prime ")).toBe("Nova Prime");
  });

  it("réduit à vide un pseudo fait d'invisibles, que le profil refuse ensuite", () => {
    expect(normalizePseudo(`${ZERO_WIDTH_SPACE}${HANGUL_FILLER}`)).toBe("");
  });
});

describe("checkTeamName", () => {
  it("rend la forme visible du nom", () => {
    expect(checkTeamName(`Les${ZERO_WIDTH_SPACE} Loups\n`)).toEqual({ ok: true, name: "Les Loups" });
  });

  it("compte la longueur après nettoyage : des invisibles ne font pas un nom", () => {
    expect(checkTeamName(`A${ZERO_WIDTH_SPACE}${ZERO_WIDTH_SPACE}B`)).toEqual({
      ok: false,
      reason: "INVALID_TEAM_NAME",
    });
  });

  it("remplace un saut de ligne par une espace", () => {
    expect(checkTeamName("Les\nLoups")).toEqual({ ok: true, name: "Les Loups" });
  });
});
