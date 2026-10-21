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
import { DEFAULT_REGISTRATION_FILTERS } from "@/lib/shared/registration-filters";
import type { TournamentSnapshot } from "@/lib/shared/types";
import { fakeConnection } from "../helpers/sql-double";

/**
 * L'invitation à certifier voyage dans le contexte du lecteur, porte commune
 * du flux et de la lecture REST (`docs/features/CERTIFICATION_PROMPT.md`) :
 * lue pour le seul joueur d'une équipe engagée dans un tournoi non clos.
 */

function snapshot(state: string, registered: boolean, participantType = "TEAM"): TournamentSnapshot {
  return {
    card: { id: 5, state, participantType, registrationFilters: { ...DEFAULT_REGISTRATION_FILTERS } },
    registrations: registered ? [{ teamId: 42 }] : [],
    matches: [],
  } as unknown as TournamentSnapshot;
}

const PROMPT = { reason: "MANAGER", discordVerified: false, battletagVerified: true } as const;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(withConnection).mockImplementation((fn) => fn(fakeConnection({})));
  jest.mocked(getTournamentPreview).mockResolvedValue(null);
  jest.mocked(findSoloEntry).mockResolvedValue(null);
  jest.mocked(getUserActiveTeam).mockResolvedValue({ teamId: 42, teamName: "Équipe", roles: ["MANAGER"] });
  jest.mocked(loadCertificationPrompt).mockResolvedValue(PROMPT);
});

describe("certificationPrompt du contexte du lecteur", () => {
  it.each(["REGISTRATION", "RUNNING", "UPCOMING"])("est lue pour une équipe engagée (%s)", async (state) => {
    const context = await getTournamentViewerContext(snapshot(state, true), 7);
    expect(context.certificationPrompt).toEqual(PROMPT);
    expect(loadCertificationPrompt).toHaveBeenCalledWith(expect.anything(), 7, 42, true);
  });

  it("passe le rôle de gestion : un simple joueur n'est pas manager", async () => {
    jest.mocked(getUserActiveTeam).mockResolvedValue({ teamId: 42, teamName: "Équipe", roles: ["DPS", "CAPITAINE"] });
    await getTournamentViewerContext(snapshot("RUNNING", true), 7);
    expect(loadCertificationPrompt).toHaveBeenCalledWith(expect.anything(), 7, 42, false);
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

  it("rien en tournoi individuel", async () => {
    const context = await getTournamentViewerContext(snapshot("RUNNING", true, "SOLO"), 7);
    expect(context.certificationPrompt).toBeNull();
    expect(loadCertificationPrompt).not.toHaveBeenCalled();
  });
});
