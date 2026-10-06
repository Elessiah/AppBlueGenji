import type { Metadata } from "next";
import { pageMetadata } from "@/lib/shared/page-metadata";
import { getCurrentUser } from "@/lib/server/auth";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { SiteFooterBar } from "@/components/legal/SiteFooterBar";

/**
 * La page de connexion est une page cliente : elle ne peut pas exporter de
 * métadonnées, d'où cette mise en page qui n'existe que pour ça.
 *
 * Elle n'en portait donc **aucune** et retombait sur le socle de la racine —
 * même titre et même description que l'accueil, ce qu'un moteur lit comme deux
 * pages qui se disputent la même requête.
 *
 * Elle est `noindex` **et** `follow` : il n'y a rien à référencer sur un
 * formulaire de connexion, mais les liens qu'il porte (l'accueil, les règles)
 * restent des liens du site, qu'un robot peut suivre. L'URL canonique n'est pas
 * décorative pour autant : `?redirect=` multiplie l'adresse autant qu'il y a de
 * destinations, et c'est elle qui les ramène à une seule.
 *
 * Dans la langue de la page (lot 6) : `/en/connexion` a sa canonique et ses
 * `hreflang`, toujours `noindex` — et toujours hors du sitemap.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const { meta } = messagesFor(locale).login;
  return {
    ...pageMetadata({ title: meta.title, description: meta.description, path: "/connexion", locale, shareCard: "login" }),
    robots: { index: false, follow: true },
  };
}

/**
 * La page porte aussi le pied de page léger : le moyen de signaler un problème
 * et les conditions d'utilisation doivent s'y trouver comme partout — ce sont
 * d'ailleurs ces conditions qu'on accepte en créant un compte ici.
 */
export default async function ConnexionLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser().catch(() => null);
  return (
    <>
      {children}
      <SiteFooterBar authenticated={Boolean(user)} />
    </>
  );
}
