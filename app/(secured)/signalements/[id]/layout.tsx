import type { Metadata } from "next";
import { parseEntityPageId } from "@/lib/shared/entity-page-titles";
import { segmentTitle } from "@/lib/shared/page-metadata";
import { localeAlternates, localeHref } from "@/lib/shared/locales";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";

type MetadataProps = {
  params: Promise<{ id: string }>;
};

/**
 * Titre de la page d'un signalement, lue par les personnes qu'il vise — voir
 * `app/(secured)/tournois/layout.tsx` pour la raison d'une mise en page —,
 * dans la langue de l'adresse (lot 9-2), avec canonique et `hreflang` de
 * **ce** signalement, comme les autres routes migrées. Les textes de la page
 * voyagent avec elle (`components/reports/reports-text.ts`), comme ceux du
 * formulaire.
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

export default function ConcernedReportLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
