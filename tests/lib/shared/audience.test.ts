import { describe, expect, it } from "@jest/globals";
import {
  aggregateAudienceDay,
  audiencePageKey,
  deviceFromWidth,
  fillDailySeries,
  fillTemplate,
  formatDuration,
  groupDaily,
  heatmapMargins,
  isBotUserAgent,
  kpisOf,
  parseAudienceBatch,
  percentShares,
  rangeStart,
  relativeChange,
  sourceFromReferrerHost,
  type AudienceDailyPoint,
  type AudienceRawRow,
} from "@/lib/shared/audience";

/** Statistiques de fréquentation détaillées, registre T19 (`docs/features/AUDIENCE_MEASUREMENT.md`). */

function row(overrides: Partial<AudienceRawRow>): AudienceRawRow {
  return {
    viewedAt: new Date("2026-11-10T10:00:00Z"),
    hour: 11,
    visitorKey: "a",
    pageKey: "home",
    locale: "fr",
    device: "mobile",
    source: "internal",
    isView: true,
    engagedMs: 1000,
    ...overrides,
  };
}

function point(day: string, visitors: number): AudienceDailyPoint {
  return { day, views: visitors * 2, visitors, visits: visitors, bounces: 0, engagedMs: 0 };
}

describe("audiencePageKey", () => {
  it("ne garde que le gabarit d'une fiche de joueur, sans pseudo ni paramètres", () => {
    expect(audiencePageKey("/joueurs/Test_Pseudo?x=1#a")).toEqual({ key: "player", locale: "fr" });
  });

  it("lit la langue anglaise et ignore la barre finale", () => {
    expect(audiencePageKey("/en/regles/")).toEqual({ key: "rules", locale: "en" });
  });

  it("range l'accueil anglais sous home", () => {
    expect(audiencePageKey("/en")).toEqual({ key: "home", locale: "en" });
  });

  it("ne mesure ni la page de fréquentation, ni l'API, ni les ressources", () => {
    expect(audiencePageKey("/frequentation")).toBeNull();
    expect(audiencePageKey("/en/frequentation")).toBeNull();
    expect(audiencePageKey("/api/audience")).toBeNull();
    expect(audiencePageKey("/_next/static/a.js")).toBeNull();
    expect(audiencePageKey("/og/tournoi")).toBeNull();
  });

  it("refuse une valeur qui n'est pas un chemin absolu", () => {
    expect(audiencePageKey(42)).toBeNull();
    expect(audiencePageKey("regles")).toBeNull();
    expect(audiencePageKey("https://ailleurs.example/")).toBeNull();
  });

  it("borne la longueur à 512 caractères", () => {
    expect(audiencePageKey(`/${"a".repeat(511)}`)).toEqual({ key: "other", locale: "fr" });
    expect(audiencePageKey(`/${"a".repeat(512)}`)).toBeNull();
  });

  it("range une adresse inconnue sous other", () => {
    expect(audiencePageKey("/nulle-part")).toEqual({ key: "other", locale: "fr" });
  });

  it("distingue tournoi, match et autres pages de tournoi", () => {
    expect(audiencePageKey("/tournois/12")?.key).toBe("tournament");
    expect(audiencePageKey("/tournois/12/matchs/3")?.key).toBe("match");
    expect(audiencePageKey("/tournois/12/inscription")?.key).toBe("tournamentOther");
  });
});

describe("deviceFromWidth", () => {
  it("classe l'écran aux bornes 640 et 1024", () => {
    expect(deviceFromWidth(639)).toBe("mobile");
    expect(deviceFromWidth(640)).toBe("tablet");
    expect(deviceFromWidth(1023)).toBe("tablet");
    expect(deviceFromWidth(1024)).toBe("desktop");
  });

  it("prend l'ordinateur pour une largeur illisible", () => {
    expect(deviceFromWidth(Number.NaN)).toBe("desktop");
    expect(deviceFromWidth("375")).toBe("desktop");
  });
});

describe("sourceFromReferrerHost", () => {
  it("réduit l'hôte du référent à sa famille", () => {
    expect(sourceFromReferrerHost("www.google.fr")).toBe("search");
    expect(sourceFromReferrerHost("discord.com")).toBe("discord");
    expect(sourceFromReferrerHost("www.x.com")).toBe("social");
    expect(sourceFromReferrerHost("youtu.be")).toBe("video");
    expect(sourceFromReferrerHost("example.org")).toBe("other");
  });

  it("compte en accès direct une arrivée sans référent ou depuis le site", () => {
    expect(sourceFromReferrerHost(undefined)).toBe("direct");
    expect(sourceFromReferrerHost("")).toBe("direct");
    expect(sourceFromReferrerHost("www.bluegenji.fr", "bluegenji.fr")).toBe("direct");
  });

  it("ne prend pas un faux domaine Discord pour Discord", () => {
    expect(sourceFromReferrerHost("discord.com.example.org")).toBe("other");
  });
});

