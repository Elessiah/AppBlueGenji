import {
  DEFAULT_IMAGE_FOCUS,
  DEFAULT_IMAGE_SETTINGS,
  TOURNAMENT_IMAGE_ACCEPT,
  TOURNAMENT_IMAGE_MAX_BYTES,
  planTournamentImageChange,
  tournamentImageErrorMessage,
  type TournamentImage,
  type TournamentImageChange,
  type TournamentImageFit,
  type TournamentImageSettings,
} from "@/lib/shared/tournament-image";

/**
 * État du sélecteur d'image (`_components/TournamentImagePicker`), partagé par
 * la création d'un tournoi et le réglage depuis sa fiche.
 *
 * Rien n'est envoyé tant que l'organisateur n'enregistre pas : le sélecteur
 * prépare un brouillon, et `planTournamentImageChange` (module pur) décide de
 * la seule requête qu'il appelle.
 */
export type ImagePickerValue = {
  /** Nouveau fichier choisi, pas encore envoyé. */
  file: File | null;
  /** L'image enregistrée a été retirée (sans en choisir une autre). */
  removed: boolean;
  settings: TournamentImageSettings;
};

export function initialImagePickerValue(existing: TournamentImage | null): ImagePickerValue {
  return {
    file: null,
    removed: false,
    settings: existing
      ? { fit: existing.fit, focusX: existing.focusX, focusY: existing.focusY }
      : { ...DEFAULT_IMAGE_SETTINGS },
  };
}

/** La requête qu'appelle ce brouillon, comparé à l'image enregistrée. */
export function imagePickerChange(
  existing: TournamentImage | null,
  value: ImagePickerValue,
): TournamentImageChange {
  return planTournamentImageChange(existing, {
    hasNewFile: value.file !== null,
    removed: value.removed,
    settings: value.settings,
  });
}

/**
 * Premier mode proposé pour une image fraîchement choisie : une image nettement
 * plus large que haute est une **illustration**, le reste (carré, portrait) a
 * toutes les chances d'être un **logo**. Ce n'est qu'une proposition — le
 * sélecteur la montre, l'organisateur la change d'un clic.
 */
export function suggestImageFit(width: number, height: number): TournamentImageFit {
  if (!(width > 0) || !(height > 0)) return DEFAULT_IMAGE_SETTINGS.fit;
  return width / height >= 1.4 ? "COVER" : "CONTAIN";
}

/** Brouillon après le choix d'un fichier : cadrage recentré, mode proposé. */
export function withNewFile(file: File, fit: TournamentImageFit): ImagePickerValue {
  return {
    file,
    removed: false,
    settings: { fit, focusX: DEFAULT_IMAGE_FOCUS, focusY: DEFAULT_IMAGE_FOCUS },
  };
}

/**
 * Refus immédiat d'un fichier, avant tout envoi — le serveur relit les octets
 * et reste le juge. `null` = fichier recevable.
 */
export function rejectImageFile(file: Pick<File, "size" | "type">): string | null {
  if (!TOURNAMENT_IMAGE_ACCEPT.split(",").includes(file.type)) {
    return tournamentImageErrorMessage("IMAGE_FORMAT_INVALID");
  }
  if (file.size > TOURNAMENT_IMAGE_MAX_BYTES) return tournamentImageErrorMessage("IMAGE_TOO_LARGE");
  return null;
}

/**
 * Applique la requête décidée par `imagePickerChange`.
 *
 * @returns L'image enregistrée (`null` si retirée), ou `undefined` quand il n'y
 *   avait rien à écrire.
 * @throws Error dont le message est déjà rédigé en français.
 */
export async function applyImageChange(
  tournamentId: number,
  change: TournamentImageChange,
  file: File | null,
): Promise<TournamentImage | null | undefined> {
  if (change.kind === "NONE") return undefined;

  const endpoint = `/api/admin/tournaments/${tournamentId}/image`;
  let response: Response;
  if (change.kind === "UPLOAD") {
    if (file === null) throw new Error(tournamentImageErrorMessage("FILE_MISSING"));
    const form = new FormData();
    form.append("file", file);
    form.append("fit", change.settings.fit);
    form.append("focusX", String(change.settings.focusX));
    form.append("focusY", String(change.settings.focusY));
    response = await fetch(endpoint, { method: "POST", body: form });
  } else if (change.kind === "UPDATE") {
    response = await fetch(endpoint, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(change.settings),
    });
  } else {
    response = await fetch(endpoint, { method: "DELETE" });
  }

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    image?: TournamentImage | null;
  };
  if (!response.ok) throw new Error(tournamentImageErrorMessage(payload.error ?? ""));
  return payload.image ?? null;
}

/** Message de réussite, selon ce qui a été écrit. */
export function imageChangeSuccessMessage(change: TournamentImageChange): string | null {
  switch (change.kind) {
    case "UPLOAD":
      return "Image du tournoi enregistrée.";
    case "UPDATE":
      return "Réglage de l'image enregistré.";
    case "DELETE":
      return "Image du tournoi retirée.";
    default:
      return null;
  }
}
