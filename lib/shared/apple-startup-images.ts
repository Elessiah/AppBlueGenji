/**
 * Écrans de lancement iOS (`<link rel="apple-touch-startup-image">`).
 *
 * Ouverte en mode app web — ce qu'iOS 26 impose par défaut à l'ajout sur
 * l'écran d'accueil, quel que soit le manifeste (voir `APP_DISPLAY`) —, l'app
 * affiche un écran blanc avant la première page, sauf si une image de
 * lancement correspond **exactement** à l'écran : iOS ne redimensionne rien,
 * il choisit par `media` la seule image aux dimensions de l'appareil et de son
 * orientation, et retombe sur le blanc s'il n'en trouve aucune. D'où une image
 * par écran et par orientation, fond `--cyber-bg` et logo au centre : le
 * lancement se fond dans la première page peinte, comme le fait le manifeste
 * pour Android.
 *
 * Les images ne sont pas des fichiers du dépôt : quarante PNG à régénérer à la
 * main au premier changement de logo dériveraient. Elles sont rendues à la
 * compilation par `app/apple-startup/[file]/route.ts`, depuis cette liste.
 */

/** Écran d'un appareil, en points CSS (portrait) et densité de pixels. */
export interface AppleScreen {
  /** `device-width` en portrait. */
  width: number;
  /** `device-height` en portrait. */
  height: number;
  pixelRatio: 2 | 3;
}

/**
 * Écrans des appareils qu'iOS 18 et iOS 26 font encore tourner (iPhone XR et
 * au-delà, iPhone SE 2ᵉ génération, iPad pris en charge). Plusieurs modèles
 * partagent un écran : une entrée par écran, jamais par modèle.
 */
export const APPLE_SCREENS: readonly AppleScreen[] = [
  // iPhone
  { width: 375, height: 667, pixelRatio: 2 }, // SE 2ᵉ et 3ᵉ gén.
  { width: 375, height: 812, pixelRatio: 3 }, // XS, 11 Pro, 12 mini, 13 mini
  { width: 390, height: 844, pixelRatio: 3 }, // 12, 13, 14, 16e
  { width: 393, height: 852, pixelRatio: 3 }, // 14 Pro, 15, 15 Pro, 16
  { width: 402, height: 874, pixelRatio: 3 }, // 16 Pro, 17, 17 Pro
  { width: 414, height: 896, pixelRatio: 2 }, // XR, 11
  { width: 414, height: 896, pixelRatio: 3 }, // XS Max, 11 Pro Max
  { width: 420, height: 912, pixelRatio: 3 }, // Air
  { width: 428, height: 926, pixelRatio: 3 }, // 12 Pro Max, 13 Pro Max, 14 Plus
  { width: 430, height: 932, pixelRatio: 3 }, // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  { width: 440, height: 956, pixelRatio: 3 }, // 16 Pro Max, 17 Pro Max
  // iPad
  { width: 744, height: 1133, pixelRatio: 2 }, // mini 6ᵉ gén. et au-delà
  { width: 768, height: 1024, pixelRatio: 2 }, // 9,7 po, mini 5ᵉ gén.
  { width: 810, height: 1080, pixelRatio: 2 }, // 10,2 po
  { width: 820, height: 1180, pixelRatio: 2 }, // Air 10,9 po, iPad 10ᵉ gén. et au-delà
  { width: 834, height: 1112, pixelRatio: 2 }, // Air 10,5 po
  { width: 834, height: 1194, pixelRatio: 2 }, // Pro 11 po, Air 11 po
  { width: 834, height: 1210, pixelRatio: 2 }, // Pro 11 po (M4)
  { width: 1024, height: 1366, pixelRatio: 2 }, // Pro 12,9 po, Air 13 po
  { width: 1032, height: 1376, pixelRatio: 2 }, // Pro 13 po (M4)
];

export type AppleOrientation = "portrait" | "landscape";

export interface AppleStartupImage {
  /** Nom de fichier servi, `<largeur>x<hauteur>.png` en pixels physiques. */
  file: string;
  /** Dimensions de l'image, en pixels physiques, dans l'orientation visée. */
  width: number;
  height: number;
  media: string;
}

/** Préfixe de la route qui rend les images. */
export const APPLE_STARTUP_IMAGE_PATH = "/apple-startup";

/** Côté du logo, en fraction du plus petit côté de l'écran. */
export const APPLE_STARTUP_LOGO_RATIO = 0.3;

function startupImage(screen: AppleScreen, orientation: AppleOrientation): AppleStartupImage {
  const portraitWidth = screen.width * screen.pixelRatio;
  const portraitHeight = screen.height * screen.pixelRatio;
  const [width, height] =
    orientation === "portrait" ? [portraitWidth, portraitHeight] : [portraitHeight, portraitWidth];
  return {
    file: `${width}x${height}.png`,
    width,
    height,
    // `device-width`/`device-height` restent ceux du portrait quelle que soit
    // l'orientation : c'est `orientation` qui départage les deux images.
    media:
      `(device-width: ${screen.width}px) and (device-height: ${screen.height}px)` +
      ` and (-webkit-device-pixel-ratio: ${screen.pixelRatio}) and (orientation: ${orientation})`,
  };
}

/** Toutes les images, portrait puis paysage pour chaque écran. */
export function appleStartupImages(): AppleStartupImage[] {
  return APPLE_SCREENS.flatMap((screen) => [startupImage(screen, "portrait"), startupImage(screen, "landscape")]);
}

/**
 * Fichiers distincts à rendre. Deux écrans pourraient un jour produire les
 * mêmes dimensions physiques (pas aujourd'hui) : un fichier ne se rend qu'une
 * fois, les deux `media` le désignent.
 */
export function appleStartupImageFiles(): string[] {
  return [...new Set(appleStartupImages().map((image) => image.file))];
}

/** Liens de la mise en page racine (`metadata.appleWebApp.startupImage`). */
export function appleStartupImageLinks(): { url: string; media: string }[] {
  return appleStartupImages().map((image) => ({
    url: `${APPLE_STARTUP_IMAGE_PATH}/${image.file}`,
    media: image.media,
  }));
}

/**
 * Dimensions désignées par un nom de fichier, **seulement** s'il figure dans
 * la liste : la route ne rend jamais une taille qu'on lui choisirait.
 */
export function parseAppleStartupImageFile(file: string): { width: number; height: number } | null {
  const image = appleStartupImages().find((candidate) => candidate.file === file);
  return image ? { width: image.width, height: image.height } : null;
}

/** Côté du logo pour une image donnée, en pixels entiers. */
export function appleStartupLogoSize(width: number, height: number): number {
  return Math.round(Math.min(width, height) * APPLE_STARTUP_LOGO_RATIO);
}
