import { describe, expect, it } from "@jest/globals";
import type {
  BracketMatch,
  TournamentCard,
  TournamentDetail,
  TournamentSnapshot,
  TournamentViewerContext,
} from "@/lib/shared/types";
import {
  INITIAL_LIVE_STATE,
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  applyLiveMessage,
  parseLiveMessage,
  reconnectDelayMs,
  shouldPlayScoreReady,
  type LiveState,
} from "@/app/(secured)/tournois/[id]/_lib/live-state";

const card = (overrides: Partial<TournamentCard> = {}): TournamentCard =>
  ({
    id: 7,
    name: "Tournoi",
    description: null,
    format: "SINGLE",
    game: "OW2",
    participantType: "TEAM",
    maxTeams: 8,
    registeredTeams: 2,
    state: "REGISTRATION",
    startVisibilityAt: "2026-05-01T12:00:00Z",
    registrationOpenAt: "2026-05-02T12:00:00Z",
    registrationCloseAt: "2026-05-03T12:00:00Z",
    startAt: "2026-05-04T12:00:00Z",
    hasThirdPlaceMatch: false,
    survivalRoundsBeforeFirstCut: null,
    survivalRoundsPerCut: null,
    phases: null,
    matchFormat: null,
    ...overrides,
  }) as TournamentCard;

const match = (overrides: Partial<BracketMatch> = {}): BracketMatch =>
  ({
    id: 1,
    tournamentId: 7,
    bracket: "UPPER",
    roundNumber: 1,
    matchNumber: 1,
    status: "READY",
    team1Id: 10,
    team2Id: 20,
    team1Name: "A",
    team2Name: "B",
    team1Placeholder: null,
    team2Placeholder: null,
    team1Score: null,
    team2Score: null,
    winnerTeamId: null,
    loserTeamId: null,
    forfeitTeamId: null,
    nextWinnerMatchId: null,
    nextWinnerSlot: null,
    nextLoserMatchId: null,
    nextLoserSlot: null,
    scoreDeadlineAt: null,
    updatedAt: "2026-05-04T12:00:00Z",
    phaseId: 0,
    phasePosition: null,
    ...overrides,
  }) as BracketMatch;

const snapshot = (overrides: Partial<TournamentSnapshot> = {}): TournamentSnapshot => ({
  card: card(),
  matches: [match()],
  registrations: [
    {
      teamId: 10,
      teamName: "A",
      logoUrl: null,
      seed: 1,
      registeredAt: "2026-05-02T13:00:00Z",
      finalRank: null,
    },
  ],
  survival: null,
  swiss: null,
  endurance: null,
  phases: null,
  currentPhaseId: null,
  phaseStandings: {},
  soloUserIds: {},
  version: "v1",
  ...overrides,
});

const viewer = (overrides: Partial<TournamentViewerContext> = {}): TournamentViewerContext => ({
  canRegister: false,
  myTeamId: 10,
  canCreateReportsForTeamIds: [10],
  isAdmin: false,
  ...overrides,
});

const connected = (state: LiveState = INITIAL_LIVE_STATE, over: Partial<TournamentSnapshot> = {}) =>
  applyLiveMessage(state, {
    type: "connected",
    tournamentId: 7,
    tier: "PRIORITY",
    viewer: viewer(),
    snapshot: snapshot(over),
  });

describe("parseLiveMessage", () => {
  it("lit un message de connexion", () => {
    const raw = JSON.stringify({
      type: "connected",
      tournamentId: 7,
      tier: "PRIORITY",
      viewer: viewer(),
      snapshot: snapshot(),
    });
    expect(parseLiveMessage(raw)).toMatchObject({ type: "connected", tier: "PRIORITY" });
  });

  it("lit un instantané", () => {
    const raw = JSON.stringify({
      type: "snapshot",
      tournamentId: 7,
      version: "v2",
      snapshot: snapshot({ version: "v2" }),
    });
    expect(parseLiveMessage(raw)).toMatchObject({ type: "snapshot", version: "v2" });
  });

  it("retombe sur le palier standard si le serveur en annonce un inconnu", () => {
    const raw = JSON.stringify({
      type: "connected",
      tournamentId: 7,
      tier: "SUPER-ADMIN",
      viewer: viewer(),
      snapshot: snapshot(),
    });
    expect(parseLiveMessage(raw)).toMatchObject({ tier: "STANDARD" });
  });

  it("ignore ce qui n'est pas exploitable", () => {
    // Le battement de cœur est une ligne de commentaire SSE et n'arrive pas
    // jusqu'ici ; tout le reste doit être écarté sans casser la page.
    expect(parseLiveMessage("pas du json")).toBeNull();
    expect(parseLiveMessage("null")).toBeNull();
    expect(parseLiveMessage('"texte"')).toBeNull();
    expect(parseLiveMessage(JSON.stringify({ type: "heartbeat" }))).toBeNull();
    expect(parseLiveMessage(JSON.stringify({ type: "connected" }))).toBeNull();
    expect(parseLiveMessage(JSON.stringify({ type: "snapshot", version: "v2" }))).toBeNull();
  });
});

