import { describe, expect, it } from "@jest/globals";
import { parseGetiPost } from "@/lib/shared/geti";
import { getiRawPost, parseGetiText } from "@/tests/helpers/geti";

const cp = (code: number) => String.fromCodePoint(code);
/** Drapeau à partir de son code à deux lettres (indicateurs régionaux). */
const flag = (code: string) => [...code].map((letter) => cp(0x1f1e6 + letter.charCodeAt(0) - 65)).join("");

describe("rôles", () => {
  it("lit Tank, DPS et Support en anglais", () => {
    expect(parseGetiText("lfp tank, dps, support").roles).toEqual(["TANK", "DPS", "SUPPORT"]);
  });

  it("lit les alias français et abrégés du support", () => {
    expect(parseGetiText("lft heal").roles).toEqual(["SUPPORT"]);
    expect(parseGetiText("lft supp").roles).toEqual(["SUPPORT"]);
    expect(parseGetiText("lft soigneur").roles).toEqual(["SUPPORT"]);
  });

  it("lit « dégâts » malgré l'accent", () => {
    expect(parseGetiText("lft dégâts").roles).toEqual(["DPS"]);
  });

  it("rend les rôles dans l'ordre Tank, DPS, Support, Flex quel que soit celui du texte", () => {
    expect(parseGetiText("lft flex, heal ou tank").roles).toEqual(["TANK", "SUPPORT", "FLEX"]);
  });

  it("un sous-rôle donne aussi son rôle", () => {
    const parsed = parseGetiText("lfp main tank, hitscan et flex support");

    expect(parsed.roles).toEqual(["TANK", "DPS", "SUPPORT"]);
    expect(parsed.subRoles).toEqual(["MAIN_TANK", "HITSCAN", "FLEX_SUPPORT"]);
  });

  it("lit les sous-rôles abrégés (« ot », « fdps », « ms »)", () => {
    expect(parseGetiText("lfp ot, fdps, ms").subRoles).toEqual(["OFF_TANK", "FLEX_DPS", "MAIN_SUPPORT"]);
  });

  it("« flex dps » est un DPS, pas un joueur « Flex »", () => {
    expect(parseGetiText("lft flex dps").roles).toEqual(["DPS"]);
  });

  it("« flex » seul est le rôle Flex", () => {
    expect(parseGetiText("lft flex").roles).toEqual(["FLEX"]);
  });

  it("« tous les rôles » vaut Flex", () => {
    expect(parseGetiText("lft tous les rôles").roles).toEqual(["FLEX"]);
  });

  it("« ms » derrière un nombre est un ping, pas un main support", () => {
    expect(parseGetiText("lft ping 20 ms").roles).toEqual([]);
  });

  it("le nom d'un émoji de serveur porte le rôle", () => {
    expect(parseGetiText("lft <:tank:111111111111111111>").roles).toEqual(["TANK"]);
  });

  it("un rôle au milieu d'un mot n'est pas lu", () => {
    expect(parseGetiText("lft tankiste supporter").roles).toEqual([]);
  });
});

describe("région", () => {
  it("lit le sigle, en minuscules aussi", () => {
    expect(parseGetiText("lft eu").regions).toEqual(["EU"]);
  });

  it("lit les noms longs français et anglais", () => {
    expect(parseGetiText("lft North America / Amérique du Sud").regions).toEqual(["NA", "LATAM"]);
  });

  it("lit l'Asie et l'Océanie", () => {
    expect(parseGetiText("lft asie, oce").regions).toEqual(["ASIA", "OCE"]);
  });

  it("lit le drapeau européen", () => {
    expect(parseGetiText(`lft ${flag("EU")}`).regions).toEqual(["EU"]);
  });

  it("« eu » dans un mot n'est pas une région", () => {
    expect(parseGetiText("lft peu importe le lieu").regions).toEqual([]);
  });
});

describe("plateforme", () => {
  it("lit PC", () => {
    expect(parseGetiText("lft PC").platforms).toEqual(["PC"]);
  });

  it("une console nommée vaut « console »", () => {
    expect(parseGetiText("lft ps5").platforms).toEqual(["CONSOLE"]);
    expect(parseGetiText("lft xbox").platforms).toEqual(["CONSOLE"]);
  });

  it("lit les deux plateformes", () => {
    expect(parseGetiText("lft console et pc").platforms).toEqual(["PC", "CONSOLE"]);
  });

  it("« switch » seul est un verbe, pas une console", () => {
    expect(parseGetiText("lft je peux switch de rôle").platforms).toEqual([]);
  });
});

