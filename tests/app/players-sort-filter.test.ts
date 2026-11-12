import { readSource } from "../helpers/read-source";
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  compareNewestFirst,
  deletedToggleState,
  filterPlayers,
  matchesPlayerStatusFilter,
  roleAfterStatusChoice,
  statusChoiceResetsRole,
  sortPlayers,
  statusFilterAllowsRoles,
  statusFilterExcludesDeleted,
} from "@/lib/shared/player-directory";
import type { PlayerRole, PublicUserProfile } from "@/lib/shared/types";
import { publicUserProfile } from "../helpers/auth-user";

/**
 * Annuaire `/joueurs` : tri, filtres de statut et de rôle. Le composant ne fait
 * que brancher ces fonctions pures sur ses états (`PlayersList.tsx`) ; elles
 * sont testées ici sur des profils complets, au lieu de chercher des chaînes
 * exactes dans la source du composant (le dépôt n'embarque pas de DOM de test).
 */

const ROOT = join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
const frPlayers = JSON.parse(read("messages/fr/players.json")) as typeof import("@/messages/fr/players.json");
const enPlayers = JSON.parse(read("messages/en/players.json")) as typeof import("@/messages/fr/players.json");

const team = { id: 4, name: "Glaciers", colorIndex: 0 };
const inRoster = publicUserProfile({ id: 1, pseudo: "Rosa", team, roles: ["DPS"] });
const freeAgent = publicUserProfile({ id: 2, pseudo: "Nova", team: null, openToRecruitment: true });
const closed = publicUserProfile({ id: 3, pseudo: "Kite", team: null, openToRecruitment: false });
const deleted = publicUserProfile({ id: 4, pseudo: "Supprimé", team: null, isDeleted: true });

const keyOf = (player: PublicUserProfile) => `${player.pseudo} ${player.team?.name || ""}`.toLowerCase();
const ids = (players: PublicUserProfile[]) => players.map((player) => player.id);

describe("matchesPlayerStatusFilter", () => {
  it("matchesPlayerStatusFilter_all_keepsEveryone", () => {
    expect([inRoster, freeAgent, closed, deleted].filter((p) => matchesPlayerStatusFilter(p, "all"))).toHaveLength(4);
  });

  it("matchesPlayerStatusFilter_free_keepsOnlyOpenPlayersWithoutTeam", () => {
    expect(ids([inRoster, freeAgent, closed].filter((p) => matchesPlayerStatusFilter(p, "free")))).toEqual([2]);
  });

  it("matchesPlayerStatusFilter_unaffiliated_keepsEveryPlayerWithoutTeam", () => {
    expect(ids([inRoster, freeAgent, closed].filter((p) => matchesPlayerStatusFilter(p, "unaffiliated")))).toEqual([2, 3]);
  });

  it("matchesPlayerStatusFilter_deletedAccountUnderFree_returnsFalse", () => {
    expect(matchesPlayerStatusFilter({ ...deleted, openToRecruitment: true }, "free")).toBe(false);
  });

  it("matchesPlayerStatusFilter_deletedAccountUnderUnaffiliated_returnsFalse", () => {
    expect(matchesPlayerStatusFilter(deleted, "unaffiliated")).toBe(false);
  });
});

describe("statusFilterExcludesDeleted / statusFilterAllowsRoles", () => {
  it("statusFilterExcludesDeleted_all_returnsFalse", () => {
    expect(statusFilterExcludesDeleted("all")).toBe(false);
  });

  it("statusFilterExcludesDeleted_rosterlessFilters_returnTrue", () => {
    expect(statusFilterExcludesDeleted("free")).toBe(true);
    expect(statusFilterExcludesDeleted("unaffiliated")).toBe(true);
  });

  it("statusFilterAllowsRoles_all_returnsTrue", () => {
    expect(statusFilterAllowsRoles("all")).toBe(true);
  });

  it("statusFilterAllowsRoles_rosterlessFilters_returnFalse", () => {
    expect(statusFilterAllowsRoles("free")).toBe(false);
    expect(statusFilterAllowsRoles("unaffiliated")).toBe(false);
  });
});

describe("deletedToggleState", () => {
  it("deletedToggleState_allFilterAndShown_isPressedAndActive", () => {
    expect(deletedToggleState(true, "all")).toEqual({ inert: false, pressed: true });
  });

  it("deletedToggleState_shownThenRosterlessFilter_isInertAndNotPressed", () => {
    expect(deletedToggleState(true, "unaffiliated")).toEqual({ inert: true, pressed: false });
    expect(deletedToggleState(true, "free")).toEqual({ inert: true, pressed: false });
  });

  it("deletedToggleState_hidden_isNotPressed", () => {
    expect(deletedToggleState(false, "all")).toEqual({ inert: false, pressed: false });
  });
});

