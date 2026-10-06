import { describe, expect, it } from "@jest/globals";
import {
  activeTournamentCards,
  chooseFeaturedTournament,
  compareByStartAt,
  FEATURED_TOURNAMENT_STATE_LABEL,
  featuredMatchPill,
  FEATURED_PILL_WAITING_LABEL,
  pickFeaturedMatchIndex,
  type FeaturedMatchCandidate,
  visibleLiveViewerCount,
} from "@/lib/shared/landing";
import type { MatchLiveState } from "@/lib/shared/live-streams";
import { MATCH_SECTION_LABELS } from "@/lib/shared/match-sections";
import type { TournamentBuckets, TournamentCard, TournamentState } from "@/lib/shared/types";
import { tournamentCard } from "../../helpers/tournament-card";

function card(id: number, state: TournamentState, startAt = "2026-01-04T00:00:00.000Z"): TournamentCard {
  return tournamentCard({
    id,
    name: `Tournoi ${id}`,
    description: null,
    format: "SINGLE",
    game: "OW",
    participantType: "TEAM",
    maxTeams: 8,
    registeredTeams: 4,
    state,
    startVisibilityAt: "2026-01-01T00:00:00.000Z",
    registrationOpenAt: "2026-01-02T00:00:00.000Z",
    registrationCloseAt: "2026-01-03T00:00:00.000Z",
    startAt,
    hasThirdPlaceMatch: false,
    survivalRoundsBeforeFirstCut: null,
    survivalRoundsPerCut: null,
    phases: null,
    matchFormat: null,
    liveUrl: null,
  });
}

function buckets(partial: Partial<TournamentBuckets>): TournamentBuckets {
  return { upcoming: [], registration: [], running: [], finished: [], ...partial };
}

describe("activeTournamentCards", () => {
  it("laisse dehors les tournois terminés", () => {
    const list = activeTournamentCards(
      buckets({
        running: [card(1, "RUNNING")],
        upcoming: [card(2, "UPCOMING")],
        registration: [card(3, "REGISTRATION")],
        finished: [card(4, "FINISHED")],
      }),
    );

    expect(list.map((entry) => entry.id)).toEqual([1, 2, 3]);
  });

  it("range ce qui se joue maintenant en tête, puis à venir, puis inscriptions", () => {
    const list = activeTournamentCards(
      buckets({
        upcoming: [card(20, "UPCOMING"), card(21, "UPCOMING")],
        registration: [card(30, "REGISTRATION")],
        running: [card(10, "RUNNING")],
      }),
    );

    expect(list.map((entry) => entry.id)).toEqual([10, 20, 21, 30]);
  });

  it("ne rend rien quand seuls des tournois terminés existent", () => {
    expect(activeTournamentCards(buckets({ finished: [card(9, "FINISHED")] }))).toEqual([]);
  });
});

describe("chooseFeaturedTournament", () => {
  it("préfère un tournoi à venir : le hero décompte jusqu'à son coup d'envoi", () => {
    const featured = chooseFeaturedTournament(
      buckets({
        running: [card(10, "RUNNING")],
        registration: [card(30, "REGISTRATION")],
        upcoming: [card(20, "UPCOMING")],
      }),
    );

    expect(featured?.id).toBe(20);
  });

  it("retombe sur les inscriptions puis sur un tournoi en cours", () => {
    expect(
      chooseFeaturedTournament(buckets({ registration: [card(30, "REGISTRATION")], running: [card(10, "RUNNING")] }))?.id,
    ).toBe(30);
    expect(chooseFeaturedTournament(buckets({ running: [card(10, "RUNNING")] }))?.id).toBe(10);
  });

  it("ne repêche jamais une archive : rien de visible rend null", () => {
    expect(chooseFeaturedTournament(buckets({ finished: [card(4, "FINISHED")] }))).toBeNull();
    expect(chooseFeaturedTournament(buckets({}))).toBeNull();
  });
});

