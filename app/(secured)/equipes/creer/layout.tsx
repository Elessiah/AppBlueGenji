import type { Metadata } from "next";
import { segmentTitle } from "@/lib/shared/page-metadata";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";

/**
 * Le formulaire de création n'est pas l'annuaire : sans ce titre, il
 * héritait de « Équipes ». Dans la langue de l'adresse (lot 9).
 */
export async function generateMetadata(): Promise<Metadata> {
  const { meta } = messagesFor(await requestLocale()).teams;
  return { title: segmentTitle(meta.createTitle) };
}

export default function CreateTeamLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
