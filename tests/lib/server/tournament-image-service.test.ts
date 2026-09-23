import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/image-upload");
jest.mock("@/lib/server/tournaments/notifications");

import { getDatabase } from "@/lib/server/database";
import { deleteStoredImage, processAndStoreImage } from "@/lib/server/image-upload";
import { mapCard } from "@/lib/server/tournaments/_internal";
import {
  removeTournamentImage,
  setTournamentImage,
  updateTournamentImageSettings,
} from "@/lib/server/tournaments/image";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";

/**
 * Écriture de l'image d'un tournoi : fichier, cadrage, et ménage du disque.
 *
 * Trois règles tenues ici : la conversion précède le verrou, l'ancienne image
 * est relue **sous verrou** (deux envois simultanés s'ordonnent), et un fichier
 * n'est effacé qu'**après** le commit — le nouveau étant repris si l'écriture
 * échoue, pour ne jamais laisser un fichier que plus rien ne désigne.
 */

type ExecuteMock = jest.Mock<(sql: string, params?: unknown[]) => Promise<unknown>>;

const OLD_URL = "/api/uploads/tournaments/7-old.webp";
const NEW_DISK = "/uploads/tournaments/7-new.webp";
const NEW_URL = "/api/uploads/tournaments/7-new.webp";

const sql = (execute: ExecuteMock) =>
  execute.mock.calls.map(([statement]) => String(statement).replace(/\s+/g, " ").trim());

/** Connexion dont le SELECT verrouillant rend `current` (ou aucune ligne). */
function mockTournament(current: string | null | undefined, options: { failOnUpdate?: boolean } = {}) {
  const execute: ExecuteMock = jest.fn(async (statement: string) => {
    if (/^\s*SELECT image_url FROM bg_tournaments/.test(statement)) {
      return [current === undefined ? [] : [{ image_url: current }]];
    }
    if (options.failOnUpdate && /^\s*UPDATE/.test(statement)) throw new Error("ER_LOCK_DEADLOCK");
    return [{ affectedRows: 1 }];
  });
  const connection = {
    execute,
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };
  (getDatabase as jest.Mock).mockResolvedValue({ getConnection: jest.fn(async () => connection) } as never);
  return { execute, connection };
}

const pngFile = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "v.png", { type: "image/png" });
const cover = { fit: "COVER" as const, focusX: 20, focusY: 80 };

