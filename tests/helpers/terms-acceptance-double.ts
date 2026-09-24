import { jest } from "@jest/globals";
import type * as TermsAcceptance from "@/lib/server/terms-acceptance";

/**
 * Double du module des conditions d'utilisation, pour les tests dont le double
 * SQL décrit une suite précise de requêtes : l'acceptation y est tenue pour
 * acquise (et enregistrée sans rien écrire), si bien que les requêtes qu'elle
 * ajoute ne décalent pas les réponses simulées. Ses règles propres ont leurs
 * tests (`tests/lib/server/terms-acceptance.test.ts`).
 *
 * S'emploie dans une fabrique de `jest.mock`, qui ne peut rien capturer de la
 * portée du fichier :
 *
 *     jest.mock("@/lib/server/terms-acceptance", () =>
 *       jest.requireActual<typeof import("../../helpers/terms-acceptance-double")>(
 *         "../../helpers/terms-acceptance-double",
 *       ).termsAcceptanceDouble(),
 *     );
 */
export function termsAcceptanceDouble(): typeof TermsAcceptance {
  return {
    recordTermsAcceptance: jest.fn<typeof TermsAcceptance.recordTermsAcceptance>(async () => true),
    recordTermsAcceptanceIfBehind: jest.fn<typeof TermsAcceptance.recordTermsAcceptanceIfBehind>(async () => undefined),
    loadAcceptedTermsVersion: jest.fn<typeof TermsAcceptance.loadAcceptedTermsVersion>(async () => 1),
    hasAcceptedCurrentTerms: jest.fn<typeof TermsAcceptance.hasAcceptedCurrentTerms>(async () => true),
    assertTermsAccepted: jest.fn<typeof TermsAcceptance.assertTermsAccepted>(async () => undefined),
    needsTermsForTeamManagement: jest.fn<typeof TermsAcceptance.needsTermsForTeamManagement>(async () => false),
    listTermsAcceptances: jest.fn<typeof TermsAcceptance.listTermsAcceptances>(async () => []),
    TERMS_NEED_TTL_MS: 30_000,
  };
}
