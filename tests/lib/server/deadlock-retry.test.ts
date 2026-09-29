import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fail } from "@/lib/server/http";
import { isDeadlockMessage } from "@/lib/server/mysql-errors";
import { CONCURRENT_UPDATE_RETRY, CONCURRENT_UPDATE_RETRY_MESSAGE } from "@/lib/shared/api-error-code";
import { ERROR_MESSAGES, mapError } from "@/app/(secured)/tournois/[id]/_lib/error-map";

const DEADLOCK = "Deadlock found when trying to get lock; try restarting transaction";

describe("isDeadlockMessage", () => {
  it("reconnaît le message d'interblocage d'InnoDB", () => {
    expect(isDeadlockMessage(DEADLOCK)).toBe(true);
  });

  it("ignore les autres messages, codes et valeurs non textuelles", () => {
    expect(isDeadlockMessage("Lock wait timeout exceeded; try restarting transaction")).toBe(false);
    expect(isDeadlockMessage("ER_LOCK_DEADLOCK")).toBe(false);
    expect(isDeadlockMessage(`Erreur : ${DEADLOCK}`)).toBe(false);
    expect(isDeadlockMessage("")).toBe(false);
    expect(isDeadlockMessage(undefined)).toBe(false);
    expect(isDeadlockMessage(42)).toBe(false);
  });
});

describe("fail — interblocage", () => {
  let warn: ReturnType<typeof jest.spyOn>;
  let error: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    error = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    error.mockRestore();
  });

  it("rend un 409 CONCURRENT_UPDATE_RETRY au lieu d'une panne générique", async () => {
    const response = fail(DEADLOCK, 500);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: CONCURRENT_UPDATE_RETRY });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("vaut quel que soit le statut demandé par la route", async () => {
    const response = fail(DEADLOCK, 400);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe(CONCURRENT_UPDATE_RETRY);
  });

  it("garde les compléments joints au corps", async () => {
    const response = fail(DEADLOCK, 500, { teamId: 7 });
    expect(await response.json()).toEqual({ teamId: 7, error: CONCURRENT_UPDATE_RETRY });
  });

  it("laisse les autres erreurs MySQL en panne générique", async () => {
    const response = fail("Lock wait timeout exceeded; try restarting transaction", 500);
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("INTERNAL_ERROR");
  });
});

describe("message d'interface", () => {
  it("traduit le code en phrase qui invite à réessayer", () => {
    expect(ERROR_MESSAGES[CONCURRENT_UPDATE_RETRY]).toBe(CONCURRENT_UPDATE_RETRY_MESSAGE);
    expect(mapError(CONCURRENT_UPDATE_RETRY)).toBe(CONCURRENT_UPDATE_RETRY_MESSAGE);
    expect(CONCURRENT_UPDATE_RETRY_MESSAGE).toMatch(/Réessaie/);
  });
});
