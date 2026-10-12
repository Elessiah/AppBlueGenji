import type { Metadata } from "next";
import { segmentTitle } from "@/lib/shared/page-metadata";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";

/**
 * Titre de la page d'un signalement, lue par les personnes qu'il vise — voir
 * `app/(secured)/tournois/layout.tsx` pour la raison d'une mise en page —,
 * dans la langue de l'adresse (lot 9-2). Les textes de la page voyagent avec
 * elle (`components/reports/reports-text.ts`), comme ceux du formulaire.
 */
export async function generateMetadata(): Promise<Metadata> {
  return { title: segmentTitle(messagesFor(await requestLocale()).reports.concerned.title) };
}

export default function ConcernedReportLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
