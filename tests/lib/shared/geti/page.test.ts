import { describe, expect, it } from "@jest/globals";
import type { GetiFilter } from "@/lib/shared/geti";
import {
  GETI_REFRESH_INTERVAL_MS,
  emptyGetiPageQuery,
  getiActiveFilterCount,
  getiAgeOptions,
  getiAllRanks,
  getiCategoryOfSlug,
  getiCategoryPath,
  getiChannelUrl,
  getiChipMatches,
  getiClockLabel,
  getiPageFilter,
  getiPageHref,
  getiPageSearch,
  getiPostBodyText,
  getiPostChips,
  getiRankSlug,
  getiRefreshIntervalMs,
  getiRelativeAge,
  getiTextIsLong,
  parseGetiPageQuery,
  parseGetiRankSlug,
  type GetiChip,
} from "@/lib/shared/geti/page";
import { getiRange, getiRank, parsedGetiPost } from "@/tests/helpers/geti";

const D3 = getiRank("DIAMOND", 3);
const M2 = getiRank("MASTER", 2);
const LABELS = { member: "@membre", role: "@rôle", channel: "#salon" };

describe("adresses des catégories", () => {
  it("chaque catégorie a son adresse sous /geti-info", () => {
    expect(getiCategoryPath("lfsub")).toBe("/geti-info/lfsub");
  });

  it("un sigle connu désigne sa catégorie", () => {
    expect(getiCategoryOfSlug("lfs")).toBe("lfs");
  });

  it("un sigle en capitales est reconnu", () => {
    expect(getiCategoryOfSlug("LFT")).toBe("lft");
  });

  it("un segment inconnu ne désigne aucune catégorie", () => {
    expect(getiCategoryOfSlug("joueur")).toBeNull();
  });

  it("un segment absent ne désigne aucune catégorie", () => {
    expect(getiCategoryOfSlug(null)).toBeNull();
  });

  it("le lien de publication mène au salon de la catégorie sur notre serveur", () => {
    expect(getiChannelUrl("lfcast")).toBe("https://discord.com/channels/676570513023172637/1085116755925536828");
  });

  it("l'adresse d'une catégorie porte ses filtres", () => {
    const query = { ...emptyGetiPageQuery(), regions: ["EU" as const] };

    expect(getiPageHref("lfp", query)).toBe("/geti-info/lfp?reg=eu");
  });

  it("sans filtres, l'adresse est celle de la catégorie", () => {
    expect(getiPageHref("lfp")).toBe("/geti-info/lfp");
  });
});

describe("getiAgeOptions", () => {
  it("un scrim, gardé 7 jours, ne propose que 1 et 3 jours", () => {
    expect(getiAgeOptions("lfs")).toEqual([1, 3]);
  });

  it("une catégorie gardée 14 jours propose aussi 7 jours", () => {
    expect(getiAgeOptions("lfp")).toEqual([1, 3, 7]);
  });
});

describe("rang dans l'adresse", () => {
  it("un rang s'écrit palier-division", () => {
    expect(getiRankSlug(M2)).toBe("master-2");
  });

  it("une écriture valide est relue", () => {
    expect(parseGetiRankSlug("emerald-5")).toEqual({ tier: "EMERALD", division: 5 });
  });

  it("un palier inconnu n'est pas un rang", () => {
    expect(parseGetiRankSlug("mythic-3")).toBeNull();
  });

  it("la division 0 n'existe pas", () => {
    expect(parseGetiRankSlug("gold-0")).toBeNull();
  });

  it("la division 6 n'existe pas", () => {
    expect(parseGetiRankSlug("gold-6")).toBeNull();
  });

  it("une valeur absente n'est pas un rang", () => {
    expect(parseGetiRankSlug(undefined)).toBeNull();
  });

  it("la liste des rangs va de Bronze 5 à Champion 1", () => {
    const ranks = getiAllRanks();

    expect(ranks).toHaveLength(45);
    expect(ranks[0]).toEqual({ tier: "BRONZE", division: 5 });
    expect(ranks[44]).toEqual({ tier: "CHAMPION", division: 1 });
  });
});

