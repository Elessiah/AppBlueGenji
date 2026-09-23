import { describe, expect, it } from "@jest/globals";
import {
  attentionDocumentTitle,
  isPersonalAlert,
  touchesViewerMatches,
  viewerAlert,
  viewerAlertTitle,
  VIEWER_ALERT_PRIORITY,
  type ViewerAlertDetail,
} from "@/lib/shared/viewer-alerts";

type M = ViewerAlertDetail["matches"][number];

const match = (overrides: Partial<M> = {}): M => ({
  id: 1,
  status: "PENDING",
  team1Id: null,
  team2Id: null,
  roundNumber: 1,
  bracket: "UPPER",
  phaseId: 0,
  updatedAt: "2026-09-23T20:00:00Z",
  ...overrides,
});

const detail = (matches: M[], overrides: Partial<ViewerAlertDetail> = {}): ViewerAlertDetail => ({
  card: { state: "RUNNING" },
  myTeamId: 1,
  matches,
  ...overrides,
});

describe("viewerAlert", () => {
  it("n'annonce rien au premier instantané", () => {
    expect(viewerAlert(null, detail([match({ status: "READY", team1Id: 1, team2Id: 2 })]))).toBeNull();
  });

  it("annonce le match du lecteur quand son adversaire est connu", () => {
    const before = detail([match({ team1Id: 1 })]);
    const after = detail([match({ status: "READY", team1Id: 1, team2Id: 2 })]);
    expect(viewerAlert(before, after)).toBe("MATCH_READY");
  });

  it("annonce un match du lecteur qui apparaît (manche suivante appariée)", () => {
    const before = detail([match({ status: "COMPLETED", team1Id: 1, team2Id: 2 })]);
    const after = detail([
      ...before.matches,
      match({ id: 2, roundNumber: 2, status: "READY", team1Id: 1, team2Id: 3 }),
    ]);
    expect(viewerAlert(before, after)).toBe("MATCH_READY");
  });

  it("ne réannonce pas un match déjà prêt", () => {
    const ready = detail([match({ status: "READY", team1Id: 1, team2Id: 2 })]);
    expect(viewerAlert(ready, detail([...ready.matches]))).toBeNull();
  });

  it("annonce le score à confirmer, avant tout le reste", () => {
    const before = detail([match({ status: "READY", team1Id: 1, team2Id: 2 })]);
    const after = detail([
      match({ status: "AWAITING_CONFIRMATION", team1Id: 1, team2Id: 2 }),
      match({ id: 2, roundNumber: 2, status: "READY", team1Id: 1, team2Id: 3 }),
    ]);
    expect(viewerAlert(before, after)).toBe("SCORE_TO_CONFIRM");
  });

  it("annonce une nouvelle manche à un spectateur", () => {
    const before = detail([match({ status: "COMPLETED", team1Id: 3, team2Id: 4 })], { myTeamId: null });
    const after = detail(
      [...before.matches, match({ id: 2, roundNumber: 2, status: "READY", team1Id: 3, team2Id: 5 })],
      { myTeamId: null },
    );
    expect(viewerAlert(before, after)).toBe("ROUND_STARTED");
  });

  it("distingue le repêchage du tableau principal", () => {
    const before = detail([match({ status: "READY", team1Id: 3, team2Id: 4 })], { myTeamId: null });
    const after = detail(
      [...before.matches, match({ id: 2, bracket: "LOWER", status: "READY", team1Id: 5, team2Id: 6 })],
      { myTeamId: null },
    );
    expect(viewerAlert(before, after)).toBe("ROUND_STARTED");
  });

  it("ne réannonce pas une manche déjà ouverte quand une autre rencontre s'y ajoute", () => {
    const before = detail([match({ status: "READY", team1Id: 3, team2Id: 4 })], { myTeamId: null });
    const after = detail(
      [...before.matches, match({ id: 2, status: "READY", team1Id: 5, team2Id: 6 })],
      { myTeamId: null },
    );
    expect(viewerAlert(before, after)).toBeNull();
  });

  it("annonce le lancement du tournoi, mais s'efface devant le match du lecteur", () => {
    const before = detail([match({ team1Id: 3, team2Id: 4 })], { card: { state: "REGISTRATION" }, myTeamId: null });
    const started = detail([match({ status: "READY", team1Id: 3, team2Id: 4 })], { myTeamId: null });
    expect(viewerAlert(before, started)).toBe("TOURNAMENT_STARTED");

    const mine = detail([match({ status: "READY", team1Id: 1, team2Id: 4 })]);
    expect(viewerAlert({ ...before, myTeamId: 1 }, mine)).toBe("MATCH_READY");
  });

  it("n'annonce pas de manche sur un tournoi qui n'est pas en cours", () => {
    const before = detail([], { card: { state: "FINISHED" }, myTeamId: null });
    const after = detail([match({ status: "READY", team1Id: 3, team2Id: 4 })], {
      card: { state: "FINISHED" },
      myTeamId: null,
    });
    expect(viewerAlert(before, after)).toBeNull();
  });
});

