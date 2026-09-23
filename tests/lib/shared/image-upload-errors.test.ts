import { describe, expect, it } from "@jest/globals";
import {
  imageUploadErrorMessage,
  isImageUploadError,
  precheckImageUpload,
} from "@/lib/shared/image-upload-errors";
import { IMAGE_UPLOAD_MAX_BYTES } from "@/lib/shared/uploads";
import { teamErrorMessage } from "@/app/(secured)/equipes/_lib/team-errors";

const IMAGE_CODES = [
  "FILE_MISSING",
  "IMAGE_TOO_LARGE",
  "IMAGE_FORMAT_INVALID",
  "IMAGE_DIMENSIONS_INVALID",
  "IMAGE_ANIMATED_NOT_SUPPORTED",
];

/**
 * Les refus d'un téléversement d'image, rédigés une fois pour le logo d'équipe
 * et l'avatar : ils naissent tous de `processAndStoreImage`, et la fiche
 * d'équipe les disait en français pendant que `/profil` affichait le code.
 */
describe("imageUploadErrorMessage", () => {
  it("dit chaque refus en français", () => {
    for (const code of IMAGE_CODES) {
      const message = imageUploadErrorMessage(code);
      expect(message).not.toBeNull();
      expect(message).not.toMatch(/[A-Z]{4,}_[A-Z]{4,}/);
    }
  });

  it("annonce la limite que le serveur tient, pas un nombre recopié", () => {
    expect(imageUploadErrorMessage("IMAGE_TOO_LARGE")).toContain(
      `${IMAGE_UPLOAD_MAX_BYTES / (1024 * 1024)} Mo`,
    );
  });

  it("rend null hors de son domaine — le repli appartient à l'écran", () => {
    for (const code of ["ACCOUNT_DELETED", "BOOM", "", null, undefined]) {
      expect(imageUploadErrorMessage(code)).toBeNull();
    }
  });

  it("ne se laisse pas tromper par la chaîne de prototypes", () => {
    expect(imageUploadErrorMessage("constructor")).toBeNull();
    expect(isImageUploadError("toString")).toBe(false);
  });

  it("reste la seule rédaction : la fiche d'équipe en tire les siennes", () => {
    for (const code of IMAGE_CODES) {
      expect(teamErrorMessage(code)).toBe(imageUploadErrorMessage(code));
    }
  });
});

describe("isImageUploadError", () => {
  it("reconnaît les cinq refus et eux seuls", () => {
    for (const code of IMAGE_CODES) expect(isImageUploadError(code)).toBe(true);
    for (const code of ["AVATAR_UPLOAD_FAILED", "EACCES", "", null, undefined]) {
      expect(isImageUploadError(code)).toBe(false);
    }
  });
});

describe("precheckImageUpload", () => {
  it("laisse passer une image acceptée", () => {
    expect(precheckImageUpload({ type: "image/png", size: 1024 })).toBeNull();
    expect(precheckImageUpload({ type: "image/webp", size: IMAGE_UPLOAD_MAX_BYTES })).toBeNull();
  });

  it("nomme le format quand c'est lui qui manque", () => {
    expect(precheckImageUpload({ type: "image/gif", size: 1024 })).toBe("IMAGE_FORMAT_INVALID");
    expect(precheckImageUpload({ type: "", size: 1024 })).toBe("IMAGE_FORMAT_INVALID");
  });

  it("nomme le poids quand c'est lui qui dépasse", () => {
    expect(precheckImageUpload({ type: "image/jpeg", size: IMAGE_UPLOAD_MAX_BYTES + 1 })).toBe(
      "IMAGE_TOO_LARGE",
    );
  });
});
