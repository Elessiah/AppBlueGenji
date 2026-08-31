import { describe, expect, it } from "@jest/globals";
import {
  canShowEditButton,
  editLockNotice,
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

  it("cache le bouton sur un tournoi lancé", () => {
    expect(canShowEditButton(card({ state: "RUNNING" }), true, NOW)).toBe(false);
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
});
