import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");
jest.mock("@/lib/server/ghost-teams-service");
jest.mock("@/lib/server/tournaments/match-launch");
jest.mock("@/lib/server/tournaments/match-launch-info");
jest.mock("@/lib/server/tournaments/live-streams");
jest.mock("@/lib/server/tournaments/match-replay");
jest.mock("@/lib/server/tournaments/advance");
jest.mock("@/lib/server/tournaments/seeding");
jest.mock("@/lib/server/tournaments/image");
jest.mock("@/lib/server/tournaments/staff-action-logs", () => {
  const actual = jest.requireActual<typeof import("@/lib/server/tournaments/staff-action-logs")>(
    "@/lib/server/tournaments/staff-action-logs",
  );
  return {
    announceStaffMatchAction: jest.fn(),
    announceStaffTournamentAction: jest.fn(),
    staffActionAuthor: actual.staffActionAuthor,
  };
});

import { POST as resolveRoute } from "@/app/api/admin/matches/[matchId]/resolve/route";
import { PATCH as scoresRoute } from "@/app/api/admin/matches/[matchId]/scores/route";
import { POST as launchRoute } from "@/app/api/admin/matches/[matchId]/launch/route";
import { PUT as hostRoute } from "@/app/api/admin/matches/[matchId]/host/route";
import { POST as onAirRoute, PUT as matchLiveRoute } from "@/app/api/admin/matches/[matchId]/live/route";
import { PUT as replayRoute } from "@/app/api/admin/matches/[matchId]/replay/route";
import { PUT as tournamentLiveRoute } from "@/app/api/admin/tournaments/[id]/live/route";
import { POST as advanceRoute } from "@/app/api/admin/tournaments/[id]/advance/route";
import { PATCH as seedingRoute } from "@/app/api/admin/tournaments/[id]/seeding/route";
import { POST as ghostRoute } from "@/app/api/admin/tournaments/[id]/ghost-registrations/route";
import { DELETE as imageDeleteRoute, PATCH as imagePatchRoute } from "@/app/api/admin/tournaments/[id]/image/route";
import { PATCH as editRoute } from "@/app/api/tournaments/[id]/edit/route";
import { getCurrentUser } from "@/lib/server/auth";
import {
  adminResolveMatch,
  adminSaveMatchScores,
  registerGhostTeams,
  updateTournament,
} from "@/lib/server/tournaments-service";
import { forceLaunchMatch, setMatchHost } from "@/lib/server/tournaments/match-launch";
import { setMatchLiveConfig, setMatchOnAir, setTournamentLiveUrl } from "@/lib/server/tournaments/live-streams";
import { setMatchReplayUrl } from "@/lib/server/tournaments/match-replay";
import { advanceTournamentNow } from "@/lib/server/tournaments/advance";
import { loadSeedingBoard, reorderSeeding } from "@/lib/server/tournaments/seeding";
import { removeTournamentImage, updateTournamentImageSettings } from "@/lib/server/tournaments/image";
import { announceStaffMatchAction, announceStaffTournamentAction } from "@/lib/server/tournaments/staff-action-logs";
import type { StaffMatchAction, StaffTournamentAction } from "@/lib/shared/bot-logs";
import type { TournamentImage } from "@/lib/shared/tournament-image";
import { authUser } from "../../../helpers/auth-user";

const admin = authUser({ id: 1, isAdmin: true, roles: ["ADMIN"] });
const player = authUser({ id: 2, isAdmin: false, roles: [] });
const caster = authUser({ id: 4, isAdmin: false, roles: ["CASTER"] });

function jsonReq(method: string, body: unknown): Request {
  return new Request("http://localhost/api/x", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const IMAGE: TournamentImage = { url: "/api/uploads/tournaments/7-a.webp", fit: "COVER", focusX: 50, focusY: 50 };
const match = { params: Promise.resolve({ matchId: "42" }) };
const tournament = { params: Promise.resolve({ id: "7" }) };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(admin);
});

type MatchCase = [string, StaffMatchAction, () => Promise<Response>, () => void];

const LIVE_ACTIONS = new Set<StaffMatchAction>(["LIVE_CONFIGURED", "LIVE_REMOVED", "ON_AIR", "OFF_AIR", "REPLAY_SET", "REPLAY_REMOVED"]);

