import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { TournamentSnapshot } from "@/lib/shared/types";

/**
 * La garde de visibilité de la fiche : `start_visibility_at` n'était consulté
 * nulle part sur ce chemin, et un tournoi en préparation se lisait entièrement
 * pour qui devinait son identifiant.
 *
 * L'instantané est simulé — ce test ne juge pas la lecture en base, il juge qui
 * a le droit de la recevoir.
 */
jest.mock("@/lib/server/tournaments/snapshot");
jest.mock("@/lib/server/teams-service");
jest.mock("@/lib/server/tournaments/preview-cache");
jest.mock("@/lib/server/database");

import {
  getTournamentDetail,
  getVisibleTournamentSnapshot,
} from "@/lib/server/tournaments-service";
import { getTournamentSnapshot } from "@/lib/server/tournaments/snapshot";
import { getTournamentPreview } from "@/lib/server/tournaments/preview-cache";
import { getUserActiveTeam } from "@/lib/server/teams-service";

const HOUR = 3_600_000;

function snapshotVisibleIn(offsetMs: number): TournamentSnapshot {
  return {
    card: {
      id: 5,
      participantType: "TEAM",
      state: "UPCOMING",
      startVisibilityAt: new Date(Date.now() + offsetMs).toISOString(),
    },
    matches: [],
    registrations: [],
    survival: null,
    swiss: null,
    endurance: null,
    phases: null,
    currentPhaseId: null,
    phaseStandings: {},
    soloUserIds: {},
    version: "v1",
  } as unknown as TournamentSnapshot;
}

beforeEach(() => {
  jest.clearAllMocks();
  (getUserActiveTeam as jest.Mock).mockResolvedValue(null as never);
  (getTournamentPreview as jest.Mock).mockResolvedValue(null as never);
});

describe("getVisibleTournamentSnapshot", () => {
  it("sert un tournoi déjà publié à un simple spectateur", async () => {
    (getTournamentSnapshot as jest.Mock).mockResolvedValue(snapshotVisibleIn(-HOUR) as never);

    expect(await getVisibleTournamentSnapshot(5, { canManage: false })).not.toBeNull();
  });

  it("cache un tournoi pas encore publié à un simple spectateur", async () => {
    (getTournamentSnapshot as jest.Mock).mockResolvedValue(snapshotVisibleIn(HOUR) as never);

    expect(await getVisibleTournamentSnapshot(5, { canManage: false })).toBeNull();
  });

  it("sert un tournoi pas encore publié au staff `tournaments`", async () => {
    (getTournamentSnapshot as jest.Mock).mockResolvedValue(snapshotVisibleIn(HOUR) as never);

    expect(await getVisibleTournamentSnapshot(5, { canManage: true })).not.toBeNull();
  });

  it("cache par défaut, sans droits déclarés", async () => {
    // Un appelant qui oublie les droits ne doit pas obtenir l'accès le plus
    // large : la valeur par défaut est le spectateur.
    (getTournamentSnapshot as jest.Mock).mockResolvedValue(snapshotVisibleIn(HOUR) as never);

    expect(await getVisibleTournamentSnapshot(5)).toBeNull();
  });

  it("rend `null` sur un tournoi inexistant", async () => {
    (getTournamentSnapshot as jest.Mock).mockResolvedValue(null as never);

    expect(await getVisibleTournamentSnapshot(5, { canManage: true })).toBeNull();
  });
});

describe("getTournamentDetail — même garde que le flux", () => {
  it("rend `null` sur un tournoi pas encore publié", async () => {
    (getTournamentSnapshot as jest.Mock).mockResolvedValue(snapshotVisibleIn(HOUR) as never);

    expect(await getTournamentDetail(5, 42, { canManage: false })).toBeNull();
  });

  it("ne calcule aucun contexte de lecteur pour un tournoi refusé", async () => {
    // Le refus doit précéder le travail : inutile d'aller chercher l'équipe du
    // lecteur et l'aperçu du plateau pour jeter le résultat.
    (getTournamentSnapshot as jest.Mock).mockResolvedValue(snapshotVisibleIn(HOUR) as never);

    await getTournamentDetail(5, 42, { canManage: false, canPreview: true });

    expect(getUserActiveTeam).not.toHaveBeenCalled();
    expect(getTournamentPreview).not.toHaveBeenCalled();
  });

  it("sert le détail d'un tournoi publié", async () => {
    (getTournamentSnapshot as jest.Mock).mockResolvedValue(snapshotVisibleIn(-HOUR) as never);

    const detail = await getTournamentDetail(5, 42, { canManage: false });

    expect(detail?.card.id).toBe(5);
  });

  it("sert le détail d'un tournoi non publié au staff", async () => {
    (getTournamentSnapshot as jest.Mock).mockResolvedValue(snapshotVisibleIn(HOUR) as never);

    const detail = await getTournamentDetail(5, 42, { canManage: true });

    expect(detail?.isAdmin).toBe(true);
  });
});
