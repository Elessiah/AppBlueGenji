import { describe, expect, it } from "@jest/globals";
import { formatProdChangeLog } from "@/lib/shared/bot-logs";
import { prodClaimOpen, prodControls, prodNoticeHref, type ProdNoticeMatch, type ProdViewer } from "@/lib/shared/match-prod";
import { can } from "@/lib/shared/permissions";
import { matchProdPush } from "@/lib/shared/push-messages";
import { bracketMatch } from "../../helpers/bracket-match";

/**
 * La prod d'un match, côté partagé (`docs/features/MATCH_PROD.md`) : ce que la
 * carte offre au lecteur, la ligne du journal du staff, le push, la permission.
 */

const VIEWER: ProdViewer = { canProd: true, canLeaveProd: true, canSchedule: false, viewerUserId: 5, myTeamIds: [] };
const openMatch = (overrides: Parameters<typeof bracketMatch>[0] = {}) =>
  bracketMatch({ status: "READY", team1Id: 10, team2Id: 11, casters: [], prod: null, ...overrides });
const caster = (userId: number) => ({ userId, pseudo: "Caster", streamId: 1, ready: false });

describe("prodControls", () => {
  it("prodControls_freeOpenMatchWithProdPermission_showsClaim", () => {
    expect(prodControls(openMatch(), VIEWER)).toEqual({
      isProd: false,
      showClaim: true,
      showRelease: false,
      showAssign: false,
    });
  });

  it("prodControls_placeTakenByOther_hidesClaim", () => {
    expect(prodControls(openMatch({ prod: { userId: 6, pseudo: "Autre" } }), VIEWER).showClaim).toBe(false);
  });

  it("prodControls_viewerPlaysMatch_hidesClaim", () => {
    expect(prodControls(openMatch(), { ...VIEWER, myTeamIds: [11] }).showClaim).toBe(false);
  });

  it("prodControls_viewerCastsMatch_hidesClaim", () => {
    expect(prodControls(openMatch({ casters: [caster(5)] }), VIEWER).showClaim).toBe(false);
  });

  it("prodControls_withoutProdPermission_hidesClaim", () => {
    expect(prodControls(openMatch(), { ...VIEWER, canProd: false }).showClaim).toBe(false);
  });

  it("prodControls_viewerIsProd_showsReleaseOnly", () => {
    expect(prodControls(openMatch({ prod: { userId: 5, pseudo: "Moi" } }), VIEWER)).toEqual({
      isProd: true,
      showClaim: false,
      showRelease: true,
      showAssign: false,
    });
  });

  it("prodControls_impersonationWithoutProd_hidesRelease", () => {
    const controls = prodControls(openMatch({ prod: { userId: 5, pseudo: "Moi" } }), {
      ...VIEWER,
      canProd: false,
      canLeaveProd: false,
    });

    expect(controls.isProd).toBe(true);
    expect(controls.showRelease).toBe(false);
  });

  it("prodControls_lostProdRoleOwnPlace_stillShowsRelease", () => {
    const controls = prodControls(openMatch({ prod: { userId: 5, pseudo: "Moi" } }), { ...VIEWER, canProd: false });

    expect(controls.showClaim).toBe(false);
    expect(controls.showRelease).toBe(true);
  });

  it("prodControls_completedMatch_hidesEverything", () => {
    const match = openMatch({ status: "COMPLETED", prod: { userId: 5, pseudo: "Moi" } });

    expect(prodControls(match, { ...VIEWER, canSchedule: true })).toEqual({
      isProd: true,
      showClaim: false,
      showRelease: false,
      showAssign: false,
    });
  });

  it("prodControls_byeMatch_hidesEverything", () => {
    const controls = prodControls(openMatch({ status: "COMPLETED", team2Id: null }), { ...VIEWER, canSchedule: true });

    expect(controls.showClaim).toBe(false);
    expect(controls.showAssign).toBe(false);
  });

  it("prodControls_staff_showsAssign", () => {
    expect(prodControls(openMatch(), { ...VIEWER, canProd: false, canSchedule: true }).showAssign).toBe(true);
  });

  it("prodControls_anonymousViewer_isNotProd", () => {
    const controls = prodControls(openMatch({ prod: { userId: 0, pseudo: "Masqué" } }), {
      ...VIEWER,
      viewerUserId: null,
    });

    expect(controls.isProd).toBe(false);
    expect(controls.showRelease).toBe(false);
  });
});

