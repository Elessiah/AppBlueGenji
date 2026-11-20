import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/database");
jest.mock("@/lib/server/planning/actions", () => ({
  ...jest.requireActual<typeof import("@/lib/server/planning/actions")>("@/lib/server/planning/actions"),
  setAvailability: jest.fn(),
  setSoloCaster: jest.fn(),
  setManualAssignment: jest.fn(),
}));
jest.mock("@/lib/server/planning/auto-assign", () => ({
  ...jest.requireActual<typeof import("@/lib/server/planning/auto-assign")>("@/lib/server/planning/auto-assign"),
  runAutoAssign: jest.fn(),
  confirmAssignments: jest.fn(),
}));
jest.mock("@/lib/server/planning/view");
jest.mock("@/lib/server/planning/notices", () => ({
  ...jest.requireActual<typeof import("@/lib/server/planning/notices")>("@/lib/server/planning/notices"),
  announceSoloCasterChange: jest.fn(),
}));
jest.mock("@/lib/server/planning/withdrawal", () => ({
  ...jest.requireActual<typeof import("@/lib/server/planning/withdrawal")>("@/lib/server/planning/withdrawal"),
  withdrawFromEntry: jest.fn(),
}));
jest.mock("@/lib/server/planning/load", () => ({
  ...jest.requireActual<typeof import("@/lib/server/planning/load")>("@/lib/server/planning/load"),
  writeDurationSettings: jest.fn(),
}));

import type { PoolConnection } from "mysql2/promise";
import { PUT as assignmentPut } from "@/app/api/admin/planning/assignment/route";
import { POST as autoAssignPost } from "@/app/api/admin/planning/auto-assign/route";
import { POST as confirmPost } from "@/app/api/admin/planning/confirm/route";
import { PUT as settingsPut } from "@/app/api/admin/planning/settings/route";
import { PUT as availabilityPut } from "@/app/api/planning/availability/route";
import { GET as planningGet } from "@/app/api/planning/route";
import { PUT as soloPut } from "@/app/api/planning/solo-caster/route";
import { POST as withdrawalPost } from "@/app/api/planning/withdrawal/route";
import { PLANNING_BATCH_RULE, PLANNING_READ_BURST_RULE, PLANNING_READ_RULE, PLANNING_WRITE_RULE } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { withConnection } from "@/lib/server/database";
import { setAvailability, setManualAssignment, setSoloCaster } from "@/lib/server/planning/actions";
import { confirmAssignments, runAutoAssign } from "@/lib/server/planning/auto-assign";
import { writeDurationSettings } from "@/lib/server/planning/load";
import { loadPlanningView } from "@/lib/server/planning/view";
import { announceSoloCasterChange } from "@/lib/server/planning/notices";
import { withdrawFromEntry } from "@/lib/server/planning/withdrawal";
import { WITHDRAWAL_REASON_MAX } from "@/lib/shared/planning";
import { resetRateLimit } from "@/lib/server/rate-limit";
import { DEFAULT_PLANNING_DURATIONS } from "@/lib/shared/planning-durations";
import type { PlanningView } from "@/lib/shared/planning-view";
import { authUser } from "../../helpers/auth-user";
import { fakeConnection } from "../../helpers/sql-double";

/**
 * Routes du planning des casts et arbitres (`docs/features/CAST_PLANNING.md` §
 * Accès) : sans session 401 ; joueur et vue joueur 403 ; `planning` pour la
 * page et ses propres réponses ; `tournaments` pour les gestes du staff.
 */

const player = authUser({ id: 2, roles: [] });
const playerView = authUser({ id: 3, roles: [], isAdmin: false, playerView: true, playerViewAvailable: true });
const caster = authUser({ id: 4, roles: ["CASTER"] });
const prod = authUser({ id: 6, roles: ["PROD"] });
const arbitre = authUser({ id: 9, roles: ["ARBITRE"] });
const admin = authUser({ id: 1, isAdmin: true });
/** Un administrateur qui incarne `roles` (`ADMIN_ROLE_IMPERSONATION.md`) : droits déjà réduits par la session. */
const impersonating = (roles: ("ARBITRE" | "CASTER" | "PROD")[]) =>
  authUser({ id: 1, isAdmin: false, roles, playerView: true, playerViewAvailable: true });

