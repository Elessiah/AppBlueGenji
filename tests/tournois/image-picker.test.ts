import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  applyImageChange,
  imageChangeSuccessMessage,
  imageFingerprint,
  imagePickerChange,
  initialImagePickerValue,
  rejectImageFile,
  resyncImageDraft,
  suggestImageFit,
  withNewFile,
} from "@/app/(secured)/tournois/_lib/image-picker";
import type { TournamentImage } from "@/lib/shared/tournament-image";

/**
 * Brouillon du sélecteur d'image : partagé par la création d'un tournoi et le
 * réglage depuis sa fiche. Rien ne part tant que l'organisateur n'enregistre
 * pas, et la requête envoyée est la seule qu'appelle le brouillon.
 */

const saved: TournamentImage = {
  url: "/api/uploads/tournaments/7-abc.webp",
  fit: "CONTAIN",
  focusX: 30,
  focusY: 70,
};

const pngFile = (size = 4) =>
  new File([new Uint8Array(size)], "visuel.png", { type: "image/png" });

describe("initialImagePickerValue", () => {
  it("part des réglages de l'image enregistrée", () => {
    expect(initialImagePickerValue(saved)).toEqual({
      file: null,
      removed: false,
      settings: { fit: "CONTAIN", focusX: 30, focusY: 70 },
    });
  });

  it("part des défauts sans image (création)", () => {
    expect(initialImagePickerValue(null)).toEqual({
      file: null,
      removed: false,
      settings: { fit: "COVER", focusX: 50, focusY: 50 },
    });
  });

  it("ne partage pas l'objet de défauts : un brouillon modifié n'en contamine pas un autre", () => {
    const a = initialImagePickerValue(null);
    a.settings.focusX = 1;
    expect(initialImagePickerValue(null).settings.focusX).toBe(50);
  });
});

describe("imagePickerChange", () => {
  it("un brouillon intact n'appelle aucune requête", () => {
    expect(imagePickerChange(saved, initialImagePickerValue(saved))).toEqual({ kind: "NONE" });
    expect(imagePickerChange(null, initialImagePickerValue(null))).toEqual({ kind: "NONE" });
  });

  it("un fichier choisi appelle un envoi", () => {
    const value = withNewFile(pngFile(), "COVER");
    expect(imagePickerChange(null, value)).toEqual({ kind: "UPLOAD", settings: value.settings });
  });

  it("un retrait appelle une suppression", () => {
    expect(imagePickerChange(saved, { ...initialImagePickerValue(saved), removed: true })).toEqual({
      kind: "DELETE",
    });
  });

  it("un recadrage n'appelle que la mise à jour des réglages", () => {
    const value = initialImagePickerValue(saved);
    value.settings = { ...value.settings, fit: "COVER" };
    expect(imagePickerChange(saved, value)).toEqual({ kind: "UPDATE", settings: value.settings });
  });
});

describe("suggestImageFit — premier mode proposé", () => {
  it("propose l'illustration pour une image nettement plus large que haute", () => {
    expect(suggestImageFit(1600, 560)).toBe("COVER");
    expect(suggestImageFit(1400, 1000)).toBe("COVER");
  });

  it("propose le logo pour un carré ou un portrait", () => {
    expect(suggestImageFit(512, 512)).toBe("CONTAIN");
    expect(suggestImageFit(300, 600)).toBe("CONTAIN");
    expect(suggestImageFit(1300, 1000)).toBe("CONTAIN");
  });

  it("retombe sur l'illustration quand les dimensions sont illisibles", () => {
    expect(suggestImageFit(0, 100)).toBe("COVER");
    expect(suggestImageFit(Number.NaN, 100)).toBe("COVER");
  });
});

describe("withNewFile", () => {
  it("recentre le cadrage : un point focal ne vaut que pour l'image qui l'a reçu", () => {
    const file = pngFile();
    expect(withNewFile(file, "CONTAIN")).toEqual({
      file,
      removed: false,
      settings: { fit: "CONTAIN", focusX: 50, focusY: 50 },
    });
  });
});

describe("rejectImageFile — refus immédiat, avant tout envoi", () => {
  it("accepte PNG, JPEG et WebP sous 5 Mo", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp"]) {
      expect(rejectImageFile({ type, size: 1024 })).toBeNull();
    }
    expect(rejectImageFile({ type: "image/png", size: 5 * 1024 * 1024 })).toBeNull();
  });

  it("refuse un autre format, SVG et GIF compris", () => {
    for (const type of ["image/svg+xml", "image/gif", "application/pdf", ""]) {
      expect(rejectImageFile({ type, size: 10 })).toMatch(/PNG, JPEG ou WebP/);
    }
  });

  it("refuse un fichier trop lourd", () => {
    expect(rejectImageFile({ type: "image/png", size: 5 * 1024 * 1024 + 1 })).toMatch(/5 Mo/);
  });
});

