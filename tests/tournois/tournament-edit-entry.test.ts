import { describe, expect, it } from "@jest/globals";
import {
  canShowEditButton,
  editLockNotice,
  editSavedMessage,
  FINISHED_EDIT_NOTICE,
} from "@/app/(secured)/tournois/[id]/_lib/edit-entry";

const NOW = Date.parse("2026-08-27T12:00:00.000Z");
const iso = (h: number) => new Date(NOW + h * 3600_000).toISOString();

const card = (over: Record<string, unknown> = {}) =>
  ({ state: "UPCOMING", startVisibilityAt: iso(24), maxTeams: 16, ...over }) as never;

describe("canShowEditButton", () => {
  it("montre le bouton au staff sur un tournoi caché", () => {
    expect(canShowEditButton(card(), true, NOW)).toBe(true);
  });

  it("montre le bouton au staff sur un tournoi en inscriptions", () => {
    expect(canShowEditButton(card({ state: "REGISTRATION", startVisibilityAt: iso(-1) }), true, NOW)).toBe(true);
  });

  it("cache le bouton à un utilisateur sans permission", () => {
    expect(canShowEditButton(card(), false, NOW)).toBe(false);
  });

  // Lancé, seul l'interrupteur de planification reste réglable : le bouton y
  // mène, il ne doit donc pas disparaître au coup d'envoi.
  it("montre le bouton sur un tournoi lancé (planification encore réglable)", () => {
    expect(canShowEditButton(card({ state: "RUNNING" }), true, NOW)).toBe(true);
  });

  it("cache le bouton lancé à un utilisateur sans permission", () => {
    expect(canShowEditButton(card({ state: "RUNNING" }), false, NOW)).toBe(false);
  });

  it("cache le bouton sur un tournoi terminé", () => {
    expect(canShowEditButton(card({ state: "FINISHED" }), true, NOW)).toBe(false);
  });
});

describe("editLockNotice", () => {
  it("ne dit rien quand tout est modifiable", () => {
    expect(editLockNotice(null, iso(24))).toBeNull();
  });

  it("explique la restriction due à la publication en citant la date", () => {
    const notice = editLockNotice("VISIBLE", "2026-08-20T10:00:00.000Z");
    expect(notice).toContain("20/08/2026");
    expect(notice).toMatch(/format/i);
  });

  it("explique le verrouillage d'un tournoi lancé", () => {
    expect(editLockNotice("STARTED", iso(-24))).toMatch(/en cours|lanc/i);
  });

  it("dit ce qui reste réglable sur un tournoi lancé", () => {
    expect(editLockNotice("STARTED", iso(-24))).toContain("planification des matchs");
  });

  it("dit d'un tournoi terminé qu'il n'est plus modifiable", () => {
    expect(FINISHED_EDIT_NOTICE).toMatch(/terminé.*plus modifiable/);
  });
});

describe("editSavedMessage", () => {
  it("ne dit pas « modifié » quand rien n'a été écrit", () => {
    expect(editSavedMessage(false, { changed: false, movedToPlanning: 0 }, true)).toBe(
      "Aucune modification à enregistrer.",
    );
    expect(editSavedMessage(false, null, false)).toBe("Aucune modification à enregistrer.");
  });

  it("confirme les champs enregistrés, planification inchangée", () => {
    expect(editSavedMessage(true, { changed: false, movedToPlanning: 0 }, false)).toBe("Tournoi modifié.");
    expect(editSavedMessage(true, null, false)).toBe("Tournoi modifié.");
  });

  it("annonce la bascule seule, avec les matchs renvoyés à planifier", () => {
    expect(editSavedMessage(false, { changed: true, movedToPlanning: 2 }, true)).toBe(
      "Planification activée : 2 matchs à planifier.",
    );
  });

  it("annonce les deux quand champs et planification ont changé", () => {
    expect(editSavedMessage(true, { changed: true, movedToPlanning: 0 }, false)).toMatch(
      /^Tournoi modifié\. Planification par l'arbitrage désactivée/,
    );
  });
});