const VIEW: PlanningView = {
  me: 4,
  myRoles: ["CASTER"],
  withdrawRoles: ["REFEREE", "CASTER", "PROD"],
  canManage: false,
  canCompute: false,
  entries: [],
  members: [],
};

function request(method: string, body?: unknown): Request {
  return new Request("http://localhost/api/planning", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const AVAILABILITY: Parameters<typeof setAvailability>[1] = { entryKey: "m:1", role: "PROD", status: "AVAILABLE", preferred: false };
const ASSIGNMENT = { entryKey: "m:1", role: "CASTER", userId: 4, assigned: true };
const WINDOW = { from: "2026-11-23T00:00:00.000Z", to: "2026-11-30T00:00:00.000Z" };
const CONFIRM = { entryKeys: ["m:1"] };
const WITHDRAWAL = { entryKey: "m:1", role: "CASTER" };

type Call = () => Promise<Response>;

/** Chaque route, appelée avec un corps valide. */
const ROUTES: Record<string, Call> = {
  "GET /api/planning": () => planningGet(),
  "PUT /api/planning/availability": () => availabilityPut(request("PUT", AVAILABILITY)),
  "PUT /api/planning/solo-caster": () => soloPut(request("PUT", { solo: true })),
  "POST /api/planning/withdrawal": () => withdrawalPost(request("POST", WITHDRAWAL)),
  "PUT /api/admin/planning/assignment": () => assignmentPut(request("PUT", ASSIGNMENT)),
  "POST /api/admin/planning/auto-assign": () => autoAssignPost(request("POST", WINDOW)),
  "POST /api/admin/planning/confirm": () => confirmPost(request("POST", CONFIRM)),
  "PUT /api/admin/planning/settings": () => settingsPut(request("PUT", DEFAULT_PLANNING_DURATIONS)),
};
const STAFF_ROUTES = ["PUT /api/admin/planning/assignment"];
/** Routes des membres du planning (`planning`, refus `PLANNING_MEMBERS_ONLY`). */
const MEMBER_ROUTES = [
  "GET /api/planning",
  "PUT /api/planning/availability",
  "PUT /api/planning/solo-caster",
  "POST /api/planning/withdrawal",
];
/** Calcul, confirmation, réglages : administrateur seul (`canComputePlanning`, refus `PLANNING_ADMIN_ONLY`). */
const COMPUTE_ROUTES = [
  "POST /api/admin/planning/auto-assign",
  "POST /api/admin/planning/confirm",
  "PUT /api/admin/planning/settings",
];

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimit();
  jest.mocked(loadPlanningView).mockResolvedValue(VIEW);
  jest.mocked(withdrawFromEntry).mockResolvedValue({ late: false, replaced: true, unfilled: false, streamLost: false, stillSignedUp: false });
  jest.mocked(setAvailability).mockResolvedValue(undefined);
  jest.mocked(setSoloCaster).mockResolvedValue(true);
  jest.mocked(announceSoloCasterChange).mockResolvedValue(undefined);
  jest.mocked(setManualAssignment).mockResolvedValue(undefined);
  jest.mocked(runAutoAssign).mockResolvedValue({ entries: 1, proposed: 2, replaced: 0 });
  jest.mocked(confirmAssignments).mockResolvedValue({ confirmed: 1, refused: 0 });
  jest.mocked(writeDurationSettings).mockResolvedValue(undefined);
  jest.mocked(withConnection).mockImplementation(<T>(run: (c: PoolConnection) => Promise<T>) => run(fakeConnection({})));
});

async function errorOf(response: Response): Promise<unknown> {
  return ((await response.json()) as { error?: unknown }).error;
}