describe("gestes du staff sur un match", () => {
  it.each<MatchCase>([
    ["résultat validé", "RESULT_VALIDATED", () => resolveRoute(jsonReq("POST", { doubleForfeit: true }), match), () => jest.mocked(adminResolveMatch).mockResolvedValue()],
    ["score enregistré", "SCORES_SAVED", () => scoresRoute(jsonReq("PATCH", { forfeitTeamId: 7 }), match), () => jest.mocked(adminSaveMatchScores).mockResolvedValue(false)],
    ["lancement forcé", "FORCE_LAUNCHED", () => launchRoute(jsonReq("POST", {}), match), () => jest.mocked(forceLaunchMatch).mockResolvedValue()],
    ["hôte désigné", "HOST_SET", () => hostRoute(jsonReq("PUT", { teamId: 3 }), match), () => jest.mocked(setMatchHost).mockResolvedValue()],
    ["hôte retiré", "HOST_CLEARED", () => hostRoute(jsonReq("PUT", { teamId: null }), match), () => jest.mocked(setMatchHost).mockResolvedValue()],
    ["diffusion réglée", "LIVE_CONFIGURED", () => matchLiveRoute(jsonReq("PUT", { trigger: "MANUAL", liveUrl: null }), match), () => jest.mocked(setMatchLiveConfig).mockResolvedValue()],
    ["diffusion retirée", "LIVE_REMOVED", () => matchLiveRoute(jsonReq("PUT", { trigger: null, liveUrl: null }), match), () => jest.mocked(setMatchLiveConfig).mockResolvedValue()],
    ["mis à l'antenne", "ON_AIR", () => onAirRoute(jsonReq("POST", { onAir: true }), match), () => jest.mocked(setMatchOnAir).mockResolvedValue()],
    ["retiré de l'antenne", "OFF_AIR", () => onAirRoute(jsonReq("POST", { onAir: false }), match), () => jest.mocked(setMatchOnAir).mockResolvedValue()],
    ["rediffusion ajoutée", "REPLAY_SET", () => replayRoute(jsonReq("PUT", { replayUrl: "https://youtu.be/x" }), match), () => jest.mocked(setMatchReplayUrl).mockResolvedValue("https://youtu.be/x")],
    ["rediffusion retirée", "REPLAY_REMOVED", () => replayRoute(jsonReq("PUT", { replayUrl: null }), match), () => jest.mocked(setMatchReplayUrl).mockResolvedValue(null)],
  ])("%s : journalisé après le geste", async (_label, action, call, arrange) => {
    arrange();
    const res = await call();
    expect(res.status).toBe(200);
    expect(announceStaffMatchAction).toHaveBeenCalledTimes(1);
    const args = jest.mocked(announceStaffMatchAction).mock.calls[0];
    expect(args.slice(0, 2)).toEqual([42, action]);
    if (LIVE_ACTIONS.has(action)) expect(args[2]).toBe("STAFF");
    expect(announceStaffTournamentAction).not.toHaveBeenCalled();
  });

  it("un score qui suspend la validation ne désigne pas le match, sinon si", async () => {
    jest.mocked(adminSaveMatchScores).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect((await scoresRoute(jsonReq("PATCH", { forfeitTeamId: 7 }), match)).status).toBe(200);
    expect((await scoresRoute(jsonReq("PATCH", { forfeitTeamId: 7 }), match)).status).toBe(200);
    expect(jest.mocked(announceStaffMatchAction).mock.calls).toEqual([
      [42, "SCORES_SAVED", "STAFF", { withoutMatch: true }],
      [42, "SCORES_SAVED", "STAFF", { withoutMatch: false }],
    ]);
  });

  it("un caster sans permission tournois est écrit « un caster », jamais « le staff »", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(caster);
    jest.mocked(setMatchOnAir).mockResolvedValue();
    jest.mocked(setMatchLiveConfig).mockResolvedValue();
    jest.mocked(setMatchReplayUrl).mockResolvedValue("https://youtu.be/x");
    expect((await onAirRoute(jsonReq("POST", { onAir: true }), match)).status).toBe(200);
    expect((await matchLiveRoute(jsonReq("PUT", { trigger: null }), match)).status).toBe(200);
    expect((await replayRoute(jsonReq("PUT", { replayUrl: "https://youtu.be/x" }), match)).status).toBe(200);
    expect(jest.mocked(announceStaffMatchAction).mock.calls).toEqual([
      [42, "ON_AIR", "CASTER"],
      [42, "LIVE_REMOVED", "CASTER"],
      [42, "REPLAY_SET", "CASTER"],
    ]);
  });

  it("n'écrit rien quand le geste échoue", async () => {
    jest.mocked(forceLaunchMatch).mockRejectedValue(new Error("MATCH_ALREADY_LAUNCHED"));
    jest.mocked(setMatchOnAir).mockRejectedValue(new Error("MATCH_NOT_FOUND"));
    jest.mocked(adminResolveMatch).mockRejectedValue(new Error("MATCH_ALREADY_COMPLETED"));
    expect((await launchRoute(jsonReq("POST", {}), match)).status).toBe(409);
    expect((await onAirRoute(jsonReq("POST", { onAir: true }), match)).status).toBe(404);
    expect((await resolveRoute(jsonReq("POST", { doubleForfeit: true }), match)).status).toBe(409);
    expect(announceStaffMatchAction).not.toHaveBeenCalled();
  });

  it("n'écrit rien pour un geste refusé ou invalide", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    expect((await launchRoute(jsonReq("POST", {}), match)).status).toBe(403);
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    expect((await hostRoute(jsonReq("PUT", { teamId: -1 }), match)).status).toBe(400);
    expect(announceStaffMatchAction).not.toHaveBeenCalled();
  });
});

