import type { ReactNode } from "react";
import { PublicHeader } from "./PublicHeader";
import { PublicFooter } from "./PublicFooter";
import { EnsureToastProvider } from "@/components/ui/toast";

/**
 * Gabarit des pages vitrine : en-tête, contenu principal, pied de page —
 * **dans cet ordre et en frères**, jamais l'en-tête ni le pied dans `<main>`.
 *
 * Les pages les rendaient toutes à l'intérieur de leur `<main>`. Or un
 * `<header>` ou un `<footer>` imbriqué dans `<main>` perd son rôle de repère
 * (`banner`, `contentinfo`) : la navigation par repères d'un lecteur d'écran ne
 * trouvait ni l'en-tête ni le pied de page, et le « contenu principal » annoncé
 * commençait par le menu (WCAG 1.3.1). Passer par ce gabarit plutôt que de
 * recopier l'ordre à la main : la page ajoutée demain le reçoit sans y penser.
 *
 * L'empilement ne change pas à l'œil : `<main>` garde son contexte
 * (`position: relative; z-index: 1`) au-dessus du fond, et l'en-tête collant
 * (`z-index: 30`), sorti de ce contexte, reste au-dessus du contenu — son menu
 * burger compris, qui ne dépend que de lui.
 *
 * Le gabarit s'assure d'un fournisseur de notifications (`EnsureToastProvider`) :
 * Next le rend aussi sans la mise en page racine (page d'introuvable servie en
 * réponse à une requête d'action inconnue), et le pied de page en a besoin.
 */
export function PublicPageShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <EnsureToastProvider>
      <PublicHeader />
      <main style={{ position: "relative", zIndex: 1 }}>{children}</main>
      <PublicFooter />
    </EnsureToastProvider>
  );
}
