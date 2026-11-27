import { describe, expect, it } from "@jest/globals";
import {
  GETI_CHANNEL_IDS,
  isGetiBotNotice,
  matchesGetiFilter,
  parseGetiPost,
  type GetiCategory,
  type GetiFilter,
  type GetiParsedPost,
} from "@/lib/shared/geti";
import {
  GETI_FAKE_BOT_ID,
  GETI_TRUSTED_BOTS,
  getiRange,
  getiRank,
  getiRawPost,
  getiRelayPost,
  parseGetiText,
  parsedGetiPost,
} from "@/tests/helpers/geti";

// Tournures relevées sur les annonces réelles des six salons (lot GETI-TUNE),
// réécrites : aucun pseudo, serveur ni identifiant réel.

/** Mardi 24 novembre 2026, 19 h à Paris. */
const TUESDAY_EVENING = "2026-11-24T18:00:00.000Z";
const NOW = Date.parse("2026-11-27T12:00:00.000Z");

/** Annonce d'un salon donné, publiée le mardi 24/11/2026 au soir (sauf autre date). */
function parseIn(category: GetiCategory, content: string, postedAt: string | null = TUESDAY_EVENING): GetiParsedPost {
  return parseGetiPost(getiRawPost(content, { channelId: GETI_CHANNEL_IDS[category], postedAt }));
}

function rangeOf(text: string) {
  const { min, max } = parseGetiText(text).ranks;
  return { min, max };
}

function scrimRangeOf(text: string) {
  const { min, max } = parseIn("lfs", text).ranks;
  return { min, max };
}

function timesOf(text: string) {
  return parseGetiText(text).availability.times;
}

function daysOf(text: string) {
  return parseGetiText(text).availability.days;
}

const NO_RANK = { min: null, max: null };

describe("rangs — SR des annonces de scrim", () => {
  it.each([
    { text: "lfs 3k4-5", expected: getiRange(getiRank("DIAMOND", 1), getiRank("MASTER", 5)) },
    { text: "lfsub 2k5/7", expected: getiRange(getiRank("EMERALD", 5), getiRank("EMERALD", 3)) },
    { text: "lfs 3.4-3.5k", expected: getiRange(getiRank("DIAMOND", 1), getiRank("MASTER", 5)) },
    { text: "lfsub 3.5-6k", expected: getiRange(getiRank("MASTER", 5), getiRank("MASTER", 4)) },
    { text: "roster 3.2-3k", expected: getiRange(getiRank("DIAMOND", 5), getiRank("DIAMOND", 3)) },
    { text: "lfs 3.3/4k", expected: getiRange(getiRank("DIAMOND", 2), getiRank("GRANDMASTER", 5)) },
    { text: "lfs sr 3.6-3.7", expected: getiRange(getiRank("MASTER", 4), getiRank("MASTER", 3)) },
    { text: "elo : 3.2", expected: getiRange(getiRank("DIAMOND", 3)) },
    { text: "lfs 3k/3k2", expected: getiRange(getiRank("DIAMOND", 5), getiRank("DIAMOND", 3)) },
    { text: "lft 5000", expected: getiRange(getiRank("CHAMPION", 1)) },
    { text: "lft 2k", expected: getiRange(getiRank("PLATINUM", 5)) },
    { text: "lft 4k", expected: getiRange(getiRank("GRANDMASTER", 5)) },
    { text: "lft 4400", expected: getiRange(getiRank("GRANDMASTER", 1)) },
  ])("« $text » est une fourchette de SR", ({ text, expected }) => {
    expect(rangeOf(text)).toEqual(expected);
  });

  it("un chiffre derrière « 4k/ » n'ouvre pas de fourchette de centaines", () => {
    expect(rangeOf("team 4k/5 soirs par semaine")).toEqual(getiRange(getiRank("GRANDMASTER", 5)));
  });

  it("un horaire voisin ne fait pas du SR un numéro de téléphone", () => {
    expect(rangeOf("lfs eu pc 4k 20-22 cet")).toEqual(getiRange(getiRank("GRANDMASTER", 5)));
    expect(rangeOf("lfs 3500 21-23")).toEqual(getiRange(getiRank("MASTER", 5)));
    expect(rangeOf("lfs 20-22 3500")).toEqual(getiRange(getiRank("MASTER", 5)));
  });

  it("un numéro de téléphone n'est toujours pas un SR", () => {
    expect(rangeOf("appelle 06 1234 5678")).toEqual(NO_RANK);
  });

  it("« loi 1901 » n'est pas un SR", () => {
    expect(rangeOf("association sous loi 1901")).toEqual(NO_RANK);
  });

  it("un décimal nu est un SR dans une recherche de scrim ou de remplaçant", () => {
    expect(scrimRangeOf("LFS EU PC 3.6 21-23 CET")).toEqual(getiRange(getiRank("MASTER", 4)));
    expect(scrimRangeOf("LFS | 2.5-3.3 | CEST")).toEqual(getiRange(getiRank("EMERALD", 5), getiRank("DIAMOND", 2)));
  });

  it("un décimal nu suivi de « + » ouvre la fourchette vers le haut", () => {
    expect(scrimRangeOf("LFS EU 20-22 CET adv 4.5+")).toEqual(getiRange(getiRank("CHAMPION", 5), getiRank("CHAMPION", 1)));
  });

  it("un décimal nu n'est pas un SR hors scrim", () => {
    expect(rangeOf("lft version 3.6 du patch")).toEqual(NO_RANK);
  });

  it("l'heure à minutes pointées d'un scrim n'est pas un SR", () => {
    expect(scrimRangeOf("LFS EU 21.15-23 CET")).toEqual(NO_RANK);
  });
});

