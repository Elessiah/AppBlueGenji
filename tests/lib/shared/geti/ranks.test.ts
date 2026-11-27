import { describe, expect, it } from "@jest/globals";
import { GETI_RANK_TOP, getiRankFromValue, getiRankValue } from "@/lib/shared/geti";
import { getiRange, getiRank, parseGetiText } from "@/tests/helpers/geti";

const BRONZE_5 = getiRank("BRONZE", 5);
const CHAMPION_1 = getiRank("CHAMPION", 1);

/** Fourchette globale lue dans un texte. */
function rangeOf(text: string) {
  const { min, max } = parseGetiText(text).ranks;
  return { min, max };
}

describe("échelle des rangs", () => {
  it("getiRankValue : Bronze 5 vaut 0, Champion 1 vaut le sommet", () => {
    expect(getiRankValue(BRONZE_5)).toBe(0);
    expect(getiRankValue(CHAMPION_1)).toBe(39);
    expect(GETI_RANK_TOP).toBe(39);
  });

  it("getiRankValue : une division de mieux vaut un de plus, un palier cinq", () => {
    expect(getiRankValue(getiRank("DIAMOND", 3))).toBe(22);
    expect(getiRankValue(getiRank("DIAMOND", 2))).toBe(23);
    expect(getiRankValue(getiRank("MASTER", 3))).toBe(27);
  });

  it("getiRankFromValue : rend le rang d'une valeur de l'échelle", () => {
    expect(getiRankFromValue(22)).toEqual(getiRank("DIAMOND", 3));
  });

  it("getiRankFromValue : une valeur hors échelle est ramenée à la borne", () => {
    expect(getiRankFromValue(-1)).toEqual(BRONZE_5);
    expect(getiRankFromValue(40)).toEqual(CHAMPION_1);
  });

  it("getiRankFromValue : une valeur non finie rend le bas de l'échelle", () => {
    expect(getiRankFromValue(Number.NaN)).toEqual(BRONZE_5);
  });
});

describe("rangs d'une annonce — paliers et divisions", () => {
  it("un palier sans division couvre ses cinq divisions", () => {
    expect(rangeOf("lft dps diamant")).toEqual(getiRange(getiRank("DIAMOND", 5), getiRank("DIAMOND", 1)));
  });

  it("un palier suivi d'une division donne un rang précis", () => {
    expect(rangeOf("LFT Master 2")).toEqual(getiRange(getiRank("MASTER", 2)));
  });

  it("l'abréviation « gm » collée à sa division est lue", () => {
    expect(rangeOf("lft gm1")).toEqual(getiRange(getiRank("GRANDMASTER", 1)));
  });

  it("les accents, le tiret et la casse d'un palier français sont tolérés", () => {
    expect(rangeOf("LFT Grand-Maître 4")).toEqual(getiRange(getiRank("GRANDMASTER", 4)));
  });

  it("une faute courante (« platinium ») est reconnue", () => {
    expect(rangeOf("lft platinium 3")).toEqual(getiRange(getiRank("PLATINUM", 3)));
  });

  it("« champ » vaut Champion", () => {
    expect(rangeOf("lfp champ 2")).toEqual(getiRange(getiRank("CHAMPION", 2)));
  });

  it("le nom d'un émoji de serveur porte le palier", () => {
    expect(rangeOf("lft <:Master:111111111111111111> 3")).toEqual(getiRange(getiRank("MASTER", 3)));
  });

  it("l'initiale collée à une division est lue (« d3 »)", () => {
    expect(rangeOf("lft dps d3")).toEqual(getiRange(getiRank("DIAMOND", 3)));
  });

  it("une division hors de 1–5 n'est pas un rang (« d6 »)", () => {
    expect(rangeOf("lft dps d6")).toEqual({ min: null, max: null });
  });

  it("une initiale seule n'est pas un rang", () => {
    expect(rangeOf("lft d ou m")).toEqual({ min: null, max: null });
  });

  it("une initiale et un chiffre dans un mot plus long ne sont pas un rang", () => {
    expect(rangeOf("pseudo g2x")).toEqual({ min: null, max: null });
  });

  it("« argent » sans division reste un mot courant", () => {
    expect(rangeOf("structure sans argent")).toEqual({ min: null, max: null });
  });

  it("« argent » suivi d'une division est le palier Silver", () => {
    expect(rangeOf("lft argent 2")).toEqual(getiRange(getiRank("SILVER", 2)));
  });

  it("aucun rang : bornes nulles et aucun rang par rôle", () => {
    expect(parseGetiText("lft dps eu").ranks).toEqual({ min: null, max: null, byRole: {} });
  });
});

