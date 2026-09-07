import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/server/auth";
import { getVisibleTournamentSnapshot } from "@/lib/server/tournaments-service";
import { can } from "@/lib/shared/permissions";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  tournamentShareDescription,
  tournamentShareTitle,
} from "@/lib/shared/share-metadata";

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
};

/**
 * Ce qu'un lien de tournoi raconte là où on le colle.
 *
 * La fiche est une page cliente : elle ne peut pas exporter `generateMetadata`,
 * d'où cette mise en page, qui n'existe que pour ça et se contente de rendre son
 * enfant. Elle est atteinte **même par un visiteur non connecté** — la garde de
 * l'espace sécurisé ne redirige plus, elle rend une carte (voir
 * `app/(secured)/_shared/AuthGate.tsx`) —, ce qui est la condition pour qu'un
 * robot d'aperçu voie autre chose que la page de connexion.
 *
 * La règle de visibilité est celle du reste du site, sans exception :
 * {@link getVisibleTournamentSnapshot} est la seule porte, et un tournoi non
 * publié n'existe que pour la permission `tournaments`. Un tournoi qu'on ne peut
 * pas lire ne produit donc pas d'encart particulier — il retombe sur celui du
 * site, plutôt qu'un « accès refusé » qui confirmerait son existence.
 *
 * La lecture est mutualisée : `getTournamentSnapshot` passe par le cache à vol
 * unique du module, celui-là même que sert le flux SSE. Un lien collé dans un
 * gros salon Discord ne déclenche donc pas une passe en base par robot.
 */
export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const fallback: Metadata = { title: "Tournoi", description: SITE_DESCRIPTION };

  const { id } = await params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) return fallback;

  // Une base injoignable ne doit pas faire échouer la page entière : sans ce
  // filet, une panne de lecture rendrait la fiche inaccessible au lieu de la
  // laisser afficher son propre message d'erreur.
  const snapshot = await getCurrentUser()
    .then((user) =>
      getVisibleTournamentSnapshot(tournamentId, {
        canManage: user ? can(user, "tournaments") : false,
      }),
    )
    .catch(() => null);

  if (!snapshot) return fallback;

  const title = tournamentShareTitle(snapshot.card);
  const description = tournamentShareDescription(snapshot.card);

  return {
    // Le gabarit de la racine ajouterait « · BlueGenji Esport » derrière un
    // titre qui porte déjà le nom du tournoi et son jeu : `absolute` le coupe,
    // le nom du site étant de toute façon annoncé par `og:site_name`.
    title: { absolute: title },
    description,
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "fr_FR",
      title,
      description,
      url: `/tournois/${tournamentId}`,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default function TournamentDetailLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