describe("toutes les routes du planning", () => {
  for (const [name, call] of Object.entries(ROUTES)) {
    it(`${name}_unauthenticated_returns401`, async () => {
      jest.mocked(getCurrentUser).mockResolvedValue(null);
      expect((await call()).status).toBe(401);
    });

    it(`${name}_plainPlayer_returns403`, async () => {
      jest.mocked(getCurrentUser).mockResolvedValue(player);
      expect((await call()).status).toBe(403);
    });

    it(`${name}_playerView_returns403`, async () => {
      jest.mocked(getCurrentUser).mockResolvedValue(playerView);
      expect((await call()).status).toBe(403);
    });

    it(`${name}_admin_returns200`, async () => {
      jest.mocked(getCurrentUser).mockResolvedValue(admin);
      expect((await call()).status).toBe(200);
    });
  }

  for (const name of STAFF_ROUTES) {
    it(`${name}_caster_returns403`, async () => {
      jest.mocked(getCurrentUser).mockResolvedValue(caster);
      expect((await ROUTES[name]()).status).toBe(403);
    });

    it(`${name}_prod_returns403`, async () => {
      jest.mocked(getCurrentUser).mockResolvedValue(prod);
      expect((await ROUTES[name]()).status).toBe(403);
    });

    it(`${name}_arbitre_returns200`, async () => {
      jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
      expect((await ROUTES[name]()).status).toBe(200);
    });
  }
});

describe("routes des membres du planning (permission planning)", () => {
  for (const name of MEMBER_ROUTES) {
    it(`${name}_plainPlayer_returns403MembersOnly`, async () => {
      jest.mocked(getCurrentUser).mockResolvedValue(player);

      const response = await ROUTES[name]();

      expect(response.status).toBe(403);
      expect(await errorOf(response)).toBe("PLANNING_MEMBERS_ONLY");
    });

    it(`${name}_playerView_returns403MembersOnly`, async () => {
      jest.mocked(getCurrentUser).mockResolvedValue(playerView);

      const response = await ROUTES[name]();

      expect(response.status).toBe(403);
      expect(await errorOf(response)).toBe("PLANNING_MEMBERS_ONLY");
    });
  }
});

describe("routes de calcul du planning (administrateur seul)", () => {
  for (const name of COMPUTE_ROUTES) {
    for (const [label, who] of [["caster", caster], ["prod", prod], ["arbitre", arbitre]] as const) {
      it(`${name}_${label}_returns403AdminOnly`, async () => {
        jest.mocked(getCurrentUser).mockResolvedValue(who);
        const response = await ROUTES[name]();
        expect(response.status).toBe(403);
        expect(await errorOf(response)).toBe("PLANNING_ADMIN_ONLY");
        expect(runAutoAssign).not.toHaveBeenCalled();
        expect(confirmAssignments).not.toHaveBeenCalled();
        expect(writeDurationSettings).not.toHaveBeenCalled();
      });
    }
  }
});

describe("GET /api/planning", () => {
  it("planningGet_caster_returnsView", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    const response = await planningGet();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ planning: VIEW });
  });

  it("planningGet_prod_returns200", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(prod);
    expect((await planningGet()).status).toBe(200);
  });

  it("planningGet_arbitre_returns200", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    expect((await planningGet()).status).toBe(200);
  });

  // Le filtrage des durées (administrateur seul) se teste dans
  // `tests/lib/server/planning/view.test.ts` ; ici, seulement que la route
  // renvoie la vue telle quelle, sans y ajouter de durées.
  it("planningGet_viewWithoutDurations_routeAddsNone", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    jest.mocked(loadPlanningView).mockResolvedValue({ ...VIEW, me: 9, myRoles: ["REFEREE"], canManage: true });

    const body = (await (await planningGet()).json()) as { planning: Record<string, unknown> };

    expect(body.planning.canCompute).toBe(false);
    expect(body.planning).not.toHaveProperty("durations");
  });

  it("planningGet_viewWithDurations_routePassesThemThrough", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(loadPlanningView).mockResolvedValue({ ...VIEW, me: 1, canManage: true, canCompute: true, durations: DEFAULT_PLANNING_DURATIONS });

    const body = (await (await planningGet()).json()) as { planning: Record<string, unknown> };

    expect(body.planning.durations).toEqual(DEFAULT_PLANNING_DURATIONS);
  });

  it("planningGet_loadFails_returns500", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    jest.mocked(loadPlanningView).mockRejectedValue(new Error("boom"));
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await planningGet();
    expect(response.status).toBe(500);
    expect(await errorOf(response)).toBe("PLANNING_LOAD_FAILED");
    log.mockRestore();
  });
});

