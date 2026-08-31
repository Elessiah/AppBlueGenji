import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FORMAT_LABELS,
  GAME_LABELS,
  STATE_META,
  headerIdentityLine,
  headerMetaItems,
} from "@/app/(secured)/tournois/[id]/_lib/header-meta";
import type {
  TournamentCard,
  TournamentFormat,
  TournamentPhase,
  TournamentState,
} from "@/lib/shared/types";

const ROOT = join(__dirname, "..", "..");

function card(overrides: Partial<TournamentCard> = {}): TournamentCard {
  return {
    id: 1,
    name: "BlueGenji Slash Tournament",
    description: "saison 6",
    format: "DOUBLE",
    game: "OW2",
    participantType: "TEAM",
    maxTeams: 24,
    registeredTeams: 0,
    state: "REGISTRATION",
    startVisibilityAt: "2026-08-01T10:00:00.000Z",
    registrationOpenAt: "2026-08-05T10:00:00.000Z",
    registrationCloseAt: "2026-08-20T10:00:00.000Z",
    startAt: "2026-08-25T18:00:00.000Z",
    hasThirdPlaceMatch: false,
    survivalRoundsBeforeFirstCut: null,
    survivalRoundsPerCut: null,
    phases: null,
    matchFormat: null,
    liveUrl: null,
    ...overrides,
  };
}

function phase(id: number, position: number): TournamentPhase {
  return {
    id,
    tournamentId: 1,
    position,
    state: "PENDING",
    format: "SWISS",
    name: null,
    qualifierMode: "PERCENT",
    qualifierValue: 50,
    hasThirdPlaceMatch: false,
    swissTotalRounds: null,
    survivalRoundsBeforeFirstCut: null,
    survivalRoundsPerCut: null,
    entrants: null,
    qualifiers: null,
    skipped: false,
    skipReason: null,
  };
}

const keys = (items: { key: string }[]) => items.map((item) => item.key);
const find = (items: { key: string }[], key: string) => items.find((item) => item.key === key);

const NOW = Date.parse("2026-08-10T12:00:00.000Z");

