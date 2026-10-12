import type { Metadata } from "next";
import { memberAreaShareMetadata, segmentTitle } from "@/lib/shared/page-metadata";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { PlayersTextGate } from "@/components/i18n/english-gates";
import { isDocumentLoad } from "@/lib/server/layout-messages";
import { SecuredLoadingView } from "../_shared/SecuredLoading";

/**
 * Titre de l'annuaire des joueurs et, faute de mieux, de ses sous-pages —
 * voir `app/(secured)/tournois/layout.tsx` pour la raison d'une mise en page.
 *
 * Encart générique (`memberAreaShareMetadata`) : le robot d'aperçu n'a pas de
 * session — ni nom ni pseudo, rien que le `<head>` anonyme ne montre déjà. Il
 * suit la langue de l'adresse (`/en/joueurs`, lot 9).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const { meta } = messagesFor(locale).players;
  return { title: segmentTitle(meta.title), ...memberAreaShareMetadata("players", "players", locale) };
}

/**
 * Pose les textes de l'annuaire et de la fiche (un seul espace, `players`) :
 * rien en français (déjà dans le paquet), l'anglais sous `/en` seulement.
 */
export default async function PlayersLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await requestLocale();
  // L'anglais au chargement complet seulement (revue de performance du lot 9-2).
  const all = messagesFor(locale);
  const messages = locale === "en" && (await isDocumentLoad()) ? all.players : undefined;
  return (
    <PlayersTextGate
      locale={locale}
      messages={messages}
      fallback={locale === "en" && !messages ? <SecuredLoadingView label={all.shell.loading} /> : null}
    >
      {children}
    </PlayersTextGate>
  );
}
