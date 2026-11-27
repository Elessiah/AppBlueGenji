import { jest } from "@jest/globals";

/** Doubles des horloges de fond que `register()` lance. */
export type PlanningClockMocks = {
  retention: jest.Mock<() => void>;
  notices: jest.Mock<() => void>;
  deadlines: jest.Mock<() => void>;
  autoConfirm: jest.Mock<() => void>;
  staffMessageQuota: jest.Mock<() => void>;
  getiPurge: jest.Mock<() => void>;
};

/**
 * Remplace par des doubles les horloges du planning et des dates butoir que
 * `instrumentation.ts` lance : une suite qui appelle `register()` ne doit pas
 * démarrer de vrai minuteur (son balayage échouerait après la fin des tests :
 * « Cannot log after tests are done »). À appeler après `jest.resetModules()`
 * et avant le chargement d'`instrumentation.ts` : `register()` importe ses
 * étapes hors du bac isolé, dans le registre commun, qui ne doit pas garder
 * les doubles d'un test précédent. Rend les doubles, pour les vérifier ou leur
 * faire lever une erreur.
 */
export function mockPlanningClocks(): PlanningClockMocks {
  const mocks: PlanningClockMocks = {
    retention: jest.fn<() => void>(),
    notices: jest.fn<() => void>(),
    deadlines: jest.fn<() => void>(),
    autoConfirm: jest.fn<() => void>(),
    staffMessageQuota: jest.fn<() => void>(),
    getiPurge: jest.fn<() => void>(),
  };
  jest.doMock("@/lib/server/planning/retention", () => ({ startPlanningRetentionClock: mocks.retention }));
  jest.doMock("@/lib/server/planning/new-entries", () => ({ startPlanningNoticesClock: mocks.notices }));
  jest.doMock("@/lib/server/tournaments/schedule-deadline", () => ({ startScheduleDeadlineClock: mocks.deadlines }));
  jest.doMock("@/lib/server/planning/auto-confirm", () => ({ startPlanningAutoConfirmClock: mocks.autoConfirm }));
  jest.doMock("@/lib/server/tournament-staff-message", () => ({ startStaffMessageQuotaPurgeClock: mocks.staffMessageQuota }));
  jest.doMock("@/lib/server/geti/posts", () => ({ startGetiPostsPurgeClock: mocks.getiPurge }));
  return mocks;
}
