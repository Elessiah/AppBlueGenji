import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";

/**
 * La lecture légère d'un tournoi, pour ce qui ne veut que le décrire (titre et
 * description d'un lien partagé, image d'aperçu).
 *
 * Elle remplace l'instantané entier — matchs, inscrites, classements, voire une
 * transaction d'entretien — que l'ouverture d'une fiche construisait rien que
 * pour ses métadonnées. Trois choses à tenir : la même règle de visibilité que
 * l'instantané, aucune lecture au-delà de la ligne de liste, et un état
 * recalculé depuis les dates, puisqu'aucun entretien n'est joué.
 */
jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/repository");
jest.mock("@/lib/server/tournaments/snapshot");

import { withConnection } from "@/lib/server/database";
import { getTournamentListRow } from "@/lib/server/tournaments/repository";
import { getTournamentSnapshot } from "@/lib/server/tournaments/snapshot";
import { getVisibleTournamentCard } from "@/lib/server/tournaments-service";
import { tournamentListRow } from "../../helpers/tournament-rows";

const HOUR = 3_600_000;
const connection = {} as PoolConnection;

function rowAt(offsets: {
  visibility?: number;
  open?: number;
  close?: number;
  start?: number;
  state?: "UPCOMING" | "REGISTRATION" | "RUNNING" | "FINISHED";
  finished?: number | null;
}) {
  const at = (offset: number) => new Date(Date.now() + offset);
  return tournamentListRow({
    id: 5,
    state: offsets.state ?? "UPCOMING",
    start_visibility_at: at(offsets.visibility ?? -3 * HOUR),
    registration_open_at: at(offsets.open ?? -2 * HOUR),
    registration_close_at: at(offsets.close ?? 2 * HOUR),
    start_at: at(offsets.start ?? 3 * HOUR),
    finished_at: offsets.finished == null ? null : at(offsets.finished),
    registered_teams: 4,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(withConnection).mockImplementation((run) => run(connection));
});

describe("getVisibleTournamentCard — visibilité", () => {
  it("sert un tournoi publié à un simple spectateur", async () => {
    jest.mocked(getTournamentListRow).mockResolvedValue(rowAt({}));

    const card = await getVisibleTournamentCard(5, { canManage: false });

    expect(card?.id).toBe(5);
    expect(card?.registeredTeams).toBe(4);
    expect(getTournamentListRow).toHaveBeenCalledWith(connection, 5);
  });

  it("cache un tournoi pas encore publié à un simple spectateur", async () => {
    jest.mocked(getTournamentListRow).mockResolvedValue(rowAt({ visibility: HOUR }));

    expect(await getVisibleTournamentCard(5, { canManage: false })).toBeNull();
  });

  it("cache par défaut, sans droits déclarés", async () => {
    jest.mocked(getTournamentListRow).mockResolvedValue(rowAt({ visibility: HOUR }));

    expect(await getVisibleTournamentCard(5)).toBeNull();
  });

  it("sert un tournoi pas encore publié au staff `tournaments`", async () => {
    jest.mocked(getTournamentListRow).mockResolvedValue(rowAt({ visibility: HOUR }));

    expect(await getVisibleTournamentCard(5, { canManage: true })).not.toBeNull();
  });

  it("rend `null` sur un tournoi inexistant", async () => {
    jest.mocked(getTournamentListRow).mockResolvedValue(null);

    expect(await getVisibleTournamentCard(5, { canManage: true })).toBeNull();
  });

  it("laisse remonter une panne de lecture, que l'appelant rattrape", async () => {
    jest.mocked(getTournamentListRow).mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(getVisibleTournamentCard(5)).rejects.toThrow("ECONNREFUSED");
  });
});

describe("getVisibleTournamentCard — lecture légère", () => {
  it("ne construit jamais l'instantané entier", async () => {
    jest.mocked(getTournamentListRow).mockResolvedValue(rowAt({}));

    await getVisibleTournamentCard(5);

    expect(getTournamentSnapshot).not.toHaveBeenCalled();
    expect(withConnection).toHaveBeenCalledTimes(1);
  });
});

describe("getVisibleTournamentCard — état recalculé depuis les dates", () => {
  // Aucun entretien n'étant joué, l'état stocké peut retarder d'une bascule :
  // l'encart ne doit pas annoncer « à venir » un tournoi qui a ouvert.
  it("annonce les inscriptions ouvertes même si la colonne dit encore « à venir »", async () => {
    jest.mocked(getTournamentListRow).mockResolvedValue(rowAt({ state: "UPCOMING" }));

    expect((await getVisibleTournamentCard(5))?.state).toBe("REGISTRATION");
  });

  it("annonce un tournoi en cours une fois l'heure de début passée", async () => {
    jest
      .mocked(getTournamentListRow)
      .mockResolvedValue(
        rowAt({ state: "REGISTRATION", open: -3 * HOUR, close: -2 * HOUR, start: -HOUR }),
      );

    expect((await getVisibleTournamentCard(5))?.state).toBe("RUNNING");
  });

  it("garde « terminé » : un tournoi clos le reste, quelles que soient les dates", async () => {
    jest
      .mocked(getTournamentListRow)
      .mockResolvedValue(rowAt({ state: "FINISHED", finished: -HOUR }));

    expect((await getVisibleTournamentCard(5))?.state).toBe("FINISHED");
  });
});
