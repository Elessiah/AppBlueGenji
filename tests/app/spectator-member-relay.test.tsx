/** @jest-environment node */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";

let mockPathname = "/suivre/tournois/12";
const replace = jest.fn<(href: string) => void>();

// Rendu serveur : les effets ne tournent pas, on les joue sur-le-champ.
jest.mock("react", () => ({
  ...jest.requireActual<typeof import("react")>("react"),
  useEffect: (effect: () => void) => effect(),
}));
jest.mock("next/navigation", () => ({ usePathname: () => mockPathname }));
jest.mock("@/components/i18n/locale-navigation", () => ({ useLocaleRouter: () => ({ replace }) }));

import { MemberRelay } from "@/app/suivre/tournois/[id]/_components/MemberRelay";

function relay(tournamentId = 12): string {
  return renderToStaticMarkup(<MemberRelay tournamentId={tournamentId} />);
}

beforeEach(() => {
  Object.defineProperty(globalThis, "location", { value: { search: "", hash: "" }, configurable: true, writable: true });
  replace.mockClear();
  mockPathname = "/suivre/tournois/12";
});

describe("MemberRelay", () => {
  it("mène à la fiche du membre depuis la fiche sans compte, sans rien afficher", () => {
    expect(relay()).toBe("");
    expect(replace).toHaveBeenCalledWith("/tournois/12");
  });

  it.each([
    ["/suivre/tournois/12/matchs/34", "/tournois/12/matchs/34"],
    ["/en/suivre/tournois/12/matchs/34", "/tournois/12/matchs/34"],
    ["/suivre/tournois/99/matchs/34", "/tournois/12"],
  ])("depuis %s (page préchargée), mène à %s", (pathname, expected) => {
    mockPathname = pathname;
    relay();
    expect(replace).toHaveBeenCalledWith(expected);
  });

  it("fait suivre la requête et l'ancre du match", () => {
    Object.defineProperty(globalThis, "location", {
      value: { search: "?utm_source=discord", hash: "#match-34" },
      configurable: true,
      writable: true,
    });
    relay();
    expect(replace).toHaveBeenCalledWith("/tournois/12?utm_source=discord#match-34");
  });
});