describe("langues", () => {
  it("lit les mots français et anglais", () => {
    expect(parseGetiText("équipe francophone, english ok").languages).toEqual(["FR", "EN"]);
  });

  it("lit d'autres langues par leur nom", () => {
    expect(parseGetiText("espagnol, allemand").languages).toEqual(["ES", "DE"]);
  });

  it("lit une liste de sigles en capitales", () => {
    expect(parseGetiText("langues FR/EN").languages).toEqual(["FR", "EN"]);
  });

  it("un sigle ambigu seul n'est pas une langue (« EN », « DE »)", () => {
    expect(parseGetiText("RECHERCHE DE JOUEURS EN DUO").languages).toEqual([]);
  });

  it("un sigle derrière le libellé « langue » est lu", () => {
    expect(parseGetiText("langue : en").languages).toEqual(["EN"]);
  });

  it("un sigle inconnu derrière le libellé est ignoré", () => {
    expect(parseGetiText("langue : zz").languages).toEqual([]);
  });

  it("lit les drapeaux", () => {
    expect(parseGetiText(`lft ${flag("FR")}${flag("GB")}`).languages).toEqual(["FR", "EN"]);
  });

  it("un drapeau sans langue associée est ignoré", () => {
    expect(parseGetiText(`lft ${flag("JP")}`).languages).toEqual([]);
  });
});

describe("disponibilités — jours", () => {
  it("lit un jour nommé", () => {
    expect(parseGetiText("dispo mardi").availability.days).toEqual(["TUE"]);
  });

  it("étend une fourchette de jours", () => {
    expect(parseGetiText("dispo du lundi au vendredi").availability.days).toEqual(["MON", "TUE", "WED", "THU", "FRI"]);
  });

  it("une fourchette qui traverse le week-end fait le tour de la semaine", () => {
    expect(parseGetiText("dispo vendredi au lundi").availability.days).toEqual(["MON", "FRI", "SAT", "SUN"]);
  });

  it("lit une fourchette anglaise", () => {
    expect(parseGetiText("available monday to wednesday").availability.days).toEqual(["MON", "TUE", "WED"]);
  });

  it("« week-end » vaut samedi et dimanche", () => {
    expect(parseGetiText("dispo le week-end").availability.days).toEqual(["SAT", "SUN"]);
  });

  it("« en semaine » vaut du lundi au vendredi", () => {
    expect(parseGetiText("dispo en semaine").availability.days).toEqual(["MON", "TUE", "WED", "THU", "FRI"]);
  });

  it("« tous les soirs » vaut les sept jours", () => {
    expect(parseGetiText("dispo tous les soirs").availability.days).toEqual([
      "MON",
      "TUE",
      "WED",
      "THU",
      "FRI",
      "SAT",
      "SUN",
    ]);
  });

  it("« par semaine » est une fréquence, pas des jours", () => {
    expect(parseGetiText("3 scrims par semaine").availability.days).toEqual([]);
  });
});

describe("disponibilités — horaires", () => {
  const timesOf = (text: string) => parseGetiText(text).availability.times;

  it("lit une fourchette en heures françaises", () => {
    expect(timesOf("dispo 21h-23h")).toEqual([{ from: 1260, to: 1380 }]);
  });

  it("lit « de 20h à 23h »", () => {
    expect(timesOf("dispo de 20h à 23h")).toEqual([{ from: 1200, to: 1380 }]);
  });

  it("lit une heure seule avec ses minutes", () => {
    expect(timesOf("scrim 20h30")).toEqual([{ from: 1230, to: null }]);
  });

  it("lit l'heure écrite en toutes lettres", () => {
    expect(timesOf("scrim à 20 heures")).toEqual([{ from: 1200, to: null }]);
  });

  it("lit le format à deux-points", () => {
    expect(timesOf("scrim 20:30")).toEqual([{ from: 1230, to: null }]);
  });

  it("la première heure d'une fourchette peut ne pas porter d'unité", () => {
    expect(timesOf("dispo 20-23h")).toEqual([{ from: 1200, to: 1380 }]);
  });

  it("le « pm » de la seconde heure vaut pour la première", () => {
    expect(timesOf("available 8-11pm")).toEqual([{ from: 1200, to: 1380 }]);
  });

  it("chaque heure garde son propre « am » ou « pm »", () => {
    expect(timesOf("available 9am-1pm")).toEqual([{ from: 540, to: 780 }]);
  });

  it("12am est minuit, 12pm est midi", () => {
    expect(timesOf("at 12am")).toEqual([{ from: 0, to: null }]);
    expect(timesOf("at 12pm")).toEqual([{ from: 720, to: null }]);
  });

  it("lit les minutes devant « pm »", () => {
    expect(timesOf("at 8:30 pm")).toEqual([{ from: 1230, to: null }]);
  });

  it("24h est admis, 25h ne l'est pas", () => {
    expect(timesOf("jusqu'à 24h")).toEqual([{ from: 1440, to: null }]);
    expect(timesOf("vers 25h")).toEqual([]);
  });

  it("59 minutes sont admises, 60 ne le sont pas", () => {
    expect(timesOf("vers 20h59")).toEqual([{ from: 1259, to: null }]);
    expect(timesOf("vers 20h60")).toEqual([]);
  });

  it("13pm n'est pas une heure", () => {
    expect(timesOf("at 13pm")).toEqual([]);
  });

  it("deux nombres sans unité ne sont pas un horaire", () => {
    expect(timesOf("on cherche 3-5 joueurs")).toEqual([]);
  });

  it("une durée n'est pas un horaire", () => {
    expect(timesOf("je joue 2h par jour")).toEqual([]);
  });

  it("une heure ne se lit pas à cheval sur deux lignes", () => {
    expect(timesOf("dispo 21h-23h\n18+")).toEqual([{ from: 1260, to: 1380 }]);
  });

  it("le même horaire écrit deux fois n'est rendu qu'une fois, les horaires sont triés", () => {
    expect(timesOf("mardi 21h, jeudi 21h, dimanche 15h")).toEqual([
      { from: 900, to: null },
      { from: 1260, to: null },
    ]);
  });
});