describe("PUT /api/planning/availability", () => {
  beforeEach(() => {
    jest.mocked(getCurrentUser).mockResolvedValue(prod);
  });

  it("availabilityPut_prod_saves", async () => {
    expect((await availabilityPut(request("PUT", AVAILABILITY))).status).toBe(200);
    expect(setAvailability).toHaveBeenCalledWith(prod, AVAILABILITY);
  });

  it("availabilityPut_notJsonObject_returns400", async () => {
    const response = await availabilityPut(request("PUT", ["m:1"]));
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe("INVALID_BODY");
  });

  it("availabilityPut_badEntry_returns400", async () => {
    expect(await errorOf(await availabilityPut(request("PUT", { ...AVAILABILITY, entryKey: "m:x" })))).toBe("INVALID_ENTRY");
  });

  it("availabilityPut_badRole_returns400", async () => {
    expect(await errorOf(await availabilityPut(request("PUT", { ...AVAILABILITY, role: "COACH" })))).toBe("INVALID_ROLE");
  });

  it("availabilityPut_badStatus_returns400", async () => {
    expect(await errorOf(await availabilityPut(request("PUT", { ...AVAILABILITY, status: "MAYBE" })))).toBe("INVALID_STATUS");
  });

  it("availabilityPut_badPreference_returns400", async () => {
    expect(await errorOf(await availabilityPut(request("PUT", { ...AVAILABILITY, preferred: "yes" })))).toBe("INVALID_PREFERENCE");
  });

  it("availabilityPut_roleNotHeld_returns409", async () => {
    jest.mocked(setAvailability).mockRejectedValue(new Error("PLANNING_ROLE_NOT_HELD"));
    const response = await availabilityPut(request("PUT", AVAILABILITY));
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe("PLANNING_ROLE_NOT_HELD");
  });
});

