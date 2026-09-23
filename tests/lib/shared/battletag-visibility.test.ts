import { describe, expect, it } from "@jest/globals";
import {
  battletagNeedsTournamentContext,
  canViewBattletag,
  visibleBattletag,
  type BattletagSubject,
  type BattletagViewer,
} from "@/lib/shared/battletag-visibility";

/**
 * Masquer son BattleTag le retire de la fiche publique et de l'annuaire, pas de
 * là où il sert à jouer : les joueurs d'un même match et l'arbitrage d'un
 * tournoi vivant le lisent encore. La modale de `/profil` l'annonce au joueur ;
 * ces tests tiennent la promesse.
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
    const everything = { ...hidden, sharesLiveMatch: true, inActiveTournament: true };
    expect(canViewBattletag(null, everything)).toBe(false);
    expect(canViewBattletag(undefined, everything)).toBe(false);
  });

  it("rend un tag masqué aux autres joueurs d'un même match de tournoi vivant", () => {
    expect(canViewBattletag(player, { ...hidden, sharesLiveMatch: true })).toBe(true);
  });

  it("cache un tag masqué à un joueur quelconque, même engagé ailleurs", () => {
    expect(canViewBattletag(player, hidden)).toBe(false);
    // Le titulaire engagé dans un tournoi n'ouvre rien à qui ne l'affronte pas.
    expect(canViewBattletag(player, { ...hidden, inActiveTournament: true })).toBe(false);
  });

  it("rend un tag masqué à l'arbitrage seulement pendant un tournoi vivant du titulaire", () => {
    expect(canViewBattletag(referee, { ...hidden, inActiveTournament: true })).toBe(true);
    expect(canViewBattletag(referee, { ...hidden, inActiveTournament: false })).toBe(false);
    expect(canViewBattletag(referee, hidden)).toBe(false);
  });

  it("ne donne aucun passe-droit à l'administrateur hors tournoi, à l'inverse du tag Discord", () => {
    expect(canViewBattletag(admin, hidden)).toBe(false);
    expect(canViewBattletag(admin, { ...hidden, inActiveTournament: true })).toBe(true);
  });

  it("ne donne rien au cast : diffuser n'est pas jouer", () => {
    expect(canViewBattletag(caster, { ...hidden, inActiveTournament: true })).toBe(false);
  });
});

describe("battletagNeedsTournamentContext", () => {
  it("ne pose la question que pour un tag masqué lu par un tiers connecté", () => {
    expect(battletagNeedsTournamentContext("Nova#1234", player, hidden)).toBe(true);
    expect(battletagNeedsTournamentContext("Nova#1234", referee, hidden)).toBe(true);
  });

  it.each<[string, string | null | undefined, BattletagViewer | null, BattletagSubject]>([
    ["sans tag", null, player, hidden],
    ["tag vide", "", player, hidden],
    ["tag absent", undefined, player, hidden],
    ["lecteur titulaire", "Nova#1234", { id: OWNER }, hidden],
    ["tag visible", "Nova#1234", player, { ...hidden, visible: true }],
    ["visiteur sans compte", "Nova#1234", null, hidden],
  ])("ne la pose pas quand la réponse est acquise (%s)", (_label, tag, viewer, subject) => {
    expect(battletagNeedsTournamentContext(tag, viewer, subject)).toBe(false);
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
