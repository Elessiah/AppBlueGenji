import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { AuthUser } from "@/lib/shared/types";

// AUTHORIZATION_RULES §1.4 : le bouton « Modifier » du contact suit la garde de
// `PUT /api/association/contact`, `can(user, "showcase")` — jamais `isAdmin`.
jest.mock("@/lib/server/auth", () => ({ getCurrentUser: jest.fn() }));
jest.mock("@/lib/server/contact-service", () => ({
  getContactInfo: jest.fn(async () => ({ email: "", discordTag: "", discordUrl: "" })),
}));
jest.mock("@/components/cyber/landing/FooterContact", () => ({
  FooterContact: ({ isAdmin }: { isAdmin: boolean }) => <ul data-can-edit={String(isAdmin)} />,
}));

import { renderToStaticMarkup } from "react-dom/server";
import { getCurrentUser } from "@/lib/server/auth";
import { PublicFooter } from "@/components/cyber/landing/PublicFooter";
import { authUser } from "../helpers/auth-user";

const currentUser = jest.mocked(getCurrentUser);

async function canEdit(user: AuthUser | null): Promise<string | undefined> {
  currentUser.mockResolvedValue(user);
  const html = renderToStaticMarkup(await PublicFooter());
  return html.match(/data-can-edit="(true|false)"/)?.[1];
}

beforeEach(() => currentUser.mockReset());

describe("PublicFooter — édition du contact", () => {
  it("l'ouvre au community manager, qui porte `showcase`", async () => {
    await expect(canEdit(authUser({ isAdmin: false, roles: ["COMMUNITY_MANAGER"] }))).resolves.toBe("true");
  });

  it("l'ouvre à l'administrateur", async () => {
    await expect(canEdit(authUser({ isAdmin: true, roles: ["ADMIN"] }))).resolves.toBe("true");
  });

  it("la ferme à un rôle sans `showcase`", async () => {
    await expect(canEdit(authUser({ isAdmin: false, roles: ["ARBITRE"] }))).resolves.toBe("false");
  });

  it("la ferme à un visiteur, et quand la session ne se lit pas", async () => {
    await expect(canEdit(null)).resolves.toBe("false");
    currentUser.mockRejectedValue(new Error("base indisponible"));
    const html = renderToStaticMarkup(await PublicFooter());
    expect(html).toContain('data-can-edit="false"');
  });
});
