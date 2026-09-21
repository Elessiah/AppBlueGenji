import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/teams-service");
jest.mock("@/lib/server/tournaments/preview-cache");
jest.mock("@/lib/server/tournaments/registration-eligibility");
// L'entrée solo se lit en base ; ici seul son absence nous intéresse — c'est le
// cas qui compte, le joueur qui n'a encore jamais joué en individuel.
jest.mock("@/lib/server/solo-entries-service");

import { getTournamentViewerContext } from "@/lib/server/tournaments";
import { withConnection } from "@/lib/server/database";
import { getUserActiveTeam } from "@/lib/server/teams-service";
import { getTournamentPreview } from "@/lib/server/tournaments/preview-cache";
import { checkEntrantEligibility } from "@/lib/server/tournaments/registration-eligibility";
import { findSoloEntry } from "@/lib/server/solo-entries-service";
import { DEFAULT_REGISTRATION_FILTERS } from "@/lib/shared/registration-filters";
import type { TournamentSnapshot } from "@/lib/shared/types";

/**
 * Le **bouton** d'inscription et ce que le serveur ferait au clic.
 *
 * Un bouton qui mène à un 409 est un bouton qui ment : les conditions
 * d'inscription doivent donc le fermer, et la même lecture de roster doit servir
 * aux deux côtés (`checkEntrantEligibility`). Ce qui se joue ici, en plus, est la
 * **parcimonie** : la lecture n'a lieu que lorsqu'elle peut changer la réponse,
 * faute de quoi chaque connexion au flux paierait une requête pour rien.
 *
 * Voir `docs/features/REGISTRATION_FILTERS.md`.
 */

const eligibilityMock = checkEntrantEligibility as jest.MockedFunction<
  typeof checkEntrantEligibility
>;

function snapshot(overrides: Record<string, unknown> = {}): TournamentSnapshot {
  return {
    card: {
      id: 5,
      state: "REGISTRATION",
      participantType: "TEAM",
      registrationFilters: { ...DEFAULT_REGISTRATION_FILTERS },
      ...(overrides.card as Record<string, unknown>),
    },
    registrations: (overrides.registrations as unknown[]) ?? [],
    matches: [],
  } as unknown as TournamentSnapshot;
}

beforeEach(() => {
  jest.clearAllMocks();
  (withConnection as jest.Mock).mockImplementation(async (fn: unknown) =>
    (fn as (c: unknown) => unknown)({}),
  );
  (getTournamentPreview as jest.Mock).mockResolvedValue(null as never);
  (getUserActiveTeam as jest.Mock).mockResolvedValue({ teamId: 42, roles: ["OWNER"] } as never);
  eligibilityMock.mockResolvedValue(null);
  (findSoloEntry as jest.Mock).mockResolvedValue(null as never);
});

describe("canRegister — les conditions ferment le bouton", () => {
  it("ouvre le bouton quand l'engagé remplit les conditions", async () => {
    const context = await getTournamentViewerContext(snapshot(), 7);

    expect(context.canRegister).toBe(true);
    expect(context.registrationBlock).toBeNull();
  });

  it("le ferme et dit pourquoi quand elles ne sont pas remplies", async () => {
    eligibilityMock.mockResolvedValue("TEAM_TOO_FEW_PLAYERS");

    const context = await getTournamentViewerContext(snapshot(), 7);

    expect(context.canRegister).toBe(false);
    // Le motif voyage : sans lui, le bouton disparaîtrait sans un mot.
    expect(context.registrationBlock).toBe("TEAM_TOO_FEW_PLAYERS");
  });

  it("juge l'équipe active du lecteur", async () => {
    await getTournamentViewerContext(snapshot(), 7);

    expect(eligibilityMock).toHaveBeenCalledWith(expect.anything(), DEFAULT_REGISTRATION_FILTERS, {
      teamId: 42,
      soloUserId: null,
    });
  });

  it("juge le **joueur** en individuel, entrée solo ou pas", async () => {
    const context = await getTournamentViewerContext(
      snapshot({ card: { participantType: "SOLO" } }),
      7,
    );

    expect(eligibilityMock).toHaveBeenCalledWith(expect.anything(), DEFAULT_REGISTRATION_FILTERS, {
      teamId: null,
      soloUserId: 7,
    });
    expect(context.canRegister).toBe(true);
  });
});

describe("la lecture de roster n'a lieu que si elle peut changer la réponse", () => {
  it("ne lit rien hors période d'inscription", async () => {
    const context = await getTournamentViewerContext(
      snapshot({ card: { state: "RUNNING" } }),
      7,
    );

    expect(context.canRegister).toBe(false);
    expect(context.registrationBlock).toBeNull();
    expect(eligibilityMock).not.toHaveBeenCalled();
  });

  it("ne lit rien pour un engagé déjà inscrit", async () => {
    const context = await getTournamentViewerContext(
      snapshot({ registrations: [{ teamId: 42 }] }),
      7,
    );

    expect(context.canRegister).toBe(false);
    expect(eligibilityMock).not.toHaveBeenCalled();
  });

  it("ne lit rien pour un joueur sans équipe", async () => {
    (getUserActiveTeam as jest.Mock).mockResolvedValue(null as never);

    const context = await getTournamentViewerContext(snapshot(), 7);

    expect(context.canRegister).toBe(false);
    expect(eligibilityMock).not.toHaveBeenCalled();
  });

  it("ne lit rien pour un joueur sans qualité pour engager", async () => {
    // Le refus de qualité prime : il renvoie à quelqu'un d'autre, alors que les
    // conditions désignent un geste que ce joueur n'aurait pas à faire.
    (getUserActiveTeam as jest.Mock).mockResolvedValue({ teamId: 42, roles: ["DPS"] } as never);

    const context = await getTournamentViewerContext(snapshot(), 7);

    expect(context.canRegister).toBe(false);
    expect(context.canRegisterEntrant).toBe(false);
    expect(context.registrationBlock).toBeNull();
    expect(eligibilityMock).not.toHaveBeenCalled();
  });
});