describe("isBotUserAgent", () => {
  it("écarte un navigateur absent ou un robot", () => {
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent("  ")).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isBotUserAgent("curl/8.4.0")).toBe(true);
  });

  it("garde un navigateur ordinaire", () => {
    expect(isBotUserAgent("Mozilla/5.0 (Windows NT 10.0) Firefox/130.0")).toBe(false);
  });
});

describe("parseAudienceBatch", () => {
  it("rend une liste vide pour un corps sans tableau", () => {
    expect(parseAudienceBatch(null)).toEqual([]);
    expect(parseAudienceBatch({ v: "x" })).toEqual([]);
  });

  it("garde la famille de provenance de la première page d'une arrivée", () => {
    const views = parseAudienceBatch({ v: [{ p: "/", t: 5000, a: 9000, d: "mobile", f: 1, r: "discord.gg" }] });

    expect(views).toEqual([
      { pageKey: "home", locale: "fr", device: "mobile", source: "discord", isView: true, engagedMs: 5000, ageMs: 9000, openedAgeMs: 9000 },
    ]);
  });

  it("marque une suite comme temps seul, en provenance interne", () => {
    const views = parseAudienceBatch({ v: [{ p: "/classement", t: 2000, a: 2000, d: "tablet", c: 1, f: 1, r: "google.fr" }] });

    expect(views[0]).toMatchObject({ isView: false, source: "internal" });
  });

  it("borne le temps à 30 minutes et ramène une ancienneté négative à zéro", () => {
    const views = parseAudienceBatch({ v: [{ p: "/", t: 99_999_999, a: -5, d: "?" }] });

    expect(views[0]).toMatchObject({ engagedMs: 1_800_000, ageMs: 0, device: "desktop", source: "internal" });
  });

  it("parseAudienceBatch_ageExactlyOneHour_kept", () => {
    expect(parseAudienceBatch({ v: [{ p: "/", t: 0, a: 3_600_000, d: "mobile" }] })[0].ageMs).toBe(3_600_000);
  });

  it("parseAudienceBatch_ageOverOneHour_droppedNotRedated", () => {
    expect(parseAudienceBatch({ v: [{ p: "/", t: 0, a: 3_600_001, d: "mobile" }] })).toEqual([]);
  });

  it("ne lit que les 20 premières entrées d'un envoi", () => {
    const entry = { p: "/", t: 1, a: 1, d: "mobile" };
    const list = Array.from({ length: 21 }, () => entry);

    expect(parseAudienceBatch({ v: list })).toHaveLength(20);
  });

  it("écarte une entrée illisible sans perdre les autres", () => {
    const views = parseAudienceBatch({ v: [null, 3, { p: "/api/x" }, { p: "/equipes", t: 1, a: 1, d: "mobile" }] });

    expect(views.map((view) => view.pageKey)).toEqual(["teams"]);
  });
});