describe("PUT /api/planning/solo-caster", () => {
  it("soloPut_own_saves", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    expect((await soloPut(request("PUT", { solo: true }))).status).toBe(200);
    expect(setSoloCaster).toHaveBeenCalledWith(4, true);
  });

  it("soloPut_casterForAnother_returns403Forbidden", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    const response = await soloPut(request("PUT", { solo: true, userId: 5 }));
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe("FORBIDDEN");
    expect(setSoloCaster).not.toHaveBeenCalled();
  });

  it("soloPut_playerViewForAnother_returns403MembersOnly", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(playerView);
    const response = await soloPut(request("PUT", { solo: true, userId: 5 }));
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe("PLANNING_MEMBERS_ONLY");
    expect(setSoloCaster).not.toHaveBeenCalled();
  });

  it("soloPut_arbitreForAnother_savesWithoutAdmin", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    expect((await soloPut(request("PUT", { solo: false, userId: 5 }))).status).toBe(200);
    expect(setSoloCaster).toHaveBeenCalledWith(5, false);
  });

  it("soloPut_prodForAnother_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(prod);
    expect((await soloPut(request("PUT", { solo: true, userId: 5 }))).status).toBe(403);
    expect(setSoloCaster).not.toHaveBeenCalled();
  });

  it("soloPut_nonMemberForAnother_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    expect((await soloPut(request("PUT", { solo: true, userId: 5 }))).status).toBe(403);
    expect(setSoloCaster).not.toHaveBeenCalled();
  });

  it("soloPut_adminForAnother_saves", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    expect((await soloPut(request("PUT", { solo: false, userId: 5 }))).status).toBe(200);
    expect(setSoloCaster).toHaveBeenCalledWith(5, false);
  });

  it("soloPut_badSolo_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    expect(await errorOf(await soloPut(request("PUT", { solo: "on" })))).toBe("INVALID_SOLO");
  });

  it("soloPut_badUserId_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    expect(await errorOf(await soloPut(request("PUT", { solo: true, userId: -1 })))).toBe("INVALID_USER_ID");
  });

  it("soloPut_staffChangesOther_announcesWithActor", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);

    expect((await soloPut(request("PUT", { solo: true, userId: 5 }))).status).toBe(200);

    expect(announceSoloCasterChange).toHaveBeenCalledWith(5, true, { id: 9, pseudo: arbitre.pseudo });
  });

  it("soloPut_concurrentGesturesSameTarget_announcedInCommitOrder", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    let releaseFirst: () => void = () => undefined;
    jest
      .mocked(setSoloCaster)
      .mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = () => resolve(true))))
      .mockResolvedValueOnce(true);

    const first = soloPut(request("PUT", { solo: true, userId: 5 }));
    const second = soloPut(request("PUT", { solo: false, userId: 5 }));
    await new Promise((resolve) => setImmediate(resolve));
    // Le second geste n'écrit qu'une fois le premier écrit et annoncé.
    expect(setSoloCaster).toHaveBeenCalledTimes(1);
    releaseFirst();
    await Promise.all([first, second]);

    expect(jest.mocked(announceSoloCasterChange).mock.calls.map(([, solo]) => solo)).toEqual([true, false]);
  });

  it("soloPut_ownChange_noAnnouncement", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    expect((await soloPut(request("PUT", { solo: true, userId: 1 }))).status).toBe(200);

    expect(announceSoloCasterChange).not.toHaveBeenCalled();
  });

  it("soloPut_otherNoOp_noAnnouncement", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(setSoloCaster).mockResolvedValue(false);

    expect((await soloPut(request("PUT", { solo: false, userId: 5 }))).status).toBe(200);

    expect(announceSoloCasterChange).not.toHaveBeenCalled();
  });

  it("soloPut_nonStaffForAnother_returns403WithoutAnnouncement", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);

    expect((await soloPut(request("PUT", { solo: true, userId: 5 }))).status).toBe(403);

    expect(announceSoloCasterChange).not.toHaveBeenCalled();
  });

  it("soloPut_notCaster_returns409", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(setSoloCaster).mockRejectedValue(new Error("NOT_CASTER"));
    const response = await soloPut(request("PUT", { solo: true, userId: 5 }));
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe("NOT_CASTER");
  });
});

describe("PUT /api/admin/planning/assignment", () => {
  beforeEach(() => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
  });

  it("assignmentPut_badEntry_returns400", async () => {
    expect(await errorOf(await assignmentPut(request("PUT", { ...ASSIGNMENT, entryKey: 1 })))).toBe("INVALID_ENTRY");
  });

  it("assignmentPut_badRole_returns400", async () => {
    expect(await errorOf(await assignmentPut(request("PUT", { ...ASSIGNMENT, role: "OWNER" })))).toBe("INVALID_ROLE");
  });

  it("assignmentPut_badUserId_returns400", async () => {
    expect(await errorOf(await assignmentPut(request("PUT", { ...ASSIGNMENT, userId: 0 })))).toBe("INVALID_USER_ID");
  });

  it("assignmentPut_badAssigned_returns400", async () => {
    expect(await errorOf(await assignmentPut(request("PUT", { ...ASSIGNMENT, assigned: 1 })))).toBe("INVALID_ASSIGNED");
  });

  it("assignmentPut_refereeRefusedByMatch_returns409", async () => {
    jest.mocked(setManualAssignment).mockRejectedValue(new Error("REFEREE_IS_PLAYER"));
    expect((await assignmentPut(request("PUT", ASSIGNMENT))).status).toBe(409);
  });

  it("assignmentPut_unexpected_returns500", async () => {
    jest.mocked(setManualAssignment).mockRejectedValue(new Error("boom"));
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await errorOf(await assignmentPut(request("PUT", ASSIGNMENT)))).toBe("PLANNING_ASSIGNMENT_FAILED");
    log.mockRestore();
  });
});

