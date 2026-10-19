import { describe, expect, it } from "@jest/globals";
import {
  canViewBattletag,
  visibleBattletag,
  type BattletagSubject,
  type BattletagViewer,
} from "@/lib/shared/battletag-visibility";

/**
 * Masquer son BattleTag le retire de partout, arbitres et administrateurs
 * compris, sauf de la fenêtre « Contacts » d'un match ouverte au lecteur
 * (`sharesLiveMatch`, posé par `match-launch-info.ts` seul — décision de
 * l'utilisateur du 2026-10-19).
 */

const OWNER = 7;
const hidden: BattletagSubject = { userId: OWNER, visible: false };
const player: BattletagViewer = { id: 20 };
const referee: BattletagViewer = { id: 30, roles: ["ARBITRE"] };
const admin: BattletagViewer = { id: 40, isAdmin: true };
const caster: BattletagViewer = { id: 50, roles: ["CASTER"] };

describe("canViewBattletag", () => {
  it("rend toujours le tag à son titulaire, masqué ou non", () => {
    expect(canViewBattletag({ id: OWNER }, hidden)).toBe(true);
    expect(canViewBattletag({ id: OWNER }, { ...hidden, visible: true })).toBe(true);
  });

  it("rend un tag visible à tout le monde, visiteur sans compte compris", () => {
    const visible = { ...hidden, visible: true };
    expect(canViewBattletag(player, visible)).toBe(true);
    expect(canViewBattletag(null, visible)).toBe(true);
    expect(canViewBattletag(undefined, visible)).toBe(true);
  });

  it("cache un tag masqué à un visiteur sans compte, quoi qu'on lui prête", () => {
    expect(canViewBattletag(null, { ...hidden, sharesLiveMatch: true })).toBe(false);
    expect(canViewBattletag(undefined, { ...hidden, sharesLiveMatch: true })).toBe(false);
  });

  it("rend un tag masqué dans la fenêtre « Contacts » d'un match ouverte au lecteur", () => {
    expect(canViewBattletag(player, { ...hidden, sharesLiveMatch: true })).toBe(true);
    expect(canViewBattletag(referee, { ...hidden, sharesLiveMatch: true })).toBe(true);
  });

  it("cache un tag masqué partout ailleurs, arbitres et administrateurs compris", () => {
    for (const viewer of [player, referee, admin, caster]) {
      expect(canViewBattletag(viewer, hidden)).toBe(false);
      expect(canViewBattletag(viewer, { ...hidden, sharesLiveMatch: false })).toBe(false);
    }
  });
});

describe("visibleBattletag", () => {
  it("rend le tag quand le lecteur y a droit, null sinon", () => {
    expect(visibleBattletag("Nova#1234", player, { ...hidden, sharesLiveMatch: true })).toBe("Nova#1234");
    expect(visibleBattletag("Nova#1234", player, hidden)).toBeNull();
  });

  it("rend null sans tag, même pour le titulaire", () => {
    expect(visibleBattletag(null, { id: OWNER }, hidden)).toBeNull();
    expect(visibleBattletag("", { id: OWNER }, hidden)).toBeNull();
  });
});
