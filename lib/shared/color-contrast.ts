/**
 * Rapport de contraste WCAG 2.x entre deux couleurs `#rrggbb` (1 à 21).
 * Sert à vérifier les jetons de texte de la palette (`app/globals.css`,
 * `docs/features/DESIGN_SYSTEM.md` § Contrastes) : 4,5:1 pour un texte courant,
 * 3:1 pour un grand texte.
 */
export function contrastRatio(foreground: string, background: string): number {
  const [a, b] = [relativeLuminance(foreground), relativeLuminance(background)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Luminance relative WCAG d'une couleur `#rrggbb` ; lève sur un autre format. */
export function relativeLuminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`couleur #rrggbb attendue : ${hex}`);
  const channels = [1, 3, 5]
    .map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
