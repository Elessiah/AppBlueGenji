import { describe, expect, it } from "@jest/globals";
import { readSource } from "../helpers/read-source";

const DIR = "app/(secured)/tournois/[id]/_components";

describe("ProdDialog wiring", () => {
  const dialog = readSource(`${DIR}/ProdDialog.tsx`);

  it("prodDialog_styles_ownModuleNotReferees", () => {
    expect(dialog).toContain('./ProdDialog.module.css');
    expect(dialog).not.toContain("RefereeDialog.module.css");
  });

  it("prodDialog_blockedCandidates_disabledWithReason", () => {
    expect(dialog).toContain("disabled={candidate.block !== null}");
    expect(dialog).toContain('"blockedPlayer"');
    expect(dialog).toContain('"blockedCaster"');
  });

  it("prodDialog_afterRemoval_refocusesSelectOrClose", () => {
    expect(dialog).toContain("setRefocus(true)");
    expect(dialog).toContain("selectRef.current ?? closeRef.current");
  });
});

describe("MatchCardActions prod release", () => {
  const card = readSource(`${DIR}/MatchCardActions.tsx`);

  it("releaseProd_handler_opensConfirmationInsteadOfDeleting", () => {
    expect(card).toContain("releaseProd: () => setConfirmReleaseProd(true)");
    expect(card).toContain("cardActions.prodReleaseConfirm.title");
  });
});

describe("admin prod route", () => {
  it("adminProdRoute_notEligibleTarget_mapsTo409", () => {
    expect(readSource("app/api/admin/matches/[matchId]/prod/route.ts")).toContain("PROD_NOT_ELIGIBLE: 409");
  });
});