describe("rangs — Émeraude", () => {
  it.each([
    { text: "lfp émeraude minimum", expected: getiRange(getiRank("EMERALD", 5), getiRank("CHAMPION", 1)) },
    { text: "lft emerald 3", expected: getiRange(getiRank("EMERALD", 3)) },
    { text: "lft eme 2", expected: getiRange(getiRank("EMERALD", 2)) },
    { text: "lfp plat à eme", expected: getiRange(getiRank("PLATINUM", 5), getiRank("EMERALD", 1)) },
    { text: "lfp platine-emeraude", expected: getiRange(getiRank("PLATINUM", 5), getiRank("EMERALD", 1)) },
    { text: "lfp e3-d5", expected: getiRange(getiRank("EMERALD", 3), getiRank("DIAMOND", 5)) },
    { text: "rank : e5", expected: getiRange(getiRank("EMERALD", 5)) },
    { text: "lft tank e2", expected: getiRange(getiRank("EMERALD", 2)) },
  ])("« $text » lit Émeraude", ({ text, expected }) => {
    expect(rangeOf(text)).toEqual(expected);
  });

  it("« e3 » sans contexte de rang n'est pas Émeraude 3", () => {
    expect(rangeOf("rendez-vous salle e3 demain")).toEqual(NO_RANK);
  });

  it("« 2eme » n'est pas Émeraude", () => {
    expect(rangeOf("notre 2eme roster recrute")).toEqual(NO_RANK);
  });

  it("le SR place Émeraude de 2500 à 2999, division 5 en bas", () => {
    expect(rangeOf("lft 2499 sr")).toEqual(getiRange(getiRank("PLATINUM", 1)));
    expect(rangeOf("lft 2500 sr")).toEqual(getiRange(getiRank("EMERALD", 5)));
    expect(rangeOf("lft 2599 sr")).toEqual(getiRange(getiRank("EMERALD", 5)));
    expect(rangeOf("lft 2900 sr")).toEqual(getiRange(getiRank("EMERALD", 1)));
    expect(rangeOf("lft 2999 sr")).toEqual(getiRange(getiRank("EMERALD", 1)));
    expect(rangeOf("lft 3000 sr")).toEqual(getiRange(getiRank("DIAMOND", 5)));
  });

  it("les paliers bas suivent l'échelle 0–5000 : 1000 Argent, 1500 Or, 2000 Platine", () => {
    expect(rangeOf("lft 1000 sr")).toEqual(getiRange(getiRank("SILVER", 5)));
    expect(rangeOf("lft 1500 sr")).toEqual(getiRange(getiRank("GOLD", 5)));
    expect(rangeOf("lft 2000 sr")).toEqual(getiRange(getiRank("PLATINUM", 5)));
  });
});

describe("rangs — noms français du jeu", () => {
  it.each([
    { text: "lft maîtrise 3", expected: getiRange(getiRank("MASTER", 3)) },
    { text: "lft grande maîtrise", expected: getiRange(getiRank("GRANDMASTER", 5), getiRank("GRANDMASTER", 1)) },
    { text: "lft Grande Maîtrise 2", expected: getiRange(getiRank("GRANDMASTER", 2)) },
    { text: "lfp virtuose", expected: getiRange(getiRank("CHAMPION", 5), getiRank("CHAMPION", 1)) },
    { text: "peak virtuose 4", expected: getiRange(getiRank("CHAMPION", 4)) },
    { text: "lfp maîtrise 5 à virtuose", expected: getiRange(getiRank("MASTER", 5), getiRank("CHAMPION", 1)) },
  ])("« $text » est un rang", ({ text, expected }) => {
    expect(rangeOf(text)).toEqual(expected);
  });

  it.each([
    "lucidité et maîtrise de soi",
    "une bonne maîtrise",
    "une grande maîtrise du jeu",
    "un virtuose de la souris",
  ])("« %s » n'est pas un rang", (text) => {
    expect(rangeOf(text)).toEqual(NO_RANK);
  });

  it("le filtre situe une annonce Émeraude entre Platine et Diamant", () => {
    const post = parsedGetiPost({ ranks: { min: getiRank("EMERALD", 4), max: getiRank("EMERALD", 2), byRole: {} } });

    expect(matchesGetiFilter(post, { ranks: { min: getiRank("PLATINUM", 1), max: getiRank("DIAMOND", 5) } }, NOW)).toBe(true);
    expect(matchesGetiFilter(post, { ranks: { min: getiRank("DIAMOND", 5) } }, NOW)).toBe(false);
    expect(matchesGetiFilter(post, { ranks: { max: getiRank("PLATINUM", 1) } }, NOW)).toBe(false);
  });
});