describe("applyImageChange", () => {
  const fetchMock = jest.fn<typeof fetch>();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const respond = (status: number, body: unknown) =>
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it("n'appelle rien quand il n'y a rien à écrire", async () => {
    await expect(applyImageChange(7, { kind: "NONE" }, null)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("envoie le fichier et son cadrage en multipart", async () => {
    respond(200, { image: saved });
    const file = pngFile();
    const settings = { fit: "COVER" as const, focusX: 12, focusY: 88 };

    await expect(applyImageChange(7, { kind: "UPLOAD", settings }, file)).resolves.toEqual(saved);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/tournaments/7/image");
    expect(init?.method).toBe("POST");
    const body = init?.body as FormData;
    expect(body.get("file")).toBeInstanceOf(File);
    expect(body.get("fit")).toBe("COVER");
    expect(body.get("focusX")).toBe("12");
    expect(body.get("focusY")).toBe("88");
  });

  it("refuse un envoi sans fichier sans rien appeler", async () => {
    await expect(
      applyImageChange(7, { kind: "UPLOAD", settings: { fit: "COVER", focusX: 50, focusY: 50 } }, null),
    ).rejects.toThrow("Aucun fichier reçu.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("envoie un recadrage en JSON", async () => {
    respond(200, { image: saved });
    const settings = { fit: "CONTAIN" as const, focusX: 30, focusY: 70 };
    await applyImageChange(7, { kind: "UPDATE", settings }, null);

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual(settings);
  });

  it("supprime et rend null", async () => {
    respond(200, { image: null });
    await expect(applyImageChange(7, { kind: "DELETE" }, null)).resolves.toBeNull();
    expect(fetchMock.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("lève un message en français sur un refus", async () => {
    respond(400, { error: "IMAGE_FORMAT_INVALID" });
    await expect(applyImageChange(7, { kind: "DELETE" }, null)).rejects.toThrow(
      "Format non pris en charge : PNG, JPEG ou WebP uniquement.",
    );
  });

  it("lève un message générique sur une réponse illisible", async () => {
    fetchMock.mockResolvedValue(new Response("<html>502</html>", { status: 502 }));
    await expect(applyImageChange(7, { kind: "DELETE" }, null)).rejects.toThrow(
      "L'image n'a pas pu être enregistrée.",
    );
  });
});

describe("imageChangeSuccessMessage", () => {
  it("nomme ce qui a été écrit, et se tait quand rien ne l'a été", () => {
    const settings = { fit: "COVER" as const, focusX: 50, focusY: 50 };
    expect(imageChangeSuccessMessage({ kind: "UPLOAD", settings })).toBe("Image du tournoi enregistrée.");
    expect(imageChangeSuccessMessage({ kind: "UPDATE", settings })).toBe("Réglage de l'image enregistré.");
    expect(imageChangeSuccessMessage({ kind: "DELETE" })).toBe("Image du tournoi retirée.");
    expect(imageChangeSuccessMessage({ kind: "NONE" })).toBeNull();
  });
});

describe("imageFingerprint", () => {
  it("change avec le fichier comme avec le cadrage", () => {
    const base = imageFingerprint(saved);
    expect(imageFingerprint({ ...saved })).toBe(base);
    expect(imageFingerprint({ ...saved, url: "/api/uploads/tournaments/7-b.webp" })).not.toBe(base);
    expect(imageFingerprint({ ...saved, fit: "COVER" })).not.toBe(base);
    expect(imageFingerprint({ ...saved, focusY: 71 })).not.toBe(base);
    expect(imageFingerprint(null)).toBe("");
  });
});

describe("resyncImageDraft — l'image enregistrée change sous la modale", () => {
  const next: TournamentImage = { ...saved, fit: "COVER", focusX: 10 };

  it("ne touche à rien quand l'image n'a pas changé", () => {
    const value = { ...initialImagePickerValue(saved), removed: true };
    expect(resyncImageDraft(saved, { ...saved }, value)).toEqual({ value, conflict: false });
  });

  it("un brouillon intact suit la nouvelle image : aucun recadrage fantôme", () => {
    const result = resyncImageDraft(saved, next, initialImagePickerValue(saved));
    expect(result).toEqual({ value: initialImagePickerValue(next), conflict: false });
    expect(imagePickerChange(next, result.value)).toEqual({ kind: "NONE" });
  });

  it("un brouillon intact suit aussi un retrait fait ailleurs", () => {
    expect(resyncImageDraft(saved, null, initialImagePickerValue(saved))).toEqual({
      value: initialImagePickerValue(null),
      conflict: false,
    });
  });

  it("un brouillon entamé est gardé, et le désaccord signalé", () => {
    const touched = initialImagePickerValue(saved);
    touched.settings = { ...touched.settings, focusX: 90 };
    expect(resyncImageDraft(saved, next, touched)).toEqual({ value: touched, conflict: true });

    const withFile = withNewFile(pngFile(), "COVER");
    expect(resyncImageDraft(saved, next, withFile)).toEqual({ value: withFile, conflict: true });
  });
});
