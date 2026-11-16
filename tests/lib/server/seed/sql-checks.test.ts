/**
 * Contrôle SQL des défis Discord joué par le seed (`lib/server/seed/sql-checks.ts`) :
 * il enchaîne émission et consommation réelles, et fait échouer le seed dès
 * qu'une réponse s'écarte de la règle « seul le dernier code d'un même usage vaut ».
 * Ici, les deux fonctions de défi sont simulées pour piloter chaque écart.
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fakePool, type SqlQuery } from "../../../helpers/sql-double";

jest.mock("@/lib/server/users/discord-challenges", () => ({
  createDiscordLoginChallenge: jest.fn(),
  consumeDiscordLoginChallenge: jest.fn(),
}));

import {
  consumeDiscordLoginChallenge,
  createDiscordLoginChallenge,
  type DiscordChallenge,
  type DiscordLoginProof,
} from "@/lib/server/users/discord-challenges";
import { checkDiscordChallengeRules, SEED_CHECK_DISCORD_ID } from "@/lib/server/seed/sql-checks";

const create = jest.mocked(createDiscordLoginChallenge);
const consume = jest.mocked(consumeDiscordLoginChallenge);

function challenge(n: number): DiscordChallenge {
  return { challengeId: n, challengeToken: `token-${n}`, code: `00000${n}`, expiresAt: new Date("2026-11-16T12:00:00Z") };
}

const PROOF: DiscordLoginProof = { handle: null, discordId: SEED_CHECK_DISCORD_ID };
const CLEAR_SQL = "DELETE FROM bg_discord_login_challenges WHERE discord_id = ?";

let execute: jest.Mock<SqlQuery>;

beforeEach(() => {
  create.mockReset();
  consume.mockReset();
  jest.spyOn(console, "log").mockImplementation(() => {});
  execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 0 }]);
  create
    .mockResolvedValueOnce(challenge(1))
    .mockResolvedValueOnce(challenge(2))
    .mockResolvedValueOnce(challenge(3))
    .mockResolvedValueOnce(challenge(4));
});

describe("checkDiscordChallengeRules", () => {
  it("checkDiscordChallengeRules_rulesHold_resolvesAndClearsBeforeAndAfter", async () => {
    consume.mockResolvedValueOnce(PROOF).mockResolvedValueOnce(null).mockResolvedValueOnce(PROOF);

    await expect(checkDiscordChallengeRules(fakePool({ execute }))).resolves.toBeUndefined();

    expect(execute.mock.calls).toEqual([
      [CLEAR_SQL, [SEED_CHECK_DISCORD_ID]],
      [CLEAR_SQL, [SEED_CHECK_DISCORD_ID]],
    ]);
  });

  it("checkDiscordChallengeRules_handleCodeVoidsLoginCode_throwsAndStillClears", async () => {
    consume.mockResolvedValueOnce(null);

    await expect(checkDiscordChallengeRules(fakePool({ execute }))).rejects.toThrow(
      "code de connexion suivi d'un code de tag — attendu accepté",
    );

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenLastCalledWith(CLEAR_SQL, [SEED_CHECK_DISCORD_ID]);
  });

  it("checkDiscordChallengeRules_olderLoginCodeStillValid_throws", async () => {
    consume.mockResolvedValue(PROOF);

    await expect(checkDiscordChallengeRules(fakePool({ execute }))).rejects.toThrow(
      "code de connexion remplacé par un plus récent — attendu refusé",
    );
  });

  it("checkDiscordChallengeRules_latestLoginCodeRefused_throws", async () => {
    consume.mockResolvedValueOnce(PROOF).mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await expect(checkDiscordChallengeRules(fakePool({ execute }))).rejects.toThrow(
      "dernier code de connexion — attendu accepté",
    );
  });

  it("checkDiscordChallengeRules_handleChallenge_isBoundAndUsesHandlePurpose", async () => {
    consume.mockResolvedValueOnce(PROOF).mockResolvedValueOnce(null).mockResolvedValueOnce(PROOF);

    await checkDiscordChallengeRules(fakePool({ execute }));

    expect(create).toHaveBeenNthCalledWith(2, SEED_CHECK_DISCORD_ID, "seed_check", "handle", "0:certify");
    expect(consume.mock.calls.map((call) => call[2])).toEqual(["login", "login", "login"]);
    expect(consume).toHaveBeenNthCalledWith(2, "token-3", "000003", "login");
  });
});