describe("ce qui sonne, ce qui s'écrit", () => {
  it("ne fait sonner que ce qui concerne le lecteur", () => {
    expect(isPersonalAlert("SCORE_TO_CONFIRM")).toBe(true);
    expect(isPersonalAlert("MATCH_READY")).toBe(true);
    expect(isPersonalAlert("ROUND_STARTED")).toBe(false);
    expect(isPersonalAlert("TOURNAMENT_STARTED")).toBe(false);
  });

  it("préfixe le titre d'onglet", () => {
    expect(attentionDocumentTitle("MATCH_READY", "Coupe d'automne · BlueGenji")).toBe(
      "● Ton match est prêt · Coupe d'automne · BlueGenji",
    );
    expect(attentionDocumentTitle("ROUND_STARTED", "  ")).toBe("● Nouvelle manche");
  });

  it("a un titre pour chaque évènement", () => {
    for (const alert of VIEWER_ALERT_PRIORITY) expect(viewerAlertTitle(alert)).not.toBe("");
  });
});

describe("touchesViewerMatches — ce qui ne se regroupe pas", () => {
  const mine = match({ status: "READY", team1Id: 1, team2Id: 2 });
  const other = match({ id: 2, status: "READY", team1Id: 3, team2Id: 4 });

  it("vrai au premier instantané", () => {
    expect(touchesViewerMatches(null, detail([mine]))).toBe(true);
  });

  it("vrai quand le match du lecteur bouge", () => {
    const after = detail([{ ...mine, status: "AWAITING_CONFIRMATION", updatedAt: "2026-09-23T20:05:00Z" }, other]);
    expect(touchesViewerMatches(detail([mine, other]), after)).toBe(true);
  });

  it("faux quand seul le match d'autres équipes bouge", () => {
    const after = detail([mine, { ...other, status: "COMPLETED", updatedAt: "2026-09-23T20:05:00Z" }]);
    expect(touchesViewerMatches(detail([mine, other]), after)).toBe(false);
  });

  it("vrai quand un nouveau match du lecteur apparaît", () => {
    const next = match({ id: 3, roundNumber: 2, status: "READY", team1Id: 1, team2Id: 5 });
    expect(touchesViewerMatches(detail([mine]), detail([mine, next]))).toBe(true);
  });

  it("vrai quand l'état du tournoi change, faux pour un spectateur sinon", () => {
    expect(touchesViewerMatches(detail([other]), detail([other], { card: { state: "FINISHED" } }))).toBe(true);
    const spectator = { myTeamId: null };
    expect(
      touchesViewerMatches(detail([other], spectator), detail([{ ...other, status: "COMPLETED" }], spectator)),
    ).toBe(false);
  });
});
