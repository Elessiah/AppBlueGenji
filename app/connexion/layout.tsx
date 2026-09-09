import type { Metadata } from "next";
import { pageMetadata } from "@/lib/shared/page-metadata";

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
 */
export const metadata: Metadata = {
  ...pageMetadata({
    title: "Connexion",
    description:
      "Connexion à l'espace membre BlueGenji Esport, par compte Google ou par code Discord.",
    path: "/connexion",
  }),
  robots: { index: false, follow: true },
};

export default function ConnexionLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
