import { describe, expect, it } from "@jest/globals";
import {
  DEFAULT_IMAGE_SETTINGS,
  FOCUS_KEY_STEP,
  TOURNAMENT_IMAGE_FITS,
  TOURNAMENT_IMAGE_FIT_LABELS,
  checkTournamentImageSettings,
  clampFocus,
  focusFromKey,
  focusFromPoint,
  imageObjectPosition,
  isTournamentImageFit,
  parseTournamentImage,
  planTournamentImageChange,
  sameImageSettings,
  tournamentImageErrorMessage,
  tournamentImageSlot,
  type TournamentImage,
} from "@/lib/shared/tournament-image";

/**
 * Illustration ou logo d'un tournoi : la règle pure, partagée par le serveur
 * (lecture de la base, validation d'une saisie) et l'interface (cadrage,
 * brouillon du sélecteur).
 */

const SERVED = "/api/uploads/tournaments/7-abc.webp";

const image = (overrides: Partial<TournamentImage> = {}): TournamentImage => ({
  url: SERVED,
  fit: "COVER",
  focusX: 50,
  focusY: 50,
  ...overrides,
});

describe("parseTournamentImage — lecture tolérante d'une ligne de base", () => {
  it("rend l'image d'un fichier du site avec son cadrage", () => {
    expect(parseTournamentImage(SERVED, "CONTAIN", 20, 80)).toEqual({
      url: SERVED,
      fit: "CONTAIN",
      focusX: 20,
      focusY: 80,
    });
  });

  it("accepte l'ancienne forme disque d'un chemin d'upload", () => {
    expect(parseTournamentImage("/uploads/tournaments/7-abc.webp", "COVER", 50, 50)?.url).toBe(
      "/uploads/tournaments/7-abc.webp",
    );
  });

  it("rend null sans image", () => {
    expect(parseTournamentImage(null, "COVER", 50, 50)).toBeNull();
    expect(parseTournamentImage(undefined, undefined, undefined, undefined)).toBeNull();
    expect(parseTournamentImage("", "COVER", 50, 50)).toBeNull();
  });

  it("écarte toute origine étrangère — une image du site vient du site", () => {
    expect(parseTournamentImage("https://exemple.invalid/banniere.png", "COVER", 50, 50)).toBeNull();
    expect(parseTournamentImage("//exemple.invalid/banniere.png", "COVER", 50, 50)).toBeNull();
    expect(parseTournamentImage("javascript:alert(1)", "COVER", 50, 50)).toBeNull();
  });

  it("retombe sur l'illustration quand le mode est illisible", () => {
    expect(parseTournamentImage(SERVED, "STRETCH", 50, 50)?.fit).toBe("COVER");
    expect(parseTournamentImage(SERVED, null, 50, 50)?.fit).toBe("COVER");
  });

  it("borne le point focal et recentre une valeur illisible", () => {
    expect(parseTournamentImage(SERVED, "COVER", 140, -8)).toMatchObject({ focusX: 100, focusY: 0 });
    expect(parseTournamentImage(SERVED, "COVER", "abc", null)).toMatchObject({ focusX: 50, focusY: 50 });
    expect(parseTournamentImage(SERVED, "COVER", "", true)).toMatchObject({ focusX: 50, focusY: 50 });
    // Un vrai zéro reste un zéro : seul l'absent vaut le centre.
    expect(parseTournamentImage(SERVED, "COVER", 0, "0")).toMatchObject({ focusX: 0, focusY: 0 });
    expect(parseTournamentImage(SERVED, "COVER", undefined, Number.NaN)).toMatchObject({
      focusX: 50,
      focusY: 50,
    });
  });

  it("lit un point focal rendu en chaîne par le pilote MySQL", () => {
    expect(parseTournamentImage(SERVED, "COVER", "33", "66")).toMatchObject({ focusX: 33, focusY: 66 });
  });
});

describe("clampFocus", () => {
  it("arrondit et borne à [0, 100]", () => {
    expect(clampFocus(12.4)).toBe(12);
    expect(clampFocus(12.6)).toBe(13);
    expect(clampFocus(-1)).toBe(0);
    expect(clampFocus(101)).toBe(100);
  });

  it("recentre une valeur non finie", () => {
    expect(clampFocus(Number.NaN)).toBe(50);
    expect(clampFocus(Number.POSITIVE_INFINITY)).toBe(50);
  });
});