describe("rangs — « champion » en titre", () => {
  it("un titre de division n'est pas un rang", () => {
    expect(rangeOf("lft fdps, s10 intermediate champion")).toEqual(NO_RANK);
  });

  it("« champion de France » n'est pas un rang", () => {
    expect(rangeOf("ancien champion de france")).toEqual(NO_RANK);
  });

  it("« peak champion » et « champion 3 » restent des rangs", () => {
    expect(rangeOf("lft peak champion")).toEqual(getiRange(getiRank("CHAMPION", 5), getiRank("CHAMPION", 1)));
    expect(rangeOf("lft intermediate champion 3")).toEqual(getiRange(getiRank("CHAMPION", 3)));
  });
});

describe("rôles — tournures réelles", () => {
  it("« hs » est un hitscan", () => {
    expect(parseGetiText("lfsub hs 4k").subRoles).toEqual(["HITSCAN"]);
    expect(parseGetiText("lfp dps hs").roles).toEqual(["DPS"]);
  });

  it("« hs » derrière un nombre n'est pas un rôle", () => {
    expect(parseGetiText("environ 120 hs de jeu").roles).toEqual([]);
  });

  it("le sous-rôle se lit aussi rôle en tête", () => {
    expect(parseGetiText("lfp dps flex").subRoles).toEqual(["FLEX_DPS"]);
    expect(parseGetiText("lfp support main").subRoles).toEqual(["MAIN_SUPPORT"]);
    expect(parseGetiText("lfp support flex").subRoles).toEqual(["FLEX_SUPPORT"]);
  });

  it("« dps flex » ne dit pas un joueur polyvalent", () => {
    expect(parseGetiText("lfp dps flex").roles).toEqual(["DPS"]);
  });

  it("« tank flex » reste un tank seul", () => {
    expect(parseGetiText("lfp tank __flex__").roles).toEqual(["TANK"]);
    expect(parseGetiText("lfp flex tank").roles).toEqual(["TANK"]);
  });

  it("« flex » verbe n'est pas un rôle", () => {
    expect(parseGetiText("lfp support, can flex to other heroes").roles).toEqual(["SUPPORT"]);
    expect(parseGetiText("lfp tank qui peut flex sur un autre héros").roles).toEqual(["TANK"]);
  });

  it("une barre verticale sépare deux postes", () => {
    const parsed = parseGetiText("Postes : Tank | Flex DPS | Flex Support | Main Support");

    expect(parsed.roles).toEqual(["TANK", "DPS", "SUPPORT"]);
    expect(parsed.subRoles).toEqual(["FLEX_DPS", "MAIN_SUPPORT", "FLEX_SUPPORT"]);
  });

  it("un texte masqué « ||LFP|| » ne laisse pas de barre", () => {
    expect(parseGetiText("||lfp|| tank").roles).toEqual(["TANK"]);
  });

  it("un alias ne se lit pas à cheval sur deux lignes", () => {
    const parsed = parseGetiText("lfp\nDPS\nFlex support");

    expect(parsed.subRoles).toEqual(["FLEX_SUPPORT"]);
    expect(parsed.roles).toEqual(["DPS", "SUPPORT"]);
  });
});

describe("plateformes — équipes mêlées", () => {
  it("« hybrid » et « crossplay » valent PC et console", () => {
    expect(parseGetiText("lfp hybride m2-gm4").platforms).toEqual(["PC", "CONSOLE"]);
    expect(parseGetiText("lfs hybrid team").platforms).toEqual(["PC", "CONSOLE"]);
    expect(parseGetiText("lfp crossplay").platforms).toEqual(["PC", "CONSOLE"]);
  });

  it("« mixed » vaut PC et console dans une recherche de scrim", () => {
    expect(parseIn("lfs", "LFS EU mixed 3k 21-23 CET").platforms).toEqual(["PC", "CONSOLE"]);
  });

  it("« mixed » ailleurs ne dit rien de la plateforme", () => {
    expect(parseIn("lfp", "LFP mixed team, PC").platforms).toEqual(["PC"]);
  });
});

