import { describe, expect, it, jest } from "@jest/globals";
import { retryOnDeadlock } from "@/lib/server/tournaments/deadlock-retry";

const deadlock = () => Object.assign(new Error("Deadlock found when trying to get lock"), { code: "ER_LOCK_DEADLOCK" });
const checkRead = () => Object.assign(new Error("Record has changed since last read"), { code: "ER_CHECKREAD", errno: 1020 });

describe("retryOnDeadlock", () => {
  it("rejoue une écriture annulée par un interblocage, et rend son résultat", async () => {
    const write = jest.fn<() => Promise<string>>().mockRejectedValueOnce(deadlock()).mockResolvedValueOnce("ok");
    await expect(retryOnDeadlock(write)).resolves.toBe("ok");
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("rejoue aussi un refus de l'isolation par instantané de MariaDB (1020)", async () => {
    const write = jest.fn<() => Promise<string>>().mockRejectedValueOnce(checkRead()).mockResolvedValueOnce("ok");
    await expect(retryOnDeadlock(write)).resolves.toBe("ok");
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("abandonne après trois tentatives", async () => {
    const write = jest.fn<() => Promise<void>>().mockRejectedValue(deadlock());
    await expect(retryOnDeadlock(write)).rejects.toThrow("Deadlock");
    expect(write).toHaveBeenCalledTimes(3);
  });

  it("laisse passer toute autre erreur sans la rejouer", async () => {
    const write = jest.fn<() => Promise<void>>().mockRejectedValue(new Error("MATCH_NOT_FOUND"));
    await expect(retryOnDeadlock(write)).rejects.toThrow("MATCH_NOT_FOUND");
    expect(write).toHaveBeenCalledTimes(1);
  });
});
