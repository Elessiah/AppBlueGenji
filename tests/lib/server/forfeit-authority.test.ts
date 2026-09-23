import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/registration");
jest.mock("@/lib/server/tournaments/repository");
jest.mock("@/lib/server/tournaments/bot-logs");
jest.mock("@/lib/server/tournaments/bg-survie");

import { forfeitTournamentTeamPublic } from "@/lib/server/tournaments";
import { getDatabase } from "@/lib/server/database";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { resolveUserEntrant } from "@/lib/server/tournaments/registration";
import { loadTournamentRow } from "@/lib/server/tournaments/repository";
import { discardBotLogs, flushBotLogs, queueBotLog } from "@/lib/server/tournaments/bot-logs";
import { forfeitEnduranceTeam } from "@/lib/server/tournaments/bg-survie";

/**
 * **Le droit d'abandonner, relu dans la transaction qui l'écrit.**
 *
 * La route pose le même contrôle pour répondre vite et juste, mais elle le fait
 * sur une connexion déjà rendue : entre sa lecture et le commit, l'appelant a pu
 * être rétrogradé, sorti du roster, ou n'être jamais passé par l'interface (le
 * corps de la requête porte un `teamId`). Ce contrôle-ci est donc le seul qui
 * fasse foi — et le geste, lui, ne se défait pas : l'équipe quitte le tournoi,
 * capital à zéro en BG Survie.
 *
 * Rien ne l'exerçait : le test de la route moque `forfeitTournamentTeam` en
 * entier, si bien qu'effacer la garde entière laissait la suite verte. Voir
 * `docs/AUTHORIZATION_RULES.md` §4.7.
 */

const entrantMock = resolveUserEntrant as jest.MockedFunction<typeof resolveUserEntrant>;
const tournamentRowMock = loadTournamentRow as jest.MockedFunction<typeof loadTournamentRow>;
const forfeitEngineMock = forfeitEnduranceTeam as jest.MockedFunction<typeof forfeitEnduranceTeam>;

const TOURNAMENT_ID = 5;
const TEAM_ID = 77;

function mockConnection() {
  const connection = {
    execute: jest.fn(async () => [[{ format: "BG_SURVIE" }], []]),
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };
  (getDatabase as jest.Mock).mockResolvedValue({
    execute: jest.fn(),
    getConnection: jest.fn(async () => connection),
  } as never);
  return connection;
}

const entrant = (teamId: number | null, canActForEntrant: boolean) =>
  ({ teamId, canActForEntrant }) as never;

describe("forfeitTournamentTeamPublic — qualité pour désengager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (flushBotLogs as jest.Mock).mockReturnValue(undefined);
    (discardBotLogs as jest.Mock).mockReturnValue(undefined);
    (queueBotLog as jest.Mock).mockReturnValue(undefined);
    tournamentRowMock.mockResolvedValue({ id: TOURNAMENT_ID, participant_type: "TEAM" } as never);
    forfeitEngineMock.mockResolvedValue(undefined as never);
  });

  it("laisse passer un représentant de l'engagé", async () => {
    const connection = mockConnection();
    entrantMock.mockResolvedValue(entrant(TEAM_ID, true));

    await forfeitTournamentTeamPublic(TOURNAMENT_ID, TEAM_ID, 42);

    expect(forfeitEngineMock).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(publishUpdatedEvent).toHaveBeenCalledWith(TOURNAMENT_ID);
  });

  it("refuse un rôle sportif : jouer pour une équipe n'est pas la conduire", async () => {
    // Un `DPS` ne peut pas engager son équipe ; le désengagement est le geste le
    // plus lourd des deux, et rien ne le défait.
    const connection = mockConnection();
    entrantMock.mockResolvedValue(entrant(TEAM_ID, false));

    await expect(forfeitTournamentTeamPublic(TOURNAMENT_ID, TEAM_ID, 42)).rejects.toThrow(
      "NOT_TEAM_MANAGER",
    );

    expect(forfeitEngineMock).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("refuse de retirer une équipe qui n'est pas la sienne", async () => {
    // Le `teamId` vient du corps de la requête : sans ce recoupement, un
    // propriétaire d'équipe retirerait n'importe quel engagé du plateau.
    const connection = mockConnection();
    entrantMock.mockResolvedValue(entrant(999, true));

    await expect(forfeitTournamentTeamPublic(TOURNAMENT_ID, TEAM_ID, 42)).rejects.toThrow(
      "FORBIDDEN",
    );

    expect(forfeitEngineMock).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  it("refuse un appelant sans engagé du tout", async () => {
    mockConnection();
    entrantMock.mockResolvedValue(entrant(null, false));

    await expect(forfeitTournamentTeamPublic(TOURNAMENT_ID, TEAM_ID, 42)).rejects.toThrow(
      "FORBIDDEN",
    );
    expect(forfeitEngineMock).not.toHaveBeenCalled();
  });

  it("refuse sur un tournoi introuvable, sans consulter l'appartenance", async () => {
    mockConnection();
    tournamentRowMock.mockResolvedValue(null as never);

    await expect(forfeitTournamentTeamPublic(TOURNAMENT_ID, TEAM_ID, 42)).rejects.toThrow(
      "TOURNAMENT_NOT_FOUND",
    );
    expect(entrantMock).not.toHaveBeenCalled();
  });

  it("relit le droit **dans** la transaction, sur sa connexion", async () => {
    // Le cœur de la règle : lu avant le `BEGIN`, ou sur le pool, le contrôle
    // jugerait un état que le commit ne partage plus.
    const connection = mockConnection();
    entrantMock.mockResolvedValue(entrant(TEAM_ID, true));

    await forfeitTournamentTeamPublic(TOURNAMENT_ID, TEAM_ID, 42);

    expect(entrantMock).toHaveBeenCalledWith(connection as never, expect.anything(), 42);
    expect(tournamentRowMock).toHaveBeenCalledWith(connection as never, TOURNAMENT_ID);
    expect(connection.beginTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      entrantMock.mock.invocationCallOrder[0],
    );
  });

  it("ne contrôle rien quand l'arbitrage agit : il n'a pas d'engagé à lui", async () => {
    // `actingUserId === null` = staff `tournaments`, qui retire n'importe quel
    // engagé — son droit a été jugé par la route, sur une permission de
    // plateforme et non sur une appartenance d'équipe.
    const connection = mockConnection();

    await forfeitTournamentTeamPublic(TOURNAMENT_ID, TEAM_ID, null);

    expect(entrantMock).not.toHaveBeenCalled();
    expect(tournamentRowMock).not.toHaveBeenCalled();
    expect(forfeitEngineMock).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  it("n'écrit aucune ligne de journal quand le droit manque", async () => {
    mockConnection();
    entrantMock.mockResolvedValue(entrant(TEAM_ID, false));

    await expect(forfeitTournamentTeamPublic(TOURNAMENT_ID, TEAM_ID, 42)).rejects.toThrow(
      "NOT_TEAM_MANAGER",
    );

    expect(queueBotLog).not.toHaveBeenCalled();
    expect(flushBotLogs).not.toHaveBeenCalled();
    expect(discardBotLogs).toHaveBeenCalledTimes(1);
  });
});