describe("horaires — fourchettes sans unité", () => {
  it.each([
    { text: "lfs eu pc 20-22 cet", expected: [{ from: 1200, to: 1320 }] },
    { text: "lfs 21 - 23 cet", expected: [{ from: 1260, to: 1380 }] },
    { text: "lfs 21/23 cet", expected: [{ from: 1260, to: 1380 }] },
    { text: "lfs | today | 21/23 |", expected: [{ from: 1260, to: 1380 }] },
    { text: "lfs h21-23 cet", expected: [{ from: 1260, to: 1380 }] },
    { text: "lfs 4k5 20-22cest", expected: [{ from: 1200, to: 1320 }] },
    { text: "lfs 21.15-23 cet", expected: [{ from: 1275, to: 1380 }] },
    { text: "monday : 20-22", expected: [{ from: 1200, to: 1320 }] },
    { text: "lfs 22-1 cet", expected: [{ from: 1320, to: 60 }] },
    { text: "lfs 20-22 or 21-23 cet", expected: [{ from: 1200, to: 1320 }, { from: 1260, to: 1380 }] },
    { text: "lfs open 20 cet", expected: [{ from: 1200, to: null }] },
  ])("« $text » donne un horaire", ({ text, expected }) => {
    expect(timesOf(text)).toEqual(expected);
  });

  it.each([
    "lfp 3-5 joueurs",
    "joueurs de 18-25 ans",
    "lan du 20-22 novembre",
    "scrim le 22/11",
    "note de 15/20",
    "lfs 21-20 cet",
    "dispo 4/5 jours",
    "lfs 3.4-3.5k",
    "saison s9/10",
  ])("« %s » n'est pas un horaire", (text) => {
    expect(timesOf(text)).toEqual([]);
  });

  it("le fuseau se lit en minuscules derrière une heure", () => {
    expect(parseGetiText("lfs 20-22 cet").availability.timezone).toBe("CET");
    expect(parseGetiText("lfs 21h cest").availability.timezone).toBe("CEST");
  });

  it("« cet » article n'est pas un fuseau", () => {
    expect(parseGetiText("on recrute cet été").availability.timezone).toBeNull();
  });
});

describe("jours — abréviations, fautes et listes", () => {
  it("une abréviation se lit devant une heure ou une date", () => {
    expect(daysOf("Tue 20-22 CET\nFri 20-22 CET")).toEqual(["TUE", "FRI"]);
    expect(daysOf("scrim sam 28/11")).toEqual(["SAT"]);
    expect(daysOf("dispo ven. 21h")).toEqual(["FRI"]);
  });

  it("des abréviations se lisent en liste ponctuée", () => {
    expect(daysOf("dispo lun/mer/ven")).toEqual(["MON", "WED", "FRI"]);
  });

  it("deux abréviations reliées par un tiret font une fourchette", () => {
    expect(daysOf("dispo lun-ven")).toEqual(["MON", "TUE", "WED", "THU", "FRI"]);
  });

  it("une abréviation seule dans une phrase n'est pas un jour", () => {
    expect(daysOf("je veux améliorer mon jeu")).toEqual([]);
    expect(daysOf("sun tzu disait")).toEqual([]);
  });

  it("les fautes courantes sont lues", () => {
    expect(daysOf("Wednesday/Mecredi : 21h")).toEqual(["WED"]);
    expect(daysOf("wenesday 21h")).toEqual(["WED"]);
  });

  it("« 7/7j » et « 7j/7 » valent tous les jours", () => {
    expect(daysOf("dispo : 7/7j")).toHaveLength(7);
    expect(daysOf("dispo : 7/7 day")).toHaveLength(7);
    expect(daysOf("dispo : 7j/7")).toHaveLength(7);
  });

  it("deux jours en liste à puces ne font pas une fourchette", () => {
    expect(daysOf("lfs 21h\n- Mardi\n- Dimanche")).toEqual(["TUE", "SUN"]);
  });

  it("« mardi - jeudi » sur une ligne reste une fourchette", () => {
    expect(daysOf("dispo mardi - jeudi")).toEqual(["TUE", "WED", "THU"]);
  });
});