describe("parseGetiPageQuery", () => {
  it("une adresse sans paramètre rend l'état vide", () => {
    expect(parseGetiPageQuery("lfp", {})).toEqual(emptyGetiPageQuery());
  });

  it("une liste séparée par des virgules est lue dans l'ordre du domaine", () => {
    expect(parseGetiPageQuery("lfp", { role: "dps,tank" }).roles).toEqual(["TANK", "DPS"]);
  });

  it("un paramètre répété (formulaire sans JavaScript) est lu de même", () => {
    expect(parseGetiPageQuery("lfp", { reg: ["eu", "na"] }).regions).toEqual(["EU", "NA"]);
  });

  it("une valeur inconnue est ignorée", () => {
    expect(parseGetiPageQuery("lfp", { plat: "pc,minitel" }).platforms).toEqual(["PC"]);
  });

  it("un filtre que la catégorie ne propose pas est ignoré", () => {
    expect(parseGetiPageQuery("lfcast", { role: "tank", rmin: "gold-1" })).toEqual(emptyGetiPageQuery());
  });

  it("le rôle de staff est lu dans la catégorie staff", () => {
    expect(parseGetiPageQuery("lfstaff", { staff: "coach" }).staffRoles).toEqual(["COACH"]);
  });

  it("des bornes de rang inversées sont remises dans l'ordre", () => {
    const query = parseGetiPageQuery("lfp", { rmin: "master-2", rmax: "diamond-3" });

    expect([query.rankMin, query.rankMax]).toEqual([D3, M2]);
  });

  it("des heures inversées sont remises dans l'ordre", () => {
    const query = parseGetiPageQuery("lfs", { hfrom: "23", hto: "20" });

    expect([query.hourFrom, query.hourTo]).toEqual([20, 23]);
  });

  it("24 h est une heure valide", () => {
    expect(parseGetiPageQuery("lfs", { hto: "24" }).hourTo).toBe(24);
  });

  it("25 h est ignoré", () => {
    expect(parseGetiPageQuery("lfs", { hto: "25" }).hourTo).toBeNull();
  });

  it("un âge proposé par la catégorie est gardé", () => {
    expect(parseGetiPageQuery("lfp", { age: "7" }).ageDays).toBe(7);
  });

  it("un âge égal à la durée de garde d'un scrim n'est pas un filtre", () => {
    expect(parseGetiPageQuery("lfs", { age: "7" }).ageDays).toBeNull();
  });

  it("un âge hors des choix est ignoré", () => {
    expect(parseGetiPageQuery("lfp", { age: "2" }).ageDays).toBeNull();
  });

  it("seul « 1 » active l'affichage des annonces closes", () => {
    expect(parseGetiPageQuery("lfp", { closed: "1" }).showClosed).toBe(true);
    expect(parseGetiPageQuery("lfp", { closed: "true" }).showClosed).toBe(false);
  });

  it("« strict=1 » écarte les annonces incomplètes", () => {
    expect(parseGetiPageQuery("lfp", { strict: "1" }).strict).toBe(true);
  });

  it("la page 0 revient à la première", () => {
    expect(parseGetiPageQuery("lfp", { p: "0" }).page).toBe(1);
  });

  it("une page illisible revient à la première", () => {
    expect(parseGetiPageQuery("lfp", { p: "deux" }).page).toBe(1);
  });

  it("une page valide est gardée", () => {
    expect(parseGetiPageQuery("lfp", { p: "3" }).page).toBe(3);
  });
});

describe("getiPageSearch", () => {
  it("l'état vide n'écrit rien", () => {
    expect(getiPageSearch(emptyGetiPageQuery())).toBe("");
  });

  it("les critères s'écrivent en minuscules, virgules lisibles, dans un ordre stable", () => {
    const query = {
      ...emptyGetiPageQuery(),
      rankMin: D3,
      roles: ["TANK" as const, "DPS" as const],
      hourFrom: 20,
      ageDays: 3,
      showClosed: true,
      strict: true,
      page: 2,
    };

    expect(getiPageSearch(query)).toBe("?rmin=diamond-3&role=tank,dps&hfrom=20&age=3&closed=1&strict=1&p=2");
  });

  it("l'adresse écrite se relit à l'identique", () => {
    const query = {
      ...emptyGetiPageQuery(),
      rankMax: M2,
      subRoles: ["HITSCAN" as const],
      levels: ["ADVANCED" as const],
      languages: ["FR" as const, "EN" as const],
      days: ["TUE" as const],
      hourTo: 23,
    };
    const params = Object.fromEntries(new URLSearchParams(getiPageSearch(query)));

    expect(parseGetiPageQuery("lfp", params)).toEqual(query);
  });
});

