/**
 * Partage d'une adresse publique par le bouton « Partager »
 * (`docs/features/SHARE_EMBEDS.md`) : la feuille de partage du système quand
 * le navigateur en a une (Web Share API, mobile surtout), sinon la copie dans
 * le presse-papiers. Pur : le navigateur est passé en argument, pour que la
 * règle se teste sans DOM.
 */
import { localeHref, type Locale } from "./locales";

/** Ce que le partage a donné : la notification à montrer en dépend. */
export type ShareLinkOutcome = "shared" | "copied" | "cancelled" | "failed";

/** Les deux portes du navigateur dont le partage se sert. */
export type ShareLinkNavigator = {
  share?: (data: { url: string; title?: string }) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
};

/**
 * L'adresse **absolue** à partager : l'origine du site, puis le chemin public
 * (`/suivre/…`) dans la langue de la page (`/en/suivre/…` en anglais).
 */
export function absoluteShareUrl(origin: string, path: string, locale: Locale): string {
  return `${origin.replace(/\/+$/u, "")}${localeHref(path, locale)}`;
}

function isAbort(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

/**
 * Partage `url`. Feuille de partage d'abord : la fermer sans choisir
 * (`AbortError`) n'est pas une erreur — rien à notifier. Tout autre refus
 * (permission, contexte non sûr) retombe sur la copie, qui seule peut échouer
 * pour de bon.
 */
export async function shareLink(
  nav: ShareLinkNavigator | undefined,
  url: string,
  title?: string,
): Promise<ShareLinkOutcome> {
  if (typeof nav?.share === "function") {
    try {
      await nav.share(title ? { url, title } : { url });
      return "shared";
    } catch (error) {
      if (isAbort(error)) return "cancelled";
    }
  }
  if (typeof nav?.clipboard?.writeText !== "function") return "failed";
  try {
    await nav.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}
