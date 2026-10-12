import type { Metadata } from "next";
import { memberAreaShareMetadata, segmentTitle } from "@/lib/shared/page-metadata";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { TeamErrorsTextGate } from "@/components/i18n/english-gates";
import { englishOnDocumentLoad } from "@/lib/server/layout-messages";

/**
 * Titre de l'annuaire des équipes et, faute de mieux, de ses sous-pages —
 * voir `app/(secured)/tournois/layout.tsx` pour la raison d'une mise en page.
 *
 * Encart générique (`memberAreaShareMetadata`) : le robot d'aperçu n'a pas de
 * session — ni nom ni pseudo, rien que le `<head>` anonyme ne montre déjà. Il
 * suit la langue de l'adresse (`/en/equipes`, lot 9).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const { meta } = messagesFor(locale).teams;
  return { title: segmentTitle(meta.title), ...memberAreaShareMetadata("teams", "teams", locale) };
}

/**
 * Pose la table des refus, commune à l'annuaire, à la création et à la fiche :
 * rien en français (déjà dans le paquet), l'anglais sous `/en` seulement.
 * Chaque page pose ensuite ses propres textes (`page.tsx`, `creer/page.tsx`,
 * `[id]/layout.tsx`) — la fiche n'embarque pas ceux de l'annuaire.
 */
export default async function TeamsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await requestLocale();
  // L'anglais au chargement complet seulement (revue de performance du lot 9-2) : jamais
  // dans une réponse du routeur (navigation, préchargement, `router.refresh()`).
  const messages = await englishOnDocumentLoad(locale, (all) => all.teamErrors);
  return (
    <TeamErrorsTextGate
      locale={locale}
      messages={messages}
    >
      {children}
    </TeamErrorsTextGate>
  );
}
