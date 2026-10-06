import type { Metadata } from "next";
import { CyberButton } from "@/components/cyber";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import { ErrorPanel } from "@/components/error-page/ErrorPanel";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { NOT_FOUND_LINKS, errorPageTitle, notFoundCopy } from "@/lib/shared/error-pages";
import { shellText } from "@/lib/shared/shell-text";

/** Les textes de la coquille dans la langue de la requête. */
async function shellTranslate() {
  const locale = await requestLocale();
  return shellText(locale, messagesFor(locale).shell).t;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await shellTranslate();
  return {
    // `absolute` : le gabarit de titre de la mise en page racine ne vaut que pour
    // ses segments enfants, et cette page partage son segment.
    title: { absolute: errorPageTitle(notFoundCopy(t), t) },
    robots: { index: false, follow: false },
  };
}

/**
 * Page introuvable : toute URL inconnue et tout `notFound()` sans limite plus
 * proche. Dans la langue de la page, dans le gabarit de la vitrine (en-tête,
 * pied de page), avec des chemins de retour — la page par défaut de Next n'en
 * avait aucun.
 */
export default async function NotFound() {
  const t = await shellTranslate();
  return (
    <PublicPageShell>
      <ErrorPanel copy={notFoundCopy(t)} referenceLabel={t("errorPages.reference")}>
        {NOT_FOUND_LINKS.map((link, index) => (
          <CyberButton key={link.href} asChild variant={index === 0 ? "primary" : "ghost"}>
            <LocaleLink href={link.href}>{t(link.labelKey)}</LocaleLink>
          </CyberButton>
        ))}
      </ErrorPanel>
    </PublicPageShell>
  );
}