describe("en-tête de tournoi — libellés", () => {
  it("nomme chaque format une seule fois, sans retomber sur « Double élim. »", () => {
    // Régression : l'en-tête portait deux pastilles de format, dont une issue
    // d'un `switch` sans cas `BG_SURVIE` — un tournoi BlueGenji Survie
    // s'annonçait « Double élim. » à côté de son vrai mode.
    const formats: TournamentFormat[] = [
      "SINGLE",
      "DOUBLE",
      "SWISS",
      "SURVIVAL",
      "MULTI",
      "BG_SURVIE",
    ];

    for (const format of formats) {
      expect(FORMAT_LABELS[format]).toBeTruthy();
    }

    expect(FORMAT_LABELS.BG_SURVIE).toBe("BlueGenji Survie");

    const labels = formats.map((format) => FORMAT_LABELS[format]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("n'affiche qu'un seul fait « format » par tournoi", () => {
    const items = headerMetaItems(card({ format: "BG_SURVIE" }), null, null, NOW);
    expect(items.filter((item) => item.value === FORMAT_LABELS.BG_SURVIE)).toHaveLength(1);
    expect(find(items, "format")?.value).toBe("BlueGenji Survie");
  });

  it("écrit le nom du jeu en toutes lettres", () => {
    expect(GAME_LABELS.OW2).toBe("Overwatch 2");
    expect(GAME_LABELS.MR).toBe("Marvel Rivals");
  });

  it("ajoute « Individuel » à la ligne d'identité d'un tournoi solo, jamais à celle d'un tournoi par équipes", () => {
    expect(headerIdentityLine(card({ participantType: "SOLO" }))).toBe("Overwatch 2 · Individuel");
    expect(headerIdentityLine(card({ participantType: "TEAM" }))).toBe("Overwatch 2");
  });

  it("ne peint jamais un état de tournoi en rouge d'antenne", () => {
    const states: TournamentState[] = ["UPCOMING", "REGISTRATION", "RUNNING", "FINISHED"];
    for (const state of states) {
      expect(STATE_META[state].label).toBeTruthy();
      expect(["neutral", "green", "blue", "muted"]).toContain(STATE_META[state].tone);
    }
    // Un tournoi « en cours » n'est pas une diffusion (CLAUDE.md).
    expect(STATE_META.RUNNING.tone).toBe("blue");
    expect(STATE_META.RUNNING.label).toBe("En cours");
  });
});

describe("en-tête de tournoi — faits affichés", () => {
  it("étiquette chaque fait plutôt que d'aligner des valeurs nues", () => {
    const items = headerMetaItems(card(), null, null, NOW);
    for (const item of items) {
      expect(item.label.trim().length).toBeGreaterThan(0);
      expect(item.value.trim().length).toBeGreaterThan(0);
    }
  });

  it("ne montre le format des matchs que s'il est fixé, avec son explication au survol", () => {
    expect(keys(headerMetaItems(card(), null, null, NOW))).not.toContain("match-format");

    const withFormat = headerMetaItems(
      card({ matchFormat: { type: "FT", value: 3 } }),
      null,
      null,
      NOW,
    );
    const item = find(withFormat, "match-format");
    expect(item?.value).toBe("FT3");
    expect(item?.hint).toContain("3 manches");
  });

  it("ne montre la petite finale que si elle est programmée", () => {
    expect(keys(headerMetaItems(card(), null, null, NOW))).not.toContain("third-place");
    expect(keys(headerMetaItems(card({ hasThirdPlaceMatch: true }), null, null, NOW))).toContain(
      "third-place",
    );
  });

  it("situe la phase courante d'un multi-phases, et seulement quand il y en a une", () => {
    const phases = [phase(10, 1), phase(11, 2), phase(12, 3)];

    expect(keys(headerMetaItems(card({ format: "MULTI" }), phases, null, NOW))).not.toContain(
      "phase",
    );

    const running = headerMetaItems(card({ format: "MULTI" }), phases, 11, NOW);
    expect(find(running, "phase")?.value).toBe("2/3");

    // Phase inconnue (plateau régénéré entre deux instantanés) : rien plutôt
    // qu'un « 0/3 » faux.
    expect(keys(headerMetaItems(card({ format: "MULTI" }), phases, 99, NOW))).not.toContain(
      "phase",
    );

    // Le repère n'a de sens qu'en multi-phases.
    expect(keys(headerMetaItems(card({ format: "SWISS" }), phases, 11, NOW))).not.toContain(
      "phase",
    );
  });

  it("nomme l'effectif selon le type de participant et en donne le remplissage", () => {
    const teams = find(headerMetaItems(card({ registeredTeams: 6 }), null, null, NOW), "entrants");
    expect(teams?.label).toBe("Équipes participantes");
    expect(teams?.value).toBe("6/24");
    expect(teams?.ratio).toBeCloseTo(0.25);

    const solo = find(
      headerMetaItems(card({ participantType: "SOLO" }), null, null, NOW),
      "entrants",
    );
    expect(solo?.label).toBe("Joueurs participants");
  });

  it("borne la jauge d'effectif plutôt que de la laisser filer", () => {
    // Effectif au-delà du plafond : la jauge est pleine, jamais débordante.
    const over = find(
      headerMetaItems(card({ registeredTeams: 30, maxTeams: 24 }), null, null, NOW),
      "entrants",
    );
    expect(over?.ratio).toBe(1);

    // Plafond nul : pas de division par zéro qui traverserait la mise en page.
    const empty = find(
      headerMetaItems(card({ registeredTeams: 0, maxTeams: 0 }), null, null, NOW),
      "entrants",
    );
    expect(empty?.ratio).toBe(0);
  });
});

describe("en-tête de tournoi — dates", () => {
  it("annonce l'ouverture des inscriptions tant qu'elle est à venir", () => {
    const item = find(
      headerMetaItems(card({ state: "UPCOMING" }), null, null, Date.parse("2026-08-02T00:00:00Z")),
      "registration-open",
    );
    expect(item?.label).toBe("Inscriptions dès");
    expect(item?.value).toBe("2026-08-05T10:00:00.000Z");
    expect(item?.kind).toBe("date");
  });

  it("bascule sur la clôture une fois les inscriptions ouvertes", () => {
    const items = headerMetaItems(card({ state: "REGISTRATION" }), null, null, NOW);
    expect(keys(items)).not.toContain("registration-open");
    expect(find(items, "registration-close")?.value).toBe("2026-08-20T10:00:00.000Z");
  });

  it("retire les dates d'inscription une fois le tournoi lancé", () => {
    for (const state of ["RUNNING", "FINISHED"] as const) {
      const items = keys(headerMetaItems(card({ state }), null, null, NOW));
      expect(items).not.toContain("registration-open");
      expect(items).not.toContain("registration-close");
    }
  });

  it("dit « Joué le » sur un tournoi terminé, « Début du tournoi » avant", () => {
    expect(find(headerMetaItems(card({ state: "FINISHED" }), null, null, NOW), "start")?.label).toBe(
      "Joué le",
    );
    expect(find(headerMetaItems(card(), null, null, NOW), "start")?.label).toBe("Début du tournoi");
  });

  it("laisse les dates au format ISO : leur mise en forme dépend du fuseau du lecteur", () => {
    const items = headerMetaItems(card(), null, null, NOW);
    for (const item of items.filter((entry) => entry.kind === "date")) {
      expect(Number.isNaN(Date.parse(item.value))).toBe(false);
    }
  });
});

describe("en-tête de tournoi — mise en page", () => {
  const HEADER = readFileSync(
    join(ROOT, "app/(secured)/tournois/[id]/_components/TournamentHeader.tsx"),
    "utf8",
  );
  const PAGE = readFileSync(join(ROOT, "app/(secured)/tournois/[id]/page.tsx"), "utf8");
  const PHASE_TIMELINE = readFileSync(
    join(ROOT, "app/(secured)/tournois/[id]/_components/PhaseTimeline.tsx"),
    "utf8",
  );

  it("ne rebâtit pas la guirlande de pastilles dans la page", () => {
    // Toute l'identité du tournoi passe par le composant d'en-tête : c'est ce
    // qui garantit qu'un fait ajouté demain reçoit un intitulé.
    expect(PAGE).toContain("<TournamentHeader");
    expect(PAGE).not.toContain("Simple élim.");
    expect(PAGE).not.toContain("<Pill");
  });

  it("tient le témoin de flux et le rôle du lecteur à l'écart des faits du tournoi", () => {
    const viewer = HEADER.slice(HEADER.indexOf("s.viewer"), HEADER.indexOf("s.identity"));
    expect(viewer).toContain("LiveIndicator");
    expect(viewer).toContain("Admin");
    // Les faits, eux, viennent tous du module pur.
    expect(HEADER).toContain("headerMetaItems(card, detail.phases, detail.currentPhaseId)");
  });

  it("réserve le rouge à ce qui est réellement à l'antenne", () => {
    // Ni l'état du tournoi ni celui d'une phase ne sont des diffusions.
    expect(HEADER).not.toContain('variant="live"');
    expect(PHASE_TIMELINE).not.toContain('variant="live"');
  });
});