describe("getiActiveFilterCount", () => {
  it("l'état vide ne compte aucun filtre", () => {
    expect(getiActiveFilterCount(emptyGetiPageQuery())).toBe(0);
  });

  it("la page ne compte pas", () => {
    expect(getiActiveFilterCount({ ...emptyGetiPageQuery(), page: 4 })).toBe(0);
  });

  it("deux bornes de rang comptent pour un seul filtre, chaque autre critère pour un", () => {
    const query = { ...emptyGetiPageQuery(), rankMin: D3, rankMax: M2, roles: ["TANK" as const], strict: true };

    expect(getiActiveFilterCount(query)).toBe(3);
  });
});

describe("getiPageFilter", () => {
  it("par défaut les annonces closes sont écartées et les incomplètes gardées", () => {
    const filter = getiPageFilter("lfp", emptyGetiPageQuery());

    expect(filter).toMatchObject({ category: "lfp", hideClosed: true, includeUnknown: true, ranks: null, time: null, maxAgeHours: null });
  });

  it("« strict » écarte les annonces incomplètes", () => {
    expect(getiPageFilter("lfp", { ...emptyGetiPageQuery(), strict: true }).includeUnknown).toBe(false);
  });

  it("« annonces closes » les laisse passer", () => {
    expect(getiPageFilter("lfp", { ...emptyGetiPageQuery(), showClosed: true }).hideClosed).toBe(false);
  });

  it("les heures deviennent des minutes, une borne absente reste ouverte", () => {
    expect(getiPageFilter("lfs", { ...emptyGetiPageQuery(), hourFrom: 20 }).time).toEqual({ from: 1200, to: null });
  });

  it("l'âge en jours devient un âge en heures", () => {
    expect(getiPageFilter("lfp", { ...emptyGetiPageQuery(), ageDays: 3 }).maxAgeHours).toBe(72);
  });

  it("une seule borne de rang suffit à filtrer", () => {
    expect(getiPageFilter("lfp", { ...emptyGetiPageQuery(), rankMax: M2 }).ranks).toEqual({ min: null, max: M2 });
  });
});

describe("getiPostChips", () => {
  it("une annonce où rien n'a été lu n'a aucune étiquette", () => {
    expect(getiPostChips(parsedGetiPost())).toEqual([]);
  });

  it("la fourchette globale donne une étiquette de rang sans rôle", () => {
    const post = parsedGetiPost({ ranks: { min: D3, max: M2, byRole: {} } });

    expect(getiPostChips(post)).toEqual([{ kind: "rank", role: null, min: D3, max: M2 }]);
  });

  it("des rangs par rôle remplacent la fourchette globale", () => {
    const post = parsedGetiPost({ ranks: { min: D3, max: M2, byRole: { DPS: getiRange(M2), TANK: getiRange(D3) } } });

    expect(getiPostChips(post)).toEqual([
      { kind: "rank", role: "TANK", min: D3, max: D3 },
      { kind: "rank", role: "DPS", min: M2, max: M2 },
    ]);
  });

  it("l'équipe vient en tête, puis les données dans l'ordre d'affichage", () => {
    const post = parsedGetiPost({
      teamName: "Team Test",
      roles: ["SUPPORT"],
      subRoles: ["MAIN_SUPPORT"],
      staffRoles: ["COACH"],
      levels: ["OPEN"],
      regions: ["EU"],
      platforms: ["PC"],
      languages: ["FR"],
      availability: { days: ["MON"], times: [{ from: 1260, to: 1380 }], timezone: "CET" },
      dates: ["2026-11-26"],
      minAge: 18,
    });

    expect(getiPostChips(post).map((chip) => chip.kind)).toEqual([
      "team", "role", "subRole", "staffRole", "level", "region", "platform", "language", "day", "time", "date", "minAge",
    ]);
  });

  it("au plus quatre horaires sont montrés", () => {
    const times = [1, 2, 3, 4, 5].map((hour) => ({ from: hour * 60, to: null }));
    const post = parsedGetiPost({ availability: { days: [], times, timezone: null } });

    expect(getiPostChips(post)).toHaveLength(4);
  });

  it("au plus quatre dates sont montrées", () => {
    const post = parsedGetiPost({ dates: ["2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25"] });

    expect(getiPostChips(post)).toHaveLength(4);
  });
});