describe("POST /api/admin/planning/auto-assign", () => {
  beforeEach(() => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
  });

  it("autoAssignPost_valid_returnsReport", async () => {
    const response = await autoAssignPost(request("POST", WINDOW));
    expect(await response.json()).toEqual({ report: { entries: 1, proposed: 2, replaced: 0 } });
    expect(runAutoAssign).toHaveBeenCalledWith(1, { from: Date.parse(WINDOW.from), to: Date.parse(WINDOW.to) });
  });

  it("autoAssignPost_badWindow_returns400", async () => {
    expect(await errorOf(await autoAssignPost(request("POST", { from: WINDOW.to, to: WINDOW.from })))).toBe("INVALID_WINDOW");
  });

  it("autoAssignPost_busy_returns409", async () => {
    jest.mocked(runAutoAssign).mockRejectedValue(new Error("PLANNING_BUSY"));
    expect((await autoAssignPost(request("POST", WINDOW))).status).toBe(409);
  });

  it("autoAssignPost_unexpected_returns500", async () => {
    jest.mocked(runAutoAssign).mockRejectedValue(new Error("boom"));
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await errorOf(await autoAssignPost(request("POST", WINDOW)))).toBe("PLANNING_AUTO_ASSIGN_FAILED");
    log.mockRestore();
  });
});

describe("POST /api/admin/planning/confirm", () => {
  beforeEach(() => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
  });

  it("confirmPost_subset_passesScope", async () => {
    const response = await confirmPost(request("POST", CONFIRM));
    expect(await response.json()).toEqual({ report: { confirmed: 1, refused: 0 } });
    expect(confirmAssignments).toHaveBeenCalledWith(1, { entryKeys: ["m:1"] }, expect.any(Number), { id: 1, pseudo: "Joueur" });
  });

  it("confirmPost_emptyScope_returns400", async () => {
    expect(await errorOf(await confirmPost(request("POST", {})))).toBe("INVALID_CONFIRM_SCOPE");
  });

  it("confirmPost_unexpected_returns500", async () => {
    jest.mocked(confirmAssignments).mockRejectedValue(new Error("boom"));
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await errorOf(await confirmPost(request("POST", CONFIRM)))).toBe("PLANNING_CONFIRM_FAILED");
    log.mockRestore();
  });
});

describe("PUT /api/admin/planning/settings", () => {
  beforeEach(() => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
  });

  it("settingsPut_valid_writesAndReturnsDurations", async () => {
    const response = await settingsPut(request("PUT", DEFAULT_PLANNING_DURATIONS));
    expect(await response.json()).toEqual({ durations: DEFAULT_PLANNING_DURATIONS });
    expect(writeDurationSettings).toHaveBeenCalledWith(expect.anything(), DEFAULT_PLANNING_DURATIONS);
  });

  it("settingsPut_outOfBounds_returns400", async () => {
    const response = await settingsPut(request("PUT", { ...DEFAULT_PLANNING_DURATIONS, eventHours: 13 }));
    expect(await errorOf(response)).toBe("INVALID_DURATIONS");
    expect(writeDurationSettings).not.toHaveBeenCalled();
  });

  it("settingsPut_unexpected_returns500", async () => {
    jest.mocked(writeDurationSettings).mockRejectedValue(new Error("boom"));
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await errorOf(await settingsPut(request("PUT", DEFAULT_PLANNING_DURATIONS)))).toBe("PLANNING_SETTINGS_FAILED");
    log.mockRestore();
  });
});

