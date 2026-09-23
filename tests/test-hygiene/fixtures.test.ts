import { describe, expect, it, jest } from "@jest/globals";
import { can } from "@/lib/shared/permissions";
import { DEFAULT_REGISTRATION_FILTERS } from "@/lib/shared/registration-filters";
import { tournamentRegistrationFilters } from "@/lib/server/tournaments/registration-eligibility";
import { authUser, fullProfileResponse, publicUserProfile } from "../helpers/auth-user";
import { fakePool, connectionMock } from "../helpers/sql-double";
import { teamDetailResponse } from "../helpers/team-detail";
import { tournamentDetail, tournamentSnapshot } from "../helpers/tournament-detail";
import {
  matchRow,
  phaseRow,
  registrationRow,
  tournamentListRow,
  tournamentRow,
} from "../helpers/tournament-rows";

/**
 * Les fabriques de `tests/helpers/` remplacent des objets partiels passés en
 * `as never` : elles doivent donc rendre ce que le code réel reçoit, et
 * surcharger sans rien écraser d'autre. Leur complétude est vérifiée à la
 * compilation (`npm run typecheck`) ; ce qui se teste ici est ce que le type ne
 * dit pas — les invariants et les défauts.
 */

describe("authUser", () => {
  it("dérive le rôle ADMIN du drapeau, comme `resolveRoles`", () => {
    expect(authUser({ isAdmin: true }).roles).toEqual(["ADMIN"]);
    expect(authUser().roles).toEqual([]);
    expect(can(authUser({ isAdmin: true }), "roles")).toBe(true);
  });

  it("laisse le test fixer lui-même les rôles", () => {
    const arbitre = authUser({ id: 3, roles: ["ARBITRE"] });
    expect(arbitre).toMatchObject({ id: 3, isAdmin: false, roles: ["ARBITRE"] });
    expect(can(arbitre, "tournaments")).toBe(true);
    expect(can(arbitre, "roles")).toBe(false);
  });

  it("ne porte que les champs d'`AuthUser`, aucune adresse", () => {
    expect(Object.keys(authUser()).sort()).toEqual(
      ["avatarUrl", "discordId", "googleSub", "id", "isAdmin", "isAdult", "pseudo", "roles"],
    );
  });
});

describe("profils", () => {
  it("surcharge le profil champ par champ sous la fiche complète", () => {
    const full = fullProfileResponse({ profile: { pseudo: "Nova" }, isSelf: false });
    expect(full.profile).toEqual(publicUserProfile({ pseudo: "Nova" }));
    expect(full.isSelf).toBe(false);
    expect(full.stats.tournamentsPlayed).toBe(0);
  });

  it("surcharge l'en-tête d'équipe sans perdre les autres champs", () => {
    const detail = teamDetailResponse({ team: { id: 7, name: "Dragons" } });
    expect(detail.team).toMatchObject({ id: 7, name: "Dragons", tag: null, isGhost: false });
    expect(detail.members).toEqual([]);
  });
});

describe("lignes de base", () => {
  it("cale les conditions d'inscription sur les défauts des colonnes", () => {
    // Une colonne absente valait `NaN` et levait l'effectif minimal : la ligne
    // de test doit dire ce qu'un tournoi créé sans réglage porte réellement.
    expect(tournamentRegistrationFilters(tournamentRow())).toEqual(DEFAULT_REGISTRATION_FILTERS);
  });

  it("applique les surcharges et garde le reste", () => {
    const row = tournamentRow({ id: 9, state: "RUNNING" });
    expect(row).toMatchObject({ id: 9, state: "RUNNING", format: "SINGLE", manual_seeding: 0 });
  });

  it("ajoute l'effectif à la ligne de liste", () => {
    expect(tournamentListRow().registered_teams).toBe(0);
    expect(tournamentListRow({ registered_teams: 4, id: 3 })).toMatchObject({
      id: 3,
      registered_teams: 4,
    });
  });

  it("rend des lignes de match, de phase et d'inscription complètes", () => {
    expect(matchRow({ status: "COMPLETED" })).toMatchObject({ status: "COMPLETED", phase_id: 0 });
    expect(phaseRow({ format: "SINGLE" })).toMatchObject({ format: "SINGLE", state: "PENDING" });
    expect(registrationRow({ team_id: 4 })).toMatchObject({ team_id: 4, seed: null });
  });
});

describe("instantanés", () => {
  it("unit instantané et contexte du lecteur", () => {
    const detail = tournamentDetail({ canDelete: true });
    expect(detail.canDelete).toBe(true);
    expect(detail.card).toEqual(tournamentSnapshot().card);
    expect(detail.seedingSource).toBe("REGISTRATION");
  });
});

describe("doubles SQL", () => {
  it("rend le même objet, seulement typé", () => {
    const execute = jest.fn();
    const members = { execute };
    expect(fakePool(members)).toBe(members);
  });

  it("fournit une connexion dont chaque membre est un mock distinct", () => {
    const connection = connectionMock();
    expect(new Set(Object.values(connection)).size).toBe(6);
    expect(jest.isMockFunction(connection.commit)).toBe(true);
  });
});
