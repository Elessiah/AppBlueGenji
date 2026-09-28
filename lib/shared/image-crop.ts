/**
 * Recadrage manuel d'une image téléversée — la géométrie, sans rendu.
 *
 * Six écrans importent une image (avatar, logo d'équipe, photo de bénévole,
 * logo et bandeau de partenaire, image de tournoi) et le serveur la passait
 * dans un gabarit fixe (`lib/server/image-upload.ts`) : un avatar était rogné
 * **au centre**, si bien qu'un visage placé en haut d'une photo en portrait
 * perdait le front, et un bandeau 3:1 tiré d'une photo carrée gardait la bande
 * du milieu, quelle qu'elle soit. Le joueur choisit désormais la zone gardée,
 * dans une modale commune (`components/ui/image-crop-dialog.tsx`).
 *
 * **Le recadrage voyage en coordonnées, jamais en pixels réencodés.** Le
 * navigateur n'envoie pas une image recadrée par un `<canvas>` mais le fichier
 * d'origine **et** un rectangle ; c'est `sharp` qui découpe. Trois raisons :
 * le serveur garde son unique chaîne de contrôle (format lu dans les octets,
 * dimensions, animation), une image n'est pas compressée deux fois, et un
 * `<canvas>` qui réencode en PNG — Safari ne sait pas produire de WebP — ferait
 * passer au-dessus de la limite de poids un fichier qui la respectait.
 *
 * Le rectangle est exprimé en **fractions** de l'image **orientée** (EXIF
 * appliqué) : le navigateur affiche une photo de téléphone redressée, `sharp`
 * la redresse aussi (`autoOrient`), et des fractions ne dépendent pas de la
 * taille à laquelle la modale l'a montrée.
 *
 * Module **pur** : la modale y prend ses déplacements, le serveur sa lecture du
 * champ et sa conversion en pixels. Les deux côtés lisent la même règle.
 */

/** Gabarits de téléversement (voir `lib/server/image-upload.ts`). */
export const IMAGE_UPLOAD_KINDS = [
  "avatar",
  "team-logo",
  "sponsor-logo",
  "sponsor-banner",
  "benevole-photo",
  "tournament-image",
] as const;

export type ImageUploadKind = (typeof IMAGE_UPLOAD_KINDS)[number];

/** Nom du champ multipart qui porte le rectangle. */
export const IMAGE_CROP_FIELD = "crop";

/** Refus d'un rectangle illisible ou hors de l'image. */
export const IMAGE_CROP_INVALID = "IMAGE_CROP_INVALID";

/**
 * Proportions imposées au cadre, largeur / hauteur ; `null` = libre.
 *
 * Imposées là où le gabarit **recadre** (`cover`) : un avatar est un carré, un
 * bandeau un 3:1, et un cadre libre y serait rogné une seconde fois, au centre,
 * par le serveur — le joueur ne verrait pas ce qu'il obtient. Libres là où le
 * gabarit **contient** ou **réduit** : un logo s'affiche entier, la zone gardée
 * n'a pas de forme à respecter.
 */
export const IMAGE_CROP_ASPECTS: Record<ImageUploadKind, number | null> = {
  avatar: 1,
  "team-logo": null,
  "sponsor-logo": null,
  "sponsor-banner": 3,
  "benevole-photo": 1,
  "tournament-image": null,
};

/** Gabarits affichés en cercle : la modale y dessine un repère rond. */
export const IMAGE_CROP_ROUND: Record<ImageUploadKind, boolean> = {
  avatar: true,
  "team-logo": false,
  "sponsor-logo": false,
  "sponsor-banner": false,
  "benevole-photo": true,
  "tournament-image": false,
};

/** Dimensions de l'image orientée, en pixels. */
export interface ImageSize {
  width: number;
  height: number;
}

/** Rectangle en pixels de l'image orientée (géométrie de la modale). */
export interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Rectangle en fractions de l'image orientée (ce qui voyage). */
export type CropRect = CropBox;

/** Coin saisi pour redimensionner le cadre. */
export type CropHandle = "nw" | "ne" | "sw" | "se";

export const CROP_HANDLES: readonly CropHandle[] = ["nw", "ne", "sw", "se"];

/** Plus petit côté accepté du cadre, en pixels — borné par l'image elle-même. */
const MIN_CROP_PX = 24;

/**
 * Tolérance d'arrondi sur des fractions venues du réseau : `cropBoxToRect`
 * arrondit chaque fraction à six décimales, si bien qu'un cadre calé sur le
 * bord peut dépasser 1 d'un millionième par la somme de deux arrondis.
 */