describe("aggregateAudienceDay", () => {
  it("compte une visite sans rebond pour deux pages à moins de 30 minutes", () => {
    const result = aggregateAudienceDay([
      row({ viewedAt: new Date("2026-11-10T10:00:00Z"), source: "search" }),
      row({ viewedAt: new Date("2026-11-10T10:29:00Z"), pageKey: "ranking" }),
    ]);

    expect(result.totals).toEqual({ views: 2, visitors: 1, visits: 1, bounces: 0, engagedMs: 2000 });
  });

  it("ouvre une nouvelle visite à 30 minutes d'écart, chacune rebondie", () => {
    const result = aggregateAudienceDay([
      row({ viewedAt: new Date("2026-11-10T10:00:00Z") }),
      row({ viewedAt: new Date("2026-11-10T10:30:00Z") }),
    ]);

    expect(result.totals).toMatchObject({ visits: 2, bounces: 2 });
  });

  it("ajoute le temps d'une suite à sa page sans compter de vue", () => {
    const result = aggregateAudienceDay([
      row({ pageKey: "rules", engagedMs: 4000 }),
      row({ pageKey: "rules", isView: false, engagedMs: 6000, viewedAt: new Date("2026-11-10T10:05:00Z") }),
    ]);

    expect(result.pages).toEqual([{ pageKey: "rules", views: 1, visitors: 1, engagedMs: 10_000 }]);
    expect(result.totals).toMatchObject({ views: 1, engagedMs: 10_000 });
  });

  it("aggregateAudienceDay_longReadThenNextPage_oneVisitNoBounce", () => {
    const result = aggregateAudienceDay([
      row({ viewedAt: new Date("2026-11-10T10:00:00Z"), engagedMs: 0 }),
      row({ viewedAt: new Date("2026-11-10T10:35:00Z"), isView: false, engagedMs: 35 * 60_000 }),
      row({ viewedAt: new Date("2026-11-10T10:35:00Z"), pageKey: "tournaments", engagedMs: 0 }),
    ]);

    expect(result.totals).toMatchObject({ views: 2, visits: 1, bounces: 0 });
  });

  it("aggregateAudienceDay_returnAfterLongPause_closesPreviousVisit", () => {
    const result = aggregateAudienceDay([
      row({ viewedAt: new Date("2026-11-10T10:00:00Z"), engagedMs: 0 }),
      row({ viewedAt: new Date("2026-11-10T13:02:00Z"), isView: false, engagedMs: 2 * 60_000 }),
      row({ viewedAt: new Date("2026-11-10T13:10:00Z"), pageKey: "ranking", engagedMs: 0 }),
    ]);

    // Le temps lu au retour n'appartient à aucune visite : il n'est pas compté.
    expect(result.totals).toMatchObject({ views: 2, visits: 2, bounces: 2, engagedMs: 0 });
  });

  it("aggregateAudienceDay_continuationWithoutPriorView_opensNoVisit", () => {
    const result = aggregateAudienceDay([row({ isView: false, engagedMs: 5000 })]);

    expect(result.totals).toEqual({ views: 0, visitors: 0, visits: 0, bounces: 0, engagedMs: 0 });
    expect(result.pages).toEqual([]);
  });

  it("ne range pas la navigation interne parmi les provenances", () => {
    const result = aggregateAudienceDay([
      row({ source: "discord" }),
      row({ source: "internal", viewedAt: new Date("2026-11-10T10:01:00Z") }),
    ]);

    expect(result.dims.filter((dim) => dim.dim === "source")).toEqual([
      { dim: "source", value: "discord", views: 1, visitors: 1 },
    ]);
  });

  it("compte les visiteurs distincts par heure", () => {
    const result = aggregateAudienceDay([row({ visitorKey: "a" }), row({ visitorKey: "b" }), row({ visitorKey: "b" })]);

    expect(result.hours).toEqual([{ hour: 11, views: 3, visitors: 2 }]);
  });
});

describe("rangeStart", () => {
  it("donne le premier jour de chaque période", () => {
    expect(rangeStart("7d", "2026-11-15")).toBe("2026-11-09");
    expect(rangeStart("30d", "2026-11-15")).toBe("2026-10-17");
    expect(rangeStart("12m", "2026-11-15")).toBe("2025-11-16");
    expect(rangeStart("all", "2026-11-15")).toBeNull();
  });
});

describe("fillDailySeries", () => {
  it("met à zéro les jours sans ligne", () => {
    const series = fillDailySeries([point("2026-11-02", 4)], "2026-11-01", "2026-11-03");

    expect(series).toEqual([
      { day: "2026-11-01", views: 0, visitors: 0, visits: 0, bounces: 0, engagedMs: 0 },
      point("2026-11-02", 4),
      { day: "2026-11-03", views: 0, visitors: 0, visits: 0, bounces: 0, engagedMs: 0 },
    ]);
  });
});

describe("groupDaily", () => {
  it("additionne par semaine à partir du lundi", () => {
    const groups = groupDaily([point("2026-11-08", 1), point("2026-11-09", 2), point("2026-11-15", 3)], "week");

    expect(groups.map((group) => [group.key, group.visitors])).toEqual([
      ["2026-11-02", 1],
      ["2026-11-09", 5],
    ]);
  });

  it("additionne par mois", () => {
    const groups = groupDaily([point("2026-10-31", 1), point("2026-11-01", 2)], "month");

    expect(groups.map((group) => group.key)).toEqual(["2026-10", "2026-11"]);
  });
});

describe("kpisOf", () => {
  it("rend des ratios nuls sans visite", () => {
    expect(kpisOf([])).toEqual({
      views: 0,
      visitors: 0,
      visits: 0,
      avgVisitorsPerDay: 0,
      avgSecondsPerPage: 0,
      avgSecondsPerVisit: 0,
      pagesPerVisit: 0,
      bounceRate: 0,
    });
  });

  it("calcule moyennes et taux d'une période", () => {
    const kpis = kpisOf([
      { day: "2026-11-01", views: 6, visitors: 2, visits: 3, bounces: 1, engagedMs: 60_000 },
      { day: "2026-11-02", views: 2, visitors: 2, visits: 1, bounces: 1, engagedMs: 20_000 },
    ]);

    expect(kpis).toEqual({
      views: 8,
      visitors: 4,
      visits: 4,
      avgVisitorsPerDay: 2,
      avgSecondsPerPage: 10,
      avgSecondsPerVisit: 20,
      pagesPerVisit: 2,
      bounceRate: 0.5,
    });
  });
});

