/**
 * Illustration ou logo d'un tournoi — logique pure, partagée client/serveur.
 *
 * Une image de tournoi est **facultative**. Elle est stockée **sans recadrage**
 * (`lib/server/image-upload.ts`, gabarit `tournament-image` : réduite si elle
 * dépasse, jamais agrandie ni rognée), si bien que n'importe quel format passe —
 * bannière 21:9, visuel carré, logo en portrait. Le cadrage se décide **au
 * rendu**, selon deux modes :
 *
 * - `COVER` (« Illustration ») : l'image remplit un bandeau et un **point
 *   focal** choisi par l'organisateur reste visible quelle que soit la largeur
 *   du cadre. C'est ce qui permet de « centrer » une image sans la recadrer :
 *   la même image sert au bandeau large de la fiche et à la vignette d'une
 *   carte, qui n'ont pas les mêmes proportions.
 * - `CONTAIN` (« Logo ») : l'image est toujours montrée **en entier**, dans une
 *   pastille — un logo rogné n'est plus un logo.
 *
 * Le point focal est conservé en mode logo (il n'y sert à rien) : repasser en
 * illustration retrouve le cadrage choisi.
 */
import { IMAGE_UPLOAD_MAX_BYTES, IMAGE_UPLOAD_MIME_TYPES, localUploadUrl } from "./uploads";

export const TOURNAMENT_IMAGE_FITS = ["COVER", "CONTAIN"] as const;

export type TournamentImageFit = (typeof TOURNAMENT_IMAGE_FITS)[number];

/** Libellé et phrase d'aide de chaque mode, dans l'ordre du sélecteur. */
export const TOURNAMENT_IMAGE_FIT_LABELS: Record<TournamentImageFit, { label: string; hint: string }> = {
  COVER: {
    label: "Illustration",
    hint: "Remplit le bandeau du tournoi. Clique sur l'aperçu pour choisir le point qui doit rester visible.",
  },
  CONTAIN: {
    label: "Logo",
    hint: "Toujours affiché en entier, dans une pastille à côté du nom — idéal pour un fond transparent.",
  },
};

/** Point focal par défaut : le centre de l'image. */
export const DEFAULT_IMAGE_FOCUS = 50;

/** Réglages d'affichage d'une image, hors fichier. */
export type TournamentImageSettings = {
  fit: TournamentImageFit;
  /** Abscisse du point focal, en pourcentage de la largeur (0 = bord gauche). */
  focusX: number;
  /** Ordonnée du point focal, en pourcentage de la hauteur (0 = bord haut). */
  focusY: number;
};

/** Image d'un tournoi telle que la lit l'interface. */
export type TournamentImage = TournamentImageSettings & {
  /** Toujours un fichier servi par le site (`/api/uploads/tournaments/…`). */
  url: string;
};

export const DEFAULT_IMAGE_SETTINGS: TournamentImageSettings = {
  fit: "COVER",
  focusX: DEFAULT_IMAGE_FOCUS,
  focusY: DEFAULT_IMAGE_FOCUS,
};

export function isTournamentImageFit(value: unknown): value is TournamentImageFit {
  return typeof value === "string" && (TOURNAMENT_IMAGE_FITS as readonly string[]).includes(value);
}

