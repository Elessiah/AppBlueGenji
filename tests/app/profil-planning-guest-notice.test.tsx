import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import frProfile from "@/messages/fr/profile.json";
import enProfile from "@/messages/en/profile.json";

/**
 * « Mon profil » : sa propre marque « invité » (`CAST_PLANNING.md` § Invités),
 * en lecture seule — revue juridique 1 de PLANNING-GUESTS (le planning ne
 * prévient plus l'invité, la fiche le lui dit).
 */
let messages: Record<string, Record<string, string>> = frProfile as unknown as Record<string, Record<string, string>>;
jest.mock("@/components/i18n/profile-text", () => ({
  useProfileText: () => ({
    t: (key: string) => {
      const [group, leaf] = key.split(".");
      return messages[group]?.[leaf] ?? key;
    },
  }),
}));

import { PlanningGuestNotice } from "@/app/(secured)/profil/_components/PlanningGuestNotice";

describe("PlanningGuestNotice", () => {
  it("PlanningGuestNotice_guestTrue_rendersLabelAndHint", () => {
    messages = frProfile as unknown as Record<string, Record<string, string>>;
    const html = renderToStaticMarkup(<PlanningGuestNotice guest />);
    expect(html).toContain("Compte invité : hors du planning des casts et arbitres");
    expect(html).toContain("profile-planning-guest-hint");
  });

  it("PlanningGuestNotice_guestTrueInEnglish_rendersEnglishLabel", () => {
    messages = enProfile as unknown as Record<string, Record<string, string>>;
    const html = renderToStaticMarkup(<PlanningGuestNotice guest />);
    expect(html).toContain("Guest account: outside the cast and referee schedule");
  });

  it("PlanningGuestNotice_guestUndefined_rendersNothing", () => {
    expect(renderToStaticMarkup(<PlanningGuestNotice guest={undefined} />)).toBe("");
  });

  it("PlanningGuestNotice_guestFalse_rendersNothing", () => {
    expect(renderToStaticMarkup(<PlanningGuestNotice guest={false} />)).toBe("");
  });
});
