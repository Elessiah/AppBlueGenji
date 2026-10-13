import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/bot-integration");

import { sendBotLog } from "@/lib/server/bot-integration";
import { auditStaffAction, postStaffLog, publishStaffAction } from "@/lib/server/staff-audit";

const ACTOR = { id: 9, pseudo: "ArbitreZelé" };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(sendBotLog).mockResolvedValue(undefined);
});

describe("staff-audit", () => {
  it("publishStaffAction : pm2 nominatif, Discord anonyme", () => {
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    publishStaffAction("ligne par le staff.", ACTOR);
    expect(info).toHaveBeenCalledWith("[staff-audit] ligne par le staff. — auteur : ArbitreZelé (#9)");
    expect(sendBotLog).toHaveBeenCalledWith("ligne par le staff.");
    info.mockRestore();
  });

  it("auditStaffAction n'écrit que la trace pm2, sans rien envoyer à Discord", () => {
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    auditStaffAction("🗓️ Horaire du match #42 retiré (était vide)", ACTOR);
    expect(info).toHaveBeenCalledWith("[staff-audit] 🗓️ Horaire du match #42 retiré (était vide) — auteur : ArbitreZelé (#9)");
    expect(sendBotLog).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it("postStaffLog n'envoie que la ligne Discord, et avale un bot injoignable", async () => {
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    jest.mocked(sendBotLog).mockRejectedValue(new Error("bot éteint"));
    expect(() => postStaffLog("ligne par le staff.")).not.toThrow();
    await Promise.resolve();
    expect(sendBotLog).toHaveBeenCalledWith("ligne par le staff.");
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });
});
