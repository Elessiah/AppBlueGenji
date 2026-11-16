import { beforeEach, describe, expect, it } from "@jest/globals";
import {
  admitProfilelessGuesses,
  PROFILELESS_ACCOUNTS_PER_VIEWER,
  PROFILELESS_GUESS_WINDOW_MS,
  resetProfilelessGuessesForTests,
} from "@/lib/server/users/profileless-guess-budget";

/**
 * Revue sécurité EF-65 cycle 2 : les pseudos d'emprunt viennent d'une liste
 * publique de mille ; les noms essayés par compte et par visiteur sont bornés,
 * hors borne le couple est tu (jamais refusé, pour tout id).
 */
const T0 = 1_000_000;

beforeEach(() => {
  resetProfilelessGuessesForTests();
});

describe("admitProfilelessGuesses", () => {
  it("admitProfilelessGuesses_newPairs_admitsAllInOrder", () => {
    const players = [{ id: 3, name: "ApexTV" }, { id: 8, name: "Beta" }, { id: 3, name: "ApexTV solo" }];

    expect(admitProfilelessGuesses(7, players, T0)).toEqual(players);
  });

  it("admitProfilelessGuesses_fourthNameSameAccount_droppedSilently", () => {
    admitProfilelessGuesses(7, [{ id: 3, name: "AlphaFX" }, { id: 3, name: "AlphaGod" }, { id: 3, name: "AlphaOne" }], T0);

    expect(admitProfilelessGuesses(7, [{ id: 3, name: "AlphaPRO" }], T0)).toEqual([]);
  });

  it("admitProfilelessGuesses_samePairAgainAfterCap_stillAdmitted", () => {
    admitProfilelessGuesses(7, [{ id: 3, name: "AlphaFX" }, { id: 3, name: "AlphaGod" }, { id: 3, name: "AlphaOne" }], T0);

    // Casse et invisibles ignorés, comme la comparaison de la route.
    expect(admitProfilelessGuesses(7, [{ id: 3, name: " alphafx " }], T0)).toEqual([{ id: 3, name: " alphafx " }]);
  });

  it("admitProfilelessGuesses_accountsCapReached_newAccountDropped", () => {
    const filling = Array.from({ length: PROFILELESS_ACCOUNTS_PER_VIEWER }, (_, index) => ({ id: index + 1, name: "Nom" }));
    admitProfilelessGuesses(7, filling, T0);

    expect(admitProfilelessGuesses(7, [{ id: PROFILELESS_ACCOUNTS_PER_VIEWER + 1, name: "Nom" }], T0)).toEqual([]);
  });

  it("admitProfilelessGuesses_windowExpired_budgetReset", () => {
    admitProfilelessGuesses(7, [{ id: 3, name: "AlphaFX" }, { id: 3, name: "AlphaGod" }, { id: 3, name: "AlphaOne" }], T0);

    expect(admitProfilelessGuesses(7, [{ id: 3, name: "AlphaPRO" }], T0 + PROFILELESS_GUESS_WINDOW_MS)).toEqual([
      { id: 3, name: "AlphaPRO" },
    ]);
  });

  it("admitProfilelessGuesses_otherViewer_hasOwnBudget", () => {
    admitProfilelessGuesses(7, [{ id: 3, name: "AlphaFX" }, { id: 3, name: "AlphaGod" }, { id: 3, name: "AlphaOne" }], T0);

    expect(admitProfilelessGuesses(9, [{ id: 3, name: "AlphaPRO" }], T0)).toEqual([{ id: 3, name: "AlphaPRO" }]);
  });
});
