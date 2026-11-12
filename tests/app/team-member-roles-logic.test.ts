import { describe, expect, it } from "@jest/globals";
import {
  invitationOutcome,
  memberRolesToSave,
  ownGameRolesToSave,
  sameRoleSet,
} from "@/app/(secured)/equipes/[id]/_lib/member-roles";

/** Décisions des écrans de rôles de la fiche d'équipe (TEAM-MEMBERS-UX). */

describe("sameRoleSet", () => {
  it("sameRoleSet_sameRolesDifferentOrder_returnsTrue", () => {
    expect(sameRoleSet(["TANK", "DPS"], ["DPS", "TANK"])).toBe(true);
  });

  it("sameRoleSet_duplicates_ignored", () => {
    expect(sameRoleSet(["TANK", "TANK"], ["TANK"])).toBe(true);
  });

  it("sameRoleSet_differentRoles_returnsFalse", () => {
    expect(sameRoleSet(["TANK", "DPS"], ["TANK", "HEAL"])).toBe(false);
  });
});

describe("memberRolesToSave — modale « Rôles »", () => {
  it("memberRolesToSave_unchanged_returnsNull", () => {
    expect(memberRolesToSave(["MANAGER", "DPS"], ["DPS", "MANAGER"])).toBeNull();
  });

  it("memberRolesToSave_allRemoved_returnsEmptyList", () => {
    expect(memberRolesToSave(["DPS"], [])).toEqual([]);
  });

  it("memberRolesToSave_changed_returnsSelection", () => {
    expect(memberRolesToSave(["DPS"], ["DPS", "CAPITAINE"])).toEqual(["DPS", "CAPITAINE"]);
  });
});

describe("ownGameRolesToSave — « Mes rôles »", () => {
  it("ownGameRolesToSave_unchanged_returnsNull", () => {
    expect(ownGameRolesToSave(["HEAL", "TANK"], ["TANK", "HEAL"])).toBeNull();
  });

  it("ownGameRolesToSave_changed_returnsCanonicalOrder", () => {
    expect(ownGameRolesToSave(["TANK"], ["HEAL", "COACH", "TANK"])).toEqual(["COACH", "TANK", "HEAL"]);
  });

  it("ownGameRolesToSave_leadingRoleInSelection_dropped", () => {
    expect(ownGameRolesToSave(["DPS"], ["DPS", "MANAGER", "CAPITAINE"])).toBeNull();
  });

  it("ownGameRolesToSave_allCleared_returnsEmpty", () => {
    expect(ownGameRolesToSave(["DPS", "COACH"], [])).toEqual([]);
  });
});

describe("invitationOutcome — modale d'invitation", () => {
  it("invitationOutcome_success_clearsPseudoAndCloses", () => {
    expect(invitationOutcome(true, false)).toEqual({ clearPseudo: true, closeDialog: true });
  });

  it("invitationOutcome_pseudoRefused_closesAndKeepsPseudo", () => {
    expect(invitationOutcome(false, true)).toEqual({ clearPseudo: false, closeDialog: true });
  });

  it("invitationOutcome_otherRefusal_keepsDialogOpen", () => {
    expect(invitationOutcome(false, false)).toEqual({ clearPseudo: false, closeDialog: false });
  });
});
