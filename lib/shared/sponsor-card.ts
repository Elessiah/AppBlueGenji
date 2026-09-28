import { type Sponsor, isStoredSponsorBanner } from "./sponsors";
import { sponsorLogoSrc } from "./sponsor-logo";
import { toServedUploadUrl } from "./uploads";

/**
 * Présentation d'une carte partenaire de l'accueil (`SponsorsGrid`).
 *
 * La vitrine n'affichait qu'un logo par partenaire, rogné en 3:1 : ni nom, ni
 * description, alors que la description était saisie et stockée — on voyait
 * quatre miniatures sans savoir qui elles désignaient ni pourquoi elles étaient
 * là. Une carte porte désormais, comme celle d'un tournoi, une **image** (bandeau
 * et/ou logo), un **nom** visible et une **brève description**.
 *
 * Le module décide de ce qui s'affiche ; le composant ne fait que le rendre.
 */

/**
 * Ce qu'occupe la zone d'image de la carte :
 * - `BANNER` — un bandeau recadré en fond ; le logo, s'il existe, s'y pose en
 *   pastille dans le coin ;
 * - `LOGO` — pas de bandeau : le logo s'affiche **entier** (jamais rogné) au
 *   centre de la zone, sur le fond hachuré ;
 * - `PLACEHOLDER` — ni l'un ni l'autre : le fond hachuré porte l'initiale.
 */
export type SponsorMediaLayout = "BANNER" | "LOGO" | "PLACEHOLDER";

export type SponsorCardMedia = {
  layout: SponsorMediaLayout;
  /** Adresse du bandeau — toujours un fichier du site. */
  bannerSrc: string | null;
  /** Adresse du logo — toujours une adresse du site (`sponsorLogoSrc`). */
  logoSrc: string | null;
};

/**
 * Adresse du bandeau, ou `null`. Posée **à la sortie** comme pour le logo : une
 * ligne dont la colonne aurait été remplie autrement que par le téléversement
 * (import, correction à la main) ne ferait jamais partir une requête vers un
 * tiers, et `next/image` ne lèverait pas sur un hôte inconnu.
 */
export function sponsorBannerSrc(sponsor: Pick<Sponsor, "bannerUrl">): string | null {
  const bannerUrl = sponsor.bannerUrl?.trim();
  if (!bannerUrl || !isStoredSponsorBanner(bannerUrl)) return null;
  return toServedUploadUrl(bannerUrl);
}

export function sponsorCardMedia(sponsor: Pick<Sponsor, "id" | "logoUrl" | "bannerUrl">): SponsorCardMedia {
  const bannerSrc = sponsorBannerSrc(sponsor);
  const logoSrc = sponsorLogoSrc(sponsor);
  const layout: SponsorMediaLayout = bannerSrc ? "BANNER" : logoSrc ? "LOGO" : "PLACEHOLDER";
  return { layout, bannerSrc, logoSrc };
}

/**
 * Lien du site du partenaire, ou `null` s'il n'y en a pas d'exploitable.
 *
 * L'ancienne vitrine rendait `href="#"` pour un partenaire sans site : une carte
 * cliquable qui ne menait nulle part (et remontait en haut de page). Seuls
 * `http:` et `https:` passent — un `javascript:` saisi dans le champ ne doit
 * jamais devenir un lien.
 */
export function sponsorWebsiteHref(websiteUrl: string | null | undefined): string | null {
  const raw = websiteUrl?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Nom de domaine affiché sous la description (« youtube.com »), pour qu'on sache
 * où mène la carte avant de cliquer. `www.` est retiré : il n'apprend rien.
 */
export function sponsorWebsiteLabel(websiteUrl: string | null | undefined): string | null {
  const href = sponsorWebsiteHref(websiteUrl);
  if (!href) return null;
  return new URL(href).hostname.replace(/^www\./i, "");
}

/** Initiale du repli sans image, découpée en caractères (un emoji n'est pas coupé). */
export function sponsorInitial(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toLocaleUpperCase("fr-FR") : "?";
}
