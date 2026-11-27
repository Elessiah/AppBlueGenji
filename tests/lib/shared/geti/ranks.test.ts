import { describe, expect, it } from "@jest/globals";
import { GETI_RANK_TOP, getiRankFromValue, getiRankValue } from "@/lib/shared/geti";
import { getiRange, getiRank, parseGetiText } from "@/tests/helpers/geti";

const BRONZE_5 = getiRank("BRONZE", 5);
const CHAMPION_1 = getiRank("CHAMPION", 1);
const NO_RANK = { min: null, max: null };

/** Fourchette globale lue dans un texte. */
function rangeOf(text: string) {
  const { min, max } = parseGetiText(text).ranks;
  return { min, max };
}

describe("échelle des rangs", () => {
  it("getiRankValue : Bronze 5 vaut 0, Champion 1 vaut le sommet", () => {
    expect(getiRankValue(BRONZE_5)).toBe(0);
    expect(getiRankValue(CHAMPION_1)).toBe(44);
    expect(GETI_RANK_TOP).toBe(44);
  });

  it("getiRankValue : une division de mieux vaut un de plus, un palier cinq", () => {
    expect(getiRankValue(getiRank("DIAMOND", 3))).toBe(27);
    expect(getiRankValue(getiRank("DIAMOND", 2))).toBe(28);
    expect(getiRankValue(getiRank("MASTER", 3))).toBe(32);
  });

  it("getiRankFromValue : rend le rang d'une valeur de l'échelle", () => {
    expect(getiRankFromValue(27)).toEqual(getiRank("DIAMOND", 3));
  });

  it("getiRankFromValue : une valeur hors échelle est ramenée à la borne", () => {
    expect(getiRankFromValue(-1)).toEqual(BRONZE_5);
    expect(getiRankFromValue(45)).toEqual(CHAMPION_1);
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

  it("1499 est encore Silver, 1500 est Gold (Émeraude décale l'échelle sous 3000)", () => {
    expect(rangeOf("lft 1499 sr")).toEqual(getiRange(getiRank("SILVER", 1)));
    expect(rangeOf("lft 1500 sr")).toEqual(getiRange(getiRank("GOLD", 5)));
  });

  it("3999 est encore Master, 4000 est Grand Maître", () => {
    expect(rangeOf("lft 3999 sr")).toEqual(getiRange(getiRank("MASTER", 1)));
    expect(rangeOf("lft 4000 sr")).toEqual(getiRange(getiRank("GRANDMASTER", 5)));
  });

  it("le SR monte jusqu'à Champion : 4500 est Champion 5, 4900 plafonne à Champion 1", () => {
    expect(rangeOf("lft 4500 sr")).toEqual(getiRange(getiRank("CHAMPION", 5)));
    expect(rangeOf("lft 4900 sr")).toEqual(getiRange(getiRank("CHAMPION", 1)));
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

describe("rangs d'une annonce — faux rangs écartés", () => {

  it("un montant en milliers n'est pas un SR (« cashprize 1k€ »)", () => {
    expect(rangeOf("LFT tank, cashprize 1k€ gagné")).toEqual(NO_RANK);
  });

  it("« écran 4k » n'est pas un SR", () => {
    expect(rangeOf("lft, joue sur écran 4k")).toEqual(NO_RANK);
  });

  it("« 4k » contre un rôle est un SR", () => {
    expect(parseGetiText("lft tank 4k").ranks.byRole.TANK).toEqual(getiRange(getiRank("GRANDMASTER", 5)));
  });

  it("« 4k » suivi de « sr » est un SR", () => {
    expect(rangeOf("lft 4k sr")).toEqual(getiRange(getiRank("GRANDMASTER", 5)));
  });

  it("« 4k » derrière « sr : » est un SR", () => {
    expect(rangeOf("lft, sr : 4k")).toEqual(getiRange(getiRank("GRANDMASTER", 5)));
  });

  it("un nombre suivi d'une unité n'est pas un SR (« 1500+ heures »)", () => {
    expect(rangeOf("lft, 1500+ heures de jeu")).toEqual(NO_RANK);
  });

  it("« s2 » derrière « depuis la » est une saison, pas Silver 2", () => {
    expect(rangeOf("Je joue depuis la s2, dps d1")).toEqual(getiRange(getiRank("DIAMOND", 1)));
  });

  it("« G2 » derrière « ex- » est une équipe, pas Gold 2", () => {
    expect(parseGetiText("lft ex-G2 dps").ranks.byRole).toEqual({});
  });

  it("« G2 » devant « Esports » est une équipe, pas Gold 2", () => {
    expect(rangeOf("lft, fan de G2 Esports")).toEqual(NO_RANK);
  });

  it("« g2 » seul reste Gold 2", () => {
    expect(rangeOf("lft dps g2")).toEqual(getiRange(getiRank("GOLD", 2)));
  });
});

describe("rangs d'une annonce — plusieurs rangs pour un rôle", () => {
  it("le rang actuel derrière le peak reste au même rôle", () => {
    expect(parseGetiText("lft tank peak gm, actuellement m1").ranks.byRole.TANK).toEqual(
      getiRange(getiRank("MASTER", 1), getiRank("GRANDMASTER", 1)),
    );
  });

  it("un rang suivi de son propre rôle ne suit pas le rôle d'avant", () => {
    expect(parseGetiText("lfp tank peak m2, actuellement d1 dps").ranks.byRole).toEqual({
      TANK: getiRange(getiRank("MASTER", 2)),
      DPS: getiRange(getiRank("DIAMOND", 1)),
    });
  });
});

describe("rangs d'une annonce — borne ouverte au bout d'une liste", () => {
  it("« diam ou master+ » monte jusqu'à Champion 1", () => {
    expect(parseGetiText("lfp dps diam ou master+").ranks.byRole.DPS).toEqual(
      getiRange(getiRank("DIAMOND", 5), CHAMPION_1),
    );
  });

  it("« jusqu'à plat ou diam » descend jusqu'à Bronze 5", () => {
    expect(rangeOf("lfp jusqu'a plat ou diam")).toEqual(getiRange(BRONZE_5, getiRank("DIAMOND", 1)));
  });
});


describe("rangs d'une annonce — initiales écartées seulement dans leur contexte", () => {
  it("« ancien m1 » reste un rang", () => {
    expect(rangeOf("lft dps ancien m1, actuellement d2")).toEqual(getiRange(getiRank("DIAMOND", 2), getiRank("MASTER", 1)));
  });

  it("« ex d1 » reste un rang", () => {
    expect(rangeOf("lft dps ex d1")).toEqual(getiRange(getiRank("DIAMOND", 1)));
  });

  it("« depuis d2 » reste un rang", () => {
    expect(rangeOf("lft depuis d2")).toEqual(getiRange(getiRank("DIAMOND", 2)));
  });

  it("« je joue à D2 » est un jeu, pas Diamant 2", () => {
    expect(rangeOf("je joue à D2 aussi, lft")).toEqual({ min: null, max: null });
  });
});

describe("rangs d'une annonce — ancien SR", () => {

  it.each([
    { text: "lft 4k", expected: getiRange(getiRank("GRANDMASTER", 5)) },
    { text: "lft dps 3.5k", expected: getiRange(getiRank("MASTER", 5)) },
    { text: "lft 4k5", expected: getiRange(getiRank("CHAMPION", 5)) },
    { text: "lft 4000", expected: getiRange(getiRank("GRANDMASTER", 5)) },
    { text: "lft 3500", expected: getiRange(getiRank("MASTER", 5)) },
    { text: "lft dps 4200", expected: getiRange(getiRank("GRANDMASTER", 3)) },
    { text: "lfp 2800-3200", expected: getiRange(getiRank("EMERALD", 2), getiRank("DIAMOND", 3)) },
    { text: "lft 3500+", expected: getiRange(getiRank("MASTER", 5), CHAMPION_1) },
    { text: "lft 3k+", expected: getiRange(getiRank("DIAMOND", 5), CHAMPION_1) },
    { text: "lft 3k-4k", expected: getiRange(getiRank("DIAMOND", 5), getiRank("GRANDMASTER", 5)) },
  ])("« $text » est un SR", ({ text, expected }) => {
    expect(rangeOf(text)).toEqual(expected);
  });

  it.each([
    "lft, résolution 4k",
    "lft 4k 144hz",
    "lft 4k heures",
    "1k abonnés sur twitch, lft",
    "1200 followers, lft",
    "budget 1k, lft",
    "lft $2000",
    "cashprize 1500€",
    "lft 2000 balles",
    "code 3456",
    "id 3500",
    "appelle 06 1234 5678",
    "lft en 2025",
    "2025-2026 saison",
  ])("« %s » n'est pas un SR", (text) => {
    expect(rangeOf(text)).toEqual(NO_RANK);
  });
});

describe("rangs d'une annonce — abréviations", () => {
  it.each([
    { text: "lft GM", expected: getiRange(getiRank("GRANDMASTER", 5), getiRank("GRANDMASTER", 1)) },
    { text: "lft gm5+", expected: getiRange(getiRank("GRANDMASTER", 5), CHAMPION_1) },
    { text: "lft dia", expected: getiRange(getiRank("DIAMOND", 5), getiRank("DIAMOND", 1)) },
    { text: "lft plat1", expected: getiRange(getiRank("PLATINUM", 1)) },
    { text: "lft plat+", expected: getiRange(getiRank("PLATINUM", 5), CHAMPION_1) },
    { text: "lft champ", expected: getiRange(getiRank("CHAMPION", 5), CHAMPION_1) },
    { text: "lft dps, diam ou plat", expected: getiRange(getiRank("PLATINUM", 5), getiRank("DIAMOND", 1)) },
    { text: "lft gm, dps", expected: getiRange(getiRank("GRANDMASTER", 5), getiRank("GRANDMASTER", 1)) },
    { text: "gm, lft dps m2", expected: getiRange(getiRank("MASTER", 2)) },
  ])("« $text » est lu", ({ text, expected }) => {
    expect(rangeOf(text)).toEqual(expected);
  });

  it.each([
    "gm tout le monde, lft dps",
    "gm les gars",
    "je mange un plat de pâtes, lft dps",
    "mon écran est à plat, lft",
    "lft champ de bataille",
  ])("« %s » n'est pas un rang (sens courant)", (text) => {
    expect(rangeOf(text)).toEqual({ min: null, max: null });
  });
});

describe("rangs d'une annonce — revue 3 : années, nombres comptés, téléphones", () => {
  it.each([
    { text: "lft dps, né en 2005" },
    { text: "joueurs nés avant 2008" },
  ])(
    "« $text » : une année derrière un mot de date n'est pas un SR",
    ({ text }) => {
      expect(rangeOf(text)).toEqual(NO_RANK);
    },
  );

  it.each([
    { text: "serveur de 1200 personnes, lft" },
    { text: "3000 inscrits, lfp" },
    { text: "1500 points de cashprize" },
  ])(
    "« $text » : un nombre qui compte quelque chose n'est pas un SR",
    ({ text }) => {
      expect(rangeOf(text)).toEqual(NO_RANK);
    },
  );

  it.each([
    { text: "lft 3500", expected: getiRange(getiRank("MASTER", 5)) },
    { text: "dps 4000", expected: getiRange(getiRank("GRANDMASTER", 5)) },
  ])(
    "« $text » : un SR nu sans mot de date reste un rang",
    ({ text, expected }) => {
      expect(rangeOf(text)).toEqual(expected);
    },
  );

  it("un âge à deux chiffres à côté du SR ne l'efface pas (« 4200 20 ans »)", () => {
    expect(rangeOf("lft dps 4200 20 ans")).toEqual(
      getiRange(getiRank("GRANDMASTER", 3)),
    );
  });

  it.each([
    { text: "06 12 34 56 78 4200" },
    { text: "appelle le 555-1234" },
    { text: "+33 4200" },
  ])("« $text » : un numéro de téléphone n'est pas un SR", ({ text }) => {
    expect(rangeOf(text)).toEqual(NO_RANK);
  });

  it("« 3k-4k » reste une fourchette de SR", () => {
    expect(rangeOf("lft 3k-4k")).toEqual(
      getiRange(getiRank("DIAMOND", 5), getiRank("GRANDMASTER", 5)),
    );
  });
});

describe("rangs d'une annonce — revue 3 : abréviations courantes", () => {
  it.each([
    {
      text: "recherche joueurs gold à plat",
      expected: getiRange(getiRank("GOLD", 5), getiRank("PLATINUM", 1)),
    },
    {
      text: "lfp du silver au plat",
      expected: getiRange(getiRank("SILVER", 5), getiRank("PLATINUM", 1)),
    },
    {
      text: "du gm au champ, lft",
      expected: getiRange(getiRank("GRANDMASTER", 5), CHAMPION_1),
    },
  ])(
    "« $text » : la borne haute reliée par « à / au » est gardée",
    ({ text, expected }) => {
      expect(rangeOf(text)).toEqual(expected);
    },
  );

  it.each([
    { text: "mon plat d'entrée" },
    { text: "mon pneu est à plat" },
    { text: "un plat de pâtes" },
  ])("« $text » : « plat » au sens courant n'est pas un rang", ({ text }) => {
    expect(rangeOf(text)).toEqual(NO_RANK);
  });

  it.each([
    {
      text: "GM tous rôles",
      expected: getiRange(
        getiRank("GRANDMASTER", 5),
        getiRank("GRANDMASTER", 1),
      ),
    },
    {
      text: "GM all roles\nlft",
      expected: getiRange(
        getiRank("GRANDMASTER", 5),
        getiRank("GRANDMASTER", 1),
      ),
    },
    {
      text: "GM, Master\nlfp",
      expected: getiRange(getiRank("MASTER", 5), getiRank("GRANDMASTER", 1)),
    },
  ])(
    "« $text » : « GM » devant une liste de rangs ou de rôles est un rang",
    ({ text, expected }) => {
      expect(rangeOf(text)).toEqual(expected);
    },
  );

  it.each([{ text: "gm tout le monde" }, { text: "GM !" }])(
    "« $text » reste un salut",
    ({ text }) => {
      expect(rangeOf(text)).toEqual(NO_RANK);
    },
  );

  it("« depuis s1 » est une saison, pas Silver 1", () => {
    expect(rangeOf("je joue depuis s1, lft dps")).toEqual(NO_RANK);
  });

  it("« depuis d2 » reste Diamant 2", () => {
    expect(rangeOf("depuis d2")).toEqual(getiRange(getiRank("DIAMOND", 2)));
  });
});