describe("relativeChange", () => {
  it("rend null sans base de comparaison", () => {
    expect(relativeChange(10, 0)).toBeNull();
    expect(relativeChange(10, Number.NaN)).toBeNull();
  });

  it("rend l'évolution relative", () => {
    expect(relativeChange(15, 10)).toBe(0.5);
  });
});

describe("formatDuration", () => {
  it("écrit les secondes seules sous une minute", () => {
    expect(formatDuration(48.4)).toBe("48 s");
  });

  it("écrit minutes et secondes sur deux chiffres", () => {
    expect(formatDuration(125)).toBe("2 min 05 s");
  });

  it("ramène une durée négative à zéro", () => {
    expect(formatDuration(-3)).toBe("0 s");
  });
});

describe("percentShares", () => {
  it("répartit les restes pour que la somme fasse 100", () => {
    expect(percentShares([1, 1, 1])).toEqual([34, 33, 33]);
  });

  it("rend des zéros sans total", () => {
    expect(percentShares([0, 0])).toEqual([0, 0]);
  });
});

describe("fillTemplate", () => {
  it("remplit les noms connus et laisse les autres", () => {
    expect(fillTemplate("{label} : {value} {unit}", { label: "Mobile", value: 3 })).toBe("Mobile : 3 {unit}");
  });
});

describe("heatmapMargins", () => {
  it("additionne la grille par jour et par heure", () => {
    const heatmap = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    heatmap[0][20] = 4;
    heatmap[6][20] = 1;
    heatmap[6][9] = 2;

    const margins = heatmapMargins(heatmap);

    expect(margins.weekdays).toEqual([4, 0, 0, 0, 0, 0, 3]);
    expect(margins.hours[20]).toBe(5);
    expect(margins.hours[9]).toBe(2);
  });
});

describe("parseAudienceBatch — ouverture de la page d'une suite (o)", () => {
  it("parseAudienceBatch_continuationWithOpenAge_setsOpenedAgeMs", () => {
    const views = parseAudienceBatch({ v: [{ p: "/", t: 1000, a: 1000, d: "mobile", c: 1, o: 600_000 }] });

    expect(views[0]).toMatchObject({ ageMs: 1000, openedAgeMs: 600_000 });
  });

  it("parseAudienceBatch_openAgeBelowAge_clampedToAge", () => {
    const views = parseAudienceBatch({ v: [{ p: "/", t: 1000, a: 5000, d: "mobile", c: 1, o: 1000 }] });

    expect(views[0].openedAgeMs).toBe(5000);
  });

  it("parseAudienceBatch_veryOldOpenAge_keptForServerDayCheck", () => {
    // Le serveur, seul juge, écarte la suite d'un jour déjà replié (lastRollableDay).
    const views = parseAudienceBatch({ v: [{ p: "/", t: 1000, a: 0, d: "mobile", c: 1, o: 72 * 3_600_000 }] });

    expect(views[0].openedAgeMs).toBe(72 * 3_600_000);
  });

  it("parseAudienceBatch_continuationWithoutOpenAge_fallsBackToAge", () => {
    const views = parseAudienceBatch({ v: [{ p: "/", t: 1000, a: 2000, d: "mobile", c: 1 }] });

    expect(views[0].openedAgeMs).toBe(2000);
  });

  it("parseAudienceBatch_viewWithOpenAge_ignored", () => {
    const views = parseAudienceBatch({ v: [{ p: "/", t: 0, a: 2000, d: "mobile", o: 900_000 }] });

    expect(views[0].openedAgeMs).toBe(2000);
  });
});

describe("aggregateAudienceDay — lecture par tranches", () => {
  it("aggregateAudienceDay_longReadInCheckpoints_oneVisitNoExtraBounce", () => {
    const result = aggregateAudienceDay([
      row({ viewedAt: new Date("2026-11-10T19:00:00Z"), engagedMs: 0 }),
      ...Array.from({ length: 9 }, (_, index) =>
        row({ viewedAt: new Date(Date.UTC(2026, 10, 10, 19, 10 * (index + 1))), isView: false, engagedMs: 600_000 }),
      ),
      row({ viewedAt: new Date("2026-11-10T20:30:00Z"), pageKey: "ranking", engagedMs: 0 }),
    ]);

    expect(result.totals).toEqual({ views: 2, visitors: 1, visits: 1, bounces: 0, engagedMs: 5_400_000 });
  });
});