/** Ramène une coordonnée à un entier de 0 à 100 ; une valeur illisible vaut le centre. */
export function clampFocus(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_IMAGE_FOCUS;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Lecture **tolérante** d'une ligne de base.
 *
 * L'URL passe par `localUploadUrl` : comme pour les logos d'équipe, la garantie
 * « une image du site vient du site » est posée à la sortie — une URL étrangère
 * écrite par un chemin qu'on aurait oublié rend `null`, et la carte s'affiche
 * simplement sans image. Un mode ou un point focal abîmé retombe sur le défaut
 * plutôt que de priver le tournoi de son image.
 */
export function parseTournamentImage(
  url: string | null | undefined,
  fit: unknown,
  focusX: unknown,
  focusY: unknown,
): TournamentImage | null {
  const safeUrl = localUploadUrl(url);
  if (safeUrl === null) return null;
  return {
    url: safeUrl,
    fit: isTournamentImageFit(fit) ? fit : DEFAULT_IMAGE_SETTINGS.fit,
    focusX: clampFocus(Number(focusX)),
    focusY: clampFocus(Number(focusY)),
  };
}

export type TournamentImageSettingsError = "INVALID_IMAGE_FIT" | "INVALID_IMAGE_FOCUS";

/**
 * Lecture **stricte** d'une saisie (corps JSON ou champs multipart).
 *
 * Contrairement à `parseTournamentImage`, rien n'est corrigé en silence : une
 * saisie hors bornes est un refus. Les champs d'un formulaire multipart arrivent
 * en chaînes, d'où l'acceptation d'un nombre écrit en décimal. Un champ
 * **absent** vaut le défaut : envoyer un fichier seul doit suffire.
 */
export function checkTournamentImageSettings(raw: {
  fit?: unknown;
  focusX?: unknown;
  focusY?: unknown;
}):
  | { ok: true; value: TournamentImageSettings }
  | { ok: false; error: TournamentImageSettingsError } {
  const fit = raw.fit ?? DEFAULT_IMAGE_SETTINGS.fit;
  if (!isTournamentImageFit(fit)) return { ok: false, error: "INVALID_IMAGE_FIT" };

  const focusX = readFocus(raw.focusX);
  const focusY = readFocus(raw.focusY);
  if (focusX === null || focusY === null) return { ok: false, error: "INVALID_IMAGE_FOCUS" };

  return { ok: true, value: { fit, focusX, focusY } };
}

function readFocus(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return DEFAULT_IMAGE_FOCUS;
  const number =
    typeof value === "number" ? value : typeof value === "string" && /^\d{1,3}$/.test(value.trim()) ? Number(value) : NaN;
  if (!Number.isInteger(number) || number < 0 || number > 100) return null;
  return number;
}

/** Valeur CSS `object-position` d'une image, d'après son point focal. */
export function imageObjectPosition(settings: Pick<TournamentImageSettings, "focusX" | "focusY">): string {
  return `${clampFocus(settings.focusX)}% ${clampFocus(settings.focusY)}%`;
}

/**
 * Point focal désigné par un clic (ou une flèche) sur l'aperçu.
 *
 * L'aperçu du sélecteur montre l'image **entière** : un clic y désigne donc
 * directement un point de l'image, sans calcul de recadrage.
 */
export function focusFromPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): Pick<TournamentImageSettings, "focusX" | "focusY"> {
  const ratio = (offset: number, size: number) => (size > 0 ? (offset / size) * 100 : DEFAULT_IMAGE_FOCUS);
  return {
    focusX: clampFocus(ratio(clientX - rect.left, rect.width)),
    focusY: clampFocus(ratio(clientY - rect.top, rect.height)),
  };
}

/** Pas d'une flèche du clavier sur le sélecteur de point focal (Maj : ×5). */
export const FOCUS_KEY_STEP = 2;

/**
 * Déplacement du point focal au clavier — le clic seul n'a pas d'équivalent
 * pour qui navigue sans souris. Rend `null` pour une touche sans effet.
 */
export function focusFromKey(
  settings: Pick<TournamentImageSettings, "focusX" | "focusY">,
  key: string,
  large = false,
): Pick<TournamentImageSettings, "focusX" | "focusY"> | null {
  const step = large ? FOCUS_KEY_STEP * 5 : FOCUS_KEY_STEP;
  const { focusX, focusY } = settings;
  switch (key) {
    case "ArrowLeft":
      return { focusX: clampFocus(focusX - step), focusY };
    case "ArrowRight":
      return { focusX: clampFocus(focusX + step), focusY };
    case "ArrowUp":
      return { focusX, focusY: clampFocus(focusY - step) };
    case "ArrowDown":
      return { focusX, focusY: clampFocus(focusY + step) };
    case "Home":
      return { focusX: DEFAULT_IMAGE_FOCUS, focusY: DEFAULT_IMAGE_FOCUS };
    default:
      return null;
  }
}