describe("dates visées", () => {
  it("une date « jour/mois » se situe dans l'année de la publication", () => {
    const parsed = parseIn("lfp", "tryout le 26/11");

    expect(parsed.dates).toEqual(["2026-11-26"]);
    expect(parsed.availability.days).toEqual(["THU"]);
  });

  it("une date avec son année est lue telle quelle", () => {
    expect(parseIn("lfp", "tryout le 29/11/26").dates).toEqual(["2026-11-29"]);
    expect(parseIn("lfp", "tryout le 02/12/2026").dates).toEqual(["2026-12-02"]);
  });

  it("une date de janvier publiée fin décembre passe à l'année suivante", () => {
    expect(parseIn("lfp", "tryout le 02/01", "2026-12-30T18:00:00.000Z").dates).toEqual(["2027-01-02"]);
  });

  it.each(["tryout le 31/02", "dispo 4/5 jours", "saison 9/10 jouée", "dispo 7/7", "pc 21/23 cet"])(
    "« %s » ne donne pas de date",
    (text) => {
      expect(parseIn("lfp", text).dates).toEqual([]);
    },
  );

  it("un jour nommé suivi de son quantième donne la date", () => {
    expect(parseIn("lfp", "tryout Thursday 26").dates).toEqual(["2026-11-26"]);
    expect(parseIn("lfp", "tryout Friday 27NOV").dates).toEqual(["2026-11-27"]);
  });

  it("un quantième qui ne tombe pas sur le jour nommé n'est pas une date", () => {
    expect(parseIn("lfp", "tryout Friday 26").dates).toEqual([]);
  });

  it("« ce soir » et « tomorrow » se comptent depuis la publication", () => {
    expect(parseIn("lfp", "LFSub tank ce soir 21h").dates).toEqual(["2026-11-24"]);
    expect(parseIn("lfp", "tryout tomorrow").dates).toEqual(["2026-11-25"]);
  });

  it("le jour est celui de Paris : passé minuit, « ce soir » est le lendemain UTC", () => {
    expect(parseIn("lfp", "tryout ce soir", "2026-11-24T23:30:00.000Z").dates).toEqual(["2026-11-25"]);
  });

  it("sans date de publication, aucune date n'est lue", () => {
    expect(parseIn("lfs", "LFS 3k5 ce soir 21h 26/11", null).dates).toEqual([]);
  });

  it("un scrim sans jour vise le soir même", () => {
    expect(parseIn("lfs", "LFS EU PC 3k5 20-22 CET").dates).toEqual(["2026-11-24"]);
    expect(parseIn("lfs", "LFS EU PC 3.3k now").dates).toEqual(["2026-11-24"]);
  });

  it("un scrim sur un jour nommé vise sa prochaine occurrence", () => {
    expect(parseIn("lfs", "LFS 3k5\nJeudi 21h-23h\nDimanche 21h-23h").dates).toEqual(["2026-11-26", "2026-11-29"]);
    expect(parseIn("lfs", "LFS 3k5 mardi 21h").dates).toEqual(["2026-11-24"]);
  });

  it("un jour déjà daté n'est pas compté deux fois", () => {
    expect(parseIn("lfs", "LFS 3k5 21h-23h\nJeudi/Thursday 03/12").dates).toEqual(["2026-12-03"]);
  });

  it("une recherche de remplaçant vise aussi le soir même", () => {
    expect(parseIn("lfsub", "LFSub tank 3k5 21h").dates).toEqual(["2026-11-24"]);
  });

  it("le mot-clé « LFSub » vaut hors de son salon", () => {
    expect(parseIn("lfp", "LFSub tank 3k5 21h").dates).toEqual(["2026-11-24"]);
  });

  it("une annonce de joueur avec un horaire ne vise pas de date", () => {
    expect(parseIn("lfp", "LFP tank, scrims à 21h").dates).toEqual([]);
    expect(parseIn("lft", "LFT dps dispo jeudi 21h").dates).toEqual([]);
  });

  it("sans horaire ni jour, un scrim ne vise pas de date", () => {
    expect(parseIn("lfs", "LFS EU PC 4k5").dates).toEqual([]);
  });
});

describe("niveaux de division", () => {
  it.each([
    { text: "lfs eu pc adv 20-22 cet", expected: ["ADVANCED"] },
    { text: "lft tank open div", expected: ["OPEN"] },
    { text: "lfs eu pc high open / low int", expected: ["OPEN", "INTERMEDIATE"] },
    { text: "coach aura 4k5 - highopen", expected: ["OPEN"] },
    { text: "lfs adv/exp 4.5k+", expected: ["ADVANCED", "EXPERT"] },
    { text: "3 saisons faceit (open-adv-inter)", expected: ["OPEN", "INTERMEDIATE", "ADVANCED"] },
    { text: "lft expert fdps", expected: ["EXPERT"] },
    { text: "monté en intermédiaire", expected: ["INTERMEDIATE"] },
    { text: "support for advanced → expert", expected: ["ADVANCED", "EXPERT"] },
  ])("« $text » → $expected", ({ text, expected }) => {
    expect(parseGetiText(text).levels).toEqual(expected);
  });

  it.each([
    "exp : 200h de scrim",
    "lft int",
    "DMs open for more information",
    "position open for trials",
    "mp open",
    "merci d'avance",
  ])("« %s » ne dit aucun niveau", (text) => {
    expect(parseGetiText(text).levels).toEqual([]);
  });
});