describe("prodClaimOpen", () => {
  it("prodClaimOpen_running_true", () => {
    expect(prodClaimOpen("RUNNING")).toBe(true);
  });

  it("prodClaimOpen_finished_false", () => {
    expect(prodClaimOpen("FINISHED")).toBe(false);
  });

  it("prodClaimOpen_registration_false", () => {
    expect(prodClaimOpen("REGISTRATION")).toBe(false);
  });
});

describe("prodNoticeHref", () => {
  it("prodNoticeHref_returnsTournamentMatchHref", () => {
    expect(prodNoticeHref({ tournamentId: 7, matchId: 42 })).toContain("/tournois/7");
  });
});

describe("formatProdChangeLog", () => {
  const context = {
    tournament: { id: 7, name: "Coupe" },
    matchId: 42,
    bracket: "UPPER",
    roundNumber: 2,
    team1: { name: "Alpha", participantType: "TEAM" as const },
    team2: { name: "Beta", participantType: "TEAM" as const },
  };

  it("formatProdChangeLog_claimed_namesNobody", () => {
    const line = formatProdChangeLog({ ...context, change: "CLAIMED" });

    expect(line).toContain("Prod réservée");
    expect(line).toContain("une prod se place sur le match");
    expect(line).toContain("#42");
  });

  it("formatProdChangeLog_planned_namesNobody", () => {
    const line = formatProdChangeLog({ ...context, change: "PLANNED" });

    expect(line).toContain("Prod placée");
    expect(line).toContain("une prod du planning est placée sur le match");
    expect(line).not.toContain("par le staff");
  });

  it("formatProdChangeLog_staffGestures_anonymousStaff", () => {
    expect(formatProdChangeLog({ ...context, change: "ASSIGNED" })).toContain("par le staff");
    expect(formatProdChangeLog({ ...context, change: "REPLACED" })).toContain("par le staff");
    expect(formatProdChangeLog({ ...context, change: "RELEASED_BY_STAFF" })).toContain("par le staff");
  });

  it("formatProdChangeLog_ineligible_sameNeutralLineAsSuspension", () => {
    expect(formatProdChangeLog({ ...context, change: "INELIGIBLE" })).toContain("la prod ne remplit plus les conditions");
  });

  it("formatProdChangeLog_unavailable_neutralNoSuspension", () => {
    const line = formatProdChangeLog({ ...context, change: "UNAVAILABLE" });

    expect(line).toContain("la prod ne remplit plus les conditions");
    expect(line).not.toMatch(/suspen/i);
  });
});

describe("matchProdPush", () => {
  const input: ProdNoticeMatch = {
    tournamentId: 7,
    tournamentName: "Coupe",
    matchId: 42,
    bracket: "UPPER",
    roundNumber: 2,
    team1Name: "Alpha",
    team2Name: "Beta",
    solo: false,
    kind: "ASSIGNED",
  };

  it("matchProdPush_assignedFr_titleAndPairing", () => {
    const push = matchProdPush(input, "fr");

    expect(push.title).toBe("Prod d'un match");
    expect(push.body).toContain("Alpha");
    expect(push.tag).toBe("rencontre-42-prod");
  });

  it("matchProdPush_releasedEn_englishTitle", () => {
    expect(matchProdPush({ ...input, kind: "RELEASED" }, "en").title).toBe("Prod removed");
  });

  it("matchProdPush_unavailable_frAndEnNeutral", () => {
    const fr = matchProdPush({ ...input, kind: "UNAVAILABLE" }, "fr");
    const en = matchProdPush({ ...input, kind: "UNAVAILABLE" }, "en");

    expect(fr.title).toBe("Prod retirée");
    expect(fr.body).toContain("ne peut plus faire la prod");
    expect(en.title).toBe("Prod removed");
    expect(en.body).toContain("cannot be a prod for now");
    expect(`${fr.body} ${en.body}`).not.toMatch(/suspen/i);
  });

  it("matchProdPush_solo_namesNoPlayer", () => {
    const push = matchProdPush({ ...input, solo: true, team1Name: "Pseudo1", team2Name: "Pseudo2" }, "fr");

    expect(push.body).not.toContain("Pseudo1");
  });
});

describe("permission prod", () => {
  it("can_prod_heldByProdRole", () => {
    expect(can({ roles: ["PROD"] }, "prod")).toBe(true);
  });

  it("can_prod_heldByAdmin", () => {
    expect(can({ isAdmin: true, roles: [] }, "prod")).toBe(true);
  });

  it("can_prod_keptByGuest", () => {
    expect(can({ roles: ["PROD"], planningGuest: true }, "prod")).toBe(true);
  });

  it("can_prod_notHeldByCaster", () => {
    expect(can({ roles: ["CASTER"] }, "prod")).toBe(false);
  });
});