describe("checkTournamentImageSettings — lecture stricte d'une saisie", () => {
  it("accepte des réglages valides, en nombres ou en chaînes (multipart)", () => {
    expect(checkTournamentImageSettings({ fit: "CONTAIN", focusX: 0, focusY: 100 })).toEqual({
      ok: true,
      value: { fit: "CONTAIN", focusX: 0, focusY: 100 },
    });
    expect(checkTournamentImageSettings({ fit: "COVER", focusX: "25", focusY: " 75 " })).toEqual({
      ok: true,
      value: { fit: "COVER", focusX: 25, focusY: 75 },
    });
  });

  it("un champ absent vaut le défaut : un fichier seul suffit", () => {
    expect(checkTournamentImageSettings({})).toEqual({ ok: true, value: DEFAULT_IMAGE_SETTINGS });
    expect(checkTournamentImageSettings({ fit: null, focusX: "", focusY: null })).toEqual({
      ok: true,
      value: DEFAULT_IMAGE_SETTINGS,
    });
  });

  it("refuse un mode inconnu", () => {
    expect(checkTournamentImageSettings({ fit: "FILL" })).toEqual({ ok: false, error: "INVALID_IMAGE_FIT" });
    expect(checkTournamentImageSettings({ fit: "cover" })).toEqual({ ok: false, error: "INVALID_IMAGE_FIT" });
    expect(checkTournamentImageSettings({ fit: 1 })).toEqual({ ok: false, error: "INVALID_IMAGE_FIT" });
  });

  it("refuse un point focal hors bornes, décimal ou illisible — sans le corriger en silence", () => {
    for (const focusX of [-1, 101, 12.5, "12.5", "-3", "abc", "1e2", true, {}]) {
      expect(checkTournamentImageSettings({ fit: "COVER", focusX, focusY: 50 })).toEqual({
        ok: false,
        error: "INVALID_IMAGE_FOCUS",
      });
    }
    expect(checkTournamentImageSettings({ fit: "COVER", focusX: 50, focusY: "1000" })).toEqual({
      ok: false,
      error: "INVALID_IMAGE_FOCUS",
    });
  });

  it("vérifie le mode avant le point focal", () => {
    expect(checkTournamentImageSettings({ fit: "X", focusX: 500 })).toEqual({
      ok: false,
      error: "INVALID_IMAGE_FIT",
    });
  });
});

describe("modes d'affichage", () => {
  it("connaît exactement deux modes, chacun libellé", () => {
    expect(TOURNAMENT_IMAGE_FITS).toEqual(["COVER", "CONTAIN"]);
    for (const fit of TOURNAMENT_IMAGE_FITS) {
      expect(TOURNAMENT_IMAGE_FIT_LABELS[fit].label.length).toBeGreaterThan(0);
      expect(TOURNAMENT_IMAGE_FIT_LABELS[fit].hint.length).toBeGreaterThan(0);
    }
    expect(isTournamentImageFit("COVER")).toBe(true);
    expect(isTournamentImageFit("CONTAIN")).toBe(true);
    expect(isTournamentImageFit("contain")).toBe(false);
    expect(isTournamentImageFit(undefined)).toBe(false);
  });

  it("une illustration devient un bandeau, un logo une pastille, et rien sans image", () => {
    expect(tournamentImageSlot(image({ fit: "COVER" }))).toBe("BANNER");
    expect(tournamentImageSlot(image({ fit: "CONTAIN" }))).toBe("EMBLEM");
    expect(tournamentImageSlot(null)).toBeNull();
  });
});

describe("imageObjectPosition", () => {
  it("traduit le point focal en object-position CSS", () => {
    expect(imageObjectPosition({ focusX: 30, focusY: 70 })).toBe("30% 70%");
  });

  it("borne une valeur hors plage plutôt que de rendre un CSS invalide", () => {
    expect(imageObjectPosition({ focusX: -20, focusY: Number.NaN })).toBe("0% 50%");
  });
});

