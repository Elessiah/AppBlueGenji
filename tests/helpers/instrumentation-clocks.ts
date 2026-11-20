import { jest } from "@jest/globals";

/**
 * Remplace par des doubles les horloges du planning et des dates butoir que
 * `instrumentation.ts` lance : une suite qui appelle `register()` ne doit pas
 * démarrer de vrai minuteur (son balayage échouerait après la fin des tests :
 * « Cannot log after tests are done »). À appeler dans le bac isolé, avant
 * le chargement d'`instrumentation.ts`.
 */
export function mockPlanningClocks(): void {
  jest.doMock("@/lib/server/planning/retention", () => ({ startPlanningRetentionClock: jest.fn() }));
  jest.doMock("@/lib/server/planning/new-entries", () => ({ startPlanningNoticesClock: jest.fn() }));
  jest.doMock("@/lib/server/tournaments/schedule-deadline", () => ({ startScheduleDeadlineClock: jest.fn() }));
  jest.doMock("@/lib/server/planning/auto-confirm", () => ({ startPlanningAutoConfirmClock: jest.fn() }));
}
