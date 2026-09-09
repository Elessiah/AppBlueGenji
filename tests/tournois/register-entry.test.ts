import { describe, expect, it } from "@jest/globals";
import type { TournamentDetail } from "@/lib/shared/types";
import { registerBlockedNotice } from "@/app/(secured)/tournois/[id]/_lib/register-entry";

function detail(overrides: Partial<TournamentDetail> = {}): TournamentDetail {
  return {
    card: { id: 7, state: "REGISTRATION" },
    registrations: [],
    canRegister: false,
    canRegisterEntrant: false,
    myTeamId: 10,
    ...overrides,
  } as unknown as TournamentDetail;
}

describe("registerBlockedNotice", () => {
  it("explique le seul refus qui ne se lise pas sur la page", () => {
    expect(registerBlockedNotice(detail())).toMatch(/propriétaire et les managers/);
  });

  it("se tait quand le bouton est là", () => {
    expect(
      registerBlockedNotice(detail({ canRegister: true, canRegisterEntrant: true })),
    ).toBeNull();
  });

  it("se tait pour qui a la charge de son équipe : le refus vient d'ailleurs", () => {
    expect(registerBlockedNotice(detail({ canRegisterEntrant: true }))).toBeNull();
  });

  it("se tait hors période d'inscription : l'état est déjà affiché en tête", () => {
    expect(
      registerBlockedNotice(
        detail({ card: { id: 7, state: "RUNNING" } as TournamentDetail["card"] }),
      ),
    ).toBeNull();
  });

  it("se tait sans équipe active : ce n'est pas ce refus-là", () => {
    expect(registerBlockedNotice(detail({ myTeamId: null }))).toBeNull();
  });

  it("se tait quand l'équipe est déjà engagée : la question ne se pose plus", () => {
    expect(
      registerBlockedNotice(
        detail({
          registrations: [{ teamId: 10 }] as unknown as TournamentDetail["registrations"],
        }),
      ),
    ).toBeNull();
  });

  it("parle encore quand une **autre** équipe est engagée", () => {
    expect(
      registerBlockedNotice(
        detail({
          registrations: [{ teamId: 11 }] as unknown as TournamentDetail["registrations"],
        }),
      ),
    ).not.toBeNull();
  });
});
