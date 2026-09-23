import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments/repository");
jest.mock("@/lib/server/tournaments/phases-repository");
jest.mock("@/lib/server/tournaments/bracket-single");
jest.mock("@/lib/server/tournaments/bracket-double");

import { createBracketIfMissing } from "@/lib/server/tournaments/bracket-generator";
import {
  deleteAllMatches,
  deletePhaseMatches,
  hasExistingMatches,
  loadRegisteredTeamIds,
} from "@/lib/server/tournaments/repository";
import { loadPhaseTeamIds } from "@/lib/server/tournaments/phases-repository";
import { createSingleEliminationBracket } from "@/lib/server/tournaments/bracket-single";
import { createDoubleEliminationBracket } from "@/lib/server/tournaments/bracket-double";
import { type SqlQuery, fakeConnection } from "../../helpers/sql-double";
import type { TournamentRow } from "@/lib/server/tournaments/_internal";
import type { RowOverrides } from "../../helpers/row-overrides";
import { tournamentRow } from "../../helpers/tournament-rows";

const execute = jest.fn<SqlQuery>(async () => [[], []]);
const connection = fakeConnection({ execute });

function tournament(overrides: RowOverrides<TournamentRow> = {}): TournamentRow {
  return tournamentRow({
    id: 5,
    format: "SINGLE",
    bracket_size: null,
    has_third_place_match: 0,
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(loadRegisteredTeamIds).mockResolvedValue([1, 2, 3, 4]);
  jest.mocked(loadPhaseTeamIds).mockResolvedValue([1, 2, 3, 4]);
  jest.mocked(hasExistingMatches).mockResolvedValue(false);
  jest.mocked(deleteAllMatches).mockResolvedValue(undefined);
  jest.mocked(deletePhaseMatches).mockResolvedValue(undefined);
  jest.mocked(createSingleEliminationBracket).mockResolvedValue(undefined);
  jest.mocked(createDoubleEliminationBracket).mockResolvedValue(undefined);
});

/**
 * `createBracketIfMissing` s'exécute **toujours** dans la transaction de son
 * appelant. Elle y publiait pourtant `publishUpdatedEvent` : l'invalidation et
 * l'événement partaient avant le commit, la salle SSE se réveillait aussitôt et
 * reconstruisait l'instantané sur une **autre** connexion — qui ne voit pas le
 * plateau en cours d'écriture. Elle mettait donc en cache, puis diffusait, un
 * tournoi « en cours, sans plateau », et aucun second événement ne venait le
 * corriger : la trame périmée tenait jusqu'au battement d'entretien de la salle.
 * Sur un rollback, elle aurait annoncé un plateau qui n'a jamais existé.
 */
describe("createBracketIfMissing — l'annonce revient à l'appelant", () => {
  it("n'importe plus le module de publication", () => {
    // Garde de régression au niveau de la source : le défaut n'était pas dans
    // ce que la fonction rend, mais dans le fait même qu'elle publie. Aucune
    // assertion de comportement ne peut donc le voir.
    const source = readFileSync(
      join(__dirname, "..", "..", "..", "lib", "server", "tournaments", "bracket-generator.ts"),
      "utf8",
    );

    expect(source).not.toMatch(/from "\.\/notifications"/);
    expect(source).not.toMatch(/publishUpdatedEvent/);
  });

  it("annonce un plateau créé", async () => {
    const result = await createBracketIfMissing(connection, tournament());

    expect(createSingleEliminationBracket).toHaveBeenCalled();
    expect(result).toEqual({ finished: false, created: true });
  });

  it("annonce un plateau créé en double élimination", async () => {
    const result = await createBracketIfMissing(connection, tournament({ format: "DOUBLE" }));

    expect(createDoubleEliminationBracket).toHaveBeenCalled();
    expect(result).toEqual({ finished: false, created: true });
  });

  it("n'annonce rien quand le plateau est déjà là", async () => {
    jest.mocked(hasExistingMatches).mockResolvedValue(true);

    const result = await createBracketIfMissing(connection, tournament({ bracket_size: 4 }));

    expect(result).toEqual({ finished: false, created: false });
    expect(createSingleEliminationBracket).not.toHaveBeenCalled();
  });

  it("reconstruit et annonce quand l'effectif a périmé la taille", async () => {
    jest.mocked(hasExistingMatches).mockResolvedValue(true);

    const result = await createBracketIfMissing(connection, tournament({ bracket_size: 8 }));

    expect(deleteAllMatches).toHaveBeenCalled();
    expect(result).toEqual({ finished: false, created: true });
  });

  it("n'annonce aucun plateau sur un tournoi clos faute d'adversaires", async () => {
    // Le tournoi est clos sur-le-champ : il n'y a pas de plateau à annoncer, et
    // c'est la bascule d'état qui se voit.
    jest.mocked(loadRegisteredTeamIds).mockResolvedValue([7]);

    const result = await createBracketIfMissing(connection, tournament());

    expect(result).toEqual({ finished: true, created: false });
  });

  it("n'annonce rien pour une phase réduite à une qualifiée", async () => {
    jest.mocked(loadPhaseTeamIds).mockResolvedValue([7]);
    execute.mockResolvedValue([
      [{ c: 0, bracket_size: null }],
      [],
    ]);

    const result = await createBracketIfMissing(connection, tournament({ format: "MULTI" }), {
      phaseId: 3,
      format: "SINGLE",
    });

    expect(result).toEqual({ finished: false, created: false });
  });
});