describe("rangs d'une annonce — fourchettes", () => {
  it("deux divisions derrière un palier font une fourchette dans ce palier", () => {
    expect(rangeOf("lfp diam 3-1")).toEqual(getiRange(getiRank("DIAMOND", 3), getiRank("DIAMOND", 1)));
  });

  it("la fourchette de divisions se lit aussi derrière une initiale, dans les deux sens", () => {
    expect(rangeOf("lfp m3/5")).toEqual(getiRange(getiRank("MASTER", 5), getiRank("MASTER", 3)));
  });

  it("deux rangs reliés par un tiret font une fourchette", () => {
    expect(rangeOf("lfp d3-m2")).toEqual(getiRange(getiRank("DIAMOND", 3), getiRank("MASTER", 2)));
  });

  it("deux paliers reliés par « à » couvrent du bas du premier au haut du second", () => {
    expect(rangeOf("lfp plat à diam")).toEqual(getiRange(getiRank("PLATINUM", 5), getiRank("DIAMOND", 1)));
  });

  it("« to » et « jusqu'à » relient aussi deux rangs", () => {
    expect(rangeOf("lfp d3 to m2")).toEqual(getiRange(getiRank("DIAMOND", 3), getiRank("MASTER", 2)));
    expect(rangeOf("lfp d3 jusqu'à m2")).toEqual(getiRange(getiRank("DIAMOND", 3), getiRank("MASTER", 2)));
  });

  it("des rangs cités à des endroits distincts donnent le plus bas et le plus haut", () => {
    expect(rangeOf("lft peak gm4, actuellement en d1")).toEqual(
      getiRange(getiRank("DIAMOND", 1), getiRank("GRANDMASTER", 4)),
    );
  });

  it("un « + » ouvre la fourchette vers le haut", () => {
    expect(rangeOf("lfp master+")).toEqual(getiRange(getiRank("MASTER", 5), CHAMPION_1));
  });

  it("« min » devant un rang ouvre vers le haut", () => {
    expect(rangeOf("lfp min d2")).toEqual(getiRange(getiRank("DIAMOND", 2), CHAMPION_1));
  });

  it("« au moins » et « minimum » ouvrent vers le haut", () => {
    expect(rangeOf("lfp au moins diamant")).toEqual(getiRange(getiRank("DIAMOND", 5), CHAMPION_1));
    expect(rangeOf("lfp d2 minimum")).toEqual(getiRange(getiRank("DIAMOND", 2), CHAMPION_1));
  });

  it("« max » devant ou derrière un rang ouvre vers le bas", () => {
    expect(rangeOf("lfp max m1")).toEqual(getiRange(BRONZE_5, getiRank("MASTER", 1)));
    expect(rangeOf("lfp d1 max")).toEqual(getiRange(BRONZE_5, getiRank("DIAMOND", 1)));
  });

  it("« jusqu'à » devant un rang seul ouvre vers le bas", () => {
    expect(rangeOf("lfp jusqu'à master")).toEqual(getiRange(BRONZE_5, getiRank("MASTER", 1)));
  });

  it("« min … max … » : chaque borne est tenue par l'autre", () => {
    expect(rangeOf("lfp min d3 max m1")).toEqual(getiRange(getiRank("DIAMOND", 3), getiRank("MASTER", 1)));
  });

  it("« top 500 » va de Grand Maître 5 à Champion 1", () => {
    expect(rangeOf("lft top 500")).toEqual(getiRange(getiRank("GRANDMASTER", 5), CHAMPION_1));
    expect(rangeOf("lft t500")).toEqual(getiRange(getiRank("GRANDMASTER", 5), CHAMPION_1));
  });
});