describe("getiChipMatches", () => {
  const rankChip: GetiChip = { kind: "rank", role: null, min: D3, max: M2 };

  it("sans critère actif, rien n'est mis en avant", () => {
    expect(getiChipMatches(rankChip, {})).toBe(false);
  });

  it("un rang dont la fourchette touche la borne basse voulue est mis en avant", () => {
    expect(getiChipMatches(rankChip, { ranks: { min: M2 } })).toBe(true);
  });

  it("un rang entièrement sous la borne basse voulue ne l'est pas", () => {
    expect(getiChipMatches(rankChip, { ranks: { min: getiRank("MASTER", 1) } })).toBe(false);
  });

  it("un rang entièrement au-dessus de la borne haute voulue ne l'est pas", () => {
    expect(getiChipMatches(rankChip, { ranks: { max: getiRank("DIAMOND", 4) } })).toBe(false);
  });

  it("le rôle voulu est mis en avant", () => {
    expect(getiChipMatches({ kind: "role", value: "TANK" }, { roles: ["TANK"] })).toBe(true);
  });

  it("un autre rôle ne l'est pas", () => {
    expect(getiChipMatches({ kind: "role", value: "DPS" }, { roles: ["TANK"] })).toBe(false);
  });

  it("« Flex » répond à tout rôle voulu", () => {
    expect(getiChipMatches({ kind: "role", value: "FLEX" }, { roles: ["TANK"] })).toBe(true);
  });

  it("« Flex » n'est pas mis en avant sans rôle voulu", () => {
    expect(getiChipMatches({ kind: "role", value: "FLEX" }, { roles: [] })).toBe(false);
  });

  it("chaque critère à liste met en avant sa valeur", () => {
    const filter: GetiFilter = {
      subRoles: ["HITSCAN"],
      staffRoles: ["COACH"],
      levels: ["EXPERT"],
      regions: ["NA"],
      platforms: ["CONSOLE"],
      languages: ["EN"],
      days: ["SUN"],
    };

    expect(getiChipMatches({ kind: "subRole", value: "HITSCAN" }, filter)).toBe(true);
    expect(getiChipMatches({ kind: "staffRole", value: "COACH" }, filter)).toBe(true);
    expect(getiChipMatches({ kind: "level", value: "EXPERT" }, filter)).toBe(true);
    expect(getiChipMatches({ kind: "region", value: "NA" }, filter)).toBe(true);
    expect(getiChipMatches({ kind: "platform", value: "CONSOLE" }, filter)).toBe(true);
    expect(getiChipMatches({ kind: "language", value: "EN" }, filter)).toBe(true);
    expect(getiChipMatches({ kind: "day", value: "SUN" }, filter)).toBe(true);
  });

  it("une valeur hors du critère n'est pas mise en avant", () => {
    expect(getiChipMatches({ kind: "region", value: "EU" }, { regions: ["NA"] })).toBe(false);
  });

  it("un horaire qui recoupe le créneau voulu est mis en avant", () => {
    const chip: GetiChip = { kind: "time", from: 1260, to: 1380, timezone: null };

    expect(getiChipMatches(chip, { time: { from: 1380, to: 1440 } })).toBe(true);
  });

  it("un horaire hors du créneau ne l'est pas", () => {
    const chip: GetiChip = { kind: "time", from: 1260, to: 1380, timezone: null };

    expect(getiChipMatches(chip, { time: { from: 600, to: 1200 } })).toBe(false);
  });

  it("une heure seule doit tomber dans le créneau", () => {
    const chip: GetiChip = { kind: "time", from: 1260, to: null, timezone: null };

    expect(getiChipMatches(chip, { time: { from: 1200 } })).toBe(true);
    expect(getiChipMatches(chip, { time: { to: 1200 } })).toBe(false);
  });

  it("un horaire qui passe minuit court jusqu'à la fin de la journée", () => {
    const chip: GetiChip = { kind: "time", from: 1320, to: 60, timezone: null };

    expect(getiChipMatches(chip, { time: { from: 1400 } })).toBe(true);
  });

  it("une équipe, une date ou un âge ne sont jamais mis en avant", () => {
    const filter: GetiFilter = { roles: ["TANK"], regions: ["EU"] };

    expect(getiChipMatches({ kind: "team", name: "Team Test" }, filter)).toBe(false);
    expect(getiChipMatches({ kind: "date", iso: "2026-11-26" }, filter)).toBe(false);
    expect(getiChipMatches({ kind: "minAge", age: 18 }, filter)).toBe(false);
  });
});