type TournamentCase = [string, StaffTournamentAction, number | undefined, () => Promise<Response>, () => void];

describe("gestes du staff sur un tournoi", () => {
  it.each<TournamentCase>([
    ["tournoi modifié", "EDITED", undefined, () => editRoute(jsonReq("PATCH", { name: "Nouveau" }), tournament), () => jest.mocked(updateTournament).mockResolvedValue()],
    ["seeding", "SEEDING_REORDERED", undefined, () => seedingRoute(jsonReq("PATCH", { teamIds: [1, 2] }), tournament), () => {
      jest.mocked(reorderSeeding).mockResolvedValue();
      jest.mocked(loadSeedingBoard).mockResolvedValue(null);
    }],
    ["avancée", "ADVANCED", undefined, () => advanceRoute(jsonReq("POST", {}), tournament), () =>
      jest.mocked(advanceTournamentNow).mockResolvedValue({ id: 7, name: "Coupe", target: "RUNNING", state: "RUNNING", entrantCount: 4 })],
    ["équipes fantômes", "GHOST_TEAMS_REGISTERED", 3, () => ghostRoute(jsonReq("POST", { teamIds: [4, 5, 6] }), tournament), () => jest.mocked(registerGhostTeams).mockResolvedValue()],
    ["cadrage de l'image", "IMAGE_UPDATED", undefined, () => imagePatchRoute(jsonReq("PATCH", { fit: "COVER", focusX: 50, focusY: 50 }), tournament), () =>
      jest.mocked(updateTournamentImageSettings).mockResolvedValue(IMAGE)],
    ["image retirée", "IMAGE_REMOVED", undefined, () => imageDeleteRoute(jsonReq("DELETE", {}), tournament), () => jest.mocked(removeTournamentImage).mockResolvedValue()],
    ["lien de diffusion posé", "LIVE_URL_SET", undefined, () => tournamentLiveRoute(jsonReq("PUT", { liveUrl: "https://twitch.tv/x" }), tournament), () => jest.mocked(setTournamentLiveUrl).mockResolvedValue("https://twitch.tv/x")],
    ["lien de diffusion retiré", "LIVE_URL_REMOVED", undefined, () => tournamentLiveRoute(jsonReq("PUT", { liveUrl: null }), tournament), () => jest.mocked(setTournamentLiveUrl).mockResolvedValue(null)],
  ])("%s : journalisé après le geste", async (_label, action, count, call, arrange) => {
    arrange();
    const res = await call();
    expect(res.status).toBeLessThan(300);
    expect(announceStaffTournamentAction).toHaveBeenCalledTimes(1);
    const args = jest.mocked(announceStaffTournamentAction).mock.calls[0];
    expect(args[0]).toBe(7);
    expect(args[1]).toBe(action);
    expect(args[2]).toBe(count);
    expect(announceStaffMatchAction).not.toHaveBeenCalled();
  });

  it("n'écrit rien quand le geste échoue", async () => {
    jest.mocked(updateTournament).mockRejectedValue(new Error("TOURNAMENT_NOT_FOUND"));
    jest.mocked(advanceTournamentNow).mockRejectedValue(new Error("TOURNAMENT_ALREADY_STARTED"));
    jest.mocked(registerGhostTeams).mockRejectedValue(new Error("TOURNAMENT_NOT_FOUND"));
    await editRoute(jsonReq("PATCH", { name: "Nouveau" }), tournament);
    expect((await advanceRoute(jsonReq("POST", {}), tournament)).status).toBe(409);
    await ghostRoute(jsonReq("POST", { teamIds: [4] }), tournament);
    expect(announceStaffTournamentAction).not.toHaveBeenCalled();
  });

  it("n'écrit rien pour un geste refusé", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    expect((await editRoute(jsonReq("PATCH", { name: "Nouveau" }), tournament)).status).toBe(403);
    expect((await seedingRoute(jsonReq("PATCH", { teamIds: [1] }), tournament)).status).toBe(403);
    expect(announceStaffTournamentAction).not.toHaveBeenCalled();
  });
});