/**
 * Où une image se place : une **illustration** devient un bandeau, un **logo**
 * une pastille à côté du nom. Écrit une fois pour tous les écrans (cartes,
 * fiche, vitrine) : une illustration en pastille serait illisible, un logo en
 * bandeau rogné.
 */
export function tournamentImageSlot(image: TournamentImage | null): "BANNER" | "EMBLEM" | null {
  if (image === null) return null;
  return image.fit === "CONTAIN" ? "EMBLEM" : "BANNER";
}

/** Les réglages sont-ils identiques ? */
export function sameImageSettings(a: TournamentImageSettings, b: TournamentImageSettings): boolean {
  return a.fit === b.fit && a.focusX === b.focusX && a.focusY === b.focusY;
}

/** Ce que l'organisateur a préparé dans le sélecteur, avant enregistrement. */
export type TournamentImageDraft = {
  /** Un nouveau fichier a été choisi. */
  hasNewFile: boolean;
  /** L'image a été retirée (sans en choisir une autre). */
  removed: boolean;
  settings: TournamentImageSettings;
};

export type TournamentImageChange =
  | { kind: "NONE" }
  | { kind: "UPLOAD"; settings: TournamentImageSettings }
  | { kind: "UPDATE"; settings: TournamentImageSettings }
  | { kind: "DELETE" };

/**
 * La seule écriture qu'appelle un brouillon, comparé à l'image enregistrée.
 *
 * Écrite une fois pour la création (où `initial` vaut `null`) et pour la
 * modale de la fiche : un nouveau fichier l'emporte sur tout, un retrait
 * n'écrit rien s'il n'y avait rien, et de simples réglages inchangés
 * n'envoient aucune requête.
 */
export function planTournamentImageChange(
  initial: TournamentImage | null,
  draft: TournamentImageDraft,
): TournamentImageChange {
  if (draft.hasNewFile) return { kind: "UPLOAD", settings: draft.settings };
  if (initial === null) return { kind: "NONE" };
  if (draft.removed) return { kind: "DELETE" };
  if (sameImageSettings(initial, draft.settings)) return { kind: "NONE" };
  return { kind: "UPDATE", settings: draft.settings };
}

/** Types de fichier acceptés par le sélecteur (le serveur relit les octets). */
export const TOURNAMENT_IMAGE_ACCEPT = IMAGE_UPLOAD_MIME_TYPES.join(",");

/** Poids maximal d'un fichier : la limite du serveur, partagée. */
export const TOURNAMENT_IMAGE_MAX_BYTES = IMAGE_UPLOAD_MAX_BYTES;

/** Refus rendus par `/api/admin/tournaments/[id]/image`, en français. */
export function tournamentImageErrorMessage(code: string): string {
  switch (code) {
    case "FILE_MISSING":
      return "Aucun fichier reçu.";
    case "IMAGE_TOO_LARGE":
      return "Image trop lourde : 5 Mo maximum.";
    case "IMAGE_FORMAT_INVALID":
      return "Format non pris en charge : PNG, JPEG ou WebP uniquement.";
    case "IMAGE_DIMENSIONS_INVALID":
      return "Dimensions de l'image illisibles ou trop grandes (8000 px maximum par côté).";
    case "IMAGE_ANIMATED_NOT_SUPPORTED":
      return "Les images animées ne sont pas prises en charge.";
    case "INVALID_IMAGE_FIT":
      return "Mode d'affichage de l'image invalide.";
    case "INVALID_IMAGE_FOCUS":
      return "Point de cadrage invalide.";
    case "TOURNAMENT_IMAGE_MISSING":
      return "Ce tournoi n'a plus d'image : recharge la page.";
    case "TOURNAMENT_NOT_FOUND":
      return "Tournoi introuvable.";
    case "FORBIDDEN":
    case "UNAUTHORIZED":
      return "Action réservée aux arbitres et administrateurs.";
    default:
      return "L'image n'a pas pu être enregistrée.";
  }
}
