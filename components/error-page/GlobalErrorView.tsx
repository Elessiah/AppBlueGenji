"use client";

import { FONT_VARIABLES } from "@/app/site-fonts";
import { CyberButton } from "@/components/cyber";
import { ErrorPanel } from "@/components/error-page/ErrorPanel";
import { errorPageTitle, errorReference, runtimeErrorCopy } from "@/lib/shared/error-pages";
import { DEFAULT_LOCALE, localeHref, type Locale } from "@/lib/shared/locales";
import { shellText, type ShellMessages } from "@/lib/shared/shell-text";

/**
 * Textes de la coquille pour le dernier filet. Le français est déjà dans le
 * paquet ; une autre langue se charge **à la demande** : `GlobalError` est une
 * référence client de chaque page (Next la déclare d'avance), un import statique
 * y mettrait l'anglais pour tous les visiteurs.
 */
export async function loadGlobalErrorShell(locale: Locale): Promise<ShellMessages | undefined> {
  if (locale === "en") return (await import("@/messages/en/shell.json")).default;
  return undefined;
}

/**
 * Rendu du dernier filet. Tant que les textes d'une autre langue ne sont pas
 * arrivés (`messages` absent), la page reste en français — et le dit
 * (`<html lang="fr">`).
 */
export function GlobalErrorView({
  error,
  locale,
  messages,
  onRetry,
}: Readonly<{
  error: Error & { digest?: string };
  locale: Locale;
  messages: ShellMessages | undefined;
  onRetry: () => void;
}>) {
  const shown = messages ? locale : DEFAULT_LOCALE;
  const { t } = shellText(shown, messages);
  const reference = errorReference(error.digest);
  const copy = runtimeErrorCopy(reference, t);

  return (
    <html lang={shown}>
      <body style={FONT_VARIABLES}>
        <title>{errorPageTitle(copy, t)}</title>
        <main>
          <ErrorPanel copy={copy} reference={reference} referenceLabel={t("errorPages.reference")}>
            <CyberButton type="button" onClick={onRetry}>
              {t("errorPages.retry")}
            </CyberButton>
            <CyberButton asChild variant="ghost">
              {/* `<a>` nu : rechargement complet voulu. */}
              <a href={localeHref("/", locale)}>{t("errorPages.links.home")}</a>
            </CyberButton>
          </ErrorPanel>
        </main>
      </body>
    </html>
  );
}