describe("rangs d'une annonce — ancien SR", () => {
  it("un nombre suivi de « sr » est converti en rang", () => {
    expect(rangeOf("lft 3500 sr")).toEqual(getiRange(getiRank("MASTER", 5)));
  });

  it("la notation en milliers est lue (« 4k2 », « 3.9k »)", () => {
    expect(rangeOf("lft 4k2")).toEqual(getiRange(getiRank("GRANDMASTER", 3)));
    expect(rangeOf("lft 3.9k")).toEqual(getiRange(getiRank("MASTER", 1)));
  });

  it("un SR suivi de « + » ouvre vers le haut", () => {
    expect(rangeOf("lfp 4400+")).toEqual(getiRange(getiRank("GRANDMASTER", 1), CHAMPION_1));
  });

  it("deux SR reliés font une fourchette", () => {
    expect(rangeOf("lfs 3000-3500")).toEqual(getiRange(getiRank("DIAMOND", 5), getiRank("MASTER", 5)));
  });

  it("1499 est encore Bronze, 1500 est Silver", () => {
    expect(rangeOf("lft 1499 sr")).toEqual(getiRange(getiRank("BRONZE", 1)));
    expect(rangeOf("lft 1500 sr")).toEqual(getiRange(getiRank("SILVER", 5)));
  });

  it("3999 est encore Master, 4000 est Grand Maître", () => {
    expect(rangeOf("lft 3999 sr")).toEqual(getiRange(getiRank("MASTER", 1)));
    expect(rangeOf("lft 4000 sr")).toEqual(getiRange(getiRank("GRANDMASTER", 5)));
  });

  it("le SR plafonne à Grand Maître 1 : Champion n'existait pas", () => {
    expect(rangeOf("lft 4900 sr")).toEqual(getiRange(getiRank("GRANDMASTER", 1)));
  });

  it("un nombre nu n'est pas un SR", () => {
    expect(rangeOf("serveur de 3500 membres")).toEqual({ min: null, max: null });
  });

  it("deux années reliées ne sont pas une fourchette de SR", () => {
    expect(rangeOf("saison 2025-2026")).toEqual({ min: null, max: null });
  });

  it("l'ancien suffixe d'un pseudo n'est pas un SR", () => {
    expect(rangeOf("contact fauxpseudo#3500+")).toEqual({ min: null, max: null });
  });
});

describe("rangs d'une annonce — rang par rôle", () => {
  it("le rôle écrit devant chaque rang le reçoit", () => {
    expect(parseGetiText("lft tank m2 / dps d1 / supp gm5").ranks.byRole).toEqual({
      TANK: getiRange(getiRank("MASTER", 2)),
      DPS: getiRange(getiRank("DIAMOND", 1)),
      SUPPORT: getiRange(getiRank("GRANDMASTER", 5)),
    });
  });

  it("le rôle écrit derrière chaque rang le reçoit", () => {
    expect(parseGetiText("lft M2 tank, D1 dps").ranks.byRole).toEqual({
      TANK: getiRange(getiRank("MASTER", 2)),
      DPS: getiRange(getiRank("DIAMOND", 1)),
    });
  });

  it("sans ponctuation, un rôle déjà servi ne sert pas au rang suivant", () => {
    expect(parseGetiText("lft m2 tank d1 dps").ranks.byRole).toEqual({
      TANK: getiRange(getiRank("MASTER", 2)),
      DPS: getiRange(getiRank("DIAMOND", 1)),
    });
  });

  it("une liste de rôles partage la fourchette qui la suit", () => {
    expect(parseGetiText("lfp tank/dps : d3-m2").ranks.byRole).toEqual({
      TANK: getiRange(getiRank("DIAMOND", 3), getiRank("MASTER", 2)),
      DPS: getiRange(getiRank("DIAMOND", 3), getiRank("MASTER", 2)),
    });
  });

  it("un mot de liaison admis entre le rôle et le rang ne les sépare pas", () => {
    expect(parseGetiText("lft dps peak m1").ranks.byRole).toEqual({ DPS: getiRange(getiRank("MASTER", 1)) });
  });

  it("deux rangs pour un même rôle sont réunis", () => {
    expect(parseGetiText("lft tank m2\ntank : d1").ranks.byRole).toEqual({
      TANK: getiRange(getiRank("DIAMOND", 1), getiRank("MASTER", 2)),
    });
  });

  it("un rôle sur une autre ligne ne reçoit pas le rang", () => {
    expect(parseGetiText("lft tank\nm2").ranks.byRole).toEqual({});
  });

  it("un rôle séparé du rang par une phrase ne le reçoit pas", () => {
    expect(parseGetiText("lft tank depuis longtemps, je suis m2").ranks.byRole).toEqual({});
  });

  it("« flex » ne porte pas de rang propre", () => {
    expect(parseGetiText("lft flex d3").ranks).toEqual({
      min: getiRank("DIAMOND", 3),
      max: getiRank("DIAMOND", 3),
      byRole: {},
    });
  });
});