describe("disponibilités — fuseau", () => {
  it("lit un sigle en capitales", () => {
    expect(parseGetiText("21h CET").availability.timezone).toBe("CET");
  });

  it("lit un décalage UTC, espaces retirées", () => {
    expect(parseGetiText("21h UTC +2").availability.timezone).toBe("UTC+2");
  });

  it("« heure française » vaut Europe/Paris", () => {
    expect(parseGetiText("21h heure française").availability.timezone).toBe("Europe/Paris");
  });

  it("un sigle en minuscules n'est pas un fuseau", () => {
    expect(parseGetiText("ce soir cet horaire me va").availability.timezone).toBeNull();
  });
});

describe("postes de staff", () => {
  it("lit coach et analyste", () => {
    expect(parseGetiText("lfstaff coach et analyste").staffRoles).toEqual(["COACH", "ANALYST"]);
  });

  it("lit manager et graphiste", () => {
    expect(parseGetiText("lfstaff manager, graphiste").staffRoles).toEqual(["MANAGER", "GRAPHIC"]);
  });

  it("« community manager » n'est pas aussi un manager", () => {
    expect(parseGetiText("lfstaff community manager").staffRoles).toEqual(["COMMUNITY"]);
  });

  it("lit caster et observateur", () => {
    expect(parseGetiText("lfcast casteur + observateur").staffRoles).toEqual(["CASTER", "OBSERVER"]);
  });
});

describe("âge minimal", () => {
  const minAgeOf = (text: string) => parseGetiText(text).minAge;

  it("lit « 18+ » et « +16 »", () => {
    expect(minAgeOf("lfp 18+")).toBe(18);
    expect(minAgeOf("lfp +16")).toBe(16);
  });

  it("lit « 17 ans minimum »", () => {
    expect(minAgeOf("lfp 17 ans minimum")).toBe(17);
  });

  it("lit « at least 16 yo »", () => {
    expect(minAgeOf("lfp at least 16 yo")).toBe(16);
  });

  it("« majeur » vaut 18", () => {
    expect(minAgeOf("lfp joueurs majeurs")).toBe(18);
  });

  it("13 est le plus petit âge lu, 12 ne l'est pas", () => {
    expect(minAgeOf("lfp 13+")).toBe(13);
    expect(minAgeOf("lfp 12+")).toBeNull();
  });

  it("25 est le plus grand âge lu, 26 ne l'est pas", () => {
    expect(minAgeOf("lfp 25+")).toBe(25);
    expect(minAgeOf("lfp 26+")).toBeNull();
  });

  it("un décalage de fuseau n'est pas un âge", () => {
    expect(minAgeOf("scrim 21h utc+13")).toBeNull();
  });

  it("un âge simplement cité n'est pas un minimum", () => {
    expect(minAgeOf("lft j'ai 19 ans")).toBeNull();
  });
});