beforeEach(() => {
  jest.clearAllMocks();
  (processAndStoreImage as jest.Mock).mockResolvedValue(NEW_DISK as never);
  (deleteStoredImage as jest.Mock).mockResolvedValue(undefined as never);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("setTournamentImage", () => {
  it("convertit le fichier sous le gabarit du tournoi, puis l'enregistre avec son cadrage", async () => {
    const { execute, connection } = mockTournament(null);

    await expect(setTournamentImage(7, pngFile(), cover)).resolves.toEqual({ url: NEW_URL, ...cover });

    expect(processAndStoreImage).toHaveBeenCalledWith(expect.any(File), "tournament-image", 7);
    const statements = sql(execute);
    expect(statements[0]).toBe("SELECT image_url FROM bg_tournaments WHERE id = ? LIMIT 1 FOR UPDATE");
    expect(statements[1]).toMatch(/^UPDATE bg_tournaments SET image_url = \?, image_fit = \?/);
    expect(execute.mock.calls[1][1]).toEqual([NEW_URL, "COVER", 20, 80, 7]);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("convertit avant d'ouvrir la transaction : sharp ne tient jamais le verrou", async () => {
    const { connection } = mockTournament(null);
    const order: string[] = [];
    (processAndStoreImage as jest.Mock).mockImplementation(async () => {
      order.push("process");
      return NEW_DISK;
    });
    connection.beginTransaction.mockImplementation(async () => {
      order.push("begin");
    });

    await setTournamentImage(7, pngFile(), cover);
    expect(order).toEqual(["process", "begin"]);
  });

  it("efface l'ancien fichier, et seulement après le commit", async () => {
    const { connection } = mockTournament(OLD_URL);
    let committed = false;
    connection.commit.mockImplementation(async () => {
      committed = true;
    });
    (deleteStoredImage as jest.Mock).mockImplementation(async () => {
      expect(committed).toBe(true);
    });

    await setTournamentImage(7, pngFile(), cover);
    expect(deleteStoredImage).toHaveBeenCalledTimes(1);
    expect(deleteStoredImage).toHaveBeenCalledWith("/uploads/tournaments/7-old.webp");
  });

  it("n'efface rien quand il n'y avait pas d'image", async () => {
    mockTournament(null);
    await setTournamentImage(7, pngFile(), cover);
    expect(deleteStoredImage).not.toHaveBeenCalledWith(expect.any(String));
  });

  it("reprend le fichier neuf et n'efface pas l'ancien si le tournoi n'existe pas", async () => {
    const { connection } = mockTournament(undefined);

    await expect(setTournamentImage(7, pngFile(), cover)).rejects.toThrow("TOURNAMENT_NOT_FOUND");
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(deleteStoredImage).toHaveBeenCalledTimes(1);
    expect(deleteStoredImage).toHaveBeenCalledWith(NEW_DISK);
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });

  it("reprend le fichier neuf si l'écriture échoue", async () => {
    const { connection } = mockTournament(OLD_URL, { failOnUpdate: true });

    await expect(setTournamentImage(7, pngFile(), cover)).rejects.toThrow("ER_LOCK_DEADLOCK");
    expect(connection.commit).not.toHaveBeenCalled();
    expect(deleteStoredImage).toHaveBeenCalledWith(NEW_DISK);
    expect(deleteStoredImage).not.toHaveBeenCalledWith("/uploads/tournaments/7-old.webp");
  });

  it("n'écrit rien en base quand le fichier est refusé", async () => {
    const { execute } = mockTournament(OLD_URL);
    (processAndStoreImage as jest.Mock).mockRejectedValue(new Error("IMAGE_FORMAT_INVALID") as never);

    await expect(setTournamentImage(7, pngFile(), cover)).rejects.toThrow("IMAGE_FORMAT_INVALID");
    expect(execute).not.toHaveBeenCalled();
    expect(deleteStoredImage).not.toHaveBeenCalled();
  });

  it("un ménage raté ne défait pas l'enregistrement, déjà acquis", async () => {
    mockTournament(OLD_URL);
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    (deleteStoredImage as jest.Mock).mockRejectedValue(new Error("EPERM") as never);

    await expect(setTournamentImage(7, pngFile(), cover)).resolves.toEqual({ url: NEW_URL, ...cover });
    expect(log).toHaveBeenCalled();
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
  });
});

describe("updateTournamentImageSettings", () => {
  it("change le cadrage sans toucher au fichier", async () => {
    const { execute } = mockTournament(OLD_URL);
    const logo = { fit: "CONTAIN" as const, focusX: 50, focusY: 10 };

    await expect(updateTournamentImageSettings(7, logo)).resolves.toEqual({ url: OLD_URL, ...logo });
    expect(sql(execute)[1]).toBe(
      "UPDATE bg_tournaments SET image_fit = ?, image_focus_x = ?, image_focus_y = ? WHERE id = ?",
    );
    expect(execute.mock.calls[1][1]).toEqual(["CONTAIN", 50, 10, 7]);
    expect(processAndStoreImage).not.toHaveBeenCalled();
    expect(deleteStoredImage).not.toHaveBeenCalled();
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("refuse de cadrer une image qui n'existe plus", async () => {
    const { execute, connection } = mockTournament(null);

    await expect(updateTournamentImageSettings(7, cover)).rejects.toThrow("TOURNAMENT_IMAGE_MISSING");
    expect(sql(execute)).toHaveLength(1);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });

  it("remonte TOURNAMENT_NOT_FOUND", async () => {
    mockTournament(undefined);
    await expect(updateTournamentImageSettings(7, cover)).rejects.toThrow("TOURNAMENT_NOT_FOUND");
  });

  it("tient une URL étrangère restée en base pour une absence, et refuse avant d'écrire", async () => {
    const { execute, connection } = mockTournament("https://exemple.invalid/x.png");
    await expect(updateTournamentImageSettings(7, cover)).rejects.toThrow("TOURNAMENT_IMAGE_MISSING");
    expect(sql(execute)).toHaveLength(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });
});

describe("removeTournamentImage", () => {
  it("vide l'image, remet le cadrage au défaut, puis efface le fichier", async () => {
    const { execute, connection } = mockTournament(OLD_URL);
    let committed = false;
    connection.commit.mockImplementation(async () => {
      committed = true;
    });
    (deleteStoredImage as jest.Mock).mockImplementation(async () => {
      expect(committed).toBe(true);
    });

    await removeTournamentImage(7);
    expect(sql(execute)[1]).toMatch(/^UPDATE bg_tournaments SET image_url = NULL, image_fit = \?/);
    expect(execute.mock.calls[1][1]).toEqual(["COVER", 50, 50, 7]);
    expect(deleteStoredImage).toHaveBeenCalledWith("/uploads/tournaments/7-old.webp");
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("est idempotent : sans image, rien n'est écrit ni publié", async () => {
    const { execute, connection } = mockTournament(null);

    await expect(removeTournamentImage(7)).resolves.toBeUndefined();
    expect(sql(execute)).toHaveLength(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(deleteStoredImage).not.toHaveBeenCalled();
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });

  it("remonte TOURNAMENT_NOT_FOUND", async () => {
    const { connection } = mockTournament(undefined);
    await expect(removeTournamentImage(7)).rejects.toThrow("TOURNAMENT_NOT_FOUND");
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });
});

describe("mapCard — l'image voyage avec la carte du tournoi", () => {
  const row = (image: Record<string, unknown>) =>
    ({
      id: 1,
      name: "Coupe",
      description: null,
      format: "SINGLE",
      game: "OW",
      max_teams: 8,
      registered_teams: 8,
      state: "RUNNING",
      start_visibility_at: new Date("2026-08-01T00:00:00Z"),
      registration_open_at: new Date("2026-08-01T00:00:00Z"),
      registration_close_at: new Date("2026-08-10T00:00:00Z"),
      start_at: new Date("2026-08-20T00:00:00Z"),
      has_third_place_match: 0,
      survival_rounds_before_first_cut: null,
      survival_rounds_per_cut: null,
      participant_type: "TEAM",
      match_format_type: null,
      match_format_value: null,
      live_url: null,
      ...image,
    }) as never;

  it("rend l'image et son cadrage", () => {
    expect(
      mapCard(row({ image_url: OLD_URL, image_fit: "CONTAIN", image_focus_x: 10, image_focus_y: 90 })).image,
    ).toEqual({ url: OLD_URL, fit: "CONTAIN", focusX: 10, focusY: 90 });
  });

  it("rend null sans image, y compris quand la lecture ne sélectionne pas les colonnes", () => {
    expect(mapCard(row({ image_url: null })).image).toBeNull();
    expect(mapCard(row({})).image).toBeNull();
  });

  it("écarte une URL étrangère à la sortie", () => {
    expect(mapCard(row({ image_url: "https://exemple.invalid/x.png", image_fit: "COVER" })).image).toBeNull();
  });
});