describe("applyLiveMessage — connexion", () => {
  it("compose le détail à partir de l'instantané et du contexte du lecteur", () => {
    const state = connected();
    expect(state.tier).toBe("PRIORITY");
    expect(state.detail?.card.id).toBe(7);
    expect(state.detail?.myTeamId).toBe(10);
    expect(state.detail?.canCreateReportsForTeamIds).toEqual([10]);
  });
});

describe("applyLiveMessage — instantané", () => {
  it("conserve le contexte du lecteur d'une version à l'autre", () => {
    const state = connected();
    const next = applyLiveMessage(state, {
      type: "snapshot",
      tournamentId: 7,
      version: "v2",
      snapshot: snapshot({ version: "v2", matches: [match({ team1Score: 3 })] }),
    });

    expect(next.detail?.matches[0].team1Score).toBe(3);
    // Le contexte n'est envoyé qu'à la connexion : il ne doit pas se perdre.
    expect(next.detail?.myTeamId).toBe(10);
    expect(next.detail?.isAdmin).toBe(false);
    expect(next.tier).toBe("PRIORITY");
  });

  it("rend le même état quand la version n'a pas bougé", () => {
    const state = connected();
    const next = applyLiveMessage(state, {
      type: "snapshot",
      tournamentId: 7,
      version: "v1",
      snapshot: snapshot(),
    });
    // Identité conservée : l'appelant peut éviter un rendu inutile.
    expect(next).toBe(state);
  });

  it("ignore un instantané reçu avant le contexte du lecteur", () => {
    // Sans le contexte, on ne saurait ni ce que le lecteur peut rapporter, ni
    // s'il peut s'inscrire : mieux vaut attendre la connexion.
    const next = applyLiveMessage(INITIAL_LIVE_STATE, {
      type: "snapshot",
      tournamentId: 7,
      version: "v1",
      snapshot: snapshot(),
    });
    expect(next).toBe(INITIAL_LIVE_STATE);
  });
});

describe("applyLiveMessage — droit de s'inscrire", () => {
  it("ouvre l'inscription quand les inscriptions s'ouvrent", () => {
    const state = connected(INITIAL_LIVE_STATE, {
      card: card({ state: "UPCOMING" }),
      registrations: [],
    });
    expect(state.detail?.canRegister).toBe(false);

    const next = applyLiveMessage(state, {
      type: "snapshot",
      tournamentId: 7,
      version: "v2",
      snapshot: snapshot({ version: "v2", card: card({ state: "REGISTRATION" }), registrations: [] }),
    });
    expect(next.detail?.canRegister).toBe(true);
  });

  it("ferme l'inscription quand les inscriptions se ferment", () => {
    // Le contexte reçu du serveur fait foi à la connexion.
    const state = applyLiveMessage(INITIAL_LIVE_STATE, {
      type: "connected",
      tournamentId: 7,
      tier: "PRIORITY",
      viewer: viewer({ canRegister: true }),
      snapshot: snapshot({ registrations: [] }),
    });
    expect(state.detail?.canRegister).toBe(true);

    const next = applyLiveMessage(state, {
      type: "snapshot",
      tournamentId: 7,
      version: "v2",
      snapshot: snapshot({ version: "v2", card: card({ state: "RUNNING" }), registrations: [] }),
    });
    expect(next.detail?.canRegister).toBe(false);
  });

  it("ferme l'inscription dès que l'engagé apparaît dans la liste", () => {
    const state = connected(INITIAL_LIVE_STATE, { registrations: [] });
    const next = applyLiveMessage(state, {
      type: "snapshot",
      tournamentId: 7,
      version: "v2",
      snapshot: snapshot({ version: "v2" }),
    });
    expect(next.detail?.canRegister).toBe(false);
  });

  it("laisse un joueur sans entrée solo s'inscrire à un tournoi individuel", () => {
    const solo = applyLiveMessage(INITIAL_LIVE_STATE, {
      type: "connected",
      tournamentId: 7,
      tier: "STANDARD",
      viewer: viewer({ myTeamId: null, canCreateReportsForTeamIds: [] }),
      snapshot: snapshot({ card: card({ participantType: "SOLO" }), registrations: [] }),
    });

    const next = applyLiveMessage(solo, {
      type: "snapshot",
      tournamentId: 7,
      version: "v2",
      snapshot: snapshot({
        version: "v2",
        card: card({ participantType: "SOLO" }),
        registrations: [],
      }),
    });
    // L'entrée solo sera créée à l'inscription : son absence n'est pas un
    // obstacle, contrairement au tournoi par équipes.
    expect(next.detail?.canRegister).toBe(true);
  });

  it("refuse l'inscription d'un joueur sans équipe en tournoi par équipes", () => {
    const orphan = applyLiveMessage(INITIAL_LIVE_STATE, {
      type: "connected",
      tournamentId: 7,
      tier: "STANDARD",
      viewer: viewer({ myTeamId: null, canCreateReportsForTeamIds: [] }),
      snapshot: snapshot({ registrations: [] }),
    });

    const next = applyLiveMessage(orphan, {
      type: "snapshot",
      tournamentId: 7,
      version: "v2",
      snapshot: snapshot({ version: "v2", registrations: [] }),
    });
    expect(next.detail?.canRegister).toBe(false);
  });
});