describe("nom d'équipe", () => {
  const teamOf = (text: string) => parseGetiText(text).teamName;

  it("lit le nom derrière un libellé", () => {
    expect(teamOf("Équipe : Blue Phoenix")).toBe("Blue Phoenix");
  });

  it("lit le libellé long « Nom de l'équipe »", () => {
    expect(teamOf("Nom de l'équipe : Les Loups")).toBe("Les Loups");
  });

  it("le nom derrière un libellé s'arrête au séparateur", () => {
    expect(teamOf("Team: Blue Phoenix - EU, PC")).toBe("Blue Phoenix");
  });

  it("lit le nom dans la phrase, mots en capitale seulement", () => {
    expect(teamOf("la team Blue Phoenix recherche un tank")).toBe("Blue Phoenix");
  });

  it("le nom s'arrête au premier mot du vocabulaire d'annonce", () => {
    expect(teamOf("Team Blue Phoenix EU PC")).toBe("Blue Phoenix");
  });

  it("un rang derrière « team » n'est pas un nom", () => {
    expect(teamOf("team Diamant cherche un dps")).toBeNull();
  });

  it("un texte tout en capitales ne donne pas de nom", () => {
    expect(teamOf("TEAM CHERCHE DPS")).toBeNull();
  });

  it("un nom de 40 caractères est gardé, un de 41 est écarté", () => {
    expect(teamOf(`Team : ${"A".repeat(40)}`)).toBe("A".repeat(40));
    expect(teamOf(`Team : ${"A".repeat(41)}`)).toBeNull();
  });

  it("le nom perd ses caractères invisibles et ses commandes de direction", () => {
    const trapped = `Team : Blue${cp(0x200b)}Phoenix${cp(0x202e)}`;

    expect(teamOf(trapped)).toBe("BluePhoenix");
  });

  it("un nom sur la ligne suivante n'est pas rattaché au mot « équipe »", () => {
    expect(teamOf("Recherche d'équipe\nRôle : tank")).toBeNull();
  });

  it("sans nom, rend null", () => {
    expect(teamOf("lft dps d3")).toBeNull();
  });
});

describe("catégorie", () => {
  it("celle que donne l'appelant l'emporte sur le salon", () => {
    const parsed = parseGetiPost(getiRawPost("bonjour", { category: "lfs", channelId: "679323773559635999" }));

    expect(parsed.category).toBe("lfs");
  });

  it("sinon, celle du salon source", () => {
    expect(parseGetiPost(getiRawPost("bonjour", { channelId: "1085116755925536828" })).category).toBe("lfcast");
  });

  it("une catégorie inconnue de l'appelant retombe sur le salon", () => {
    const raw = { ...getiRawPost("bonjour", { channelId: "679323677874978826" }), ...JSON.parse('{"category":"xyz"}') };

    expect(parseGetiPost(raw).category).toBe("lfp");
  });

  it("hors salon connu, le seul mot-clé du texte la donne", () => {
    expect(parseGetiPost(getiRawPost("LFSUB ce soir", { channelId: "100000000000000050" })).category).toBe("lfsub");
  });

  it("« lfs » n'est pas lu dans « lfsub » ni « lfstaff »", () => {
    expect(parseGetiText("lfstaff coach").category).toBe("lfstaff");
  });

  it("deux mots-clés différents ne désignent aucune catégorie", () => {
    expect(parseGetiText("lfp lft").category).toBeNull();
  });

  it("sans salon ni mot-clé, la catégorie est nulle", () => {
    expect(parseGetiText("bonjour").category).toBeNull();
  });
});