describe("statusChoiceResetsRole", () => {
  it("statusChoiceResetsRole_roleChosenThenRosterlessStatus_true", () => {
    expect(statusChoiceResetsRole<PlayerRole>("DPS", "free")).toBe(true);
    expect(statusChoiceResetsRole<PlayerRole>("COACH", "unaffiliated")).toBe(true);
  });

  it("statusChoiceResetsRole_noRoleOrAllStatus_false", () => {
    expect(statusChoiceResetsRole<PlayerRole>("all", "free")).toBe(false);
    expect(statusChoiceResetsRole<PlayerRole>("TANK", "all")).toBe(false);
  });
});

describe("PlayersList — branchements des filtres inertes", () => {
  const source = readSource("app/(secured)/joueurs/PlayersList.tsx");

  it("annonce la remise du rôle par un toast neutre", () => {
    expect(source).toContain('if (statusChoiceResetsRole(roleFilter, next)) showInfo(t("list.roleReset"), { once: true });');
  });

  it("rattache la raison aux puces de rôle et à la bascule inertes", () => {
    expect(source).toContain("aria-describedby={!rolesAllowed && k !== \"all\" ? ROLES_INERT_ID : undefined}");
    expect(source).toContain("aria-describedby={deletedToggleInert ? DELETED_INERT_ID : undefined}");
    expect(source).toMatch(/<span id=\{ROLES_INERT_ID\} hidden>\s*\{t\("list.rolesInert"\)\}/);
    expect(source).toMatch(/<span id=\{DELETED_INERT_ID\} hidden>\s*\{t\("list.deletedInert"\)\}/);
  });

  it("le « · » de la rangée de statut est rogné au retour à la ligne, jamais pendant en fin de ligne", () => {
    const css = readSource("app/(secured)/_shared/annuaire.module.css");
    const row = css.slice(css.indexOf(".statusRow {"), css.indexOf("}", css.indexOf(".statusRow {")));
    expect(row).toContain("overflow-x: clip;");
    expect(css).toMatch(/\.statusOpts::before \{\s*content: "·";\s*content: "·" \/ "";\s*position: absolute;/);
    expect(css).not.toContain(".statusSep");
    expect(source).not.toContain("statusSep");
  });

  it("les textes existent en français et en anglais", () => {
    for (const locale of ["fr", "en"]) {
      const list = (JSON.parse(readSource(`messages/${locale}/players.json`)) as { list: Record<string, unknown> }).list;
      for (const key of ["roleReset", "rolesInert", "deletedInert"]) expect(typeof list[key]).toBe("string");
    }
  });
});

describe("roleAfterStatusChoice", () => {
  it("roleAfterStatusChoice_rosterlessStatus_resetsRoleToAll", () => {
    expect(roleAfterStatusChoice<PlayerRole>("DPS", "free")).toBe("all");
    expect(roleAfterStatusChoice<PlayerRole>("HEAL", "unaffiliated")).toBe("all");
  });

  it("roleAfterStatusChoice_backToAll_keepsRole", () => {
    expect(roleAfterStatusChoice<PlayerRole>("TANK", "all")).toBe("TANK");
  });
});

describe("compareNewestFirst", () => {
  const at = (createdAt: string, pseudo: string) => ({ createdAt, pseudo });

  it("compareNewestFirst_differentInstants_newestFirst", () => {
    const players = [
      at("2026-01-02T10:00:00.000Z", "b"),
      at("2026-10-20T08:00:00.000Z", "c"),
      at("2025-12-31T23:59:59.000Z", "a"),
    ];
    expect([...players].sort(compareNewestFirst("fr")).map((p) => p.pseudo)).toEqual(["c", "b", "a"]);
  });

  it("compareNewestFirst_sameInstant_tieBreaksByPseudoInPageLanguage", () => {
    const same = "2026-05-05T05:05:05.000Z";
    // « Émile » se range avec les « E », pas après le « Z » d'un ordre binaire.
    const players = [at(same, "Zoé"), at(same, "Émile"), at(same, "Alex")];
    expect([...players].sort(compareNewestFirst("fr")).map((p) => p.pseudo)).toEqual(["Alex", "Émile", "Zoé"]);
  });

  it("compareNewestFirst_samePlayer_returnsZero", () => {
    const player = at("2026-05-05T05:05:05.000Z", "Nova");
    expect(compareNewestFirst("en")(player, { ...player })).toBe(0);
  });

  it("compareNewestFirst_deletedAccountWithoutDate_sortsLastThenByPseudo", () => {
    const players = [
      { createdAt: null, pseudo: "compte_supprime_b" },
      at("2025-01-01T00:00:00.000Z", "z"),
      { createdAt: null, pseudo: "compte_supprime_a" },
    ];
    expect([...players].sort(compareNewestFirst("fr")).map((p) => p.pseudo)).toEqual([
      "z",
      "compte_supprime_a",
      "compte_supprime_b",
    ]);
  });
});

describe("sortPlayers", () => {
  const a = publicUserProfile({ id: 1, pseudo: "émile", tournamentsCount: 1, createdAt: "2026-02-01T00:00:00.000Z" });
  const b = publicUserProfile({ id: 2, pseudo: "Zed", tournamentsCount: 5, createdAt: "2026-03-01T00:00:00.000Z" });
  const c = publicUserProfile({ id: 3, pseudo: "alpha", createdAt: "2026-01-01T00:00:00.000Z" });

  it("sortPlayers_pseudo_ordersByLocalText", () => {
    expect(ids(sortPlayers([b, a, c], "pseudo", "fr"))).toEqual([3, 1, 2]);
  });

  it("sortPlayers_tournaments_mostPlayedFirstAndMissingCountLast", () => {
    expect(ids(sortPlayers([c, a, b], "tournaments", "fr"))).toEqual([2, 1, 3]);
  });

  it("sortPlayers_tournamentsTie_tieBreaksByPseudoInPageLanguage", () => {
    const zoe = publicUserProfile({ id: 7, pseudo: "Zoé", tournamentsCount: 0 });
    const emile = publicUserProfile({ id: 8, pseudo: "Émile", tournamentsCount: 0 });
    const alex = publicUserProfile({ id: 9, pseudo: "alex", tournamentsCount: 0 });
    const star = publicUserProfile({ id: 10, pseudo: "Yann", tournamentsCount: 3 });
    expect(ids(sortPlayers([zoe, emile, star, alex], "tournaments", "fr"))).toEqual([10, 9, 8, 7]);
  });

  it("sortPlayers_created_newestFirst", () => {
    expect(ids(sortPlayers([c, a, b], "created", "en"))).toEqual([2, 1, 3]);
  });

  it("sortPlayers_anySort_leavesInputUntouched", () => {
    const input = [b, a, c];
    sortPlayers(input, "pseudo", "fr");
    expect(ids(input)).toEqual([2, 1, 3]);
  });
});

describe("filterPlayers", () => {
  const all = [inRoster, freeAgent, closed];
  const none = { query: "", role: "all", status: "all", searchKeyOf: keyOf } satisfies Parameters<
    typeof filterPlayers<PlayerRole, PublicUserProfile>
  >[1];

  it("filterPlayers_noFilter_returnsSameList", () => {
    expect(filterPlayers<PlayerRole, PublicUserProfile>(all, none)).toBe(all);
  });

  it("filterPlayers_query_matchesPseudoOrTeamName", () => {
    expect(ids(filterPlayers<PlayerRole, PublicUserProfile>(all, { ...none, query: "glac" }))).toEqual([1]);
    expect(ids(filterPlayers<PlayerRole, PublicUserProfile>(all, { ...none, query: "nov" }))).toEqual([2]);
  });

  it("filterPlayers_role_keepsPlayersWithThatRole", () => {
    expect(ids(filterPlayers<PlayerRole, PublicUserProfile>(all, { ...none, role: "DPS" }))).toEqual([1]);
  });

  it("filterPlayers_freeStatus_keepsFreeAgents", () => {
    expect(ids(filterPlayers<PlayerRole, PublicUserProfile>(all, { ...none, status: "free" }))).toEqual([2]);
  });

  it("filterPlayers_unaffiliatedStatus_keepsClosedPlayersToo", () => {
    expect(ids(filterPlayers<PlayerRole, PublicUserProfile>(all, { ...none, status: "unaffiliated" }))).toEqual([2, 3]);
  });

  it("filterPlayers_queryWithoutMatch_returnsEmptyList", () => {
    expect(filterPlayers<PlayerRole, PublicUserProfile>(all, { ...none, query: "zzz" })).toEqual([]);
  });
});

describe("libellés de l'annuaire", () => {
  it("le tri par ancienneté dit son sens, en français et en anglais", () => {
    expect(frPlayers.list.sort.created).toBe("Plus récents");
    expect(enPlayers.list.sort.created).toBe("Newest");
  });

  it("l'explication des filtres de statut existe dans les deux langues", () => {
    expect(frPlayers.list.statusHintSubject).toBe("Filtres de statut");
    expect(enPlayers.list.statusHintSubject).toBe("Status filters");
    expect(frPlayers.list.statusHint).toContain("y compris ceux qui ne sont pas ouverts aux propositions");
    expect(enPlayers.list.statusHint).toContain("including those not open to offers");
  });
});
