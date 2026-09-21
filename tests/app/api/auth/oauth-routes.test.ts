import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/oauth-flow");

import { NextRequest, NextResponse } from "next/server";
import { completeOAuth, startOAuth } from "@/lib/server/oauth-flow";
import { GET as googleStart } from "@/app/api/auth/google/start/route";
import { GET as googleCallback } from "@/app/api/auth/google/callback/route";
import { GET as discordStart } from "@/app/api/auth/discord/start/route";
import { GET as discordCallback } from "@/app/api/auth/discord/callback/route";
import { GET as blizzardStart } from "@/app/api/auth/blizzard/start/route";
import { GET as blizzardCallback } from "@/app/api/auth/blizzard/callback/route";

/**
 * **Chaque route nomme sa propre porte.**
 *
 * Les six routes tiennent en cinq lignes et délèguent tout à
 * `lib/server/oauth-flow.ts` — c'est le propos : la mécanique est écrite une
 * fois. Reste une chose qu'aucun test du module partagé ne peut voir, et c'est
 * exactement celle qu'un copier-coller abîme : la constante passée en argument.
 * Une route Discord qui dirait `"GOOGLE"` compilerait, répondrait 307, et
 * enverrait le joueur chez le mauvais fournisseur.
 */

const startMock = startOAuth as jest.MockedFunction<typeof startOAuth>;
const completeMock = completeOAuth as jest.MockedFunction<typeof completeOAuth>;

const request = (path: string) => new NextRequest(`http://localhost:3000${path}`);

beforeEach(() => {
  jest.clearAllMocks();
  const redirect = NextResponse.redirect("http://localhost:3000/tournois");
  startMock.mockResolvedValue(redirect as never);
  completeMock.mockResolvedValue(redirect as never);
});

describe("routes de départ", () => {
  it.each([
    ["google", googleStart, "GOOGLE"],
    ["discord", discordStart, "DISCORD"],
    ["blizzard", blizzardStart, "BLIZZARD"],
  ] as const)("/api/auth/%s/start ouvre la porte %s", async (slug, handler, provider) => {
    const req = request(`/api/auth/${slug}/start`);
    await handler(req);
    expect(startMock).toHaveBeenCalledWith(req, provider);
  });
});

describe("routes de rappel", () => {
  it.each([
    ["google", googleCallback, "GOOGLE"],
    ["discord", discordCallback, "DISCORD"],
    ["blizzard", blizzardCallback, "BLIZZARD"],
  ] as const)("/api/auth/%s/callback referme la porte %s", async (slug, handler, provider) => {
    const req = request(`/api/auth/${slug}/callback?code=abc&state=xyz`);
    await handler(req);
    expect(completeMock).toHaveBeenCalledWith(req, provider);
  });
});