describe("ordre chronologique de l'accueil", () => {
  // `listTournamentBuckets` trie `start_at` DESC — c'est l'ordre dans lequel
  // les paniers arrivent vraiment. Ces cas le reproduisent, sinon ils ne
  // prouveraient rien : c'est exactement ce que le code d'origine recevait.
  const mars = card(1, "UPCOMING", "2026-03-01T18:00:00.000Z");
  const fevrier = card(2, "UPCOMING", "2026-02-01T18:00:00.000Z");
  const janvier = card(3, "UPCOMING", "2026-01-15T18:00:00.000Z");
  const desc = [mars, fevrier, janvier];

  it("met en avant le tournoi le plus proche, pas le plus lointain", () => {
    // Le défaut : le hero annonçait « PROCHAIN TOURNOI » en décomptant
    // jusqu'au tournoi de mars, celui qu'on verrait en dernier.
    expect(chooseFeaturedTournament(buckets({ upcoming: desc }))?.id).toBe(3);
  });

  it("choisit le plus proche aussi quand il retombe sur les inscriptions", () => {
    expect(
      chooseFeaturedTournament(
        buckets({
          registration: [
            card(10, "REGISTRATION", "2026-05-01T00:00:00.000Z"),
            card(11, "REGISTRATION", "2026-04-01T00:00:00.000Z"),
          ],
        }),
      )?.id,
    ).toBe(11);
  });

  it("range la grille du plus proche au plus lointain, dans chaque panier", () => {
    // La grille en montre trois : sans tri, c'étaient les trois qui démarrent
    // le plus tard.
    const list = activeTournamentCards(buckets({ upcoming: desc }));
    expect(list.map((entry) => entry.id)).toEqual([3, 2, 1]);
  });

  it("garde l'ordre des paniers : en cours d'abord, quelles que soient les dates", () => {
    // L'ordre des paniers dit un **état**, pas une date : un tournoi en cours
    // reste en tête même s'il a commencé bien avant celui qui arrive.
    const list = activeTournamentCards(
      buckets({
        upcoming: [card(20, "UPCOMING", "2026-02-01T00:00:00.000Z")],
        running: [card(10, "RUNNING", "2025-12-01T00:00:00.000Z")],
        registration: [card(30, "REGISTRATION", "2026-01-01T00:00:00.000Z")],
      }),
    );

    expect(list.map((entry) => entry.id)).toEqual([10, 20, 30]);
  });

  it("ne modifie pas les paniers qu'on lui donne", () => {
    // Le tri se fait sur une copie : les mêmes paniers servent au calendrier et
    // au reste de la page, les réordonner en place les changerait ailleurs.
    const upcoming = [...desc];
    activeTournamentCards(buckets({ upcoming }));
    chooseFeaturedTournament(buckets({ upcoming }));
    expect(upcoming.map((entry) => entry.id)).toEqual([1, 2, 3]);
  });
});

describe("visibleLiveViewerCount", () => {
  it("masque une audience nulle ou trop faible pour convaincre", () => {
    // « 👁 0 » sur la carte du direct décourage plus qu'il n'informe — c'est
    // souvent le staff qui vérifie la page, pas une vraie audience.
    expect(visibleLiveViewerCount(0)).toBeNull();
    expect(visibleLiveViewerCount(1)).toBeNull();
  });

  it("affiche l'audience dès qu'elle dépasse le seuil", () => {
    expect(visibleLiveViewerCount(2)).toBe(2);
    expect(visibleLiveViewerCount(47)).toBe(47);
  });
});

describe("compareByStartAt", () => {
  it("classe du plus tôt au plus tard", () => {
    const early = card(1, "UPCOMING", "2026-01-01T00:00:00.000Z");
    const late = card(2, "UPCOMING", "2026-06-01T00:00:00.000Z");
    expect(compareByStartAt(early, late)).toBeLessThan(0);
    expect(compareByStartAt(late, early)).toBeGreaterThan(0);
    expect(compareByStartAt(early, early)).toBe(0);
  });

  it("renvoie une date illisible en fin de liste, sans rendre NaN", () => {
    // Un comparateur qui rend NaN ne trie plus rien, et sans bruit : toute la
    // section reviendrait à l'ordre d'origine, celui qu'on corrige ici.
    const valid = card(1, "UPCOMING", "2026-01-01T00:00:00.000Z");
    const broken = card(2, "UPCOMING", "pas une date");

    expect(compareByStartAt(valid, broken)).toBeLessThan(0);
    expect(compareByStartAt(broken, valid)).toBeGreaterThan(0);
    expect(compareByStartAt(broken, broken)).toBe(0);
    expect([broken, valid].sort(compareByStartAt).map((entry) => entry.id)).toEqual([1, 2]);
  });
});