describe("getiClockLabel", () => {
  it("une heure ronde s'écrit sans minutes", () => {
    expect(getiClockLabel(1260)).toBe("21h");
  });

  it("les minutes s'écrivent sur deux chiffres", () => {
    expect(getiClockLabel(1205)).toBe("20h05");
  });

  it("minuit en fin de journée s'écrit 0h", () => {
    expect(getiClockLabel(1440)).toBe("0h");
  });
});

describe("getiPostBodyText", () => {
  it("les marques de citation du relais sont retirées", () => {
    expect(getiPostBodyText("> LFP tank\n> EU, PC", LABELS)).toBe("LFP tank\nEU, PC");
  });

  it("une mention de membre devient un mot neutre, sans identifiant", () => {
    expect(getiPostBodyText("contact <@123456789012345678> ou <@!42>", LABELS)).toBe("contact @membre ou @membre");
  });

  it("une mention de rôle et de salon deviennent des mots neutres", () => {
    expect(getiPostBodyText("<@&555> voir <#777>", LABELS)).toBe("@rôle voir #salon");
  });

  it("un émoji de serveur ne garde que son nom", () => {
    expect(getiPostBodyText("gg <:pog:123> <a:wave:456>", LABELS)).toBe("gg :pog: :wave:");
  });

  it("le balisage Discord est retiré, le texte reste", () => {
    expect(getiPostBodyText("**LFS** __ce soir__ ~~annulé~~ ||secret|| `code`", LABELS)).toBe("LFS ce soir annulé secret code");
  });

  it("un titre et un sous-texte Discord perdent leur marque", () => {
    expect(getiPostBodyText("# Recrutement\n-# petit texte", LABELS)).toBe("Recrutement\npetit texte");
  });

  it("un horodatage Discord est retiré", () => {
    expect(getiPostBodyText("scrim <t:1764270000:R> ok", LABELS)).toBe("scrim  ok");
  });

  it("les lignes vides en rafale sont réduites à une", () => {
    expect(getiPostBodyText("a\n\n\n\nb", LABELS)).toBe("a\n\nb");
  });

  it("un lien et du HTML restent du texte", () => {
    const text = "voir https://example.com <script>alert(1)</script>";

    expect(getiPostBodyText(text, LABELS)).toBe(text);
  });
});

describe("getiTextIsLong", () => {
  it("420 caractères tiennent sans repli", () => {
    expect(getiTextIsLong("a".repeat(420))).toBe(false);
  });

  it("421 caractères sont repliés", () => {
    expect(getiTextIsLong("a".repeat(421))).toBe(true);
  });

  it("7 lignes tiennent sans repli", () => {
    expect(getiTextIsLong("a\na\na\na\na\na\na")).toBe(false);
  });

  it("8 lignes sont repliées", () => {
    expect(getiTextIsLong("a\na\na\na\na\na\na\na")).toBe(true);
  });
});

describe("getiRelativeAge", () => {
  const NOW = Date.parse("2026-11-27T12:00:00.000Z");

  it("moins d'une heure se compte en minutes", () => {
    expect(getiRelativeAge("2026-11-27T11:01:00.000Z", NOW)).toEqual({ value: -59, unit: "minute" });
  });

  it("une heure pile se compte en heures", () => {
    expect(getiRelativeAge("2026-11-27T11:00:00.000Z", NOW)).toEqual({ value: -1, unit: "hour" });
  });

  it("23 heures restent des heures", () => {
    expect(getiRelativeAge("2026-11-26T13:00:00.000Z", NOW)).toEqual({ value: -23, unit: "hour" });
  });

  it("24 heures deviennent un jour", () => {
    expect(getiRelativeAge("2026-11-26T12:00:00.000Z", NOW)).toEqual({ value: -1, unit: "day" });
  });

  it("une date à venir vaut maintenant", () => {
    expect(getiRelativeAge("2026-11-27T13:00:00.000Z", NOW)).toEqual({ value: -0, unit: "minute" });
  });

  it("une date illisible n'a pas d'âge", () => {
    expect(getiRelativeAge("hier", NOW)).toBeNull();
  });
});

describe("getiRefreshIntervalMs", () => {
  it("le régime plein garde la relecture de fond", () => {
    expect(getiRefreshIntervalMs("FULL")).toBe(GETI_REFRESH_INTERVAL_MS);
  });

  it("un régime économe ne relit qu'au retour sur l'onglet", () => {
    expect(getiRefreshIntervalMs("ECO")).toBeNull();
  });
});
