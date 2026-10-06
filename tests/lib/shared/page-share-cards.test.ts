/**
 * Cartes d'aperçu par page (`lib/shared/page-share-cards.ts`,
 * `docs/features/SHARE_METADATA.md` § « Une carte par page ») : registre des
 * clés, adresses par langue, rédaction FR/EN, podium et ses replis.
 */
import { describe, expect, it } from "@jest/globals";
import { localizedRuleModes } from "@/lib/shared/tournament-rules";
import { RULE_MODE_DEFINITIONS } from "@/lib/shared/rule-mode-definitions";
import {
  PAGE_SHARE_CARD_KEYS,
  PAGE_SHARE_CARD_STYLES,
  PODIUM_NAME_MAX_LENGTH,
  RULE_MODE_SUBTITLE_MAX_LENGTH,
  shareTagline,
  allShareCardKeys,
  pageShareImagePath,
  parseShareImageSegments,
  podiumShareEntries,
  resolvePageShareCard,
  ruleModeShareCardKey,
  TEAM_SHARE_NAME_MAX_LENGTH,
  parseTeamShareCardKey,
  teamShareCard,
  teamShareCardKey,
  type ShareMessages,
} from "@/lib/shared/page-share-cards";
import { SITE_SHARE_CARD } from "@/lib/shared/share-metadata";
import enRules from "@/messages/en/rules.json";
import enShare from "@/messages/en/share.json";
import frRules from "@/messages/fr/rules.json";
import frShare from "@/messages/fr/share.json";

const LOCALES: [string, ShareMessages, typeof frRules][] = [
  ["fr", frShare, frRules],
  ["en", enShare, enRules],
];

function modeTexts(rules: typeof frRules) {
  return new Map(localizedRuleModes(rules).map((mode) => [mode.slug, mode]));
}

describe("registre des cartes", () => {
  it("compte une carte fixe par page, puis une par mode de règles", () => {
    expect(allShareCardKeys()).toEqual([
      ...PAGE_SHARE_CARD_KEYS,
      ...RULE_MODE_DEFINITIONS.map((mode) => `rules-${mode.slug}`),
    ]);
    expect(new Set(allShareCardKeys()).size).toBe(allShareCardKeys().length);
  });

  it("garde la carte du site inchangée : accueil français = SITE_SHARE_CARD, sans motif", () => {
    expect(frShare.pages.home).toEqual(SITE_SHARE_CARD);
    expect(PAGE_SHARE_CARD_STYLES.home.motif).toBeNull();
  });

  it("donne un motif à chaque autre page", () => {
    for (const key of PAGE_SHARE_CARD_KEYS.filter((k) => k !== "home")) {
      expect(PAGE_SHARE_CARD_STYLES[key].motif).not.toBeNull();
    }
  });
});

describe("adresses", () => {
  it("place la langue dans le chemin", () => {
    expect(pageShareImagePath("ranking")).toBe("/og/fr/ranking.png");
    expect(pageShareImagePath("ranking", "en")).toBe("/og/en/ranking.png");
    expect(pageShareImagePath(ruleModeShareCardKey("bluegenji-survie"), "en")).toBe("/og/en/rules-bluegenji-survie.png");
  });

  it("lit une adresse connue", () => {
    expect(parseShareImageSegments("en", "ranking.png")).toEqual({ locale: "en", key: "ranking" });
    expect(parseShareImageSegments("fr", "rules-double-elimination.png")).toEqual({ locale: "fr", key: "rules-double-elimination" });
  });

  it.each([
    ["langue inconnue", "de", "ranking.png"],
    ["langue en majuscules", "EN", "ranking.png"],
    ["sans extension", "fr", "ranking"],
    ["autre extension", "fr", "ranking.jpg"],
    ["carte inconnue", "fr", "admin.png"],
    ["mode inconnu", "fr", "rules-inconnu.png"],
    ["traversée", "fr", "..%2Franking.png"],
  ])("refuse %s", (_label, locale, file) => {
    expect(parseShareImageSegments(locale, file)).toBeNull();
  });
});

