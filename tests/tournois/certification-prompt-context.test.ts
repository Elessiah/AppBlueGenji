import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/teams/roster");
jest.mock("@/lib/server/tournaments/preview-cache");
jest.mock("@/lib/server/tournaments/registration-eligibility");
jest.mock("@/lib/server/tournaments/certification-prompt");
jest.mock("@/lib/server/solo-entries-service");

import { getTournamentViewerContext } from "@/lib/server/tournaments";
import { withConnection } from "@/lib/server/database";
import { getUserActiveTeam } from "@/lib/server/teams/roster";
import { getTournamentPreview } from "@/lib/server/tournaments/preview-cache";
import { loadCertificationPrompt } from "@/lib/server/tournaments/certification-prompt";
import { findSoloEntry } from "@/lib/server/solo-entries-service";
import type { TournamentGame, TournamentSnapshot, TournamentState } from "@/lib/shared/types";
import type { ParticipantType } from "@/lib/shared/participants";
import { fakeConnection } from "../helpers/sql-double";
import { tournamentSnapshot } from "../helpers/tournament-detail";
import { tournamentCard } from "../helpers/tournament-card";

/**
 * L'invitation à certifier voyage dans le contexte du lecteur, porte commune
 * du flux et de la lecture REST (`docs/features/CERTIFICATION_PROMPT.md`) :
 * lue pour le seul joueur d'une équipe engagée dans un tournoi non clos.
 */

function snapshot(
  state: TournamentState,
  registered: boolean,
  participantType: ParticipantType = "TEAM",
  game: TournamentGame = "OW",
): TournamentSnapshot {
  return tournamentSnapshot({
    card: tournamentCard({ id: 5, state, participantType, game }),
    registrations: registered
      ? [{ teamId: 42, teamName: "Équipe", logoUrl: null, seed: null, registeredAt: "2026-10-01T10:00:00.000Z", finalRank: null }]
      : [],
  });
}

const PROMPT = { reason: "MANAGER", discordVerified: false, battletagVerified: true, battletagRelevant: true } as const;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(withConnection).mockImplementation((fn) => fn(fakeConnection({})));
  jest.mocked(getTournamentPreview).mockResolvedValue(null);
  jest.mocked(findSoloEntry).mockResolvedValue(null);
  jest.mocked(getUserActiveTeam).mockResolvedValue({ teamId: 42, teamName: "Équipe", roles: ["MANAGER"] });
  jest.mocked(loadCertificationPrompt).mockResolvedValue(PROMPT);
});

describe("certificationPrompt du contexte du lecteur", () => {
  it.each<TournamentState>(["REGISTRATION", "RUNNING", "UPCOMING"])("est lue pour une équipe engagée (%s)", async (state) => {
    const context = await getTournamentViewerContext(snapshot(state, true), 7);
    expect(context.certificationPrompt).toEqual(PROMPT);
    expect(loadCertificationPrompt).toHaveBeenCalledWith(expect.anything(), 7, 42, true, true);
  });

  it("dit si le BattleTag compte : pas en Marvel Rivals", async () => {
    await getTournamentViewerContext(snapshot("RUNNING", true, "TEAM", "MR"), 7);
    expect(loadCertificationPrompt).toHaveBeenCalledWith(expect.anything(), 7, 42, true, false);
  });

  it("passe le rôle de meneur : capitaine compris, pas un simple joueur", async () => {
    jest.mocked(getUserActiveTeam).mockResolvedValue({ teamId: 42, teamName: "Équipe", roles: ["DPS", "CAPITAINE"] });
    await getTournamentViewerContext(snapshot("RUNNING", true), 7);
    expect(loadCertificationPrompt).toHaveBeenLastCalledWith(expect.anything(), 7, 42, true, true);
    jest.mocked(getUserActiveTeam).mockResolvedValue({ teamId: 42, teamName: "Équipe", roles: ["DPS", "COACH"] });
    await getTournamentViewerContext(snapshot("RUNNING", true), 7);
    expect(loadCertificationPrompt).toHaveBeenLastCalledWith(expect.anything(), 7, 42, false, true);
  });

  it("rien sans lecture pour une équipe non engagée", async () => {
    const context = await getTournamentViewerContext(snapshot("RUNNING", false), 7);
    expect(context.certificationPrompt).toBeNull();
    expect(loadCertificationPrompt).not.toHaveBeenCalled();
  });

  it("rien pour un tournoi terminé", async () => {
    const context = await getTournamentViewerContext(snapshot("FINISHED", true), 7);
    expect(context.certificationPrompt).toBeNull();
    expect(loadCertificationPrompt).not.toHaveBeenCalled();
  });

  it("rien pour un lecteur sans équipe", async () => {
    jest.mocked(getUserActiveTeam).mockResolvedValue(null);
    const context = await getTournamentViewerContext(snapshot("RUNNING", true), 7);
    expect(context.certificationPrompt).toBeNull();
    expect(loadCertificationPrompt).not.toHaveBeenCalled();
  });

  it("une lecture en échec tait l'invitation sans faire tomber le contexte", async () => {
    jest.mocked(loadCertificationPrompt).mockRejectedValue(new Error("pool épuisé"));
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const context = await getTournamentViewerContext(snapshot("RUNNING", true), 7);
    expect(context.certificationPrompt).toBeNull();
    expect(context.myTeamId).toBe(42);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("rien en tournoi individuel", async () => {
    const context = await getTournamentViewerContext(snapshot("RUNNING", true, "SOLO"), 7);
    expect(context.certificationPrompt).toBeNull();
    expect(loadCertificationPrompt).not.toHaveBeenCalled();
  });
});
