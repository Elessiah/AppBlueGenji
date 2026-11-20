import type { Metadata } from "next";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import { NotFoundContent, notFoundMetadata } from "@/components/error-page/NotFoundContent";
import { EnsureToastProvider } from "@/components/ui/toast";

export async function generateMetadata(): Promise<Metadata> {
  return notFoundMetadata();
}

/**
 * Page introuvable : toute URL inconnue et tout `notFound()` sans limite plus
 * proche. Dans la langue de la page, dans le gabarit de la vitrine (en-tête,
 * pied de page), avec des chemins de retour — la page par défaut de Next n'en
 * avait aucun. Sous l'espace sécurisé, `(secured)/not-found.tsx` prend le
 * relais, sans en-tête : celui de `SiteShell` est déjà là.
 *
 * Enveloppée de `EnsureToastProvider` : Next la rend aussi **sans** la mise en
 * page racine (réponse à une requête d'action inconnue), et le pied de page
 * appelle `useToast()`. Seule cette page en a besoin — les autres pages vitrine
 * restent sous le fournisseur racine, dont un oubli doit se voir.
 */
export default async function NotFound() {
  const content = await NotFoundContent();
  return (
    <EnsureToastProvider>
      <PublicPageShell>
        {content}
      </PublicPageShell>
    </EnsureToastProvider>
  );
}