describe("faux positifs du texte courant", () => {
  it("« eu » participe d'« avoir » n'est pas l'Europe", () => {
    expect(parseGetiText("J'ai eu une team NA, je cherche team FR").regions).toEqual(["NA"]);
  });

  it("« jamais eu » n'est pas l'Europe", () => {
    expect(parseGetiText("lft, jamais eu de team").regions).toEqual([]);
  });

  it("« team eu » reste l'Europe", () => {
    expect(parseGetiText("lft dps, cherche team eu").regions).toEqual(["EU"]);
  });

  it("une durée en fourchette n'est pas un horaire (« 2-3h par soir »)", () => {
    expect(parseGetiText("Dispo 2-3h par soir, dps diam 2").availability.times).toEqual([]);
  });

  it("« 1 à 2h par jour » n'est pas un horaire", () => {
    expect(parseGetiText("lft, 1 à 2h par jour").availability.times).toEqual([]);
  });

  it("« +20 joueurs » n'est pas un âge", () => {
    expect(parseGetiText("+20 joueurs dans la structure").minAge).toBeNull();
  });

  it("« 15+ heures » n'est pas un âge", () => {
    expect(parseGetiText("lft, 15+ heures de jeu par semaine").minAge).toBeNull();
  });

  it("un âge plus loin est lu derrière un faux âge (« 20+ scrims, 18+ »)", () => {
    expect(parseGetiText("lfp, 20+ scrims par mois, 18+").minAge).toBe(18);
  });

  it("« +18 ans » est un âge", () => {
    expect(parseGetiText("lfp +18 ans").minAge).toBe(18);
  });

  it("un libellé suivi d'un texte sans capitale ne donne pas de nom d'équipe", () => {
    expect(parseGetiText("Roster : 5 joueurs dont 2 tanks").teamName).toBeNull();
  });

  it("un pronom derrière « team » n'est pas un nom d'équipe", () => {
    expect(parseGetiText("Team Je cherche un tank").teamName).toBeNull();
  });

  it("un article derrière « team » n'est pas un nom d'équipe", () => {
    expect(parseGetiText("cherche une team La plus chill possible").teamName).toBeNull();
  });

  it("« merci pour votre soutien » n'ajoute pas le Support", () => {
    expect(parseGetiText("Merci pour votre soutien ! Tank master 2").roles).toEqual(["TANK"]);
  });

  it("« thanks for the support » n'ajoute pas le Support", () => {
    expect(parseGetiText("lft tank m2, thanks for the support").roles).toEqual(["TANK"]);
  });

  it("« soutien » comme rôle reste le Support", () => {
    expect(parseGetiText("lft soutien m2").roles).toEqual(["SUPPORT"]);
  });
});


describe("faux négatifs écartés (revue 2)", () => {
  it.each(["lfp 18+ dps d1", "lfp +18 tank", "lfp 18+ team chill", "LFT 18+ FR EU"])("« %s » porte un âge de 18 ans", (text) => {
    expect(parseGetiText(text).minAge).toBe(18);
  });

  it("« 20+ teams inscrites » n'est pas un âge", () => {
    expect(parseGetiText("lfp, 20+ teams inscrites").minAge).toBeNull();
  });

  it("« 20h-23h par soir » reste une plage horaire", () => {
    expect(parseGetiText("dispo 20h-23h par soir").availability.times).toEqual([{ from: 1200, to: 1380 }]);
  });

  it("« parfois » n'est pas « par » : la plage horaire reste lue", () => {
    expect(parseGetiText("lft dps, dispo 20h-23h parfois plus").availability.times).toEqual([{ from: 1200, to: 1380 }]);
  });

  it("« 21h-23h per day » reste une plage horaire", () => {
    expect(parseGetiText("21h-23h per day").availability.times).toEqual([{ from: 1260, to: 1380 }]);
  });

  it("« 1h-2h par jour » reste une durée", () => {
    expect(parseGetiText("lft 1h-2h par jour").availability.times).toEqual([]);
  });

  it.each(["lft, je serai ton support m1", "je peux être votre support", "merci de jouer le support"])(
    "« %s » garde le Support",
    (text) => {
      expect(parseGetiText(text).roles).toEqual(["SUPPORT"]);
    },
  );

  it("« merci à tous pour le soutien » n'ajoute pas le Support", () => {
    expect(parseGetiText("merci à tous pour le soutien, tank").roles).toEqual(["TANK"]);
  });

  it("« de NA à EU » garde l'Europe", () => {
    expect(parseGetiText("lft dps, de NA à EU").regions).toEqual(["EU", "NA"]);
  });

  it("« ouvert à tout EU » garde l'Europe", () => {
    expect(parseGetiText("ouvert à tout EU").regions).toEqual(["EU"]);
  });

  it("« plus EU que NA » garde l'Europe", () => {
    expect(parseGetiText("plus EU que NA").regions).toEqual(["EU", "NA"]);
  });

  it("« il a eu » n'est pas l'Europe", () => {
    expect(parseGetiText("il a eu une team NA").regions).toEqual(["NA"]);
  });

  it("« The Owls » en capitales derrière « équipe » est un nom", () => {
    expect(parseGetiText("notre équipe The Owls recrute").teamName).toBe("The Owls");
  });

  it("« La Horde » en capitales derrière « team » est un nom", () => {
    expect(parseGetiText("notre team La Horde cherche un tank").teamName).toBe("La Horde");
  });

  it("un pronom anglais en capitale finit un nom (« Team Game I »)", () => {
    expect(parseGetiText("Team Game I recrute").teamName).toBe("Game I");
  });

  it("un pronom anglais n'ouvre pas un nom (« team We are looking »)", () => {
    expect(parseGetiText("team We are looking").teamName).toBeNull();
  });
});