describe("plafonds des routes du planning", () => {
  it("planningGet_overReadLimit_returns429", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    // Une lecture toutes les 0,6 s : 100 par minute (sous la rafale), les 400 en quatre minutes.
    let clock = 1_000_000;
    const now = jest.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      for (let call = 0; call < PLANNING_READ_RULE.limit; call += 1) {
        await planningGet();
        clock += 600;
      }

      expect((await planningGet()).status).toBe(429);
      expect(loadPlanningView).toHaveBeenCalledTimes(PLANNING_READ_RULE.limit);
    } finally {
      now.mockRestore();
    }
  });

  it("planningGet_overReadBurst_returns429", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    for (let call = 0; call < PLANNING_READ_BURST_RULE.limit; call += 1) await planningGet();

    expect((await planningGet()).status).toBe(429);
    expect(loadPlanningView).toHaveBeenCalledTimes(PLANNING_READ_BURST_RULE.limit);
  });

  it("availabilityPut_overWriteLimit_returns429", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(prod);
    for (let call = 0; call < PLANNING_WRITE_RULE.limit; call += 1) await availabilityPut(request("PUT", AVAILABILITY));

    expect((await availabilityPut(request("PUT", AVAILABILITY))).status).toBe(429);
  });

  it("soloPut_sharesWriteLimitWithAvailability_returns429", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    for (let call = 0; call < PLANNING_WRITE_RULE.limit; call += 1) await soloPut(request("PUT", { solo: true }));

    expect((await availabilityPut(request("PUT", AVAILABILITY))).status).toBe(429);
  });

  it("autoAssignPost_overBatchLimit_returns429", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    for (let call = 0; call < PLANNING_BATCH_RULE.limit; call += 1) await autoAssignPost(request("POST", WINDOW));

    expect((await confirmPost(request("POST", CONFIRM))).status).toBe(429);
    expect(runAutoAssign).toHaveBeenCalledTimes(PLANNING_BATCH_RULE.limit);
  });

  it("autoAssignPost_invalidWindowsAtLimit_quotaNotConsumed", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    const invalid = { from: WINDOW.to, to: WINDOW.from };
    for (let call = 0; call < PLANNING_BATCH_RULE.limit; call += 1) {
      expect(await errorOf(await autoAssignPost(request("POST", invalid)))).toBe("INVALID_WINDOW");
    }

    expect((await autoAssignPost(request("POST", WINDOW))).status).toBe(200);
    expect(runAutoAssign).toHaveBeenCalledTimes(1);
  });

  it("confirmPost_invalidScopesAtLimit_quotaNotConsumed", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    for (let call = 0; call < PLANNING_BATCH_RULE.limit; call += 1) {
      expect(await errorOf(await confirmPost(request("POST", {})))).toBe("INVALID_CONFIRM_SCOPE");
    }

    expect((await confirmPost(request("POST", CONFIRM))).status).toBe(200);
    expect(confirmAssignments).toHaveBeenCalledTimes(1);
  });

  it("readBurstRule_coversAllAcceptedGestures_limitAtLeastWritePlusBatch", () => {
    expect(PLANNING_READ_BURST_RULE.limit).toBeGreaterThanOrEqual(PLANNING_WRITE_RULE.limit + PLANNING_BATCH_RULE.limit);
  });

  it("planningReadRule_budget_coversEveryAllowedGestureReload", () => {
    expect(PLANNING_READ_RULE.windowMs).toBe(PLANNING_WRITE_RULE.windowMs);
    expect(PLANNING_READ_RULE.limit).toBeGreaterThan(PLANNING_WRITE_RULE.limit + PLANNING_BATCH_RULE.limit);
  });

  it("planningGet_plainPlayer_403NotCounted", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    for (let call = 0; call < PLANNING_READ_RULE.limit + 1; call += 1) await planningGet();

    expect((await planningGet()).status).toBe(403);
  });
});

