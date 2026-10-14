import { describe, expect, it } from "@jest/globals";
import { GET } from "@/app/check-in/route";
import { CHECK_IN_INVITE_URL, CHECK_IN_PATH } from "@/lib/shared/discord";

describe("GET /check-in", () => {
  it("renvoie vers l'invitation du serveur Discord du check-in", () => {
    const response = GET();
    expect(response.status).toBe(307);
    expect(response.headers.get("Location")).toBe(CHECK_IN_INVITE_URL);
  });

  it("est le chemin que le push du check-in ouvre", () => {
    expect(CHECK_IN_PATH).toBe("/check-in");
  });
});
