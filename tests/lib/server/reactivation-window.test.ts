import { describe, expect, it } from "@jest/globals";
import { deletionDueSql, reactivationWindowOpenSql, windowFlag } from "@/lib/server/users/reactivation-window";

/** D67 : la fenêtre de 30 jours se calcule contre le `NOW()` de la base. */
describe("reactivationWindowOpenSql", () => {
  it("reactivationWindowOpenSql_defaultColumn_openWhileStrictlyAfterNowMinus30Days", () => {
    expect(reactivationWindowOpenSql()).toBe(
      "(deletion_requested_at IS NOT NULL AND deletion_requested_at > NOW() - INTERVAL 30 DAY)",
    );
  });

  it("reactivationWindowOpenSql_qualifiedColumn_usesIt", () => {
    expect(reactivationWindowOpenSql("u.deletion_requested_at")).toBe(
      "(u.deletion_requested_at IS NOT NULL AND u.deletion_requested_at > NOW() - INTERVAL 30 DAY)",
    );
  });
});

describe("deletionDueSql", () => {
  it("deletionDueSql_defaultColumn_dueFromNowMinus30DaysInclusive", () => {
    // Complément exact de la fenêtre ouverte pour une date non nulle.
    expect(deletionDueSql()).toBe(
      "(deletion_requested_at IS NOT NULL AND deletion_requested_at <= NOW() - INTERVAL 30 DAY)",
    );
  });
});

describe("windowFlag", () => {
  it("windowFlag_numberOne_true", () => {
    expect(windowFlag(1)).toBe(true);
  });

  it("windowFlag_stringOne_true", () => {
    expect(windowFlag("1")).toBe(true);
  });

  it("windowFlag_zero_false", () => {
    expect(windowFlag(0)).toBe(false);
  });

  it("windowFlag_null_false", () => {
    expect(windowFlag(null)).toBe(false);
  });
});