describe("POST /api/planning/withdrawal", () => {
  it("withdrawalPost_caster_withdrawsOwnRowAndReturnsOutcome", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);

    const response = await withdrawalPost(request("POST", { ...WITHDRAWAL, reason: "  Malade  " }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ late: false, replaced: true, unfilled: false, streamLost: false, stillSignedUp: false });
    expect(jest.mocked(withdrawFromEntry).mock.calls[0].slice(0, 2)).toEqual([caster, { entryKey: "m:1", role: "CASTER", reason: "Malade" }]);
  });

  it("withdrawalPost_impersonatedRolesCannotHoldSeat_returns403BeforeTheService", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(impersonating(["CASTER"]));

    const response = await withdrawalPost(request("POST", { ...WITHDRAWAL, role: "REFEREE" }));

    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe("PLAYER_VIEW_ACTIVE");
    expect(withdrawFromEntry).not.toHaveBeenCalled();
  });

  it("withdrawalPost_impersonatingWithTooLongReason_saysPlayerViewFirst", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(impersonating(["CASTER"]));

    const response = await withdrawalPost(request("POST", { ...WITHDRAWAL, role: "REFEREE", reason: "a".repeat(WITHDRAWAL_REASON_MAX + 1) }));

    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe("PLAYER_VIEW_ACTIVE");
  });

  it("withdrawalPost_impersonatingHeldRoleWithTooLongReason_returns400ReasonTooLong", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(impersonating(["ARBITRE"]));

    const response = await withdrawalPost(request("POST", { ...WITHDRAWAL, role: "REFEREE", reason: "a".repeat(WITHDRAWAL_REASON_MAX + 1) }));

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe("PLANNING_REASON_TOO_LONG");
    expect(withdrawFromEntry).not.toHaveBeenCalled();
  });

  it("withdrawalPost_impersonatingHeldRoleWithReasonAtMax_passesToService", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(impersonating(["ARBITRE"]));

    const response = await withdrawalPost(request("POST", { ...WITHDRAWAL, role: "REFEREE", reason: "a".repeat(WITHDRAWAL_REASON_MAX) }));

    expect(response.status).toBe(200);
    expect(withdrawFromEntry).toHaveBeenCalledTimes(1);
  });

  it("withdrawalPost_serviceRefusesImpersonation_returns403PlayerViewActive", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(impersonating(["ARBITRE"]));
    jest.mocked(withdrawFromEntry).mockRejectedValue(new Error("PLAYER_VIEW_ACTIVE"));

    const response = await withdrawalPost(request("POST", { ...WITHDRAWAL, role: "REFEREE" }));

    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe("PLAYER_VIEW_ACTIVE");
  });

  it("withdrawalPost_impersonatingRoleThatHoldsSeat_passesToTheService", async () => {
    const user = impersonating(["ARBITRE"]);
    jest.mocked(getCurrentUser).mockResolvedValue(user);

    const response = await withdrawalPost(request("POST", { ...WITHDRAWAL, role: "REFEREE" }));

    expect(response.status).toBe(200);
    expect(jest.mocked(withdrawFromEntry).mock.calls[0].slice(0, 2)).toEqual([user, { entryKey: "m:1", role: "REFEREE", reason: null }]);
  });

  it("withdrawalPost_invalidEntryKey_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);

    const response = await withdrawalPost(request("POST", { ...WITHDRAWAL, entryKey: "x:1" }));

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe("INVALID_ENTRY");
  });

  it("withdrawalPost_invalidRole_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);

    const response = await withdrawalPost(request("POST", { ...WITHDRAWAL, role: "PLAYER" }));

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe("INVALID_ROLE");
  });

  it("withdrawalPost_reasonOverMax_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);

    const response = await withdrawalPost(request("POST", { ...WITHDRAWAL, reason: "a".repeat(WITHDRAWAL_REASON_MAX + 1) }));

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe("PLANNING_REASON_TOO_LONG");
    expect(withdrawFromEntry).not.toHaveBeenCalled();
  });

  it("withdrawalPost_entryStarted_returns409", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    jest.mocked(withdrawFromEntry).mockRejectedValue(new Error("PLANNING_WITHDRAWAL_CLOSED"));

    const response = await withdrawalPost(request("POST", WITHDRAWAL));

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe("PLANNING_WITHDRAWAL_CLOSED");
  });
});