describe.each(LOCALES)("rédaction (%s)", (_locale, messages, rules) => {
  it.each(allShareCardKeys())("la carte %s a un surtitre, un titre, une accroche et un pied", (key) => {
    const card = resolvePageShareCard(key, messages, modeTexts(rules));
    expect(card).not.toBeNull();
    for (const text of [card!.eyebrow, card!.title, card!.subtitle, card!.footer]) {
      expect(text.trim().length).toBeGreaterThan(0);
      // Aucun espace réservé ICU laissé brut dans une image.
      expect(text).not.toMatch(/[{}]/);
    }
  });

  it("rend null pour une clé inconnue", () => {
    expect(resolvePageShareCard("nope", messages, modeTexts(rules))).toBeNull();
    expect(resolvePageShareCard("rules-nope", messages, modeTexts(rules))).toBeNull();
  });

  it("borne l'accroche d'un mode sur un mot", () => {
    for (const mode of RULE_MODE_DEFINITIONS) {
      const card = resolvePageShareCard(ruleModeShareCardKey(mode.slug), messages, modeTexts(rules))!;
      expect(card.subtitle.length).toBeLessThanOrEqual(RULE_MODE_SUBTITLE_MAX_LENGTH);
    }
  });
});

describe("shareTagline", () => {
  it("rend une accroche courte inchangée (espaces aplatis)", () => {
    expect(shareTagline("Un  arbre\nà huit.", 50)).toBe("Un arbre à huit.");
  });

  it("garde les phrases entières qui tiennent", () => {
    const text = "Un capital qui fond à chaque map perdue. Personne n'est coupé : on sort quand son capital tombe à zéro.";
    expect(shareTagline(text, 60)).toBe("Un capital qui fond à chaque map perdue.");
  });

  it("coupe sur un mot quand la première phrase est trop longue", () => {
    const text = "Une très longue première phrase qui ne finit jamais avant la limite. Fin.";
    const cut = shareTagline(text, 30);
    expect(cut.endsWith("…")).toBe(true);
    expect(Array.from(cut).length).toBeLessThanOrEqual(30);
  });

  it("ignore une fin de phrase trop tôt (moins d'un tiers de la limite)", () => {
    const cut = shareTagline("Oui. Une suite assez longue pour dépasser la limite fixée ici.", 40);
    expect(cut.startsWith("Oui. Une")).toBe(true);
    expect(cut.endsWith("…")).toBe(true);
  });

  it("accepte une phrase qui finit pile sur la limite", () => {
    expect(shareTagline("Douze lettr. Et la suite.", 12)).toBe("Douze lettr.");
  });
});

describe("langues", () => {
  it("écrit l'anglais sous /en : nom du mode traduit selon le glossaire", () => {
    const card = resolvePageShareCard("rules-bluegenji-survie", enShare, modeTexts(enRules))!;
    expect(card.title).toBe("BlueGenji's Survival");
    expect(card.footer).toBe("Nonprofit association");
    expect(resolvePageShareCard("ranking", enShare, modeTexts(enRules))!.title).toBe("Team ranking");
  });

  it("ne laisse aucune carte anglaise identique à la française (hors noms propres)", () => {
    const same = PAGE_SHARE_CARD_KEYS.filter((key) => frShare.pages[key].subtitle === enShare.pages[key].subtitle);
    expect(same).toEqual([]);
  });
});