describe("passages barrés et annonces closes", () => {
  it("un passage barré n'est pas lu", () => {
    const parsed = parseIn("lfs", "LFS 3k 21h-23h\n~~Mardi 24/11~~\nMercredi 25/11");

    expect(parsed.availability.days).toEqual(["WED"]);
    expect(parsed.dates).toEqual(["2026-11-25"]);
    expect(parsed.closed).toBe(false);
  });

  it("une annonce entièrement barrée est close et garde ses données", () => {
    const parsed = parseIn("lfsub", "~~LFSub Tank 3k5 ce soir 21H~~");

    expect(parsed.closed).toBe(true);
    expect(parsed.roles).toEqual(["TANK"]);
    expect(parsed.ranks.min).toEqual(getiRank("MASTER", 5));
    expect(parsed.dates).toEqual(["2026-11-24"]);
  });

  it("une mention hors du barré ne rouvre pas l'annonce", () => {
    expect(parseIn("lfsub", "~~LFSub Tank 3k5~~ <@&100000000000000003>").closed).toBe(true);
  });

  it("le texte affiché garde ses barres", () => {
    expect(parseIn("lfsub", "~~LFSub Tank 3k5~~").text).toBe("~~LFSub Tank 3k5~~");
  });

  it("sans passage barré, l'annonce est ouverte", () => {
    expect(parseGetiText("lft tank ~ 3k5").closed).toBe(false);
  });

  it("une citation de relais barrée est close", () => {
    const header = "<@100000000000000003>*(fauxpseudo)* sur [Faux Serveur](https://discord.gg/fauxcode)";

    expect(parseGetiPost(getiRelayPost(`${header}\n\n> ~~LFS EU PC ADV 20-22 CET~~`, null), GETI_TRUSTED_BOTS).closed).toBe(true);
  });
});

describe("noms d'équipe — tournures réelles", () => {
  it.each([
    { text: "LFP | SUPPORT – Chroma Esport", expected: "Chroma Esport" },
    { text: "La Structure ELEVEN Academy recrute", expected: "ELEVEN Academy" },
    { text: "MTP RECRUTE !", expected: "MTP" },
    { text: "L'association Blue Sonate recherche un manager", expected: "Blue Sonate" },
    { text: "La LND ASTRA cherche son coach", expected: "LND ASTRA" },
    { text: "Verdict Astral recherche un/e Coach", expected: "Verdict Astral" },
    { text: "Chroma Esport is looking for a Support", expected: "Chroma Esport" },
    { text: "LFS | adv | 20-23 CET | Chroma Esport", expected: "Chroma Esport" },
    { text: "<:LogoStructure:100000000000000007> ELDRAVEN RECRUTE", expected: "ELDRAVEN" },
  ])("« $text » → $expected", ({ text, expected }) => {
    expect(parseGetiText(text).teamName).toBe(expected);
  });

  it.each([
    "ROSTER 3K & 4K3",
    "une structure E-sport pour vous soutenir",
    "Je recherche une team",
    "Nous recherche un tank",
    "Coach recherche équipe",
    "Petite team cherche un support",
  ])("« %s » ne nomme aucune équipe", (text) => {
    expect(parseGetiText(text).teamName).toBeNull();
  });
});

describe("nom d'équipe derrière un libellé — ligne longue", () => {
  it("le nom est lu même si la ligne dépasse 80 caractères", () => {
    const line = `Équipe : Blue Falcons — ${"nous cherchons des joueurs motivés et sérieux ".repeat(3)}`;

    expect(parseGetiText(line).teamName).toBe("Blue Falcons");
  });

  it("un nom qui court au-delà des 80 caractères lus n'est pas rendu tronqué", () => {
    const line = `Équipe : ${"Abcdefghij ".repeat(12)}`;

    expect(parseGetiText(line).teamName).toBeNull();
  });

  it("une ligne de 100 000 caractères derrière le libellé est lue en temps borné", () => {
    const start = performance.now();

    parseGetiText(`Équipe : ${"A".repeat(100_000)}`);

    expect(performance.now() - start).toBeLessThan(3000);
  });
});

describe("réponses de service d'un bot", () => {
  const notice = (description: string) => ({
    content: "",
    author: { id: GETI_FAKE_BOT_ID, username: "FauxBot", discriminator: "0", bot: true },
    embeds: [{ description }],
  });

  it("la confirmation de publication n'est pas une annonce", () => {
    const raw = notice(
      "Ton annonce a été publié dans **32 autres channels**.\n[=> Invite FauxBot](https://discord.com/oauth2/authorize?client_id=100000000000000090)",
    );

    expect(isGetiBotNotice(raw)).toBe(true);
  });

  it("la confirmation en anglais non plus", () => {
    expect(isGetiBotNotice(notice("Your post has been published in 12 other channels."))).toBe(true);
  });

  it("un relais à en-tête GETI reste une annonce, même s'il cite la confirmation", () => {
    const header = "<@100000000000000003>*(fauxpseudo)* sur [Faux Serveur](https://discord.gg/fauxcode)";

    expect(isGetiBotNotice(notice(`${header}\n\n> ton annonce a été publiée ? LFT tank`))).toBe(false);
  });

  it("un relais ordinaire n'est pas une réponse de service", () => {
    expect(isGetiBotNotice(getiRelayPost("LFT tank m2"))).toBe(false);
  });

  it("le message d'un membre n'est jamais une réponse de service", () => {
    expect(isGetiBotNotice(getiRawPost("Ton annonce a été publié dans 3 autres channels"))).toBe(false);
  });

  it("une valeur qui n'est pas un objet n'est pas une réponse de service", () => {
    const untyped: unknown = JSON.parse("null");

    expect(isGetiBotNotice(untyped as Parameters<typeof isGetiBotNotice>[0])).toBe(false);
  });
});

