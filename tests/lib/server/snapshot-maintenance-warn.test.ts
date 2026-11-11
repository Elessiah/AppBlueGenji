import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { warnMaintenanceAborted } from "@/lib/server/tournaments/snapshot";

describe("warnMaintenanceAborted", () => {
  let warn: jest.SpiedFunction<typeof console.warn>;
  beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  const deadlock = () => new Error("Deadlock found when trying to get lock");

  it("warnMaintenanceAborted_firstCall_logsOneLineWithoutStack", () => {
    warnMaintenanceAborted(9001, deadlock(), 1_000_000);

    expect(warn).toHaveBeenCalledTimes(1);
    const args = warn.mock.calls[0];
    expect(args).toHaveLength(1);
    expect(String(args[0])).toContain("9001");
    expect(String(args[0])).toContain("Deadlock found");
  });

  it("warnMaintenanceAborted_secondCallWithin60s_isSilent", () => {
    warnMaintenanceAborted(9002, deadlock(), 2_000_000);
    warnMaintenanceAborted(9002, deadlock(), 2_059_999);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warnMaintenanceAborted_afterWindow_logsAgain", () => {
    warnMaintenanceAborted(9003, deadlock(), 3_000_000);
    warnMaintenanceAborted(9003, deadlock(), 3_060_000);

    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("warnMaintenanceAborted_otherTournament_logsIndependently", () => {
    warnMaintenanceAborted(9004, deadlock(), 4_000_000);
    warnMaintenanceAborted(9005, deadlock(), 4_000_001);

    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("warnMaintenanceAborted_nonErrorValue_logsItAsText", () => {
    warnMaintenanceAborted(9006, "boom", 5_000_000);

    expect(String(warn.mock.calls[0][0])).toContain("boom");
  });
});
