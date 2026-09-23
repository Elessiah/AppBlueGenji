import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/contact-service");

import { GET, PUT } from "@/app/api/association/contact/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/contact-service";
import { authUser } from "../../../helpers/auth-user";

const admin = authUser({ id: 1, isAdmin: true });
const normalUser = authUser({ id: 2, isAdmin: false });

const CONTACT = { email: "a@bg.fr", discordTag: "bluegenji", discordUrl: "https://discord.gg/x" };

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/association/contact", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/association/contact", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the contact info without auth", async () => {
    jest.mocked(service.getContactInfo).mockResolvedValue(CONTACT);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ contact: CONTACT });
  });
});

describe("PUT /api/association/contact", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects anonymous users with 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const res = await PUT(jsonReq(CONTACT));
    expect(res.status).toBe(401);
    expect(service.setContactInfo).not.toHaveBeenCalled();
  });

  it("rejects non-admins with 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(normalUser);
    const res = await PUT(jsonReq(CONTACT));
    expect(res.status).toBe(403);
    expect(service.setContactInfo).not.toHaveBeenCalled();
  });

  it("updates the contact info for admins", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.setContactInfo).mockResolvedValue(CONTACT);

    const res = await PUT(jsonReq(CONTACT));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ contact: CONTACT });
    expect(service.setContactInfo).toHaveBeenCalledWith({
      email: CONTACT.email,
      discordTag: CONTACT.discordTag,
      discordUrl: CONTACT.discordUrl,
    });
  });

  it("coerces missing fields to empty strings before validating", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.setContactInfo).mockResolvedValue({
      email: "a@bg.fr",
      discordTag: "",
      discordUrl: "",
    });

    const res = await PUT(jsonReq({ email: "a@bg.fr" }));
    expect(res.status).toBe(200);
    expect(service.setContactInfo).toHaveBeenCalledWith({ email: "a@bg.fr", discordTag: "", discordUrl: "" });
  });

  it("returns 400 with the validation error message", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(service.setContactInfo).mockRejectedValue(new Error("DISCORD_URL_INVALID"));

    const res = await PUT(jsonReq({ discordUrl: "https://evil.com" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "DISCORD_URL_INVALID" });
  });
});