describe("shouldPlayScoreReady", () => {
  const detail = (matches: BracketMatch[], myTeamId: number | null = 10): TournamentDetail => ({
    ...snapshot({ matches }),
    ...viewer({ myTeamId }),
  });

  it("sonne quand un match du lecteur passe en attente de confirmation", () => {
    const before = detail([match({ status: "READY" })]);
    const after = detail([match({ status: "AWAITING_CONFIRMATION" })]);
    expect(shouldPlayScoreReady(before, after)).toBe(true);
  });

  it("ne sonne pas pour le match des autres", () => {
    // Un spectateur n'a rien à confirmer : le signal ne le concerne pas.
    const before = detail([match({ status: "READY", team1Id: 30, team2Id: 40 })]);
    const after = detail([match({ status: "AWAITING_CONFIRMATION", team1Id: 30, team2Id: 40 })]);
    expect(shouldPlayScoreReady(before, after)).toBe(false);
  });

  it("ne sonne pas deux fois pour la même attente", () => {
    const state = detail([match({ status: "AWAITING_CONFIRMATION" })]);
    expect(shouldPlayScoreReady(state, state)).toBe(false);
  });

  it("ne sonne pas au premier chargement", () => {
    expect(shouldPlayScoreReady(null, detail([match({ status: "AWAITING_CONFIRMATION" })]))).toBe(
      false,
    );
  });

  it("ne sonne pas pour un lecteur non engagé", () => {
    const before = detail([match({ status: "READY" })], null);
    const after = detail([match({ status: "AWAITING_CONFIRMATION" })], null);
    expect(shouldPlayScoreReady(before, after)).toBe(false);
  });

  it("sonne pour un second match du lecteur", () => {
    const before = detail([match({ id: 1, status: "AWAITING_CONFIRMATION" })]);
    const after = detail([
      match({ id: 1, status: "AWAITING_CONFIRMATION" }),
      match({ id: 2, status: "AWAITING_CONFIRMATION" }),
    ]);
    expect(shouldPlayScoreReady(before, after)).toBe(true);
  });
});

describe("reconnectDelayMs", () => {
  const top = () => 1;

  it("relève exponentiellement le plafond de tirage", () => {
    expect(reconnectDelayMs(1, top)).toBe(1_000);
    expect(reconnectDelayMs(2, top)).toBe(2_000);
    expect(reconnectDelayMs(3, top)).toBe(4_000);
  });

  it("plafonne l'attente", () => {
    // Sans plafond, quelques dizaines d'échecs mèneraient à des attentes de
    // plusieurs jours — page morte jusqu'au F5, ce qu'on cherche à éviter.
    expect(reconnectDelayMs(50, top)).toBe(RECONNECT_MAX_MS);
    expect(reconnectDelayMs(500, top)).toBe(RECONNECT_MAX_MS);
  });

  it("tire dans TOUT l'intervalle dès la première tentative", () => {
    // Au redémarrage du serveur, toutes les pages ouvertes tombent à la même
    // seconde. Une gigue étroite les ferait revenir dans la même demi-seconde,
    // et chaque reconnexion prend une connexion du pool : la reprise doit
    // s'étaler sur toute la fenêtre, pas se resserrer autour de sa borne haute.
    expect(reconnectDelayMs(1, () => 0.4)).toBe(400);
    expect(reconnectDelayMs(1, () => 0.9)).toBe(900);
  });

  it("garde un plancher pour ne pas boucler à vide", () => {
    // Une erreur immédiate (401, 429) ne doit pas produire une rafale de
    // reconnexions à zéro milliseconde.
    expect(reconnectDelayMs(1, () => 0)).toBe(RECONNECT_MIN_MS);
    expect(reconnectDelayMs(0, () => 0)).toBe(RECONNECT_MIN_MS);
    expect(reconnectDelayMs(-3, () => 0)).toBe(RECONNECT_MIN_MS);
  });
});