const EPSILON = 1e-5;

/** Longueur maximale du champ : quatre nombres n'en demandent pas plus. */
const MAX_FIELD_LENGTH = 200;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Plus petit côté permis pour cette image. */
export function minCropSize(size: ImageSize): number {
  return Math.max(1, Math.min(MIN_CROP_PX, size.width, size.height));
}

/**
 * Le cadre proposé à l'ouverture : **celui que le serveur appliquait**.
 *
 * Image entière pour un cadre libre, plus grand rectangle centré aux bonnes
 * proportions sinon — exactement le `fit: "cover", position: "centre"` du
 * gabarit. Valider sans rien toucher donne donc le même fichier qu'avant
 * l'outil : le recadrage manuel est un réglage, jamais une étape de plus.
 */
export function defaultCropBox(size: ImageSize, aspect: number | null): CropBox {
  if (aspect === null) return { x: 0, y: 0, width: size.width, height: size.height };
  const width = Math.min(size.width, size.height * aspect);
  const height = width / aspect;
  return { x: (size.width - width) / 2, y: (size.height - height) / 2, width, height };
}

/** Déplace le cadre sans le laisser sortir de l'image. */
export function moveCropBox(box: CropBox, dx: number, dy: number, size: ImageSize): CropBox {
  return {
    ...box,
    x: clamp(box.x + dx, 0, Math.max(0, size.width - box.width)),
    y: clamp(box.y + dy, 0, Math.max(0, size.height - box.height)),
  };
}

/**
 * Redimensionne le cadre par un coin ; le coin **opposé** ne bouge pas.
 *
 * Le cadre ne se retourne jamais (le coin saisi ne franchit pas l'ancre), ne
 * sort pas de l'image et ne descend pas sous `minCropSize`. À proportions
 * imposées, c'est l'axe qui a le plus bougé qui décide de la taille : prendre
 * toujours le plus grand des deux empêcherait de rétrécir en tirant sur un
 * seul axe.
 */
export function resizeCropBox(
  box: CropBox,
  handle: CropHandle,
  dx: number,
  dy: number,
  size: ImageSize,
  aspect: number | null,
): CropBox {
  const east = handle === "ne" || handle === "se";
  const south = handle === "sw" || handle === "se";
  const anchorX = east ? box.x : box.x + box.width;
  const anchorY = south ? box.y : box.y + box.height;
  const maxW = east ? size.width - anchorX : anchorX;
  const maxH = south ? size.height - anchorY : anchorY;
  const min = minCropSize(size);

  let width = box.width + (east ? dx : -dx);
  let height = box.height + (south ? dy : -dy);

  if (aspect === null) {
    width = clamp(width, Math.min(min, maxW), maxW);
    height = clamp(height, Math.min(min, maxH), maxH);
  } else {
    const fromHeight = height * aspect;
    width = Math.abs(width - box.width) >= Math.abs(fromHeight - box.width) ? width : fromHeight;
    const upper = Math.min(maxW, maxH * aspect);
    const lower = Math.min(Math.max(min, min * aspect), upper);
    width = clamp(width, lower, upper);
    height = width / aspect;
  }

  return {
    x: east ? anchorX : anchorX - width,
    y: south ? anchorY : anchorY - height,
    width,
    height,
  };
}

/**
 * Agrandit (`factor` > 1) ou réduit le cadre autour de son centre.
 *
 * Les proportions du cadre sont gardées — celles imposées, ou celles qu'il a à
 * cet instant quand elles sont libres —, et le cadre reste dans l'image : buté
 * contre un bord, il glisse plutôt que de se déformer.
 */
export function scaleCropBox(box: CropBox, factor: number, size: ImageSize, aspect: number | null): CropBox {
  const ratio = aspect ?? box.width / box.height;
  let width = box.width * factor;
  // Le plafond : la plus grande largeur qui tient dans l'image à ces proportions.
  const maxWidth = Math.min(size.width, size.height * ratio);
  const min = minCropSize(size);
  const minWidth = Math.min(Math.max(min, min * ratio), maxWidth);
  width = clamp(width, minWidth, maxWidth);
  const height = width / ratio;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return moveCropBox({ x: cx - width / 2, y: cy - height / 2, width, height }, 0, 0, size);
}

/** Pas d'un agrandissement au clavier ou au bouton. */
export const CROP_SCALE_STEP = 1.1;

/**
 * Le cadre après une touche, ou `null` si la touche ne le concerne pas.
 *
 * Flèches : déplacement de 1 % de l'image (10 % avec Maj). `+` / `-` :
 * agrandir / réduire le cadre. Origine : revenir au cadre proposé.
 */
