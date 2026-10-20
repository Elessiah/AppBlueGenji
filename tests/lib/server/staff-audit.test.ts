import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/bot-integration");

import { sendBotLog } from "@/lib/server/bot-integration";
import { auditStaffAction, publishStaffAction } from "@/lib/server/staff-audit";

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

  it("publishStaffAction : un détail réservé à pm2 n'atteint pas Discord", () => {
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    publishStaffAction("geste par le staff.", ACTOR, "geste par le staff, manche 2 : 2 – 1.");
    expect(info).toHaveBeenCalledWith("[staff-audit] geste par le staff, manche 2 : 2 – 1. — auteur : ArbitreZelé (#9)");
    expect(sendBotLog).toHaveBeenCalledWith("geste par le staff.");
    info.mockRestore();
  });

  it("auditStaffAction n'écrit que la trace pm2, sans rien envoyer à Discord", () => {
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    auditStaffAction("🗓️ Horaire du match #42 retiré (était vide)", ACTOR);
    expect(info).toHaveBeenCalledWith("[staff-audit] 🗓️ Horaire du match #42 retiré (était vide) — auteur : ArbitreZelé (#9)");
    expect(sendBotLog).not.toHaveBeenCalled();
    info.mockRestore();
  });
});