describe("matchesGetiFilter — niveaux et annonces closes", () => {
  it("un niveau voulu présent dans l'annonce passe", () => {
    const post = parsedGetiPost({ levels: ["INTERMEDIATE", "ADVANCED"] });

    expect(matchesGetiFilter(post, { levels: ["ADVANCED", "EXPERT"] }, NOW)).toBe(true);
  });

  it("aucun niveau voulu dans l'annonce : écartée", () => {
    expect(matchesGetiFilter(parsedGetiPost({ levels: ["OPEN"] }), { levels: ["EXPERT"] }, NOW)).toBe(false);
  });

  it("niveau non lu : écartée, sauf includeUnknown", () => {
    expect(matchesGetiFilter(parsedGetiPost(), { levels: ["OPEN"] }, NOW)).toBe(false);
    expect(matchesGetiFilter(parsedGetiPost(), { levels: ["OPEN"], includeUnknown: true }, NOW)).toBe(true);
  });

  it("une liste de niveaux vide ne filtre rien", () => {
    expect(matchesGetiFilter(parsedGetiPost(), { levels: [] }, NOW)).toBe(true);
  });

  it("hideClosed écarte une annonce close", () => {
    expect(matchesGetiFilter(parsedGetiPost({ closed: true }), { hideClosed: true }, NOW)).toBe(false);
  });

  it("hideClosed enregistré en « \"true\" » écarte une annonce close", () => {
    const stored = { hideClosed: "true" } as unknown as GetiFilter;

    expect(matchesGetiFilter(parsedGetiPost({ closed: true }), stored, NOW)).toBe(false);
  });

  it("hideClosed enregistré en 1 ne filtre rien", () => {
    const stored = { hideClosed: 1 } as unknown as GetiFilter;

    expect(matchesGetiFilter(parsedGetiPost({ closed: true }), stored, NOW)).toBe(true);
  });

  it("hideClosed laisse passer une annonce ouverte", () => {
    expect(matchesGetiFilter(parsedGetiPost(), { hideClosed: true }, NOW)).toBe(true);
  });

  it("sans hideClosed, une annonce close passe", () => {
    expect(matchesGetiFilter(parsedGetiPost({ closed: true }), {}, NOW)).toBe(true);
  });
});

describe("revue std 1 — faux positifs et faux négatifs", () => {
  it("parseGetiPost_ageBracketBeforeUnitlessRange_readsNoTime", () => {
    expect(parseIn("lfp", "Recherche DPS, âge : 16-20, FR").availability.times).toEqual([]);
  });

  it("parseGetiPost_unitlessRangeWithoutAgeWord_staysTime", () => {
    expect(parseIn("lfs", "LFS EU PC 20-22 CET").availability.times).toEqual([{ from: 1200, to: 1320 }]);
  });

  it("parseGetiPost_hybridInMapList_isNotBothPlatforms", () => {
    expect(parseIn("lfs", "LFS PC 3k5 20-22 CET, maps: control, hybrid, push").platforms).toEqual(["PC"]);
  });

  it("parseGetiPost_hybridTeam_isBothPlatforms", () => {
    expect(parseIn("lfs", "LFS EU Hybrid team 3k 21-23 CET").platforms).toEqual(["PC", "CONSOLE"]);
  });

  it("parseGetiPost_lftNameBeforeVerb_readsNoTeam", () => {
    expect(parseIn("lft", "Lucas recherche une équipe FR Diamant DPS").teamName).toBeNull();
  });

  it("parseGetiPost_lfpNameBeforeVerb_readsTeam", () => {
    expect(parseIn("lfp", "Blue Sonate recherche un tank").teamName).toBe("Blue Sonate");
  });

  it("parseGetiPost_openAfterRecruitmentWord_isNotLevel", () => {
    expect(parseIn("lfp", "Team Nova — Recrutement open ! Cherche tank adv").levels).toEqual(["ADVANCED"]);
  });

  it("parseGetiPost_plusEighteenDePreference_readsAge", () => {
    expect(parseIn("lfp", "Team Phoenix recrute, +18 de préférence").minAge).toBe(18);
  });

  it("parseGetiPost_eighteenPlusOuMature_readsAge", () => {
    expect(parseIn("lfp", "LFP tank, 18+ ou mature").minAge).toBe(18);
  });

  it("parseGetiPost_hsAfterDeviceVerb_isNotHitscan", () => {
    const parsed = parseIn("lft", "Main support Diamant, mon micro est hs en ce moment");

    expect(parsed.roles).toEqual(["SUPPORT"]);
    expect(parsed.subRoles).toEqual(["MAIN_SUPPORT"]);
  });

  it("parseGetiPost_bareHsInList_isHitscan", () => {
    const parsed = parseIn("lft", "LFT | HS ~ 3K PC");

    expect(parsed.roles).toEqual(["DPS"]);
    expect(parsed.subRoles).toEqual(["HITSCAN"]);
  });

  it("parseGetiPost_onABienEu_isNotEurope", () => {
    expect(parseIn("lft", "NA player, on a bien eu des scrims").regions).toEqual(["NA"]);
  });

  it("parseGetiPost_deNaAToutEu_staysEurope", () => {
    expect(parseIn("lft", "dispo de NA à tout EU").regions).toEqual(["EU", "NA"]);
  });

  it("parseGetiPost_fractionBeforeCountWord_isNotDate", () => {
    const parsed = parseIn("lfp", "Il nous manque 1/12 places, cherche 2/3 joueurs", "2026-11-27T10:00:00.000Z");

    expect(parsed.dates).toEqual([]);
  });

  it("parseGetiPost_lastDayOfYearReadOnFirstJanuary_isDate", () => {
    // 1er janvier 2027, 0 h 30 à Paris.
    const parsed = parseIn("lfs", "Scrim dispo 31/12 et 01/01", "2026-12-31T23:30:00.000Z");

    expect(parsed.dates).toEqual(["2026-12-31", "2027-01-01"]);
  });
});