describe("pickFeaturedMatchIndex", () => {
  const at = (
    phase: FeaturedMatchCandidate["phase"],
    startAt: string | null = null,
    onAir = false,
  ): FeaturedMatchCandidate => ({ onAir, phase, startAt });

  it("préfère le match à l'antenne, quelle que soit sa phase", () => {
    expect(pickFeaturedMatchIndex([at("LAUNCHED"), at("TO_PLAN", null, true)])).toBe(1);
  });

  it("préfère un match lancé, puis en lancement, puis daté", () => {
    expect(pickFeaturedMatchIndex([at("SCHEDULED", "2026-10-05T18:00:00Z"), at("LOBBY"), at("LAUNCHED")])).toBe(2);
    expect(pickFeaturedMatchIndex([at("SCHEDULED", "2026-10-05T18:00:00Z"), at("LOBBY")])).toBe(1);
  });

  it("retient le match daté le plus proche, l'ordre du plateau départageant les égalités", () => {
    const candidates = [
      at("SCHEDULED", "2026-10-05T20:00:00Z"),
      at("SCHEDULED", "2026-10-05T18:00:00Z"),
      at("SCHEDULED", "2026-10-05T18:00:00Z"),
    ];
    expect(pickFeaturedMatchIndex(candidates)).toBe(1);
  });

  it("ne retient jamais un match à planifier, terminé ou en attente d'adversaire", () => {
    expect(pickFeaturedMatchIndex([at("TO_PLAN"), at("NONE")])).toBe(-1);
    expect(pickFeaturedMatchIndex([])).toBe(-1);
  });

  it("garde l'ordre du plateau entre deux matchs lancés", () => {
    expect(pickFeaturedMatchIndex([at("TO_PLAN"), at("LAUNCHED"), at("LAUNCHED")])).toBe(1);
  });
});

describe("featuredMatchPill", () => {
  const NOW = Date.parse("2026-10-05T12:00:00Z");
  const pill = (
    launchPhase: "LAUNCHED" | "LOBBY" | "SCHEDULED",
    startAt: string | null,
    now: number | null = NOW,
    liveState: MatchLiveState = "OFF",
  ) => featuredMatchPill({ launchPhase, startAt, liveState }, now);

  it("reprend les mots des sections de manche, phase par phase", () => {
    expect(pill("LAUNCHED", null)).toEqual({ kind: "playing", label: MATCH_SECTION_LABELS.PLAYING, tone: "blue", when: null });
    expect(pill("LOBBY", null)).toEqual({ kind: "lobby", label: MATCH_SECTION_LABELS.LOBBY, tone: "blue", when: null });
    // L'horaire est rendu à côté de la pastille, pas dedans : elle tient sur une ligne.
    expect(pill("SCHEDULED", "2026-10-05T18:30:00Z")).toEqual({
      kind: "waiting",
      label: FEATURED_PILL_WAITING_LABEL,
      tone: "waiting",
      when: "5 oct. · 20:30",
    });
    expect(MATCH_SECTION_LABELS.PLAYING).toBe("En cours");
  });

  it("garde « En attente de lancement » sur la pastille quand la section de manche dit « Planifié »", () => {
    expect(FEATURED_PILL_WAITING_LABEL).toBe("En attente de lancement");
    expect(MATCH_SECTION_LABELS.WAITING).toBe("Planifié");
    expect(pill("SCHEDULED", "2026-10-05T18:30:00Z").label).toBe("En attente de lancement");
  });

  it("ne dit « En direct », en rouge, que pour un match réellement à l'antenne", () => {
    for (const phase of ["LAUNCHED", "LOBBY", "SCHEDULED"] as const) {
      expect(pill(phase, "2026-10-05T18:30:00Z", NOW, "LIVE")).toEqual({ kind: "live", label: "En direct", tone: "live", when: null });
      // Une diffusion seulement annoncée n'est pas à l'antenne.
      expect(pill(phase, "2026-10-05T18:30:00Z", NOW, "SCHEDULED").tone).not.toBe("live");
    }
  });

  it("passe en « Lancement » dès l'heure atteinte, sans attendre une nouvelle phase du serveur", () => {
    expect(pill("SCHEDULED", "2026-10-05T12:00:00Z").label).toBe("Lancement");
    expect(pill("SCHEDULED", "2026-10-05T11:55:00Z").label).toBe("Lancement");
  });

  it("s'en tient à la phase du serveur tant que l'horloge n'est pas montée", () => {
    // Rendu serveur et hydratation doivent coïncider : aucune lecture de l'heure.
    const held = pill("SCHEDULED", "2020-01-01T00:00:00Z", null);
    expect(held.label).toBe("En attente de lancement");
    expect(held.when).toMatch(/2020 · /);
  });

  it("se passe d'un horaire illisible ou absent", () => {
    expect(pill("SCHEDULED", "pas une date")).toEqual({ kind: "waiting", label: "En attente de lancement", tone: "waiting", when: null });
    expect(pill("SCHEDULED", null).when).toBeNull();
  });

  it("ne confond jamais l'état du tournoi avec celui du match", () => {
    expect(FEATURED_TOURNAMENT_STATE_LABEL).toBe("Tournoi en cours");
    for (const phase of ["LAUNCHED", "LOBBY", "SCHEDULED"] as const) {
      for (const liveState of ["OFF", "SCHEDULED", "LIVE"] as const) {
        expect(pill(phase, null, NOW, liveState).label).not.toBe(FEATURED_TOURNAMENT_STATE_LABEL);
      }
    }
  });
});