export function cropBoxFromKey(
  box: CropBox,
  key: string,
  shift: boolean,
  size: ImageSize,
  aspect: number | null,
): CropBox | null {
  const share = shift ? 0.1 : 0.01;
  const stepX = size.width * share;
  const stepY = size.height * share;
  switch (key) {
    case "ArrowLeft":
      return moveCropBox(box, -stepX, 0, size);
    case "ArrowRight":
      return moveCropBox(box, stepX, 0, size);
    case "ArrowUp":
      return moveCropBox(box, 0, -stepY, size);
    case "ArrowDown":
      return moveCropBox(box, 0, stepY, size);
    case "+":
    case "=":
      return scaleCropBox(box, CROP_SCALE_STEP, size, aspect);
    case "-":
    case "_":
      return scaleCropBox(box, 1 / CROP_SCALE_STEP, size, aspect);
    case "Home":
      return defaultCropBox(size, aspect);
    default:
      return null;
  }
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/** Pixels de la modale → fractions qui voyagent. */
export function cropBoxToRect(box: CropBox, size: ImageSize): CropRect {
  const x = clamp(box.x / size.width, 0, 1);
  const y = clamp(box.y / size.height, 0, 1);
  return {
    x: round6(x),
    y: round6(y),
    width: round6(clamp(box.width / size.width, 0, 1 - x)),
    height: round6(clamp(box.height / size.height, 0, 1 - y)),
  };
}

/** Le rectangle couvre-t-il toute l'image ? Il n'y a alors rien à découper. */
export function isFullCrop(rect: CropRect): boolean {
  return rect.x <= EPSILON && rect.y <= EPSILON && rect.width >= 1 - EPSILON && rect.height >= 1 - EPSILON;
}

/**
 * Le rectangle à joindre à l'envoi : `null` quand il ne découpe rien, pour
 * que le serveur suive son chemin d'origine plutôt qu'un découpage à vide.
 */
export function cropToSend(box: CropBox, size: ImageSize): CropRect | null {
  const rect = cropBoxToRect(box, size);
  return isFullCrop(rect) ? null : rect;
}

/** Forme sérialisée du champ multipart. */
export function serializeCropRect(rect: CropRect): string {
  return JSON.stringify({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
}

export type ParsedCropField = { ok: true; crop: CropRect | null } | { ok: false };

/**
 * Lecture du champ `crop` d'un envoi — le rectangle vient du navigateur, il ne
 * fait pas foi.
 *
 * Absent ou vide : `null`, le gabarit s'applique seul (un envoi d'avant l'outil
 * reste valable). Présent : quatre nombres finis, dans l'image, de surface non
 * nulle — sinon refus, jamais un repli silencieux sur l'image entière, qui
 * enregistrerait autre chose que ce que la modale a montré.
 */
export function parseImageCropField(raw: unknown): ParsedCropField {
  if (raw === null || raw === undefined || raw === "") return { ok: true, crop: null };
  if (typeof raw !== "string" || raw.length > MAX_FIELD_LENGTH) return { ok: false };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { ok: false };
  const { x, y, width, height } = value as Record<string, unknown>;
  const numbers = [x, y, width, height];
  if (!numbers.every((n) => typeof n === "number" && Number.isFinite(n))) return { ok: false };
  const rect = { x, y, width, height } as CropRect;
  if (rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0) return { ok: false };
  if (rect.x + rect.width > 1 + EPSILON || rect.y + rect.height > 1 + EPSILON) return { ok: false };
  return { ok: true, crop: rect };
}

/** Zone à extraire, en pixels entiers, au format de `sharp.extract`. */
export interface CropRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Fractions → pixels entiers de l'image orientée.
 *
 * Arrondi **vers l'extérieur** (bord gauche vers le bas, bord droit vers le
 * haut) : un rectangle qui touche le bord garde le bord, et la zone ne
 * s'effondre jamais sous un pixel.
 */
export function cropRectToRegion(rect: CropRect, size: ImageSize): CropRegion {
  const left = clamp(Math.floor(rect.x * size.width), 0, size.width - 1);
  const top = clamp(Math.floor(rect.y * size.height), 0, size.height - 1);
  const right = clamp(Math.ceil((rect.x + rect.width) * size.width), left + 1, size.width);
  const bottom = clamp(Math.ceil((rect.y + rect.height) * size.height), top + 1, size.height);
  return { left, top, width: right - left, height: bottom - top };
}
