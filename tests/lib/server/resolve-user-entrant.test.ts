import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";

jest.mock("@/lib/server/teams-service");
jest.mock("@/lib/server/solo-entries-service");

import { resolveUserEntrant, resolveUserEntrantTeamId } from "@/lib/server/tournaments/registration";
import { getUserActiveTeam } from "@/lib/server/teams-service";
import { findSoloEntry } from "@/lib/server/solo-entries-service";
import type { TeamRole } from "@/lib/shared/types";

/**
 * L'engagé d'un joueur **et sa qualité pour agir en son nom**.
 *
 * C'est le prédicat d'autorisation central de la passe de sécurité : il décide
 * qui peut inscrire une équipe et — depuis la même passe — qui peut l'en
 * retirer. Il n'était exercé nulle part : la route d'abandon moque
 * `getUserEntrant` en entier, et les tests d'inscription solo ne couvrent que
 * l'ancien `resolveUserEntrantTeamId`. Voir `docs/AUTHORIZATION_RULES.md` §4.2
 * et §4.7.
 */

const activeTeamMock = getUserActiveTeam as jest.MockedFunction<typeof getUserActiveTeam>;
const soloEntryMock = findSoloEntry as jest.MockedFunction<typeof findSoloEntry>;

const conn = {} as PoolConnection;
const TEAM_TOURNAMENT = { participant_type: "TEAM" as const };
const SOLO_TOURNAMENT = { participant_type: "SOLO" as const };

function activeTeam(roles: TeamRole[]) {
  return { teamId: 77, teamName: "Test - Dragons", roles };
}

describe("resolveUserEntrant — tournoi par équipes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([["OWNER"], ["MANAGER"]] as TeamRole[][])(
    "accorde la qualité d'agir à un %s",
    async (role) => {
      activeTeamMock.mockResolvedValue(activeTeam([role]));

      await expect(resolveUserEntrant(conn, TEAM_TOURNAMENT, 42)).resolves.toEqual({
        teamId: 77,
        canActForEntrant: true,
      });
    },
  );

  it.each([["DPS"], ["TANK"], ["HEAL"], ["COACH"], ["CAPITAINE"]] as TeamRole[][])(
    "la refuse à un %s, rôle sportif",
    async (role) => {
      // Jouer pour une équipe ne donne pas le droit de l'engager — ni de la
      // désengager, ce qui la condamne sans retour.
      activeTeamMock.mockResolvedValue(activeTeam([role]));

      await expect(resolveUserEntrant(conn, TEAM_TOURNAMENT, 42)).resolves.toEqual({
        teamId: 77,
        canActForEntrant: false,
      });
    },
  );

  it("accorde la qualité dès qu'un rôle de gestion figure dans le cumul", async () => {
    // Les rôles sont cumulables : un capitaine qui est aussi manager décide.
    activeTeamMock.mockResolvedValue(activeTeam(["CAPITAINE", "DPS", "MANAGER"]));

    await expect(resolveUserEntrant(conn, TEAM_TOURNAMENT, 42)).resolves.toEqual({
      teamId: 77,
      canActForEntrant: true,
    });
  });

  it("rend `teamId: null` et refuse la qualité au joueur sans équipe", async () => {
    activeTeamMock.mockResolvedValue(null);

    await expect(resolveUserEntrant(conn, TEAM_TOURNAMENT, 42)).resolves.toEqual({
      teamId: null,
      canActForEntrant: false,
    });
  });

  it("lit l'équipe sur la connexion de l'appelant", async () => {
    // La résolution est appelée depuis des transactions qui tiennent déjà un
    // verrou : emprunter une seconde place du pool y arme un convoi.
    activeTeamMock.mockResolvedValue(activeTeam(["OWNER"]));

    await resolveUserEntrant(conn, TEAM_TOURNAMENT, 42);

    expect(activeTeamMock).toHaveBeenCalledWith(42, conn);
    expect(soloEntryMock).not.toHaveBeenCalled();
  });
});

describe("resolveUserEntrant — tournoi individuel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("accorde toujours la qualité : l'engagé est le joueur lui-même", async () => {
    // Une entrée solo n'a ni membre ni rôle — il n'y a personne à représenter.
    soloEntryMock.mockResolvedValue(910);

    await expect(resolveUserEntrant(conn, SOLO_TOURNAMENT, 42)).resolves.toEqual({
      teamId: 910,
      canActForEntrant: true,
    });
    expect(activeTeamMock).not.toHaveBeenCalled();
  });

  it("l'accorde même sans entrée solo encore créée", async () => {
    // Elle naît à l'inscription : l'absence n'est pas un refus de droit.
    soloEntryMock.mockResolvedValue(null);

    await expect(resolveUserEntrant(conn, SOLO_TOURNAMENT, 42)).resolves.toEqual({
      teamId: null,
      canActForEntrant: true,
    });
  });

  it("ignore l'équipe que le joueur pourrait avoir par ailleurs", async () => {
    activeTeamMock.mockResolvedValue(activeTeam(["DPS"]));
    soloEntryMock.mockResolvedValue(910);

    await expect(resolveUserEntrant(conn, SOLO_TOURNAMENT, 42)).resolves.toEqual({
      teamId: 910,
      canActForEntrant: true,
    });
  });
});

describe("resolveUserEntrantTeamId — même résolution, sans la qualité", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rend l'identifiant de l'engagé, quel que soit le rôle porté", async () => {
    // Les appelants qui n'écrivent rien (report de score, signalement) n'ont
    // que faire de la qualité : le raccourci ne doit pas se mettre à refuser.
    activeTeamMock.mockResolvedValue(activeTeam(["DPS"]));

    await expect(resolveUserEntrantTeamId(conn, TEAM_TOURNAMENT, 42)).resolves.toBe(77);
  });

  it("rend `null` quand il n'y a rien à engager", async () => {
    activeTeamMock.mockResolvedValue(null);

    await expect(resolveUserEntrantTeamId(conn, TEAM_TOURNAMENT, 42)).resolves.toBeNull();
  });
});
