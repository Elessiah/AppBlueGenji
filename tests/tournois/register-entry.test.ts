import { describe, expect, it } from "@jest/globals";
import type { TournamentDetail } from "@/lib/shared/types";
import { canWithdrawOwnEntry, registerBlockedNotice } from "@/app/(secured)/tournois/[id]/_lib/register-entry";
import { tournamentCard } from "../helpers/tournament-card";
import { tournamentDetail } from "../helpers/tournament-detail";
import { DEFAULT_REGISTRATION_FILTERS } from "@/lib/shared/registration-filters";

function detail(overrides: Partial<TournamentDetail> = {}): TournamentDetail {
  return {
    card: {
      id: 7,
      state: "REGISTRATION",
      participantType: "TEAM",
      registrationFilters: { ...DEFAULT_REGISTRATION_FILTERS },
    },
    registrations: [],
    canRegister: false,
    canRegisterEntrant: false,
    registrationBlock: null,
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

  /**
   * Les conditions d'inscription.
   *
   * Le bouton se ferme sur elles ; la phrase qui prend sa place doit nommer le
   * geste qui les lève, sans quoi le lecteur voit un bouton disparaître sans
   * savoir s'il doit recruter ou certifier un tag.
   */
  it("nomme le geste qui lève la condition", () => {
    const notice = registerBlockedNotice(
      detail({ canRegisterEntrant: true, registrationBlock: "TEAM_TOO_FEW_PLAYERS" }),
    );

    expect(notice).toMatch(/recrute/i);
    // Pas la condition chiffrée : elle est affichée deux lignes plus haut, dans
    // la case « Conditions d'inscription » du même en-tête.
    expect(notice).not.toContain("5 joueurs minimum");
  });

  it("passe avant le refus de qualité : elle désigne un geste, l'autre renvoie à quelqu'un", () => {
    const notice = registerBlockedNotice(
      detail({ canRegisterEntrant: false, registrationBlock: "TEAM_NEEDS_VERIFIED_DISCORD" }),
    );

    expect(notice).toMatch(/Discord/);
    expect(notice).not.toMatch(/propriétaire et les managers/);
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

/**
 * `canWithdrawOwnEntry` — le bouton « Se désinscrire » de l'en-tête
 * (`docs/features/SELF_WITHDRAWAL.md`) : engagé inscrit, qualité pour agir en
 * son nom, coup d'envoi pas encore passé.
 */
describe("canWithdrawOwnEntry", () => {
  const KICKOFF = Date.parse("2026-05-12T10:00:00.000Z");
  const BEFORE_KICKOFF = Date.parse("2026-05-11T10:00:00.000Z");
  const registration = {
    teamId: 10,
    teamName: "Team Nova",
    logoUrl: null,
    seed: 1,
    registeredAt: "2026-05-03T10:00:00.000Z",
    finalRank: null,
  };

  function withdrawable(overrides: Partial<TournamentDetail> = {}): TournamentDetail {
    return tournamentDetail({
      card: tournamentCard({ id: 7, state: "REGISTRATION" }),
      registrations: [registration],
      canRegisterEntrant: true,
      myTeamId: 10,
      ...overrides,
    });
  }

  it("canWithdrawOwnEntry_managerRegisteredBeforeKickoff_returnsTrue", () => {
    expect(canWithdrawOwnEntry(withdrawable(), BEFORE_KICKOFF)).toBe(true);
  });

  it("canWithdrawOwnEntry_cannotActForEntrant_returnsFalse", () => {
    expect(canWithdrawOwnEntry(withdrawable({ canRegisterEntrant: false }), BEFORE_KICKOFF)).toBe(false);
  });

  it("canWithdrawOwnEntry_entrantNotRegistered_returnsFalse", () => {
    expect(
      canWithdrawOwnEntry(withdrawable({ registrations: [{ ...registration, teamId: 11 }] }), BEFORE_KICKOFF),
    ).toBe(false);
  });

  it("canWithdrawOwnEntry_noEntrant_returnsFalse", () => {
    expect(canWithdrawOwnEntry(withdrawable({ myTeamId: null }), BEFORE_KICKOFF)).toBe(false);
  });

  it("canWithdrawOwnEntry_kickoffPassed_returnsFalse", () => {
    expect(canWithdrawOwnEntry(withdrawable(), KICKOFF)).toBe(false);
  });

  it("canWithdrawOwnEntry_oneMillisecondBeforeKickoff_returnsTrue", () => {
    expect(canWithdrawOwnEntry(withdrawable(), KICKOFF - 1)).toBe(true);
  });

  it("canWithdrawOwnEntry_tournamentFinished_returnsFalse", () => {
    expect(
      canWithdrawOwnEntry(withdrawable({ card: tournamentCard({ id: 7, state: "FINISHED" }) }), BEFORE_KICKOFF),
    ).toBe(false);
  });
});