describe("focusFromPoint — clic sur l'aperçu", () => {
  const rect = { left: 100, top: 50, width: 200, height: 100 };

  it("désigne un point de l'image en pourcentage", () => {
    expect(focusFromPoint(150, 75, rect)).toEqual({ focusX: 25, focusY: 25 });
    expect(focusFromPoint(300, 150, rect)).toEqual({ focusX: 100, focusY: 100 });
  });

  it("borne un glissement sorti de l'image", () => {
    expect(focusFromPoint(0, 400, rect)).toEqual({ focusX: 0, focusY: 100 });
  });

  it("recentre sur un aperçu sans dimension (image pas encore chargée)", () => {
    expect(focusFromPoint(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({
      focusX: 50,
      focusY: 50,
    });
  });
});

describe("focusFromKey — le même geste au clavier", () => {
  const at = { focusX: 50, focusY: 50 };

  it("déplace d'un pas par flèche", () => {
    expect(focusFromKey(at, "ArrowLeft")).toEqual({ focusX: 50 - FOCUS_KEY_STEP, focusY: 50 });
    expect(focusFromKey(at, "ArrowRight")).toEqual({ focusX: 50 + FOCUS_KEY_STEP, focusY: 50 });
    expect(focusFromKey(at, "ArrowUp")).toEqual({ focusX: 50, focusY: 50 - FOCUS_KEY_STEP });
    expect(focusFromKey(at, "ArrowDown")).toEqual({ focusX: 50, focusY: 50 + FOCUS_KEY_STEP });
  });

  it("va cinq fois plus vite avec Maj", () => {
    expect(focusFromKey(at, "ArrowRight", true)).toEqual({ focusX: 50 + FOCUS_KEY_STEP * 5, focusY: 50 });
  });

  it("reste dans les bornes", () => {
    expect(focusFromKey({ focusX: 1, focusY: 99 }, "ArrowLeft", true)).toEqual({ focusX: 0, focusY: 99 });
    expect(focusFromKey({ focusX: 1, focusY: 99 }, "ArrowDown", true)).toEqual({ focusX: 1, focusY: 100 });
  });

  it("Origine recentre", () => {
    expect(focusFromKey({ focusX: 3, focusY: 90 }, "Home")).toEqual({ focusX: 50, focusY: 50 });
  });

  it("ignore les autres touches, qui gardent leur comportement", () => {
    expect(focusFromKey(at, "Tab")).toBeNull();
    expect(focusFromKey(at, "Enter")).toBeNull();
    expect(focusFromKey(at, "a")).toBeNull();
  });
});

describe("planTournamentImageChange — la seule requête qu'appelle un brouillon", () => {
  const settings = { fit: "COVER" as const, focusX: 50, focusY: 50 };

  it("un nouveau fichier l'emporte sur tout, avec ses réglages", () => {
    const moved = { ...settings, focusX: 10 };
    expect(planTournamentImageChange(null, { hasNewFile: true, removed: false, settings: moved })).toEqual({
      kind: "UPLOAD",
      settings: moved,
    });
    expect(planTournamentImageChange(image(), { hasNewFile: true, removed: true, settings })).toEqual({
      kind: "UPLOAD",
      settings,
    });
  });

  it("n'écrit rien quand il n'y avait rien et qu'on n'ajoute rien", () => {
    expect(planTournamentImageChange(null, { hasNewFile: false, removed: false, settings })).toEqual({
      kind: "NONE",
    });
    expect(planTournamentImageChange(null, { hasNewFile: false, removed: true, settings })).toEqual({
      kind: "NONE",
    });
  });

  it("retire l'image enregistrée", () => {
    expect(planTournamentImageChange(image(), { hasNewFile: false, removed: true, settings })).toEqual({
      kind: "DELETE",
    });
  });

  it("n'envoie que le cadrage quand seuls les réglages changent", () => {
    const logo = { ...settings, fit: "CONTAIN" as const };
    expect(planTournamentImageChange(image(), { hasNewFile: false, removed: false, settings: logo })).toEqual({
      kind: "UPDATE",
      settings: logo,
    });
  });

  it("n'envoie rien quand les réglages sont inchangés", () => {
    expect(planTournamentImageChange(image(), { hasNewFile: false, removed: false, settings })).toEqual({
      kind: "NONE",
    });
  });
});

describe("sameImageSettings", () => {
  it("compare mode et point focal", () => {
    const a = { fit: "COVER" as const, focusX: 1, focusY: 2 };
    expect(sameImageSettings(a, { ...a })).toBe(true);
    expect(sameImageSettings(a, { ...a, fit: "CONTAIN" })).toBe(false);
    expect(sameImageSettings(a, { ...a, focusX: 3 })).toBe(false);
    expect(sameImageSettings(a, { ...a, focusY: 3 })).toBe(false);
  });
});

describe("tournamentImageErrorMessage", () => {
  it("rend chaque refus connu en français, sans jamais laisser passer le code", () => {
    const codes = [
      "FILE_MISSING",
      "IMAGE_TOO_LARGE",
      "IMAGE_FORMAT_INVALID",
      "IMAGE_DIMENSIONS_INVALID",
      "IMAGE_ANIMATED_NOT_SUPPORTED",
      "INVALID_IMAGE_FIT",
      "INVALID_IMAGE_FOCUS",
      "TOURNAMENT_IMAGE_MISSING",
      "TOURNAMENT_NOT_FOUND",
      "FORBIDDEN",
      "UNAUTHORIZED",
    ];
    const messages = codes.map(tournamentImageErrorMessage);
    for (const [index, message] of messages.entries()) {
      expect(message).not.toContain(codes[index]);
      expect(message).toMatch(/\.$/);
    }
  });

  it("retombe sur un message générique pour un code inconnu", () => {
    expect(tournamentImageErrorMessage("SOMETHING_ELSE")).toBe("L'image n'a pas pu être enregistrée.");
    expect(tournamentImageErrorMessage("")).toBe("L'image n'a pas pu être enregistrée.");
  });
});

describe("limites du sélecteur — celles du serveur", () => {
  it("reprend le poids et les formats partagés avec lib/server/image-upload.ts", async () => {
    const { IMAGE_UPLOAD_MAX_BYTES, IMAGE_UPLOAD_MIME_TYPES } = await import("@/lib/shared/uploads");
    const { TOURNAMENT_IMAGE_ACCEPT, TOURNAMENT_IMAGE_MAX_BYTES } = await import("@/lib/shared/tournament-image");
    expect(TOURNAMENT_IMAGE_MAX_BYTES).toBe(IMAGE_UPLOAD_MAX_BYTES);
    expect(TOURNAMENT_IMAGE_ACCEPT.split(",")).toEqual([...IMAGE_UPLOAD_MIME_TYPES]);
  });
});