describe("revue sécurité 1 : tournures courantes qui ne sont pas des critères", () => {
  it("parseGetiPost_twoAbbreviationsSeparatedByCommaInSentence_noDays", () => {
    const parsed = parseIn("lfs", "Je cherche une team sur ce jeu, mon rang est diamant");

    expect(parsed.availability.days).toEqual([]);
    expect(parsed.dates).toEqual([]);
  });

  it("parseGetiPost_threeAbbreviationsCommaList_readsDays", () => {
    expect(parseGetiText("dispo lun, mer, ven 21h").availability.days).toEqual(["MON", "WED", "FRI"]);
  });

  it("parseGetiPost_twoAbbreviationsSlash_readsDays", () => {
    expect(parseGetiText("dispo lun/mer 21h").availability.days).toEqual(["MON", "WED"]);
  });

  it("parseGetiPost_fractionOfRoleWord_notADate", () => {
    const parsed = parseIn("lfs", "Recherche 1/2 tanks", "2026-01-10T12:00:00.000Z");

    expect(parsed.dates).toEqual([]);
  });

  it("parseGetiLevels_nuancedExp_notALevel", () => {
    expect(parseGetiText("LFP joueur, low exp accepté").levels).toEqual([]);
  });

  it("parseGetiLevels_nuancedInt_stillIntermediate", () => {
    expect(parseGetiText("LFP low int").levels).toEqual(["INTERMEDIATE"]);
  });

  it("parseGetiLevels_expJoinedToAnotherLevel_stillExpert", () => {
    expect(parseGetiText("LFT adv/exp").levels).toEqual(["ADVANCED", "EXPERT"]);
  });

  it("parseGetiLevels_openMinded_notOpen", () => {
    expect(parseGetiText("LFP joueur open minded").levels).toEqual([]);
  });

  it("parseGetiLevels_openMindedJoinedToALevel_onlyTheLevel", () => {
    expect(parseGetiText("LFP low int, open-minded").levels).toEqual(["INTERMEDIATE"]);
  });

  it("parseGetiLevels_openDEsprit_notOpen", () => {
    expect(parseGetiText("joueur open d'esprit").levels).toEqual([]);
  });

  it("parseGetiPost_cetDemonstrativeAfterTime_noTimezone", () => {
    const { availability } = parseGetiText("Dispo à 15h cet après-midi");

    expect(availability.timezone).toBeNull();
    expect(availability.times).toEqual([{ from: 900, to: null }]);
  });

  it("parseGetiPost_unitlessHourBeforeCetEte_notATime", () => {
    const { availability } = parseGetiText("Dispo 18 cet été");

    expect(availability.times).toEqual([]);
    expect(availability.timezone).toBeNull();
  });

  it("parseGetiPost_lowercaseCetAfterRange_stillCET", () => {
    expect(parseGetiText("dispo 20-22 cet").availability.timezone).toBe("CET");
  });

  it("parseGetiPost_staffSeekingATeamInLfstaff_noTeamName", () => {
    expect(parseIn("lfstaff", "Kevin cherche une équipe en tant que coach").teamName).toBeNull();
  });

  it("parseGetiPost_lftKeywordPostedInLfpChannel_noTeamName", () => {
    expect(parseIn("lfp", "LFT — Lucas recherche une team").teamName).toBeNull();
  });

  it("parseGetiPost_structureRecruitsATeam_keepsName", () => {
    expect(parseIn("lfstaff", "Faux Phoenix Recrute une team en 2k5").teamName).toBe("Faux Phoenix");
  });

  it("parseGetiPost_scrimTeamSeekingATeam_keepsName", () => {
    expect(parseIn("lfs", "Verdict Astral recherche une team pour scrim ce soir").teamName).toBe("Verdict Astral");
  });
});
