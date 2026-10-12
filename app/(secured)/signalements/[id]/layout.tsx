import type { Metadata } from "next";
import { parseEntityPageId } from "@/lib/shared/entity-page-titles";
import { segmentTitle } from "@/lib/shared/page-metadata";
import { localeAlternates, localeHref } from "@/lib/shared/locales";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { clientShowsSegment } from "@/lib/server/layout-messages";
import { ConcernedReportsText } from "@/components/reports/concerned-reports-text";
import { SecuredLoadingView } from "../../_shared/SecuredLoading";

type MetadataProps = {
  params: Promise<{ id: string }>;
};

/**
 * Titre de la page d'un signalement, lue par les personnes qu'il vise — voir
 * `app/(secured)/tournois/layout.tsx` pour la raison d'une mise en page —,
 * dans la langue de l'adresse (lot 9-2), avec canonique et `hreflang` de
 * **ce** signalement, comme les autres routes migrées.
 */
export async function generateMetadata({ params }: MetadataProps): Promise<Metadata> {
  const { id } = await params;
  const locale = await requestLocale();
  const title = segmentTitle(messagesFor(locale).reports.concerned.title);
  const reportId = parseEntityPageId(id);
  if (reportId === null) return { title };
  const path = `/signalements/${reportId}`;
  const languages = localeAlternates(path);
  const canonical = localeHref(path, locale);
  return { title, alternates: languages ? { canonical, languages } : { canonical } };
}

/**
 * Pose les textes de la page et du formulaire de contestation : rien en
 * français, déjà dans le paquet de la page (`reports-text.ts`) ; l'anglais
 * sous `/en` seulement — et pas à un client qui affiche déjà un signalement
 * (rafraîchissement, passage d'un signalement à l'autre : `clientShowsSegment`),
 * qui le tient déjà (`ConcernedReportsText`).
 */
export default async function ConcernedReportLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await requestLocale();
  const all = messagesFor(locale);
  const messages = locale === "en" && !(await clientShowsSegment("/signalements")) ? all.reports : undefined;
  return (
    <ConcernedReportsText
      locale={locale}
      messages={messages}
      fallback={locale === "en" && !messages ? <SecuredLoadingView label={all.shell.loading} /> : null}
    >
      {children}
    </ConcernedReportsText>
  );
}
