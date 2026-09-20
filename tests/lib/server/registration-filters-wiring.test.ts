import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/teams-service");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/tournaments/state");
jest.mock("@/lib/server/tournaments/repository");
jest.mock("@/lib/server/tournaments/bot-logs");

import type { PoolConnection } from "mysql2/promise";
import {
  canUserRegister,
  registerCurrentUserTeam,
  registerTeamsByIds,
} from "@/lib/server/tournaments/registration";
import { getUserActiveTeam } from "@/lib/server/teams-service";
import { ensureSoloEntry, findSoloEntry } from "@/lib/server/solo-entries-service";
import { syncTournamentState } from "@/lib/server/tournaments/state";
import { loadTournamentRow } from "@/lib/server/tournaments/repository";

/**
 * Les conditions d'inscription, **là où elles s'appliquent et là où elles ne
 * s'appliquent pas**.
 *
 * La règle elle-même est éprouvée à part (`tests/lib/shared/registration-filters.test.ts`).
 * Ce qui se joue ici est le **câblage**, et c'est lui qui porte la propriété la
 * plus facile à casser : le contrôle vit dans `registerCurrentUserTeam` et
 * **jamais** dans le tronc commun `registerTeam`, sans quoi les équipes
 * fantômes — qui n'ont aucun joueur — deviendraient inscriptibles par personne,
 * ce qui est exactement l'usage pour lequel elles existent.
 *
 * Voir `docs/features/REGISTRATION_FILTERS.md`.
 */

type Row = Record<string, unknown>;

const TOURNAMENT: Row = {
  id: 5,
  state: "REGISTRATION",
  max_teams: 16,
  participant_type: "TEAM",
  registration_discord_requirement: "ANY_PLAYER",
  registration_min_players: 5,
};

/**
 * Connexion factice.
 *
 * `roster` décrit le roster que la base rendra : un tableau de drapeaux « ce
 * joueur a-t-il un tag certifié ». `registrations` compte les inscrits.
 */
function mockConnection(roster: boolean[], overrides: Row = {}) {
  const tournament = { ...TOURNAMENT, ...overrides };
  const inserts: unknown[][] = [];

  const execute = jest.fn(async (sql: string, params: unknown[] = []) => {
    const q = String(sql).replace(/\s+/g, " ").trim();

    // La lecture des fantômes est **verrouillante** elle aussi : elle doit donc
    // être reconnue avant le verrou de la ligne du tournoi, sans quoi ce dernier
    // l'avalerait.
    if (q.startsWith("SELECT id, is_ghost, deleted_at")) {
      return [(params as number[]).map((id) => ({ id, is_ghost: 1, deleted_at: null }))];
    }
    if (q.includes("FOR UPDATE")) return [[{ id: tournament.id }]];
    if (q.startsWith("SELECT (u.discord_verified_at IS NOT NULL)")) {
      return [roster.map((verified) => ({ verified: verified ? 1 : 0 }))];
    }
    if (q.startsWith("SELECT (discord_verified_at IS NOT NULL)")) {
      return [roster.map((verified) => ({ verified: verified ? 1 : 0 }))];
    }
    if (q.startsWith("SELECT COUNT(*) AS c")) return [[{ c: 0 }]];
    if (q.startsWith("INSERT INTO bg_tournament_registrations")) {
      inserts.push(params);
      return [{ insertId: 1, affectedRows: 1 }];
    }

    throw new Error(`requête inattendue : ${q}`);
  });

  (syncTournamentState as jest.Mock).mockResolvedValue({ row: tournament } as never);
  (loadTournamentRow as jest.Mock).mockResolvedValue(tournament as never);

  return { connection: { execute } as unknown as PoolConnection, inserts };
}

beforeEach(() => {
  jest.clearAllMocks();
  (getUserActiveTeam as jest.Mock).mockResolvedValue({
    teamId: 42,
    roles: ["OWNER"],
  } as never);
  (findSoloEntry as jest.Mock).mockResolvedValue(null as never);
  (ensureSoloEntry as jest.Mock).mockResolvedValue(999 as never);
});