describe("cartes de l'espace membre", () => {
  it.each(["teams", "team", "players", "player", "tournaments"] as const)(
    "la carte %s est générique : ni nom ni pseudo, rien que la rubrique",
    (key) => {
      for (const messages of [frShare, enShare]) {
        const text = JSON.stringify(messages.pages[key]);
        expect(text).not.toMatch(/Test_|#\d|@/);
      }
    },
  );

  it("dit qu'il faut se connecter pour voir une fiche", () => {
    expect(frShare.pages.team.subtitle).toContain("Connexion requise");
    expect(enShare.pages.player.subtitle).toContain("Sign in");
  });
});

describe("podium", () => {
  const rows = [
    { teamName: "Alpha", points: 1240.4, logoSrc: "data:image/png;base64,AAAA" },
    { teamName: "Bravo", points: 1180, logoSrc: null },
    { teamName: "Charlie", points: 1100, logoSrc: null },
    { teamName: "Delta", points: 1000, logoSrc: null },
  ];

  it("garde les trois premières, dans l'ordre, avec leur marche dans la langue", () => {
    const fr = podiumShareEntries(rows, frShare)!;
    expect(fr.map((entry) => [entry.place, entry.placeLabel, entry.name, entry.points])).toEqual([
      [1, "1re", "Alpha", "1240 pts"],
      [2, "2e", "Bravo", "1180 pts"],
      [3, "3e", "Charlie", "1100 pts"],
    ]);
    expect(podiumShareEntries(rows, enShare)!.map((entry) => entry.placeLabel)).toEqual(["1st", "2nd", "3rd"]);
    expect(fr[0].logoSrc).toBe("data:image/png;base64,AAAA");
  });

  it.each([0, 1, 2])("rend null sous trois équipes (%i) : la carte de la page prend le relais", (count) => {
    expect(podiumShareEntries(rows.slice(0, count), frShare)).toBeNull();
  });

  it("coupe un nom long sur un mot, avec une ellipse", () => {
    const long = "Les Invincibles Chevaliers De La Table Ronde Esport";
    const [first] = podiumShareEntries([{ ...rows[0], teamName: long }, rows[1], rows[2]], frShare)!;
    expect(Array.from(first.name).length).toBeLessThanOrEqual(PODIUM_NAME_MAX_LENGTH);
    expect(first.name.endsWith("…")).toBe(true);
    expect(long.startsWith(first.name.slice(0, -1))).toBe(true);
  });

  it("nettoie un nom saisi (visibleText) et remplace un nom invisible", () => {
    const entries = podiumShareEntries(
      [
        { ...rows[0], teamName: "Al\u200Bpha\u202E" },
        { ...rows[1], teamName: "\u200B\u200B" },
        { ...rows[2], teamName: "élan" },
      ],
      frShare,
    )!;
    expect(entries[0].name).toBe("Alpha");
    expect(entries[1].name).toBe("?");
    expect(entries[2].initial).toBe("É");
  });
});

describe("carte nominative d'une équipe", () => {
  const team = { teamName: "Dragon Squad", wins: 12, losses: 3, draws: 0, points: 1240.4 };

  it("nomme la clé team-<id> et la relit", () => {
    expect(teamShareCardKey(42)).toBe("team-42");
    expect(parseTeamShareCardKey("team-42")).toBe(42);
    expect(pageShareImagePath(teamShareCardKey(42))).toBe("/og/fr/team-42.png");
  });

  it.each(["team-0", "team-007", "team--1", "team-1.5", "team-12345678901", "team-", "team-abc", "team-42/../x", " team-4"])(
    "refuse la clé %s",
    (key) => {
      expect(parseTeamShareCardKey(key)).toBeNull();
      expect(parseShareImageSegments("fr", `${key}.png`)).toBeNull();
    },
  );

  it("sert la clé d'équipe dans les deux langues, extension exigée", () => {
    expect(parseShareImageSegments("en", "team-42.png")).toEqual({ locale: "en", key: "team-42" });
    expect(parseShareImageSegments("fr", "team-42")).toBeNull();
    expect(parseShareImageSegments("de", "team-42.png")).toBeNull();
  });

  it("retombe sur la carte générique de la fiche, qui ne dit pas si l'équipe existe", () => {
    const fallback = resolvePageShareCard("team-42", frShare, modeTexts(frRules))!;
    expect(fallback.title).toBe(frShare.pages.team.title);
    expect(fallback.motif).toBe(PAGE_SHARE_CARD_STYLES.team.motif);
  });

  it("écrit nom, cote et bilan comme le classement, en français", () => {
    const card = teamShareCard(team, frShare);
    expect(card).toMatchObject({ eyebrow: "Équipe", title: "Dragon Squad", initial: "D", footer: "Association loi 1901" });
    expect(card.facts).toEqual([
      { label: "Cote", value: "1240 pts" },
      { label: "Bilan", value: "12 V · 3 D" },
    ]);
  });

  it("écrit la carte en anglais, nuls compris quand il y en a", () => {
    const card = teamShareCard({ ...team, draws: 2 }, enShare);
    expect(card).toMatchObject({ eyebrow: "Team", footer: "Nonprofit association" });
    expect(card.facts).toEqual([
      { label: "Rating", value: "1240 pts" },
      { label: "Record", value: "12 W · 3 L · 2 D" },
    ]);
  });

  it("nettoie un nom saisi (visibleText), le borne sur un mot, et remplace un nom invisible", () => {
    expect(teamShareCard({ ...team, teamName: "Dra​gon‮" }, frShare).title).toBe("Dragon");
    expect(teamShareCard({ ...team, teamName: "​" }, frShare)).toMatchObject({ title: "?", initial: "?" });
    const long = teamShareCard({ ...team, teamName: "Les Invincibles Chevaliers De La Table Ronde Du Grand Ouest" }, frShare);
    expect(Array.from(long.title).length).toBeLessThanOrEqual(TEAM_SHARE_NAME_MAX_LENGTH);
    expect(long.title.endsWith("…")).toBe(true);
  });

  it("ne parle d'aucun joueur", () => {
    for (const messages of [frShare, enShare]) {
      expect(JSON.stringify(messages.teamProfile)).not.toMatch(/joueur|player|pseudo|avatar/iu);
    }
  });

  it("existe en français et en anglais, mêmes clés", () => {
    expect(Object.keys(enShare.teamProfile).sort((a, b) => a.localeCompare(b))).toEqual(
      Object.keys(frShare.teamProfile).sort((a, b) => a.localeCompare(b)),
    );
  });
});