describe("inscription d'un joueur", () => {
  it("passe quand l'équipe remplit les conditions", async () => {
    const { connection, inserts } = mockConnection([true, false, false, false, false]);

    await registerCurrentUserTeam(connection, 5, 7);

    expect(inserts).toHaveLength(1);
  });

  it("refuse une équipe trop petite, sans inscrire", async () => {
    const { connection, inserts } = mockConnection([true, true]);

    await expect(registerCurrentUserTeam(connection, 5, 7)).rejects.toThrow(
      "TEAM_TOO_FEW_PLAYERS",
    );
    expect(inserts).toHaveLength(0);
  });

  it("refuse une équipe sans aucun tag certifié", async () => {
    const { connection, inserts } = mockConnection([false, false, false, false, false]);

    await expect(registerCurrentUserTeam(connection, 5, 7)).rejects.toThrow(
      "TEAM_NEEDS_VERIFIED_DISCORD",
    );
    expect(inserts).toHaveLength(0);
  });

  it("exige tous les tags quand le tournoi le demande", async () => {
    const { connection } = mockConnection([true, true, true, true, false], {
      registration_discord_requirement: "ALL_PLAYERS",
    });

    await expect(registerCurrentUserTeam(connection, 5, 7)).rejects.toThrow(
      "TEAM_NEEDS_ALL_VERIFIED_DISCORD",
    );
  });

  it("n'exige rien quand le tournoi n'exige rien", async () => {
    const { connection, inserts } = mockConnection([false], {
      registration_discord_requirement: "NONE",
      registration_min_players: 1,
    });

    await registerCurrentUserTeam(connection, 5, 7);
    expect(inserts).toHaveLength(1);
  });

  it("juge la qualité d'engager **avant** les conditions", async () => {
    // Un joueur du roster doit lire qu'il n'a pas la charge de l'équipe, et non
    // qu'elle est trop petite : c'est son droit qui manque, pas l'effectif.
    (getUserActiveTeam as jest.Mock).mockResolvedValue({
      teamId: 42,
      roles: ["DPS"],
    } as never);
    const { connection } = mockConnection([]);

    await expect(registerCurrentUserTeam(connection, 5, 7)).rejects.toThrow("NOT_TEAM_MANAGER");
  });
});

describe("tournoi individuel", () => {
  const solo = { participant_type: "SOLO" as const };

  it("ignore l'effectif minimal, et n'a pas créé d'entrée solo pour rien", async () => {
    const { connection, inserts } = mockConnection([true], solo);

    await registerCurrentUserTeam(connection, 5, 7);

    expect(inserts).toHaveLength(1);
  });

  it("refuse le joueur non certifié **avant** de créer son entrée solo", async () => {
    // Une inscription refusée ne doit pas laisser derrière elle une ligne
    // d'équipe que personne n'a demandée.
    const { connection, inserts } = mockConnection([false], solo);

    await expect(registerCurrentUserTeam(connection, 5, 7)).rejects.toThrow(
      "TEAM_NEEDS_VERIFIED_DISCORD",
    );
    expect(ensureSoloEntry).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });
});

describe("équipes fantômes — hors conditions", () => {
  it("inscrit un lot de fantômes sans joueur, sur un tournoi qui exige tout", async () => {
    // **La propriété à ne jamais casser.** Une fantôme n'a aucun joueur : si le
    // contrôle vivait dans le tronc commun, remplir un plateau deviendrait
    // impossible — et c'est l'usage même de ces équipes.
    const { connection, inserts } = mockConnection([], {
      registration_discord_requirement: "ALL_PLAYERS",
      registration_min_players: 5,
    });

    await registerTeamsByIds(connection, 5, [900, 901, 902]);

    expect(inserts).toHaveLength(3);
  });
});

describe("canUserRegister — le bouton dit ce que le serveur fera", () => {
  it("ferme le bouton quand les conditions ne sont pas remplies", async () => {
    const { connection } = mockConnection([false, false, false, false, false]);

    expect(await canUserRegister(connection, 5, 7)).toBe(false);
  });

  it("l'ouvre quand elles le sont", async () => {
    const { connection } = mockConnection([true, true, true, true, true]);

    expect(await canUserRegister(connection, 5, 7)).toBe(true);
  });

  it("juge le **joueur** en individuel, sans attendre son entrée solo", async () => {
    // L'entrée solo n'existe qu'après la première inscription : la juger
    // fermerait le bouton trop tard, c'est-à-dire jamais.
    const { connection } = mockConnection([false], { participant_type: "SOLO" });

    expect(await canUserRegister(connection, 5, 7)).toBe(false);
  });
});
